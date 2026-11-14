"""
Bola koin emas untuk hero BCIO.

Jalankan:
  blender -b -P blender/build_coinball.py -- [--no-render]

Hasil:
  blender/coinball.blend          file Blender lengkap (bisa dibuka & diedit)
  web/assets/coinball.glb         model + animasi putar (looping) untuk three.js
  web/assets/coinball-poster.png  render Cycles (dipakai sebagai gambar cadangan)
"""
import bpy
import bmesh
import math
import random
import sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

ROOT = Path(__file__).resolve().parent.parent
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = "--no-render" not in ARGS
FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Black.ttf"

random.seed(21)

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 480          # 20 detik satu putaran penuh
FONT = bpy.data.fonts.load(FONT_PATH)

# ---------------------------------------------------------------- material
def gold(name, color, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = rough
    return m

MAT_BRIGHT = gold("GoldBright", (1.0, 0.66, 0.22), 0.2)
MAT_DARK = gold("GoldDark", (0.17, 0.10, 0.035), 0.5)

# ---------------------------------------------------------------- dimensi koin
SEG = 80          # segmen tepi (harus genap untuk gerigi)
R_EDGE = 1.0
R_REED = 0.982     # gerigi tepi
R_FIELD = 0.86     # batas bingkai
Z_RIM = 0.075
Z_FIELD = 0.048
RELIEF = 0.03      # tinggi relief di atas bidang


def coin_base():
    """Koin dasar: tepi bergerigi, bingkai timbul, bidang tengah agak cekung. Dua sisi."""
    bm = bmesh.new()
    rings = {}
    for side, s in (("top", 1), ("bot", -1)):
        edge, rim_in, field = [], [], []
        for i in range(SEG):
            a = 2 * math.pi * i / SEG
            r = R_EDGE if i % 2 == 0 else R_REED
            edge.append(bm.verts.new((r * math.cos(a), r * math.sin(a), s * Z_RIM)))
            rim_in.append(bm.verts.new((R_FIELD * math.cos(a), R_FIELD * math.sin(a), s * Z_RIM)))
            field.append(bm.verts.new((R_FIELD * math.cos(a), R_FIELD * math.sin(a), s * Z_FIELD)))
        rings[side] = (edge, rim_in, field)

    def quad(a, b, c, d, mat):
        f = bm.faces.new((a, b, c, d))
        f.material_index = mat
        return f

    for side in ("top", "bot"):
        edge, rim_in, field = rings[side]
        for i in range(SEG):
            j = (i + 1) % SEG
            quad(edge[i], edge[j], rim_in[j], rim_in[i], 0)       # permukaan bingkai
            quad(rim_in[i], rim_in[j], field[j], field[i], 0)     # dinding bingkai
        f = bm.faces.new(field)                                   # bidang tengah
        f.material_index = 1
    et, eb = rings["top"][0], rings["bot"][0]
    for i in range(SEG):
        j = (i + 1) % SEG
        quad(et[i], eb[i], eb[j], et[j], 0)                       # sisi gerigi
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------- bentuk relief
def add_prism(bm, pts, z0=Z_FIELD, h=RELIEF, mat=0, h_left=None):
    """Poligon 2D diekstrusi ke atas dari bidang koin."""
    bot = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z0 + (h if h_left is None or x >= 0 else h_left))) for x, y in pts]
    faces = [bm.faces.new(top), bm.faces.new(list(reversed(bot)))]
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((bot[i], bot[j], top[j], top[i])))
    for f in faces:
        f.material_index = mat
    return faces


