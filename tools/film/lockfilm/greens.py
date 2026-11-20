# 长出来的东西：两岸山坡上的云杉林，和岸上的草。
# 树是一层一层垂下来的枝条拼的（不是一个圆锥），轮廓有缺口；整片林子是几种树反复摆（共用网格，不占内存）。
# 草是一丛丛真的叶片，用几何节点撒在地上。
import math
import random

import bpy
import numpy as np

from . import layout as lay
from .util import assign, link


def spruce(name, rng):
    """一棵云杉，高度是 1（摆的时候再放大）。"""
    verts = []
    faces = []

    def quad(a, b, c, d):
        faces.append((a, b, c, d))

    # 树干：六棱的细锥。
    sides = 6
    for k in range(sides):
        a = 2 * math.pi * k / sides
        verts.append((0.014 * math.cos(a), 0.014 * math.sin(a), 0.0))
    for k in range(sides):
        a = 2 * math.pi * k / sides
        verts.append((0.002 * math.cos(a), 0.002 * math.sin(a), 1.0))
    for k in range(sides):
        quad(k, (k + 1) % sides, sides + (k + 1) % sides, sides + k)

    whorls = rng.randint(24, 32)
    start = rng.uniform(0.1, 0.2)
    for w in range(whorls):
        f = w / (whorls - 1)
        z = start + (0.985 - start) * f
        reach = (0.2 * (1.0 - f) ** 0.85 + 0.012) * rng.uniform(0.7, 1.15)
        count = rng.randint(4, 6)
        base = rng.uniform(0.0, 2 * math.pi)
        for b in range(count):
            az = base + 2 * math.pi * b / count + rng.uniform(-0.4, 0.4)
            length = reach * rng.uniform(0.65, 1.12)
            if rng.random() < 0.06:
                continue  # 缺一根枝
            droop = (0.3 + 0.55 * (1.0 - f)) * rng.uniform(0.8, 1.25)
            ux, uy = math.cos(az), math.sin(az)
            sx, sy = -uy, ux
            steps = 5
            first = len(verts)
            for k in range(steps + 1):
                t = k / steps
                r = length * t
                rise = length * (0.22 * t - droop * t * t + 0.16 * t**4)
                width = length * 0.26 * math.sin(math.pi * (0.12 + 0.86 * t)) ** 0.7 * rng.uniform(0.8, 1.2)
                hang = width * rng.uniform(0.5, 0.95)
                cx, cy, cz = ux * r, uy * r, z + rise
                verts.append((cx, cy, cz))
                verts.append((cx + sx * width, cy + sy * width, cz - hang))
                verts.append((cx - sx * width, cy - sy * width, cz - hang))
            for k in range(steps):
                a = first + k * 3
                n = a + 3
                quad(a, n, n + 1, a + 1)
                quad(a, a + 2, n + 2, n)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def slope_at(x):
    """远处的坡在 x 处多高：把一级一级的岸顶抹平成缓坡。"""
    x = np.asarray(x, dtype=np.float64)
    offsets = np.arange(-15, 16) * 0.8
    tops = np.vectorize(lay.quay_top)(x[..., None] + offsets)
    return tops.mean(axis=-1)


def fbm(x, y, seed):
    rng = np.random.RandomState(seed)
    out = np.zeros_like(np.asarray(x, dtype=np.float64))
    amp = 1.0
    freq = 0.035
    for _ in range(5):
        ax, ay, px, py = rng.uniform(0.6, 1.4), rng.uniform(0.6, 1.4), rng.uniform(0, 6.28), rng.uniform(0, 6.28)
        out = out + amp * np.sin(x * freq * ax + px + 1.7 * np.sin(y * freq * 0.7 + py)) * np.cos(y * freq * ay + py)
        amp *= 0.5
        freq *= 2.1
    return out


def far_ground(x, d, seed):
    """离水边 d 米远的坡面多高（和地形网格用的是同一个算式）。"""
    x = np.asarray(x, dtype=np.float64)
    d = np.asarray(d, dtype=np.float64)
    return slope_at(x) + 0.085 * np.maximum(d - 8.0, 0.0) + fbm(x, d, seed) * np.clip((d - 5.0) / 30.0, 0.0, 1.0) * 2.6


def forest(mats, seeds, count=3000):
    rng = random.Random(41)
    variants = [spruce(f"spruce{v}", rng) for v in range(6)]
    for mesh in variants:
        mesh.materials.append(mats["needles"])
    placed = 0
    tries = 0
    while placed < count and tries < count * 30:
        tries += 1
        x = rng.uniform(lay.X_MIN + 4, lay.X_MAX - 4)
        d = 13.0 + 150.0 * rng.random() ** 1.35
        side = rng.choice((1, -1))
        if side > 0 and lay.N * lay.L - 14 < x < lay.N * lay.L + 18 and d < 30:
            continue
        # 靠近闸的地方稀，越往坡上越密。
        if rng.random() > 0.25 + 0.75 * min(1.0, (d - 13.0) / 22.0):
            continue
        height = rng.uniform(11.0, 24.0) * (0.75 + 0.25 * min(1.0, d / 40.0))
        z = float(far_ground(x, d, seeds[side])) - 0.5
        obj = link(bpy.data.objects.new(f"tree{placed}", rng.choice(variants)))
        obj.location = (x, side * (lay.W / 2 + d), z)
        girth = rng.uniform(0.85, 1.25)
        obj.scale = (height * girth, height * girth, height)
        obj.rotation_euler = (rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), rng.uniform(0, 6.28))
        placed += 1
    return placed


