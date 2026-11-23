# 珊瑚礁上的东西：程序生成的珊瑚、海绵、海葵、海扇、海胆、海星，和沙地、礁石（用扫描贴图和 CC0 模型）。
# 尺寸都是真实的米数：鱼身长 0.3 米，鹿角珊瑚一丛 0.3–0.6 米高，脑珊瑚直径 0.2–0.5 米。
# 每个生成函数只建网格、挂材质，摆在哪由 scenes.py 定；顶点上存的 tip（0 根 1 梢）给材质分颜色，也给页面算摆动。
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, kdtree, noise

import reef_core as core
from reef_core import PI, Graph, material, obj_from_arrays, obj_from_bm, rgba

MATS = {}


# —— 公用的几何 ——
def icosphere_arrays(subdiv, radius=1.0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    verts = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces


def mesh_tri(name, verts, faces, mat, attrs=None, col="scene", origin=None):
    """建网格；给了 origin 就把物体原点放在那里（材质里的物体坐标以它为中心，比如桌面珊瑚的放射纹）。"""
    mesh = bpy.data.meshes.new(name)
    o = Vector(origin) if origin is not None else Vector((0, 0, 0))
    mesh.from_pydata([tuple(Vector(v) - o) for v in verts], [], faces)
    for key, values in (attrs or {}).items():
        a = mesh.attributes.new(key, "FLOAT", "POINT")
        a.data.foreach_set("value", np.asarray(values, dtype=np.float32))
    mesh.polygons.foreach_set("use_smooth", np.ones(len(mesh.polygons), dtype=bool))
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = o
    mesh.materials.append(mat)
    core.collection(col).objects.link(obj)
    return obj


def fbm(p, octaves=4, lac=2.0, gain=0.5):
    total, amp, freq = 0.0, 1.0, 1.0
    for _ in range(octaves):
        total += amp * noise.noise(p * freq)
        amp *= gain
        freq *= lac
    return total


def tubes_arrays(paths, sides=8, cap=True):
    """一组管子：paths 里每条是 [(点, 半径, tip), ...]。返回 顶点、四边形面（末端收成一点的用退化四边形）、tip。"""
    verts, faces, tips = [], [], []
    for path in paths:
        n = len(path)
        if n < 2:
            continue
        base = len(verts)
        prev_x = None
        for i, (p, r, t) in enumerate(path):
            p = Vector(p)
            a = Vector(path[min(i + 1, n - 1)][0]) - Vector(path[max(i - 1, 0)][0])
            z = a.normalized() if a.length > 1e-9 else Vector((0, 0, 1))
            x = (prev_x - z * prev_x.dot(z)) if prev_x is not None else z.orthogonal()
            if x.length < 1e-6:
                x = z.orthogonal()
            x.normalize()
            prev_x = x
            y = z.cross(x)
            for k in range(sides):
                ang = 2 * PI * k / sides
                verts.append(p + (x * math.cos(ang) + y * math.sin(ang)) * r)
                tips.append(t)
        for i in range(n - 1):
            for k in range(sides):
                a0 = base + i * sides + k
                a1 = base + i * sides + (k + 1) % sides
                faces.append((a0, a1, a1 + sides, a0 + sides))
        if cap:
            p, r, t = path[-1]
            d = (Vector(path[-1][0]) - Vector(path[-2][0])).normalized()
            tipv = len(verts)
            verts.append(Vector(p) + d * r * 0.9)
            tips.append(t)
            last = base + (n - 1) * sides
            for k in range(sides):
                faces.append((last + k, last + (k + 1) % sides, tipv, tipv))
    return verts, faces, tips


def tubes_obj(name, paths, mat, sides=8, col="scene"):
    verts, faces, tips = tubes_arrays(paths, sides)
    fixed = [f if f[2] != f[3] else f[:3] for f in faces]
    return mesh_tri(name, verts, fixed, mat, {"tip": tips}, col)


def skin_obj(name, verts, edges, radii, tvals, mat, subsurf=2, col="scene"):
    """骨架（点和边）加蒙皮修改器长出圆滑的枝杈，再细分；结果烘成普通网格，tip 按最近的骨架点抄过来。"""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], edges, [])
    obj = bpy.data.objects.new(name, mesh)
    core.collection(col).objects.link(obj)
    skin = obj.modifiers.new("skin", "SKIN")
    skin.use_smooth_shade = True
    skin.branch_smoothing = 0.6
    data = mesh.skin_vertices[0].data
    for i, r in enumerate(radii):
        data[i].radius = (r, r)
    data[0].use_root = True
    sub = obj.modifiers.new("sub", "SUBSURF")
    sub.levels = subsurf
    sub.render_levels = subsurf
    deps = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    obj.modifiers.clear()
    old = obj.data
    obj.data = baked
    bpy.data.meshes.remove(old)
    tree = kdtree.KDTree(len(verts))
    for i, v in enumerate(verts):
        tree.insert(Vector(v), i)
    tree.balance()
    tips = np.array([tvals[tree.find(v.co)[1]] for v in baked.vertices], dtype=np.float32)
    a = baked.attributes.new("tip", "FLOAT", "POINT")
    a.data.foreach_set("value", tips)
    baked.polygons.foreach_set("use_smooth", np.ones(len(baked.polygons), dtype=bool))
    baked.materials.append(mat)
    return obj


# —— 材质 ——
def ao_darken(g, color, dist=0.04, low=0.25):
    """缝里暗：环境光遮蔽乘到底色上。礁上的东西一层层叠着，缝隙和背光处要深下去才像真的。"""
    node = g.new("ShaderNodeAmbientOcclusion", {"samples": 8})
    g.put(node, "Distance", dist)
    k = g.remap(node.outputs["AO"], 0.0, 1.0, low, 1.0)
    return g.mix(1.0, color, k, blend="MULTIPLY")


def darker(c, k):
    return (c[0] * k, c[1] * k, c[2] * k)


