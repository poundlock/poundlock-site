# 过闸那尾鱼：在 Blender 里程序建模（不用外部素材）、绑骨骼，按公式摆好每一帧的姿势，渲成带透明的序列帧。
# 两段循环，各一圈（默认 24 帧，摆一次尾、呼吸一次）：idle 悬停（身子轻摆、胸鳍划水）、swim 游动（波浪式摆尾）；页面按快慢调播放速度。
# 两段里呼吸的节奏一样：先张嘴（鳃盖合着），再闭嘴、鳃盖往外掀开露出鳃丝；页面在两段之间切换时头部对得上。
#
#   blender -b --factory-startup --python tools/reef/fish.py -- --out .shots/reef/fish [选项]
#
# 选项：--size 640x320  --samples 64  --frames 24（一圈多少帧）  --yaw 12 --pitch 12（镜头侧过、俯下的角度，和场景的镜头对上）
#      --action idle|swim|both  --only 0,12（只渲这几帧）  --blend 文件（存下场景）
# 给页面用：python -I tools/reef/atlas.py 把两套帧拼成 src/assets/reef/fish/ 下的两张图集（6 列 4 行）。
# 坐标：x 朝前（鼻尖 +0.5，尾柄 -0.5，尾鳍伸到 -0.86），z 朝上，y 朝两侧；镜头在 -y 那边看过去，鱼头朝画面右边。
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "film"))

from lockfilm import world  # noqa: E402
from lockfilm.util import loft, material  # noqa: E402

FRAMES = 60
PI = math.pi


def options():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    opts = {"size": "1400x700", "samples": "96", "action": "both", "only": "", "out": "", "blend": "", "frames": "24", "yaw": "12", "pitch": "12"}
    for key, value in zip(argv[0::2], argv[1::2]):
        opts[key.lstrip("-")] = value
    return opts


def reset():
    for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.worlds, bpy.data.armatures):
        for item in list(collection):
            collection.remove(item)


# —— 身子的轮廓 ——
def profile(x):
    """x 处的截面：半高 hz、半宽 hy、中线高度 zc。最高处在身长六成左右，头圆、往前收，尾柄细；嘴那里略往下。"""
    u = min(1.0, max(0.0, (x + 0.5) / 1.0))
    s = math.sin(PI * u ** 0.85) ** 0.95 if 0 < u < 1 else 0.0
    if u > 0.6:
        # 头：椭圆收口，吻端圆钝（不是尖的）
        peak = math.sin(PI * 0.6 ** 0.85) ** 0.95
        t = (u - 0.6) / 0.4
        s = peak * max(0.0, 1 - t ** 2.4) ** 0.5
    hz = 0.016 + 0.15 * s
    hy = 0.009 + 0.062 * s
    zc = 0.016 * (1 - ((x - 0.05) / 0.6) ** 2) - 0.024 * max(0.0, (x - 0.3) / 0.2) ** 2
    return hz, hy, zc


def section_point(x, a, scale=1.0):
    """截面上角度 a 处的点（a = 0 朝 +y，π/2 朝上）。截面是有点方的椭圆：腹部比背部饱满一点。"""
    hz, hy, zc = profile(x)
    c, s = math.cos(a), math.sin(a)
    y = hy * scale * math.copysign(abs(c) ** 0.85, c)
    z = zc + hz * scale * (1.0 if s < 0 else 0.96) * math.copysign(abs(s) ** 0.92, s)
    return (x, y, z)


MOUTH_X = 0.43  # 下颌的铰点（嘴角）：嘴在吻端，小
GILL_HINGE = 0.34  # 鳃盖的前缘（连着头的铰）
GILL_X0 = 0.2  # 鳃盖后缘中间那一点（离尾最近）


def mouth_line(x):
    """嘴裂的高度：从嘴角往前略往下斜。"""
    hz, hy, zc = profile(x)
    return zc - 0.28 * hz - 0.01 * (x - MOUTH_X) / 0.07


