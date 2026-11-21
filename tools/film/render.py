# 渲染过闸的影片：搭好整个场景，按 states.json 里每一帧的状态摆好船、水位、闸门、天色和镜头，逐帧渲染。
#
#   blender -b --factory-startup --python tools/film/render.py -- --states states.json --out 目录 [选项]
#
# 选项：--size 1920x1080  --samples 256  --only 3,7（只渲染这几帧）  --quality 0|1|2（石头的细致程度）
#       --threshold 0.04（噪点低到这个数就不再多采样）  --order coarse（先每隔八帧渲一遍，再补齐）
#       --compositor cpu|gpu|off（后期在哪算；量过，占不了多少时间）  --volstep 2（雾的步长；量过，不省时间）
#       --cam "x,y,z,tx,ty,tz"（不用影片的镜头，自己摆，查场景用）  --lens 27  --blend 文件（把场景存下来）
#       --resume 1（已经渲染出来的帧跳过：中途断了接着渲）
import json
import math
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lockfilm import boat as boat_mod  # noqa: E402
from lockfilm import gates as gates_mod  # noqa: E402
from lockfilm import layout as lay  # noqa: E402
from lockfilm import greens, masonry, materials, props, world  # noqa: E402
from lockfilm.util import Boxes, assign, link  # noqa: E402

BOAT_SCALE = 0.9
JOURNEY_SECONDS = 96.0  # 整段路按这么长的时间算水面的波动


def options():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    opts = {"size": "1280x720", "samples": "128", "quality": "2", "only": "", "cam": "", "lens": "", "blend": "", "states": "", "out": "", "resume": "", "grass": "1", "compositor": "cpu", "threshold": "", "volstep": "", "order": ""}
    for key, value in zip(argv[0::2], argv[1::2]):
        opts[key.lstrip("-")] = value
    return opts


def reset():
    for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.worlds):
        for item in list(collection):
            collection.remove(item)


def make_materials():
    m = materials
    return {
        "stone": m.stone("stone", 1.0, 0.25),
        "coping": m.stone("coping", 1.25, 0.5),
        "flags": m.stone("flags", 0.95, 0.75),
        "mortar": m.mortar(),
        "timber": m.timber(),
        "iron": m.metal("iron", (0.05, 0.045, 0.04), 0.5, 0.7),
        "white": m.paint("white", (0.5, 0.5, 0.47), 0.45, 0.8, 0.3, (0.07, 0.06, 0.05)),
        "black": m.paint("black", (0.012, 0.012, 0.014), 0.3, 0.35, 0.6, (0.09, 0.04, 0.02)),
        "water": m.water(),
        "ground": m.ground(),
        "needles": m.needles(),
        "grass": m.grass(),
        "spray": m.spray(),
        "fencewood": m.paint("fencewood", (0.12, 0.1, 0.085), 0.72, 0.6, 0.0, (0.04, 0.035, 0.03)),
        "hull": m.paint("hull", (0.01, 0.01, 0.012), 0.28, 0.3, 0.7, (0.1, 0.045, 0.02)),
        "deckpaint": m.paint("deckpaint", (0.03, 0.05, 0.055), 0.5, 0.4, 0.2),
        "cabin": m.paint("cabin", (0.012, 0.085, 0.12), 0.22, 0.12, 0.9, (0.02, 0.02, 0.02)),
        "cabin_dark": m.paint("cabin-dark", (0.008, 0.03, 0.05), 0.25, 0.1, 0.8),
        "roof": m.paint("roof", (0.035, 0.05, 0.062), 0.5, 0.35, 0.55, (0.02, 0.02, 0.022)),
        "cream": m.paint("cream", (0.78, 0.7, 0.5), 0.35, 0.15, 0.5),
        "pole": m.paint("pole", (0.2, 0.13, 0.07), 0.5, 0.3, 0.2, (0.08, 0.06, 0.04)),
        "buoy": m.paint("buoy", (0.75, 0.2, 0.06), 0.4, 0.2, 0.3, (0.6, 0.6, 0.55)),
        "brass": m.metal("brass", (0.78, 0.55, 0.22), 0.22, 0.35),
        "canvas": m.canvas(),
        "rope": m.rope(),
        "window": m.window(),
        "headlamp": m.glow("headlamp", (1.0, 0.86, 0.62), 40.0),
        "bulb": m.glow("bulb", (1.0, 0.62, 0.28), 26.0),
        "plaster": m.plaster(),
        "slate": m.slate(),
        "fog": m.fog(),
        "mist": m.mist(),
    }