def coral_material(name, base, tip, sub=0.2, rough=0.55, polyp=450.0, polyp_depth=0.6, mottle=0.3, sheen=0.0, knob=0.0, ao=0.05):
    """珊瑚：根部 base、梢 tip（按顶点的 tip 过渡），一块块深浅斑驳，表面一粒粒珊瑚虫的小坑，缝里压暗，带一点透光。"""
    mat, g, bsdf, _ = material(name)
    pos = g.position()
    t = g.attr("tip")
    color = g.mix(g.smooth(t, 0.0, 1.0), base, tip)
    m = g.noise(pos, 7.0, 4, 0.6)
    color = g.mix(g.math("MULTIPLY", g.smooth(m, 0.35, 0.75), mottle), color, darker(base, 0.5))
    cells = g.voronoi(pos, polyp)
    pits = g.smooth(cells, 0.04, 0.4)
    color = g.mix(g.math("MULTIPLY", g.math("SUBTRACT", 1.0, pits), 0.45), color, darker(base, 0.35))
    color = ao_darken(g, color, ao)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", rough)
    g.put(bsdf, "Subsurface Weight", sub)
    g.put(bsdf, "Subsurface Radius", (0.006, 0.003, 0.002))
    g.put(bsdf, "Subsurface Scale", 0.5)
    if sheen:
        g.put(bsdf, "Sheen Weight", sheen)
        g.put(bsdf, "Sheen Tint", rgba(tip))
    height = pits
    if knob:
        height = g.math("ADD", pits, g.math("MULTIPLY", g.noise(pos, 32.0, 3, 0.55), knob * 3.0))
    g.put(bsdf, "Normal", g.bump(height, polyp_depth, 0.002))
    return mat


def brain_material(name, ridge, groove):
    """脑珊瑚：沟回的脊亮、沟暗（几何上已经起伏，颜色按顶点上存的 groove 分），脊上细小的隔片纹，沟里压暗。"""
    mat, g, bsdf, _ = material(name)
    pos = g.position()
    gr = g.attr("groove")
    color = g.mix(g.smooth(gr, 0.25, 0.8), ridge, groove)
    m = g.noise(pos, 6.0, 3, 0.6)
    color = g.mix(g.math("MULTIPLY", g.smooth(m, 0.4, 0.7), 0.35), color, darker(groove, 0.8))
    septa = g.noise(pos, 900.0, 1, 0.5)
    color = ao_darken(g, color, 0.012, 0.35)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", 0.6)
    g.put(bsdf, "Subsurface Weight", 0.12)
    g.put(bsdf, "Subsurface Radius", (0.005, 0.003, 0.002))
    g.put(bsdf, "Subsurface Scale", 0.5)
    g.put(bsdf, "Normal", g.bump(septa, 0.3, 0.001))
    return mat


def table_material(name, base, tip):
    """桌面珊瑚：盘面上一道道从中心放射出去的细枝（极坐标里拉长的格子），边缘浅、中心深，底面暗。"""
    mat, g, bsdf, _ = material(name)
    co = g.xyz(g.new("ShaderNodeTexCoord").outputs["Object"])
    ang = g.math("ARCTAN2", co[1], co[0])
    r = g.math("SQRT", g.math("ADD", g.math("MULTIPLY", co[0], co[0]), g.math("MULTIPLY", co[1], co[1])))
    comb = g.new("ShaderNodeCombineXYZ")
    g.put(comb, 0, g.math("MULTIPLY", g.math("MULTIPLY", ang, r), 110.0))
    g.put(comb, 1, g.math("MULTIPLY", r, 22.0))
    vor = g.voronoi(comb.outputs[0], 1.0)
    streak = g.smooth(vor, 0.05, 0.5)
    t = g.attr("tip")
    color = g.mix(g.smooth(t, 0.2, 1.0), base, tip)
    color = g.mix(g.math("MULTIPLY", g.math("SUBTRACT", 1.0, streak), 0.5), color, darker(base, 0.4))
    color = ao_darken(g, color, 0.05, 0.2)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", 0.6)
    g.put(bsdf, "Subsurface Weight", 0.15)
    g.put(bsdf, "Subsurface Radius", (0.004, 0.002, 0.002))
    g.put(bsdf, "Normal", g.bump(streak, 0.6, 0.002))
    return mat