def make_body(rings=200, around=72):
    """身子。嘴裂以下的头部往里收、用口腔的材质（下颌那片单独的壳盖着它，张嘴时露出来）；
    鳃盖底下那一块往里收、用鳃丝的材质（鳃盖那片壳盖着它）。"""
    sections = []
    for i in range(rings + 1):
        x = -0.5 + 1.0 * i / rings
        sections.append([section_point(x, 2 * PI * j / around) for j in range(around)])
    mesh = loft("fish_body", sections, close_u=True, cap_start=True, cap_end=True)
    # 鼻尖收圆：最前面几圈往中心收
    verts = np.zeros(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", verts)
    v = verts.reshape(-1, 3)
    region = np.zeros(len(v), dtype=np.int32)  # 0 皮肤、1 口腔、2 鳃
    for k, (x, y, z) in enumerate(v):
        hz, hy, zc = profile(x)
        if x > MOUTH_X - 0.01 and z < mouth_line(x):
            # 口腔：往中线收三成，嘴角那里不收（过渡）
            f = min(1.0, (x - MOUTH_X + 0.01) / 0.05) * 0.3
            v[k] = (x, y * (1 - f), zc + (z - zc) * (1 - f * 0.6))
            region[k] = 1
        elif gill_edge(z) + 0.006 < x < GILL_HINGE - 0.01 and abs(z - zc) < 0.72 * hz:
            v[k] = (x, y * 0.97, z)
            region[k] = 2
    mesh.vertices.foreach_set("co", v.ravel())
    mesh.update()
    obj = bpy.data.objects.new("fish_body", mesh)
    bpy.context.scene.collection.objects.link(obj)
    store_rest(mesh)
    # 每个面按它的顶点归到皮肤、口腔或鳃
    for poly in mesh.polygons:
        kinds = [region[i] for i in poly.vertices]
        poly.material_index = 1 if kinds.count(1) >= 3 else 2 if kinds.count(2) >= 3 else 0
    smooth(mesh)
    return obj


def gill_edge(z):
    """鳃盖后缘（靠尾那边）：中间最靠后，上下往前收成一道弧。"""
    hz, hy, zc = profile(0.27)
    t = max(-1.0, min(1.0, (z - zc) / (0.72 * hz)))
    return GILL_X0 + 0.05 * t * t


def store_rest(mesh):
    """把建模时的位置存成属性 rest：骨骼动起来以后，鳞片、斑点这些花纹还贴在原来的地方。"""
    co = np.zeros(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", co)
    attr = mesh.attributes.new("rest", "FLOAT_VECTOR", "POINT")
    attr.data.foreach_set("vector", co)


def smooth(mesh):
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()


def surface_y(x, z):
    """x、z 处身子表面离中面多远（截面那个有点方的椭圆）。"""
    hz, hy, zc = profile(x)
    t = max(-1.0, min(1.0, (z - zc) / (hz * 0.97)))
    c = math.sqrt(max(0.0, 1 - abs(t) ** (2 / 0.92)))
    return hy * c ** 0.85


def make_jaw():
    """下颌：紧贴下半个头（只比头大一丝），往吻端收；上沿就是嘴裂，一道往前略往下弯的唇线。挂在颌骨上。"""
    sections = []
    xs = np.linspace(MOUTH_X - 0.02, 0.499, 26)
    for x in xs:
        top = mouth_line(x)
        hz, hy, zc = profile(x)
        ring = []
        for j in range(29):
            # 从一侧的嘴裂往下绕过腹面到另一侧的嘴裂
            a0 = math.asin(max(-1.0, min(1.0, (top - zc) / (hz * 0.97))))
            a = PI - a0 + (PI + 2 * a0) * j / 28
            grow = 0.985 + 0.021 * min(1.0, max(0.0, (x - MOUTH_X + 0.02) / 0.05))
            px, py, pz = section_point(x, a, grow)
            ring.append((px, py, pz))
        sections.append(ring)
    mesh = loft("fish_jaw", sections, cap_end=True)
    obj = bpy.data.objects.new("fish_jaw", mesh)
    bpy.context.scene.collection.objects.link(obj)
    store_rest(mesh)
    smooth(mesh)
    return obj


def make_operculum(side):
    """鳃盖：一片贴着鳃部的壳，前缘是铰（挂在鳃盖骨上），后缘一道弧，呼吸时往外掀。"""
    hz, hy, zc = profile(0.26)
    rows = []
    for i in range(18):
        t = i / 17
        row = []
        for j in range(22):
            zz = zc + (j / 21 * 2 - 1) * 0.74 * hz
            x = gill_edge(zz) - 0.004 + t * (GILL_HINGE - gill_edge(zz) + 0.004)
            hzx, hyx, zcx = profile(x)
            a = math.asin(max(-1.0, min(1.0, (zz - zcx) / (hzx * 0.97))))
            px, py, pz = section_point(x, a, 1.018 - 0.02 * t ** 1.5)
            row.append((px, side * abs(py), zz))
        rows.append(row)
    mesh = loft(f"fish_operculum_{'L' if side > 0 else 'R'}", rows)
    attr = mesh.attributes.new("op_t", "FLOAT", "POINT")
    attr.data.foreach_set("value", np.asarray([i / 17 for i in range(18) for _ in range(22)], dtype=np.float32))
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    store_rest(mesh)
    smooth(mesh)
    return obj


def make_gill_filaments(side):
    """鳃丝：鳃盖底下一排排细长的红片，鳃盖掀开时看得见。"""
    hz, hy, zc = profile(0.26)
    bm = bmesh.new()
    for k in range(22):
        zz = zc + (k / 21 * 2 - 1) * 0.48 * hz
        x0 = gill_edge(zz) + 0.008
        x1 = GILL_HINGE - 0.02
        y = side * surface_y((x0 + x1) / 2, zz) * 0.9
        for n in range(3):
            xa = x0 + (x1 - x0) * n / 3
            verts = [bm.verts.new((xa, y, zz - 0.002)), bm.verts.new((xa + (x1 - x0) / 3, y + side * 0.002, zz - 0.0015)), bm.verts.new((xa + (x1 - x0) / 3, y + side * 0.002, zz + 0.0015)), bm.verts.new((xa, y, zz + 0.002))]
            bm.faces.new(verts)
    mesh = bpy.data.meshes.new(f"fish_gills_{side}")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_eye(side):
    """眼睛：眼球（虹膜、瞳孔画在它的局部坐标上，局部 +z 朝外）加一层透明的角膜。"""
    hz, hy, zc = profile(0.385)
    center = Vector((0.385, side * hy * 0.78, zc + 0.032))
    objs = []
    for name, radius, segs in (("eye", 0.029, 64), ("cornea", 0.031, 64)):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=radius)
        mesh = bpy.data.meshes.new(f"fish_{name}_{side}")
        bm.to_mesh(mesh)
        bm.free()
        store_rest(mesh)
        smooth(mesh)
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = center + Vector((0, side * (0.0 if name == "eye" else 0.0015), 0))
        # 局部 +z 朝外（朝两侧），略朝前
        obj.rotation_euler = (-side * PI / 2, 0, side * 0.18)
        objs.append(obj)
    return objs


def fin_mesh(name, grid_u, grid_v, place, ridges=0.0, rays=14):
    """一片鳍：place(u, v) 给出位置（u 从根部到外缘，v 从一边到另一边）。鳍条处略微隆起（ridges）。
    存两个属性：fin_u（离根部多远）、fin_v（横向，鳍条的花纹用）。"""
    verts, us, vs = [], [], []
    for i in range(grid_u + 1):
        for j in range(grid_v + 1):
            u, v = i / grid_u, j / grid_v
            p = Vector(place(u, v))
            verts.append(p)
            us.append(u)
            vs.append(v)
    faces = []
    for i in range(grid_u):
        for j in range(grid_v):
            a = i * (grid_v + 1) + j
            b = a + grid_v + 1
            faces.append((a, b, b + 1, a + 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(p) for p in verts], [], faces)
    mesh.update()
    if ridges:
        mesh.calc_normals_split() if hasattr(mesh, "calc_normals_split") else None
        for k, vert in enumerate(mesh.vertices):
            ridge = (0.5 + 0.5 * math.cos(vs[k] * rays * 2 * PI)) ** 3 * us[k]
            vert.co += vert.normal * ridges * ridge
    for attr_name, values in (("fin_u", us), ("fin_v", vs)):
        attr = mesh.attributes.new(attr_name, "FLOAT", "POINT")
        attr.data.foreach_set("value", np.asarray(values, dtype=np.float32))
    smooth(mesh)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_fins():
    fins = {}
    # 尾鳍：分叉，上下两叶长、尖，中间短
    def caudal(u, v):
        w = v * 2 - 1
        length = 0.38 * (0.5 + 0.5 * abs(w) ** 1.15)
        hz, hy, zc = profile(-0.5)
        x = -0.48 - u * length
        z = zc + w * (0.02 + 0.2 * u ** 0.85) + 0.012 * u * w
        return (x, 0.0, z)
    fins["caudal"] = fin_mesh("fin_caudal", 20, 40, caudal, 0.0012, 22)

    # 背鳍：前高后低，往后掠
    def dorsal(u, v):
        x0 = 0.17 - 0.31 * v
        hz, hy, zc = profile(x0)
        h = 0.135 * (1 - v) ** 0.6 * (0.25 + 0.75 * math.sin(PI * min(1, v * 0.9 + 0.1)) ** 0.5) + 0.02
        return (x0 - u * 0.07 * (1 - v * 0.4), 0.0, zc + hz * 0.94 + u * h)
    fins["dorsal"] = fin_mesh("fin_dorsal", 12, 30, dorsal, 0.0009, 12)

    # 臀鳍：腹下靠尾
    def anal(u, v):
        x0 = -0.17 - 0.2 * v
        hz, hy, zc = profile(x0)
        h = 0.075 * (1 - v) ** 0.5 + 0.01
        return (x0 - u * 0.05, 0.0, zc - hz * 0.94 - u * h)
    fins["anal"] = fin_mesh("fin_anal", 10, 20, anal, 0.0007, 9)

    for side in (1, -1):
        tag = "L" if side > 0 else "R"
        # 胸鳍：鳃盖后下方，往后、往下、往外张
        hz, hy, zc = profile(0.18)
        base = Vector((0.185, side * hy * 1.02, zc - 0.06))

        def pectoral(u, v, base=base, side=side):
            w = (v * 2 - 1) * 0.04 * math.sin(PI * min(1, u * 0.92 + 0.08)) ** 0.5
            length = 0.16 * u
            return (base.x - length * 0.88 + w * 0.25, base.y + side * length * 0.38, base.z - length * 0.32 + w)
        fins[f"pectoral{tag}"] = fin_mesh(f"fin_pectoral_{tag}", 12, 16, pectoral, 0.0008, 10)

        # 腹鳍：腹下，小
        hz2, hy2, zc2 = profile(-0.02)
        base2 = Vector((-0.02, side * hy2 * 0.5, zc2 - hz2 * 0.9))

        def pelvic(u, v, base=base2, side=side):
            w = (v * 2 - 1) * 0.025 * math.sin(PI * min(1, u * 0.9 + 0.1)) ** 0.5
            length = 0.09 * u
            return (base.x - length * 0.9 + w * 0.3, base.y + side * length * 0.25, base.z - length * 0.4 + w)
        fins[f"pelvic{tag}"] = fin_mesh(f"fin_pelvic_{tag}", 8, 10, pelvic, 0.0006, 7)
    return fins


# —— 材质 ——
def rest_of(g):
    """建模时存下的位置（三维向量；工具里的 g.attr 取的是标量那一路）。"""
    return g.new("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": "rest"}).outputs["Vector"]


