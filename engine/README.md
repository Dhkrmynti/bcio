# BCIO engine

Engine lintas aset untuk terminal BCIO:
- data harga token saham Robinhood (NVDA, TSLA, QQQ) dan kripto (BTC, ETH, SOL, RENDER, TAO, FET),
- mesin korelasi dan lag,
- MCP server,
- agent Claude,
- eksekusi on-chain di **Robinhood Chain mainnet (4663)** dengan token asli: basket lewat Uniswap v3, Weekend Shield otomatis (Fase 2), dan auto-rebalancer (Fase 3).

## Menjalankan

```bash
cd engine && npm install
cp .env.example .env          # isi ANTHROPIC_API_KEY
npm start                     # http://localhost:5191/terminal.html
```

Tanpa langkah lain, terminal sudah membaca mainnet (saldo, harga Chainlink) dan basket bisa dieksekusi: user menandatangani swap Uniswap di wallet sendiri. Trade otomatis butuh kontrak `BcioAgent`:

```bash
cd contracts && ./deploy.sh   # DIJALANKAN PEMILIK: wallet deployer berisi sedikit ETH di Robinhood Chain
```

`deploy.sh` memeriksa semua alamat di chain, menjalankan tes di fork mainnet, membuat key agent khusus server (`engine/.env.mainnet`, gitignored), men-deploy, lalu menulis `engine/deployments/4663.json`. Isi alamat agent dengan sedikit ETH untuk gas, lalu `./deploy/deploy.sh` mengirim deployment dan key agent ke server. Server hanya mendengarkan `127.0.0.1`. API key Claude dan key agent tidak pernah dikirim ke browser.

## Alamat mainnet (diverifikasi on-chain)

| | Alamat | Sumber |
|---|---|---|
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | docs.robinhood.com/chain/contracts |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | docs.robinhood.com/chain/contracts |
| NVDA / TSLA / QQQ | `0xd0601CE1…9EEC` / `0x322F0929…3b2d` / `0xD5f38791…de68` | api.robinhood.com/rhj/assets |
| Uniswap SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` | Uniswap deployments/json/4663.json |
| Uniswap QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` | Uniswap deployments/json/4663.json |
| Chainlink feeds | lihat `src/chain.js` | dicek lewat `description()` di chain |

Pool yang dipakai (USDG): NVDA 0.05%, TSLA 0.3%, QQQ 0.05%, WETH 0.01% (pool terdalam per token).

## Cara kerja eksekusi

| Bagian | Isi |
|---|---|
| `contracts/src/BcioAgent.sol` | Izin agent **non-custodial**. User memanggil `setAgent(agent, maxTradeUsd, maxDayUsd, expiry, maxDeviationBps, tokens)`. Agent hanya bisa `executeFor` token ↔ USDG untuk token yang user izinkan; kontrak menarik `amountIn` dari user, swap di Uniswap, dan hasilnya langsung ke wallet user di transaksi yang sama. Batas per trade dan per hari dihitung dari harga Chainlink; output minimal = harga Chainlink dikurangi deviasi yang user izinkan. `revokeAgent` menghentikan seketika. Owner hanya bisa mengatur daftar token, tidak bisa menyentuh dana |
| Basket | Tidak lewat kontrak BCIO: browser membuat `SwapRouter02.multicall` berisi beberapa `exactInputSingle` (kuotasi QuoterV2, batas harga 1%), user menandatangani sendiri |
| `src/chain.js` | viem: harga Chainlink, saldo, policy, kuotasi Uniswap, trade agent via `executeFor` (simulasi dulu) |
| `src/automation.js` | Aturan per wallet. **shield**: saat Wall Street tutup dan BTC/ETH/SOL bergerak melewati ambang dalam 24 jam, jual X% tiap token saham ke USDG (ada cooldown). **rebalance**: kembali ke target bobot saat penyimpangan melewati band. Loop tiap menit; evaluasi per wallet berurutan |
| Tanda tangan aturan | Aturan hanya disimpan kalau pesan `/api/rules/prepare` ditandatangani wallet pemiliknya (tanpa gas) |

Feed Chainlink saham berhenti saat bursa tutup (24/5). Karena itu token saham diberi batas umur feed 4 hari di kontrak, dan user memilih deviasi maksimal (Weekend Shield biasanya 3–8%). Kalau harga pool di akhir pekan menyimpang lebih jauh dari harga penutupan Chainlink, trade dibatalkan.

Alur di terminal:
1. Connect wallet (Robinhood Chain ditambahkan otomatis). Wallet butuh USDG dan sedikit ETH untuk gas.
2. Minta basket ke agent, centang konfirmasi kelayakan, klik "Approve basket" dan tanda tangani di wallet.
3. Minta Weekend Shield atau Rebalancer, lalu "Activate": approve token ke kontrak agent, transaksi `setAgent`, lalu tanda tangan aturan.
4. Lihat hasilnya di Activity. "Revoke agent" dan "Remove approvals" menghentikan semuanya.

## Tool agent / MCP (11)

`get_quotes`, `market_status`, `correlate`, `correlation_matrix`, `weekend_shield`, `propose_basket`, `get_portfolio`, `get_automation`, `draft_shield_rule`, `draft_rebalance_rule`, `run_automation_now`.

Tool `draft_*` hanya membuat draf. Mengaktifkan aturan selalu butuh tanda tangan user di UI.

```bash
npm run mcp     # MCP server (stdio)
```

## Tes (fork mainnet lokal, tanpa transaksi sungguhan)

```bash
cd contracts && forge test --match-contract BcioAgentFork --fork-url https://rpc.mainnet.chain.robinhood.com   # 9 tes kontrak
cd engine && ./test/e2e-fork.sh   # alur penuh: basket, izin agent, shield, rebalancer, batas harian, revoke
```

## Batasan

- Kontrak `BcioAgent` belum diaudit pihak ketiga. Mulai dengan batas kecil.
- Token yang bisa diperdagangkan: NVDA, TSLA, QQQ, ETH (WETH) terhadap USDG. BTC, SOL dan koin AI hanya dianalisis (belum ada pool Uniswap v3 dengan likuiditas).
- Token saham Robinhood tidak ditawarkan ke orang AS dan dibatasi di beberapa negara lain (termasuk UK dan Kanada). Terminal meminta konfirmasi sebelum trade pertama.
- Bridge dari chain lain tidak disambungkan; user membawa USDG ke Robinhood Chain sendiri.
- Hari libur bursa AS belum dihitung. Data earnings belum ada.
- CoinGecko gratis membatasi request; isi `COINGECKO_API_KEY` untuk batas yang lebih longgar.
