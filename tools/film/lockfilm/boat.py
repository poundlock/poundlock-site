# 船：一条运河上的窄船。黑的钢船体，深青色的舱，舱里亮着灯，船头一盏灯照着前面的闸门。
# 船自己的坐标：x 朝船头，原点在水线、船身正中。
import math

import bpy

from .util import Boxes, assign, bevel, empty, lathe, link, loft, rot_x, shade_smooth, tube

HALF = 1.03  # 半个船宽
STERN = -7.5
BOW = 7.5
CABIN = (-5.0, 3.4)
LEAN = math.atan2(0.16, 1.02)  # 舱壁往里收的角度


def half_beam(x):
    if x < -6.2:
        t = (-6.2 - x) / 1.3
        return max(0.035, HALF * math.sqrt(max(0.0, 1.0 - t * t)))
    if x > 4.2:
        t = min(1.0, (x - 4.2) / 3.3)
        return max(0.035, HALF * (1.0 - t**2.3) ** 0.85)
    return HALF


def gunwale(x):
    return 0.42 + 0.34 * max(0.0, (x - 3.4) / 4.1) ** 2 + 0.05 * max(0.0, (-5.2 - x) / 2.3) ** 2


def _stations(a, b, step):
    count = max(2, int(round((b - a) / step)) + 1)
    return [a + (b - a) * k / (count - 1) for k in range(count)]


def _hull():
    xs = _stations(STERN, -6.2, 0.13) + _stations(-6.0, 4.0, 0.5) + _stations(4.2, BOW, 0.165)
    sections = []
    for x in xs:
        b = half_beam(x)
        gz = gunwale(x)
        rake = 0.42 * max(0.0, (x - 4.2) / 3.3) ** 2
        half = [
            (0.0, -0.56),
            (0.55 * b, -0.56),
            (0.9 * b, -0.54),
            (b, -0.42),
            (b, -0.02),
            (b + 0.028, 0.03),
            (b + 0.028, 0.085),
            (b, 0.13),
            (b, gz - 0.15),
            (b + 0.034, gz - 0.11),
            (b + 0.034, gz - 0.035),
            (b, gz),
            (b - 0.05, gz + 0.016),
            (b - 0.11, gz + 0.016),
        ]
        port = [(x + rake * (z + 0.56), -y, z) for y, z in reversed(half[1:])]
        star = [(x + rake * (z + 0.56), y, z) for y, z in half]
        sections.append(port + star)
    return loft("hull", sections, cap_start=True, cap_end=True)


def _deck():
    xs = _stations(STERN, BOW, 0.25)
    sections = []
    for x in xs:
        b = max(0.02, half_beam(x) - 0.11)
        gz = gunwale(x)
        rake = 0.42 * max(0.0, (x - 4.2) / 3.3) ** 2 * (gz + 0.57)
        sections.append([(x + rake, -b, gz + 0.016), (x + rake, 0.0, gz + 0.03), (x + rake, b, gz + 0.016)])
    return loft("deck", sections)


def _cabin():
    sections = []
    for x in _stations(CABIN[0], CABIN[1], 0.6):
        gz = gunwale(x)
        w = HALF - 0.12
        half = [
            (w, gz + 0.01),
            (w - 0.16, gz + 1.02),
            (w - 0.165, gz + 1.075),
            (w - 0.225, gz + 1.075),
            (w - 0.24, gz + 1.04),
            ((w - 0.24) * 0.72, gz + 1.095),
            ((w - 0.24) * 0.38, gz + 1.125),
            (0.0, gz + 1.135),
        ]
        star = [(x, y, z) for y, z in half]
        port = [(x, -y, z) for y, z in reversed(half[:-1])]
        sections.append(star + port)
    return loft("cabin", sections, close_u=True, cap_start=True, cap_end=True)


def _cover():
    """船头的篷布：从舱的前脸搭到船头那块三角板上。"""
    sections = []
    for x in _stations(CABIN[1] - 0.02, 5.45, 0.34):
        t = (x - CABIN[1]) / (5.45 - CABIN[1])
        gz = gunwale(x)
        w = half_beam(x) - 0.1
        ridge = gz + 1.11 - 0.2 * t
        sag = 0.035 * math.sin(math.pi * t)
        sections.append(
            [
                (x, -w, gz + 0.02),
                (x, -w * 0.82, gz + 0.5 - sag),
                (x, -w * 0.42, ridge - 0.2 - sag),
                (x, 0.0, ridge),
                (x, w * 0.42, ridge - 0.2 - sag),
                (x, w * 0.82, gz + 0.5 - sag),
                (x, w, gz + 0.02),
            ]
        )
    return loft("cover", sections, cap_end=True)


