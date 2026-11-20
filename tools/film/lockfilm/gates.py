# 人字闸门：九道，每道两扇。门扇是一根根木料拼的——门轴柱、斜接柱、横梁、斜撑、竖板，
# 铁箍和螺栓，顶上压着一根长长的平衡杆（黑的，杆头刷白），下游一侧有走道和白栏杆。
import math
import random

import bpy

from . import layout as lay
from .util import Boxes, assign, bevel, clouds, empty, lathe, link, roughen, rot_y, shade_smooth

BEAM = 4.6  # 平衡杆伸出门轴多长
BEAM_UP = 1.1  # 平衡杆比门板顶高多少


def _leaf_meshes(height, rng):
    """一扇门的几个网格（木头、铁件、白漆、黑漆）。门轴在原点，门扇沿 +x，下游一面朝 +y，底在 z = 0。"""
    wood = Boxes()
    iron = Boxes()
    white = Boxes()
    black = Boxes()
    length = lay.LEAF
    top = height
    beam_z = height + BEAM_UP

    post = 0.34
    # 门轴柱、斜接柱：一直顶到平衡杆。
    for x in (post / 2 - 0.05, length - post / 2 + 0.02):
        wood.add((x, 0.0, (beam_z + 0.1) / 2), (post, post, beam_z + 0.1), rnd=rng.random(), ax=0.0)
    # 横梁：下游一面看得见，底下密、上面疏（水压底下大）。
    count = max(3, int(height / 0.85) + 1)
    rails = [0.16 + (top - 0.32) * (k / (count - 1)) ** 1.25 for k in range(count)]
    for z in rails:
        wood.add((length / 2, 0.05, z), (length - 0.5, 0.3, 0.26), rnd=rng.random(), ax=1.0)
        iron.add((length / 2, 0.21, z), (length - 0.1, 0.012, 0.09), rnd=rng.random())
        for k in range(9):
            iron.add((0.25 + (length - 0.5) * k / 8, 0.225, z), (0.05, 0.03, 0.05), rnd=rng.random())
    # 斜撑：从门轴柱的底斜着撑到斜接柱的顶。
    for a, b in zip(rails, rails[1:]):
        span = length - 0.7
        rise = b - a - 0.26
        if rise < 0.25:
            continue
        angle = math.atan2(rise, span)
        wood.add(
            (length / 2, 0.08, (a + b) / 2),
            (math.hypot(span, rise), 0.14, 0.16),
            rot=rot_y(-angle),
            rnd=rng.random(),
            ax=1.0,
        )
    # 竖板：上游一面，一块挨一块，宽窄、进出都不一样。
    x = post - 0.05
    while x < length - post + 0.02:
        width = min(rng.uniform(0.2, 0.3), length - post + 0.02 - x)
        if width < 0.06:
            break
        wood.add(
            (x + width / 2, -0.12 + rng.uniform(-0.008, 0.008), top / 2 + rng.uniform(-0.01, 0.01)),
            (width - 0.008, 0.075, top),
            rnd=rng.random(),
            ax=0.0,
        )
        x += width
    # 平衡杆：压在两根柱子顶上，往岸上伸出去；杆头一段刷白。
    wood.add(((length - BEAM) / 2, 0.0, beam_z + 0.28), (length + BEAM, 0.36, 0.4), rnd=0.2, ax=1.0)
    white.add((-BEAM + 0.36, 0.0, beam_z + 0.28), (0.74, 0.375, 0.415))
    black.add((-BEAM * 0.55, 0.0, beam_z + 0.28), (0.14, 0.38, 0.42))
    # 门轴柱上的铁箍。
    for z in (0.5, top * 0.5, top - 0.2, beam_z - 0.1):
        iron.add((post / 2 - 0.05, 0.0, z), (post + 0.03, post + 0.03, 0.1), rnd=rng.random())
    # 走道：门板顶下游一侧的木板，托在铁架上；外面一排白栏杆。
    walk_z = top - 0.02
    for k in range(3):
        wood.add((length / 2 + 0.1, 0.36 + k * 0.17, walk_z), (length - 0.5, 0.16, 0.05), rnd=rng.random(), ax=1.0)
    for k in range(4):
        px = 0.45 + (length - 0.8) * k / 3
        iron.add((px, 0.42, walk_z - 0.12), (0.05, 0.56, 0.05), rnd=rng.random())
        white.add((px, 0.74, walk_z + 0.5), (0.055, 0.055, 1.0))
    for z in (walk_z + 0.55, walk_z + 0.98):
        white.add((length / 2 + 0.1, 0.74, z), (length - 0.6, 0.05, 0.05))
    # 闸阀的摇把架：斜接柱旁边立着的一根齿条和它的铁座。
    gx = length - 0.75
    black.add((gx, -0.02, top + 0.55), (0.14, 0.2, 1.1))
    black.add((gx, 0.1, top + 1.0), (0.3, 0.22, 0.24))
    iron.add((gx, -0.02, top + 1.35), (0.05, 0.05, 0.9), rnd=rng.random())
    white.add((gx, -0.02, top + 1.82), (0.06, 0.06, 0.1))
    return wood, iron, white, black, top