def fan_material(name, color, alpha_scale=190.0):
    """海扇：一张网，网眼是空的（透明），网线带点透光。"""
    mat, g, bsdf, out = material(name)
    co = g.new("ShaderNodeTexCoord").outputs["Object"]
    vor = g.new("ShaderNodeTexVoronoi", {"feature": "DISTANCE_TO_EDGE", "voronoi_dimensions": "3D"})
    g.put(vor, "Vector", g.scaled(co, (alpha_scale, alpha_scale * 0.35, alpha_scale * 0.6)))
    g.put(vor, "Scale", 1.0)
    edge = vor.outputs["Distance"]
    t = g.attr("tip")
    vein = g.smooth(edge, 0.17, 0.09)
    keep = g.math("MAXIMUM", vein, g.smooth(t, 0.04, 0.0))
    c = g.mix(g.smooth(t, 0.0, 1.0), darker(color, 0.55), color)
    g.put(bsdf, "Base Color", c)
    g.put(bsdf, "Roughness", 0.6)
    g.put(bsdf, "Subsurface Weight", 0.3)
    g.put(bsdf, "Subsurface Radius", (0.004, 0.002, 0.002))
    g.put(bsdf, "Subsurface Scale", 0.3)
    tree = mat.node_tree
    tr = g.new("ShaderNodeBsdfTransparent")
    mix = g.new("ShaderNodeMixShader")
    mix.name = "alpha_mix"
    g.put(mix, 0, keep)
    tree.links.new(tr.outputs[0], mix.inputs[1])
    tree.links.new(bsdf.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    mat["alpha_mix"] = "alpha_mix"
    return mat


def soft_material(name, base, tip, sub=0.45, rough=0.5, sheen=0.4):
    """软的东西（海葵触手、软珊瑚）：更透光，带一层绒感。"""
    mat, g, bsdf, _ = material(name)
    t = g.attr("tip")
    pos = g.position()
    color = g.mix(g.smooth(t, 0.2, 1.0), base, tip)
    stripe = g.noise(pos, 140.0, 1, 0.5)
    color = g.mix(g.math("MULTIPLY", g.smooth(stripe, 0.55, 0.7), 0.25), color, darker(tip, 1.1))
    color = ao_darken(g, color, 0.03, 0.4)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", rough)
    g.put(bsdf, "Subsurface Weight", sub)
    g.put(bsdf, "Subsurface Radius", (0.012, 0.006, 0.004))
    g.put(bsdf, "Subsurface Scale", 0.6)
    g.put(bsdf, "Sheen Weight", sheen)
    g.put(bsdf, "Sheen Tint", rgba(tip))
    g.put(bsdf, "Coat Weight", 0.15)
    g.put(bsdf, "Normal", g.bump(g.noise(pos, 300.0, 2, 0.5), 0.2, 0.001))
    return mat


def sponge_material(name, color):
    """海绵：表面一个个小孔、起伏的疙瘩，粗糙、不反光，缝里暗。"""
    mat, g, bsdf, _ = material(name)
    pos = g.position()
    pores = g.voronoi(pos, 160.0)
    holes = g.smooth(pores, 0.0, 0.25)
    big = g.noise(pos, 12.0, 3, 0.6)
    c = g.mix(g.smooth(big, 0.3, 0.7), darker(color, 0.7), color)
    c = g.mix(g.math("SUBTRACT", 1.0, holes), c, darker(color, 0.2))
    c = ao_darken(g, c, 0.04, 0.2)
    g.put(bsdf, "Base Color", c)
    g.put(bsdf, "Roughness", 0.9)
    g.put(bsdf, "Subsurface Weight", 0.08)
    lumps = g.noise(pos, 40.0, 3, 0.6)
    g.put(bsdf, "Normal", g.bump(g.math("ADD", holes, g.math("MULTIPLY", lumps, 0.6)), 0.9, 0.003))
    return mat


def make_materials():
    if "porites" in MATS:
        return
    MATS["star_ochre"] = coral_material("star_ochre", (0.5, 0.15, 0.03), (0.68, 0.26, 0.05), sub=0.15, polyp=300, polyp_depth=1.0, mottle=0.2)
    MATS["urchin_purple"] = coral_material("urchin_purple", (0.12, 0.025, 0.15), (0.28, 0.07, 0.32), sub=0.05, rough=0.35, polyp=300, mottle=0.1)
    MATS["porites"] = coral_material("porites", (0.3, 0.2, 0.08), (0.52, 0.4, 0.2), polyp=500, mottle=0.5, knob=0.8)
    MATS["porites_green"] = coral_material("porites_green", (0.18, 0.22, 0.09), (0.4, 0.42, 0.2), polyp=500, mottle=0.4, knob=0.8)
    MATS["brain"] = brain_material("brain", (0.55, 0.44, 0.2), (0.1, 0.14, 0.05))
    MATS["brain_rose"] = brain_material("brain_rose", (0.55, 0.3, 0.22), (0.14, 0.07, 0.05))
    MATS["staghorn"] = coral_material("staghorn", (0.3, 0.18, 0.07), (0.72, 0.62, 0.42), polyp=420, polyp_depth=0.9, ao=0.06)
    MATS["acro_blue"] = coral_material("acro_blue", (0.22, 0.19, 0.13), (0.16, 0.4, 0.85), polyp=420, polyp_depth=0.9, ao=0.04)
    MATS["acro_purple"] = coral_material("acro_purple", (0.22, 0.12, 0.15), (0.5, 0.22, 0.62), polyp=420, polyp_depth=0.9, ao=0.04)
    MATS["table"] = table_material("table", (0.08, 0.06, 0.03), (0.24, 0.18, 0.085))
    MATS["sponge_brown"] = sponge_material("sponge_brown", (0.32, 0.14, 0.08))
    MATS["rubble"] = coral_material("rubble", (0.42, 0.4, 0.34), (0.6, 0.57, 0.5), sub=0.0, rough=0.85, polyp=420, mottle=0.6)
    MATS["fan_purple"] = fan_material("fan_purple", (0.36, 0.05, 0.4))
    MATS["fan_orange"] = fan_material("fan_orange", (0.78, 0.28, 0.05))
    MATS["anemone"] = soft_material("anemone", (0.45, 0.4, 0.18), (0.72, 0.42, 0.5))
    MATS["anemone_mag"] = soft_material("anemone_mag", (0.42, 0.05, 0.18), (0.8, 0.32, 0.48))
    MATS["leather"] = soft_material("leather", (0.45, 0.36, 0.16), (0.68, 0.58, 0.34), sub=0.3, sheen=0.6)
    MATS["sponge_purple"] = sponge_material("sponge_purple", (0.26, 0.11, 0.38))
    MATS["sponge_yellow"] = sponge_material("sponge_yellow", (0.65, 0.42, 0.05))
    MATS["urchin"] = coral_material("urchin", (0.015, 0.012, 0.015), (0.04, 0.03, 0.05), sub=0.0, rough=0.3, polyp=300, mottle=0.0)
    MATS["star"] = coral_material("star", (0.06, 0.2, 0.62), (0.12, 0.3, 0.78), sub=0.15, polyp=300, polyp_depth=1.0, mottle=0.2)
    MATS["rock"] = core.scan_material("reef_rock", "rock_pitted_mossy", 0.6, sat=0.55, value=0.75, tint=(0.95, 0.82, 0.85), bump=0.8, bump_dist=0.006)
    for key, amount in (("fan_purple", 0.35), ("fan_orange", 0.35), ("anemone", 1.0), ("anemone_mag", 1.0), ("leather", 0.25)):
        MATS[key]["sway"] = amount
    MATS["rock_mossy"] = core.scan_material("rock_mossy", "rock_pitted_mossy", 0.8, sat=0.9, value=0.8, bump=0.9, bump_dist=0.008)
    MATS["rock_kelp"] = core.scan_material("rock_kelp", "low_tide_rocks", 1.2, sat=0.8, value=0.75, bump=0.9, bump_dist=0.01)
    MATS["rock2"] = core.scan_material("reef_rock2", "seaside_rock", 1.0, sat=0.7, value=1.0, bump=0.8, bump_dist=0.008)


# —— 珊瑚 ——
def boulder_coral(name, center, radius, seed, squash=0.7, mat="porites"):
    """块状珊瑚（滨珊瑚那种）：一团鼓包，大鼓包上叠小鼓包，底下埋进沙里。"""
    verts, faces = icosphere_arrays(5, 1.0)
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(0, 50), rnd.uniform(0, 50), rnd.uniform(0, 50)))
    out = []
    for v in verts:
        p = Vector(v)
        lumps = fbm(p * 1.6 + off, 3) * 0.22 + fbm(p * 5.0 + off, 3) * 0.05 + (abs(noise.noise(p * (radius / 0.025) + off)) - 0.3) * 0.012 / radius
        q = p * (1.0 + lumps)
        q.z = q.z * squash
        q.z = max(q.z, -0.25 * squash)
        out.append(Vector(center) + q * radius)
    return mesh_tri(name, out, faces, MATS[mat])