def add_ring(bm, r_in, r_out, z0=Z_FIELD, h=RELIEF * 0.6, seg=56, mat=0):
    vb_in, vb_out, vt_in, vt_out = [], [], [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c, s = math.cos(a), math.sin(a)
        vb_in.append(bm.verts.new((r_in * c, r_in * s, z0)))
        vb_out.append(bm.verts.new((r_out * c, r_out * s, z0)))
        vt_in.append(bm.verts.new((r_in * c, r_in * s, z0 + h)))
        vt_out.append(bm.verts.new((r_out * c, r_out * s, z0 + h)))
    for i in range(seg):
        j = (i + 1) % seg
        for q in ((vt_in[i], vt_out[i], vt_out[j], vt_in[j]),
                  (vb_out[i], vt_out[i], vt_out[j], vb_out[j]),
                  (vb_in[j], vt_in[j], vt_in[i], vb_in[i])):
            bm.faces.new(q).material_index = mat


def ellipse(cx, cy, rx, ry, rot=0.0, n=14):
    c, s = math.cos(rot), math.sin(rot)
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        x, y = rx * math.cos(a), ry * math.sin(a)
        out.append((cx + x * c - y * s, cy + x * s + y * c))
    return out


def text_mesh(body, size):
    """Ubah teks menjadi mesh (sumbu Z = tebal relief), di tengah titik asal."""
    cu = bpy.data.curves.new("t", "FONT")
    cu.body = body
    cu.font = FONT
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = RELIEF / 2
    cu.resolution_u = 1
    ob = bpy.data.objects.new("t", cu)
    scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs = [v.co.x for v in me.vertices] or [0]
    return me, max(xs) - min(xs)


def append_mesh(bm, me, matrix, mat=0):
    me.transform(matrix)
    before = set(bm.faces)
    bm.from_mesh(me)
    for f in bm.faces:
        if f not in before:
            f.material_index = mat
    bpy.data.meshes.remove(me)


def add_text(bm, body, size, x=0.0, y=0.0):
    me, _ = text_mesh(body, size)
    append_mesh(bm, me, Matrix.Translation((x, y, Z_FIELD + RELIEF / 2)))


def add_arc_text(bm, body, radius=0.66, size=0.15, top=True):
    """Teks melengkung mengikuti bingkai (dibaca kiri ke kanan)."""
    glyphs = []
    for ch in body:
        if ch == " ":
            glyphs.append((None, size * 0.35))
            continue
        me, w = text_mesh(ch, size)
        glyphs.append((me, w))
    gap = size * 0.08
    total = sum(w for _, w in glyphs) + gap * (len(glyphs) - 1)
    span = total / radius
    sign = 1 if top else -1
    theta = math.pi / 2 + sign * span / 2 if top else -math.pi / 2 - span / 2
    cum = 0.0
    for me, w in glyphs:
        center = cum + w / 2
        if top:
            a = math.pi / 2 + span / 2 - center / radius
            rot = a - math.pi / 2
        else:
            a = -math.pi / 2 - span / 2 + center / radius
            rot = a + math.pi / 2
        cum += w + gap
        if me is None:
            continue
        m = (Matrix.Translation((radius * math.cos(a), radius * math.sin(a), Z_FIELD + RELIEF / 2))
             @ Matrix.Rotation(rot, 4, "Z"))
        append_mesh(bm, me, m)


def add_laurel(bm, radius=0.68):
    for s in (-1, 1):
        for k in range(7):
            a = math.radians(-90 + s * (28 + k * 13))
            cx, cy = radius * math.cos(a), radius * math.sin(a)
            tang = a + s * math.pi / 2
            for off in (-0.045, 0.045):
                rr = radius + off
                add_prism(bm, ellipse(rr * math.cos(a), rr * math.sin(a), 0.055, 0.022, tang + off * 10 * s, 8),
                          h=RELIEF * 0.7)


def add_bars(bm, y0=-0.42):
    for i, h in enumerate((0.08, 0.13, 0.19, 0.26)):
        x = -0.17 + i * 0.11
        add_prism(bm, [(x - 0.035, y0), (x + 0.035, y0), (x + 0.035, y0 + h), (x - 0.035, y0 + h)])


# ---------------------------------------------------------------- desain tiap koin
def g_bitcoin(bm):
    add_text(bm, "B", 0.78, 0.02, 0.0)
    for x in (-0.07, 0.07):
        add_prism(bm, [(x - 0.03, 0.27), (x + 0.03, 0.27), (x + 0.03, 0.39), (x - 0.03, 0.39)])
        add_prism(bm, [(x - 0.03, -0.39), (x + 0.03, -0.39), (x + 0.03, -0.27), (x - 0.03, -0.27)])


def g_ethereum(bm):
    add_prism(bm, [(0, 0.46), (0.28, 0.0), (0, -0.12), (-0.28, 0.0)], h_left=RELIEF * 0.55)
    add_prism(bm, [(0, -0.2), (0.28, -0.07), (0, -0.46), (-0.28, -0.07)], h_left=RELIEF * 0.55)


def g_solana(bm):
    for i, y in enumerate((0.2, 0.0, -0.2)):
        k = 0.1 if i != 1 else -0.1
        add_prism(bm, [(-0.32 + k, y - 0.06), (0.32 + k, y - 0.06), (0.32 - k, y + 0.06), (-0.32 - k, y + 0.06)])


def g_bnb(bm):
    d = lambda cx, cy, r: [(cx, cy + r), (cx + r, cy), (cx, cy - r), (cx - r, cy)]
    add_prism(bm, d(0, 0, 0.12))
    for cx, cy in ((0, 0.28), (0, -0.28), (0.28, 0), (-0.28, 0)):
        add_prism(bm, d(cx, cy, 0.075))


def g_xrp(bm):
    add_text(bm, "X", 0.72)


def g_doge(bm):
    add_text(bm, "Ð", 0.74, 0.02)


def g_cardano(bm):
    for count, r, size in ((6, 0.12, 0.045), (12, 0.27, 0.038), (6, 0.42, 0.03)):
        for i in range(count):
            a = 2 * math.pi * i / count + (math.pi / count if r > 0.2 else 0)
            add_prism(bm, ellipse(r * math.cos(a), r * math.sin(a), size, size, 0, 12))


def ticker(sym):
    def f(bm):
        add_text(bm, sym, 0.36 if len(sym) > 3 else 0.42, 0.0, 0.08)
        add_bars(bm)
    return f


DESIGNS = [
    # nama, teks lengkung, pembuat simbol, laurel?, bobot kemunculan
    ("BTC", "BITCOIN", g_bitcoin, True, 5),
    ("ETH", "ETHEREUM", g_ethereum, True, 3),
    ("SOL", "SOLANA", g_solana, True, 3),
    ("BNB", "BNB", g_bnb, True, 2),
    ("XRP", "XRP", g_xrp, True, 2),
    ("DOGE", "DOGE", g_doge, True, 2),
    ("ADA", "CARDANO", g_cardano, True, 2),
    ("TSLA", "TESLA", ticker("TSLA"), False, 1),
    ("AAPL", "APPLE", ticker("AAPL"), False, 1),
    ("AMZN", "AMAZON", ticker("AMZN"), False, 1),
    ("META", "META", ticker("META"), False, 1),
    ("NVDA", "NVIDIA", ticker("NVDA"), False, 1),
    ("QQQ", "INVESTMENT ETF", ticker("QQQ"), False, 1),
]

meshes = {}
for key, label, glyph, laurel, _w in DESIGNS:
    # relief dibuat sekali, lalu dipasang di muka depan dan belakang
    em = bmesh.new()
    add_ring(em, 0.815, 0.835)
    add_arc_text(em, label, radius=0.665, size=0.15 if len(label) < 10 else 0.12)
    glyph(em)
    if laurel:
        add_laurel(em)
    relief = bpy.data.meshes.new("relief")
    em.to_mesh(relief)
    em.free()
    bm = coin_base()
    append_mesh(bm, relief.copy(), Matrix.Identity(4))
    append_mesh(bm, relief, Matrix.Rotation(math.pi, 4, "Y"))
    me = bpy.data.meshes.new(f"Coin_{key}")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MAT_BRIGHT)
    me.materials.append(MAT_DARK)
    meshes[key] = me

