// Tes end-to-end (engine berjalan di :5191 dengan CHAIN yang sama).
//   node test/e2e-local.mjs                     # anvil lokal, user = akun anvil #6
//   E2E_CHAIN=testnet node test/e2e-local.mjs   # Robinhood Chain testnet: user = wallet baru,
//                                               # diberi sedikit ETH gas dari contracts/.testnet-wallet
// Alur: faucet -> beli basket -> izinkan agent -> aktifkan shield & rebalancer
// lewat API bertanda tangan -> engine mengeksekusi lewat executeFor -> cek batas policy.
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, parseUnits, defineChain } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { DESK_ABI } from '../src/chain.js';

const API = 'http://127.0.0.1:5191';
const TESTNET = process.env.E2E_CHAIN === 'testnet';
const CHAIN_ID = TESTNET ? 46630 : 31337;
const d = JSON.parse(fs.readFileSync(new URL(`../deployments/${CHAIN_ID}.json`, import.meta.url)));
const chain = defineChain({ id: CHAIN_ID, name: TESTNET ? 'Robinhood Chain Testnet' : 'anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [d.rpc] } } });
const pub = createPublicClient({ chain, transport: http() });
const txs = [];
const explorer = (h) => (d.explorer ? `${d.explorer}/tx/${h}` : h);

let user;
if (TESTNET) {
  // wallet user sekali pakai, gas-nya dari wallet deploy (key tidak pernah dicetak)
  user = privateKeyToAccount(generatePrivateKey());
  const key = fs.readFileSync(new URL('../../contracts/.testnet-wallet', import.meta.url), 'utf8').match(/DEPLOYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];
  const funder = createWalletClient({ chain, account: privateKeyToAccount(key), transport: http() });
  const hash = await funder.sendTransaction({ to: user.address, value: parseUnits('0.0008', 18) });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`      test user ${user.address} funded with 0.0008 ETH: ${explorer(hash)}`);
} else {
  user = privateKeyToAccount('0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e');
}
const wal = createWalletClient({ chain, account: user, transport: http() });
const T = d.tokens;

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const send = async (fn, args) => {
  const { request } = await pub.simulateContract({ account: user, address: d.desk, abi: DESK_ABI, functionName: fn, args });
  const hash = await wal.writeContract(request);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${fn} reverted: ${hash}`);
  txs.push([fn, hash]);
  return rc;
};
const api = async (path, body) => {
  const r = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: r.status, body: await r.json() };
};

// harga oracle harus sudah didorong engine
const pf0 = await api(`/api/portfolio?address=${user.address}`);
check('portfolio endpoint', pf0.status === 200, `total $${pf0.body.total_usd?.toFixed(2)}`);

// 1. faucet (sekali per hari; lewati kalau sudah)
const last = await pub.readContract({ address: d.desk, abi: DESK_ABI, functionName: 'lastFaucet', args: [user.address] });
if (last === 0n) { await send('faucet', []); }
// 2. basket 6000 tUSDC: 40% NVDA, 30% TSLA, 30% BTC
await send('swapBasket', [T.USDC, parseUnits('6000', 6), [T.NVDA, T.TSLA, T.BTC], [4000, 3000, 3000], [0n, 0n, 0n]]);
const pf1 = (await api(`/api/portfolio?address=${user.address}`)).body;
const w = Object.fromEntries(pf1.positions.map((p) => [p.symbol, p.weight_pct.toFixed(1)]));
check('basket bought', Number(w.NVDA) > 20 && Number(w.TSLA) > 15, JSON.stringify(w));

// 3. aturan tanpa izin agent -> ditolak saat evaluasi
async function setRule(rule, enabled = true) {
  const prep = await api('/api/rules/prepare', { address: user.address, rule, enabled });
  const signature = await wal.signMessage({ message: prep.body.message });
  return api('/api/rules', { address: user.address, rule: prep.body.rule, issued: prep.body.issued, signature, enabled });
}
const shield = { type: 'shield', threshold_pct: 2, hedge_pct: 50, direction: 'any', cooldown_h: 12 };
const r1 = await setRule(shield);
check('signed shield rule saved', r1.status === 200 && r1.body.rules?.shield?.enabled === true);

// tanda tangan palsu ditolak
const prep = await api('/api/rules/prepare', { address: user.address, rule: shield });
const forged = await privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba').signMessage({ message: prep.body.message });
const r2 = await api('/api/rules', { address: user.address, rule: prep.body.rule, issued: prep.body.issued, signature: forged });
check('forged signature rejected', r2.status === 401);

await send('revokeAgent', [d.keeper]);
let ev = (await api('/api/automation/run', { address: user.address })).body;
check('no permission -> nothing traded', /not active/.test(ev.results?.shield?.skipped || ''), ev.results?.shield?.skipped);

// 4. izinkan agent: maks 1500/trade, 2500/hari, 7 hari
const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
await send('setAgent', [d.keeper, 1500n * 10n ** 8n, 2500n * 10n ** 8n, expiry]);
await new Promise((r) => setTimeout(r, 21_000)); // batas 1x / 20 dtk pada endpoint run
ev = (await api('/api/automation/run', { address: user.address })).body;
// the engine's 1-minute loop may already have fired the shield during the wait: read the log
const shLog = (await api(`/api/automation?address=${user.address}`)).body.activity.find((e) => e.type === 'shield' && e.trades);
const sh = ev.results?.shield?.fired ? ev.results.shield : shLog ? { fired: true, why: shLog.text, trades: shLog.trades } : ev.results?.shield;
console.log('      shield:', sh?.why || sh?.skipped, JSON.stringify((sh?.trades || []).map((t) => [t.from, t.to, t.ok, (t.error || '').slice(0, 60)])));
const pf2 = (await api(`/api/portfolio?address=${user.address}`)).body;
const nvda1 = pf1.positions.find((p) => p.symbol === 'NVDA').amount, nvda2 = pf2.positions.find((p) => p.symbol === 'NVDA').amount;
if (sh?.fired) {
  check('shield sold stock tokens to tUSDC', nvda2 < nvda1, `NVDA ${nvda1.toFixed(3)} -> ${nvda2.toFixed(3)}`);
  check('shield trades within on-chain limits', sh.trades.every((t) => t.ok || /limit/.test(t.error)), sh.trades.map((t) => t.ok || t.error).join(' | '));
} else {
  console.log('      (shield did not fire: market is open or crypto moved less than 2% in 24h)');
}

// 5. rebalancer: target 50% USDC, 20% NVDA, 15% BTC, 15% ETH, band 5
await setRule(shield, false);
const reb = await setRule({ type: 'rebalance', targets: { USDC: 50, NVDA: 20, BTC: 15, ETH: 15 }, band_pct: 5, min_interval_h: 1 });
check('signed rebalance rule saved', reb.status === 200 && reb.body.rules?.rebalance?.enabled === true);
await new Promise((r) => setTimeout(r, 21_000));
ev = (await api('/api/automation/run', { address: user.address })).body;
const rbLog = (await api(`/api/automation?address=${user.address}`)).body.activity.find((e) => e.type === 'rebalance' && e.trades);
const rb = ev.results?.rebalance?.fired ? ev.results.rebalance : rbLog ? { fired: true, why: rbLog.text, trades: rbLog.trades } : ev.results?.rebalance;
console.log('      rebalance:', rb?.why || rb?.skipped, JSON.stringify((rb?.trades || []).map((t) => [t.from, t.to, t.ok, (t.error || '').slice(0, 60)])));
check('rebalancer fired', !!rb?.fired);
check('blocked legs explain the on-chain limit', (rb?.trades || []).every((t) => t.ok || /limit/.test(t.error)), (rb?.trades || []).filter((t) => !t.ok).map((t) => t.error).join(' | '));
const pf3 = (await api(`/api/portfolio?address=${user.address}`)).body;
console.log('      weights after:', JSON.stringify(Object.fromEntries(pf3.positions.map((p) => [p.symbol, p.weight_pct.toFixed(1)]))));
const auto = (await api(`/api/automation?address=${user.address}`)).body;
check('activity log recorded', auto.activity.length >= 3, `${auto.activity.length} entries; spent today $${auto.policy.spent_today_usd}`);

console.log('\n      user transactions:');
txs.forEach(([fn, h]) => console.log(`        ${fn.padEnd(12)} ${explorer(h)}`));
const agentTx = auto.activity.flatMap((e) => (e.trades || []).filter((t) => t.tx_url || t.hash).map((t) => [e.type, t.from + '->' + t.to, t.tx_url || t.hash]));
if (agentTx.length) console.log('      agent transactions (executeFor):');
agentTx.slice(0, 6).forEach(([ty, leg, h]) => console.log(`        ${ty.padEnd(9)} ${leg.padEnd(10)} ${String(h).startsWith('http') ? h : explorer(h)}`));
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
