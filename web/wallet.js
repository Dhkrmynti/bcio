// Wallet & eksekusi di terminal BCIO (browser), Robinhood Chain MAINNET. Semua transaksi
// ditandatangani wallet user sendiri (MetaMask, Rabby, dll.). Server tidak pernah memegang key user.
//  - Basket: Uniswap v3 SwapRouter02.multicall, satu tanda tangan (plus approve USDG bila perlu).
//  - Otomatis: izin terbatas ke agent lewat kontrak BcioAgent (setAgent + approve token).
import { createWalletClient, createPublicClient, custom, http, parseAbi, parseUnits, defineChain, encodeFunctionData, maxUint256 } from 'https://esm.sh/viem@2.21.55';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, d = 2) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

const ERC20 = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);
const ROUTER = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])',
]);
const QUOTER = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
const AGENT = parseAbi([
  'function setAgent(address agent, uint64 maxTradeUsd, uint64 maxDayUsd, uint64 expiry, uint16 maxDeviationBps, address[] allowTokens)',
  'function revokeAgent(address agent)',
  'error BadPolicy()', 'error NotListed(address token)',
]);

export const W = { cfg: null, chain: null, pub: null, wallet: null, address: null, draft: null, portfolio: null };

export function toast(text, kind = 'info') {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 7000 : 4000);
}

const txLink = (hash) => (hash ? `<a href="${esc(W.cfg.explorer)}/tx/${esc(hash)}" target="_blank" rel="noopener">${esc(short(hash))}</a>` : '');

function errText(err) {
  const rev = err?.walk?.((e) => e?.name === 'ContractFunctionRevertedError');
  const msg = err?.shortMessage || err?.message || String(err);
  if (/Too little received/i.test(msg)) return 'Price moved more than 1% before your transaction landed. Nothing was swapped; try again.';
  if (/insufficient funds/i.test(msg)) return 'Not enough ETH on Robinhood Chain for gas.';
  if (rev?.data?.errorName) return rev.data.errorName;
  if (err?.code === 4001 || /rejected|denied/i.test(msg)) return 'You cancelled it in your wallet.';
  return msg.split('\n')[0];
}

// halaman dilayani engine (produksi bcio.trade) → API di origin yang sama; server statis dev (:5190) → engine lokal
export const API = location.port === '5190' ? 'http://127.0.0.1:5191' : '';

async function api(path, body) {
  const r = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function write(address, abi, functionName, args, label) {
  const hash = await W.wallet.writeContract({ address, abi, functionName, args, account: W.address, chain: W.chain });
  toast(`${label || 'Transaction'} sent, waiting for the block…`);
  const rc = await W.pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error('Transaction reverted');
  return hash;
}

const tok = (s) => W.cfg.tokens[s];
const allowance = (s, spender) => W.pub.readContract({ address: tok(s).address, abi: ERC20, functionName: 'allowance', args: [W.address, spender] });
const balanceOf = (s) => W.pub.readContract({ address: tok(s).address, abi: ERC20, functionName: 'balanceOf', args: [W.address] });

// ---------------------------------------------------------------- kelayakan (stock tokens)
const ELIG_KEY = 'bcio-eligible-v1';
const eligible = () => { try { return localStorage.getItem(ELIG_KEY) === '1'; } catch { return false; } };
function eligibilityBox() {
  if (eligible()) return '';
  return `<label class="elig"><input type="checkbox" id="elig"> I am not a US person and not in a country where Robinhood stock tokens are restricted (incl. UK and Canada). I understand these are real tokens, not shares, and that trades can lose money.</label>`;
}
function requireEligible() {
  if (eligible()) return true;
  const box = $('#elig');
  if (box?.checked) { try { localStorage.setItem(ELIG_KEY, '1'); } catch { /* private mode */ } return true; }
  toast('Please confirm the eligibility box first.', 'error');
  box?.closest('.elig')?.classList.add('flash');
  return false;
}
export { eligibilityBox };

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
    blockExplorers: { default: { name: 'Blockscout', url: W.cfg.explorer } },
  });
  W.pub = createPublicClient({ chain: W.chain, transport: http(W.cfg.rpc) });
  $('#net').textContent = `${W.cfg.chainName} · mainnet`;
  btn.addEventListener('click', () => (W.address ? null : connect(onChange)));
  window.ethereum?.on?.('accountsChanged', (a) => { W.address = a[0] || null; paintButton(); onChange(); });
}