# ---------------------------------------------------------------- susunan bola (tumpukan sisik)
# Koin dibuat cukup besar sehingga saling tumpang tindih seperti sisik dan sedikit
# miring. Tiap koin baru diangkat (jarak dari pusat) secukupnya sampai berada
# tepat di atas semua koin yang ditimpanya: tidak ada celah, tidak ada yang tembus.
pool = [k for k, *_rest, w in DESIGNS for _ in range(w)]
R_BASE = 6.6
MARGIN = 0.012
RIM = [(math.cos(2 * math.pi * k / 28), math.sin(2 * math.pi * k / 28)) for k in range(28)] + [(0.0, 0.0)]

ball = bpy.data.objects.new("CoinBall", None)
scene.collection.objects.link(ball)
ball.empty_display_size = 4

placed = []  # dict: c (pusat), u, v, n (sumbu lokal), s (jari-jari), h (setengah tebal)


def lift(d, u, v, n, s, h):
    """Jarak terkecil dari pusat bola supaya koin baru berada di atas tetangganya."""
    r = R_BASE
    for _ in range(3):
        need = R_BASE
        c = d * r
        for cj in placed:
            if (cj["c"].normalized() - d).length * R_BASE > (s + cj["s"]) * 1.08:
                continue
            # (a) titik bawah koin baru harus di atas permukaan atas koin lama
            dn = d.dot(cj["n"])
            if dn > 0.3:
                for cx, sy in RIM:
                    off = (u * cx + v * sy) * s - n * h
                    w = c + off - cj["c"]
                    if (w - cj["n"] * w.dot(cj["n"])).length > cj["s"]:
                        continue
                    need = max(need, (cj["h"] + MARGIN - (off - cj["c"]).dot(cj["n"])) / dn)
            # (b) tepi atas koin lama harus di bawah permukaan bawah koin baru
            dn2 = d.dot(n)
            for cx, sy in RIM:
                pnt = cj["c"] + (cj["u"] * cx + cj["v"] * sy) * cj["s"] + cj["n"] * cj["h"]
                w = pnt - c
                if (w - n * w.dot(n)).length > s:
                    continue
                need = max(need, (pnt.dot(n) + h + MARGIN) / dn2)
        r = need
    return r


