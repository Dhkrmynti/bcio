// Lapisan eksekusi on-chain: BcioDesk di Robinhood Chain testnet (atau anvil lokal).
// Engine memegang key "keeper" yang (1) mengirim harga ke oracle desk dan (2) bertindak
// sebagai agent untuk user yang sudah memberi izin lewat desk.setAgent. Batas izin itu
// dijaga kontrak, bukan server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi, defineChain, formatUnits, getAddress, isAddress, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const here = path.dirname(fileURLToPath(import.meta.url));
const NETS = { local: 31337, testnet: 46630 };
export const TRADABLE = ['USDC', 'NVDA', 'TSLA', 'QQQ', 'BTC', 'ETH', 'SOL'];
export const STOCKS = ['NVDA', 'TSLA', 'QQQ'];
const decimalsOf = (sym) => (sym === 'USDC' ? 6 : 18);

export const DESK_ABI = parseAbi([
  'function setPrices(address[] ts, uint256[] pricesE8)',
  'function priceE8(address) view returns (uint256)',
  'function priceAt(address) view returns (uint256)',
  'function quote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256 out, uint256 valueUsd)',
  'function policies(address user, address agent) view returns (uint128 maxTradeUsd, uint128 maxDayUsd, uint64 expiry, uint64 day, uint128 spentToday)',
  'function executeFor(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) returns (uint256)',
  'function swapBasket(address tokenIn, uint256 amountIn, address[] tokensOut, uint16[] weightsBps, uint256[] minOuts) returns (uint256[])',
  'function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) returns (uint256)',
  'function setAgent(address agent, uint128 maxTradeUsd, uint128 maxDayUsd, uint64 expiry)',
  'function revokeAgent(address agent)',
  'function faucet()',
  'function lastFaucet(address) view returns (uint256)',
  'error NoPolicy()', 'error PolicyExpired()', 'error OverTradeLimit(uint256 valueUsd, uint256 limit)',
  'error OverDayLimit(uint256 spent, uint256 limit)', 'error StalePrice(address token)', 'error Slippage(uint256 out, uint256 minOut)',
  'error NotListed()', 'error ZeroAmount()', 'error SameToken()', 'error FaucetCooldown(uint256 nextAt)', 'error BadWeights()',
]);
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

function load() {
  const net = process.env.CHAIN;
  if (!net || !NETS[net]) return { enabled: false, reason: 'CHAIN is not set (local or testnet)' };
  const file = path.resolve(here, '../deployments', `${NETS[net]}.json`);
  if (!fs.existsSync(file)) return { enabled: false, reason: `No deployment for ${net}. Run contracts/deploy.sh ${net}` };
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) return { enabled: false, reason: 'KEEPER_PRIVATE_KEY is not set' };
  const account = privateKeyToAccount(key);
  const chain = defineChain({
    id: d.chainId,
    name: d.chainId === 46630 ? 'Robinhood Chain Testnet' : 'Local anvil',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [process.env.CHAIN_RPC || d.rpc] } },
    ...(d.explorer ? { blockExplorers: { default: { name: 'Explorer', url: d.explorer } } } : {}),
  });
  return {
    enabled: true, net, chain, deployment: d, account,
    pub: createPublicClient({ chain, transport: http() }),
    wallet: createWalletClient({ chain, account, transport: http() }),
  };
}

const C = load();
if (C.enabled && getAddress(C.account.address) !== getAddress(C.deployment.keeper)) {
  console.warn(`[chain] KEEPER_PRIVATE_KEY (${C.account.address}) is not the desk keeper (${C.deployment.keeper}); price updates will fail.`);
}

export const onchain = C.enabled
  ? {
      enabled: true, network: C.net, chainId: C.deployment.chainId, chainName: C.chain.name,
      rpc: C.deployment.rpc, explorer: C.deployment.explorer || null,
      desk: C.deployment.desk, agent: C.account.address, tokens: C.deployment.tokens,
    }
  : { enabled: false, reason: C.reason };

export function requireChain() {
  if (!C.enabled) throw new Error(`On-chain execution is off: ${C.reason}`);
}
export const tokenAddr = (sym) => C.deployment.tokens[sym];
export function checkAddress(a) {
  if (!a || !isAddress(a)) throw new Error('A valid wallet address is required (connect a wallet).');
  return getAddress(a);
}