def rgba(*c):
    """颜色插口要四个数（带透明度）：rgba(r, g, b) 或 rgba((r, g, b))。"""
    if len(c) == 1:
        c = c[0]
    return (c[0], c[1], c[2], 1.0)


def operculum_material():
    """鳃盖：和身子一样的皮肤，后缘一道暗边（鳃盖和身子之间的缝），往前渐淡；鳃盖上没有鳞，有细细的放射纹。"""
    mat = skin_material("fish_operculum")
    tree = mat.node_tree
    from lockfilm.util import Graph
    g = Graph(tree)
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    base_link = bsdf.inputs["Base Color"].links[0].from_socket
    t = g.attr("op_t")
    seam = g.smooth(t, 0.12, 0.0)
    color = g.mix(g.math("MULTIPLY", seam, 0.85), base_link, (0.01, 0.015, 0.018))
    g.put(bsdf, "Base Color", color)
    return mat


def skin_material(name="fish_skin"):
    """皮肤（身子、下颌、鳃盖共用）：背深青、两侧银、腹白；鳞片前大后小，片片有边、深浅不一；
    一条侧线、背上一溜小斑；湿润的一层光泽（coat）、两侧淡淡的虹彩（thin film）；头部没有鳞片。"""
    mat, g, bsdf, _ = material(name)
    rest = rest_of(g)
    xyz = g.xyz(rest)
    x, z = xyz[0], xyz[2]
    # 离中线多高（相对半高）：-1 腹底、+1 背脊。中线和半高按 x 近似
    d = g.math("DIVIDE", g.math("SUBTRACT", x, 0.05), 0.6)
    zc = g.math("MULTIPLY", g.math("SUBTRACT", 1.0, g.math("MULTIPLY", d, d)), 0.016)
    rel = g.math("DIVIDE", g.math("SUBTRACT", z, zc), 0.13)
    back = (0.04, 0.09, 0.095)
    flank = (0.5, 0.54, 0.53)
    belly = (0.86, 0.84, 0.76)
    color = g.mix(g.smooth(rel, -0.75, 0.05), belly, flank)
    color = g.mix(g.smooth(rel, 0.1, 0.62), color, back)
    # 鳞片：错行排列、一片压一片的圆鳞，越往尾越小。每格里画一片圆：圆心偏头那边，露在外面的是朝尾那边的弧，
    # 弧上一道细细的暗边（下一片压上来的影子），每片深浅、反光略有不同
    head = g.smooth(x, 0.27, 0.33)
    no_head = g.math("SUBTRACT", 1.0, head)
    n = g.math("ADD", 62.0, g.math("MULTIPLY", g.math("SUBTRACT", 0.5, x), 26.0))
    sx = g.math("MULTIPLY", x, n)
    sz = g.math("MULTIPLY", z, g.math("MULTIPLY", n, 1.3))
    row = g.math("FLOOR", sz)
    sxo = g.math("ADD", sx, g.math("MULTIPLY", g.math("FLOORED_MODULO", row, 2.0), 0.5))
    fx = g.math("FRACT", sxo)
    fz = g.math("FRACT", sz)
    dx = g.math("SUBTRACT", fx, 0.72)
    dz = g.math("SUBTRACT", fz, 0.5)
    dist = g.math("SQRT", g.math("ADD", g.math("MULTIPLY", dx, dx), g.math("MULTIPLY", dz, dz)))
    dome = g.smooth(dist, 0.78, 0.0)
    rim = g.math("MULTIPLY", g.smooth(dist, 0.58, 0.7), g.smooth(dist, 0.82, 0.7))
    rim = g.math("MULTIPLY", rim, g.smooth(fx, 0.55, 0.1))
    cellid = g.new("ShaderNodeCombineXYZ", ins={0: g.math("FLOOR", sxo), 1: row, 2: 0.0}).outputs[0]
    rnd = g.new("ShaderNodeTexWhiteNoise", {"noise_dimensions": "3D"}, Vector=cellid).outputs["Value"]
    jitter = g.math("MULTIPLY", g.math("SUBTRACT", rnd, 0.5), 0.3)
    edge = g.math("MULTIPLY", rim, no_head)
    color = g.mix(g.math("MULTIPLY", edge, 0.55), color, g.mix(0.6, color, (0.0, 0.0, 0.0)))
    color = g.mix(g.math("MULTIPLY", g.math("ABSOLUTE", jitter), no_head), color, g.mix(0.5, color, (0.95, 0.97, 1.0)))
    # 侧线：中线略上一道断续的暗点
    line = g.math("MULTIPLY", g.smooth(g.math("ABSOLUTE", g.math("SUBTRACT", rel, 0.12)), 0.035, 0.0), g.smooth(g.math("SINE", g.math("MULTIPLY", x, 420.0)), -0.2, 0.6))
    line = g.math("MULTIPLY", line, g.math("MULTIPLY", g.smooth(x, -0.46, -0.3), g.smooth(x, 0.3, 0.2)))
    color = g.mix(g.math("MULTIPLY", line, 0.7), color, (0.05, 0.06, 0.06))
    # 背上的小斑点
    spots = g.math("MULTIPLY", g.smooth(g.noise(g.scaled(rest, (60.0, 60.0, 60.0)), 1.0, 1.0, 0.5), 0.62, 0.7), g.smooth(rel, 0.25, 0.6))
    color = g.mix(g.math("MULTIPLY", spots, 0.6), color, (0.01, 0.02, 0.02))
    # 头部：没有鳞片，皮肤更光滑、略深
    color = g.mix(g.math("MULTIPLY", head, 0.25), color, g.mix(0.5, color, back))
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Metallic", g.math("MULTIPLY", g.smooth(rel, 0.6, -0.3), 0.6))
    g.put(bsdf, "Roughness", g.math("ADD", 0.18, g.math("ADD", g.math("MULTIPLY", edge, 0.15), g.math("MULTIPLY", rnd, 0.08))))
    g.put(bsdf, "Coat Weight", 0.55)
    g.put(bsdf, "Coat Roughness", 0.08)
    g.put(bsdf, "Thin Film Thickness", g.math("ADD", 380.0, g.math("MULTIPLY", g.noise(g.scaled(rest, (8.0, 8.0, 8.0)), 1.0, 2.0), 260.0)))
    g.put(bsdf, "Thin Film IOR", 1.5)
    height = g.math("MULTIPLY", g.math("SUBTRACT", g.math("MULTIPLY", dome, 0.6), g.math("MULTIPLY", rim, 0.5)), no_head)
    height = g.math("ADD", height, g.math("MULTIPLY", g.noise(g.scaled(rest, (260.0, 260.0, 260.0)), 1.0, 2.0), 0.08))
    g.put(bsdf, "Normal", g.bump(height, 0.28, 0.0016))
    g.put(bsdf, "Subsurface Weight", 0.08)
    g.put(bsdf, "Subsurface Radius", (0.02, 0.02, 0.015))
    return mat


