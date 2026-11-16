// Tool engine BCIO. Satu definisi dipakai dua kali:
//   - mcp.js   -> diekspos sebagai MCP server (bisa dipakai Claude Desktop / agent lain)
//   - agent.js -> dipakai langsung oleh agent terminal lewat Claude API
// `group` menandai "MCP server" mana yang memiliki tool itu (ditampilkan di UI).
import { z } from 'zod';
import { ASSETS, SYMBOLS, bySymbol } from './assets.js';
import { getMarkets, getHistory } from './market.js';
import { logReturns, pearson, alignHourly, lagScan, volatility, marketStatus } from './analytics.js';
import { onchain, portfolio, policyOf, TRADABLE, USD } from './chain.js';

const LEGS = TRADABLE.filter((t) => t !== USD); // NVDA, TSLA, QQQ, ETH
const JURISDICTION = 'Robinhood stock tokens are not offered to US persons and are restricted in some other countries (incl. UK, Canada); the user must check they are eligible.';
import { ShieldRule, RebalanceRule, Targets, getRules, activity, evaluate } from './automation.js';

const Address = z.string().optional().describe('Wallet address; omit to use the wallet connected in the terminal');

const Sym = z.string().describe(`Asset symbol. One of: ${SYMBOLS.join(', ')}`);
const round = (v, d = 4) => (v === null || v === undefined || Number.isNaN(v) ? null : Number(v.toFixed(d)));

function quoteOf(a) {
  return {
    symbol: a.symbol, name: a.name, kind: a.kind,
    price: a.price, change1h_pct: round(a.change1h, 2), change24h_pct: round(a.change24h, 2), change7d_pct: round(a.change7d, 2),
    volume24h_usd: a.volume24h ? Math.round(a.volume24h) : null, updated: a.updated,
  };
}

export async function correlationMatrix() {
  const m = await getMarkets();
  const rows = m.assets.filter((a) => !a.missing && a.spark.length > 24);
  const rets = new Map(rows.map((a) => [a.symbol, logReturns(a.spark)]));
  const symbols = rows.map((a) => a.symbol);
  const matrix = symbols.map((s1) => symbols.map((s2) => round(pearson(rets.get(s1), rets.get(s2)), 3)));
  return { window: '7d hourly returns', symbols, matrix, asOf: m.asOf, stale: !!m.stale };
}

