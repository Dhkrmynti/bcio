// Lapisan on-chain: Robinhood Chain MAINNET (4663).
//  - Harga: feed Chainlink resmi (dibaca langsung dari chain).
//  - Swap user (basket): Uniswap v3 SwapRouter02, ditandatangani wallet user di browser.
//  - Trade otomatis agent: kontrak BcioAgent (non-custodial). Server memegang key AGENT yang hanya
//    bisa bertindak dalam batas yang ditandatangani tiap user (per trade, per hari, token, expiry,
//    deviasi harga). Batas itu dijaga kontrak, bukan server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi, defineChain, formatUnits, getAddress, isAddress, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const here = path.dirname(fileURLToPath(import.meta.url));

// Alamat resmi (diverifikasi on-chain): docs.robinhood.com/chain, api.robinhood.com/rhj/assets,
// Uniswap deployments/json/4663.json, feed Chainlink (description()).
export const MAINNET = {
  chainId: 4663,
  name: 'Robinhood Chain',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  router: '0xCaf681a66D020601342297493863E78C959E5cb2', // Uniswap SwapRouter02
  quoter: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7', // Uniswap QuoterV2
  usd: 'USDG',
  tokens: {
    USDG: { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6, feed: '0x61B7e5650328764B076A108EFF5fa7282a1B9aD2' },
    NVDA: { address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', decimals: 18, feed: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15', fee: 500 },
    TSLA: { address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', decimals: 18, feed: '0x4A1166a659A55625345e9515b32adECea5547C38', fee: 3000 },
    QQQ: { address: '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', decimals: 18, feed: '0x80901d846d5D7B030F26B480776EE3b29374C2ae', fee: 500 },
    ETH: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', decimals: 18, feed: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9', fee: 100, token: 'WETH' },
  },
};
export const TRADABLE = Object.keys(MAINNET.tokens); // USDG, NVDA, TSLA, QQQ, ETH
export const STOCKS = ['NVDA', 'TSLA', 'QQQ'];
export const USD = MAINNET.usd;
const T = MAINNET.tokens;

export const AGENT_ABI = parseAbi([
  'function policies(address user, address agent) view returns (uint64 maxTradeUsd, uint64 maxDayUsd, uint64 expiry, uint32 day, uint16 maxDeviationBps, uint64 spentToday)',
  'function allowedToken(address user, address agent, address token) view returns (bool)',
  'function executeFor(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) returns (uint256)',
  'function setAgent(address agent, uint64 maxTradeUsd, uint64 maxDayUsd, uint64 expiry, uint16 maxDeviationBps, address[] allowTokens)',
  'function revokeAgent(address agent)',
  'error NoPolicy()', 'error PolicyExpired()', 'error BadPolicy()', 'error OverTradeLimit(uint256 valueUsd, uint256 limit)',
  'error OverDayLimit(uint256 spent, uint256 limit)', 'error StalePrice(address token, uint256 updatedAt)', 'error NotListed(address token)',
  'error TokenNotAllowed(address token)', 'error NotUsdPair()', 'error ZeroAmount()', 'error TransferFailed()', 'error BadFeed(address token)',
]);
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address owner, address spender) view returns (uint256)']);
const FEED_ABI = parseAbi(['function latestRoundData() view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)', 'function decimals() view returns (uint8)']);
const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

function load() {
  const rpc = process.env.CHAIN_RPC || MAINNET.rpc; // CHAIN_RPC: mis. anvil --fork-url untuk uji lokal
  const chain = defineChain({
    id: MAINNET.chainId, name: MAINNET.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: 'Blockscout', url: MAINNET.explorer } },
  });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const file = process.env.DEPLOYMENT_FILE || path.resolve(here, '../deployments/4663.json');
  const d = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const key = process.env.AGENT_PRIVATE_KEY;
  let automation = { on: false, reason: 'the BCIO agent contract is not deployed yet' };
  if (d?.agentContract && !key) automation = { on: false, reason: 'AGENT_PRIVATE_KEY is not set' };
  let account = null, wallet = null;
  if (d?.agentContract && key) {
    account = privateKeyToAccount(key);
    if (d.agent && getAddress(d.agent) !== account.address) console.warn(`[chain] AGENT_PRIVATE_KEY is ${account.address}, deployment expects ${d.agent}`);
    wallet = createWalletClient({ chain, account, transport: http(rpc) });
    automation = { on: true };
  }
  return { chain, pub, rpc, deployment: d, account, wallet, automation };
}

const C = load();

export const onchain = {
  enabled: true,
  chainId: MAINNET.chainId, chainName: MAINNET.name,
  rpc: process.env.PUBLIC_RPC || MAINNET.rpc, explorer: MAINNET.explorer, // RPC yang dipakai browser
  router: MAINNET.router, quoter: MAINNET.quoter, usd: USD,
  tokens: Object.fromEntries(Object.entries(T).map(([s, t]) => [s, { address: t.address, decimals: t.decimals, fee: t.fee ?? null, token: t.token || s }])),
  agentContract: C.deployment?.agentContract || null,
  agent: C.account?.address || C.deployment?.agent || null,
  automation: C.automation.on,
  automationReason: C.automation.reason || null,
};

