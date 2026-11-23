# 过闸场景的公用部分：素材目录、清场、扫描贴图材质、水雾、斜俯的正交镜头、渲染设置。
#
# 坐标：x 朝右（鱼游的方向），y 朝里（离看的人越远越大），z 朝上；沙地大约在 z = 0，鱼在 y = 0 那个面上。
# 镜头是正交的、往下俯 TILT：所以一块块长条图横着接得严丝合缝，离得远的地面在画面上更高。
# 画面竖直方向用 s = y·sinθ + z·cosθ 量（θ 是俯角），中景一屏高 VIEW_H 米。
# 远景、近景是各自的一套世界，镜头的 ortho_scale 不同（scale 小就显得远），横向的米数和中景共用：
# 几段场景的交界在各层的同一个 x 上，页面按 scale 给各层不同的平移速度，视差就对了。
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "film"))

from lockfilm import world  # noqa: E402
from lockfilm.util import Graph, material  # noqa: E402

PI = math.pi
TILT = math.radians(12)
VIEW_H = 1.6
VIEW_S0 = -0.15
VIEWER_Y = -1.5
STRIP_PX = 1800

# 素材根目录：每套素材一个子目录（Poly Haven 的 CC0 贴图和模型），由 --assets 或环境变量 REEF_ASSETS 给
ASSETS = os.environ.get("REEF_ASSETS", "")

# 水：能见距离（米）、每米吃掉多少红绿蓝、颜色（画面下沿和上沿）。每段场景自己设。
FOG = {
    "vis": 8.0,
    "absorb": (0.12, 0.03, 0.015),
    "low": (0.012, 0.09, 0.13),
    "high": (0.06, 0.32, 0.42),
    "dist_add": 0.0,
    "dist_mul": 1.0,
}
# 当前这一层的镜头（算水的颜色在画面上的高低要用）
LAYER = {"scale": 1.0, "tilt": TILT, "s0": VIEW_S0}


def options(defaults):
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    opts = dict(defaults)
    for key, value in zip(argv[0::2], argv[1::2]):
        opts[key.lstrip("-")] = value
    global ASSETS
    if opts.get("assets"):
        ASSETS = opts["assets"]
    return opts


def reset():
    _IMAGES.clear()
    for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.worlds, bpy.data.collections, bpy.data.images, bpy.data.textures, bpy.data.node_groups):
        for item in list(collection):
            collection.remove(item)


def rgba(c):
    return (c[0], c[1], c[2], 1.0)