def brain_coral(name, center, radius, seed, squash=0.62, mat="brain"):
    """脑珊瑚：半球上一道道弯来弯去的沟回（几何上真的凹凸），沟的深浅存在 groove 里。"""
    sub = 7 if radius > 0.18 else 6
    verts, faces = icosphere_arrays(sub, 1.0)
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(0, 50), rnd.uniform(0, 50), rnd.uniform(0, 50)))
    freq = 0.011 / radius  # 沟回间距大约 1 厘米
    out, grooves = [], []
    for v in verts:
        p = Vector(v)
        warp = Vector((noise.noise(p * 2.2 + off), noise.noise(p * 2.2 + off + Vector((7, 0, 0))), noise.noise(p * 2.2 + off + Vector((0, 9, 0)))))
        q = p / freq + warp * 1.2
        n = noise.noise(q)
        a = min(1.0, abs(n) / 0.22)
        ridge = 1.0 - a * a * (3 - 2 * a)
        lump = fbm(p * 1.4 + off, 2) * 0.12
        r = 1.0 + lump + ridge * 0.03
        w = p * r
        w.z = w.z * squash
        w.z = max(w.z, -0.2 * squash)
        out.append(Vector(center) + w * radius)
        grooves.append(1.0 - ridge)
    return mesh_tri(name, out, faces, MATS[mat], {"groove": grooves})


def acropora(name, base, seed, height=0.4, spread=0.6, levels=5, radius=0.011, mat="staghorn", bushy=False):
    """鹿角珊瑚：骨架从底座一枝枝分叉往上长，越往上越细，蒙皮长出圆滑的枝；bushy 是矮密的伞房状。"""
    rnd = random.Random(seed)
    verts, edges, radii, tvals = [Vector(base)], [], [radius * 1.3], [0.0]

    def grow(idx, direction, length, r, level):
        p = verts[idx]
        seg = 3
        cur = idx
        d = direction.copy()
        for s in range(seg):
            d = (d + Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), rnd.uniform(-0.02, 0.1)))).normalized()
            q = verts[cur] + d * (length / seg)
            verts.append(q)
            radii.append(max(0.0025, r * (1 - 0.18 * (s + 1) / seg)))
            tvals.append(min(1.0, (level + (s + 1) / seg) / (levels + 0.5)))
            edges.append((cur, len(verts) - 1))
            cur = len(verts) - 1
        if level >= levels:
            return
        kids = 2 if rnd.random() < (0.55 if bushy else 0.7) else 3
        for _ in range(kids):
            nd = (d + Vector((rnd.uniform(-1, 1) * spread, rnd.uniform(-1, 1) * spread, rnd.uniform(0.0, 0.6)))).normalized()
            if nd.z < 0.2:
                nd.z = 0.2
                nd.normalize()
            grow(cur, nd, length * rnd.uniform(0.62, 0.82), r * 0.78, level + 1)

    trunks = rnd.randint(2, 4) if not bushy else rnd.randint(4, 7)
    for _ in range(trunks):
        d = Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 1.0)).normalized()
        grow(0, d, height * (0.32 if not bushy else 0.18), radius, 0)
    return skin_obj(name, verts, edges, radii, tvals, MATS[mat], subsurf=1)


def table_coral(name, base, seed, radius=0.3, mat="table"):
    """桌面珊瑚：短柄顶着一张平展的盘子，边缘起伏、往上翘；盘面上一道道放射的细纹（材质的珊瑚虫）。"""
    rnd = random.Random(seed)
    b = Vector(base)
    rings, segs = 26, 96
    h = rnd.uniform(0.12, 0.2)
    top, bot = [], []
    for i in range(rings + 1):
        rr = radius * (i / rings) ** 0.9
        rowt, rowb = [], []
        for j in range(segs):
            a = 2 * PI * j / segs
            edge = 1.0 + 0.12 * math.sin(a * 3 + seed) + 0.06 * math.sin(a * 7 + seed * 2)
            r = rr * edge
            u = i / rings
            z = h + 0.025 * u * u + 0.012 * math.sin(a * 5 + seed) * u
            thick = 0.007 * (1 - u) + 0.003
            p = b + Vector((math.cos(a) * r, math.sin(a) * r * 0.9, z))
            rowt.append((p, u))
            rowb.append((p - Vector((0, 0, thick)), u))
        top.append(rowt)
        bot.append(rowb)
    verts, tips, faces = [], [], []

    def grid(rows, flip):
        start = len(verts)
        for row in rows:
            for p, u in row:
                verts.append(p)
                tips.append(u)
        for i in range(rings):
            for j in range(segs):
                a0 = start + i * segs + j
                a1 = start + i * segs + (j + 1) % segs
                q = (a0, a1, a1 + segs, a0 + segs)
                faces.append(q[::-1] if flip else q)
        return start

    t0 = grid(top, False)
    b0 = grid(bot, True)
    last = rings * segs
    for j in range(segs):
        a0, a1 = t0 + last + j, t0 + last + (j + 1) % segs
        c0, c1 = b0 + last + j, b0 + last + (j + 1) % segs
        faces.append((a1, a0, c0, c1))
    # 柄
    stem = []
    for i in range(8):
        t = i / 7
        stem.append((b + Vector((0.004 * math.sin(t * 3), 0, h * t)), 0.035 * (1 - 0.35 * t), 0.0))
    sv, sf, st = tubes_arrays([stem], 12, cap=False)
    off = len(verts)
    verts += sv
    tips += st
    faces += [tuple(i + off for i in f) for f in sf]
    return mesh_tri(name, verts, faces, MATS[mat], {"tip": tips}, origin=b)


