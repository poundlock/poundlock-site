# 会随水摆的植物：海草（S2）、巨藻（S3）、河里的苦草（S7）、芦苇和睡莲的茎（S8）。
# 都是一大片一个网格，用 numpy 一次搭出来；顶点上的 tip（0 根 1 梢）给材质分颜色，也给页面算摆多少（材质上标 sway）。
import math
import random

import bpy
import numpy as np
from mathutils import Vector

import reef_core as core
from reef_core import Graph, material, obj_from_arrays, rgba
from reef_coral import MATS, ao_darken, darker, mesh_tri, tubes_arrays


def leaf_material(name, base, tip, translucent=0.35, spots=0.5, sway=1.0, rough=0.5):
    """叶片：根部深、梢浅，梢上一层附着的小白点（附生的藻），背光时透亮（混一层半透明）。"""
    mat, g, bsdf, out = material(name)
    pos = g.position()
    t = g.attr("tip")
    color = g.mix(g.smooth(t, 0.0, 1.0), base, tip)
    vein = g.noise(pos, 90.0, 2, 0.5)
    color = g.mix(g.math("MULTIPLY", g.smooth(vein, 0.45, 0.7), 0.25), color, darker(base, 0.7))
    dots = g.smooth(g.voronoi(pos, 420.0), 0.12, 0.0)
    color = g.mix(g.math("MULTIPLY", g.math("MULTIPLY", dots, g.smooth(t, 0.3, 1.0)), spots), color, (0.55, 0.55, 0.45))
    color = ao_darken(g, color, 0.03, 0.35)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", rough)
    g.put(bsdf, "Normal", g.bump(vein, 0.15, 0.001))
    tr = g.new("ShaderNodeBsdfTranslucent")
    g.put(tr, "Color", g.mix(1.0, color, (1.4, 1.5, 0.9), blend="MULTIPLY"))
    mix = g.new("ShaderNodeMixShader")
    g.put(mix, 0, translucent)
    tree = mat.node_tree
    tree.links.new(bsdf.outputs[0], mix.inputs[1])
    tree.links.new(tr.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    mat["sway"] = sway
    return mat


def ribbons(name, bases, dirs, lengths, widths, mat, segs=8, droop=0.35, twist=0.6, seed=0, col="scene", wavy=0.0, lean=(0.25, 0.75)):
    """一大把带状的叶子：每片从 bases[i] 往上长，朝 dirs[i]（水平方向）弯，越往梢越往下垂；梢收圆。"""
    rnd = np.random.default_rng(seed)
    n = len(bases)
    bases = np.asarray(bases, dtype=np.float64)
    dirs = np.asarray(dirs, dtype=np.float64)
    lengths = np.asarray(lengths, dtype=np.float64)
    widths = np.asarray(widths, dtype=np.float64)
    t = np.linspace(0.0, 1.0, segs + 1)
    lean = rnd.uniform(lean[0], lean[1], n)
    tw0 = rnd.uniform(0, 2 * math.pi, n)
    up = np.array([0.0, 0.0, 1.0])
    # 中线：竖直分量先快后慢，水平分量越往上越大（弯下去）
    horiz = lengths[:, None] * (lean[:, None] * t[None, :] + droop * t[None, :] ** 2)
    vert = lengths[:, None] * (t[None, :] - droop * 0.9 * t[None, :] ** 2 * lean[:, None])
    center = bases[:, None, :] + dirs[:, None, :] * horiz[:, :, None] + up[None, None, :] * vert[:, :, None]
    # 宽度方向：和弯的方向垂直、水平；沿叶片慢慢扭
    side = np.stack([-dirs[:, 1], dirs[:, 0], np.zeros(n)], axis=-1)
    ang = tw0[:, None] * 0.0 + twist * t[None, :] * np.sign(np.sin(tw0))[:, None]
    ca, sa = np.cos(ang), np.sin(ang)
    sdir = side[:, None, :] * ca[:, :, None] + dirs[:, None, :] * sa[:, :, None]
    taper = (1 - 0.25 * t) * np.sqrt(np.clip((1 - t) / 0.12, 0, 1)) + 0.02
    w = widths[:, None] * taper[None, :]
    if wavy:
        w = w * (1 + wavy * np.sin(t[None, :] * 40 + tw0[:, None]))
    left = center - sdir * w[:, :, None] / 2
    right = center + sdir * w[:, :, None] / 2
    verts = np.stack([left, right], axis=2).reshape(-1, 3)
    tips = np.repeat(np.tile(t, n), 2)
    per = (segs + 1) * 2
    i = np.arange(n)[:, None] * per + np.arange(segs)[None, :] * 2
    faces = np.stack([i, i + 1, i + 3, i + 2], axis=-1).reshape(-1, 4)
    return obj_from_arrays(name, verts, faces, mat, col, attrs={"tip": tips})


def seagrass_meadow(name, xa, xb, ya, yb, floor_z, density, seed, mat, spacing=0.045, length=(0.1, 0.24), width=(0.009, 0.013), length_fn=None, current=0.0, lean=(0.04, 0.28), droop=0.12, per=(3, 6)):
    """一片海草（泰来草那种）：按 spacing 的网格撒抖动过的株，density(x, y) 决定这一株要不要；每株 3 到 5 片叶。"""
    rnd = np.random.default_rng(seed)
    gx = np.arange(xa, xb, spacing)
    gy = np.arange(ya, yb, spacing)
    X, Y = np.meshgrid(gx, gy)
    X = X + rnd.uniform(-0.5, 0.5, X.shape) * spacing * 1.6
    Y = Y + rnd.uniform(-0.5, 0.5, Y.shape) * spacing * 1.6
    X, Y = X.ravel(), Y.ravel()
    keep = rnd.uniform(0, 1, X.shape) < np.clip(density(X, Y), 0, 1)
    X, Y = X[keep], Y[keep]
    bases, dirs, lens, wids = [], [], [], []
    for x, y in zip(X, Y):
        z = floor_z(x, y) - 0.004
        k = int(rnd.integers(per[0], per[1]))
        main = rnd.uniform(0, 2 * math.pi)
        tall = rnd.uniform(*length) * (length_fn(x) if length_fn else 1.0)
        for j in range(k):
            a = main + rnd.normal(0, 0.6)
            dx, dy = math.cos(a) * (1 - current) + current, math.sin(a) * (1 - current) + 0.1 * current
            nrm = math.hypot(dx, dy) or 1.0
            dirs.append((dx / nrm, dy / nrm, 0.0))
            bases.append((x + rnd.normal(0, 0.003), y + rnd.normal(0, 0.003), z))
            lens.append(tall * rnd.uniform(0.6, 1.0))
            wids.append(rnd.uniform(*width))
    if not bases:
        return None
    return ribbons(name, bases, dirs, lens, wids, mat, segs=10, droop=droop, seed=seed, lean=lean)


def kelp(name, base, seed, height=2.6, stipes=3, mats=None):
    """巨藻：一个根抱住石头，几根茎往上一直伸出画面，茎上隔一段长一片叶，叶根一个小气囊。"""
    rnd = random.Random(seed)
    b = Vector(base)
    paths, bladders = [], []
    blade_b, blade_d, blade_l, blade_w = [], [], [], []
    for s in range(stipes):
        lean = Vector((rnd.uniform(-0.15, 0.25), rnd.uniform(-0.1, 0.1), 1.0)).normalized()
        foot = b + Vector((rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), 0.0))
        h = height * rnd.uniform(0.8, 1.1)
        path = []
        n = 40
        ph = rnd.uniform(0, 6.28)
        for i in range(n):
            t = i / (n - 1)
            p = foot + lean * h * t + Vector((0.12 * math.sin(t * 2.3 + ph) * t, 0.05 * math.sin(t * 3.1 + ph), 0.0))
            path.append((p, 0.005 * (1 - 0.3 * t) + 0.002, t))
        paths.append(path)
        z = 0.15
        while z < h:
            t = z / h
            i = min(n - 2, int(t * (n - 1)))
            p = path[i][0]
            # 叶片被气囊托着往上漂，又被水流带向一边（+x）：方向偏向水流
            a = rnd.uniform(0, 2 * math.pi)
            d = (Vector((math.cos(a), math.sin(a) * 0.6, 0.0)) * 0.5 + Vector((1.0, 0.15, 0.0))).normalized()
            blade_b.append(tuple(p + d * 0.012))
            blade_d.append((d.x, d.y, 0.0))
            blade_l.append(rnd.uniform(0.28, 0.45))
            blade_w.append(rnd.uniform(0.035, 0.055))
            bladders.append((p + d * 0.02 + Vector((0, 0, 0.01)), t))
            z += rnd.uniform(0.07, 0.12)
    sv, sf, st = tubes_arrays(paths, 6, cap=True)
    fixed = [f if f[2] != f[3] else f[:3] for f in sf]
    stem = mesh_tri(name + "_stipe", sv, fixed, mats["stipe"], {"tip": st})
    blades = ribbons(name + "_blades", blade_b, blade_d, blade_l, blade_w, mats["blade"], segs=12, droop=0.1, twist=0.5, seed=seed, wavy=0.3, lean=(0.35, 0.8))
    # 气囊：小椭球，用很短的管子凑
    bp = []
    for p, t in bladders:
        bp.append([(p + Vector((0, 0, -0.012)), 0.002, t), (p + Vector((0, 0, -0.006)), 0.008, t), (p + Vector((0, 0, 0.006)), 0.008, t), (p + Vector((0, 0, 0.014)), 0.002, t)])
    bv, bf, bt = tubes_arrays(bp, 8, cap=True)
    bfixed = [f if f[2] != f[3] else f[:3] for f in bf]
    mesh_tri(name + "_bladders", bv, bfixed, mats["bladder"], {"tip": bt})
    return stem, blades