def _leaf(name, height, mats, rng, wet_local, parent):
    wood, iron, white, black, _ = _leaf_meshes(height, rng)
    pivot = empty(name, parent)
    grain = clouds(name + "-grain", 0.3, 2)

    def part(suffix, boxes, mat, width, rough=0.0):
        if not len(boxes):
            return
        wet = [wet_local] * len(boxes)
        obj = link(bpy.data.objects.new(f"{name}-{suffix}", boxes.mesh(f"{name}-{suffix}", dz_from=wet)), pivot)
        bevel(obj, width, 2)
        if rough:
            roughen(obj, grain, rough, levels=2)
        shade_smooth(obj.data)
        assign(obj, mat)

    part("wood", wood, mats["timber"], 0.012, 0.012)
    part("iron", iron, mats["iron"], 0.004)
    part("white", white, mats["white"], 0.008)
    part("black", black, mats["black"], 0.01)
    return pivot


def build(mats):
    """返回每道门的两扇 [(左扇, 右扇), …]，各是一个空物体，绕 z 转就是开关。"""
    rng = random.Random(23)
    gates = []
    for g in range(lay.N + 1):
        x = g * lay.L
        bottom = lay.gate_bottom(g)
        height = lay.gate_top(g) - bottom
        # 门板上常年泡水的那条线（上游一侧的满水位），换算成门自己的高度。
        wet_local = lay.full_level(x + 1.0) - bottom
        root = empty(f"gate{g}")
        root.location = (x, 0.0, bottom)
        right = _leaf(f"gate{g}R", height, mats, rng, wet_local, root)
        right.location = (0.0, -lay.HINGE, 0.0)
        left = _leaf(f"gate{g}L", height, mats, rng, wet_local, root)
        left.location = (0.0, lay.HINGE, 0.0)
        left.scale = (1.0, -1.0, 1.0)
        gates.append((left, right))
    return gates


def pose(gates, closed):
    """closed[g]：1 是关严，0 是开到贴墙。"""
    for (left, right), c in zip(gates, closed):
        angle = math.radians(4) + (lay.MITRE - math.radians(4)) * c
        right.rotation_euler = (0.0, 0.0, angle)
        left.rotation_euler = (0.0, 0.0, -angle)


def bollard_mesh():
    profile = [(0.0, 0.0), (0.19, 0.0), (0.19, 0.04), (0.13, 0.08), (0.115, 0.34), (0.13, 0.42), (0.2, 0.47), (0.21, 0.52), (0.17, 0.58), (0.0, 0.6)]
    return lathe("bollard", profile, 20)


__all__ = ["build", "pose", "bollard_mesh", "lathe"]
