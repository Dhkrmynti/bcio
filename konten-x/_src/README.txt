BCIO · kit konten X

konten-x/
  pre/          01-05  post pre-launch (PNG 3200x1800)
  post/         01-20  post after launch (PNG 3200x1800; angka live dari bcio.trade)
  video/        bcio-ca       video post CA: intro + rekaman layar asli bcio.trade + penutup dengan CA
                bcio-dex      milestone $20K market cap + DEX paid
                bcio-burn     100% supply dev di-burn
                bcio-lore, -coin, -board, -lag, -matrix, -shield, -basket, -rebalance, -mcp, -weekend   (after launch)
  captions.txt  semua caption, urut pre → CA → after → milestone → burn
  _src/         semua bahan dan tool pembuatnya

Urutan posting yang disarankan
  Pre launch (5-7 hari sebelum):  pre 01 → 05, satu per hari; selipkan video bcio-lore di tengah.
  Hari launch:                    video bcio-ca (pin), lalu post/01, lalu bcio-coin.
  Setelah launch (2-3 per hari):  selang-seling gambar dan video: post 02-20 dan video board, lag, matrix,
                                  shield, basket, rebalance, mcp, weekend. Post shield/weekend paling kena di Sabtu-Minggu.
  Saat MC $20K + DEX dibayar:     video bcio-dex.
  Setelah burn:                   isi token.json (burned, burnTx), render ulang burn, post video bcio-burn + link tx.

Render ulang (dari konten-x/_src/)
  FRESH=1 node _tools/data.mjs              ambil ulang data live (lalu node _tools/fillpairs.mjs kalau CoinGecko membatasi)
  node _tools/posts.mjs [p01 a03 ...]       gambar
  node _tools/render.mjs <scene> [out]      scene di _v.html: caintro caoutro lore coin board lag matrix shield basket rebalance mcp weekend paydex burn
  node _tools/demo.mjs                      video CA (butuh _parts/caintro.mp4 dan _parts/caoutro.mp4)
  ./_render/final.sh                        semuanya
Setelah launch: isi "ca" di token.json, lalu render ulang a01 a20, caoutro dan demo.
Setelah burn: isi "burned" (jumlah token) di token.json, render ulang burn.

Still sinematik di _hf/: Z-Image Turbo (Hugging Face, mflux lokal, seed 9101-9112) lalu 4x Real-ESRGAN, lihat _render/stills.sh.
Koin berputar di _assets/spin/: Blender (blender/logo/build_logo_coin_stand.py --pose spin).
