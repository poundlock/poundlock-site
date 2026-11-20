# 岸上的东西：路灯、系缆桩、坡顶看闸人的小屋、远处的树。
import math
import random

import bpy

from . import layout as lay
from .util import Boxes, assign, bevel, clouds, lathe, link, shade_smooth

POST = [
    (0.0, 0.0), (0.17, 0.0), (0.17, 0.05), (0.13, 0.09), (0.12, 0.3), (0.09, 0.36), (0.075, 0.5), (0.085, 0.53), (0.085, 0.57),
    (0.06, 0.6), (0.048, 1.6), (0.042, 2.75), (0.06, 2.78), (0.06, 2.82), (0.04, 2.85), (0.04, 2.93), (0.14, 2.97), (0.14, 3.0), (0.0, 3.0),
]


def _lantern():
    """灯头：四根细铁条围成的笼子，上面一个四坡的顶。"""
    cage = Boxes()
    for sx in (-1, 1):
        for sy in (-1, 1):
            cage.add((sx * 0.15, sy * 0.15, 3.24), (0.018, 0.018, 0.48))
    for z in (3.0, 3.48):
        for sx in (-1, 1):
            cage.add((sx * 0.15, 0.0, z), (0.02, 0.32, 0.02))
            cage.add((0.0, sx * 0.15, z), (0.32, 0.02, 0.02))
    return cage.mesh("lantern-cage")


def lamps(mats):
    """沿闸两岸立路灯。返回所有灯光的数据块，渲染每一帧时调亮度（天亮了灯就暗下去）。"""
    spots = []
    for x in (-52.0, -26.0):
        spots.append((x, 1))
    for i in range(lay.N):
        spots.append((i * lay.L + lay.L * 0.45, 1 if i % 2 == 0 else -1))
        spots.append((i * lay.L + lay.L * 0.72, -1 if i % 2 == 0 else 1))
    for x in (lay.N * lay.L + 14.0, lay.N * lay.L + 44.0, lay.N * lay.L + 82.0):
        spots.append((x, -1))
    post = lathe("lamp-post", POST, 16)
    shade_smooth(post)
    cage = _lantern()
    roof = lathe("lantern-roof", [(0.0, 3.5), (0.25, 3.5), (0.25, 3.52), (0.06, 3.68), (0.03, 3.7), (0.03, 3.76), (0.0, 3.78)], 4)
    bulb = lathe("bulb", [(0.0, 3.12), (0.05, 3.14), (0.075, 3.22), (0.06, 3.32), (0.0, 3.36)], 12)
    shade_smooth(bulb)
    lights = []
    for n, (x, side) in enumerate(spots):
        y = side * (lay.W / 2 + 2.05)
        z = lay.quay_top(x)
        for mesh, mat, shadow in ((post, mats["black"], True), (cage, mats["black"], False), (roof, mats["black"], False), (bulb, mats["bulb"], False)):
            obj = link(bpy.data.objects.new(f"lamp{n}-{mesh.name}", mesh))
            obj.location = (x, y, z)
            if mesh is roof:
                obj.rotation_euler = (0.0, 0.0, math.pi / 4)
            obj.visible_shadow = shadow
            assign(obj, mat)
        data = bpy.data.lights.new(f"lamp{n}", "POINT")
        data.color = (1.0, 0.7, 0.4)
        data.energy = 210.0
        data.shadow_soft_size = 0.07
        light = link(bpy.data.objects.new(f"lamp{n}", data))
        light.location = (x, y, z + 3.24)
        lights.append(data)
    return lights


def bollards(mats, mesh):
    shade_smooth(mesh)
    for i in range(-1, lay.N + 1):
        for frac in (0.3, 0.62):
            x = i * lay.L + lay.L * frac
            for side in (1, -1):
                obj = link(bpy.data.objects.new(f"bollard{i}{frac}{side}", mesh))
                obj.location = (x, side * (lay.W / 2 + 0.95), lay.quay_top(x) - 0.01)
                assign(obj, mats["black"])
                band = link(bpy.data.objects.new(f"bollardband{i}{frac}{side}", _band()))
                band.location = (x, side * (lay.W / 2 + 0.95), lay.quay_top(x) + 0.47)
                assign(band, mats["white"])


_BAND = None


def _band():
    global _BAND
    if _BAND is None:
        _BAND = lathe("bollard-band", [(0.0, 0.0), (0.204, 0.0), (0.214, 0.05), (0.174, 0.11), (0.0, 0.135)], 20)
        shade_smooth(_BAND)
    return _BAND


