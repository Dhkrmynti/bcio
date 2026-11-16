// CA $BCIO di web publik. Diisi pemilik dari /studio; tersembunyi sampai CA disimpan.
// Menampilkan CA (dengan tombol copy), link Buy on Pons, dan total yang sudah di-burn.
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const big = (v) => {
  const n = Number(v || 0);
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
};

async function load() {
  let t;
  try { t = await (await fetch('/api/token', { cache: 'no-store' })).json(); } catch { return; }
  if (!t?.live || !t.ca) return;
  document.querySelectorAll('[data-ca]').forEach((el) => {
    const burned = Number(t.deadBalance || t.totals?.burned || 0);
    el.innerHTML = `
      <span class="ca-sym">$${t.symbol}</span>
      <button type="button" class="ca-addr" title="Copy contract address" aria-label="Copy contract address ${t.ca}"><code>${short(t.ca)}</code><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
      <a class="ca-buy" href="${t.buy}" target="_blank" rel="noopener">Buy</a>
      ${burned > 0 ? `<a class="ca-burn" href="${t.explorer}/token/${t.ca}?a=0x000000000000000000000000000000000000dEaD" target="_blank" rel="noopener" title="Tokens in the dead address">${big(burned)} burned</a>` : ''}`;
    el.hidden = false;
    const btn = el.querySelector('.ca-addr');
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(t.ca); } catch { /* clipboard blocked */ }
      const code = btn.querySelector('code');
      code.textContent = 'Copied';
      setTimeout(() => { code.textContent = short(t.ca); }, 1400);
    });
  });
}
load();
