// BCIO terminal (browser). Data & agent berasal dari engine lokal (engine/src/server.js).
import { W, API, initWallet, refreshAll, executeBasket, setDraft, eligibilityBox } from './wallet.js?v=5';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtPx = (p) => (p == null ? '–' : p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toFixed(4));
const fmtPct = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
// ikon starburst yang sama dengan landing
const RAYS = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2, r = i % 2 ? 42 : 49, w = 0.11;
  const p = (ang, rad) => `${(Math.cos(ang) * rad).toFixed(2)} ${(Math.sin(ang) * rad).toFixed(2)}`;
  return `M${p(a - w, 9)}L${p(a, r)}L${p(a + w, 9)}Z`;
}).join('');
document.querySelectorAll('svg.burst').forEach((s) => { s.innerHTML = `<path d="${RAYS}" fill="currentColor"/><circle r="12" fill="currentColor"/>`; });

const GROUP = { tradfi: 'TradFi MCP', crypto: 'Crypto MCP', execution: 'Execution MCP' };

// satu sesi agent per halaman: riwayat chat di layar = riwayat di server
let session = newId();
let busy = false;
let lastWatch = null;

function newId() { return 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ---------------- jam & status ----------------
function tickClock() {
  const t = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
  $('#clock').textContent = `NY ${t}`;
}
setInterval(tickClock, 1000);
tickClock();

function renderStatus(m) {
  const el = $('#status');
  const open = m.wallStreetOpen;
  el.className = 'status ' + (open ? 'open' : 'closed');
  const label = open ? 'Wall Street open' : `Wall Street ${m.weekend ? 'closed (weekend)' : m.session === 'closed' ? 'closed' : m.session}`;
  el.querySelector('span').textContent = `${label} · stock tokens 24/7`;
}

// ---------------- watchlist ----------------
function spark(points, up) {
  if (!points?.length) return '';
  const lo = Math.min(...points), hi = Math.max(...points), n = points.length;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i / (n - 1) * 100).toFixed(1)} ${(24 - ((p - lo) / (hi - lo || 1)) * 22).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? '#2e7d43' : '#c0442f'}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}

async function loadWatch() {
  try {
    const r = await fetch(API + '/api/watchlist');
    if (!r.ok) throw new Error((await r.json()).error);
    const w = await r.json();
    lastWatch = w;
    renderStatus(w.market);
    $('#src').textContent = `CoinGecko · ${new Date(w.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${w.stale ? ' · stale' : ''}`;
    $('#watch').innerHTML = w.assets.filter((a) => !a.missing).map((a) => `
      <li data-sym="${esc(a.symbol)}" title="${esc(a.name)}${a.note ? ' · ' + esc(a.note) : ''}">
        <span class="sym">${esc(a.symbol)}<small class="${a.kind === 'stock' ? 'stk' : ''}">${a.kind === 'stock' ? 'STOCK TKN' : 'CRYPTO'}</small></span>
        ${spark(a.spark, (a.change7d ?? 0) >= 0)}
        <span class="px">${fmtPx(a.price)}</span>
        <span class="ch ${cls(a.change24h)}">${fmtPct(a.change24h)}</span>
      </li>`).join('');
    renderShield(w);
  } catch (err) {
    $('#watch').innerHTML = `<li class="skel">Market data unavailable: ${esc(err.message)}</li>`;
  }
}

async function loadMatrix() {
  try {
    const r = await fetch(API + '/api/matrix');
    if (!r.ok) throw new Error((await r.json()).error);
    const m = await r.json();
    const head = `<tr><th class="r"></th>${m.symbols.map((s) => `<th>${esc(s.slice(0, 4))}</th>`).join('')}</tr>`;
    const rows = m.symbols.map((s, i) => `<tr><th class="r">${esc(s)}</th>${m.matrix[i].map((v, j) => {
      if (i === j) return '<td class="self"></td>';
      const k = Math.max(0, v ?? 0);
      // warna emas landing: makin kuat korelasinya makin pekat
      const bg = `rgba(${Math.round(214 - 100 * k)}, ${Math.round(178 - 92 * k)}, ${Math.round(112 - 80 * k)}, ${(0.18 + 0.82 * k).toFixed(2)})`;
      return `<td style="background:${bg}"${k > 0.62 ? ' class="hi"' : ''} data-a="${esc(s)}" data-b="${esc(m.symbols[j])}" title="${esc(s)} vs ${esc(m.symbols[j])}: ${v}">${v == null ? '' : v.toFixed(1).replace('0.', '.')}</td>`;
    }).join('')}</tr>`).join('');
    $('#matrix').innerHTML = `<table>${head}${rows}</table>`;
  } catch (err) {
    $('#matrix').innerHTML = `<p class="skel">Matrix unavailable: ${esc(err.message)}</p>`;
  }
}

