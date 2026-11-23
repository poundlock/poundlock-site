# 墙：峡谷的岩壁（S4，扫描的岩石贴图加高度图起伏）和船闸的石墙（S5，一块块条石垒的，借老影片的石头材质）。
# 墙都竖在镜头对面（y 方向往里），从地面一直伸出画面顶上；交界带里墙往后退进水雾（y 加大），不会硬切。
import math
import random

import bpy
import numpy as np
from mathutils import Vector, noise

import reef_core as core
from reef_core import Graph, material, obj_from_arrays, rgba
from reef_coral import MATS, ao_darken, darker

from lockfilm import materials as film_mats  # noqa: E402
from lockfilm.util import Boxes  # noqa: E402


def wall_material(name, asset, size_m, sat=0.5, value=0.7, algae=(0.05, 0.09, 0.03), coralline=(0.42, 0.2, 0.25)):
    """水下的岩壁：扫描的岩石贴图（盒状投影），一块块暗绿的藻皮、粉色的珊瑚藻，缝里压暗。"""
    mat, g, bsdf, _ = material(name)
    vec = core.world_vector(g, size_m)
    color, rough, height = core.scan_layers(g, asset, vec)
    color = core.grade(g, color, sat, value)
    pos = g.position()
    a = g.smooth(g.noise(pos, 2.5, 4, 0.65), 0.55, 0.62)
    color = g.mix(g.math("MULTIPLY", a, 0.8), color, algae)
    c = g.smooth(g.noise(g.scaled(pos, (1, 1, 1), (7, 3, 1)), 3.5, 4, 0.65), 0.6, 0.66)
    color = g.mix(g.math("MULTIPLY", c, 0.6), color, coralline)
    color = ao_darken(g, color, 0.12, 0.15)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", g.math("MULTIPLY", rough, 1.0) if rough is not None else 0.85)
    if height is not None:
        g.put(bsdf, "Normal", g.bump(height, 0.8, 0.02))
    return mat


def rock_wall(name, x0, x1, z0, z1, y_fn, asset, size_m, mat, step=0.012, relief=0.06, seed=0):
    """一面岩壁：在 x–z 平面上的网格，每点往里推到 y_fn(x, z)，再加扫描高度图的起伏和大块的噪声。"""
    nx = int((x1 - x0) / step) + 1
    nz = int((z1 - z0) / step) + 1
    xs = np.linspace(x0, x1, nx)
    zs = np.linspace(z0, z1, nz)
    X, Z = np.meshgrid(xs, zs)
    Y = np.vectorize(y_fn)(X, Z)
    hm = core.heightmap(asset)
    h = core.sample(hm, X / size_m, Z / size_m)
    off = Vector((seed * 1.7, seed * 0.3, 0))
    big = np.vectorize(lambda x, z: noise.noise(Vector((x * 0.9, z * 0.9, 0)) + off) * 0.18 + noise.noise(Vector((x * 3.0, z * 3.0, 1.0)) + off) * 0.05)(X, Z)
    Y = Y + big - (h - 0.5) * relief
    verts = np.stack([X, Y, Z], axis=-1).reshape(-1, 3)
    idx = np.arange(nx * nz).reshape(nz, nx)
    # 法线朝镜头（-y）：面的绕向 x 往右、z 往上
    faces = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], axis=-1).reshape(-1, 4)
    return obj_from_arrays(name, verts, faces, mat)


def metal_mat():
    if "metal" not in MATS:
        MATS["metal"] = film_mats.metal("gate_metal", (0.05, 0.055, 0.05), rough=0.55, tarnish=0.8)
    return MATS["metal"]


def lock_stone_material(name="lock_stone"):
    """闸墙的条石：扫描的混凝土面，每块石头深浅、冷暖不一样（顶点上的 rnd），越往下藻越厚、越绿，缝里暗。"""
    mat, g, bsdf, _ = material(name)
    vec = core.world_vector(g, 2.0)
    color, rough, height = core.scan_layers(g, "concrete_floor_worn_02", vec)
    color = core.grade(g, color, 0.45, 0.6)
    rnd = g.attr("rnd")
    color = g.mix(g.math("MULTIPLY", rnd, 0.5), color, (0.12, 0.13, 0.1))
    pos = g.position()
    z = g.xyz(pos)[2]
    slime = g.math("MULTIPLY", g.smooth(z, 2.6, -0.2), g.smooth(g.noise(pos, 1.8, 4, 0.6), 0.2, 0.55))
    color = g.mix(g.math("MULTIPLY", slime, 0.85), color, (0.04, 0.06, 0.025))
    streak = g.smooth(g.noise(g.scaled(pos, (6.0, 6.0, 0.4)), 3.0, 3, 0.6), 0.55, 0.75)
    color = g.mix(g.math("MULTIPLY", streak, 0.5), color, (0.025, 0.03, 0.02))
    spots = g.smooth(g.noise(pos, 6.0, 3, 0.6), 0.62, 0.7)
    color = g.mix(g.math("MULTIPLY", spots, 0.5), color, (0.03, 0.05, 0.02))
    color = ao_darken(g, color, 0.06, 0.2)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", 0.8)
    if height is not None:
        g.put(bsdf, "Normal", g.bump(g.math("ADD", height, g.math("MULTIPLY", g.noise(pos, 30.0, 3, 0.6), 0.3)), 0.7, 0.01))
    return mat