def make_water(mats):
    """每一段水面一个物体：原点在这一段下游的闸门处，z 就是水位。水面的两头照着人字门的尖角切。"""
    half = lay.W / 2 + 0.03
    tip = lay.TIP

    def surface(name, length, v_start, v_end):
        a = tip if v_start else 0.0
        b = length + (tip if v_end else 0.0)
        verts = [(0.0, -half, 0.0), (a, 0.0, 0.0), (b, 0.0, 0.0), (length, -half, 0.0), (0.0, half, 0.0), (length, half, 0.0)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], [(0, 3, 2, 1), (1, 2, 5, 4)])
        mesh.update()
        obj = link(bpy.data.objects.new(name, mesh))
        obj["churn"] = 0.0
        obj["reach"] = float(length)
        obj.visible_shadow = False
        assign(obj, mats["water"])
        return obj

    lower = surface("water-lower", -lay.X_MIN, False, True)
    lower.location = (lay.X_MIN, 0.0, 0.0)
    lower["reach"] = 1.0e4
    chambers = []
    for i in range(lay.N):
        obj = surface(f"water{i}", lay.L, True, True)
        obj.location = (i * lay.L, 0.0, i * lay.R)
        chambers.append(obj)
    upper = surface("water-upper", lay.X_MAX - lay.N * lay.L, True, False)
    upper.location = (lay.N * lay.L, 0.0, lay.N * lay.R)
    upper["reach"] = 1.0e4

    # 贴着水面的雾气：每一段水面上罩一个矮盒子，跟着水位走。
    def haze(parent, length, name):
        box = Boxes()
        box.span(0.4, length - 0.2, -lay.W / 2 + 0.05, lay.W / 2 - 0.05, 0.02, 1.9)
        obj = link(bpy.data.objects.new(name, box.mesh(name)), parent)
        obj.visible_shadow = False
        assign(obj, mats["mist"])

    for i, obj in enumerate(chambers):
        haze(obj, lay.L, f"mist{i}")
    haze(upper, 150.0, "mist-upper")
    return chambers


def make_jets(mats):
    """注水的水柱：每道闸门的两扇门上各一个阀口，上游的水从这里冲进下一室。
    每个是三层叠着的弧面（往前抛、往下落），高度 1、往前 1；渲染每一帧时按落差缩放，落差没了就藏起来。"""
    import numpy as np

    from lockfilm.util import set_attr

    steps, cols = 18, 9
    verts, faces, layer, across = [], [], [], []
    for n, (width, push, shift) in enumerate(((0.3, 1.0, 0.0), (0.38, 0.86, 0.02), (0.22, 1.1, -0.02))):
        first = len(verts)
        for k in range(steps + 1):
            t = k / steps
            spread = width * (0.85 + 0.75 * t)
            for c in range(cols):
                u = c / (cols - 1) * 2.0 - 1.0
                bulge = 0.09 * (1.0 - u * u)
                wobble = 0.02 * math.sin(9.0 * t + 4.0 * u + n * 2.1)
                verts.append((t * push + bulge + wobble + shift, u * spread, -(t**1.9)))
                layer.append(float(n))
                across.append(abs(u))
        for k in range(steps):
            for c in range(cols - 1):
                a = first + k * cols + c
                faces.append((a, a + 1, a + cols + 1, a + cols))
    mesh = bpy.data.meshes.new("jet")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    set_attr(mesh, "layer", np.asarray(layer))
    set_attr(mesh, "across", np.asarray(across))
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(mats["spray"])
    jets = []
    for g in range(1, lay.N + 1):
        pair = []
        for side in (1, -1):
            obj = link(bpy.data.objects.new(f"jet{g}{side}", mesh))
            # 门扇中段，朝下游；阀口在上游那一室的河底往上半米多。
            obj.location = (g * lay.L + lay.TIP * 0.5 - 0.22, side * lay.HINGE * 0.5, lay.gate_bottom(g) + 0.6)
            obj.rotation_euler = (0.0, 0.0, math.pi - side * math.radians(20))
            obj.visible_shadow = False
            pair.append(obj)
        jets.append(pair)
    return jets


