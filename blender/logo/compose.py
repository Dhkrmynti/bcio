# Tempel render (RGBA, bayangan dari shadow catcher) di atas latar #f2f2f2 seperti gambar sumber.
import sys
from PIL import Image
src = Image.open(sys.argv[1]).convert("RGBA")
bg = Image.new("RGBA", src.size, (242, 242, 242, 255))
out = Image.alpha_composite(bg, src).convert("RGB")
out.save(sys.argv[2])
if len(sys.argv) > 3:
    out.resize((735, 490), Image.LANCZOS).save(sys.argv[3])
print(out.size)
