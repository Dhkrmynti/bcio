# BCIO engine

Engine lintas aset untuk terminal BCIO:
- data harga token saham Robinhood (NVDA, TSLA, QQQ) dan kripto (BTC, ETH, SOL, RENDER, TAO, FET),
- mesin korelasi dan lag,
- MCP server,
- agent Claude,
- eksekusi on-chain di Robinhood Chain testnet: basket, Weekend Shield otomatis (Fase 2), dan auto-rebalancer (Fase 3).

## Menjalankan

```bash
# 1. engine + terminal (analisis saja)
cd engine && npm install
cp .env.example .env          # isi ANTHROPIC_API_KEY
npm start                     # http://localhost:5191/terminal.html

# 2a. eksekusi di chain lokal (untuk mencoba tanpa wallet testnet)
anvil                          # terminal lain
cd contracts && ./deploy.sh local
cd ../engine && npm start

# 2b. eksekusi di Robinhood Chain testnet (46630)
#     wallet TESTING berisi ETH testnet: https://faucet.testnet.chain.robinhood.com
#     contracts/.testnet-wallet (gitignored) berisi DEPLOYER_PRIVATE_KEY wallet testing;
#     kalau file itu tidak ada, deploy.sh meminta key secara tersembunyi
cd contracts && ./deploy.sh testnet
cd ../engine && npm start
```

`deploy.sh` menulis `engine/deployments/<chainId>.json`, lalu mengisi `CHAIN` dan `KEEPER_PRIVATE_KEY` di `engine/.env`. Server hanya mendengarkan `127.0.0.1`. API key Claude dan key keeper tidak pernah dikirim ke browser.

## Cara kerja eksekusi

| Bagian | Isi |
|---|---|
| `contracts/src/BcioDesk.sol` | Desk testnet: oracle harga (diisi engine dari CoinGecko, kedaluwarsa setelah 1 jam), swap dan basket di harga oracle (fee 0.1%), faucet 10,000 tUSDC/hari, dan **policy agent** |
| `contracts/src/TestToken.sol` | Token uji tUSDC, tNVDA, tTSLA, tQQQ, tBTC, tETH, tSOL. Hanya desk yang bisa mint/burn |
| Policy agent (session key) | User memanggil `setAgent(agent, maxTradeUsd, maxDayUsd, expiry)`. Agent hanya bisa `executeFor` di antara token milik user sendiri, dalam batas per transaksi dan per hari, sampai kedaluwarsa. `revokeAgent` menghentikannya seketika. Batas ini dijaga kontrak |
| `src/chain.js` | viem: update harga oracle, baca portofolio dan policy, trade agent via `executeFor` (simulasi dulu, slippage maksimal 1%) |
| `src/automation.js` | Aturan per wallet. **shield**: saat Wall Street tutup dan BTC/ETH/SOL bergerak melewati ambang dalam 24 jam, jual X% tiap token saham ke tUSDC (ada cooldown). **rebalance**: kembali ke target bobot saat penyimpangan melewati band. Loop berjalan tiap menit; evaluasi per wallet berurutan supaya aturan tidak tereksekusi dua kali |
| Tanda tangan aturan | Aturan hanya disimpan kalau pesan `/api/rules/prepare` ditandatangani wallet pemiliknya (tanpa gas). Tanda tangan dari wallet lain ditolak |

Alur di terminal:
1. Connect wallet.
2. Ambil tUSDC dari faucet.
3. Minta basket ke agent, lalu klik "Approve basket" dan tanda tangani sendiri di wallet.
4. Minta Weekend Shield atau Rebalancer ke agent, lalu klik "Activate". Wallet meminta dua hal: transaksi `setAgent` dan tanda tangan aturan.
5. Lihat hasilnya di Activity. "Revoke agent" menghentikan semuanya.

## Tool agent / MCP (11)

`get_quotes`, `market_status`, `correlate`, `correlation_matrix`, `weekend_shield`, `propose_basket`, `get_portfolio`, `get_automation`, `draft_shield_rule`, `draft_rebalance_rule`, `run_automation_now`.

Tool `draft_*` hanya membuat draf. Mengaktifkan aturan selalu butuh tanda tangan user di UI.

```bash
npm run mcp     # MCP server (stdio)
```

## Tes

```bash
cd contracts && forge test            # 12 tes kontrak
cd engine && node test/e2e-local.mjs  # alur penuh di anvil (engine harus jalan dengan CHAIN=local)
```

## Batasan

- Testnet memakai token uji dan oracle BCIO sendiri, karena Robinhood Chain testnet belum punya DEX resmi. Harga yang dipakai tetap harga pasar asli.
- Bridge dari Solana/Base belum disambungkan; di testnet modalnya tUSDC dari faucet.
- Hari libur bursa AS belum dihitung. Data earnings belum ada.
- CoinGecko gratis membatasi request; isi `COINGECKO_API_KEY` untuk batas yang lebih longgar.