def _torus(name, major, minor, segments=28, ring=12):
    sections = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        sections.append(
            [
                ((major + minor * math.cos(2 * math.pi * k / ring)) * math.cos(a), (major + minor * math.cos(2 * math.pi * k / ring)) * math.sin(a), minor * math.sin(2 * math.pi * k / ring))
                for k in range(ring)
            ]
        )
    return loft(name, sections, close_u=True, close_v=True)


def _ellipsoid(name, rx, ry, rz, segments=18, rings=10):
    profile = [(max(1e-4, math.sin(math.pi * k / rings)), -math.cos(math.pi * k / rings)) for k in range(rings + 1)]
    mesh = lathe(name, profile, segments, cap_start=False, cap_end=False)
    for v in mesh.vertices:
        v.co = (v.co.x * rx, v.co.y * ry, v.co.z * rz)
    return mesh


def build(mats):
    """返回 (船的根物体, 船头灯)。"""
    root = empty("boat")

    def add(name, mesh, mat, smooth=True, subsurf=0, bevel_w=0.0, location=None, rotation=None, shadow=True):
        obj = link(bpy.data.objects.new(name, mesh), root)
        if bevel_w:
            bevel(obj, bevel_w, 2, 30)
        if subsurf:
            mod = obj.modifiers.new("smooth", "SUBSURF")
            mod.levels = subsurf
            mod.render_levels = subsurf
        if smooth:
            shade_smooth(mesh)
        assign(obj, mat)
        if location:
            obj.location = location
        if rotation:
            obj.rotation_euler = rotation
        obj.visible_shadow = shadow
        return obj

    add("hull", _hull(), mats["hull"], subsurf=2)
    add("deck", _deck(), mats["deckpaint"], subsurf=1)
    cabin = add("cabin", _cabin(), mats["cabin"], bevel_w=0.014)
    # 舱顶另用一种漆（朝上的面）。
    cabin.data.materials.append(mats["roof"])
    for poly in cabin.data.polygons:
        if poly.normal.z > 0.5:
            poly.material_index = 1
    add("cover", _cover(), mats["canvas"], subsurf=2)

    gz = gunwale(0.0)
    brass = Boxes()
    glass = Boxes()
    cream = Boxes()
    dark = Boxes()
    wood = Boxes()

    def on_side(side, x, h, size, target, out=0.0):
        """贴在舱壁上的一块：side 是 +1（左舷）或 -1，h 是离舷边多高，out 是凸出多少。"""
        y = HALF - 0.12 - 0.16 * (h / 1.02) + out
        target.add((x, side * y, gz + 0.01 + h + out * math.tan(LEAN)), size, rot=rot_x(side * LEAN))

    for side in (1, -1):
        for x in (-2.7, -0.45, 1.8):
            on_side(side, x, 0.6, (0.98, 0.016, 0.46), glass, 0.004)
            on_side(side, x, 0.6 + 0.25, (1.06, 0.03, 0.045), brass, 0.008)
            on_side(side, x, 0.6 - 0.25, (1.06, 0.03, 0.045), brass, 0.008)
            for dx in (-0.51, 0.51):
                on_side(side, x + dx, 0.6, (0.045, 0.03, 0.5), brass, 0.008)
            on_side(side, x, 0.6, (0.03, 0.022, 0.46), brass, 0.006)
        # 上下两道奶油色的饰线，中间一块写船名的牌子。
        for h in (0.13, 0.97):
            on_side(side, -0.8, h, (8.0, 0.008, 0.028), cream, 0.002)
        on_side(side, -4.1, 0.56, (1.25, 0.008, 0.5), dark, 0.002)
        for h in (0.56 + 0.27, 0.56 - 0.27):
            on_side(side, -4.1, h, (1.31, 0.01, 0.022), cream, 0.004)
        for dx in (-0.645, 0.645):
            on_side(side, -4.1 + dx, 0.56, (0.022, 0.01, 0.56), cream, 0.004)

    # 舱后面的两扇门、门上的小窗，舱顶的滑盖。
    for y in (-0.21, 0.21):
        dark.add((CABIN[0] - 0.012, y, gz + 0.5), (0.03, 0.4, 0.9))
        dark.add((CABIN[1] + 0.012, y, gz + 0.52), (0.03, 0.38, 0.95))
    dark.add((CABIN[0] + 0.5, 0.0, gz + 1.16), (0.95, 0.8, 0.04))
    # 舱顶上：撑篙、跳板，架在两个木托上。
    wood.add((0.3, 0.28, gz + 1.215), (3.4, 0.24, 0.035))
    for x in (-0.9, 1.5):
        wood.add((x, 0.12, gz + 1.17), (0.07, 0.7, 0.07))

    add("brass", brass.mesh("brass"), mats["brass"], bevel_w=0.004)
    add("glass", glass.mesh("glass"), mats["window"], smooth=False, shadow=False)
    add("cream", cream.mesh("cream"), mats["cream"], smooth=False)
    add("dark", dark.mesh("dark"), mats["cabin_dark"], bevel_w=0.006)
    add("roofwood", wood.mesh("roofwood"), mats["pole"], bevel_w=0.008)
    add("pole", tube("pole", [(-1.6, -0.02, gz + 1.235), (2.2, -0.02, gz + 1.235)], 0.022), mats["pole"])


    # 舱顶上的杂物：盘好的缆绳、一口木箱、两个种着东西的木槽。
    for k, (major, z) in enumerate(((0.2, 0.0), (0.17, 0.034), (0.13, 0.066))):
        add(f"coil{k}", _torus(f"coil{k}", major, 0.019, 22, 8), mats["rope"], location=(1.25, -0.36, gz + 1.15 + z))
    clutter = Boxes()
    clutter.add((-1.75, -0.3, gz + 1.25), (0.8, 0.42, 0.24))
    for x in (0.1, -3.3):
        clutter.add((x, -0.42 if x > 0 else 0.4, gz + 1.21), (0.85, 0.2, 0.16))
    add("clutter", clutter.mesh("clutter"), mats["pole"], bevel_w=0.008)
    for n, (x, y) in enumerate(((-0.15, -0.42), (0.1, -0.42), (0.36, -0.42), (-3.5, 0.4), (-3.25, 0.4), (-3.02, 0.4))):
        add(f"shrub{n}", _ellipsoid(f"shrub{n}", 0.13, 0.11, 0.12, 10, 6), mats["needles"], location=(x, y, gz + 1.36))
    # 船尾甲板上一盏小灯，照着舵柄。
    stern = bpy.data.lights.new("sternlight", "POINT")
    stern.energy = 7.0
    stern.color = (1.0, 0.66, 0.34)
    stern.shadow_soft_size = 0.03
    link(bpy.data.objects.new("sternlight", stern), root).location = (-5.35, 0.0, gz + 0.95)

    # 舷窗：铜圈里一块亮着的玻璃。
    ring = [(0.0, 0.0), (0.17, 0.0), (0.17, 0.02), (0.15, 0.035), (0.125, 0.035), (0.12, 0.012), (0.0, 0.012)]
    for side in (1, -1):
        for x in (-3.55, 2.85):
            y = HALF - 0.12 - 0.16 * (0.62 / 1.02)
            rotation = ((LEAN - math.pi / 2) if side > 0 else (math.pi / 2 - LEAN), 0.0, 0.0)
            add(f"port{side}{x}", lathe("porthole", ring, 24), mats["brass"], location=(x, side * y, gz + 0.63), rotation=rotation)
            add(f"lens{side}{x}", lathe("lens", [(0.0, 0.0), (0.122, 0.0), (0.122, 0.016), (0.0, 0.016)], 24), mats["window"], location=(x, side * (y + 0.003), gz + 0.63), rotation=rotation, shadow=False)

    # 烟囱和通风帽。
    flue = [(0.0, 0.0), (0.075, 0.0), (0.075, 0.5), (0.085, 0.5), (0.085, 0.54), (0.075, 0.54), (0.075, 0.62), (0.095, 0.66), (0.0, 0.66)]
    add("flue", lathe("flue", flue, 18), mats["hull"], location=(2.3, -0.4, gz + 1.11))
    for z in (0.2, 0.46):
        add(f"band{z}", lathe("band", [(0.0, 0.0), (0.079, 0.0), (0.079, 0.035), (0.0, 0.035)], 18), mats["brass"], location=(2.3, -0.4, gz + 1.11 + z))
    vent = [(0.0, 0.0), (0.05, 0.0), (0.05, 0.06), (0.11, 0.075), (0.1, 0.1), (0.04, 0.125), (0.0, 0.13)]
    for x in (-3.4, -1.2, 0.8):
        add(f"vent{x}", lathe("vent", vent, 18), mats["brass"], location=(x, 0.0, gz + 1.13))
    add("buoy", _torus("buoy", 0.27, 0.055), mats["buoy"], location=(-2.4, 0.33, gz + 1.19))

    # 船头：三角板、船头灯、系缆桩、缆绳护舷。
    bx = 5.45
    bw = half_beam(bx) - 0.1
    bg = gunwale(bx)
    board = bpy.data.meshes.new("board")
    verts = []
    for dx in (0.0, 0.05):
        verts += [(bx + dx, -bw, bg + 0.02), (bx + dx, bw, bg + 0.02), (bx + dx, 0.0, bg + 0.95)]
    board.from_pydata(verts, [], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])
    board.update()
    add("board", board, mats["cabin"], smooth=False, bevel_w=0.01)
    lamp_body = [(0.0, 0.0), (0.05, 0.0), (0.085, 0.03), (0.095, 0.12), (0.1, 0.13), (0.1, 0.145), (0.0, 0.145)]
    lamp_at = (bx + 0.06, 0.0, bg + 1.02)
    add("lamp", lathe("lamp", lamp_body, 20), mats["brass"], location=lamp_at, rotation=(0.0, math.pi / 2, 0.0))
    add("lamplens", lathe("lamplens", [(0.0, 0.0), (0.088, 0.0), (0.088, 0.008), (0.0, 0.008)], 20), mats["headlamp"], location=(lamp_at[0] + 0.146, 0.0, lamp_at[2]), rotation=(0.0, math.pi / 2, 0.0), shadow=False)
    add("lampfoot", lathe("lampfoot", [(0.0, 0.0), (0.02, 0.0), (0.02, 0.1), (0.0, 0.1)], 10), mats["brass"], location=(bx + 0.12, 0.0, bg + 0.9))
    stud = [(0.0, 0.0), (0.06, 0.0), (0.045, 0.02), (0.035, 0.12), (0.075, 0.14), (0.075, 0.17), (0.0, 0.18)]
    add("stud", lathe("stud", stud, 16), mats["hull"], location=(6.6, 0.0, gunwale(6.6) + 0.02))
    add("bowfender", _ellipsoid("bowfender", 0.2, 0.17, 0.42), mats["rope"], location=(BOW + 0.2, 0.0, gunwale(BOW) - 0.22))
    add("sternfender", _ellipsoid("sternfender", 0.17, 0.5, 0.15), mats["rope"], location=(STERN - 0.12, 0.0, gunwale(STERN) - 0.12))

    # 船尾：鹅颈舵柄，铜的，把手是木头。
    sg = gunwale(-7.0)
    neck = [(-7.05, 0.0, sg), (-7.05, 0.0, sg + 0.62), (-7.0, 0.0, sg + 0.84), (-6.85, 0.0, sg + 0.96), (-6.6, 0.0, sg + 1.0), (-6.1, 0.0, sg + 1.0)]
    add("tiller", tube("tiller", neck, 0.03, 12), mats["brass"], subsurf=1)
    add("tillergrip", tube("tillergrip", [(-6.1, 0.0, sg + 1.0), (-5.72, 0.0, sg + 1.0)], [0.024, 0.02], 12), mats["pole"])

    # 船头灯：一束暖白的光，往前、略朝下。
    data = bpy.data.lights.new("headlight", "SPOT")
    data.energy = 900.0
    data.color = (1.0, 0.86, 0.66)
    data.spot_size = math.radians(48)
    data.spot_blend = 0.55
    data.shadow_soft_size = 0.05
    head = link(bpy.data.objects.new("headlight", data), root)
    head.location = (lamp_at[0] + 0.2, 0.0, lamp_at[2])
    head.rotation_euler = (0.0, math.radians(-86), 0.0)
    return root, head
