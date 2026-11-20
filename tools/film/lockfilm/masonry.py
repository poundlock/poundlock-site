# 石头砌的部分：闸墙、压顶石、岸上的石板、台阶、闸槛、河底，还有两岸的地。
# 墙是一块一块真的石头垒的（不是一面平墙贴图），每块的大小、进出、深浅都不一样。
import math
import random

import bpy
import numpy as np

from . import greens
from . import layout as lay
from .util import Boxes, assign, bevel, clouds, link, roughen, set_attr, shade_smooth

COURSE = 0.4  # 一层石头多高
JOINT = 0.012  # 石缝
NEAR = (-34.0, lay.N * lay.L + 70.0)  # 这一段的石头做得细（镜头会靠近）
SEEDS = {1: 3, -1: 8}  # 两侧地形各自的随机种子


def _wall_blocks(side, x0, x1, rng):
    """一侧闸墙在 [x0, x1] 这一段的石块。side 是 +1（左岸）或 -1（右岸）。"""
    boxes = Boxes()
    wet = []
    z_base = -lay.D - 0.6
    courses = int((lay.N * lay.R + lay.RIM - z_base) / COURSE) + 2
    for k in range(courses):
        z0 = z_base + k * COURSE
        x = x0 - rng.uniform(0.0, 0.9) - (0.45 if k % 2 else 0.0)
        while x < x1:
            length = rng.uniform(0.62, 1.35)
            xc = x + length / 2
            x += length
            if xc < x0 or xc > x1:
                continue
            if z0 + COURSE > lay.quay_top(xc) - lay.COPING + 0.02:
                continue
            if z0 + COURSE < lay.floor_z(xc) - 0.3:
                continue
            push = rng.uniform(-0.014, 0.012)
            depth = 0.5
            boxes.add(
                (xc, side * (lay.W / 2 + depth / 2 + push), z0 + COURSE / 2),
                (length - JOINT, depth, COURSE - JOINT),
                rnd=rng.random(),
            )
            wet.append(lay.full_level(xc))
    return boxes, wet


def _coping(side, x0, x1, rng):
    boxes = Boxes()
    wet = []
    cuts = [x0] + [s for s in lay.steps() if x0 < s < x1] + [x1]
    for a, b in zip(cuts, cuts[1:]):
        x = a
        while x < b - 0.2:
            length = min(rng.uniform(0.95, 1.5), b - x)
            xc = x + length / 2
            x += length
            top = lay.quay_top(xc)
            boxes.add(
                (xc, side * (lay.W / 2 - 0.035 + 0.3), top - lay.COPING / 2 + rng.uniform(-0.004, 0.004)),
                (length - JOINT, 0.6, lay.COPING),
                rnd=rng.random(),
            )
            wet.append(lay.full_level(xc) - 0.6)
    return boxes, wet


def _flags(side, x0, x1, rng, rows=4, row_w=0.78):
    """压顶石后面的石板路。"""
    boxes = Boxes()
    wet = []
    start = lay.W / 2 + 0.57
    cuts = [x0] + [s for s in lay.steps() if x0 < s < x1] + [x1]
    for a, b in zip(cuts, cuts[1:]):
        for r in range(rows):
            x = a - (0.5 if r % 2 else 0.0)
            while x < b - 0.1:
                length = rng.uniform(0.8, 1.5)
                xa, xb = max(x, a), min(x + length, b)
                x += length
                if xb - xa < 0.15:
                    continue
                top = lay.quay_top((xa + xb) / 2) - rng.uniform(0.0, 0.012)
                boxes.add(
                    ((xa + xb) / 2, side * (start + (r + 0.5) * row_w), top - 0.07),
                    (xb - xa - JOINT, row_w - JOINT, 0.14),
                    rnd=rng.random(),
                )
                wet.append(-50.0)
    return boxes, wet


