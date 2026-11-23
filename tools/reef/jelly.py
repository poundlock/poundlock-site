# 深水那一段（S6）的水母：程序建模，渲成一圈一张一缩的序列帧（带透明），页面在水里摆好几只、各自漂。
# 伞是半透明的（透光、边缘亮），伞里四个淡粉的生殖腺，伞下四条皱褶的口腕和一圈细长的触手；
# 一圈里先快快地收缩（伞变窄变高、触手往后甩），再慢慢舒张。
#
#   blender -b --factory-startup --python tools/reef/jelly.py -- --out .shots/reef/jelly [--size 256x384] [--frames 16] [--samples 64]
#
# 拼成图集：python -I tools/reef/atlas.py --jelly --from .shots/reef/jelly --to src/assets/reef/jelly.webp
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import reef_core as core  # noqa: E402
from reef_core import material, obj_from_arrays  # noqa: E402

PI = math.pi


def options():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    opts = {"out": ".shots/reef/jelly", "size": "256x384", "frames": "16", "samples": "64"}
    for key, value in zip(argv[0::2], argv[1::2]):
        opts[key.lstrip("-")] = value
    return opts


def pulse(phase):
    """一圈里伞收得多紧（0 舒张，1 收紧）：前三成快快收紧，后七成慢慢放开。"""
    if phase < 0.3:
        t = phase / 0.3
        return t * t * (3 - 2 * t)
    t = (phase - 0.3) / 0.7
    return 1 - t * t * (3 - 2 * t)


def bell_material():
    """伞：几乎透明，正对着看淡、边缘亮（菲涅尔），带一点冷色的自发光，像被深水里的光勾出来。"""
    mat, g, bsdf, out = material("jelly_bell")
    lw = g.new("ShaderNodeLayerWeight")
    g.put(lw, "Blend", 0.35)
    rim = lw.outputs["Facing"]
    g.put(bsdf, "Base Color", core.rgba((0.7, 0.8, 1.0)))
    g.put(bsdf, "Roughness", 0.2)
    g.put(bsdf, "Transmission Weight", 1.0)
    g.put(bsdf, "IOR", 1.03)
    g.put(bsdf, "Alpha", g.math("ADD", 0.08, g.math("MULTIPLY", rim, 0.55)))
    g.put(bsdf, "Emission Color", core.rgba((0.55, 0.7, 1.0)))
    g.put(bsdf, "Emission Strength", g.math("MULTIPLY", g.math("POWER", rim, 2.0), 1.6))
    return mat


def soft_material(name, color, alpha, glow):
    mat, g, bsdf, _ = material(name)
    g.put(bsdf, "Base Color", core.rgba(color))
    g.put(bsdf, "Roughness", 0.4)
    g.put(bsdf, "Alpha", alpha)
    g.put(bsdf, "Emission Color", core.rgba(color))
    g.put(bsdf, "Emission Strength", glow)
    g.put(bsdf, "Subsurface Weight", 0.3)
    return mat


def lathe(name, profile, mat, segs=72, wobble=None):
    """绕 z 轴转一圈：profile 是 [(r, z), ...]；wobble(角度) 给伞边一点不圆。"""
    n = len(profile)
    verts = []
    for i, (r, z) in enumerate(profile):
        for j in range(segs):
            a = 2 * PI * j / segs
            rr = r * (1 + (wobble(a) if wobble else 0) * (i / (n - 1)))
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
    faces = []
    for i in range(n - 1):
        for j in range(segs):
            a0 = i * segs + j
            a1 = i * segs + (j + 1) % segs
            faces.append((a0, a1, a1 + segs, a0 + segs))
    return obj_from_arrays(name, np.array(verts), np.array(faces), mat)


def tubes(name, paths, mat, sides=5):
    verts, faces = [], []
    for path in paths:
        base = len(verts)
        n = len(path)
        for i, (p, r) in enumerate(path):
            d = (Vector(path[min(i + 1, n - 1)][0]) - Vector(path[max(i - 1, 0)][0])).normalized()
            x = d.orthogonal().normalized()
            y = d.cross(x)
            for k in range(sides):
                a = 2 * PI * k / sides
                verts.append(tuple(Vector(p) + (x * math.cos(a) + y * math.sin(a)) * r))
        for i in range(n - 1):
            for k in range(sides):
                a0 = base + i * sides + k
                a1 = base + i * sides + (k + 1) % sides
                faces.append((a0, a1, a1 + sides, a0 + sides))
    return obj_from_arrays(name, np.array(verts), np.array(faces), mat)