def mouth_material():
    mat, g, bsdf, _ = material("fish_mouth")
    g.put(bsdf, "Base Color", rgba(0.05, 0.008, 0.01))
    g.put(bsdf, "Roughness", 0.35)
    return mat


def gill_material():
    """鳃丝：暗红，一道道细纹，越深处越暗。"""
    mat, g, bsdf, _ = material("fish_gill")
    rest = rest_of(g)
    xyz = g.xyz(rest)
    stripes = g.smooth(g.math("SINE", g.math("MULTIPLY", xyz[2], 900.0)), -0.3, 0.8)
    color = g.mix(stripes, (0.22, 0.02, 0.025), (0.55, 0.07, 0.07))
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", 0.4)
    g.put(bsdf, "Subsurface Weight", 0.3)
    g.put(bsdf, "Subsurface Radius", (0.01, 0.002, 0.002))
    return mat


def filament_material():
    mat, g, bsdf, _ = material("fish_filament")
    g.put(bsdf, "Base Color", rgba(0.58, 0.08, 0.08))
    g.put(bsdf, "Roughness", 0.45)
    g.put(bsdf, "Subsurface Weight", 0.4)
    return mat


def eye_material():
    """眼球：瞳孔黑而小，虹膜一圈银金色、带放射纹，靠外一圈暗；局部 +z 朝外。"""
    mat, g, bsdf, _ = material("fish_eyeball")
    xyz = g.xyz(rest_of(g))
    r = g.math("DIVIDE", g.vmath("LENGTH", g.new("ShaderNodeCombineXYZ", ins={0: xyz[0], 1: xyz[1], 2: 0.0}).outputs[0]).outputs["Value"], 0.029)
    front = g.smooth(xyz[2], -0.004, 0.012)
    angle = g.new("ShaderNodeMath", {"operation": "ARCTAN2"})
    g.put(angle, 0, xyz[1])
    g.put(angle, 1, xyz[0])
    streak = g.noise(g.new("ShaderNodeCombineXYZ", ins={0: g.math("MULTIPLY", angle.outputs[0], 9.0), 1: g.math("MULTIPLY", r, 4.0), 2: 0.0}).outputs[0], 2.0, 4.0, 0.65)
    iris = g.mix(streak, (0.42, 0.36, 0.2), (0.92, 0.86, 0.66))
    iris = g.mix(g.smooth(r, 0.36, 0.5), (0.2, 0.17, 0.1), iris)
    iris = g.mix(g.smooth(r, 0.62, 0.86), iris, (0.03, 0.035, 0.03))
    color = g.mix(g.smooth(r, 0.3, 0.34), (0.002, 0.002, 0.003), iris)
    color = g.mix(front, (0.03, 0.035, 0.035), color)
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", 0.25)
    g.put(bsdf, "Metallic", g.math("MULTIPLY", g.smooth(r, 0.34, 0.5), g.smooth(r, 0.8, 0.6)))
    return mat