function paintButton() {
  const btn = $('#wallet');
  btn.textContent = W.address ? short(W.address) : 'Connect wallet';
  btn.classList.toggle('on', !!W.address);
}

async function connect(onChange) {
  if (!window.ethereum) { toast('No wallet found. Install MetaMask, Rabby or Robinhood Wallet, then reload.', 'error'); return; }
  try {
    const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const hex = '0x' + W.cfg.chainId.toString(16);
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
    } catch (e) {
      if (e.code !== 4902) throw e;
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, chainName: W.cfg.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [W.cfg.rpc], blockExplorerUrls: [W.cfg.explorer] }],
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
      <div class="pf-total">${money(p.total_usd)}<small>${esc(short(p.address))} · Chainlink prices</small></div>
      ${rows.length ? `<div class="pf-rows">${rows.map((x) => `
        <div><span>${esc(x.token)}</span><span>${x.amount < 1 ? x.amount.toFixed(5) : x.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })}</span><span>${money(x.value)}</span><span class="w">${x.weight_pct.toFixed(1)}%</span></div>`).join('')}</div>`
        : `<p class="empty">No USDG, stock tokens or WETH on Robinhood Chain in this wallet yet. Fund it with USDG (Robinhood Wallet or a bridge) and a little ETH for gas.</p>`}
      <a class="ghostbtn" href="${esc(W.cfg.explorer)}/address/${esc(p.address)}" target="_blank" rel="noopener">View on explorer</a>`;
  } catch (err) {
    el.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------- basket (Uniswap, satu tanda tangan)
export async function executeBasket(b, btn) {
  if (!W.address) { toast('Connect your wallet first', 'error'); return; }
  if (!requireEligible()) return;
  btn.disabled = true;
  const reset = () => { btn.disabled = false; btn.textContent = 'Approve basket'; };
  try {
    const usd = W.cfg.usd;
    const amount = parseUnits(String(b.amount_usdg), tok(usd).decimals);
    if ((await balanceOf(usd)) < amount) { toast(`Not enough ${usd} in this wallet for ${b.amount_usdg}.`, 'error'); reset(); return; }
    // bagi per bobot; kaki terakhir mengambil sisa pembulatan
    let spent = 0n;
    const legs = b.legs.map((l, i) => {
      const part = i === b.legs.length - 1 ? amount - spent : (amount * BigInt(Math.round(l.weight_pct * 100))) / 10_000n;
      spent += part;
      return { ...l, amountIn: part, t: tok(l.symbol) };
    });
    btn.textContent = 'Quoting on Uniswap…';
    for (const l of legs) {
      const { result } = await W.pub.simulateContract({
        address: W.cfg.quoter, abi: QUOTER, functionName: 'quoteExactInputSingle',
        args: [{ tokenIn: tok(usd).address, tokenOut: l.t.address, amountIn: l.amountIn, fee: l.t.fee, sqrtPriceLimitX96: 0n }],
      });
      l.minOut = (result[0] * 99n) / 100n; // 1% slippage guard
    }
    if ((await allowance(usd, W.cfg.router)) < amount) {
      btn.textContent = `1/2 Approve ${usd}…`;
      await write(tok(usd).address, ERC20, 'approve', [W.cfg.router, amount], `${usd} approval`);
    }
    btn.textContent = 'Confirm basket in wallet…';
    const calls = legs.map((l) => encodeFunctionData({
      abi: ROUTER, functionName: 'exactInputSingle',
      args: [{ tokenIn: tok(usd).address, tokenOut: l.t.address, fee: l.t.fee, recipient: W.address, amountIn: l.amountIn, amountOutMinimum: l.minOut, sqrtPriceLimitX96: 0n }],
    }));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const hash = await write(W.cfg.router, ROUTER, 'multicall', [deadline, calls], 'Basket');
    btn.textContent = 'Executed ✓';
    btn.insertAdjacentHTML('afterend', `<p class="bk-note">Done on Uniswap · ${txLink(hash)}</p>`);
    toast('Basket executed', 'ok');
    refreshPortfolio();
  } catch (err) {
    toast(errText(err), 'error');
    reset();
  }
}

// ---------------------------------------------------------------- automation
function ruleText(r) {
  if (r.type === 'shield') return `When Wall Street is closed and BTC, ETH or SOL moves ${r.direction === 'down' ? 'down' : ''} ${r.threshold_pct}%+ in 24h, sell ${r.hedge_pct}% of each stock token to USDG on Uniswap. Cooldown ${r.cooldown_h}h.`;
  return `Targets ${Object.entries(r.targets).map(([k, v]) => `${v}% ${k}`).join(' · ')}. Rebalance on Uniswap when a weight drifts ${r.band_pct}+ pts (at most every ${r.min_interval_h}h).`;
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
  if (!requireEligible()) return;
  btn.disabled = true;
  try {
    const usd = W.cfg.usd;
    // token yang bisa dijual agent (+ USDG untuk membeli saat rebalance)
    const spend = [...new Set([...policy.tokens, ...(draft.type === 'rebalance' ? [usd] : [])])];
    for (const s of spend) {
      if ((await allowance(s, W.cfg.agentContract)) > 0n) continue;
      btn.textContent = `Approve ${tok(s).token} for the agent contract…`;
      await write(tok(s).address, ERC20, 'approve', [W.cfg.agentContract, maxUint256], `${tok(s).token} approval`);
    }
    btn.textContent = 'Grant permission…';
    const expiry = BigInt(Math.floor(Date.now() / 1000) + policy.days_valid * 86400);
    await write(W.cfg.agentContract, AGENT, 'setAgent', [
      W.cfg.agent,
      BigInt(Math.round(policy.max_trade_usd * 1e6)),
      BigInt(Math.round(policy.max_day_usd * 1e6)),
      expiry,
      Math.round((policy.max_deviation_pct ?? 3) * 100),
      policy.tokens.map((s) => tok(s).address),
    ], 'Permission');
    btn.textContent = 'Sign rule…';
    await signRule(draft, true);
    W.draft = null;
    toast('Automation is on', 'ok');
  } catch (err) {
    toast(errText(err), 'error');
  }
  refreshAutomation();
}

async function removeApprovals(btn) {
  btn.disabled = true;
  try {
    for (const s of Object.keys(W.cfg.tokens)) {
      if ((await allowance(s, W.cfg.agentContract)) === 0n) continue;
      await write(tok(s).address, ERC20, 'approve', [W.cfg.agentContract, 0n], `${tok(s).token} approval removed`);
    }
    toast('All token approvals to the agent contract are now zero.', 'ok');
  } catch (err) { toast(errText(err), 'error'); }
  refreshAutomation();
}

export async function refreshAutomation() {
  const el = $('#auto');
  if (W.cfg && !W.cfg.automation) {
    el.innerHTML = `<p class="empty">Automatic trading is not live yet: ${esc(W.cfg.automationReason || 'agent contract not deployed')}. Baskets work now.</p>`;
    return;
  }
  if (!W.address) {
    if (W.draft) el.innerHTML = `<div class="draft"><b>${esc(W.draft.draft.type === 'shield' ? 'Weekend shield' : 'Rebalancer')} draft</b><p>${esc(ruleText(W.draft.draft))}</p><p class="empty">Connect your wallet to activate it.</p></div>`;
    return;
  }
  try {
    const a = await api(`/api/automation?address=${W.address}`);
    const p = a.policy;
    const rules = Object.entries(a.rules || {}).filter(([, r]) => r.enabled);
    const approved = Object.entries(p.approvals || {}).filter(([, v]) => v).map(([k]) => k);
    let html = `
      <div class="perm ${p.active ? 'on' : ''}">
        <div><i></i><b>${p.active ? 'Agent permission active' : 'No agent permission'}</b></div>
        ${p.active ? `<div class="perm-kv"><span>per trade <b>${money(p.max_trade_usd, 0)}</b></span><span>per day <b>${money(p.max_day_usd, 0)}</b></span><span>used today <b>${money(p.spent_today_usd, 0)}</b></span><span>max gap vs Chainlink <b>${p.max_deviation_pct}%</b></span><span>tokens <b>${esc(p.tokens.join(', '))}</b></span><span>until <b>${new Date(p.expires_at).toLocaleDateString()}</b></span></div>` : ''}
        <small>Agent ${esc(short(p.agent))} can only swap your allowed tokens to and from USDG on Uniswap, back into your own wallet, within these limits. Enforced by the <a href="${esc(W.cfg.explorer)}/address/${esc(p.contract)}" target="_blank" rel="noopener">BCIO agent contract</a>. Real tokens.</small>
      </div>`;
    if (W.draft) {
      const pol = W.draft.policy;
      html += `<div class="draft"><b>New: ${esc(W.draft.draft.type === 'shield' ? 'Weekend shield (phase 2)' : 'Rebalancer (phase 3)')}</b>
        <p>${esc(ruleText(W.draft.draft))}</p>
        <p class="empty">Permission: ${money(pol.max_trade_usd, 0)} per trade, ${money(pol.max_day_usd, 0)} per day, max ${pol.max_deviation_pct ?? 3}% from Chainlink, tokens ${esc(pol.tokens.join(', '))}, ${pol.days_valid} days. Your wallet asks for a token approval per token, then the permission, then a free signature for the rule.</p>
        ${eligibilityBox()}
        <div class="row"><button class="approve" type="button" id="activate">Activate</button><button class="ghostbtn" type="button" id="discard">Discard</button></div></div>`;
    }
    html += rules.length ? rules.map(([type, r]) => `
      <div class="rule"><div><b>${type === 'shield' ? 'Weekend shield' : 'Rebalancer'}</b><button class="link" type="button" data-off="${esc(type)}">turn off</button></div>
      <p>${esc(ruleText(r))}</p><small>last run: ${r.last_run ? new Date(r.last_run).toLocaleString() : 'never'}</small></div>`).join('') : '';
    if (p.active || rules.length || approved.length) {
      html += `<div class="row">${p.active || rules.length ? '<button class="ghostbtn" type="button" id="runnow">Check rules now</button>' : ''}${p.active ? '<button class="ghostbtn danger" type="button" id="revoke">Revoke agent</button>' : ''}${approved.length ? `<button class="ghostbtn danger" type="button" id="unapprove" title="Approved: ${esc(approved.join(', '))}">Remove approvals</button>` : ''}</div>`;
    }
    el.innerHTML = html;
    $('#activate')?.addEventListener('click', (e) => activate(e.target));
    $('#discard')?.addEventListener('click', () => { W.draft = null; refreshAutomation(); });
    $('#unapprove')?.addEventListener('click', (e) => removeApprovals(e.target));
    $('#revoke')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await write(W.cfg.agentContract, AGENT, 'revokeAgent', [W.cfg.agent], 'Revoke'); toast('Agent revoked. It can no longer trade for you.', 'ok'); } catch (err) { toast(errText(err), 'error'); }
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
