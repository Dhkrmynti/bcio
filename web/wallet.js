// Wallet & eksekusi di terminal BCIO (browser). Semua transaksi ditandatangani wallet user
// sendiri (MetaMask, Rabby, dll.). Server tidak pernah memegang key user.
import { createWalletClient, createPublicClient, custom, http, parseAbi, parseUnits, defineChain } from 'https://esm.sh/viem@2.21.55';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, d = 2) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

const DESK_ABI = parseAbi([
  'function faucet()',
  'function quote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256 out, uint256 valueUsd)',
  'function swapBasket(address tokenIn, uint256 amountIn, address[] tokensOut, uint16[] weightsBps, uint256[] minOuts) returns (uint256[])',
  'function setAgent(address agent, uint128 maxTradeUsd, uint128 maxDayUsd, uint64 expiry)',
  'function revokeAgent(address agent)',
  'error FaucetCooldown(uint256 nextAt)', 'error StalePrice(address token)', 'error Slippage(uint256 out, uint256 minOut)', 'error BadWeights()',
]);

export const W = { cfg: null, chain: null, pub: null, wallet: null, address: null, draft: null, portfolio: null };

export function toast(text, kind = 'info') {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 7000 : 4000);
}

function txLink(hash) {
  if (!hash) return '';
  return W.cfg?.explorer ? `<a href="${esc(W.cfg.explorer)}/tx/${esc(hash)}" target="_blank" rel="noopener">${esc(short(hash))}</a>` : `<code>${esc(short(hash))}</code>`;
}

function errText(err) {
  const rev = err?.walk?.((e) => e?.name === 'ContractFunctionRevertedError');
  if (rev?.data?.errorName === 'FaucetCooldown') return 'Faucet is once a day. Try again tomorrow.';
  if (rev?.data?.errorName === 'StalePrice') return 'Oracle price is stale. Wait a minute for the engine to refresh it.';
  if (rev?.data?.errorName) return rev.data.errorName;
  if (err?.code === 4001 || /rejected|denied/i.test(err?.message || '')) return 'You cancelled it in your wallet.';
  return (err?.shortMessage || err?.message || String(err)).split('\n')[0];
}

// halaman dilayani engine (lokal :5191, produksi bcio.trade) → API di origin yang sama;
// hanya server statis dev (:5190) yang memanggil engine lokal
export const API = location.port === '5190' ? 'http://127.0.0.1:5191' : '';

async function api(path, body) {
  const r = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function send(functionName, args) {
  const hash = await W.wallet.writeContract({ address: W.cfg.desk, abi: DESK_ABI, functionName, args, account: W.address, chain: W.chain });
  toast('Transaction sent, waiting for the block…');
  const rc = await W.pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error('Transaction reverted');
  return hash;
}

// ---------------------------------------------------------------- connect
export async function initWallet(onChange) {
  W.cfg = await api('/api/chain').catch(() => ({ enabled: false, reason: 'engine offline' }));
  const btn = $('#wallet');
  if (!W.cfg.enabled) {
    btn.disabled = true;
    btn.textContent = 'Execution off';
    btn.title = W.cfg.reason || '';
    $('#net').textContent = 'execution off';
    return;
  }
  W.chain = defineChain({
    id: W.cfg.chainId, name: W.cfg.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [W.cfg.rpc] } },
    ...(W.cfg.explorer ? { blockExplorers: { default: { name: 'Explorer', url: W.cfg.explorer } } } : {}),
  });
  W.pub = createPublicClient({ chain: W.chain, transport: http(W.cfg.rpc) });
  $('#net').textContent = `${W.cfg.chainName} · test tokens`;
  btn.addEventListener('click', () => (W.address ? null : connect(onChange)));
  window.ethereum?.on?.('accountsChanged', (a) => { W.address = a[0] || null; paintButton(); onChange(); });
}

function paintButton() {
  const btn = $('#wallet');
  btn.textContent = W.address ? short(W.address) : 'Connect wallet';
  btn.classList.toggle('on', !!W.address);
}

async function connect(onChange) {
  if (!window.ethereum) { toast('No wallet found. Install MetaMask or Rabby, then reload.', 'error'); return; }
  try {
    const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const hex = '0x' + W.cfg.chainId.toString(16);
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
    } catch (e) {
      if (e.code !== 4902) throw e;
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, chainName: W.cfg.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [W.cfg.rpc], ...(W.cfg.explorer ? { blockExplorerUrls: [W.cfg.explorer] } : {}) }],
      });
    }
    W.wallet = createWalletClient({ chain: W.chain, transport: custom(window.ethereum) });
    W.address = a;
    paintButton();
    toast(`Connected to ${W.cfg.chainName}`);
    onChange();
  } catch (err) {
    toast(errText(err), 'error');
  }
}