export const TOOLS = [
  {
    name: 'get_quotes',
    group: 'tradfi',
    description: 'Latest price, 1h/24h/7d change and 24h volume for stock tokens (Robinhood tokenized NVDA, TSLA, QQQ, trading 24/7) and crypto (BTC, ETH, SOL, AI altcoins). Omit symbols to get the whole watchlist.',
    schema: z.object({ symbols: z.array(Sym).optional().describe('Symbols to fetch; omit for all') }),
    async run({ symbols }) {
      const m = await getMarkets();
      const want = symbols?.length ? new Set(symbols.map((s) => s.toUpperCase())) : null;
      const unknown = symbols?.filter((s) => !bySymbol(s)) || [];
      return {
        asOf: m.asOf, source: m.source, stale: !!m.stale,
        quotes: m.assets.filter((a) => !a.missing && (!want || want.has(a.symbol))).map(quoteOf),
        ...(unknown.length ? { unknown_symbols: unknown } : {}),
      };
    },
  },
  {
    name: 'market_status',
    group: 'tradfi',
    description: 'Whether US exchanges (NYSE/Nasdaq) are open right now, the session (pre-market, regular, after-hours, closed) and whether it is the weekend. Stock tokens keep trading 24/7 on-chain either way.',
    schema: z.object({}),
    async run() { return marketStatus(); },
  },
  {
    name: 'correlate',
    group: 'crypto',
    description: 'Cross-asset correlation engine. Correlates hourly returns of two assets over a window, scans lags in hours to find which one leads, and reports correlation at lag 0, the best lag and its correlation, volatility, and the number of aligned hours. Use for questions like "does BTC follow NVDA" or "which AI coin moves with NVDA".',
    schema: z.object({
      a: Sym, b: Sym,
      days: z.number().int().min(2).max(90).optional().describe('Window in days (default 14)'),
      max_lag_hours: z.number().int().min(0).max(48).optional().describe('Largest lag to scan in hours (default 12)'),
    }),
    async run({ a, b, days = 14, max_lag_hours = 12 }) {
      const A = bySymbol(a), B = bySymbol(b);
      if (!A || !B) throw new Error(`Unknown symbol. Use one of ${SYMBOLS.join(', ')}`);
      const [ha, hb] = [await getHistory(A.symbol, days), await getHistory(B.symbol, days)];
      const al = alignHourly(ha.prices, hb.prices);
      const ra = logReturns(al.a), rb = logReturns(al.b);
      const scan = lagScan(ra, rb, max_lag_hours);
      const best = scan.best;
      let leader = 'neither (moves together)';
      if (best && best.lag > 0) leader = `${A.symbol} leads ${B.symbol} by ~${best.lag}h`;
      if (best && best.lag < 0) leader = `${B.symbol} leads ${A.symbol} by ~${-best.lag}h`;
      const pct = (arr) => (arr.length > 1 ? round((arr[arr.length - 1] / arr[0] - 1) * 100, 2) : null);
      return {
        pair: `${A.symbol}/${B.symbol}`, window_days: ha.days, aligned_hours: al.hours.length,
        corr_lag0: round(scan.zero?.corr, 3),
        best_lag_hours: best?.lag ?? null, corr_best_lag: round(best?.corr, 3),
        leader,
        move_pct: { [A.symbol]: pct(al.a), [B.symbol]: pct(al.b) },
        hourly_vol_pct: { [A.symbol]: round((volatility(ra) || 0) * 100, 3), [B.symbol]: round((volatility(rb) || 0) * 100, 3) },
        lag_convention: `lag L (hours) pairs ${A.symbol} at hour t with ${B.symbol} at hour t+L; L > 0 means ${B.symbol} moves after ${A.symbol}`,
        lag_curve: scan.curve.map((r) => ({ lag: r.lag, corr: round(r.corr, 3) })),
        stale: !!(ha.stale || hb.stale),
        caveat: 'Correlation on past hourly returns; it can break at any time. Not financial advice.',
      };
    },
  },
  {
    name: 'correlation_matrix',
    group: 'crypto',
    description: 'Correlation matrix of 7-day hourly returns across the whole watchlist (stock tokens and crypto). Good first look to find which crypto moves with which stock.',
    schema: z.object({}),
    async run() { return correlationMatrix(); },
  },
  {
    name: 'weekend_shield',
    group: 'crypto',
    description: 'Weekend / after-hours volatility check. When Wall Street is closed, flags large 24h moves in BTC/ETH/SOL and lists the stock tokens most correlated with BTC that may gap at the next open.',
    schema: z.object({ threshold_pct: z.number().min(0.5).max(50).optional().describe('Absolute 24h move that triggers an alert (default 5)') }),
    async run({ threshold_pct = 5 }) {
      const [m, mx] = [await getMarkets(), await correlationMatrix()];
      const status = marketStatus();
      const crypto = m.assets.filter((a) => a.kind === 'crypto' && ['BTC', 'ETH', 'SOL'].includes(a.symbol));
      const movers = crypto.filter((a) => Math.abs(a.change24h || 0) >= threshold_pct).map(quoteOf);
      const bi = mx.symbols.indexOf('BTC');
      const exposed = mx.symbols
        .map((s, i) => ({ symbol: s, corr_with_btc: bi >= 0 ? mx.matrix[bi][i] : null, kind: bySymbol(s)?.kind }))
        .filter((r) => r.kind === 'stock')
        .sort((x, y) => (y.corr_with_btc ?? 0) - (x.corr_with_btc ?? 0));
      return {
        market: status,
        alert: !status.wallStreetOpen && movers.length > 0,
        threshold_pct, crypto_movers: movers, crypto_24h: crypto.map(quoteOf),
        stock_tokens_by_btc_correlation: exposed,
      };
    },
  },
  {
    name: 'propose_basket',
    group: 'execution',
    description: `Build a cross-asset basket proposal (stock tokens + crypto) for the user to review. Prices each leg at the latest quote and lays out the route. It does NOT execute: the user approves and signs it with their own wallet in the right panel, and it swaps REAL tokens on Robinhood Chain mainnet through Uniswap v3. Tradable legs: ${LEGS.join(', ')}, paid in USDG. BTC, SOL and the AI coins can be analysed but are not tradable on-chain here.`,
    schema: z.object({
      amount_usdg: z.number().positive().max(1_000_000).describe('Total size in USDG (dollars)'),
      source_chain: z.enum(['robinhood', 'solana', 'base', 'ethereum', 'arbitrum']).optional().describe('Where the dollars are now (default robinhood)'),
      legs: z.array(z.object({ symbol: Sym, weight_pct: z.number().positive().max(100) })).min(1).max(8),
      condition: z.string().max(300).optional().describe('Trigger condition in plain words, if any, e.g. "only if TSLA beats earnings and BTC holds 60k"'),
      rationale: z.string().max(600).optional().describe('One or two sentences on why this basket'),
    }),
    async run({ amount_usdg, source_chain = 'robinhood', legs, condition, rationale }) {
      const total = legs.reduce((s, l) => s + l.weight_pct, 0);
      if (Math.abs(total - 100) > 0.5) throw new Error(`Weights must sum to 100 (got ${total})`);
      const m = await getMarkets();
      const priced = legs.map((l) => {
        const a = m.assets.find((x) => x.symbol === l.symbol.toUpperCase());
        if (!a || a.missing) throw new Error(`No quote for ${l.symbol}`);
        const usd = (amount_usdg * l.weight_pct) / 100;
        return {
          symbol: a.symbol, kind: a.kind, weight_pct: l.weight_pct, usd: round(usd, 2), price: a.price,
          est_units: round(usd / a.price, 6),
          venue: LEGS.includes(a.symbol) ? `Uniswap v3, ${onchain.chainName}` : 'not tradable on-chain here',
        };
      });
      const route = [];
      if (source_chain !== 'robinhood') {
        route.push(`Bring ${amount_usdg} dollars from ${source_chain} to Robinhood Chain as USDG first (bridge or Robinhood Wallet); BCIO does not bridge for you`);
      }
      priced.forEach((p) => route.push(`Swap ${p.usd} USDG -> ${p.symbol} (${p.venue})`));
      const untradable = priced.filter((p) => !LEGS.includes(p.symbol)).map((p) => p.symbol);
      return {
        id: `bkt_${Date.now().toString(36)}`,
        status: 'proposal',
        execution: untradable.length
          ? `Not executable as-is: ${untradable.join(', ')} are not tradable on-chain here (tradable: ${LEGS.join(', ')}).`
          : `Ready: the user reviews and signs it with their own wallet in the right panel. Real tokens on ${onchain.chainName} mainnet, swapped on Uniswap v3.`,
        executable: untradable.length === 0,
        eligibility: JURISDICTION,
        amount_usdg, source_chain, condition: condition || null, rationale: rationale || null,
        legs: priced, route, priced_at: m.asOf,
      };
    },
  },

  {
    name: 'get_portfolio',
    group: 'execution',
    description: `On-chain holdings of a wallet on Robinhood Chain mainnet (${TRADABLE.join(', ')}; ETH means WETH), valued at Chainlink prices, with weights.`,
    schema: z.object({ address: Address }),
    async run({ address }, ctx) {
      return portfolio(address || ctx.address);
    },
  },
  {
    name: 'get_automation',
    group: 'execution',
    description: 'The wallet\'s automation state: the agent permission on-chain (limits, expiry, spent today), active rules (weekend shield, rebalancer) and recent automatic trades.',
    schema: z.object({ address: Address }),
    async run({ address }, ctx) {
      const a = address || ctx.address;
      return { policy: await policyOf(a), rules: getRules(a), recent_activity: activity(a, 10) };
    },
  },
  {
    name: 'draft_shield_rule',
    group: 'execution',
    description: 'Phase 2. Draft a Weekend / after-hours Volatility Shield rule: while Wall Street is closed, if BTC, ETH or SOL moves past threshold_pct in 24h, the agent sells hedge_pct of each stock token position (NVDA, TSLA, QQQ) to USDG on Uniswap, with REAL tokens on Robinhood Chain mainnet. Only drafts it: the user activates it in the right panel by granting an on-chain permission and signing, and the contract enforces the limits.',
    schema: ShieldRule.omit({ type: true }).extend({
      max_trade_usd: z.number().positive().max(1_000_000).describe('Suggested on-chain per-trade limit for the agent'),
      max_day_usd: z.number().positive().max(10_000_000).describe('Suggested on-chain daily limit'),
      days_valid: z.number().int().min(1).max(90).describe('Suggested permission length in days'),
      max_deviation_pct: z.number().min(0.5).max(20).describe('Max price gap from Chainlink the agent may accept. Stock feeds pause on weekends, so a shield usually needs 3-8%'),
    }),
    async run({ max_trade_usd, max_day_usd, days_valid, max_deviation_pct, ...rule }) {
      return { draft: { type: 'shield', ...rule }, policy: { max_trade_usd, max_day_usd, days_valid, max_deviation_pct, tokens: ['NVDA', 'TSLA', 'QQQ'] }, needs: 'User grants the on-chain permission and signs the rule in the right panel' };
    },
  },
  {
    name: 'draft_rebalance_rule',
    group: 'execution',
    description: `Phase 3. Draft an automatic rebalancer: target weights in percent across ${TRADABLE.join(', ')} (sum 100). When any weight drifts more than band_pct points, the agent sells the overweight legs to USDG and buys the underweight ones, with REAL tokens on Robinhood Chain mainnet. Only drafts it: the user activates it by granting an on-chain permission and signing.`,
    schema: z.object({
      targets: Targets,
      band_pct: z.number().min(1).max(30),
      min_interval_h: z.number().min(0.25).max(168),
      max_trade_usd: z.number().positive().max(1_000_000),
      max_day_usd: z.number().positive().max(10_000_000),
      days_valid: z.number().int().min(1).max(90),
      max_deviation_pct: z.number().min(0.5).max(20).describe('Max price gap from Chainlink the agent may accept (1-3% is typical)'),
    }),
    async run({ max_trade_usd, max_day_usd, days_valid, max_deviation_pct, ...rule }) {
      const draft = RebalanceRule.parse({ type: 'rebalance', ...rule });
      const tokens = Object.entries(draft.targets).filter(([k, v]) => k !== USD && v > 0).map(([k]) => k);
      return { draft, policy: { max_trade_usd, max_day_usd, days_valid, max_deviation_pct, tokens }, needs: 'User grants the on-chain permission and signs the rule in the right panel' };
    },
  },
  {
    name: 'run_automation_now',
    group: 'execution',
    description: 'Evaluate the wallet\'s active rules right now (instead of waiting for the next minute). Trades only if a rule\'s conditions are met and only within the on-chain permission.',
    schema: z.object({ address: Address }),
    async run({ address }, ctx) { return evaluate(address || ctx.address); },
  },
];

export const toolByName = (n) => TOOLS.find((t) => t.name === n);

// Jalankan tool dengan validasi input (input dari model diperlakukan sebagai data tak tepercaya).
export async function runTool(name, input, ctx = {}) {
  const t = toolByName(name);
  if (!t) return { ok: false, error: `Unknown tool ${name}` };
  const parsed = t.schema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  try {
    return { ok: true, result: await t.run(parsed.data, ctx) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export { ASSETS };