def build(scene, quality, with_grass=True):
    mats = make_materials()
    terrains = masonry.build(mats, quality)
    greens.forest(mats, masonry.SEEDS)
    if quality > 0 and with_grass:
        greens.grass(terrains, mats)
    props.fence(mats)
    props.ladders(mats)
    gates = gates_mod.build(mats)
    props.bollards(mats, gates_mod.bollard_mesh())
    lamps = [(data, data.energy) for data in props.lamps(mats)]
    lamps += [(data, data.energy) for data in props.cottage(mats)]
    water = make_water(mats)
    jets = make_jets(mats)
    boat, head = boat_mod.build(mats)
    boat.scale = (BOAT_SCALE,) * 3
    lamps.append((head.data, head.data.energy))
    ctl = world.build(scene, mats)
    world.compositor(scene)
    return {"mats": mats, "gates": gates, "water": water, "jets": jets, "boat": boat, "lamps": lamps, "ctl": ctl}


def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


DAWN_FROM = 0.875  # 最后一拍（进最高一级）开始天亮
LIFT_FROM = 0.93  # 从这里起镜头往上升


def sky_time(state):
    """天色走到哪了（0 深夜，0.6 蓝调时刻，1 日出）：前七拍从深夜慢慢到天快亮；
    最后一整拍天亮起来——船在最高一级里升上去的时候天边发白，驶出去的时候太阳升起来。
    页面上「天亮了」的那一刻（lock-film.js 的 DAY_AT）是照着这里定的，改这里要一起改。"""
    p = state["progress"]
    if p <= DAWN_FROM:
        return 0.6 * (p / DAWN_FROM) ** 1.3
    return 0.6 + 0.4 * smoothstep((p - DAWN_FROM) / (1.0 - DAWN_FROM))


def camera_pose(state):
    """镜头：在船后上方跟着，越过身后的闸门往前看——前面是一级一级往上的闸，尽头是天光。"""
    u = state["progress"] * lay.N
    bx = state["boat"] * lay.L
    bz = state["level"] * lay.R
    end = smoothstep((state["progress"] - LIFT_FROM) / (1.0 - LIFT_FROM))
    drift = 1.2 * math.sin(u * 0.62 + 0.4)
    back = 10.6 - 1.0 * math.cos(u * 0.5) + 5.0 * end
    height = 5.9 + 0.3 * math.sin(u * 0.45 + 2.0) + 3.5 * end
    position = (bx - back, drift, bz + height)
    target = (bx + 9.0 + 30.0 * end, -drift * 0.35, bz + 1.3 + 1.5 * end)
    focus = (bx, 0.0, bz + 1.0)
    return position, target, focus


def apply(scene, built, state):
    seconds = state["progress"] * JOURNEY_SECONDS
    for i, obj in enumerate(built["water"]):
        w = state["water"][i]
        obj.location.z = (i + w) * lay.R
        obj["churn"] = math.sin(math.pi * w) ** 0.7 if 0.0 < w < 1.0 else 0.0
        obj.update_tag()
    gates_mod.pose(built["gates"], state["gates"])
    # 第 g 道门（g 从 1 起）的水柱：往第 g-1 室里冲。那一室正在涨、水面还没漫过阀口时才看得见。
    for g, pair in enumerate(built["jets"], start=1):
        w = state["water"][g - 1]
        low = (g - 1 + w) * lay.R
        drop = lay.gate_bottom(g) + 0.6 - low
        flow = math.sin(math.pi * w) ** 0.5 if 0.0 < w < 1.0 else 0.0
        show = flow > 0.05 and drop > 0.03
        for obj in pair:
            obj.hide_render = not show
            if show:
                obj.scale = (0.45 + 0.9 * flow * min(1.0, drop / 0.6) ** 0.5, 1.0, drop)
    boat = built["boat"]
    chamber = max(0, min(lay.N - 1, math.floor(state["boat"])))
    churn = built["water"][chamber]["churn"]
    bob = 0.012 * math.sin(seconds * 1.3) + churn * 0.03 * math.sin(seconds * 2.9)
    # 水线画在船身的 z = 0，吃水已经做在船体里了。
    boat.location = (state["boat"] * lay.L, 0.02 * math.sin(seconds * 0.4), state["level"] * lay.R + bob)
    boat.rotation_euler = (0.012 * math.sin(seconds * 1.1) + churn * 0.02 * math.sin(seconds * 2.3), churn * 0.008 * math.sin(seconds * 1.9), 0.0)
    mats = built["mats"]
    water_tree = mats["water"].node_tree
    water_tree.nodes[mats["water"]["time_node"]].outputs[0].default_value = seconds
    mats["spray"].node_tree.nodes["time"].outputs[0].default_value = seconds
    mats["mist"].node_tree.nodes["time"].outputs[0].default_value = seconds
    built["ctl"]["drift"].default_value = seconds * 0.002
    world.set_time(scene, built["ctl"], sky_time(state), built["lamps"])