def sea_fan(name, base, seed, width=0.5, height=0.55, mat="fan_purple", yaw=0.0):
    """海扇：一张略弯的扇面（网眼是材质里的透明），加上从底座放射出去的几根主枝。"""
    rnd = random.Random(seed)
    b = Vector(base)
    rot = Matrix.Rotation(yaw, 3, "Z")
    rows, cols = 40, 60
    verts, tips, faces = [], [], []
    for i in range(rows + 1):
        u = i / rows
        for j in range(cols + 1):
            v = j / cols
            ang = (v - 0.5) * PI * 0.95
            edge = 0.88 + 0.12 * math.sin(v * 11 + seed) * math.sin(v * 5 + seed * 3)
            r = u * edge
            x = math.sin(ang) * r * width * 0.55
            z = math.cos(ang) * r * height + 0.02
            y = 0.06 * (x / width) ** 2 * 4 + 0.015 * math.sin(u * 6 + v * 9 + seed)
            verts.append(b + rot @ Vector((x, y, z)))
            tips.append(u)
    for i in range(rows):
        for j in range(cols):
            a0 = i * (cols + 1) + j
            faces.append((a0, a0 + 1, a0 + cols + 2, a0 + cols + 1))
    fan = mesh_tri(name, verts, faces, MATS[mat], {"tip": tips})
    paths = []
    for k in range(9):
        ang0 = (k / 8 - 0.5) * PI * 0.8
        path = []
        for s in range(14):
            u = s / 13
            ang = ang0 * (0.4 + 0.6 * u) + 0.05 * math.sin(u * 7 + k)
            x = math.sin(ang) * u * width * 0.5
            z = math.cos(ang) * u * height * 0.92 + 0.02
            y = 0.06 * (x / width) ** 2 * 4 + 0.004
            path.append((b + rot @ Vector((x, y, z)), 0.006 * (1 - 0.75 * u) + 0.0012, u))
        paths.append(path)
    tubes_obj(name + "_veins", paths, MATS[mat + "_veins"] if mat + "_veins" in MATS else veins_material(mat), 6)
    return fan


def veins_material(mat_name):
    mat, g, bsdf, _ = material(mat_name + "_veins")
    base = (0.3, 0.04, 0.33)
    if mat_name == "fan_orange":
        base = (0.68, 0.24, 0.04)
    g.put(bsdf, "Base Color", rgba(base))
    g.put(bsdf, "Roughness", 0.55)
    g.put(bsdf, "Subsurface Weight", 0.25)
    mat["sway"] = 0.35
    MATS[mat_name + "_veins"] = mat
    return mat


def anemone(name, base, seed, radius=0.1, count=180, mat="anemone"):
    """海葵：一截肉柱，顶上一圈圈触手（梢上鼓一个小泡），触手的 tip 给页面算摆动。"""
    rnd = random.Random(seed)
    b = Vector(base)
    col = []
    for i in range(10):
        t = i / 9
        col.append((b + Vector((0, 0, radius * 0.7 * t)), radius * (0.55 + 0.35 * t * t), 0.0))
    paths = []
    top = b + Vector((0, 0, radius * 0.7))
    for k in range(count):
        ang = rnd.random() * 2 * PI
        rr = radius * 0.85 * math.sqrt(rnd.random())
        start = top + Vector((math.cos(ang) * rr, math.sin(ang) * rr, 0))
        outward = Vector((math.cos(ang), math.sin(ang), 0)) * (0.3 + rr / radius * 0.9)
        dirv = (outward + Vector((0, 0, 1.0))).normalized()
        length = radius * rnd.uniform(0.6, 1.0)
        wob = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * 0.25
        path = []
        p = start.copy()
        n = 10
        for s in range(n):
            t = s / (n - 1)
            d = (dirv + wob * t + Vector((0, 0, -0.5 * t * t)) * (rr / radius)).normalized()
            if s > 0:
                p = p + d * length / (n - 1)
            bulb = math.exp(-((t - 0.86) / 0.1) ** 2)
            r = radius * 0.05 * (1 - 0.35 * t) * (1 + 0.65 * bulb)
            path.append((p.copy(), r, t))
        paths.append(path)
    body = tubes_obj(name + "_column", [col], MATS[mat], 20)
    return tubes_obj(name, paths, MATS[mat], 7)


