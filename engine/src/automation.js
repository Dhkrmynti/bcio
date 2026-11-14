// Fase 2 & 3: aturan otomatis per wallet.
//   shield    : Weekend / after-hours Volatility Shield. Saat Wall Street tutup dan kripto
//               bergerak melewati ambang, agent menjual sebagian token saham ke tUSDC.
//   rebalance : jaga target bobot portofolio; rebalance saat penyimpangan melewati band.
// Aturan disimpan di engine/data/rules.json dan hanya bisa dibuat dengan tanda tangan wallet.
// Setiap trade lewat BcioDesk.executeFor, jadi batas policy on-chain tetap berlaku.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getMarkets } from './market.js';
import { marketStatus } from './analytics.js';
import { onchain, pushPrices, portfolio, policyOf, agentSwap, toUnits, checkAddress, TRADABLE, STOCKS, txUrl } from './chain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, '../data');
const RULES = path.join(DATA, 'rules.json');
const ACTIVITY = path.join(DATA, 'activity.json');

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

// ---------------------------------------------------------------- schema aturan
export const ShieldRule = z.object({
  type: z.literal('shield'),
  threshold_pct: z.number().min(2).max(30).describe('24h move in BTC/ETH/SOL that triggers the shield'),
  hedge_pct: z.number().min(5).max(100).describe('Percent of each stock token position to sell to tUSDC'),
  direction: z.enum(['down', 'any']).describe('Trigger on drops only, or on moves either way'),
  cooldown_h: z.number().min(1).max(168).describe('Hours before the shield can fire again'),
});
export const Targets = z.partialRecord(z.enum(TRADABLE), z.number().min(0).max(100)).describe('Target weights in percent (USDC, NVDA, TSLA, QQQ, BTC, ETH, SOL), must sum to 100');
export const RebalanceRule = z.object({
  type: z.literal('rebalance'),
  targets: Targets,
  band_pct: z.number().min(1).max(30).describe('Rebalance when any weight drifts this many points from target'),
  min_interval_h: z.number().min(0.25).max(168).describe('Minimum hours between rebalances'),
}).refine((r) => Math.abs(Object.values(r.targets).reduce((a, b) => a + b, 0) - 100) < 0.5, 'targets must sum to 100');
export const Rule = z.union([ShieldRule, RebalanceRule]);

export function getRules(address) {
  const all = readJson(RULES, {});
  return all[checkAddress(address)] || {};
}

export function ruleMessage(address, rule, issued) {
  return `BCIO automation rule\naddress: ${checkAddress(address)}\nrule: ${JSON.stringify(rule)}\nissued: ${issued}`;
}

export function saveRule(address, rule, enabled = true) {
  const a = checkAddress(address);
  const all = readJson(RULES, {});
  all[a] ||= {};
  if (!enabled) { if (all[a][rule.type]) all[a][rule.type].enabled = false; }
  else all[a][rule.type] = { ...Rule.parse(rule), enabled: true, created_at: new Date().toISOString(), last_run: null };
  writeJson(RULES, all);
  log(a, { type: rule.type, status: 'info', text: enabled ? `${rule.type} rule activated` : `${rule.type} rule turned off` });
  return all[a];
}

function markRun(address, type) {
  const all = readJson(RULES, {});
  if (all[address]?.[type]) { all[address][type].last_run = new Date().toISOString(); writeJson(RULES, all); }
}

export function log(address, entry) {
  const all = readJson(ACTIVITY, []);
  all.unshift({ at: new Date().toISOString(), address, ...entry });
  writeJson(ACTIVITY, all.slice(0, 300));
}
export const activity = (address, n = 20) => readJson(ACTIVITY, []).filter((e) => e.address === checkAddress(address)).slice(0, n);

// ---------------------------------------------------------------- eksekusi
async function trade(address, from, to, amount, trades) {
  const units = toUnits(from, amount);
  if (units <= 0n) return;
  try {
    const t = await agentSwap(address, from, to, units);
    trades.push({ ...t, tx_url: txUrl(t.hash), ok: true });
  } catch (err) {
    trades.push({ from, to, amount_in: amount, ok: false, error: explainRevert(err) });
  }
}

// Ubah revert kontrak menjadi alasan yang bisa dibaca
function explainRevert(err) {
  const rev = err.walk?.((e) => e?.name === 'ContractFunctionRevertedError');
  const name = rev?.data?.errorName;
  const args = rev?.data?.args || [];
  const usd = (v) => `$${(Number(v) / 1e8).toFixed(0)}`;
  switch (name) {
    case 'OverDayLimit': return `on-chain daily limit reached (${usd(args[0])} > ${usd(args[1])})`;
    case 'OverTradeLimit': return `on-chain per-trade limit (${usd(args[0])} > ${usd(args[1])})`;
    case 'PolicyExpired': return 'agent permission expired';
    case 'NoPolicy': return 'no agent permission';
    case 'StalePrice': return 'oracle price is stale';
    case 'Slippage': return 'price moved past the 1% slippage guard';
    default: return name || (err.shortMessage || err.message).split('\n')[0];
  }
}

const sinceH = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 3600_000 : Infinity);

