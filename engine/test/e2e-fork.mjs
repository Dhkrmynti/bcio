// Tes end-to-end di FORK Robinhood Chain mainnet (pool Uniswap, feed Chainlink dan token asli,
// tanpa transaksi sungguhan). Jalankan lewat:  ./test/e2e-fork.sh
//
// Alur yang diuji persis seperti di terminal:
//  1. user membeli basket (USDG -> NVDA/TSLA/QQQ) dalam SATU transaksi lewat SwapRouter02.multicall
//  2. user approve token ke kontrak BcioAgent dan memberi izin agent (setAgent)
//  3. aturan Weekend Shield & rebalancer disimpan, engine mengeksekusinya lewat executeFor
//  4. batas policy (per trade) memotong ukuran trade; revoke menghentikan agent
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, parseUnits, formatUnits, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = process.env.CHAIN_RPC;
if (!RPC || !process.env.DEPLOYMENT_FILE) throw new Error('run via test/e2e-fork.sh');
process.env.BCIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bcio-e2e-'));

const { MAINNET, AGENT_ABI, portfolio, policyOf, onchain } = await import('../src/chain.js');
const { saveRule, evaluate } = await import('../src/automation.js');

const chain = { id: 4663, name: 'fork', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
// akun anvil #2 (publik, hanya ada di chain lokal/fork)
const user = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const wal = createWalletClient({ chain, account: user, transport: http(RPC) });
const T = MAINNET.tokens;
const ERC20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const WETH = parseAbi(['function deposit() payable']);
const ROUTER = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])',
]);

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const tx = async (address, abi, functionName, args, value) => {
  const hash = await wal.writeContract({ address, abi, functionName, args, value });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${functionName} reverted`);
  return rc;
};
const bal = async (s) => Number(formatUnits(await pub.readContract({ address: T[s].address, abi: ERC20, functionName: 'balanceOf', args: [user.address] }), T[s].decimals));

console.log(`fork of chain ${await pub.getChainId()} · agent contract ${onchain.agentContract} · agent ${onchain.agent}`);

// 0. dana awal: 4 ETH -> WETH -> USDG
await tx(T.ETH.address, WETH, 'deposit', [], parseUnits('4', 18));
await tx(T.ETH.address, ERC20, 'approve', [MAINNET.router, maxUint256]);
await tx(MAINNET.router, ROUTER, 'exactInputSingle', [{ tokenIn: T.ETH.address, tokenOut: T.USDG.address, fee: 100, recipient: user.address, amountIn: parseUnits('4', 18), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }]);
const usdg0 = await bal('USDG');
check('user holds USDG from a real pool', usdg0 > 5000, `${usdg0.toFixed(2)} USDG`);

// 1. basket dalam satu transaksi (sama seperti web/wallet.js)
await tx(T.USDG.address, ERC20, 'approve', [MAINNET.router, parseUnits('3000', 6)]);
const legs = [['NVDA', 50], ['TSLA', 30], ['QQQ', 20]];
const calls = legs.map(([s, w]) => encodeFunctionData({ abi: ROUTER, functionName: 'exactInputSingle', args: [{ tokenIn: T.USDG.address, tokenOut: T[s].address, fee: T[s].fee, recipient: user.address, amountIn: parseUnits(String(3000 * w / 100), 6), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }] }));
const block = await pub.getBlock();
await tx(MAINNET.router, ROUTER, 'multicall', [block.timestamp + 600n, calls]);
const pf1 = await portfolio(user.address);
const v = (s) => pf1.positions.find((p) => p.symbol === s).value;
check('basket bought in one transaction', v('NVDA') > 1400 && v('TSLA') > 850 && v('QQQ') > 550, legs.map(([s]) => `${s} $${v(s).toFixed(0)}`).join(' · '));

// 2. izin agent: approve + setAgent
for (const s of ['USDG', 'NVDA', 'TSLA', 'QQQ']) await tx(T[s].address, ERC20, 'approve', [onchain.agentContract, maxUint256]);
const expiry = block.timestamp + 7n * 86400n;
await tx(onchain.agentContract, AGENT_ABI, 'setAgent', [onchain.agent, 400n * 10n ** 6n, 2_000n * 10n ** 6n, expiry, 500, [T.NVDA.address, T.TSLA.address, T.QQQ.address]]);
const pol = await policyOf(user.address);
check('agent permission active on-chain', pol.active && pol.max_trade_usd === 400 && pol.tokens.length === 3, `per trade $${pol.max_trade_usd}, per day $${pol.max_day_usd}, tokens ${pol.tokens.join(',')}`);

// 3a. Weekend Shield (paksa jalan seolah terpicu): jual 50% tiap saham ke USDG, dibatasi $400/trade
saveRule(user.address, { type: 'shield', threshold_pct: 5, hedge_pct: 50, direction: 'down', cooldown_h: 6 });
const usdgBefore = await bal('USDG');
const r1 = await evaluate(user.address, { force: true, only: 'shield' });
const sh = r1.results.shield;
const ok1 = sh?.trades?.filter((t) => t.ok) || [];
check('shield executed agent trades', ok1.length === 3, ok1.map((t) => `${t.from}->${t.to} ${t.amount_in.toFixed(3)}`).join(' · ') || JSON.stringify(sh));
const usdgGain = (await bal('USDG')) - usdgBefore;
check('hedge proceeds landed in the user wallet as USDG', usdgGain > 900 && usdgGain <= 1200.5, `+${usdgGain.toFixed(2)} USDG (3 trades capped at $400)`);
const agentHolds = await pub.readContract({ address: T.USDG.address, abi: ERC20, functionName: 'balanceOf', args: [onchain.agentContract] });
check('contract holds nothing after trades', agentHolds === 0n);

// 3b. daily limit: $2,000/day, $1,200 used -> rebalancer can do at most ~$800 more today
saveRule(user.address, { type: 'rebalance', targets: { USDG: 20, NVDA: 40, TSLA: 20, QQQ: 20 }, band_pct: 2, min_interval_h: 1 });
const r2 = await evaluate(user.address, { force: true, only: 'rebalance' });
const rb = r2.results.rebalance;
const ok2 = (rb.trades || []).filter((t) => t.ok);
const blocked = (rb.trades || []).filter((t) => !t.ok);
const pol2 = await policyOf(user.address);
check('rebalancer traded within the daily limit', ok2.length > 0 && pol2.spent_today_usd <= 2000, `${ok2.length} ok, ${blocked.length} blocked${blocked[0] ? ` (${blocked[0].error})` : ''}, spent today $${pol2.spent_today_usd.toFixed(0)}`);

// 4. revoke: agent berhenti
await tx(onchain.agentContract, AGENT_ABI, 'revokeAgent', [onchain.agent]);
const r3 = await evaluate(user.address, { force: true });
check('after revoke the agent does nothing', Object.values(r3.results).every((x) => x.skipped), JSON.stringify(Object.fromEntries(Object.entries(r3.results).map(([k, x]) => [k, x.skipped]))));

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
