// Data pasar dari CoinGecko public API (https://docs.coingecko.com).
// Batas request versi gratis ketat, jadi semua request lewat satu antrean dengan jeda
// dan hasilnya di-cache. Kalau kena batas (429), data cache terakhir yang dipakai.
import { ASSETS, bySymbol } from './assets.js';

const BASE = 'https://api.coingecko.com/api/v3';
const GAP_MS = 2500;
const cache = new Map();
let queue = Promise.resolve();
let last = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchJson(path) {
  const job = queue.then(async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const headers = { accept: 'application/json' };
    if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
    const res = await fetch(BASE + path, { headers });
    if (res.status === 429) throw Object.assign(new Error('CoinGecko rate limit'), { status: 429 });
    if (!res.ok) throw Object.assign(new Error(`CoinGecko ${res.status}`), { status: res.status });
    return res.json();
  });
  queue = job.catch(() => {});
  return job;
}

async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return { ...hit.v, cached: true };
  if (hit?.pending) return hit.pending;
  const pending = load()
    .then((v) => { cache.set(key, { t: Date.now(), v }); return v; })
    .catch((err) => {
      if (hit?.v) { cache.set(key, { ...hit, pending: null }); return { ...hit.v, stale: true, staleReason: err.message }; }
      cache.delete(key);
      throw err;
    });
  cache.set(key, { ...(hit || {}), pending });
  return pending;
}

// Harga, perubahan, dan grafik 7 hari per jam untuk semua aset dalam satu request.
export function getMarkets() {
  return cached('markets', 60_000, async () => {
    const ids = ASSETS.map((a) => a.cg).join(',');
    const rows = await fetchJson(`/coins/markets?vs_currency=usd&ids=${ids}&sparkline=true&price_change_percentage=1h,24h,7d`);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const assets = ASSETS.map((a) => {
      const r = byId.get(a.cg);
      if (!r) return { ...a, missing: true };
      return {
        symbol: a.symbol, name: a.name, kind: a.kind, note: a.note,
        price: r.current_price,
        change1h: r.price_change_percentage_1h_in_currency,
        change24h: r.price_change_percentage_24h_in_currency,
        change7d: r.price_change_percentage_7d_in_currency,
        volume24h: r.total_volume,
        updated: r.last_updated,
        spark: r.sparkline_in_7d?.price || [],
      };
    });
    return { asOf: new Date().toISOString(), source: 'CoinGecko', assets };
  });
}

// Riwayat harga per jam (CoinGecko memberi data per jam untuk 2-90 hari).
export function getHistory(symbol, days = 14) {
  const a = bySymbol(symbol);
  if (!a) throw new Error(`Unknown symbol ${symbol}`);
  const d = Math.max(2, Math.min(90, Math.round(days)));
  return cached(`hist:${a.symbol}:${d}`, 10 * 60_000, async () => {
    const j = await fetchJson(`/coins/${a.cg}/market_chart?vs_currency=usd&days=${d}`);
    return { symbol: a.symbol, days: d, prices: j.prices || [] };
  });
}