def reeds(name, base, seed, count=6, height=2.6, mat=None, spread=0.06):
    """一丛芦苇（或者别的挺水植物的茎）：几根直挺挺的细茎从泥里伸出来，一直穿出水面（画面顶上），带一点倾斜和节。"""
    rnd = random.Random(seed)
    b = Vector(base)
    paths = []
    for s in range(count):
        foot = b + Vector((rnd.uniform(-spread, spread), rnd.uniform(-spread, spread), -0.02))
        lean = Vector((rnd.uniform(-0.06, 0.1), rnd.uniform(-0.05, 0.05), 1.0)).normalized()
        h = height * rnd.uniform(0.85, 1.1)
        r0 = rnd.uniform(0.005, 0.008)
        path = []
        n = 24
        for i in range(n):
            t = i / (n - 1)
            node = 1.12 if (i % 6 == 0 and 0 < i < n - 1) else 1.0
            path.append((foot + lean * h * t, r0 * (1 - 0.25 * t) * node, t))
        paths.append(path)
    verts, faces, tips = tubes_arrays(paths, 8, cap=True)
    fixed = [f if f[2] != f[3] else f[:3] for f in faces]
    return mesh_tri(name, verts, fixed, mat or MATS["reed"], {"tip": tips})


def lily_stems(name, base, seed, count=4, surface=1.3, mat=None):
    """睡莲的叶柄：从泥里的根茎上长出来，软软地弯着伸到水面。"""
    rnd = random.Random(seed)
    b = Vector(base)
    paths = []
    for s in range(count):
        foot = b + Vector((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), -0.01))
        top = Vector((foot.x + rnd.uniform(-0.25, 0.35), foot.y + rnd.uniform(-0.15, 0.15), surface))
        ph = rnd.uniform(0, 6.28)
        path = []
        n = 30
        for i in range(n):
            t = i / (n - 1)
            p = foot.lerp(top, t) + Vector((0.08 * math.sin(t * 3.0 + ph) * math.sin(t * math.pi), 0.0, 0.0))
            path.append((p, 0.0035, t))
        paths.append(path)
    verts, faces, tips = tubes_arrays(paths, 6, cap=True)
    fixed = [f if f[2] != f[3] else f[:3] for f in faces]
    return mesh_tri(name, verts, fixed, mat or MATS["lily_stem"], {"tip": tips})