def _patch(name, rng, blades, radius):
    """一块草皮：一两千根弯着的草叶，中间密、边上稀，从根到尖越来越窄。
    一块一块地摆，比一丛一丛地摆少两个数量级的物体：每一帧整理场景快得多。"""
    verts = []
    faces = []
    for _ in range(blades):
        # 位置：圆盘里随机，边上稀一点（相邻两块搭在一起时不显出接缝）。
        r = radius * math.sqrt(rng.random()) * (0.55 + 0.45 * rng.random())
        at = rng.uniform(0, 2 * math.pi)
        ox, oy = r * math.cos(at), r * math.sin(at)
        az = rng.uniform(0, 2 * math.pi)
        lean = rng.uniform(0.05, 0.55)
        tall = rng.uniform(0.09, 0.3) * (1.4 if rng.random() < 0.08 else 1.0)
        dx, dy = math.cos(az), math.sin(az)
        sx, sy = -dy, dx
        base_w = rng.uniform(0.006, 0.012)
        first = len(verts)
        steps = 3
        for step in range(steps + 1):
            t = step / steps
            out = tall * lean * t * t
            up = tall * (t - 0.25 * lean * t * t)
            w = base_w * (1.0 - t) ** 0.8 + 0.0008
            cx, cy = ox + dx * out, oy + dy * out
            verts.append((cx + sx * w, cy + sy * w, up))
            verts.append((cx - sx * w, cy - sy * w, up))
        for step in range(steps):
            a = first + step * 2
            faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def grass(terrains, mats, density=0.6):
    """给两侧的地铺草皮。地形网格上的 grass（0 到 1）是这一处长多密；density 是每平方米摆几块。"""
    rng = random.Random(5)
    sources = []
    for v, (blades, radius) in enumerate(((2200, 0.95), (1800, 0.85), (2600, 1.05))):
        mesh = _patch(f"grass{v}", rng, blades, radius)
        obj = link(bpy.data.objects.new(f"grass{v}", mesh))
        obj.location = (0.0, 0.0, -900.0 - v)
        assign(obj, mats["grass"])
        sources.append(obj)

    tree = bpy.data.node_groups.new("scatter-grass", "GeometryNodeTree")
    tree.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nodes, links = tree.nodes, tree.links
    group_in = nodes.new("NodeGroupInput")
    group_out = nodes.new("NodeGroupOutput")
    join = nodes.new("GeometryNodeJoinGeometry")
    links.new(group_in.outputs[0], join.inputs[0])
    amount = nodes.new("GeometryNodeInputNamedAttribute")
    amount.data_type = "FLOAT"
    amount.inputs["Name"].default_value = "grass"
    for v, source in enumerate(sources):
        scaled = nodes.new("ShaderNodeMath")
        scaled.operation = "MULTIPLY"
        links.new(amount.outputs[0], scaled.inputs[0])
        scaled.inputs[1].default_value = density / len(sources)
        points = nodes.new("GeometryNodeDistributePointsOnFaces")
        points.distribute_method = "RANDOM"
        links.new(group_in.outputs[0], points.inputs["Mesh"])
        links.new(scaled.outputs[0], points.inputs["Density"])
        points.inputs["Seed"].default_value = 3 + v
        info = nodes.new("GeometryNodeObjectInfo")
        info.inputs["Object"].default_value = source
        info.inputs["As Instance"].default_value = True
        turn = nodes.new("FunctionNodeRandomValue")
        turn.data_type = "FLOAT"
        turn.inputs["Min"].default_value = 0.0
        turn.inputs["Max"].default_value = 6.283
        turn.inputs["Seed"].default_value = 11 + v
        euler = nodes.new("ShaderNodeCombineXYZ")
        links.new(turn.outputs[0], euler.inputs["Z"])
        rotation = nodes.new("FunctionNodeEulerToRotation")
        links.new(euler.outputs[0], rotation.inputs[0])
        size = nodes.new("FunctionNodeRandomValue")
        size.data_type = "FLOAT"
        size.inputs["Min"].default_value = 0.8
        size.inputs["Max"].default_value = 1.2
        size.inputs["Seed"].default_value = 23 + v
        grow = nodes.new("ShaderNodeCombineXYZ")
        for axis in ("X", "Y", "Z"):
            links.new(size.outputs[0], grow.inputs[axis])
        instance = nodes.new("GeometryNodeInstanceOnPoints")
        links.new(points.outputs["Points"], instance.inputs["Points"])
        links.new(info.outputs["Geometry"], instance.inputs["Instance"])
        links.new(rotation.outputs[0], instance.inputs["Rotation"])
        links.new(grow.outputs[0], instance.inputs["Scale"])
        links.new(instance.outputs[0], join.inputs[0])
    links.new(join.outputs[0], group_out.inputs[0])
    for terrain in terrains:
        mod = terrain.modifiers.new("grass", "NODES")
        mod.node_group = tree