def srgb(hex_or_tuple):
    """sRGB 的 0–255 或 #rrggbb 换成 Blender 要的线性值。"""
    if isinstance(hex_or_tuple, str):
        h = hex_or_tuple.lstrip("#")
        c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    else:
        c = [v / 255 for v in hex_or_tuple]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def collection(name):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def obj_from_bm(name, bm, mat=None, col="scene", smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if smooth:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    if mat is not None:
        mesh.materials.append(mat)
    collection(col).objects.link(obj)
    return obj


def obj_from_arrays(name, verts, faces, mat=None, col="scene", uvs=None, attrs=None, smooth=True):
    """顶点（n×3）、四边形面（m×4）直接建网格；uvs 按顶点给（n×2）；attrs 是 {名字: 每顶点一个数}。"""
    mesh = bpy.data.meshes.new(name)
    verts = np.asarray(verts, dtype=np.float32)
    faces = np.asarray(faces, dtype=np.int32)
    mesh.vertices.add(len(verts))
    mesh.vertices.foreach_set("co", verts.ravel())
    nf, k = faces.shape
    mesh.loops.add(nf * k)
    mesh.loops.foreach_set("vertex_index", faces.ravel())
    mesh.polygons.add(nf)
    mesh.polygons.foreach_set("loop_start", np.arange(0, nf * k, k, dtype=np.int32))
    mesh.polygons.foreach_set("loop_total", np.full(nf, k, dtype=np.int32))
    mesh.update(calc_edges=True)
    if uvs is not None:
        layer = mesh.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", np.asarray(uvs, dtype=np.float32)[faces.ravel()].ravel())
    for key, values in (attrs or {}).items():
        a = mesh.attributes.new(key, "FLOAT", "POINT")
        a.data.foreach_set("value", np.asarray(values, dtype=np.float32))
    if smooth:
        mesh.polygons.foreach_set("use_smooth", np.ones(nf, dtype=bool))
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    if mat is not None:
        mesh.materials.append(mat)
    collection(col).objects.link(obj)
    return obj


# —— 扫描贴图 ——
_IMAGES = {}


def asset_path(asset, kind):
    ext = "png" if kind == "disp" else "jpg"
    return os.path.join(ASSETS, asset, "textures", f"{asset}_{kind}_2k.{ext}")


def image(asset, kind):
    path = asset_path(asset, kind)
    if path in _IMAGES:
        return _IMAGES[path]
    if not os.path.exists(path):
        _IMAGES[path] = None
        return None
    img = bpy.data.images.load(path, check_existing=True)
    if kind != "diff":
        img.colorspace_settings.name = "Non-Color"
    _IMAGES[path] = img
    return img


_HEIGHTS = {}


def heightmap(asset):
    """高度图读成 numpy（0–1），给几何位移用。"""
    if asset in _HEIGHTS:
        return _HEIGHTS[asset]
    img = image(asset, "disp")
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    arr = px.reshape(h, w, 4)[:, :, 0].copy()
    _HEIGHTS[asset] = arr
    return arr


def sample(arr, u, v):
    """按 0–1 的坐标双线性取样（平铺）。u、v 是 numpy 数组。"""
    h, w = arr.shape
    x = (np.asarray(u) % 1.0) * w - 0.5
    y = (np.asarray(v) % 1.0) * h - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx, fy = x - x0, y - y0
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    a = arr[y0, x0] * (1 - fx) + arr[y0, x1] * fx
    b = arr[y1, x0] * (1 - fx) + arr[y1, x1] * fx
    return a * (1 - fy) + b * fy


def tex_node(g, asset, kind, vector, box=True):
    img = image(asset, kind)
    if img is None:
        return None
    node = g.new("ShaderNodeTexImage")
    node.image = img
    node.interpolation = "Cubic" if kind == "disp" else "Linear"
    if box:
        node.projection = "BOX"
        node.projection_blend = 0.3
    g.put(node, "Vector", vector)
    return node


def scan_layers(g, asset, vector, box=True):
    """一套扫描贴图的颜色、粗糙度、高度三个插口（没有的给 None）。"""
    diff = tex_node(g, asset, "diff", vector, box)
    color = diff.outputs["Color"]
    rough = None
    r = tex_node(g, asset, "rough", vector, box)
    if r is not None:
        rough = r.outputs["Color"]
    else:
        arm = tex_node(g, asset, "arm", vector, box)
        if arm is not None:
            sep = g.new("ShaderNodeSeparateColor")
            g.put(sep, "Color", arm.outputs["Color"])
            rough = sep.outputs[1]
    d = tex_node(g, asset, "disp", vector, box)
    height = d.outputs["Color"] if d is not None else None
    return color, rough, height


def grade(g, color, sat=1.0, value=1.0, tint=None, hue=0.5):
    hsv = g.new("ShaderNodeHueSaturation")
    g.put(hsv, "Hue", hue)
    g.put(hsv, "Saturation", sat)
    g.put(hsv, "Value", value)
    g.put(hsv, "Color", color)
    out = hsv.outputs["Color"]
    if tint is not None:
        out = g.mix(1.0, out, tint, blend="MULTIPLY")
    return out


def world_vector(g, size_m):
    """世界坐标除以贴图代表的真实尺寸：一张贴图正好铺 size_m 米。"""
    return g.scaled(g.position(), (1 / size_m,) * 3)


def scan_material(name, asset, size_m, sat=1.0, value=1.0, tint=None, rough_mul=1.0, bump=0.5, bump_dist=0.01, hue=0.5):
    """整个物体只用一套扫描贴图（按世界坐标盒状投影，不用 UV）。"""
    mat, g, bsdf, _ = material(name)
    vec = world_vector(g, size_m)
    color, rough, height = scan_layers(g, asset, vec)
    g.put(bsdf, "Base Color", grade(g, color, sat, value, tint, hue))
    if rough is not None:
        g.put(bsdf, "Roughness", g.math("MULTIPLY", rough, rough_mul, clamp=True))
    else:
        g.put(bsdf, "Roughness", 0.8)
    if height is not None and bump > 0:
        g.put(bsdf, "Normal", g.bump(height, bump, bump_dist))
    return mat


# —— 水雾 ——
def x_ramp(g, x, stops, x0, x1):
    """沿 x 变的颜色：stops 是 [(x, (r, g, b)), ...]（从小到大），用颜色渐变节点按 x 插值。"""
    node = g.new("ShaderNodeValToRGB")
    ramp = node.color_ramp
    ramp.interpolation = "EASE"
    for i, (sx, c) in enumerate(stops):
        pos = min(1.0, max(0.0, (sx - x0) / (x1 - x0)))
        e = ramp.elements[i] if i < 2 else ramp.elements.new(pos)
        e.position = pos
        e.color = (c[0], c[1], c[2], 1.0)
    g.put(node, "Fac", g.remap(x, x0, x1))
    return node.outputs["Color"]


def fog_terms(g):
    """返回 (离看的人多远, 雾的浓淡 0–1, 雾的颜色) 三个插口。FOG 里有 ramp 时颜色和能见距离沿 x 变（一段一段的水）。"""
    pos = g.xyz(g.position())
    x, y, z = pos[0], pos[1], pos[2]
    d = g.math("MAXIMUM", g.math("SUBTRACT", y, VIEWER_Y / LAYER["scale"]), 0.0)
    d = g.math("MULTIPLY_ADD", d, FOG["dist_mul"], FOG["dist_add"])
    tilt = LAYER["tilt"]
    s = g.math("ADD", g.math("MULTIPLY", y, math.sin(tilt)), g.math("MULTIPLY", z, math.cos(tilt)))
    h = VIEW_H / LAYER["scale"]
    t = g.smooth(g.remap(s, LAYER["s0"], LAYER["s0"] + h), 0.0, 1.0)
    ramp = FOG.get("ramp")
    if ramp:
        x0, x1 = ramp[0][0] - 1.0, ramp[-1][0] + 1.0
        low = x_ramp(g, x, [(sx, lo) for sx, lo, hi, vis in ramp], x0, x1)
        high = x_ramp(g, x, [(sx, hi) for sx, lo, hi, vis in ramp], x0, x1)
        vis_c = g.new("ShaderNodeSeparateColor")
        g.put(vis_c, "Color", x_ramp(g, x, [(sx, (vis / 20.0, 0.0, 0.0)) for sx, lo, hi, vis in ramp], x0, x1))
        vis = g.math("MULTIPLY", vis_c.outputs[0], 20.0)
        color = g.mix(t, low, high)
    else:
        vis = FOG["vis"]
        color = g.mix(t, FOG["low"], FOG["high"])
    f = g.math("SUBTRACT", 1.0, g.math("EXPONENT", g.math("DIVIDE", g.math("MULTIPLY", d, -1.0), vis)))
    return d, f, color


def fogify(mat):
    """给材质套上水：底色按距离吃掉红绿蓝，再按距离混进水的颜色（自发光，和远处的水底色一致）。"""
    tree = mat.node_tree
    g = Graph(tree)
    out = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
    # 带镂空的材质（海扇的网眼）只给不透明的那一半套水，镂空的地方照样透出后面
    target = tree.nodes[mat["alpha_mix"]].inputs[2] if mat.get("alpha_mix") else out.inputs["Surface"]
    if not target.links:
        return mat
    surface = target.links[0].from_socket
    d, f, color = fog_terms(g)
    k = FOG["absorb"]
    comb = g.new("ShaderNodeCombineColor")
    for i in range(3):
        g.put(comb, i, g.math("EXPONENT", g.math("MULTIPLY", d, -k[i])))
    for node in [n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"]:
        socket = node.inputs["Base Color"]
        if socket.links:
            src = socket.links[0].from_socket
            tree.links.remove(socket.links[0])
        else:
            src = socket.default_value
        g.put(node, "Base Color", g.mix(1.0, src, comb.outputs[0], blend="MULTIPLY"))
    em = g.new("ShaderNodeEmission")
    g.put(em, "Color", color)
    g.put(em, "Strength", 1.0)
    mix = g.new("ShaderNodeMixShader")
    g.put(mix, 0, f)
    tree.links.new(surface, mix.inputs[1])
    tree.links.new(em.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], target)
    return mat


def fog_all():
    for mat in bpy.data.materials:
        if mat.use_nodes and not mat.get("nofog"):
            fogify(mat)


def water_backdrop(name="backdrop", x0=-50, x1=50):
    """一面竖在最远处的「水」：颜色就是雾的颜色（雾浓度 1），给不透明的底层用。"""
    mat, g, bsdf, out = material(name)
    _, _, color = fog_terms(g)
    em = g.new("ShaderNodeEmission")
    g.put(em, "Color", color)
    tree = mat.node_tree
    tree.links.new(em.outputs[0], out.inputs["Surface"])
    tree.nodes.remove(bsdf)
    mat["nofog"] = True
    h = VIEW_H / LAYER["scale"]
    yb = 60.0
    bm = bmesh.new()
    zs = [-20.0, 40.0]
    v = [bm.verts.new((x, yb, z)) for z in zs for x in (x0, x1)]
    bm.faces.new((v[0], v[1], v[3], v[2]))
    return obj_from_bm(name, bm, mat, "back")


# —— 光、镜头、渲染 ——
def underwater_world(scene, top=(0.25, 0.55, 0.65), bottom=(0.01, 0.04, 0.06), strength=0.9):
    """环境光：头顶亮（透过水面的天光）、脚下暗。正交镜头的背景是透明的，这只管照明。"""
    w = bpy.data.worlds.new("water")
    w.use_nodes = True
    tree = w.node_tree
    g = Graph(tree)
    bg = tree.nodes["Background"]
    coord = g.new("ShaderNodeTexCoord")
    sep = g.xyz(coord.outputs["Generated"])
    t = g.smooth(sep[2], -0.2, 0.8)
    g.put(bg, "Color", g.mix(t, bottom, top))
    g.put(bg, "Strength", strength)
    scene.world = w
    return w


def sun(scene, energy=4.0, color=(0.9, 0.98, 1.0), tilt_x=14.0, tilt_y=-16.0, angle=4.0):
    data = bpy.data.lights.new("sun", "SUN")
    data.energy = energy
    data.color = color
    data.angle = math.radians(angle)
    obj = bpy.data.objects.new("sun", data)
    obj.rotation_euler = (math.radians(tilt_x), math.radians(tilt_y), 0.0)
    scene.collection.objects.link(obj)
    return obj


def camera(scene, x_center, width_px, height_px, scale=1.0, tilt=TILT, s0=VIEW_S0):
    """斜俯的正交镜头：画面竖直方向正好是 [s0, s0 + VIEW_H/scale]（s 的定义见文件开头）。"""
    LAYER.update(scale=scale, tilt=tilt, s0=s0)
    h = VIEW_H / scale
    data = bpy.data.cameras.new("cam")
    data.type = "ORTHO"
    data.sensor_fit = "VERTICAL"
    data.ortho_scale = h
    data.clip_start = 0.1
    data.clip_end = 400.0
    obj = bpy.data.objects.new("cam", data)
    fwd = Vector((0.0, math.cos(tilt), -math.sin(tilt)))
    up = Vector((0.0, math.sin(tilt), math.cos(tilt)))
    center = Vector((x_center, 0.0, 0.0)) + up * (s0 + h / 2)
    obj.location = center - fwd * 120.0
    obj.rotation_euler = (math.pi / 2 - tilt, 0.0, 0.0)
    scene.collection.objects.link(obj)
    scene.camera = obj
    scene.render.resolution_x = width_px
    scene.render.resolution_y = height_px
    return obj


def view_width(width_px, height_px, scale=1.0):
    return VIEW_H / scale * width_px / height_px


def setup_render(scene, samples, transparent=True):
    world.render_settings(scene, 100, 100, samples)
    scene.render.film_transparent = transparent
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.cycles.adaptive_threshold = 0.03
    scene.cycles.transparent_max_bounces = 16


# —— 给页面用的辅助图 ——
def override_materials(kind):
    """把所有材质换成辅助图要的样子（保留海扇这类的镂空）：
    light：纯白漫反射，只开太阳——渲出来就是每一处被阳光直射多少（含阴影），页面拿它决定光斑落在哪；
    sway：自发光，亮度 = 这一处跟着水流摆多少（材质上的 sway 乘顶点的 tip），页面拿它让海葵、海扇、海草摆。"""
    for mat in list(bpy.data.materials):
        if not mat.use_nodes:
            continue
        tree = mat.node_tree
        g = Graph(tree)
        out = next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
        if out is None:
            continue
        if kind == "light":
            sh = g.new("ShaderNodeBsdfDiffuse")
            g.put(sh, "Color", (1.0, 1.0, 1.0, 1.0))
        else:
            sh = g.new("ShaderNodeEmission")
            amount = float(mat.get("sway", 0.0))
            if amount > 0:
                g.put(sh, "Color", g.math("MULTIPLY", g.smooth(g.attr("tip"), 0.1, 1.0), amount))
            else:
                g.put(sh, "Color", (0.0, 0.0, 0.0, 1.0))
            g.put(sh, "Strength", 1.0)
        target = tree.nodes[mat["alpha_mix"]].inputs[2] if mat.get("alpha_mix") else out.inputs["Surface"]
        tree.links.new(sh.outputs[0], target)


def setup_aux(scene, kind):
    """辅助图的渲染设置：标准色彩变换（数值原样落进图里），采样少；sway 不用降噪。"""
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.cycles.samples = 24 if kind == "light" else 8
    scene.cycles.use_denoising = kind == "light"
    if scene.world is not None:
        scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    for obj in scene.objects:
        if obj.type == "LIGHT" and obj.name != "sun":
            obj.hide_render = True
        elif obj.type == "LIGHT" and kind == "light":
            # 白色漫反射在正对太阳时落在 0.6 上下：不过曝，阴影和斜面的深浅都留得住
            obj.data.energy = 2.0
