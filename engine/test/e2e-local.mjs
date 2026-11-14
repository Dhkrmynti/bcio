// Tes end-to-end di anvil lokal (CHAIN=local, engine berjalan di :5191).
//   node test/e2e-local.mjs
// User = akun anvil #2: faucet -> beli basket -> izinkan agent -> aktifkan shield & rebalancer
// lewat API bertanda tangan -> engine mengeksekusi lewat executeFor -> cek batas policy.
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, parseUnits, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DESK_ABI } from '../src/chain.js';

const API = 'http://127.0.0.1:5191';
const d = JSON.parse(fs.readFileSync(new URL('../deployments/31337.json', import.meta.url)));
const chain = defineChain({ id: 31337, name: 'anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [d.rpc] } } });
const user = privateKeyToAccount('0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e');
const pub = createPublicClient({ chain, transport: http() });
const wal = createWalletClient({ chain, account: user, transport: http() });
const T = d.tokens;

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const send = async (fn, args) => {
  const { request } = await pub.simulateContract({ account: user, address: d.desk, abi: DESK_ABI, functionName: fn, args });
  const hash = await wal.writeContract(request);
  return pub.waitForTransactionReceipt({ hash });
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

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