def build(phase):
    """第 phase（0 到 1）那一刻的水母。伞半径 1（单位随意，渲的时候按画面取景）。"""
    c = pulse(phase)
    radius = 1.0 - 0.18 * c
    height = 0.62 + 0.14 * c
    mats = {
        "bell": bell_material(),
        "gonad": soft_material("jelly_gonad", (0.85, 0.5, 0.75), 0.45, 0.6),
        "arm": soft_material("jelly_arm", (0.75, 0.72, 0.95), 0.35, 0.5),
        "tent": soft_material("jelly_tent", (0.7, 0.8, 1.0), 0.4, 0.8),
    }
    # 伞：外面一层从顶到边，翻过伞边再从里面回到顶下（有厚度）
    outer = []
    for k in range(24):
        t = k / 23
        a = t * PI / 2
        outer.append((radius * math.sin(a), height * math.cos(a) - 0.04 * t * t))
    lip = [(radius * 1.02, -0.07), (radius * 0.96, -0.09)]
    inner = []
    for k in range(18):
        t = 1 - k / 17
        a = t * PI / 2
        inner.append((radius * 0.92 * math.sin(a), (height - 0.14) * math.cos(a) - 0.06))
    lathe("bell", outer + lip + inner, mats["bell"], wobble=lambda a: 0.025 * math.sin(a * 8 + phase * 6.283))
    # 生殖腺：四个淡粉的马蹄形，贴在伞里
    paths = []
    for q in range(4):
        base = q * PI / 2 + PI / 4
        path = []
        for k in range(14):
            t = k / 13
            a = base + (t - 0.5) * 1.1
            rr = 0.32 + 0.12 * math.sin(t * PI)
            path.append(((rr * radius * math.cos(a), rr * radius * math.sin(a), height * 0.45), 0.05))
        paths.append(path)
    tubes("gonads", paths, mats["gonad"], 8)
    # 口腕：四条皱褶的带子从伞心垂下来，跟着收缩往后摆
    paths = []
    for q in range(4):
        a0 = q * PI / 2
        path = []
        for k in range(26):
            t = k / 25
            sway = 0.12 * math.sin(t * 5 - phase * 6.283) + 0.25 * c * t
            r = 0.12 + 0.08 * t
            path.append(((r * math.cos(a0) + sway * 0.3, r * math.sin(a0), -0.05 - t * 1.5 - 0.2 * c * t), 0.06 * (1 - 0.6 * t) * (1 + 0.35 * math.sin(t * 40))))
        paths.append(path)
    tubes("arms", paths, mats["arm"], 7)
    # 触手：伞边一圈细长的，收缩时往下往里甩，舒张时慢慢飘开
    paths = []
    for q in range(28):
        a = 2 * PI * q / 28
        path = []
        for k in range(30):
            t = k / 29
            wave = 0.08 * math.sin(t * 7 - phase * 6.283 + q)
            spread = radius * (1.0 - 0.25 * t * c + 0.08 * t * (1 - c))
            path.append(((spread * math.cos(a) + wave, spread * math.sin(a) + wave * 0.5, -0.08 - t * 2.4), 0.012 * (1 - 0.7 * t)))
        paths.append(path)
    tubes("tentacles", paths, mats["tent"], 4)


def main():
    opts = options()
    w, h = (int(v) for v in opts["size"].split("x"))
    frames = int(opts["frames"])
    out = os.path.abspath(opts["out"])
    os.makedirs(out, exist_ok=True)
    scene = bpy.context.scene
    for f in range(frames):
        core.reset()
        core.setup_render(scene, int(opts["samples"]), transparent=True)
        scene.render.resolution_x = w
        scene.render.resolution_y = h
        scene.cycles.transparent_max_bounces = 32
        build(f / frames)
        core.underwater_world(scene, top=(0.05, 0.12, 0.3), bottom=(0.0, 0.01, 0.03), strength=0.6)
        core.sun(scene, energy=2.5, color=(0.8, 0.9, 1.0), tilt_x=-30.0, tilt_y=10.0)
        cam_data = bpy.data.cameras.new("cam")
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = 4.4
        cam = bpy.data.objects.new("cam", cam_data)
        cam.location = (0.0, -10.0, -1.0 + 10 * math.tan(math.radians(14)))
        cam.rotation_euler = (math.radians(90 - 14), 0.0, 0.0)
        scene.collection.objects.link(cam)
        scene.camera = cam
        scene.render.filepath = os.path.join(out, f"f{f:02d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[jelly] 第 {f} 帧渲染完", flush=True)


main()
