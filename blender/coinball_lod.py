"""
Versi ringan bola koin untuk web.

Jalankan (setelah build_coinball.py):
  blender -b blender/coinball.blend -P blender/coinball_lod.py -- [RATIO]

Koin kecil di bola memakai mesh low-poly (Decimate); koin Bitcoin besar di depan tetap detail penuh.
Mesh detail penuh (Coin_<KEY>) tetap ikut di glb lewat objek tersembunyi di grup "HiRes"
supaya section lain (showcase, grow, dst.) masih memakainya. Hero di web membuang grup HiRes.
"""
import bpy, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RATIO = float(ARGS[0]) if ARGS else 0.16
scene = bpy.context.scene
ball = bpy.data.objects["CoinBall"]

hi = {me.name[5:]: me for me in bpy.data.meshes if me.name.startswith("Coin_")}
lo = {}
for key, me in hi.items():
    tmp = bpy.data.objects.new("tmp_" + key, me)
    scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new("dec", "DECIMATE")
    mod.ratio = RATIO
    dg = bpy.context.evaluated_depsgraph_get()
    m2 = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    m2.name = f"Lo_{key}"
    lo[key] = m2
    bpy.data.objects.remove(tmp)
    print(key, len(me.polygons), "->", len(m2.polygons))

for o in list(ball.children):
    if o.type == "MESH" and o.data.name.startswith("Coin_") and o.name != "BTC.hero":
        o.data = lo[o.data.name[5:]]

# simpan mesh detail penuh untuk section lain
holder = bpy.data.objects.new("HiRes", None)
scene.collection.objects.link(holder)
for key, me in hi.items():
    o = bpy.data.objects.new("hi_" + key, me)
    scene.collection.objects.link(o)
    o.parent = holder

for o in scene.objects:
    o.select_set(o in (ball, holder) or o.parent in (ball, holder))
bpy.ops.export_scene.gltf(
    filepath=str(ROOT / "web" / "assets" / "coinball.glb"),
    export_format="GLB", use_selection=True, export_animations=True, export_yup=True, export_normals=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
    export_draco_position_quantization=16, export_draco_normal_quantization=12, export_draco_texcoord_quantization=12,
)
print("SELESAI ratio", RATIO)