// ---------------------------------------------------------------- portfolio
export async function refreshPortfolio() {
  const el = $('#portfolio');
  if (!W.address) return;
  try {
    const p = await api(`/api/portfolio?address=${W.address}`);
    W.portfolio = p;
    const rows = p.positions.filter((x) => x.amount > 0);
    el.innerHTML = `
      <div class="pf-total">${money(p.total_usd)}<small>${esc(short(p.address))}</small></div>
      ${rows.length ? `<div class="pf-rows">${rows.map((x) => `
        <div><span>${esc(x.token)}</span><span>${x.amount < 1 ? x.amount.toFixed(5) : x.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })}</span><span>${money(x.value)}</span><span class="w">${x.weight_pct.toFixed(1)}%</span></div>`).join('')}</div>` : '<p class="empty">Empty. Get test USDC to start.</p>'}
      <button class="ghostbtn" type="button" id="faucet">Get 10,000 tUSDC (test)</button>`;
    $('#faucet').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await send('faucet', []); toast('10,000 tUSDC added', 'ok'); refreshPortfolio(); } catch (err) { toast(errText(err), 'error'); }
      e.target.disabled = false;
    });
  } catch (err) {
    el.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------- basket
export async function executeBasket(b, btn) {
  if (!W.address) { toast('Connect your wallet first', 'error'); return; }
  btn.disabled = true;
  try {
    const amount = parseUnits(String(b.amount_usdc), 6);
    const usdc = W.cfg.tokens.USDC;
    const legs = b.legs.map((l) => ({ ...l, token: W.cfg.tokens[l.symbol] }));
    let bps = legs.map((l) => Math.round(l.weight_pct * 100));
    bps[bps.length - 1] += 10_000 - bps.reduce((s, v) => s + v, 0);
    let spent = 0n;
    const minOuts = [];
    for (let i = 0; i < legs.length; i++) {
      const part = i === legs.length - 1 ? amount - spent : (amount * BigInt(bps[i])) / 10_000n;
      spent += part;
      const [out] = await W.pub.readContract({ address: W.cfg.desk, abi: DESK_ABI, functionName: 'quote', args: [usdc, legs[i].token, part] });
      minOuts.push((out * 99n) / 100n);
    }
    btn.textContent = 'Confirm in wallet…';
    const hash = await send('swapBasket', [usdc, amount, legs.map((l) => l.token), bps, minOuts]);
    btn.textContent = 'Executed ✓';
    btn.insertAdjacentHTML('afterend', `<p class="bk-note">Done · ${txLink(hash)}</p>`);
    toast('Basket executed', 'ok');
    refreshPortfolio();
  } catch (err) {
    toast(errText(err), 'error');
    btn.disabled = false;
    btn.textContent = 'Approve basket';
  }
}

// ---------------------------------------------------------------- automation
function ruleText(r) {
  if (r.type === 'shield') return `When Wall Street is closed and BTC, ETH or SOL moves ${r.direction === 'down' ? 'down' : ''} ${r.threshold_pct}%+ in 24h, sell ${r.hedge_pct}% of each stock token to tUSDC. Cooldown ${r.cooldown_h}h.`;
  return `Targets ${Object.entries(r.targets).map(([k, v]) => `${v}% ${k}`).join(' · ')}. Rebalance when a weight drifts ${r.band_pct}+ pts (at most every ${r.min_interval_h}h).`;
}

export function setDraft(result) {
  W.draft = result;
  refreshAutomation();
}

async function signRule(rule, enabled) {
  const prep = await api('/api/rules/prepare', { address: W.address, rule, enabled });
  toast('Sign the rule in your wallet (no gas)');
  const signature = await W.wallet.signMessage({ account: W.address, message: prep.message });
  return api('/api/rules', { address: W.address, rule: prep.rule, issued: prep.issued, signature, enabled });
}

async function activate(btn) {
  const { draft, policy } = W.draft;
  btn.disabled = true;
  try {
    btn.textContent = '1/2 Grant permission…';
    const expiry = BigInt(Math.floor(Date.now() / 1000) + policy.days_valid * 86400);
    await send('setAgent', [W.cfg.agent, BigInt(Math.round(policy.max_trade_usd * 1e8)), BigInt(Math.round(policy.max_day_usd * 1e8)), expiry]);
    btn.textContent = '2/2 Sign rule…';
    await signRule(draft, true);
    W.draft = null;
    toast('Automation is on', 'ok');
  } catch (err) {
    toast(errText(err), 'error');
  }
  refreshAutomation();
}

export async function refreshAutomation() {
  const el = $('#auto');
  if (!W.address) {
    if (W.draft) el.innerHTML = `<div class="draft"><b>${esc(W.draft.draft.type === 'shield' ? 'Weekend shield' : 'Rebalancer')} draft</b><p>${esc(ruleText(W.draft.draft))}</p><p class="empty">Connect your wallet to activate it.</p></div>`;
    return;
  }
  try {
    const a = await api(`/api/automation?address=${W.address}`);
    const p = a.policy;
    const rules = Object.entries(a.rules || {}).filter(([, r]) => r.enabled);
    let html = `
      <div class="perm ${p.active ? 'on' : ''}">
        <div><i></i><b>${p.active ? 'Agent permission active' : 'No agent permission'}</b></div>
        ${p.active ? `<div class="perm-kv"><span>per trade <b>${money(p.max_trade_usd, 0)}</b></span><span>per day <b>${money(p.max_day_usd, 0)}</b></span><span>used today <b>${money(p.spent_today_usd, 0)}</b></span><span>until <b>${new Date(p.expires_at).toLocaleDateString()}</b></span></div>` : ''}
        <small>Agent ${esc(short(p.agent))} can only swap between your own test tokens, within these limits. Enforced by the contract.</small>
      </div>`;
    if (W.draft) {
      html += `<div class="draft"><b>New: ${esc(W.draft.draft.type === 'shield' ? 'Weekend shield (phase 2)' : 'Rebalancer (phase 3)')}</b>
        <p>${esc(ruleText(W.draft.draft))}</p>
        <p class="empty">Permission: ${money(W.draft.policy.max_trade_usd, 0)} per trade, ${money(W.draft.policy.max_day_usd, 0)} per day, ${W.draft.policy.days_valid} days.</p>
        <div class="row"><button class="approve" type="button" id="activate">Activate</button><button class="ghostbtn" type="button" id="discard">Discard</button></div></div>`;
    }
    html += rules.length ? rules.map(([type, r]) => `
      <div class="rule"><div><b>${type === 'shield' ? 'Weekend shield' : 'Rebalancer'}</b><button class="link" type="button" data-off="${esc(type)}">turn off</button></div>
      <p>${esc(ruleText(r))}</p><small>last run: ${r.last_run ? new Date(r.last_run).toLocaleString() : 'never'}</small></div>`).join('') : '';
    if (p.active || rules.length) {
      html += `<div class="row"><button class="ghostbtn" type="button" id="runnow">Check rules now</button>${p.active ? '<button class="ghostbtn danger" type="button" id="revoke">Revoke agent</button>' : ''}</div>`;
    }
    el.innerHTML = html;
    $('#activate')?.addEventListener('click', (e) => activate(e.target));
    $('#discard')?.addEventListener('click', () => { W.draft = null; refreshAutomation(); });
    $('#revoke')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await send('revokeAgent', [W.cfg.agent]); toast('Agent revoked. It can no longer trade for you.', 'ok'); } catch (err) { toast(errText(err), 'error'); }
      refreshAutomation();
    });
    $('#runnow')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const r = await api('/api/automation/run', { address: W.address });
        const said = Object.entries(r.results).map(([k, v]) => `${k}: ${v.fired ? v.why : v.skipped}`).join(' · ');
        toast(said || 'No active rules', 'ok');
      } catch (err) { toast(err.message, 'error'); }
      refreshAll();
    });
    el.querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', async () => {
      try { await signRule({ type: b.dataset.off }, false); toast('Rule turned off', 'ok'); } catch (err) { toast(errText(err), 'error'); }
      refreshAutomation();
    }));
    renderActivity(a.activity);
  } catch (err) {
    el.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

function renderActivity(list) {
  const el = $('#activity');
  if (!list?.length) { el.innerHTML = '<li class="empty">Automatic trades show up here.</li>'; return; }
  el.innerHTML = list.slice(0, 12).map((e) => `
    <li class="${esc(e.status)}">
      <div><b>${esc(e.type)}</b><span>${new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
      <p>${esc(e.text)}</p>
      ${(e.trades || []).map((t) => `<p class="tr ${t.ok ? 'ok' : 'no'}">${t.ok ? '✓' : '✕'} ${esc(t.from)} → ${esc(t.to)} ${t.ok ? `${Number(t.amount_in).toFixed(4)} → ${Number(t.amount_out).toFixed(4)} · ${txLink(t.hash)}` : `· ${esc(t.error)}`}</p>`).join('')}
    </li>`).join('');
}

export function refreshAll() {
  refreshPortfolio();
  refreshAutomation();
}
