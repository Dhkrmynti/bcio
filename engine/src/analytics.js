// Perhitungan inti engine: return, korelasi, pencarian jeda (lag), dan status bursa AS.

export function logReturns(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1], b = prices[i];
    out.push(a > 0 && b > 0 ? Math.log(b / a) : 0);
  }
  return out;
}

export function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 8) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sx += dx * dx; sy += dy * dy;
  }
  if (!sx || !sy) return null;
  return sxy / Math.sqrt(sx * sy);
}

// Gabungkan dua deret [timestamp, harga] per jam (bucket jam yang sama).
export function alignHourly(a, b) {
  const bucket = (pts) => {
    const m = new Map();
    for (const [t, p] of pts) m.set(Math.round(t / 3_600_000), p);
    return m;
  };
  const ma = bucket(a), mb = bucket(b);
  const hours = [...ma.keys()].filter((h) => mb.has(h)).sort((x, y) => x - y);
  return { hours, a: hours.map((h) => ma.get(h)), b: hours.map((h) => mb.get(h)) };
}

// Cari jeda (jam) yang membuat korelasi return paling tinggi.
// lag > 0  -> b bergerak SETELAH a (a memimpin).
export function lagScan(retA, retB, maxLag = 12) {
  const rows = [];
  for (let L = -maxLag; L <= maxLag; L++) {
    const x = [], y = [];
    for (let i = 0; i < retA.length; i++) {
      const j = i + L;
      if (j >= 0 && j < retB.length) { x.push(retA[i]); y.push(retB[j]); }
    }
    const c = pearson(x, y);
    if (c !== null) rows.push({ lag: L, corr: c });
  }
  const best = rows.reduce((p, r) => (!p || r.corr > p.corr ? r : p), null);
  const zero = rows.find((r) => r.lag === 0);
  return { best, zero, curve: rows };
}

export function volatility(ret) {
  if (ret.length < 2) return null;
  const m = ret.reduce((s, v) => s + v, 0) / ret.length;
  const v = ret.reduce((s, r) => s + (r - m) ** 2, 0) / (ret.length - 1);
  return Math.sqrt(v);
}

// Status NYSE/Nasdaq berdasarkan jam New York. Hari libur bursa belum dihitung.
export function marketStatus(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const day = parts.weekday;
  const mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const weekend = day === 'Sat' || day === 'Sun';
  let session = 'closed';
  if (!weekend) {
    if (mins >= 570 && mins < 960) session = 'regular';
    else if (mins >= 240 && mins < 570) session = 'pre-market';
    else if (mins >= 960 && mins < 1200) session = 'after-hours';
  }
  return {
    nyTime: `${day} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')} ET`,
    weekend,
    session,
    wallStreetOpen: session === 'regular',
    stockTokens: 'trading 24/7 on-chain',
    note: 'US exchange holidays are not accounted for yet.',
  };
}