def make_materials():
    if "seagrass" in MATS:
        return
    MATS["seagrass"] = leaf_material("seagrass", (0.025, 0.07, 0.012), (0.18, 0.17, 0.05), translucent=0.3, spots=0.7, sway=1.0, rough=0.6)
    MATS["kelp_blade"] = leaf_material("kelp_blade", (0.2, 0.11, 0.025), (0.5, 0.36, 0.08), translucent=0.55, spots=0.1, sway=1.0, rough=0.35)
    MATS["kelp_stipe"] = leaf_material("kelp_stipe", (0.2, 0.12, 0.03), (0.42, 0.3, 0.07), translucent=0.3, spots=0.05, sway=0.7, rough=0.4)
    MATS["kelp_bladder"] = leaf_material("kelp_bladder", (0.25, 0.17, 0.04), (0.45, 0.33, 0.08), translucent=0.4, spots=0.0, sway=0.8, rough=0.25)
    MATS["vallis"] = leaf_material("vallis", (0.05, 0.16, 0.03), (0.22, 0.36, 0.08), translucent=0.45, spots=0.2, sway=1.0)
    MATS["reed"] = leaf_material("reed", (0.12, 0.13, 0.05), (0.28, 0.3, 0.12), translucent=0.2, spots=0.3, sway=0.25, rough=0.6)
    MATS["lily_stem"] = leaf_material("lily_stem", (0.22, 0.08, 0.04), (0.3, 0.22, 0.08), translucent=0.4, spots=0.1, sway=0.6, rough=0.4)


def kelp_mats():
    return {"stipe": MATS["kelp_stipe"], "blade": MATS["kelp_blade"], "bladder": MATS["kelp_bladder"]}