def tube_sponge(name, base, seed, count=4, height=0.3, mat="sponge_purple", radius=(0.025, 0.04)):
    """管状海绵：几根口朝上的空心管，管壁有厚度，口沿圆。"""
    rnd = random.Random(seed)
    b = Vector(base)
    verts, faces, tips = [], [], []
    segs = 28
    for c in range(count):
        h = height * rnd.uniform(0.55, 1.0)
        r = rnd.uniform(*radius)
        lean = Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), 1.0))
        foot = b + Vector((rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), 0))
        rings = 18
        # 外壁往上、口沿翻过来、内壁往下：一条剖面绕一圈
        prof = []
        for i in range(rings):
            t = i / (rings - 1)
            prof.append((t * h, r * (0.85 + 0.25 * t) * (1 + 0.06 * math.sin(t * 9 + c) + 0.04 * math.sin(t * 23 + c * 3))))
        wall = 0.006 + r * 0.08
        prof.append((h + wall * 0.6, prof[-1][1] - wall * 0.5))
        for i in range(rings - 1, 3, -1):
            t = i / (rings - 1)
            prof.append((t * h, prof[i][1] - wall))
        start = len(verts)
        seed_off = Vector((c * 3.7 + seed % 97, seed % 89, 0.0))
        for z, rad in prof:
            for j in range(segs):
                a = 2 * PI * j / segs
                bend = lean * (z / h) ** 1.5 * h * 0.3
                ring = Vector((math.cos(a), math.sin(a), 0.0))
                # 表面疙疙瘩瘩：按位置的噪声往外推一点，桶状的加一道道竖棱；口沿也跟着不齐
                bumpy = 1.0 + 0.09 * noise.noise(ring * 3.0 + Vector((0, 0, z * 30.0)) + seed_off) + (0.05 * abs(math.sin(a * 9)) if r > 0.05 else 0.0)
                verts.append(foot + ring * rad * bumpy + Vector((bend.x, bend.y, z + 0.01 * h * noise.noise(ring * 2.0 + seed_off) * (z / h))))
                tips.append(min(1.0, z / h))
        n = len(prof)
        for i in range(n - 1):
            for j in range(segs):
                a0 = start + i * segs + j
                a1 = start + i * segs + (j + 1) % segs
                faces.append((a0, a1, a1 + segs, a0 + segs))
    return mesh_tri(name, verts, faces, MATS[mat], {"tip": tips})


def leather_coral(name, base, seed, radius=0.16, mat="leather"):
    """皮革珊瑚：一根粗柄顶着一张起皱的伞盖，盖边一道道褶。"""
    rnd = random.Random(seed)
    b = Vector(base)
    h = radius * rnd.uniform(0.7, 1.0)
    verts, faces, tips = [], [], []
    rings, segs = 22, 120
    for i in range(rings + 1):
        u = i / rings
        for j in range(segs):
            a = 2 * PI * j / segs
            fold = math.sin(a * 9 + seed) * 0.6 + math.sin(a * 17 + seed * 2) * 0.4
            r = radius * u * (1 + 0.06 * fold * u)
            z = h + 0.03 * radius * (1 - u * u) * 4 - 0.25 * radius * u ** 3 + 0.06 * radius * fold * u ** 2
            verts.append(b + Vector((math.cos(a) * r, math.sin(a) * r, z)))
            tips.append(u)
    for i in range(rings):
        for j in range(segs):
            a0 = i * segs + j
            a1 = i * segs + (j + 1) % segs
            faces.append((a0, a1, a1 + segs, a0 + segs))
    # 盖底
    off = len(verts)
    for i in range(rings + 1):
        u = i / rings
        for j in range(segs):
            p = verts[i * segs + j]
            verts.append(p - Vector((0, 0, 0.01 + 0.02 * (1 - u))))
            tips.append(u)
    for i in range(rings):
        for j in range(segs):
            a0 = off + i * segs + j
            a1 = off + i * segs + (j + 1) % segs
            faces.append((a0 + segs, a1 + segs, a1, a0))
    edge = rings * segs
    for j in range(segs):
        faces.append((edge + (j + 1) % segs, edge + j, off + edge + j, off + edge + (j + 1) % segs))
    stem = [(b + Vector((0, 0, h * t)), radius * (0.35 - 0.12 * t), 0.0) for t in np.linspace(0, 0.95, 8)]
    sv, sf, st = tubes_arrays([stem], 16, cap=False)
    o2 = len(verts)
    verts += sv
    tips += st
    faces += [tuple(i + o2 for i in f) for f in sf]
    return mesh_tri(name, verts, faces, MATS[mat], {"tip": tips})


def rubble(name, center, seed, count=5):
    """珊瑚碎块：断下来的鹿角珊瑚枝，横七竖八躺在沙上，半埋着。"""
    rnd = random.Random(seed)
    c = Vector(center)
    paths = []
    for k in range(count):
        p0 = c + Vector((rnd.uniform(-0.08, 0.08), rnd.uniform(-0.06, 0.06), rnd.uniform(-0.004, 0.004)))
        ang = rnd.uniform(0, 2 * PI)
        d = Vector((math.cos(ang), math.sin(ang), rnd.uniform(-0.05, 0.15))).normalized()
        length = rnd.uniform(0.03, 0.09)
        r0 = rnd.uniform(0.005, 0.01)
        path = []
        for s in range(5):
            t = s / 4
            bend = Vector((0, 0, 0.01 * math.sin(t * 3 + k)))
            path.append((p0 + d * length * t + bend, r0 * (1 - 0.3 * t), 0.3 + 0.4 * t))
        paths.append(path)
    return tubes_obj(name, paths, MATS["rubble"], 8)


def urchin(name, center, seed, radius=0.03, spines=140, mat="urchin", spine=(3.0, 5.5)):
    """海胆：壳上四面八方伸出刺。默认是礁上的长刺黑海胆；海藻林里的紫海胆刺短而密。"""
    rnd = random.Random(seed)
    c = Vector(center)
    verts, faces = icosphere_arrays(3, radius)
    body = mesh_tri(name + "_test", [c + Vector(v) * Vector((1, 1, 0.75)) for v in verts], faces, MATS[mat])
    paths = []
    for k in range(spines):
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), abs(rnd.gauss(0, 1)) + 0.2)).normalized()
        length = radius * rnd.uniform(*spine)
        p0 = c + d * radius * 0.9
        paths.append([(p0 + d * length * t, 0.0016 * (1 - t) + 0.0003, t) for t in (0.0, 0.5, 1.0)])
    return tubes_obj(name, paths, MATS[mat], 5)