def masonry_wall(name, x0, x1, y_fn, z0, z1, seed, culverts=(), course=0.34, ends=None):
    """船闸的石墙：一层层条石错缝垒起来（每块长短、进出、深浅不一样），底下隔一段留一个输水的廊道口。
    y_fn(x) 是墙面在 x 处的位置（交界带里往后退）。culverts：[(x 中心, 宽, 高), ...]。"""
    boxes = Boxes()
    rows = int((z1 - z0) / course) + 1
    lo, hi = ends if ends is not None else (x0 - 10.0, x1 + 10.0)
    for k in range(rows):
        # 每层自己的随机数（和从哪块开始搭无关），各块长条图里的石头一样
        rnd = random.Random(seed * 1000 + k)
        zc = z0 + (k + 0.5) * course
        x = lo - rnd.uniform(0.0, 0.5) - (0.4 if k % 2 else 0.0)
        while x < min(x1 + 0.6, hi):
            length = rnd.uniform(0.55, 1.15)
            a, b = max(x, lo), min(x + length, hi)
            x += length
            if b - a < 0.08 or b < x0 - 0.7 or a > x1 + 0.7:
                continue
            xc = (a + b) / 2
            hole = any(abs(xc - cx) < cw / 2 + (b - a) / 2 - 0.05 and zc < z0 + ch for cx, cw, ch in culverts)
            if not hole:
                yw = y_fn(xc) + rnd.uniform(-0.015, 0.02)
                boxes.add((xc, yw + 0.2, zc), (b - a - 0.014, 0.4, course - 0.014), rnd=rnd.random(), dz=1.5)
    # 石块后面垫一整块（石缝里不能透出后面的水）
    yb = y_fn((x0 + x1) / 2) + 0.38
    bx0, bx1 = max(x0 - 0.7, lo), min(x1 + 0.7, hi)
    if bx1 > bx0:
        boxes.add(((bx0 + bx1) / 2, yb, (z0 + z1) / 2), (bx1 - bx0, 0.06, z1 - z0), rnd=0.2, dz=2.0)
    # 墙端：一根比墙面凸出来的方柱
    if ends is not None:
        for e in ends:
            if x0 - 0.5 < e < x1 + 0.5:
                rnd = random.Random(seed + int(e * 10))
                for k in range(rows):
                    zc = z0 + (k + 0.5) * course
                    boxes.add((e, y_fn(e) + 0.1, zc), (0.42, 0.5, course - 0.014), rnd=rnd.random(), dz=1.5)
    mesh = boxes.mesh(name)
    obj = bpy.data.objects.new(name, mesh)
    core.collection("scene").objects.link(obj)
    if "lock_stone" not in MATS:
        MATS["lock_stone"] = lock_stone_material()
    mesh.materials.append(MATS["lock_stone"])
    bev = obj.modifiers.new("bevel", "BEVEL")
    bev.width = 0.012
    bev.segments = 2
    # 廊道口：里面是深的、黑的
    for i, (cx, cw, ch) in enumerate(culverts):
        b = Boxes()
        yb = y_fn(cx)
        b.add((cx, yb + 0.6, z0 + ch / 2), (cw, 0.8, ch), rnd=0.5, dz=2.0)
        m = b.mesh(f"{name}_culvert{i}")
        o = bpy.data.objects.new(m.name, m)
        core.collection("scene").objects.link(o)
        m.materials.append(dark_mat())
    return obj


def dark_mat():
    if "dark" not in MATS:
        mat, g, bsdf, _ = material("culvert_dark")
        g.put(bsdf, "Base Color", rgba((0.004, 0.006, 0.006)))
        g.put(bsdf, "Roughness", 0.9)
        MATS["dark"] = mat
    return MATS["dark"]


def steel_panel(name, x0, x1, y, z0, z1, ribs=0.3):
    """闸门的钢板：一张大板，横着一道道加劲肋，竖着两条边梁；贴在门龛里。"""
    b = Boxes()
    b.add(((x0 + x1) / 2, y + 0.02, (z0 + z1) / 2), (x1 - x0, 0.04, z1 - z0))
    z = z0 + ribs / 2
    while z < z1:
        b.add(((x0 + x1) / 2, y - 0.02, z), (x1 - x0, 0.05, 0.03))
        z += ribs
    for xe in (x0 + 0.04, x1 - 0.04):
        b.add((xe, y - 0.03, (z0 + z1) / 2), (0.08, 0.07, z1 - z0))
    m = b.mesh(name)
    o = bpy.data.objects.new(name, m)
    core.collection("scene").objects.link(o)
    m.materials.append(metal_mat())
    bev = o.modifiers.new("bevel", "BEVEL")
    bev.width = 0.006
    return o


def rungs(name, x, y, z0, z1, gap=0.3):
    """嵌在墙上的铁爬梯。"""
    from reef_coral import tubes_obj

    paths = []
    z = z0
    while z < z1:
        paths.append([(Vector((x - 0.2, y, z)), 0.012, 0.0), (Vector((x - 0.2, y - 0.12, z)), 0.012, 0.0), (Vector((x + 0.2, y - 0.12, z)), 0.012, 0.0), (Vector((x + 0.2, y, z)), 0.012, 0.0)])
        z += gap
    return tubes_obj(name, paths, metal_mat(), 8)
