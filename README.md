# BCIO

Landing page BCIO, terminal AI agent untuk saham ter-tokenisasi dan kripto di Robinhood Chain, dengan bola koin emas 3D yang dibuat di Blender dan berputar terus (looping).

## Menjalankan

```bash
cd web && python3 -m http.server 5190
```

Buka http://localhost:5190.

## Terminal + agent (engine)

```bash
cd engine && npm install && npm start
```

Buka http://localhost:5191/terminal. Butuh `ANTHROPIC_API_KEY` di `engine/.env` (lihat `engine/.env.example`). Detail ada di `engine/README.md`.

## Isi proyek

| Path | Isi |
|---|---|
| `blender/build_coinball.py` | Script Blender. Membuat 13 desain koin (tepi bergerigi, bingkai timbul, relief di dua sisi), menyusunnya jadi bola tumpukan sisik yang rapat (koin saling menimpa tanpa tembus, celah diisi koin yang diselipkan di bawah, teks koin tegak), lalu memberi animasi putar 20 detik yang looping |
| `blender/coinball.blend` | Hasil scene Blender, bisa dibuka dan diedit langsung |
| `web/assets/coinball.glb` | Model + animasi yang dipakai di web |
| `web/assets/coinball-poster.png` | Render Cycles untuk preview (tidak dipakai di halaman) |
| `web/index.html`, `style.css`, `main.js` | Halaman. Bola koin dirender pakai three.js, hiasan putih (pegas, gelombang, cincin) dibuat langsung di three.js |
| `web/sections.js` | Section di bawah hero, menjelaskan engine BCIO (terminal AI saham + kripto di Robinhood Chain): semua aset (koin berganti desain sendiri), korelasi NVDA vs BTC, kalender 24/7, demo agent + 3 MCP, basket, FAQ, dan CTA. Scroll biasa; animasi tiap section mulai saat section terlihat. Angka di section landing adalah ilustrasi; terminal memakai data live |
| `web/terminal.html`, `terminal.css`, `terminal.js` | Terminal 3 panel: watchlist + matriks korelasi, chat agent, basket + weekend shield + status MCP. Butuh engine yang berjalan |
| `engine/` | Engine: data pasar, korelasi & lag, MCP server, agent Claude, eksekusi on-chain, Weekend Shield & rebalancer otomatis |
| `contracts/` | Kontrak Foundry: `BcioAgent` (izin agent non-custodial di Robinhood Chain mainnet, swap Uniswap v3, batas harga Chainlink). `deploy.sh` dijalankan pemilik |
| `web/gold.js` | Bahan bersama: studio pantulan, tekstur goresan, detail medali koin (manik, garis radial, tulisan melingkar, guilloche; dibuat sebagai tekstur normal di browser), setelan material emas, loader model |

## Membuat ulang bola koin

```bash
blender -b -P blender/build_coinball.py               # model + render poster
blender -b -P blender/build_coinball.py -- --no-render  # model saja (lebih cepat)
```

Yang bisa diubah di script:
- `DESIGNS`: desain koin dan seberapa sering tiap desain muncul.
- `N`, `R_BASE`: jumlah koin utama dan jari-jari bola. Ukuran koin ada di `random.uniform(0.74, 0.92)`.
- `scene.frame_end`: kecepatan putar. 480 frame = 20 detik.

Setelah membuat ulang model, naikkan angka `?v=` di `web/index.html` supaya browser tidak memakai file lama dari cache.

## Catatan

- Koin saham hanya memakai ticker (AAPL, TSLA, AMZN, META, NVDA, QQQ), tanpa logo perusahaan, karena logo itu merek dagang.
- Simbol kripto dibuat versi geometris sederhana, bukan logo resminya.
- Posisi semua objek 3D mengikuti elemen penanda `.anchor` di CSS. Untuk memindahkan bola atau hiasan, cukup ubah CSS-nya.