def _risers(side, rng):
    """岸顶抬高一级的地方：一堵挡墙，靠水的一侧有石阶。"""
    boxes = Boxes()
    wet = []
    y0 = lay.W / 2 + 0.57
    y1 = y0 + 4 * 0.78
    for sx in lay.steps():
        low = lay.quay_top(sx - 0.1)
        high = lay.quay_top(sx + 0.1)
        z = low
        k = 0
        while z < high - 0.05:
            h = min(COURSE, high - 0.14 - z)
            if h < 0.08:
                break
            y = y0 - (0.4 if k % 2 else 0.0)
            while y < y1:
                width = rng.uniform(0.6, 1.2)
                ya, yb = max(y, y0), min(y + width, y1)
                y += width
                if yb - ya < 0.12:
                    continue
                boxes.add(
                    (sx + 0.21 + rng.uniform(-0.012, 0.012), side * (ya + yb) / 2, z + h / 2),
                    (0.5, yb - ya - JOINT, h - JOINT),
                    rnd=rng.random(),
                )
                wet.append(-50.0)
            z += COURSE
            k += 1
        # 石阶：十四级，贴着挡墙往上。
        count = 14
        rise = (high - low) / count
        for s in range(count):
            boxes.add(
                (sx - (count - s) * 0.3 / 2, side * (y0 + 1.25), low + (s + 0.5) * rise),
                ((count - s) * 0.3, 1.25, rise - 0.004),
                rnd=rng.random(),
            )
            wet.append(-50.0)
    return boxes, wet


def _cills(rng):
    """闸槛：上一室的河底比下一室高一级，中间这堵墙。"""
    boxes = Boxes()
    wet = []
    for g in range(1, lay.N + 1):
        x = g * lay.L
        low = (g - 1) * lay.R - lay.D
        high = lay.gate_bottom(g)
        z = low
        k = 0
        while z < high - 0.05:
            h = min(COURSE, high - z)
            y = -lay.W / 2 - (0.45 if k % 2 else 0.0)
            while y < lay.W / 2:
                width = rng.uniform(0.7, 1.3)
                ya, yb = max(y, -lay.W / 2), min(y + width, lay.W / 2)
                y += width
                if yb - ya < 0.1:
                    continue
                boxes.add(
                    (x + 0.25 + rng.uniform(-0.012, 0.012), (ya + yb) / 2, z + h / 2),
                    (0.5, yb - ya - JOINT, h - JOINT),
                    rnd=rng.random(),
                )
                wet.append(lay.full_level(x - 1.0) + 0.6)
            z += COURSE
            k += 1
    return boxes, wet


def _solid(name, boxes_list, mat):
    boxes = Boxes()
    for args in boxes_list:
        boxes.span(*args)
    obj = link(bpy.data.objects.new(name, boxes.mesh(name)))
    assign(obj, mat)
    return obj


def _terrain(side, mat, seed):
    """一侧的地：靠闸的地方是平的台地（跟着岸顶一级一级抬高），往外过渡成起伏的草坡。"""
    xs = np.arange(lay.X_MIN, lay.X_MAX + 0.01, 0.8)
    t = np.linspace(0.0, 1.0, 90)
    ds = 0.5 + 6.0 * t + 150.0 * t**2.4  # 离水边多远：近处密，远处疏
    X, Dm = np.meshgrid(xs, ds, indexing="ij")
    top = np.vectorize(lay.quay_top)(xs)
    blend = np.clip((Dm - 3.9) / 6.0, 0.0, 1.0)
    blend = blend * blend * (3 - 2 * blend)
    in_lock = (X > NEAR[0] - 4) & (X < NEAR[1] + 4)
    near = top[:, None] - np.where(in_lock & (Dm < 3.8), 0.16, 0.03)
    far = greens.far_ground(X, Dm, seed)
    Z = near * (1 - blend) + far * blend + greens.fbm(X * 9.0, Dm * 9.0, seed + 5) * 0.025
    verts = np.stack([X, side * (lay.W / 2 + Dm), Z], axis=-1).reshape(-1, 3)
    nx, nd = len(xs), len(ds)
    idx = np.arange(nx * nd).reshape(nx, nd)
    a, b, c, d = idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]
    faces = np.stack([a, b, c, d] if side > 0 else [a, d, c, b], axis=-1).reshape(-1, 4)
    mesh = bpy.data.meshes.new(f"terrain{side:+d}")
    mesh.from_pydata(verts.tolist(), [], faces.tolist())
    mesh.update()
    path = np.clip(1.0 - (Dm - 4.6) / 1.6, 0.0, 1.0) * in_lock
    set_attr(mesh, "path", path.reshape(-1))
    # 草：路上不长；离闸近的地方密，往坡上（林子底下）稀。
    edge = np.where(in_lock, np.clip((Dm - 4.3) / 1.5, 0.0, 1.0), np.clip((Dm - 0.7) / 0.6, 0.0, 1.0))
    reach = 1.0 - 0.9 * np.clip((Dm - 26.0) / 18.0, 0.0, 1.0)
    reach = reach * (1.0 - np.clip((X - (lay.N * lay.L + 150.0)) / 40.0, 0.0, 1.0))
    set_attr(mesh, "grass", (edge * reach).reshape(-1))
    shade_smooth(mesh)
    obj = link(bpy.data.objects.new(mesh.name, mesh))
    assign(obj, mat)
    return obj