def cornea_material():
    mat, g, bsdf, _ = material("fish_cornea")
    g.put(bsdf, "Base Color", rgba(1.0, 1.0, 1.0))
    g.put(bsdf, "Transmission Weight", 1.0)
    g.put(bsdf, "Roughness", 0.0)
    g.put(bsdf, "IOR", 1.376)
    return mat


def fin_material():
    """鳍：薄膜几乎透明、带一点暖灰，鳍条细、颜色深一点；越往外越淡越透，外缘一道很淡的亮边。"""
    mat, g, bsdf, _ = material("fish_fin")
    u = g.attr("fin_u")
    v = g.attr("fin_v")
    rays = g.smooth(g.math("COSINE", g.math("MULTIPLY", v, 2 * PI * 14.0)), 0.55, 0.97)
    color = g.mix(rays, (0.62, 0.62, 0.56), (0.36, 0.37, 0.34))
    color = g.mix(g.smooth(u, 0.7, 1.0), color, (0.82, 0.84, 0.8))
    alpha = g.math("ADD", g.math("MULTIPLY", rays, 0.22), 0.42)
    alpha = g.math("MULTIPLY", alpha, g.smooth(u, 1.0, 0.75, 0.25, 1.0))
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", 0.28)
    g.put(bsdf, "Alpha", alpha)
    g.put(bsdf, "Subsurface Weight", 0.2)
    g.put(bsdf, "Coat Weight", 0.3)
    return mat