// ---------------------------------------------------------------- oracle
let lastPush = 0;
export async function pushPrices(markets, { force = false } = {}) {
  requireChain();
  if (!force && Date.now() - lastPush < 50_000) return null;
  const px = { USDC: 1 };
  for (const a of markets.assets) if (TRADABLE.includes(a.symbol) && a.price) px[a.symbol] = a.price;
  const syms = TRADABLE.filter((s) => px[s]);
  const hash = await C.wallet.writeContract({
    address: C.deployment.desk, abi: DESK_ABI, functionName: 'setPrices',
    args: [syms.map(tokenAddr), syms.map((s) => BigInt(Math.round(px[s] * 1e8)))],
  });
  await C.pub.waitForTransactionReceipt({ hash });
  lastPush = Date.now();
  return { hash, symbols: syms };
}

// ---------------------------------------------------------------- reads
export async function portfolio(address, markets) {
  requireChain();
  const user = checkAddress(address);
  const bals = await Promise.all(TRADABLE.map((s) => C.pub.readContract({ address: tokenAddr(s), abi: ERC20_ABI, functionName: 'balanceOf', args: [user] })));
  const priceOf = (s) => (s === 'USDC' ? 1 : markets.assets.find((a) => a.symbol === s)?.price || 0);
  const positions = TRADABLE.map((s, i) => {
    const amount = Number(formatUnits(bals[i], decimalsOf(s)));
    return { symbol: s, kind: s === 'USDC' ? 'cash' : STOCKS.includes(s) ? 'stock' : 'crypto', token: `t${s}`, raw: bals[i].toString(), amount, price: priceOf(s), value: amount * priceOf(s) };
  });
  const total = positions.reduce((t, p) => t + p.value, 0);
  positions.forEach((p) => { p.weight_pct = total ? (p.value / total) * 100 : 0; });
  return { address: user, total_usd: total, positions, chainId: onchain.chainId };
}

export async function policyOf(address) {
  requireChain();
  const user = checkAddress(address);
  const [maxTradeUsd, maxDayUsd, expiry, day, spentToday] = await C.pub.readContract({ address: C.deployment.desk, abi: DESK_ABI, functionName: 'policies', args: [user, C.account.address] });
  const now = Math.floor(Date.now() / 1000);
  const today = Math.floor(now / 86400);
  return {
    agent: C.account.address,
    active: Number(expiry) > now,
    expires_at: Number(expiry) ? new Date(Number(expiry) * 1000).toISOString() : null,
    max_trade_usd: Number(maxTradeUsd) / 1e8,
    max_day_usd: Number(maxDayUsd) / 1e8,
    spent_today_usd: Number(day) === today ? Number(spentToday) / 1e8 : 0,
  };
}

// ---------------------------------------------------------------- agent trade
export async function agentSwap(user, symIn, symOut, amountIn) {
  requireChain();
  const u = checkAddress(user);
  const [out] = await C.pub.readContract({ address: C.deployment.desk, abi: DESK_ABI, functionName: 'quote', args: [tokenAddr(symIn), tokenAddr(symOut), amountIn] });
  const minOut = (out * 99n) / 100n; // 1% slippage guard
  const { request } = await C.pub.simulateContract({
    account: C.account, address: C.deployment.desk, abi: DESK_ABI, functionName: 'executeFor',
    args: [u, tokenAddr(symIn), tokenAddr(symOut), amountIn, minOut],
  });
  const hash = await C.wallet.writeContract(request);
  const rc = await C.pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return {
    hash, from: symIn, to: symOut,
    amount_in: Number(formatUnits(amountIn, decimalsOf(symIn))),
    amount_out: Number(formatUnits(out, decimalsOf(symOut))),
  };
}

export function toUnits(sym, amount) {
  const d = decimalsOf(sym);
  const [i, f = ''] = amount.toFixed(d).split('.');
  return BigInt(i + f.padEnd(d, '0').slice(0, d));
}

export function verifySignature(address, message, signature) {
  return verifyMessage({ address: checkAddress(address), message, signature });
}

export function txUrl(hash) {
  return onchain.explorer ? `${onchain.explorer}/tx/${hash}` : null;
}
