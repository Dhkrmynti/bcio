# Koin berdiri miring di studio (gaya foto produk), logo timbul berbingkai dengan lekuk dalam,
# bidang beralur konsentris, tepi bergerigi dalam.
#   blender -b -P build_logo_coin_stand.py -- [--samples 256] [--res 1536] [--metal silver|gold] [--alpha 0|1]
import bpy, bmesh, json, math, sys
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default):
    return type(default)(ARGS[ARGS.index(name) + 1]) if name in ARGS else default
SAMPLES = arg("--samples", 256)
RES = arg("--res", 1536)
METAL = arg("--metal", "silver")
ALPHA = arg("--alpha", 0)
MARK = json.load(open(HERE / "mark_inset.json"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
lin = lambda c: tuple(((x / 255 + 0.055) / 1.055) ** 2.4 for x in c)

def link(o):
    scene.collection.objects.link(o)
    return o

TINT = {"silver": (0.86, 0.86, 0.88), "gold": (1.0, 0.70, 0.30)}[METAL]
DARK = {"silver": (0.10, 0.10, 0.11), "gold": (0.20, 0.10, 0.03)}[METAL]

def metal(name, r_lo, r_hi, grooves=0.0, dirt=1.6, aniso=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links; b = N["Principled BSDF"]
    b.inputs["Metallic"].default_value = 1.0
    tc = N.new("ShaderNodeTexCoord")
    nz = N.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 6; nz.inputs["Detail"].default_value = 6
    L.new(tc.outputs["Object"], nz.inputs["Vector"])
    rr = N.new("ShaderNodeMapRange"); rr.inputs["To Min"].default_value = r_lo; rr.inputs["To Max"].default_value = r_hi
    L.new(nz.outputs["Fac"], rr.inputs["Value"]); L.new(rr.outputs["Result"], b.inputs["Roughness"])
    ao = N.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = 0.02
    pw = N.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = dirt
    L.new(ao.outputs["AO"], pw.inputs[0])
    mix = N.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*DARK, 1); mix.inputs["B"].default_value = (*TINT, 1)
    L.new(pw.outputs[0], mix.inputs["Factor"]); L.new(mix.outputs["Result"], b.inputs["Base Color"])
    gr = N.new("ShaderNodeTexNoise"); gr.inputs["Scale"].default_value = 900; gr.inputs["Detail"].default_value = 2
    L.new(tc.outputs["Object"], gr.inputs["Vector"])
    bump = N.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.03; bump.inputs["Distance"].default_value = 0.0004
    L.new(gr.outputs["Fac"], bump.inputs["Height"]); last = bump
    if grooves:
        # alur piringan hitam: cincin konsentris rapat, sedikit bergelombang
        wv = N.new("ShaderNodeTexWave"); wv.wave_type = "RINGS"; wv.rings_direction = "Z"
        wv.wave_profile = "SIN"
        wv.inputs["Scale"].default_value = grooves; wv.inputs["Distortion"].default_value = 0.0
        wv.inputs["Detail"].default_value = 0.0
        L.new(tc.outputs["Object"], wv.inputs["Vector"])
        b2 = N.new("ShaderNodeBump"); b2.inputs["Strength"].default_value = 1.0; b2.inputs["Distance"].default_value = 0.005
        L.new(wv.outputs["Fac"], b2.inputs["Height"]); L.new(last.outputs["Normal"], b2.inputs["Normal"]); last = b2
    L.new(last.outputs["Normal"], b.inputs["Normal"])
    if aniso:   # sikat melingkar: kilau berbentuk busur seperti koin bubut
        b.inputs["Anisotropic"].default_value = aniso
        tg = N.new("ShaderNodeTangent"); tg.direction_type = "RADIAL"; tg.axis = "Z"
        L.new(tg.outputs["Tangent"], b.inputs["Tangent"])
    return m

M_RIM = metal("rim", 0.07, 0.13)
M_FIELD = metal("field", 0.20, 0.24, grooves=16, aniso=0.85)
M_LOGO = metal("logo", 0.05, 0.10, dirt=1.2)
M_RECESS = metal("recess", 0.34, 0.42, dirt=2.0, aniso=0.6)

# ---------------------------------------------------------------- badan koin
R, TH = 1.0, 0.17
TEETH, PER = 150, 8
SEG = TEETH * PER
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=SEG, radius1=R, radius2=R, depth=TH)
caps = [f for f in bm.faces if len(f.verts) > 4]
for f in caps:
    bmesh.ops.inset_individual(bm, faces=[f], thickness=R * 0.075, depth=TH * 0.02)    # bingkai lebar, sedikit cembung
    bmesh.ops.inset_individual(bm, faces=[f], thickness=R * 0.012, depth=0)
    bmesh.ops.inset_individual(bm, faces=[f], thickness=R * 0.014, depth=-TH * 0.17)   # dinding turun ke bidang
    bmesh.ops.inset_individual(bm, faces=[f], thickness=R * 0.006, depth=0)
for f in caps: f.material_index = 1
bmesh.ops.poke(bm, faces=caps)
edges = [e for e in bm.edges if all(math.hypot(v.co.x, v.co.y) > R * 0.999 for v in e.verts) and abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6]
bmesh.ops.bevel(bm, geom=edges, offset=TH * 0.12, segments=3, affect="EDGES", profile=0.5)
# gerigi dalam: profil kotak membulat
for v in bm.verts:
    r = math.hypot(v.co.x, v.co.y)
    if r > R * 0.9995 and abs(v.co.z) < TH / 2 - 0.004:
        a = math.atan2(v.co.y, v.co.x) % (2 * math.pi)
        i = int(round(a / (2 * math.pi) * SEG)) % PER
        depth = (0, 0, 0.35, 1, 1, 1, 0.35, 0)[i]
        k = 1 - 0.018 * depth
        v.co.x *= k; v.co.y *= k
me = bpy.data.meshes.new("coin"); bm.to_mesh(me); bm.free()
me.materials.append(M_RIM); me.materials.append(M_FIELD)
for p in me.polygons: p.use_smooth = False
coin = link(bpy.data.objects.new("coin", me))
Z_FIELD = TH / 2 + TH * 0.02 - TH * 0.17

# ---------------------------------------------------------------- logo: bingkai timbul + lekuk dalam
MS = 0.60                      # setengah tinggi logo
H_LIP, H_IN = 0.06, 0.028      # tinggi bingkai dan dasar lekuk di atas bidang
def mark_obj(name, rings, height, bevel, mat):
    cd = bpy.data.curves.new(name, "CURVE"); cd.dimensions = "2D"; cd.fill_mode = "BOTH"
    cd.extrude = height / 2; cd.bevel_depth = bevel; cd.bevel_resolution = 4; cd.offset = -bevel
    for pts in rings:
        sp = cd.splines.new("POLY"); sp.points.add(len(pts) - 1); sp.use_cyclic_u = True
        for p, (x, y) in zip(sp.points, pts):
            p.co = (x * MS, y * MS, 0, 1)
    cd.materials.append(mat)
    o = link(bpy.data.objects.new(name, cd))
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o)
    for p in mesh.polygons: p.use_smooth = True
    mesh.set_sharp_from_angle(angle=math.radians(35))
    ob = link(bpy.data.objects.new(name, mesh)); ob.parent = coin
    ob.location = (0, 0, Z_FIELD + height / 2 - 0.002)
    return ob