def starfish(name, center, seed, radius=0.09, mat="star"):
    """海星：五条腕，贴着沙地微微起伏。"""
    rnd = random.Random(seed)
    c = Vector(center)
    rings, segs = 14, 150
    rot = rnd.uniform(0, 2 * PI)
    verts, faces, tips = [], [], []
    for i in range(rings + 1):
        u = i / rings
        for j in range(segs):
            a = 2 * PI * j / segs + rot
            arm = abs(math.cos(2.5 * (a - rot))) ** 6
            r = radius * u * (0.22 + 0.78 * arm)
            z = 0.012 * (1 - u ** 2) * (0.5 + 0.5 * arm) + 0.004
            verts.append(c + Vector((math.cos(a) * r, math.sin(a) * r, z)))
            tips.append(u)
    for i in range(rings):
        for j in range(segs):
            a0 = i * segs + j
            a1 = i * segs + (j + 1) % segs
            faces.append((a0, a1, a1 + segs, a0 + segs))
    return mesh_tri(name, verts, faces, MATS[mat], {"tip": tips})


# —— 沙地和礁石 ——
def floor_material(name, sand="sand_01", rubble="coral_gravel", sand_m=1.5, rubble_m=2.0, sand_tint=(1.0, 0.97, 0.9)):
    """沙地：白沙和珊瑚碎石两套扫描贴图，按顶点上的 rubble（0 沙 1 碎石）混；法线贴图走 UV。"""
    mat, g, bsdf, _ = material(name)
    uv = g.new("ShaderNodeTexCoord").outputs["UV"]
    pos = g.position()
    vs = g.scaled(pos, (1 / sand_m,) * 3)
    vr = g.scaled(pos, (1 / rubble_m,) * 3)
    sc, sr, _ = core.scan_layers(g, sand, vs, box=False)
    rc, rr, _ = core.scan_layers(g, rubble, vr, box=False)
    k = g.attr("rubble")
    sc = core.grade(g, sc, sat=0.45, value=1.35, tint=sand_tint)
    rc = core.grade(g, rc, sat=0.5, value=1.25)
    color = g.mix(k, sc, rc)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", g.mixf(k, sr, rr) if sr is not None and rr is not None else 0.9)
    ns = core.tex_node(g, sand, "nor_gl", vs, box=False)
    nr = core.tex_node(g, rubble, "nor_gl", vr, box=False)
    nmix = g.mix(k, ns.outputs["Color"], nr.outputs["Color"])
    nm = g.new("ShaderNodeNormalMap")
    g.put(nm, "Color", nmix)
    g.put(nm, "Strength", 0.8)
    g.put(bsdf, "Normal", nm.outputs[0])
    return mat


def floor(name, x0, x1, y0, y1, seed, step=0.004, sand="sand_01", rubble="coral_gravel", sand_m=1.5, rubble_m=2.0, rubble_fn=None, height_fn=None, col="scene", mat=None):
    """一大块沙地：高度 = 大起伏 + 扫描高度图（沙、碎石两套按 rubble 混）；UV 就是世界的 x、y（米）。"""
    nx = int((x1 - x0) / step) + 1
    ny = int((y1 - y0) / step) + 1
    xs = np.linspace(x0, x1, nx)
    ys = np.linspace(y0, y1, ny)
    X, Y = np.meshgrid(xs, ys)
    rnd = random.Random(seed)
    ph = [rnd.uniform(0, 6.28) for _ in range(6)]
    big = 0.025 * np.sin(X * 1.7 + ph[0]) * np.sin(Y * 1.3 + ph[1]) + 0.012 * np.sin(X * 4.1 + Y * 2.3 + ph[2])
    if height_fn is not None:
        big = big + height_fn(X, Y)
    if rubble_fn is not None:
        k = np.clip(rubble_fn(X, Y), 0.0, 1.0)
    else:
        k = np.zeros_like(X)
    hs = core.sample(core.heightmap(sand), X / sand_m, Y / sand_m)
    hr = core.sample(core.heightmap(rubble), X / rubble_m, Y / rubble_m)
    Z = big + (hs - 0.5) * 0.008 * (1 - k) + (hr - 0.5) * 0.03 * k
    verts = np.stack([X, Y, Z], axis=-1).reshape(-1, 3)
    idx = np.arange(nx * ny).reshape(ny, nx)
    faces = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], axis=-1).reshape(-1, 4)
    uvs = np.stack([X.ravel(), Y.ravel()], axis=-1)
    if mat is None:
        mat = MATS.get("floor") or floor_material("floor", sand, rubble, sand_m, rubble_m)
        MATS["floor"] = mat
    obj = obj_from_arrays(name, verts, faces, mat, col, uvs=uvs, attrs={"rubble": k.ravel()})
    return obj, (xs, ys, Z)


def floor_height(fl, x, y):
    xs, ys, Z = fl
    i = int(np.clip(np.searchsorted(ys, y), 1, len(ys) - 1))
    j = int(np.clip(np.searchsorted(xs, x), 1, len(xs) - 1))
    return float(Z[i, j])


_MODELS = {}


def model(asset):
    """导入一个 glTF 模型（只导一次），藏起来当模板；返回它的网格对象。"""
    if asset in _MODELS:
        return _MODELS[asset]
    path = f"{core.ASSETS}/{asset}/{asset}_2k.gltf"
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    mesh = next(o for o in new if o.type == "MESH")
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
    mesh.matrix_world = Matrix.Identity(4)
    _MODELS[asset] = mesh
    return mesh


_ZMIN = {}


def model_zmin(asset):
    if asset not in _ZMIN:
        mesh = model(asset).data
        co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
        _ZMIN[asset] = float(co[2::3].min())
    return _ZMIN[asset]