# —— 骨骼 ——
SPINE = [("head", 0.46, 0.2), ("spine1", 0.2, 0.05), ("spine2", 0.05, -0.1), ("spine3", -0.1, -0.24), ("spine4", -0.24, -0.37), ("spine5", -0.37, -0.5), ("tail", -0.5, -0.82)]


def make_rig():
    data = bpy.data.armatures.new("fish_rig")
    rig = bpy.data.objects.new("fish_rig", data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    up = Vector((0, 0, 1))
    parent = None
    for name, x0, x1 in SPINE:
        zc0 = profile(x0)[2]
        zc1 = profile(x1)[2] if x1 > -0.5 else profile(-0.5)[2]
        bone = data.edit_bones.new(name)
        bone.head = (x0, 0, zc0)
        bone.tail = (x1, 0, zc1)
        bone.align_roll(up)
        if parent is not None:
            bone.parent = parent
            bone.use_connect = True
        parent = bone
    head = data.edit_bones["head"]
    jz = mouth_line(MOUTH_X)
    jaw = data.edit_bones.new("jaw")
    jaw.head = (MOUTH_X, 0, jz)
    jaw.tail = (0.5, 0, jz - 0.012)
    jaw.align_roll(up)
    jaw.parent = head
    for side in (1, -1):
        tag = "L" if side > 0 else "R"
        hz, hy, zc = profile(GILL_HINGE)
        op = data.edit_bones.new(f"operculum.{tag}")
        op.head = (GILL_HINGE, side * hy, zc - 0.07)
        op.tail = (GILL_HINGE, side * hy, zc + 0.07)
        op.align_roll(Vector((1, 0, 0)))
        op.parent = head
        hz, hy, zc = profile(0.18)
        pec = data.edit_bones.new(f"pectoral.{tag}")
        pec.head = (0.185, side * hy * 1.02, zc - 0.06)
        pec.tail = (0.04, side * (hy * 1.02 + 0.06), zc - 0.11)
        pec.align_roll(Vector((0, side, 0)))
        pec.parent = data.edit_bones["spine1"]
        hz, hy, zc = profile(-0.02)
        pel = data.edit_bones.new(f"pelvic.{tag}")
        pel.head = (-0.02, side * hy * 0.5, zc - hz * 0.9)
        pel.tail = (-0.1, side * (hy * 0.5 + 0.02), zc - hz * 0.9 - 0.035)
        pel.align_roll(Vector((0, side, 0)))
        pel.parent = data.edit_bones["spine2"]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
    return rig


def spine_weights(x):
    """x 处的顶点归给哪两节脊椎、各多少：按每节的中点线性插值。"""
    centers = [(name, (x0 + x1) / 2) for name, x0, x1 in SPINE]
    if x >= centers[0][1]:
        return [(centers[0][0], 1.0)]
    if x <= centers[-1][1]:
        return [(centers[-1][0], 1.0)]
    for (n0, c0), (n1, c1) in zip(centers, centers[1:]):
        if c1 <= x <= c0:
            t = (c0 - x) / (c0 - c1)
            return [(n0, 1 - t), (n1, t)]
    return [(centers[0][0], 1.0)]


def bind(obj, rig, weights_of):
    """把物体挂到骨骼上：weights_of(顶点坐标) → [(骨头, 权重)]。"""
    obj.parent = rig
    mod = obj.modifiers.new("rig", "ARMATURE")
    mod.object = rig
    groups = {}
    basis = obj.matrix_basis.copy()
    for v in obj.data.vertices:
        for name, w in weights_of(basis @ v.co):
            if name not in groups:
                groups[name] = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
            groups[name].add([v.index], w, "REPLACE")


def pose(rig, action, frame):
    """第 frame 帧的姿势。φ 走一整圈是一段循环（FRAMES 帧）：游和停都是摆一次尾、呼吸一次，页面按快慢调播放的速度。"""
    phi = 2 * PI * frame / FRAMES
    names = [name for name, _, _ in SPINE]
    weight = [0.05, 0.12, 0.22, 0.38, 0.6, 0.85, 1.0]
    if action == "swim":
        amp, cycles, lag = 0.3, 1, 0.85
    else:
        amp, cycles, lag = 0.07, 1, 0.55
    for i, name in enumerate(names):
        rig.pose.bones[name].rotation_euler = (0.0, 0.0, amp * weight[i] * math.sin(cycles * phi - lag * i) * (0.55 if i == 0 else 1.0))
    # 呼吸：先张嘴（鳃盖合着），再闭嘴、鳃盖往外掀
    mouth = 0.5 - 0.5 * math.cos(phi)
    gills = 0.5 - 0.5 * math.cos(phi - PI)
    rig.pose.bones["jaw"].rotation_euler = (0.11 * mouth, 0.0, 0.0)
    for side in (1, -1):
        tag = "L" if side > 0 else "R"
        rig.pose.bones[f"operculum.{tag}"].rotation_euler = (0.0, -side * 0.16 * gills, 0.0)
        if action == "swim":
            flap = 0.45 + 0.08 * math.sin(cycles * phi + side)
        else:
            flap = 0.15 + 0.35 * math.sin(phi + (0.0 if side > 0 else 0.4))
        rig.pose.bones[f"pectoral.{tag}"].rotation_euler = (0.0, 0.0, side * flap)
        rig.pose.bones[f"pelvic.{tag}"].rotation_euler = (0.0, 0.0, side * (0.1 + 0.12 * math.sin(phi + 1.0)))


def build():
    skin, mouth, gill, filament = skin_material(), mouth_material(), gill_material(), filament_material()
    op_skin = operculum_material()
    body = make_body()
    body.data.materials.append(skin)
    body.data.materials.append(mouth)
    body.data.materials.append(gill)
    jaw = make_jaw()
    jaw.data.materials.append(skin)
    rig = make_rig()
    bind(body, rig, lambda p: spine_weights(p.x))
    bind(jaw, rig, lambda p: [("jaw", 1.0)])
    for side in (1, -1):
        tag = "L" if side > 0 else "R"
        op = make_operculum(side)
        op.data.materials.append(op_skin)
        bind(op, rig, lambda p, tag=tag: [(f"operculum.{tag}", 1.0)])
        fil = make_gill_filaments(side)
        fil.data.materials.append(filament)
        bind(fil, rig, lambda p: [("head", 1.0)])
        eye, cornea = make_eye(side)
        eye.data.materials.append(eye_material())
        cornea.data.materials.append(cornea_material())
        for obj in (eye, cornea):
            bind(obj, rig, lambda p: [("head", 1.0)])
    fin = fin_material()
    for name, obj in make_fins().items():
        obj.data.materials.append(fin)
        if name == "caudal":
            bind(obj, rig, lambda p: [("spine5", max(0.0, min(1.0, (p.x + 0.56) / 0.12))), ("tail", 1 - max(0.0, min(1.0, (p.x + 0.56) / 0.12)))])
        elif name.startswith("pectoral"):
            tag = name[-1]
            bind(obj, rig, lambda p, tag=tag: [(f"pectoral.{tag}", 1.0)])
        elif name.startswith("pelvic"):
            tag = name[-1]
            bind(obj, rig, lambda p, tag=tag: [(f"pelvic.{tag}", 1.0)])
        else:
            bind(obj, rig, lambda p: spine_weights(p.x))
    return rig


def lights_and_camera(scene, width, height, yaw_deg=12.0, pitch_deg=12.0):
    """水下的光：头顶一盏柔的主光（略暖的白），下面一盏冷的补光，背后一道青的轮廓光；世界是深蓝的水。"""
    sun = bpy.data.lights.new("key", "SUN")
    sun.energy = 7.5
    sun.angle = math.radians(9)
    sun.color = (1.0, 0.97, 0.9)
    key = bpy.data.objects.new("key", sun)
    key.rotation_euler = (math.radians(6), math.radians(32), 0)
    scene.collection.objects.link(key)
    fill = bpy.data.lights.new("fill", "AREA")
    fill.energy = 18
    fill.size = 3.0
    fill.color = (0.3, 0.55, 0.8)
    f = bpy.data.objects.new("fill", fill)
    f.location = (0.0, -1.6, -1.6)
    f.rotation_euler = (math.radians(135), 0, 0)
    scene.collection.objects.link(f)
    rim = bpy.data.lights.new("rim", "AREA")
    rim.energy = 140
    rim.size = 2.0
    rim.color = (0.55, 0.85, 1.0)
    r = bpy.data.objects.new("rim", rim)
    r.location = (-0.4, 1.8, 1.1)
    r.rotation_euler = (math.radians(-60), 0, math.radians(180))
    scene.collection.objects.link(r)
    w = bpy.data.worlds.new("water")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.012, 0.045, 0.07, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    scene.world = w
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 100
    cam = bpy.data.objects.new("cam", cam_data)
    # 从前斜方 25°、略微俯视看过去：正侧面看不出身子左右的摆动（摆动方向和视线重合），斜一点就看得见
    yaw, pitch, dist = math.radians(yaw_deg), math.radians(pitch_deg), 5.2
    target = Vector((-0.17, 0.0, 0.02))
    cam.location = target + Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    cam.rotation_euler = (math.radians(90) - pitch, 0, yaw)
    scene.collection.objects.link(cam)
    scene.camera = cam


def main():
    opts = options()
    scene = bpy.context.scene
    reset()
    width, height = (int(v) for v in opts["size"].lower().split("x"))
    world.render_settings(scene, width, height, int(opts["samples"]))
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.cycles.transparent_max_bounces = 16
    global FRAMES
    FRAMES = int(opts["frames"])
    rig = build()
    lights_and_camera(scene, width, height, float(opts["yaw"]), float(opts["pitch"]))
    out = os.path.abspath(opts["out"] or ".shots/reef/fish")
    actions = ["idle", "swim"] if opts["action"] == "both" else [opts["action"]]
    only = {int(v) for v in opts["only"].split(",") if v.strip()} if opts["only"] else None
    if opts["blend"]:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opts["blend"]))
    for action in actions:
        folder = os.path.join(out, action)
        os.makedirs(folder, exist_ok=True)
        for frame in range(FRAMES):
            if only is not None and frame not in only:
                continue
            pose(rig, action, frame)
            bpy.context.view_layer.update()
            scene.render.filepath = os.path.join(folder, f"f{frame:02d}.png")
            bpy.ops.render.render(write_still=True)
            print(f"[fish] {action} 第 {frame} 帧渲染完", flush=True)


main()