def coarse_first(states):
    """先每隔八帧渲一帧铺满整段（连最后一帧），再补每隔四帧、两帧的，最后补齐。
    任何时候停下来，手里都是一段完整、只是稀一些的影片；压片时关键帧正好是每隔八帧的那些。"""
    last = states[-1]["index"] if states else 0

    def rank(state):
        index = state["index"]
        if index % 8 == 0 or index == last:
            return 0
        return 1 if index % 4 == 0 else 2 if index % 2 == 0 else 3

    return sorted(states, key=lambda state: (rank(state), state["index"]))


def main():
    opts = options()
    scene = bpy.context.scene
    reset()
    width, height = (int(v) for v in opts["size"].lower().split("x"))
    world.render_settings(scene, width, height, int(opts["samples"]))
    started = time.time()
    built = build(scene, int(opts["quality"]), opts["grass"] != "0")
    # 后期（柔光、色散）在哪算：cpu、gpu，或者 off（不做后期，量时间用）。
    if opts["compositor"] == "off":
        scene.render.use_compositing = False
    elif opts["compositor"] == "gpu":
        scene.render.compositor_device = "GPU"
    if opts["threshold"]:
        scene.cycles.adaptive_threshold = float(opts["threshold"])
    if opts["volstep"]:
        scene.cycles.volume_step_rate = float(opts["volstep"])
    print(f"[film] 场景搭好了，用了 {time.time() - started:.1f} 秒，{len(bpy.data.objects)} 个物体", flush=True)

    with open(opts["states"], encoding="utf-8") as handle:
        states = json.load(handle)
    only = {int(v) for v in opts["only"].split(",") if v.strip()} if opts["only"] else None
    os.makedirs(opts["out"], exist_ok=True)
    if opts["order"] == "coarse":
        states = coarse_first(states)
    saved = False
    for state in states:
        if only is not None and state["index"] not in only:
            continue
        done = os.path.join(os.path.abspath(opts["out"]), f"f{state['index']:04d}.png")
        if opts["resume"] and os.path.exists(done) and os.path.getsize(done) > 50_000:
            continue
        apply(scene, built, state)
        position, target, focus = camera_pose(state)
        # --cam 可以给好几个机位（分号隔开），坐标是相对船的：查模型细节用。
        views = [("", position, target, focus)]
        if opts["cam"]:
            bx, bz = state["boat"] * lay.L, state["level"] * lay.R
            views = []
            for n, text in enumerate(opts["cam"].split(";")):
                if text == "auto":
                    views.append(("", position, target, focus))
                    continue
                v = [float(x) for x in text.split(",")]
                views.append((f"-v{n}", (bx + v[0], v[1], bz + v[2]), (bx + v[3], v[4], bz + v[5]), (bx + v[3], v[4], bz + v[5])))
        for tag, position, target, focus in views:
            world.aim(built["ctl"], position, target, focus, float(opts["lens"]) if opts["lens"] else None)
            if opts["blend"] and not saved:
                bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opts["blend"]))
                saved = True
            scene.render.filepath = os.path.join(os.path.abspath(opts["out"]), f"f{state['index']:04d}{tag}.png")
            t0 = time.time()
            bpy.ops.render.render(write_still=True)
            print(f"[film] 第 {state['index']} 帧{tag}（进度 {state['progress']:.4f}）渲染完，用了 {time.time() - t0:.1f} 秒", flush=True)


main()