$('#watch').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-sym]');
  if (!li) return;
  const s = li.dataset.sym;
  ask(s === 'BTC' ? 'What moves with BTC right now? Use the matrix and check the strongest stock token for a lag.' : `Correlate ${s} with BTC over 14 days. Who leads, and by how many hours?`);
});
$('#matrix').addEventListener('click', (e) => {
  const td = e.target.closest('td[data-a]');
  if (td) ask(`Correlate ${td.dataset.a} with ${td.dataset.b} over 14 days and find the lag.`);
});

// ---------------- weekend shield ----------------
function renderShield(w) {
  const m = w.market;
  const crypto = w.assets.filter((a) => ['BTC', 'ETH', 'SOL'].includes(a.symbol));
  const movers = crypto.filter((a) => Math.abs(a.change24h ?? 0) >= 5);
  const alert = !m.wallStreetOpen && movers.length > 0;
  const el = $('#shield');
  el.classList.toggle('alert', alert);
  el.innerHTML = `
    <div class="sh-state"><i></i>${alert ? `Alert: crypto moving while Wall Street is ${m.weekend ? 'out for the weekend' : 'closed'}` : m.wallStreetOpen ? 'Wall Street open, no alert' : 'Calm while Wall Street is closed'}</div>
    <div class="sh-rows">${crypto.map((a) => `<div><span>${esc(a.symbol)}</span><span class="${cls(a.change24h)}">${fmtPct(a.change24h)}</span></div>`).join('')}</div>
    ${alert ? '<button class="sh-ask" type="button">Ask the agent which stock tokens are exposed →</button>' : ''}`;
  el.querySelector('.sh-ask')?.addEventListener('click', () => ask('Run the weekend shield. Which stock tokens are most exposed to this crypto move before Wall Street opens, and what would a hedge look like?'));
}

// ---------------- agent feed ----------------
const feed = $('#feed');
function scrollDown() { feed.scrollTop = feed.scrollHeight; }
function add(html, className) {
  $('#hello')?.remove();
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  feed.appendChild(el);
  scrollDown();
  return el;
}

