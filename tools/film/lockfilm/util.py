# 建模和搭节点时反复用到的小工具。只在 Blender 自带的 Python 里跑。
import math

import bmesh
import bpy
import numpy as np

CORNERS = np.array(
    [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    dtype=np.float64,
) * 0.5
QUADS = np.array([[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]])


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, parent=None):
    return link(bpy.data.objects.new(name, None), parent)


def shade_smooth(mesh):
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()


def set_attr(mesh, name, values):
    attr = mesh.attributes.new(name, "FLOAT", "POINT")
    attr.data.foreach_set("value", np.asarray(values, dtype=np.float32))


class Boxes:
    """攒一堆长方体，最后合成一个网格。每块可以带自己的转角和按顶点写下去的数值。"""

    def __init__(self):
        self.rows = []
        self.rots = []
        self.attrs = {}

    def add(self, center, size, rot=None, **attrs):
        self.rows.append((*center, *size))
        self.rots.append(rot)
        for key, value in attrs.items():
            self.attrs.setdefault(key, [0.0] * (len(self.rows) - 1)).append(value)
        for key, values in self.attrs.items():
            if len(values) < len(self.rows):
                values.append(0.0)

    def span(self, x0, x1, y0, y1, z0, z1, **attrs):
        self.add(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), **attrs)

    def __len__(self):
        return len(self.rows)

    def mesh(self, name, dz_from=None):
        rows = np.asarray(self.rows, dtype=np.float64).reshape(-1, 6)
        n = len(rows)
        local = CORNERS[None] * rows[:, None, 3:6]
        for i, rot in enumerate(self.rots):
            if rot is not None:
                local[i] = local[i] @ np.asarray(rot, dtype=np.float64).T
        verts = (rows[:, None, 0:3] + local).reshape(-1, 3)
        faces = (QUADS[None] + (np.arange(n) * 8)[:, None, None]).reshape(-1, 4)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts.tolist(), [], faces.tolist())
        mesh.update()
        for key, values in self.attrs.items():
            set_attr(mesh, key, np.repeat(np.asarray(values, dtype=np.float32), 8))
        if dz_from is not None:
            # dz：这一点在「常年泡水的那条线」以下多少米（正的在线下）。
            set_attr(mesh, "dz", np.repeat(np.asarray(dz_from, dtype=np.float64), 8) - verts[:, 2])
        return mesh


def rot_y(angle):
    c, s = math.cos(angle), math.sin(angle)
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]]


def rot_x(angle):
    c, s = math.cos(angle), math.sin(angle)
    return [[1, 0, 0], [0, c, -s], [0, s, c]]


def rot_z(angle):
    c, s = math.cos(angle), math.sin(angle)
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]