for i, sh in enumerate(MARK["shapes"]):
    mark_obj(f"lip{i}", [sh["outer"]] + sh["inner"], H_LIP, 0.010, M_LOGO)
    if sh["inner"]:
        mark_obj(f"in{i}", sh["inner"], H_IN, 0.004, M_RECESS)

# ---------------------------------------------------------------- pose: berdiri, menghadap kanan-depan
POSE = arg("--pose", "stand")
coin.rotation_euler = (math.radians(90 - 4), 0, math.radians(32)) if POSE == "stand" else (math.radians(90 - 3), 0, 0)
coin.location = (0, 0, R)

# ---------------------------------------------------------------- studio beige
BG_TOP, BG_LOW = (164, 152, 134), (205, 194, 176)
def plane(name, loc, rot, size):
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me)); o.location = loc; o.rotation_euler = rot
    return o
# latar lengkung (cyc): lantai + dinding, warna gradasi lewat koordinat Z
bm = bmesh.new()
prof = [(-30, 0)] + [(6 * math.sin(t / 12 * math.pi / 2), 6 - 6 * math.cos(t / 12 * math.pi / 2)) for t in range(13)] + [(6, 30)]
rows = []
for x in (-40, 40):
    rows.append([bm.verts.new((x, y + 4, z)) for y, z in prof])
for j in range(len(prof) - 1):
    bm.faces.new((rows[0][j], rows[1][j], rows[1][j + 1], rows[0][j + 1]))
me = bpy.data.meshes.new("cyc"); bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
cyc = link(bpy.data.objects.new("cyc", me))
mb = bpy.data.materials.new("cyc"); mb.use_nodes = True; nt = mb.node_tree
pb = nt.nodes["Principled BSDF"]; pb.inputs["Roughness"].default_value = 0.9
tc = nt.nodes.new("ShaderNodeTexCoord"); sx = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(tc.outputs["Object"], sx.inputs[0])
cr = nt.nodes.new("ShaderNodeMapRange"); cr.inputs["From Min"].default_value = 0.0; cr.inputs["From Max"].default_value = 5.0
nt.links.new(sx.outputs["Z"], cr.inputs["Value"])
mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"
mx.inputs["A"].default_value = (*lin(BG_LOW), 1); mx.inputs["B"].default_value = (*lin(BG_TOP), 1)
nt.links.new(cr.outputs["Result"], mx.inputs["Factor"]); nt.links.new(mx.outputs["Result"], pb.inputs["Base Color"])
me.materials.append(mb)
if ALPHA:
    cyc.is_shadow_catcher = True

world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (*lin(BG_TOP), 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.12

def softbox(name, loc, size, power, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, "AREA"); l.shape = "RECTANGLE"; l.size, l.size_y = size
    l.energy = power; l.color = color
    o = link(bpy.data.objects.new(name, l)); o.location = loc
    o.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return o
softbox("key", (-4.5, -3.5, 5.5), (4, 3), 1300, (1.0, 0.97, 0.92))
softbox("fill", (-5, -1, 2.0), (2, 4), 300, (1.0, 0.98, 0.95))
softbox("top", (0, 1.5, 7), (5, 2), 500)

def panel(name, loc, size, strength, color=(1, 1, 1)):
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me)); o.location = loc; o.scale = (size[0] / 2, size[1] / 2, 1)
    o.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat("Z", "Y").to_euler()
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"]); e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1); e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    me.materials.append(m)
    o.visible_camera = False; o.visible_shadow = False
    return o
# pantulan: strip terang + bendera gelap supaya logam kontras
panel("strip_l", (-2.5, -6, 3.5), (1.2, 6), 5.0, (1.0, 0.97, 0.92))
# arah pantulan muka koin ~ (0.89, -0.47, 0.06): area gelap luas + gradasi terang di atasnya
panel("dark", (8, -4.2, 1.2), (8, 5), 0.45, (1.0, 0.95, 0.88))
panel("face_hi", (7.5, -4.0, 4.6), (7, 1.6), 3.5, (1.0, 0.97, 0.92))
panel("face_mid", (8.5, -1.0, 2.2), (1.2, 4), 2.0)
panel("strip_r", (5, 2, 2.0), (1.0, 5), 2.0)

# ---------------------------------------------------------------- kamera
cam = bpy.data.cameras.new("cam"); cam.lens = 112
co = link(bpy.data.objects.new("cam", cam)); scene.camera = co
co.location = (0.25, -9.6, 1.55)
co.rotation_euler = (Vector((0.05, 0, 1.0)) - co.location).to_track_quat("-Z", "Y").to_euler()
cam.dof.use_dof = True; cam.dof.focus_object = coin; cam.dof.aperture_fstop = 8
scene.render.resolution_x = scene.render.resolution_y = RES
scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.film_transparent = bool(ALPHA)
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = "GPU"
except Exception as e:
    print("GPU tidak tersedia:", e)

name = (f"coin-stand-{METAL}" if POSE == "stand" else f"coin-front-{METAL}") + ("-alpha" if ALPHA else "")
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "logo_coin_stand.blend"))
scene.render.image_settings.color_mode = "RGBA" if ALPHA else "RGB"
scene.render.filepath = str(HERE / f"{name}.png")
bpy.ops.render.render(write_still=True)
print("SELESAI", name)
