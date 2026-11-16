// Server lokal BCIO: menyajikan folder web/ (landing + terminal) dan API engine.
//   npm start  ->  http://localhost:5191/terminal
// API key Claude hanya ada di sini (dibaca dari .env), tidak pernah dikirim ke browser.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMarkets } from './market.js';
import { correlationMatrix } from './tools.js';
import { marketStatus } from './analytics.js';
import { getSession, runAgent, Anthropic } from './agent.js';
import { onchain, portfolio, policyOf, verifySignature, checkAddress } from './chain.js';
import { getRules, saveRule, ruleMessage, activity, evaluate, startLoop, Rule } from './automation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../web');
const PORT = Number(process.env.PORT || 5191);
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon',
};

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 20_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function serveStatic(req, res, urlPath) {
  // alamat bersih: /terminal -> terminal.html; /x.html dialihkan ke /x
  if (/\.html$/.test(urlPath)) { res.writeHead(301, { location: urlPath.replace(/(index)?\.html$/, '') || '/' }); return res.end(); }
  let rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  if (!path.extname(rel)) rel += '.html';
  const file = path.resolve(WEB, '.' + rel);
  if (!file.startsWith(WEB + path.sep)) return json(res, 403, { error: 'forbidden' });
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

async function handleChat(req, res) {
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad request' }); }
  const text = String(body.text || '').trim().slice(0, 4000);
  const sid = String(body.session || '').slice(0, 64);
  let address = null;
  try { if (body.address) address = checkAddress(body.address); } catch { /* ignore bad address */ }
  if (!text || !sid) return json(res, 400, { error: 'text and session are required' });
  const session = getSession(sid);
  if (session.busy) return json(res, 409, { error: 'agent is still answering' });

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  session.busy = true;
  try {
    await runAgent(session, text, emit, { address });
  } catch (err) {
    let msg = 'Agent error';
    if (err instanceof Anthropic.AuthenticationError) msg = 'Claude API key was rejected. Check engine/.env.';
    else if (err instanceof Anthropic.RateLimitError) msg = 'Claude API rate limit reached. Try again in a moment.';
    else if (err instanceof Anthropic.APIError) msg = `Claude API error (${err.status ?? 'network'})`;
    console.error('[agent]', err);
    emit('error', { text: msg });
    // buang giliran user yang gagal supaya riwayat tetap valid
    const last = session.messages[session.messages.length - 1];
    if (last?.role === 'user' && typeof last.content === 'string') session.messages.pop();
  } finally {
    session.busy = false;
    emit('done', {});
    res.end();
  }
}

const runGate = new Map();

// Aturan otomatis hanya bisa diubah pemilik wallet: pesan harus ditandatangani wallet itu.
async function handleRule(req, res) {
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad request' }); }
  try {
    const address = checkAddress(body.address);
    const rule = body.enabled === false ? { type: String(body.rule?.type) } : Rule.parse(body.rule);
    if (!['shield', 'rebalance'].includes(rule.type)) throw new Error('unknown rule type');
    const issued = Number(body.issued);
    if (!issued || Math.abs(Date.now() - issued) > 10 * 60_000) throw new Error('signature expired, sign again');
    const message = ruleMessage(address, body.enabled === false ? { type: rule.type, enabled: false } : rule, issued);
    if (!(await verifySignature(address, message, body.signature))) return json(res, 401, { error: 'signature does not match this wallet' });
    return json(res, 200, { rules: saveRule(address, rule, body.enabled !== false) });
  } catch (err) {
    return json(res, 400, { error: err.issues ? err.issues.map((i) => i.message).join('; ') : err.message });
  }
}

// halaman di server statis lokal (:5190) boleh memanggil API engine
const ORIGINS = new Set(['http://localhost:5190', 'http://127.0.0.1:5190']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (ORIGINS.has(req.headers.origin)) {
    res.setHeader('access-control-allow-origin', req.headers.origin);
    res.setHeader('vary', 'origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' });
      return res.end();
    }
  }
  try {
    if (url.pathname === '/api/watchlist' && req.method === 'GET') {
      const m = await getMarkets();
      return json(res, 200, { ...m, market: marketStatus() });
    }
    if (url.pathname === '/api/matrix' && req.method === 'GET') return json(res, 200, await correlationMatrix());
    if (url.pathname === '/api/chat' && req.method === 'POST') return handleChat(req, res);
    if (url.pathname === '/api/chain' && req.method === 'GET') return json(res, 200, onchain);
    if (url.pathname === '/api/portfolio' && req.method === 'GET') {
      const a = url.searchParams.get('address');
      return json(res, 200, await portfolio(a));
    }
    if (url.pathname === '/api/automation' && req.method === 'GET') {
      const a = checkAddress(url.searchParams.get('address'));
      return json(res, 200, { policy: await policyOf(a), rules: getRules(a), activity: activity(a, 30) });
    }
    if (url.pathname === '/api/rules/prepare' && req.method === 'POST') {
      const body = await readBody(req);
      const address = checkAddress(body.address);
      const rule = body.enabled === false ? { type: String(body.rule?.type), enabled: false } : Rule.parse(body.rule);
      const issued = Date.now();
      return json(res, 200, { rule, issued, message: ruleMessage(address, rule, issued) });
    }
    if (url.pathname === '/api/rules' && req.method === 'POST') return handleRule(req, res);
    if (url.pathname === '/api/automation/run' && req.method === 'POST') {
      const body = await readBody(req);
      const a = checkAddress(body.address);
      const last = runGate.get(a) || 0;
      if (Date.now() - last < 20_000) return json(res, 429, { error: 'Wait a few seconds before running again' });
      runGate.set(a, Date.now());
      return json(res, 200, await evaluate(a));
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const s = getSession(String(body.session || ''));
      if (!s.busy) s.messages = [];
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET') return serveStatic(req, res, url.pathname);
    json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error('[server]', err.message);
    if (/valid wallet address|Automation is off/.test(err.message)) return json(res, 400, { error: err.message });
    json(res, err.status === 429 ? 503 : 500, { error: err.status === 429 ? 'Market data rate limited, retry shortly' : 'server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`BCIO engine on http://${HOST}:${PORT}  (terminal: /terminal)`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn('ANTHROPIC_API_KEY is not set: the agent chat will fail.');
  startLoop();
});