def build(mats, quality=2):
    rng = random.Random(11)
    rough_big = clouds("stone-big", 0.3, 3)
    made = []
    terrains = []

    def stones(name, boxes, wet, mat, fine=True, width=0.03, strength=0.075):
        if not len(boxes):
            return None
        obj = link(bpy.data.objects.new(name, boxes.mesh(name, dz_from=wet)))
        bevel(obj, width, 2)
        if fine and quality > 0:
            roughen(obj, rough_big, strength, levels=min(quality, 2))
        shade_smooth(obj.data)
        assign(obj, mat)
        made.append(obj)
        return obj

    for side in (1, -1):
        tag = "L" if side > 0 else "R"
        for i, (a, b) in enumerate(_segments()):
            fine = a >= NEAR[0] - 1 and b <= NEAR[1] + 1
            boxes, wet = _wall_blocks(side, a, b, rng)
            stones(f"wall{tag}{i}", boxes, wet, mats["stone"], fine)
        boxes, wet = _coping(side, lay.X_MIN, lay.X_MAX, rng)
        stones(f"coping{tag}", boxes, wet, mats["coping"], True, 0.03, 0.018)
        boxes, wet = _flags(side, NEAR[0], NEAR[1], rng)
        stones(f"flags{tag}", boxes, wet, mats["flags"], True, 0.012, 0.012)
        boxes, wet = _risers(side, rng)
        stones(f"risers{tag}", boxes, wet, mats["stone"], True)
        terrains.append(_terrain(side, mats["ground"], SEEDS[side]))

    boxes, wet = _cills(rng)
    stones("cills", boxes, wet, mats["stone"], True)

    # 石头后面的实心部分（从石缝里看进去是黑的），和各段的河底。
    backing = []
    cuts = [lay.X_MIN] + lay.steps() + [lay.X_MAX]
    for a, b in zip(cuts, cuts[1:]):
        top = lay.quay_top((a + b) / 2) - 0.2
        for side in (1, -1):
            backing.append((a, b, side * (lay.W / 2 + 0.07), side * (lay.W / 2 + 4.2), -lay.D - 3.0, top))
    for g in range(1, lay.N + 1):
        backing.append((g * lay.L + 0.06, g * lay.L + 1.0, -lay.W / 2, lay.W / 2, -lay.D - 3.0, lay.gate_bottom(g) - 0.02))
    _solid("backing", backing, mats["mortar"])

    floors = [(lay.X_MIN, lay.L, -lay.W / 2 - 0.4, lay.W / 2 + 0.4, -lay.D - 3.0, -lay.D)]
    for i in range(1, lay.N):
        floors.append((i * lay.L, (i + 1) * lay.L, -lay.W / 2 - 0.4, lay.W / 2 + 0.4, -lay.D - 3.0, i * lay.R - lay.D))
    floors.append((lay.N * lay.L, lay.X_MAX, -lay.W / 2 - 0.4, lay.W / 2 + 0.4, -lay.D - 3.0, lay.N * lay.R - lay.D))
    _solid("floors", floors, mats["mortar"])
    return terrains


def _segments():
    """闸墙沿 x 分成的段：每一室一段，两头的运河各分几段。"""
    cuts = [lay.X_MIN, -70.0, NEAR[0], 0.0]
    cuts += [i * lay.L for i in range(1, lay.N + 1)]
    cuts += [NEAR[1], lay.N * lay.L + 130.0, lay.N * lay.L + 300.0, lay.X_MAX]
    return list(zip(cuts, cuts[1:]))