// markdown ringan: teks di-escape dulu, baru diberi format
function md(src) {
  const lines = esc(src).split('\n');
  let out = '', list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  let para = [];
  const flush = () => { if (para.length) { out += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
  let table = null;
  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    out += `<table class="md-t"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    table = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(l)) {
      flush(); close();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue; // baris pemisah
      (table ||= []).push(l.trim().slice(1, -1).split('|').map((c) => c.trim()));
      continue;
    }
    flushTable();
    const ul = l.match(/^\s*[-*•]\s+(.*)/), ol = l.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { close(); out += `<${kind}>`; list = kind; }
      out += `<li>${inline((ul || ol)[1])}</li>`;
    } else if (!l.trim()) { flush(); close(); }
    else if (/^#{1,4}\s/.test(l)) { flush(); close(); out += `<p><strong>${inline(l.replace(/^#+\s/, ''))}</strong></p>`; }
    else { close(); para.push(l); }
  }
  flush(); close(); flushTable();
  return out;
}

function argsLabel(name, input) {
  if (!input) return '';
  if (name === 'correlate') return `${input.a} ↔ ${input.b}${input.days ? ` · ${input.days}d` : ''}`;
  if (name === 'get_quotes') return input.symbols?.join(', ') || 'watchlist';
  if (name === 'propose_basket') return `${input.amount_usdg} USDG · ${(input.legs || []).map((l) => `${l.weight_pct}% ${l.symbol}`).join(' / ')}`;
  if (name === 'weekend_shield') return `threshold ${input.threshold_pct ?? 5}%`;
  return '';
}

function toolBody(name, r) {
  if (name === 'correlate' && r?.lag_curve) {
    const max = Math.max(...r.lag_curve.map((x) => Math.abs(x.corr)), 0.01);
    const bars = r.lag_curve.map((x) => `<i class="${x.lag === r.best_lag_hours ? 'best' : x.corr < 0 ? 'neg' : ''}" style="height:${(Math.abs(x.corr) / max * 100).toFixed(0)}%" title="lag ${x.lag}h: ${x.corr}"></i>`).join('');
    const first = r.lag_curve[0].lag, last = r.lag_curve[r.lag_curve.length - 1].lag;
    return `<div class="lagchart">${bars}</div><div class="lagaxis"><span>${first}h</span><span>lag</span><span>+${last}h</span></div>
      <div class="kv"><span>corr <b>${r.corr_lag0}</b></span><span>best lag <b>${r.best_lag_hours}h</b> → <b>${r.corr_best_lag}</b></span><span>${esc(r.leader)}</span><span>${r.aligned_hours}h aligned</span></div>`;
  }
  if (name === 'market_status' && r) return `<div class="kv"><span>${esc(r.nyTime)}</span><span>session <b>${esc(r.session)}</b></span><span>stock tokens <b>24/7</b></span></div>`;
  if (name === 'weekend_shield' && r) return `<div class="kv"><span>alert <b>${r.alert ? 'yes' : 'no'}</b></span>${(r.crypto_24h || []).map((q) => `<span>${esc(q.symbol)} <b>${fmtPct(q.change24h_pct)}</b></span>`).join('')}</div>`;
  if (name === 'get_quotes' && r?.quotes) return `<div class="kv">${r.quotes.slice(0, 9).map((q) => `<span>${esc(q.symbol)} <b>${fmtPx(q.price)}</b> <span class="${cls(q.change24h_pct)}">${fmtPct(q.change24h_pct)}</span></span>`).join('')}</div>`;
  if (name === 'propose_basket' && r) return '<div class="kv"><span>Basket ready in the right panel →</span></div>';
  if ((name === 'draft_shield_rule' || name === 'draft_rebalance_rule') && r) return '<div class="kv"><span>Rule draft ready: activate it in Automation →</span></div>';
  if (name === 'get_portfolio' && r) return `<div class="kv"><span>total <b>$${Number(r.total_usd).toFixed(2)}</b></span>${r.positions.filter((p) => p.amount > 0).map((p) => `<span>${esc(p.symbol)} <b>${p.weight_pct.toFixed(1)}%</b></span>`).join('')}</div>`;
  if (name === 'get_automation' && r) return `<div class="kv"><span>permission <b>${r.policy.active ? 'active' : 'off'}</b></span><span>rules <b>${Object.values(r.rules || {}).filter((x) => x.enabled).length}</b></span></div>`;
  if (name === 'run_automation_now' && r) return `<div class="kv">${Object.entries(r.results || {}).map(([k, v]) => `<span>${esc(k)} <b>${esc(v.fired ? 'fired' : v.skipped)}</b></span>`).join('') || '<span>no active rules</span>'}</div>`;
  return '';
}

const toolEls = new Map();
function mcpBusy(group, on) {
  const li = document.querySelector(`#mcp li[data-g="${group}"]`);
  if (!li) return;
  li.classList.toggle('busy', on);
  if (on) li.querySelector('em').textContent = String(Number(li.querySelector('em').textContent) + 1);
}

function renderBasket(b) {
  $('#basket').innerHTML = `
    <div class="bk-amt">${Number(b.amount_usdg).toLocaleString('en-US')}<small>USDG · from ${esc(b.source_chain)}</small></div>
    ${b.condition ? `<p class="bk-cond"><b>If</b> ${esc(b.condition)}</p>` : ''}
    ${b.rationale ? `<p class="bk-cond">${esc(b.rationale)}</p>` : ''}
    <div class="legs">${b.legs.map((l) => `
      <div class="leg"><span>${esc(l.symbol)}</span><div class="bar"><i style="width:${l.weight_pct}%"></i></div><em>${l.weight_pct}%</em>
      <small>${Number(l.usd).toLocaleString('en-US')} USDG ≈ ${l.est_units} ${esc(l.symbol)} @ ${fmtPx(l.price)}</small></div>`).join('')}
    </div>
    <ol class="route">${b.route.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${b.executable ? eligibilityBox() : ''}
    <button class="approve" type="button" id="approve" ${b.executable ? '' : 'disabled'}>Approve basket</button>
    <p class="bk-note">${esc(b.executable ? `${W.address ? 'You sign it in your wallet' : 'Connect your wallet to approve'}. Real tokens on Robinhood Chain, swapped on Uniswap v3 with a 1% price guard. Gas is paid in ETH.` : b.execution)}</p>`;
  $('#approve').addEventListener('click', (e) => executeBasket(b, e.target));
}

async function ask(text) {
  if (busy || !text.trim()) return;
  busy = true;
  $('.send').disabled = true;
  add(esc(text), 'msg user');
  let agentEl = null, buf = '';
  const typing = add('<span class="typing"><i></i><i></i><i></i></span>', 'msg agent');

  try {
    const res = await fetch(API + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, text, address: W.address }) });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let pending = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += dec.decode(value, { stream: true });
      let i;
      while ((i = pending.indexOf('\n\n')) >= 0) {
        const chunk = pending.slice(0, i);
        pending = pending.slice(i + 2);
        const ev = chunk.match(/^event: (.*)$/m)?.[1];
        const data = JSON.parse(chunk.match(/^data: (.*)$/m)?.[1] || '{}');
        if (ev === 'text') {
          typing.remove();
          if (!agentEl) { agentEl = add('', 'msg agent'); buf = ''; }
          buf += data.delta;
          agentEl.innerHTML = md(buf);
          scrollDown();
        } else if (ev === 'tool_start') {
          typing.remove();
          agentEl = null;
          const el = add(`<div class="tool-h"><span class="g">${esc(GROUP[data.group] || data.group)}</span><span class="n">${esc(data.name)}</span><span class="a">${esc(argsLabel(data.name, data.input))}</span><span class="s"></span></div>`, 'tool run');
          toolEls.set(data.id, el);
          mcpBusy(data.group, true);
        } else if (ev === 'tool_end') {
          const el = toolEls.get(data.id);
          mcpBusy(data.group, false);
          if (el) {
            el.className = 'tool ' + (data.ok ? 'ok' : 'fail');
            const body = data.ok ? toolBody(data.name, data.result) : `<div class="kv"><span class="down">${esc(data.error)}</span></div>`;
            if (body) el.insertAdjacentHTML('beforeend', `<div class="tool-b">${body}</div>`);
          }
          if (data.ok && data.name === 'propose_basket') renderBasket(data.result);
          if (data.ok && /^draft_.*_rule$/.test(data.name)) setDraft(data.result);
          if (data.ok && data.name === 'run_automation_now') refreshAll();
          feed.appendChild(typing);
          scrollDown();
        } else if (ev === 'notice') {
          add(esc(data.text), 'msg notice');
        } else if (ev === 'error') {
          add(esc(data.text), 'msg error');
        }
      }
    }
  } catch (err) {
    add(esc(`Could not reach the agent: ${err.message}`), 'msg error');
  } finally {
    typing.remove();
    busy = false;
    $('.send').disabled = false;
    $('#q').focus();
  }
}

// ---------------- input ----------------
const q = $('#q');
q.addEventListener('input', () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 160) + 'px'; });
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#ask').requestSubmit(); }
});
$('#ask').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = q.value;
  q.value = '';
  q.style.height = 'auto';
  ask(t);
});
$('#chips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) ask(b.textContent); });
$('#reset').addEventListener('click', async () => {
  if (busy) return;
  await fetch(API + '/api/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session }) }).catch(() => {});
  location.reload();
});

loadWatch();
setTimeout(loadMatrix, 300);
initWallet(refreshAll);
setInterval(() => { if (W.address) refreshAll(); }, 30_000);
setInterval(loadWatch, 60_000);
setInterval(loadMatrix, 5 * 60_000);