export function requireAutomation() {
  if (!C.automation.on) throw new Error(`Automation is off: ${C.automation.reason}`);
}
export const tokenAddr = (sym) => T[sym].address;
export function checkAddress(a) {
  if (!a || !isAddress(a)) throw new Error('A valid wallet address is required (connect a wallet).');
  return getAddress(a);
}

// ---------------------------------------------------------------- harga Chainlink
let pxCache = { at: 0, data: null };
export async function oraclePrices() {
  if (pxCache.data && Date.now() - pxCache.at < 30_000) return pxCache.data;
  const rows = await Promise.all(TRADABLE.map(async (s) => {
    const [, answer, , updatedAt] = await C.pub.readContract({ address: T[s].feed, abi: FEED_ABI, functionName: 'latestRoundData' });
    return [s, { price: Number(answer) / 1e8, updated_at: new Date(Number(updatedAt) * 1000).toISOString() }];
  }));
  pxCache = { at: Date.now(), data: Object.fromEntries(rows) };
  return pxCache.data;
}

// ---------------------------------------------------------------- reads
export async function portfolio(address) {
  const user = checkAddress(address);
  const [bals, px] = await Promise.all([
    Promise.all(TRADABLE.map((s) => C.pub.readContract({ address: T[s].address, abi: ERC20_ABI, functionName: 'balanceOf', args: [user] }))),
    oraclePrices(),
  ]);
  const positions = TRADABLE.map((s, i) => {
    const amount = Number(formatUnits(bals[i], T[s].decimals));
    const price = px[s].price;
    return { symbol: s, kind: s === USD ? 'cash' : STOCKS.includes(s) ? 'stock' : 'crypto', token: T[s].token || s, raw: bals[i].toString(), amount, price, value: amount * price };
  });
  const total = positions.reduce((t, p) => t + p.value, 0);
  positions.forEach((p) => { p.weight_pct = total ? (p.value / total) * 100 : 0; });
  return { address: user, total_usd: total, positions, chainId: MAINNET.chainId, priced_by: 'Chainlink' };
}

export async function policyOf(address) {
  const user = checkAddress(address);
  if (!onchain.agentContract || !onchain.agent) return { agent: null, active: false, reason: C.automation.reason };
  const [maxTradeUsd, maxDayUsd, expiry, day, maxDeviationBps, spentToday] = await C.pub.readContract({
    address: onchain.agentContract, abi: AGENT_ABI, functionName: 'policies', args: [user, onchain.agent],
  });
  const tradable = TRADABLE.filter((s) => s !== USD);
  const allowed = await Promise.all(tradable.map((s) => C.pub.readContract({ address: onchain.agentContract, abi: AGENT_ABI, functionName: 'allowedToken', args: [user, onchain.agent, T[s].address] })));
  const allowances = await Promise.all(TRADABLE.map((s) => C.pub.readContract({ address: T[s].address, abi: ERC20_ABI, functionName: 'allowance', args: [user, onchain.agentContract] })));
  const now = Math.floor(Date.now() / 1000);
  const today = Math.floor(now / 86400);
  return {
    agent: onchain.agent,
    contract: onchain.agentContract,
    active: Number(expiry) > now,
    expires_at: Number(expiry) ? new Date(Number(expiry) * 1000).toISOString() : null,
    max_trade_usd: Number(maxTradeUsd) / 1e6,
    max_day_usd: Number(maxDayUsd) / 1e6,
    max_deviation_pct: Number(maxDeviationBps) / 100,
    spent_today_usd: Number(day) === today ? Number(spentToday) / 1e6 : 0,
    tokens: tradable.filter((_, i) => allowed[i]),
    approvals: Object.fromEntries(TRADABLE.map((s, i) => [s, allowances[i] > 0n])),
  };
}

// ---------------------------------------------------------------- kuotasi Uniswap
export async function quote(symIn, symOut, amountIn) {
  const fee = (symIn === USD ? T[symOut] : T[symIn]).fee;
  const { result } = await C.pub.simulateContract({
    address: MAINNET.quoter, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: T[symIn].address, tokenOut: T[symOut].address, amountIn, fee, sqrtPriceLimitX96: 0n }],
  });
  return result[0];
}

// ---------------------------------------------------------------- trade agent
export async function agentSwap(user, symIn, symOut, amountIn) {
  requireAutomation();
  const u = checkAddress(user);
  const out = await quote(symIn, symOut, amountIn);
  const minOut = (out * 995n) / 1000n; // 0.5% dari kuotasi; kontrak juga menjaga batas Chainlink milik user
  const { request } = await C.pub.simulateContract({
    account: C.account, address: onchain.agentContract, abi: AGENT_ABI, functionName: 'executeFor',
    args: [u, T[symIn].address, T[symOut].address, amountIn, minOut],
  });
  const hash = await C.wallet.writeContract(request);
  const rc = await C.pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return {
    hash, from: symIn, to: symOut,
    amount_in: Number(formatUnits(amountIn, T[symIn].decimals)),
    amount_out: Number(formatUnits(out, T[symOut].decimals)),
  };
}

export function toUnits(sym, amount) {
  const d = T[sym].decimals;
  const [i, f = ''] = amount.toFixed(d).split('.');
  return BigInt(i + f.padEnd(d, '0').slice(0, d));
}

export function verifySignature(address, message, signature) {
  return verifyMessage({ address: checkAddress(address), message, signature });
}

export const txUrl = (hash) => `${MAINNET.explorer}/tx/${hash}`;