def rock(name, asset, center, size, seed, sink=0.25, mat=None):
    """一块礁石：CC0 模型按 size（最长边多少米）缩放、随机转一下、埋进沙里一截。"""
    src = model(asset)
    rnd = random.Random(seed)
    obj = bpy.data.objects.new(name, src.data)
    dims = src.dimensions
    s = size / max(dims)
    obj.scale = (s, s, s * rnd.uniform(0.7, 1.0))
    obj.rotation_euler = (0, 0, rnd.uniform(0, 2 * PI))
    zmin = model_zmin(asset)
    obj.location = (center[0], center[1], center[2] - zmin * s - sink * dims.z * s)
    core.collection("scene").objects.link(obj)
    if mat is not None:
        obj.material_slots[0].link = "OBJECT"
        obj.material_slots[0].material = mat
    return obj


# —— 跨段的地面 ——
def floor_set(g, spec, prefix):
    """一段的地面：两套扫描贴图按顶点上的 <prefix>m（0 用 a、1 用 b）混。返回 颜色、粗糙度、法线颜色。"""
    (ta, ma, ga), (tb, mb, gb) = spec["a"], spec["b"]
    pos = g.position()
    va = g.scaled(pos, (1 / ma,) * 3)
    vb = g.scaled(pos, (1 / mb,) * 3)
    ca, ra, _ = core.scan_layers(g, ta, va, box=False)
    cb, rb, _ = core.scan_layers(g, tb, vb, box=False)
    k = g.attr(prefix + "m")
    color = g.mix(k, core.grade(g, ca, **ga), core.grade(g, cb, **gb))
    rough = g.mixf(k, ra if ra is not None else 0.85, rb if rb is not None else 0.85)
    na = core.tex_node(g, ta, "nor_gl", va, box=False)
    nb = core.tex_node(g, tb, "nor_gl", vb, box=False)
    normal = g.mix(k, na.outputs["Color"], nb.outputs["Color"])
    return color, rough, normal


def floor_material_multi(name, specs):
    """一块地面上几段（最多四段）的地面材质：一段段往上混，第 i 段混进去的比例是顶点上的 a{i}。"""
    mat, g, bsdf, _ = material(name)
    sets = [floor_set(g, spec, f"s{i}") for i, spec in enumerate(specs)]
    color, rough, normal = sets[0]
    for i in range(1, len(sets)):
        a = g.attr(f"a{i}")
        color = g.mix(a, color, sets[i][0])
        rough = g.mixf(a, rough, sets[i][1])
        normal = g.mix(a, normal, sets[i][2])
    color = ao_darken(g, color, 0.03, 0.45)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", rough)
    nm = g.new("ShaderNodeNormalMap")
    g.put(nm, "Color", normal)
    g.put(nm, "Strength", 0.9)
    g.put(bsdf, "Normal", nm.outputs[0])
    return mat


class Floor:
    """一块跨段的地面：建网格，并能查任一点的高度（给摆东西用）。"""

    def __init__(self, xs, ys, Z):
        self.xs, self.ys, self.Z = xs, ys, Z

    def z(self, x, y):
        i = int(np.clip(np.searchsorted(self.ys, y), 1, len(self.ys) - 1))
        j = int(np.clip(np.searchsorted(self.xs, x), 1, len(self.xs) - 1))
        return float(self.Z[i, j])

    def zv(self, X, Y):
        i = np.clip(np.searchsorted(self.ys, Y), 1, len(self.ys) - 1)
        j = np.clip(np.searchsorted(self.xs, X), 1, len(self.xs) - 1)
        return self.Z[i, j]


def floor_multi(name, x0, x1, y0, y1, parts, step=0.005, col="scene"):
    """parts：[(这一段的权重函数 w(X), 这一段的地面 spec), ...]，最多四段。
    高度 = 各段（大起伏 + 两套高度图按 mask 混）按权重加起来；UV 就是世界的 x、y（米）。"""
    nx = int((x1 - x0) / step) + 1
    ny = int((y1 - y0) / step) + 1
    xs = np.linspace(x0, x1, nx)
    ys = np.linspace(y0, y1, ny)
    X, Y = np.meshgrid(xs, ys)
    weights = [np.vectorize(wfn)(X[0])[None, :] * np.ones_like(X) for wfn, _ in parts]
    total = sum(weights)
    total[total < 1e-6] = 1.0
    weights = [w / total for w in weights]
    Z = np.zeros_like(X)
    attrs = {}
    for i, ((_, spec), w) in enumerate(zip(parts, weights)):
        m = np.clip(spec["mask"](X, Y), 0.0, 1.0)
        (ta, ma, _), (tb, mb, _) = spec["a"], spec["b"]
        ha = core.sample(core.heightmap(ta), X / ma, Y / ma)
        hb = core.sample(core.heightmap(tb), X / mb, Y / mb)
        amp_a, amp_b = spec["amp"]
        h = spec["height"](X, Y) + (ha - 0.5) * amp_a * (1 - m) + (hb - 0.5) * amp_b * m
        Z += w * h
        attrs[f"s{i}m"] = m.ravel()
    # 材质里一段段往上混：第 i 段混进去的比例 = 它的权重 / 前 i+1 段的权重和
    acc = weights[0].copy()
    for i in range(1, len(parts)):
        acc = acc + weights[i]
        attrs[f"a{i}"] = np.where(acc > 1e-6, weights[i] / np.maximum(acc, 1e-6), 0.0).ravel()
    verts = np.stack([X, Y, Z], axis=-1).reshape(-1, 3)
    idx = np.arange(nx * ny).reshape(ny, nx)
    faces = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], axis=-1).reshape(-1, 4)
    uvs = np.stack([X.ravel(), Y.ravel()], axis=-1)
    mat = floor_material_multi(name + "_mat", [spec for _, spec in parts])
    obj_from_arrays(name, verts, faces, mat, col, uvs=uvs, attrs=attrs)
    return Floor(xs, ys, Z)


def clear_caches():
    MATS.clear()
    _MODELS.clear()
