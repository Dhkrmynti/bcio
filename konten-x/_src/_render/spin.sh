#!/usr/bin/env bash
# koin berputar (Blender, 90 frame transparan) → _assets/spin/*.webp; lalu still hf04 ulang
K=~/Documents/projek-token/bcio/konten-x/_src
B=$(ls -d /Applications/Blender*.app | head -1)/Contents/MacOS/Blender
mkdir -p $K/_render/spin_png $K/_assets/spin
"$B" -b -P ~/Documents/projek-token/bcio/blender/logo/build_logo_coin_stand.py -- --pose spin --alpha 1 --frames 90 --samples 48 --res 900 --metal gold --out $K/_render/spin_png 2>&1 | grep -E "SELESAI|Error"
python3 -c "
from PIL import Image; import glob,os
for f in sorted(glob.glob('$K/_render/spin_png/*.png')):
    i=int(os.path.basename(f)[:4]); Image.open(f).save('$K/_assets/spin/%03d.webp'%i, quality=88)
print('webp ok')"
cd $K/_render && export HF_HUB_OFFLINE=1 && rm -f hf04-sunday.png hf04-sunday-x4.png $K/_hf/hf04-sunday.jpg
mflux-generate-z-image --model mflux-community/z-image-turbo-mflux-q4 --steps 9 --seed 9124 --width 1024 --height 576 --prompt "an empty stock exchange trading floor on a sunday morning, rows of trading desks with dark monitors, chairs pushed in, a big blank ticker board on the wall, sunlight through tall arched windows, dust in the air, cinematic film still, photorealistic, warm gold and cream palette, soft volumetric haze, film grain, anamorphic lens, ultra detailed, no text, no letters, no logos, no numbers" --output hf04-sunday.png
~/.venvs/upscale/bin/python ~/Documents/projek-token/arsa/_tools/upscale.py hf04-sunday.png hf04-sunday-x4.png >/dev/null 2>&1 && ~/.venvs/upscale/bin/python -c "import cv2,sys;a=cv2.imread(sys.argv[1]);a=cv2.resize(a,(2560,1440),interpolation=cv2.INTER_AREA);cv2.imwrite(sys.argv[2],a,[cv2.IMWRITE_JPEG_QUALITY,88])" hf04-sunday-x4.png $K/_hf/hf04-sunday.jpg
echo SPIN_DONE
