# Koin emas dengan logo timbul (dari mark.json hasil trace), dirender seukuran gambar sumber.
#   blender -b -P build_logo_coin.py -- [--samples 256] [--scale 2]
# Hasil: logo-coin.png (2x, 1470x980) dan logo-coin-735.png (ukuran asli 735x490)
import bpy, bmesh, json, math, sys
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default):
    return type(default)(ARGS[ARGS.index(name) + 1]) if name in ARGS else default
SAMPLES = arg("--samples", 256)
SCALE = arg("--scale", 2)
MARK = json.load(open(HERE / "mark.json"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = lambda h: tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
lin = lambda c: tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

def link(o):
    scene.collection.objects.link(o)
    return o

# ---------------------------------------------------------------- material emas tempa
def gold(name, rough_lo, rough_hi, dirt, grain=0.05, rings=False, tint=(1.0, 0.72, 0.32)):
    """emas: kekasaran bervariasi, cekungan gelap seperti perunggu (AO), serat sikat halus,
    opsional cincin guilloche di bidang"""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links; b = N["Principled BSDF"]
    b.inputs["Metallic"].default_value = 1.0
    tc = N.new("ShaderNodeTexCoord")
    nz = N.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 9; nz.inputs["Detail"].default_value = 8
    L.new(tc.outputs["Object"], nz.inputs["Vector"])
    rr = N.new("ShaderNodeMapRange"); rr.inputs["To Min"].default_value = rough_lo; rr.inputs["To Max"].default_value = rough_hi
    L.new(nz.outputs["Fac"], rr.inputs["Value"]); L.new(rr.outputs["Result"], b.inputs["Roughness"])
    ao = N.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = 0.03
    mix = N.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (0.18, 0.09, 0.03, 1); mix.inputs["B"].default_value = (*tint, 1)
    pw = N.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = dirt
    L.new(ao.outputs["AO"], pw.inputs[0]); L.new(pw.outputs[0], mix.inputs["Factor"])
    L.new(mix.outputs["Result"], b.inputs["Base Color"])
    gr = N.new("ShaderNodeTexNoise"); gr.inputs["Scale"].default_value = 700; gr.inputs["Detail"].default_value = 2
    L.new(tc.outputs["Object"], gr.inputs["Vector"])
    bump = N.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = grain; bump.inputs["Distance"].default_value = 0.0005
    L.new(gr.outputs["Fac"], bump.inputs["Height"]); last = bump
    if rings:
        # guilloche rosette (dua pola silang) di dalam cincin logo, r < .575
        sx = N.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["Object"], sx.inputs[0])
        def M(op, a, b=None, v=None):
            n = N.new("ShaderNodeMath"); n.operation = op
            for k, x in enumerate((a, b)):
                if x is None: continue
                if isinstance(x, (int, float)): n.inputs[k].default_value = x
                else: L.new(x, n.inputs[k])
            return n.outputs[0]
        r = M("SQRT", M("ADD", M("MULTIPLY", sx.outputs["X"], sx.outputs["X"]), M("MULTIPLY", sx.outputs["Y"], sx.outputs["Y"])))
        th = M("ARCTAN2", sx.outputs["Y"], sx.outputs["X"])
        wob = M("MULTIPLY", M("SINE", M("MULTIPLY", th, 12.0)), 0.22)
        def band(sign):
            ph = M("ADD", M("MULTIPLY", r, 52.0), M("MULTIPLY", wob, sign))
            return M("SINE", M("MULTIPLY", ph, 2 * math.pi))
        h = M("MULTIPLY", M("ADD", band(1.0), band(-1.0)), 0.25)
        # zona: rosette di dalam .575, garis konsentris rapat .60-.70 di bawah sinar
        inner = M("LESS_THAN", r, 0.575)
        conc = M("MULTIPLY", M("SINE", M("MULTIPLY", r, 2 * math.pi * 140)), 0.25)
        zone2 = M("MULTIPLY", M("GREATER_THAN", r, 0.592), M("LESS_THAN", r, 0.70))
        hh = M("ADD", M("ADD", M("MULTIPLY", h, inner), M("MULTIPLY", conc, zone2)), 0.5)
        b2 = N.new("ShaderNodeBump"); b2.inputs["Strength"].default_value = 0.85; b2.inputs["Distance"].default_value = 0.0007
        L.new(hh, b2.inputs["Height"]); L.new(last.outputs["Normal"], b2.inputs["Normal"]); last = b2
    L.new(last.outputs["Normal"], b.inputs["Normal"])
    return m

M_RIM = gold("rim", 0.12, 0.22, 2.2)
M_FIELD = gold("field", 0.36, 0.42, 2.8, rings=True, tint=(0.62, 0.4, 0.15))   # bidang doff lebih gelap: logo menonjol
M_RELIEF = gold("relief", 0.13, 0.19, 1.4, grain=0.03, tint=(1.0, 0.76, 0.36))

# ---------------------------------------------------------------- koin dasar
R, TH, N_EDGE = 1.0, 0.15, 720
def coin_body():
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=N_EDGE, radius1=R, radius2=R, depth=TH)
    caps = [f for f in bm.faces if len(f.verts) > 4]
    for f in caps:
        bmesh.ops.inset_individual(bm, faces=[f], thickness=R * 0.045, depth=0)            # bingkai
        bmesh.ops.inset_individual(bm, faces=[f], thickness=R * 0.022, depth=-TH * 0.16)   # dinding ke bidang
        bmesh.ops.inset_individual(bm, faces=[f], thickness=R * 0.008, depth=0)
    for f in caps: f.material_index = 1                                                      # bidang tengah
    # pecah bidang tengah jadi kipas segitiga dari pusat (n-gon 720 sisi bikin garis artefak)
    bmesh.ops.poke(bm, faces=caps)
    # chamfer tepi luar lalu gerigi di dinding samping
    edges = [e for e in bm.edges if all(math.hypot(v.co.x, v.co.y) > R * 0.999 for v in e.verts) and abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6]
    bmesh.ops.bevel(bm, geom=edges, offset=TH * 0.14, segments=3, affect="EDGES", profile=0.5)
    for v in bm.verts:
        if math.hypot(v.co.x, v.co.y) > R * 0.9995 and abs(v.co.z) < TH / 2 - 1e-4:
            a = math.atan2(v.co.y, v.co.x)
            k = 1 - 0.008 * (int(round(a / (2 * math.pi) * N_EDGE)) % 2)
            v.co.x *= k; v.co.y *= k
    me = bpy.data.meshes.new("coin"); bm.to_mesh(me); bm.free()
    me.materials.append(M_RIM); me.materials.append(M_FIELD)
    for p in me.polygons: p.use_smooth = False
    o = link(bpy.data.objects.new("coin", me))
    return o

coin = coin_body()
Z_FIELD = TH / 2 - TH * 0.16

def ring(name, ro, ri, h, segs=360, mat=M_RELIEF):
    bm = bmesh.new()
    outer = [bm.verts.new((ro * math.cos(2 * math.pi * i / segs), ro * math.sin(2 * math.pi * i / segs), Z_FIELD + h)) for i in range(segs)]
    inner = [bm.verts.new((ri * math.cos(2 * math.pi * i / segs), ri * math.sin(2 * math.pi * i / segs), Z_FIELD + h)) for i in range(segs)]
    for i in range(segs):
        j = (i + 1) % segs; bm.faces.new((outer[i], outer[j], inner[j], inner[i]))
    ext = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    bmesh.ops.translate(bm, verts=[g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)], vec=(0, 0, -h - 0.004))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me)); o.parent = coin
    return o

# dua garis halus dekat bingkai, cincin manik, cincin dalam yang membingkai logo
ring("line_outer", 0.905, 0.897, 0.006)
ring("line_inner", 0.888, 0.880, 0.006)
bm = bmesh.new()
for i in range(120):
    a = 2 * math.pi * i / 120
    g = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.0115)
    bmesh.ops.scale(bm, vec=(1, 1, 0.75), verts=g["verts"])
    bmesh.ops.translate(bm, verts=g["verts"], vec=(0.855 * math.cos(a), 0.855 * math.sin(a), Z_FIELD))
me = bpy.data.meshes.new("beads"); bm.to_mesh(me); bm.free(); me.materials.append(M_RELIEF)
for p in me.polygons: p.use_smooth = True
o = link(bpy.data.objects.new("beads", me)); o.parent = coin
ring("frame", 0.815, 0.80, 0.012)
ring("frame_fine", 0.786, 0.781, 0.005)
# garis radial halus antara cincin dalam dan manik
bm = bmesh.new()
for i in range(144):
    a = 2 * math.pi * (i + 0.5) / 144
    r0, r1, w = 0.817, (0.838 if i % 2 else 0.832), 0.0028
    t = Vector((math.cos(a), math.sin(a), 0)); n = Vector((-t.y, t.x, 0))
    p = [t * r0 + n * w, t * r1, t * r0 - n * w]
    vs = [bm.verts.new((v.x, v.y, Z_FIELD - 0.002)) for v in p] + [bm.verts.new((v.x, v.y, Z_FIELD + 0.005)) for v in p]
    bm.faces.new((vs[0], vs[1], vs[2])); bm.faces.new((vs[5], vs[4], vs[3]))
    for q in range(3):
        j = (q + 1) % 3; bm.faces.new((vs[q], vs[3 + q], vs[3 + j], vs[j]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
me = bpy.data.meshes.new("ticks"); bm.to_mesh(me); bm.free(); me.materials.append(M_RELIEF)
o = link(bpy.data.objects.new("ticks", me)); o.parent = coin

# ---------------------------------------------------------------- detail ala medali THRIVE
# teks melingkar timbul, garis pemisah, sinar matahari, cincin dalam pembingkai logo
FONT = bpy.data.fonts.load("/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf")
PHRASE = "BCIO TERMINAL*STOCKS + CRYPTO*ROBINHOOD CHAIN*24/7*ONE BASKET, ONE SIGNATURE*"
TXT_R, CAP, TXT_H = 0.742, 0.05, 0.007
dg = bpy.context.evaluated_depsgraph_get()
glyphs = []
for ch in PHRASE:
    if ch == " ":
        glyphs.append((None, CAP * 0.42)); continue
    if ch == "*":
        glyphs.append(("*", CAP * 0.9)); continue
    cu = bpy.data.curves.new("g", "FONT"); cu.body = ch; cu.font = FONT
    cu.size = CAP / 0.71; cu.align_x = "CENTER"; cu.extrude = TXT_H / 2
    cu.bevel_depth = 0.0012; cu.bevel_resolution = 1; cu.offset = -0.0012
    o = link(bpy.data.objects.new("g", cu))
    bpy.context.view_layer.update()
    glyphs.append((o, o.dimensions.x))
total = sum(w for _, w in glyphs)
gap = (2 * math.pi * TXT_R - total) / len(glyphs)
s_acc = 0.0
dg = bpy.context.evaluated_depsgraph_get()
bm_sep = bmesh.new()
for o, w in glyphs:
    sc = s_acc + w / 2; s_acc += w + gap
    th = math.pi / 2 - sc / TXT_R
    if o == "*":   # bintang empat titik kecil sebagai pemisah
        t = Vector((math.cos(th), math.sin(th), 0)); n = Vector((-t.y, t.x, 0)); c = t * TXT_R
        pts = []
        for k in range(8):
            a = k * math.pi / 4; rr = 0.019 if k % 2 == 0 else 0.0055
            pts.append(c + (t * math.cos(a) + n * math.sin(a)) * rr)
        lo = [bm_sep.verts.new((p.x, p.y, Z_FIELD - 0.002)) for p in pts]
        hi = bm_sep.verts.new((c.x, c.y, Z_FIELD + 0.009))
        for k in range(8):
            bm_sep.faces.new((lo[k], lo[(k + 1) % 8], hi))
        continue
    if o is None: continue
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o)
    for p in me.polygons: p.use_smooth = False
    me.materials.clear(); me.materials.append(M_RELIEF)
    g = link(bpy.data.objects.new("glyph", me)); g.parent = coin
    g.location = (TXT_R * math.cos(th), TXT_R * math.sin(th) - 0 , Z_FIELD + TXT_H / 2 - 0.001)
    g.rotation_euler = (0, 0, th - math.pi / 2)
    # tengah vertikal huruf kapital di jari-jari teks
    g.location = Vector(g.location) - Vector((math.cos(th), math.sin(th), 0)) * (CAP / 2)
bmesh.ops.recalc_face_normals(bm_sep, faces=bm_sep.faces[:])
me = bpy.data.meshes.new("seps"); bm_sep.to_mesh(me); bm_sep.free(); me.materials.append(M_RELIEF)
o = link(bpy.data.objects.new("seps", me)); o.parent = coin

ring("txt_in", 0.708, 0.702, 0.006)
ring("txt_in2", 0.696, 0.694, 0.004)
# sinar matahari: 120 baji tipis, panjang berselang
bm = bmesh.new()
for i in range(120):
    a = 2 * math.pi * (i + 0.5) / 120
    r0, r1, w = 0.598, (0.688 if i % 2 == 0 else 0.655), (0.0034 if i % 2 == 0 else 0.0026)
    t = Vector((math.cos(a), math.sin(a), 0)); n = Vector((-t.y, t.x, 0))
    p = [t * r0, t * r1 + n * w, t * (r1 + 0.006), t * r1 - n * w]
    lo = [bm.verts.new((v.x, v.y, Z_FIELD - 0.002)) for v in p]
    hi = [bm.verts.new((v.x, v.y, Z_FIELD + 0.0045)) for v in p]
    bm.faces.new(hi[::-1]); bm.faces.new(lo)
    for q in range(4):
        j = (q + 1) % 4; bm.faces.new((lo[q], lo[j], hi[j], hi[q]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
me = bpy.data.meshes.new("rays"); bm.to_mesh(me); bm.free(); me.materials.append(M_RELIEF)
o = link(bpy.data.objects.new("rays", me)); o.parent = coin
ring("logo_ring", 0.592, 0.578, 0.014)
ring("logo_ring_fine", 0.571, 0.568, 0.004)
# 4 berlian kecil di arah mata angin di atas cincin logo
bm = bmesh.new()
for i in range(4):
    a = math.pi / 4 + i * math.pi / 2
    t = Vector((math.cos(a), math.sin(a), 0)); n = Vector((-t.y, t.x, 0)); c = t * 0.585
    pts = [c + t * 0.04, c + n * 0.02, c - t * 0.04, c - n * 0.02]
    lo = [bm.verts.new((p.x, p.y, Z_FIELD + 0.002)) for p in pts]
    hi = bm.verts.new((c.x, c.y, Z_FIELD + 0.03))
    bm.faces.new(lo[::-1])
    for k in range(4): bm.faces.new((lo[k], lo[(k + 1) % 4], hi))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
me = bpy.data.meshes.new("gems"); bm.to_mesh(me); bm.free(); me.materials.append(M_RELIEF)
o = link(bpy.data.objects.new("gems", me)); o.parent = coin

# ---------------------------------------------------------------- logo timbul
MARK_SCALE = 0.56            # setengah tinggi logo dalam satuan koin
H_MARK = 0.05
cd = bpy.data.curves.new("mark", "CURVE"); cd.dimensions = "2D"; cd.fill_mode = "BOTH"
cd.extrude = H_MARK / 2; cd.bevel_depth = 0.012; cd.bevel_resolution = 4; cd.resolution_u = 1
cd.offset = -0.012           # bevel tidak memperbesar bentuk
for sh in MARK["shapes"]:
    sp = cd.splines.new("POLY"); sp.points.add(len(sh["pts"]) - 1); sp.use_cyclic_u = True
    for pt, (x, y) in zip(sp.points, sh["pts"]):
        pt.co = (x * MARK_SCALE, y * MARK_SCALE, 0, 1)
mark = link(bpy.data.objects.new("mark", cd))
cd.materials.append(M_RELIEF)
mark.parent = coin
mark.location = (0, 0, Z_FIELD + H_MARK / 2)
bpy.context.view_layer.objects.active = mark
mark.select_set(True)
bpy.ops.object.convert(target="MESH")
for p in mark.data.polygons: p.use_smooth = True
mark.data.set_sharp_from_angle(angle=math.radians(40))

# koin sedikit miring supaya tebal dan geriginya terlihat
coin.rotation_euler = (math.radians(10), math.radians(-16), math.radians(2))

# ---------------------------------------------------------------- studio
BG = col("#f2f2f2")
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
wb = world.node_tree.nodes["Background"]; # lingkungan gelap hangat: emas butuh pantulan gelap supaya pekat dan kontras
wb.inputs["Color"].default_value = (0.07, 0.055, 0.04, 1); wb.inputs["Strength"].default_value = 1.0

# latar abu-abu muda menerima bayangan lembut
back = bpy.data.objects.new("back", bpy.data.meshes.new("back"))
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30); bm.to_mesh(back.data); bm.free()
link(back); back.location = (0, 0, -0.6)
mb = bpy.data.materials.new("back"); mb.use_nodes = True
mb.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*lin(BG), 1)
mb.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1
back.data.materials.append(mb)
back.is_shadow_catcher = True   # hanya bayangan; latar #f2f2f2 ditempel saat komposisi

def softbox(name, loc, size, power, color=(1, 1, 1), visible_cam=False):
    l = bpy.data.lights.new(name, "AREA"); l.shape = "RECTANGLE"; l.size, l.size_y = size
    l.energy = power; l.color = color
    o = link(bpy.data.objects.new(name, l)); o.location = loc
    d = Vector((0, 0, 0)) - Vector(loc); o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    o.visible_camera = visible_cam
    return o

softbox("key", (-3.5, 3.5, 5), (3, 2), 700, (1.0, 0.94, 0.86))
softbox("fill", (4, -1, 3.5), (1.5, 4), 160, (1.0, 0.98, 0.95))
softbox("rim", (2, 4, 1.5), (5, 1.2), 420)

# pantulan studio: panel emisif besar yang tidak terlihat kamera (memberi kontras pada emas)
def panel(name, loc, size, strength, color=(1, 1, 1)):
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1);
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me)); o.location = loc; o.scale = (size[0] / 2, size[1] / 2, 1)
    d = Vector((0, 0, 0)) - Vector(loc); o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"]); e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1); e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    me.materials.append(m)
    o.visible_camera = False; o.visible_shadow = False
    return o

panel("p_left", (-4, 2, 3.5), (2.5, 5), 6.0, (1.0, 0.95, 0.88))
panel("p_right", (4.5, 0.5, 2.5), (1.0, 6), 4.0)
panel("p_low", (0, -4.5, 1.2), (6, 1.4), 2.2, (1.0, 0.86, 0.62))
panel("p_top", (1, 3.5, 6), (3, 1.2), 3.0)
# softbox besar di belakang kamera: dipantulkan muka koin & logo (bagian yang menghadap kamera)
panel("p_front", (-1.0, 1.0, 16), (22, 16), 1.1, (1.0, 0.93, 0.82))
panel("p_front2", (2.5, -2.5, 15), (4, 3), 2.4, (1.0, 0.97, 0.92))

# ---------------------------------------------------------------- kamera & render
W, H = MARK["img"]
cam = bpy.data.cameras.new("cam"); cam.lens = 85
co = link(bpy.data.objects.new("cam", cam)); scene.camera = co
co.location = (0, 0, 9.2); co.rotation_euler = (0, 0, 0)
cam.sensor_fit = "VERTICAL"; cam.sensor_height = 24
# koin ±64% tinggi gambar
scene.render.resolution_x, scene.render.resolution_y = W * SCALE, H * SCALE
scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.film_transparent = True
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = "GPU"
except Exception as e:
    print("GPU tidak tersedia:", e)

bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "logo_coin.blend"))
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = str(HERE / "logo-coin-alpha.png")
bpy.ops.render.render(write_still=True)
print("SELESAI")