def frame(d, tilt_deg, spin_deg):
    q = d.to_track_quat("Z", "Y")
    axis = q @ Vector((1, 0, 0))
    axis.rotate(Quaternion(d, random.uniform(0, 2 * math.pi)))
    return Quaternion(axis, math.radians(tilt_deg)) @ q @ Quaternion((0, 0, 1), math.radians(spin_deg))


def put(c):
    m = c["q"].to_matrix()
    u, v, n = m.col[0].copy(), m.col[1].copy(), m.col[2].copy()
    h = (Z_RIM + 0.006) * c["s"]
    r = lift(c["d"], u, v, n, c["s"], h)
    if r > R_BASE + c.get("max_lift", MAX_LIFT):
        return False
    placed.append({"c": c["d"] * r, "u": u, "v": v, "n": n, "s": c["s"], "h": h})
    ob = bpy.data.objects.new(c["name"], meshes[c["key"]])
    scene.collection.objects.link(ob)
    ob.parent = ball
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = c["q"]
    ob.location = c["d"] * r
    ob.scale = (c["s"],) * 3
    return True


N = 400
MAX_LIFT = 0.42
golden = math.pi * (3 - math.sqrt(5))
HERO_DIR = Vector((0.04, -1, 0.16)).normalized()
coins = []
for i in range(N):
    y = 1 - (i + 0.5) / N * 2
    rr = math.sqrt(1 - y * y)
    th = golden * i
    d = (Vector((rr * math.cos(th), rr * math.sin(th), y))
         + Vector((random.gauss(0, 0.035), random.gauss(0, 0.035), random.gauss(0, 0.035)))).normalized()
    if d.angle(HERO_DIR) < math.radians(5):
        continue
    coins.append({"d": d, "s": random.uniform(0.74, 0.92), "key": random.choice(pool),
                  "q": frame(d, random.uniform(2, 10), random.uniform(-22, 22)), "name": f"c.{i:03d}"})

# kelompokkan koin yang saling tumpang tindih ke lapisan berbeda (pewarnaan graf),
# lalu letakkan lapis demi lapis: tumpukan jadi rapat tapi tidak makin tinggi
nbr = [[j for j, b in enumerate(coins) if j != i and (a["d"] - b["d"]).length * R_BASE < (a["s"] + b["s"])]
       for i, a in enumerate(coins)]
order = sorted(range(len(coins)), key=lambda i: -len(nbr[i]))
color = {}
for i in order:
    used = {color[j] for j in nbr[i] if j in color}
    color[i] = next(k for k in range(99) if k not in used)
print("lapisan:", max(color.values()) + 1)
skipped = 0
for i in sorted(range(len(coins)), key=lambda i: (color[i], random.random())):
    c = coins[i]
    ok = False
    for attempt in range(4):
        if put(c):
            ok = True
            break
        # terlalu menonjol: coba koin lebih kecil & lebih datar
        c = dict(c, s=c["s"] * 0.88, q=frame(c["d"], 2, random.uniform(-20, 20)))
    skipped += not ok
print("dilewati:", skipped)

# ---- isi celah: koin diselipkan di BAWAH koin-koin di sekitarnya
def sink(d, u, v, n, s, h):
    """Jarak terbesar dari pusat supaya koin berada di bawah semua tetangganya."""
    r = R_BASE
    for _ in range(3):
        need = R_BASE + 0.3
        c = d * r
        for cj in placed:
            if (cj["c"].normalized() - d).length * R_BASE > (s + cj["s"]) * 1.08:
                continue
            dn = d.dot(cj["n"])
            if dn > 0.3:
                for cx, sy in RIM:
                    off = (u * cx + v * sy) * s + n * h
                    w = c + off - cj["c"]
                    if (w - cj["n"] * w.dot(cj["n"])).length > cj["s"]:
                        continue
                    need = min(need, (-cj["h"] - MARGIN - (off - cj["c"]).dot(cj["n"])) / dn)
            dn2 = d.dot(n)
            for cx, sy in RIM:
                pnt = cj["c"] + (cj["u"] * cx + cj["v"] * sy) * cj["s"] - cj["n"] * cj["h"]
                w = pnt - c
                if (w - n * w.dot(n)).length > s:
                    continue
                need = min(need, (pnt.dot(n) - h - MARGIN) / dn2)
        r = need
    return r


def covered(d):
    return any((p["c"].normalized() - d).length * R_BASE < p["s"] * 0.62 for p in placed)


cands = []
M = 12000
for i in range(M):
    y = 1 - (i + 0.5) / M * 2
    rr = math.sqrt(1 - y * y)
    th = golden * i
    cands.append(Vector((rr * math.cos(th), rr * math.sin(th), y)))
random.shuffle(cands)
fillers = 0
for d in cands:
    if d.angle(HERO_DIR) < math.radians(10) or covered(d):
        continue
    for s_try in (0.8, 0.66, 0.52, 0.42):
        q = frame(d, random.uniform(0, 6), random.uniform(-20, 20))
        m = q.to_matrix()
        u, v, n = m.col[0].copy(), m.col[1].copy(), m.col[2].copy()
        h = (Z_RIM + 0.006) * s_try
        r = sink(d, u, v, n, s_try, h)
        if r >= R_BASE - 0.62:
            placed.append({"c": d * r, "u": u, "v": v, "n": n, "s": s_try, "h": h})
            ob = bpy.data.objects.new(f"f.{fillers:03d}", meshes[random.choice(pool)])
            scene.collection.objects.link(ob)
            ob.parent = ball
            ob.rotation_mode = "QUATERNION"
            ob.rotation_quaternion = q
            ob.location = d * r
            ob.scale = (s_try,) * 3
            fillers += 1
            break