def cottage(mats):
    """坡顶的小屋：刷白的墙、石板瓦顶，两扇窗亮着。"""
    x0 = lay.N * lay.L - 2.0
    y0 = lay.W / 2 + 9.5
    z0 = lay.quay_top(x0) - 0.1
    walls = Boxes()
    walls.span(x0, x0 + 8.5, y0, y0 + 5.2, z0, z0 + 3.1)
    for cx in (x0 + 1.2, x0 + 7.3):
        walls.span(cx - 0.35, cx + 0.35, y0 + 2.2, y0 + 3.0, z0 + 3.1, z0 + 6.3)
    obj = link(bpy.data.objects.new("cottage", walls.mesh("cottage")))
    bevel(obj, 0.02, 2)
    assign(obj, mats["plaster"])
    # 山墙和屋顶：一个三棱柱。
    ridge = z0 + 3.1 + 2.3
    over = 0.35
    verts = [
        (x0 - over, y0 - over, z0 + 3.05), (x0 + 8.5 + over, y0 - over, z0 + 3.05), (x0 + 8.5 + over, y0 + 5.2 + over, z0 + 3.05), (x0 - over, y0 + 5.2 + over, z0 + 3.05),
        (x0 - over, y0 + 2.6, ridge), (x0 + 8.5 + over, y0 + 2.6, ridge),
    ]
    faces = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]
    roof = bpy.data.meshes.new("cottage-roof")
    roof.from_pydata(verts, [], faces)
    roof.update()
    assign(link(bpy.data.objects.new("cottage-roof", roof)), mats["slate"])
    gable = bpy.data.meshes.new("cottage-gable")
    gverts = []
    for gx in (x0 + 0.01, x0 + 8.49):
        gverts += [(gx, y0, z0 + 3.05), (gx, y0 + 5.2, z0 + 3.05), (gx, y0 + 2.6, ridge - 0.12)]
    gable.from_pydata(gverts, [], [(0, 1, 2), (3, 5, 4)])
    gable.update()
    assign(link(bpy.data.objects.new("cottage-gable", gable)), mats["plaster"])
    glass = Boxes()
    frames = Boxes()
    for cx in (x0 + 2.0, x0 + 6.5):
        glass.span(cx - 0.45, cx + 0.45, y0 - 0.01, y0 + 0.03, z0 + 1.1, z0 + 2.3)
        frames.span(cx - 0.52, cx + 0.52, y0 - 0.03, y0 + 0.02, z0 + 1.0, z0 + 1.09)
        frames.span(cx - 0.02, cx + 0.02, y0 - 0.03, y0 + 0.02, z0 + 1.1, z0 + 2.3)
        frames.span(cx - 0.45, cx + 0.45, y0 - 0.03, y0 + 0.02, z0 + 1.68, z0 + 1.72)
    frames.span(x0 + 3.85, x0 + 4.75, y0 - 0.03, y0 + 0.03, z0 + 0.05, z0 + 2.1)
    assign(link(bpy.data.objects.new("cottage-glass", glass.mesh("cottage-glass"))), mats["window"])
    assign(link(bpy.data.objects.new("cottage-frames", frames.mesh("cottage-frames"))), mats["cabin_dark"])
    data = bpy.data.lights.new("porch", "POINT")
    data.color = (1.0, 0.6, 0.28)
    data.energy = 120.0
    data.shadow_soft_size = 0.05
    porch = link(bpy.data.objects.new("porch", data))
    porch.location = (x0 + 4.3, y0 - 0.5, z0 + 2.5)
    return [data]


def fence(mats):
    """石板路外沿的木栏杆：一根根桩子，两道横木，跟着岸一级一级往上。"""
    rng = random.Random(77)
    boxes = Boxes()
    d = lay.W / 2 + 0.57 + 4 * 0.78 + 0.3
    step = 2.3
    for side in (1, -1):
        x = -34.0
        while x < lay.N * lay.L + 70.0:
            top = lay.quay_top(x)
            lean = rng.uniform(-0.03, 0.03)
            boxes.add((x, side * d, top + 0.5), (0.11, 0.11, 1.25), rot=None, rnd=rng.random(), ax=0.0)
            nxt = x + step
            if abs(lay.quay_top(nxt) - top) < 0.01:
                for h in (0.45, 0.95):
                    boxes.add((x + step / 2, side * (d - 0.07), top + h + lean), (step + 0.12, 0.035, 0.1), rnd=rng.random(), ax=1.0)
            x = nxt
    obj = link(bpy.data.objects.new("fence", boxes.mesh("fence", dz_from=[-50.0] * len(boxes))))
    bevel(obj, 0.008, 2)
    shade_smooth(obj.data)
    assign(obj, mats["fencewood"])


def ladders(mats):
    """每一室右墙上一架铁梯，从河底一直到岸顶。"""
    rng = random.Random(9)
    boxes = Boxes()
    for i in range(lay.N):
        x = i * lay.L + lay.L * 0.36
        y = -(lay.W / 2 - 0.09)
        low = lay.floor_z(x) + 0.2
        high = lay.quay_top(x) + 0.02
        for dx in (-0.21, 0.21):
            boxes.add((x + dx, y, (low + high) / 2), (0.05, 0.025, high - low), rnd=rng.random())
        z = low + 0.25
        while z < high - 0.1:
            boxes.add((x, y, z), (0.42, 0.028, 0.028), rnd=rng.random())
            z += 0.3
        for z in (low + 1.0, (low + high) / 2, high - 0.5):
            for dx in (-0.21, 0.21):
                boxes.add((x + dx, y - 0.05, z), (0.04, 0.1, 0.04), rnd=rng.random())
    obj = link(bpy.data.objects.new("ladders", boxes.mesh("ladders")))
    bevel(obj, 0.005, 2)
    shade_smooth(obj.data)
    assign(obj, mats["iron"])