async function runShield(address, rule, m, status, pol, { force }) {
  if (!force && status.wallStreetOpen) return { skipped: 'Wall Street is open' };
  if (!force && sinceH(rule.last_run) < rule.cooldown_h) return { skipped: `cooldown (${rule.cooldown_h}h)` };
  const moves = m.assets.filter((a) => ['BTC', 'ETH', 'SOL'].includes(a.symbol)).map((a) => ({ symbol: a.symbol, change24h: a.change24h }));
  const hit = moves.filter((x) => (rule.direction === 'down' ? x.change24h <= -rule.threshold_pct : Math.abs(x.change24h) >= rule.threshold_pct));
  if (!hit.length) return { skipped: `no crypto move past ${rule.threshold_pct}%` };
  const pf = await portfolio(address, m);
  const trades = [];
  for (const p of pf.positions.filter((x) => STOCKS.includes(x.symbol) && x.value > 1)) {
    let amt = (p.amount * rule.hedge_pct) / 100;
    if (amt * p.price > pol.max_trade_usd) amt = (pol.max_trade_usd * 0.995) / p.price; // policy per-trade cap
    await trade(address, p.symbol, 'USDC', amt, trades);
  }
  const why = `${hit.map((h) => `${h.symbol} ${h.change24h.toFixed(1)}%`).join(', ')} in 24h while Wall Street is ${status.weekend ? 'out for the weekend' : status.session}`;
  return { fired: true, why, trades };
}

async function runRebalance(address, rule, m, pol, { force }) {
  if (!force && sinceH(rule.last_run) < rule.min_interval_h) return { skipped: `min interval (${rule.min_interval_h}h)` };
  const pf = await portfolio(address, m);
  if (pf.total_usd < 10) return { skipped: 'portfolio is empty' };
  const drift = TRADABLE.map((s) => {
    const p = pf.positions.find((x) => x.symbol === s);
    return { symbol: s, weight: p.weight_pct, target: rule.targets[s] || 0, value: p.value, amount: p.amount, price: p.price };
  });
  const worst = drift.reduce((a, d) => Math.max(a, Math.abs(d.weight - d.target)), 0);
  if (worst < rule.band_pct) return { skipped: `max drift ${worst.toFixed(1)} pts < band ${rule.band_pct}` };
  const trades = [];
  const cap = (usd) => Math.min(usd, pol.max_trade_usd * 0.995);
  // jual yang kelebihan dulu, lalu beli yang kurang dengan tUSDC
  for (const d of drift.filter((x) => x.symbol !== 'USDC' && x.weight > x.target)) {
    const usd = cap(((d.weight - d.target) / 100) * pf.total_usd);
    if (usd > 1) await trade(address, d.symbol, 'USDC', usd / d.price, trades);
  }
  for (const d of drift.filter((x) => x.symbol !== 'USDC' && x.weight < x.target)) {
    const usd = cap(((d.target - d.weight) / 100) * pf.total_usd);
    if (usd > 1) await trade(address, 'USDC', d.symbol, usd, trades);
  }
  return { fired: true, why: `max drift ${worst.toFixed(1)} pts ≥ band ${rule.band_pct}`, trades };
}

// Satu evaluasi per wallet pada satu waktu: loop otomatis dan pemicu manual (agent/UI)
// tidak boleh menjalankan aturan yang sama dua kali sebelum last_run tercatat.
const locks = new Map();
export function evaluate(address, opts = {}) {
  if (!onchain.enabled) throw new Error(`On-chain execution is off: ${onchain.reason}`);
  const a = checkAddress(address);
  const prev = locks.get(a) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => evaluateNow(a, opts));
  locks.set(a, run);
  run.finally(() => { if (locks.get(a) === run) locks.delete(a); }).catch(() => {});
  return run;
}

async function evaluateNow(a, { force = false, only = null } = {}) {
  const rules = getRules(a); // dibaca setelah kunci didapat, jadi last_run sudah terbaru
  const m = await getMarkets();
  await pushPrices(m).catch((e) => console.error('[oracle]', e.shortMessage || e.message));
  const status = marketStatus();
  const pol = await policyOf(a);
  const results = {};
  for (const type of ['shield', 'rebalance']) {
    const rule = rules[type];
    if (!rule?.enabled || (only && only !== type)) continue;
    if (!pol.active) { results[type] = { skipped: 'agent permission is not active on-chain' }; continue; }
    const r = type === 'shield' ? await runShield(a, rule, m, status, pol, { force }) : await runRebalance(a, rule, m, pol, { force });
    results[type] = r;
    if (r.fired) {
      markRun(a, type);
      const ok = r.trades.filter((t) => t.ok).length;
      log(a, { type, status: ok === r.trades.length ? 'executed' : ok ? 'partial' : 'blocked', text: r.why, trades: r.trades });
    }
  }
  return { address: a, market: status, policy: pol, results };
}

// loop: harga oracle + semua aturan aktif, tiap menit
let running = false;
export function startLoop(intervalMs = 60_000) {
  if (!onchain.enabled) { console.log(`[automation] off: ${onchain.reason}`); return; }
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const m = await getMarkets();
      await pushPrices(m).catch((e) => console.error('[oracle]', e.shortMessage || e.message));
      const all = readJson(RULES, {});
      for (const addr of Object.keys(all)) {
        if (!Object.values(all[addr]).some((r) => r.enabled)) continue;
        await evaluate(addr).catch((e) => console.error('[automation]', addr, e.message));
      }
    } catch (e) {
      console.error('[automation]', e.message);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, intervalMs).unref?.();
  console.log(`[automation] on: ${onchain.chainName} (${onchain.chainId}), agent ${onchain.agent}`);
}