print("pengisi celah:", fillers)

# Bitcoin utama paling akhir, jadi berada di atas semuanya
put({"d": HERO_DIR, "s": 1.9, "key": "BTC", "q": HERO_DIR.to_track_quat("Z", "Y"), "name": "BTC.hero", "max_lift": 9})
kept = len(placed)
rs = sorted(p["c"].length for p in placed)
print("jari-jari koin: min %.2f  median %.2f  max %.2f" % (rs[0], rs[len(rs) // 2], rs[-1]))

# inti gelap supaya tidak ada yang tembus pandang
core_bm = bmesh.new()
bmesh.ops.create_uvsphere(core_bm, u_segments=48, v_segments=24, radius=R_BASE - 0.7)
core_me = bpy.data.meshes.new("Core")
core_bm.to_mesh(core_me)
core_bm.free()
for poly in core_me.polygons:
    poly.use_smooth = True
core_me.materials.append(MAT_BRIGHT)
core = bpy.data.objects.new("Core", core_me)
scene.collection.objects.link(core)
core.parent = ball

# ---------------------------------------------------------------- animasi putar (looping)
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
ball.rotation_mode = "XYZ"
ball.rotation_euler = (0, 0, 0)
ball.keyframe_insert("rotation_euler", index=2, frame=1)
ball.rotation_euler = (0, 0, 2 * math.pi)
ball.keyframe_insert("rotation_euler", index=2, frame=481)

# ---------------------------------------------------------------- kamera, cahaya, render
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
scene.collection.objects.link(cam)
cam.data.lens = 70
cam.location = (0, -42, 4.4)
cam.rotation_euler = (math.radians(84), 0, 0)
scene.camera = cam


def area(name, loc, rot, energy, size, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, "AREA")
    l.energy = energy
    l.size = size
    l.color = color
    o = bpy.data.objects.new(name, l)
    o.location = loc
    o.rotation_euler = [math.radians(v) for v in rot]
    scene.collection.objects.link(o)


area("Key", (-8, -9, 9), (50, 0, -40), 2600, 7, (1, 0.95, 0.85))
area("Fill", (9, -7, 2), (80, 0, 50), 900, 8, (0.85, 0.88, 1))
area("Rim", (2, 9, 6), (-60, 0, 170), 1600, 6)
area("Top", (0, 0, 12), (0, 0, 0), 700, 10)

world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
nt = world.node_tree
bg = nt.nodes["Background"]
coord = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.35
ramp.color_ramp.elements[0].color = (0.06, 0.06, 0.07, 1)
ramp.color_ramp.elements[1].position = 0.7
ramp.color_ramp.elements[1].color = (0.95, 0.93, 0.98, 1)
nt.links.new(coord.outputs["Generated"], sep.inputs[0])
nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.8

scene.render.engine = "CYCLES"
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x = 1600
scene.render.resolution_y = 1600
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception as e:  # tetap jalan di CPU
    print("GPU tidak tersedia:", e)

(ROOT / "web" / "assets").mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "blender" / "coinball.blend"))

# ---------------------------------------------------------------- ekspor glTF
for o in scene.objects:
    o.select_set(o == ball or o.parent == ball)
bpy.ops.export_scene.gltf(
    filepath=str(ROOT / "web" / "assets" / "coinball.glb"),
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_yup=True,
)

if DO_RENDER:
    scene.frame_set(1)
    scene.render.filepath = str(ROOT / "web" / "assets" / "coinball-poster.png")
    bpy.ops.render.render(write_still=True)

print("SELESAI, koin terpakai:", kept)
