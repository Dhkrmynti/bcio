#!/usr/bin/env bash
# Still sinematik BCIO: Z-Image Turbo (Hugging Face, lewat mflux lokal) lalu 4x Real-ESRGAN → _hf/*.jpg (2560x1440)
K=~/Documents/projek-token/bcio/konten-x/_src; cd $K/_render
export HF_HUB_OFFLINE=1
S="cinematic film still, photorealistic, warm gold and cream palette, soft volumetric haze, film grain, anamorphic lens, ultra detailed, no text, no letters, no logos, no numbers"
r(){ [ -f "$1.png" ] || mflux-generate-z-image --model mflux-community/z-image-turbo-mflux-q4 --steps 9 --seed "$2" --width 1024 --height 576 --prompt "$3, $S" --output "$1.png"; }
r hf01-closed 9101 "the grand facade of an old stock exchange building at night, tall columns, closed iron gates, empty wet street reflecting one warm streetlight"
r hf02-twin 9102 "two gold coins spinning in mid air side by side in a dark studio, motion blur on their edges, warm rim light, black background"
r hf03-desk 9103 "a lone trader desk at night, a glowing monitor with abstract candlestick shapes, city lights through a big window, warm amber lamp"
r hf04-sunday 9104 "an empty trading floor on a sunday morning, rows of desks and chairs pushed in, sunlight through tall windows, dust floating in the air"
r hf05-bridge 9105 "a long stone bridge at dusk joining two cities, classic skyscrapers on one bank and glowing futuristic towers on the other, calm river"
r hf06-shield 9106 "a polished golden shield standing upright in a storm, rain streaks, distant lightning, warm light catching the metal"
r hf07-fire 9107 "gold coins melting in a dark furnace, molten gold dripping, embers rising, intense orange glow against black"
r hf08-dawn 9108 "sunrise over a city skyline seen from a rooftop, golden light, low mist between buildings, calm and vast"
r hf09-kings 9109 "a gold chess king and a silver chess king facing each other on a marble chessboard, dramatic side light, dark background"
r hf10-seal 9110 "close up of a fountain pen signing paper beside a gold wax seal, warm desk lamp, shallow depth of field"
r hf11-vault 9111 "a massive round bank vault door slightly open in a dark marble hall, warm golden light spilling out onto the floor"
r hf12-ridge 9112 "layered mountain ridges at sunset in golden haze, the silhouettes rising and falling like a price chart"
for f in hf*.png; do case "$f" in *-x4.png) continue;; esac; o=$K/_hf/${f%.png}.jpg; [ -f "$o" ] && continue
  ~/.venvs/upscale/bin/python ~/Documents/projek-token/arsa/_tools/upscale.py "$f" "${f%.png}-x4.png" >/dev/null 2>&1 && ~/.venvs/upscale/bin/python -c "import cv2,sys;a=cv2.imread(sys.argv[1]);a=cv2.resize(a,(2560,1440),interpolation=cv2.INTER_AREA);cv2.imwrite(sys.argv[2],a,[cv2.IMWRITE_JPEG_QUALITY,88])" "${f%.png}-x4.png" "$o"; done
echo STILLS_DONE