def loft(name, sections, close_u=False, close_v=False, cap_start=False, cap_end=False):
    """把一串截面（每个是同样多的点）连成面。close_u：截面自己首尾相接；close_v：最后一个截面接回第一个。"""
    count = len(sections[0])
    verts = [tuple(p) for section in sections for p in section]
    faces = []
    rows = len(sections)
    for r in range(rows if close_v else rows - 1):
        a = r * count
        b = ((r + 1) % rows) * count
        for k in range(count if close_u else count - 1):
            k2 = (k + 1) % count
            faces.append((a + k, a + k2, b + k2, b + k))
    if cap_start:
        faces.append(tuple(range(count - 1, -1, -1)))
    if cap_end:
        base = (rows - 1) * count
        faces.append(tuple(base + k for k in range(count)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def lathe(name, profile, segments=24, cap_end=True, cap_start=True):
    """profile：一串 (半径, 高度)，绕 z 轴转一圈。"""
    sections = []
    for r, z in profile:
        sections.append([(r * math.cos(2 * math.pi * k / segments), r * math.sin(2 * math.pi * k / segments), z) for k in range(segments)])
    return loft(name, sections, close_u=True, cap_start=cap_start, cap_end=cap_end)


def tube(name, points, radius, segments=10):
    """沿一串点拉一根圆管（给扶手、舵柄、缆绳用）。"""
    from mathutils import Vector

    pts = [Vector(p) for p in points]
    sections = []
    up = Vector((0, 0, 1))
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        tangent = (b - a).normalized()
        side = tangent.cross(up)
        if side.length < 1e-4:
            side = tangent.cross(Vector((1, 0, 0)))
        side.normalize()
        other = side.cross(tangent).normalized()
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        sections.append([tuple(p + (side * math.cos(2 * math.pi * k / segments) + other * math.sin(2 * math.pi * k / segments)) * r) for k in range(segments)])
    return loft(name, sections, close_u=True, cap_start=True, cap_end=True)


def join_meshes(name, meshes):
    """把几个网格并成一个（各自的顶点数值不保留）。"""
    bm = bmesh.new()
    for mesh in meshes:
        bm.from_mesh(mesh)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    for mesh in meshes:
        bpy.data.meshes.remove(mesh)
    out.update()
    return out


def bevel(obj, width=0.01, segments=2, angle=40):
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = True
    return mod


def roughen(obj, texture, strength, levels=2):
    """把面细分以后沿法线挤一点噪声，让石头、木头的轮廓不是笔直的。"""
    sub = obj.modifiers.new("subdivide", "SUBSURF")
    sub.subdivision_type = "SIMPLE"
    sub.levels = levels
    sub.render_levels = levels
    mod = obj.modifiers.new("roughen", "DISPLACE")
    mod.texture = texture
    mod.texture_coords = "GLOBAL"
    mod.strength = strength
    mod.mid_level = 0.5
    return mod


def clouds(name, scale, depth=2):
    tex = bpy.data.textures.new(name, "CLOUDS")
    tex.noise_scale = scale
    tex.noise_depth = depth
    return tex


class Graph:
    """搭着色器节点的简写。输入给的是插口就连线，给的是数就填默认值。"""

    def __init__(self, tree):
        self.tree = tree

    def new(self, kind, props=None, ins=None, **named):
        node = self.tree.nodes.new(kind)
        for key, value in (props or {}).items():
            setattr(node, key, value)
        for key, value in (ins or {}).items():
            self.put(node, key, value)
        for key, value in named.items():
            self.put(node, key.replace("_", " "), value)
        return node

    def put(self, node, key, value):
        socket = node.inputs[key]
        if isinstance(value, bpy.types.NodeSocket):
            self.tree.links.new(value, socket)
        else:
            socket.default_value = value

    def value(self, v=0.0):
        node = self.new("ShaderNodeValue")
        node.outputs[0].default_value = v
        return node.outputs[0]

    def rgb(self, color):
        node = self.new("ShaderNodeRGB")
        node.outputs[0].default_value = (*color[:3], 1.0)
        return node.outputs[0]

    def math(self, op, a, b=None, c=None, clamp=False):
        node = self.new("ShaderNodeMath", {"operation": op, "use_clamp": clamp})
        self.put(node, 0, a)
        if b is not None:
            self.put(node, 1, b)
        if c is not None:
            self.put(node, 2, c)
        return node.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        node = self.new("ShaderNodeVectorMath", {"operation": op})
        self.put(node, 0, a)
        if b is not None:
            self.put(node, 1, b)
        if scale is not None:
            self.put(node, "Scale", scale)
        return node

    def mix(self, fac, a, b, blend="MIX"):
        node = self.new("ShaderNodeMix", {"data_type": "RGBA", "blend_type": blend})
        self.put(node, 0, fac)
        self.put(node, 6, a if isinstance(a, bpy.types.NodeSocket) else (*a[:3], 1.0))
        self.put(node, 7, b if isinstance(b, bpy.types.NodeSocket) else (*b[:3], 1.0))
        return node.outputs[2]

    def mixf(self, fac, a, b):
        node = self.new("ShaderNodeMix", {"data_type": "FLOAT"})
        self.put(node, 0, fac)
        self.put(node, 2, a)
        self.put(node, 3, b)
        return node.outputs[0]

    def smooth(self, v, lo, hi, out_lo=0.0, out_hi=1.0):
        node = self.new("ShaderNodeMapRange", {"interpolation_type": "SMOOTHSTEP"})
        self.put(node, 0, v)
        self.put(node, 1, lo)
        self.put(node, 2, hi)
        self.put(node, 3, out_lo)
        self.put(node, 4, out_hi)
        return node.outputs[0]

    def remap(self, v, lo, hi, out_lo=0.0, out_hi=1.0):
        node = self.new("ShaderNodeMapRange", {"clamp": True})
        self.put(node, 0, v)
        self.put(node, 1, lo)
        self.put(node, 2, hi)
        self.put(node, 3, out_lo)
        self.put(node, 4, out_hi)
        return node.outputs[0]

    def noise(self, vector=None, scale=5.0, detail=3.0, rough=0.55, w=None, color=False):
        node = self.new("ShaderNodeTexNoise", {"noise_dimensions": "4D" if w is not None else "3D"})
        if vector is not None:
            self.put(node, "Vector", vector)
        if w is not None:
            self.put(node, "W", w)
        self.put(node, "Scale", scale)
        self.put(node, "Detail", detail)
        self.put(node, "Roughness", rough)
        return node.outputs[1 if color else 0]

    def voronoi(self, vector=None, scale=5.0, feature="F1", distance=False):
        node = self.new("ShaderNodeTexVoronoi", {"feature": feature})
        if vector is not None:
            self.put(node, "Vector", vector)
        self.put(node, "Scale", scale)
        return node.outputs[0]

    def scaled(self, vector, scale, offset=(0, 0, 0)):
        node = self.new("ShaderNodeMapping")
        self.put(node, "Vector", vector)
        node.inputs["Scale"].default_value = scale
        node.inputs["Location"].default_value = offset
        return node.outputs[0]

    def attr(self, name, kind="GEOMETRY"):
        node = self.new("ShaderNodeAttribute", {"attribute_type": kind, "attribute_name": name})
        return node.outputs[2]

    def position(self):
        return self.new("ShaderNodeNewGeometry").outputs["Position"]

    def normal(self):
        return self.new("ShaderNodeNewGeometry").outputs["Normal"]

    def object_coords(self):
        return self.new("ShaderNodeTexCoord").outputs["Object"]

    def xyz(self, vector):
        node = self.new("ShaderNodeSeparateXYZ")
        self.put(node, 0, vector)
        return node.outputs

    def bump(self, height, strength=0.3, distance=0.02, normal=None):
        node = self.new("ShaderNodeBump")
        self.put(node, "Height", height)
        self.put(node, "Strength", strength)
        self.put(node, "Distance", distance)
        if normal is not None:
            self.put(node, "Normal", normal)
        return node.outputs[0]


def material(name):
    """新建一个材质，返回 (材质, 搭节点的工具, 主着色器节点, 输出节点)。"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    return mat, Graph(tree), bsdf, out


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj
