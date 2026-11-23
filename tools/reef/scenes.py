# 过闸一节的场景：在 Blender 里搭（程序生成的珊瑚、海草、巨藻，加 Poly Haven 的 CC0 扫描贴图和模型），
# 斜俯的正交镜头，按远景、中景两层分开渲成长条图（切成一块块），再渲一条很矮的水底色；近景是单独的小图。
# 页面按滚动横着平移各层（远景慢、中景快），再叠上实时的光斑、摆动、鱼群、气泡（src/scripts/lock-reef.js）。
# 八段怎么排、在哪交界、水什么颜色见 journey.py；画面里有什么见主仓库 docs/superpowers/specs/2026-11-22-过闸场景.md。
#
# 试看一帧：
#   blender -b --factory-startup --python tools/reef/scenes.py -- --assets <素材目录> --layer mid --x 1.0 --size 2250x1800 --out <png>
# 渲长条图（每块左右多渲 PAD_PX 像素，压图时裁掉）：
#   blender -b --factory-startup --python tools/reef/scenes.py -- --assets <素材目录> --layer mid --tiles all --outdir .shots/reef/strip --aux 1
# 选项：--tiles all | 3 | 2-6 | 0,4,9    --samples 128    --aux 1（中景另渲阳光直射图和摆动图；only 只重渲这两张）   --resume 1（跳过已有的块）
#      --backdrop 1（试看一帧时垫上水的底色）  --blend <文件>（存一份 .blend 看场景）
# 素材目录也可以用环境变量 REEF_ASSETS 给。
import math
import os
import random
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import journey as J  # noqa: E402
import reef_core as core  # noqa: E402
import reef_coral as rc  # noqa: E402
import reef_plants as rp  # noqa: E402
import reef_rock as rr  # noqa: E402

PI = math.pi
CELL = 0.2  # 摆东西的格子宽（米）：每格用自己的随机数，只建画面附近的格子，各块渲出来的东西也一样


def stable_hash(*parts):
    h = 2166136261
    for ch in repr(parts):
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def rng(*parts):
    return random.Random(stable_hash(*parts))


def pick(r, table):
    total = sum(w for _, w in table)
    x = r.uniform(0, total)
    for kind, w in table:
        x -= w
        if x <= 0:
            return kind
    return table[-1][0]


def presence_v(k, X):
    return np.vectorize(lambda x: J.presence(k, x))(X)


def cells(xa, xb, cell):
    return range(int(math.floor(xa / cell)), int(math.ceil(xb / cell)))


# —— S1 珊瑚礁 ——
def coral_height(X, Y):
    """礁顶在 y≈2.3 米处，再往后往下掉（礁坡）：正交镜头没有地平线，靠这道坎把后面的地面藏起来，露出远景和开阔的水。"""
    back = np.maximum(0.0, Y - 2.3)
    return 0.05 * np.tanh(Y - 0.6) - 0.9 * back * back


def coral_far_height(X, Y):
    back = np.maximum(0.0, Y - 4.0)
    return 0.1 * np.sin(X * 0.7) - 0.5 * back * back


def coral_rubble(X, Y):
    return 0.55 + 0.5 * np.sin(X * 3.1 + 1.3) * np.sin(Y * 2.3 + 0.4) + 0.25 * np.sin(X * 9.0 + Y * 5.0)


CORAL_BANDS = {
    # 名字: (y 起, y 止, 每格放几个, [(种类, 权重), ...])
    "front": (-0.9, -0.3, (0, 2), [("rubble", 4), ("pebble", 3), ("boulder_s", 2), ("star", 1), ("urchin", 1), ("brain_s", 1), ("shell", 1)]),
    "m1": (-0.15, 0.7, (2, 4), [("brain", 3), ("boulder", 3), ("staghorn", 3), ("bushy", 4), ("anemone", 2), ("sponge", 1), ("vase", 1), ("rubble", 2), ("boulder_s", 2)]),
    "m2": (0.7, 1.6, (2, 4), [("rockhead", 4), ("staghorn", 3), ("table", 1), ("fan", 3), ("brain", 2), ("boulder", 2), ("bushy", 3), ("sponge", 1), ("vase", 1)]),
    "back": (1.6, 2.5, (2, 3), [("rockhead", 4), ("table", 1), ("fan", 3), ("staghorn", 3), ("boulder", 2), ("bushy", 2)]),
}


def place(kind, name, x, y, z, r):
    if kind == "brain":
        rad = r.uniform(0.12, 0.22)
        rc.brain_coral(name, (x, y, z + rad * 0.15), rad, r.randrange(1 << 20), mat=r.choice(["brain", "brain", "brain_rose"]))
    elif kind == "brain_s":
        rad = r.uniform(0.06, 0.1)
        rc.brain_coral(name, (x, y, z + rad * 0.15), rad, r.randrange(1 << 20))
    elif kind == "boulder":
        rad = r.uniform(0.1, 0.24)
        rc.boulder_coral(name, (x, y, z + rad * 0.1), rad, r.randrange(1 << 20), r.uniform(0.55, 0.8), mat=r.choice(["porites", "porites_green"]))
    elif kind == "boulder_s":
        rad = r.uniform(0.04, 0.08)
        rc.boulder_coral(name, (x, y, z), rad, r.randrange(1 << 20), 0.7)
    elif kind == "staghorn":
        rc.acropora(name, (x, y, z - 0.01), r.randrange(1 << 20), height=r.uniform(0.3, 0.5), spread=0.5, levels=5, radius=0.015, mat="staghorn")
    elif kind == "bushy":
        rc.acropora(name, (x, y, z - 0.01), r.randrange(1 << 20), height=r.uniform(0.18, 0.28), spread=0.8, levels=4, radius=0.008, mat=r.choice(["acro_blue", "staghorn", "acro_purple"]), bushy=True)
    elif kind == "table":
        rc.table_coral(name, (x, y, z - 0.01), r.randrange(1 << 20), r.uniform(0.18, 0.28))
    elif kind == "table_s":
        rc.table_coral(name, (x, y, z - 0.01), r.randrange(1 << 20), r.uniform(0.1, 0.16))
    elif kind == "anemone":
        rc.anemone(name, (x, y, z - 0.005), r.randrange(1 << 20), r.uniform(0.07, 0.11), mat=r.choice(["anemone", "anemone_mag"]))
    elif kind == "sponge":
        rc.tube_sponge(name, (x, y, z - 0.01), r.randrange(1 << 20), r.randint(3, 5), r.uniform(0.2, 0.34), mat=r.choice(["sponge_purple", "sponge_yellow"]))
    elif kind == "vase":
        rc.tube_sponge(name, (x, y, z - 0.01), r.randrange(1 << 20), 1, r.uniform(0.14, 0.22), mat="sponge_brown", radius=(0.06, 0.08))
    elif kind == "rubble":
        rc.rubble(name, (x, y, z), r.randrange(1 << 20), r.randint(3, 8))
    elif kind == "fan":
        rc.sea_fan(name, (x, y, z - 0.01), r.randrange(1 << 20), r.uniform(0.35, 0.55), r.uniform(0.38, 0.6), mat=r.choice(["fan_purple", "fan_purple", "fan_orange"]), yaw=r.uniform(-0.35, 0.35))
    elif kind == "rockhead":
        size = r.uniform(0.35, 0.6)
        rc.rock(name, r.choice(["boulder_01", "namaqualand_boulder_02"]), (x, y, z), size, r.randrange(1 << 20), sink=0.3, mat=rc.MATS["rock"])
        top = z + size * 0.35
        for k in range(r.randint(2, 4)):
            sub = r.choice(["bushy", "bushy", "boulder_s", "brain_s", "anemone", "table_s"])
            place(sub, f"{name}_top{k}", x + r.uniform(-0.15, 0.15) * size / 0.45, y + r.uniform(-0.06, 0.1), top + r.uniform(-0.05, 0.02), r)
    elif kind == "star":
        rc.starfish(name, (x, y, z), r.randrange(1 << 20), r.uniform(0.07, 0.1))
    elif kind == "star_ochre":
        rc.starfish(name, (x, y, z), r.randrange(1 << 20), r.uniform(0.08, 0.12), mat="star_ochre")
    elif kind == "urchin":
        rc.urchin(name, (x, y, z + 0.015), r.randrange(1 << 20))
    elif kind == "urchin_purple":
        rc.urchin(name, (x, y, z + 0.015), r.randrange(1 << 20), radius=0.035, spines=220, mat="urchin_purple", spine=(1.2, 1.8))
    elif kind == "pebble":
        rc.rock(name, "boulder_01", (x, y, z), r.uniform(0.04, 0.09), r.randrange(1 << 20), sink=0.35, mat=rc.MATS["rock2"])
    elif kind == "stone":
        rc.rock(name, r.choice(["boulder_01", "namaqualand_boulder_02"]), (x, y, z), r.uniform(0.12, 0.3), r.randrange(1 << 20), sink=0.3, mat=rc.MATS["rock2"])
    elif kind == "rockhead_plain":
        rc.rock(name, r.choice(["boulder_01", "namaqualand_boulder_02"]), (x, y, z), r.uniform(0.3, 0.55), r.randrange(1 << 20), sink=0.35, mat=rc.MATS["rock_kelp"])
    elif kind == "mossy":
        rc.rock(name, r.choice(["boulder_01", "namaqualand_boulder_02"]), (x, y, z), r.uniform(0.15, 0.4), r.randrange(1 << 20), sink=0.3, mat=rc.MATS["rock_mossy"])
    elif kind == "shell":
        rc.rock(name, "lambis_shell", (x, y, z), 0.14, r.randrange(1 << 20), sink=0.15)


def build_coral(k, xa, xb, fl):
    rc.make_materials()
    count = 0
    for band, (y0, y1, (nmin, nmax), table) in CORAL_BANDS.items():
        for i in cells(xa, xb, CELL):
            r = rng("coral", band, i)
            for j in range(r.randint(nmin, nmax)):
                x = (i + r.random()) * CELL
                y = r.uniform(y0, y1)
                kind = pick(r, table)
                keep = r.random() < J.presence(k, x)
                if keep:
                    place(kind, f"c_{band}_{i}_{j}_{kind}", x, y, fl.z(x, y), r)
                    count += 1
    return count


def build_coral_far(k, xa, xb, fl):
    """珊瑚礁的远景：礁顶上一座座大礁丘（大石头上长满珊瑚），隔着很厚的水只剩轮廓和一点颜色。"""
    rc.make_materials()
    count = 0
    for i in cells(xa, xb, 0.6):
        r = rng("coral_far", i)
        for j in range(r.randint(1, 3)):
            x = (i + r.random()) * 0.6
            y = r.uniform(1.5, 4.2)
            size = r.uniform(0.7, 1.5)
            keep = r.random() < J.presence(k, x)
            if not keep:
                continue
            z = fl.z(x, y)
            name = f"cf_{i}_{j}"
            rc.rock(name, r.choice(["boulder_01", "namaqualand_boulder_02", "boulder_01"]), (x, y, z), size, r.randrange(1 << 20), sink=0.25, mat=rc.MATS["rock"])
            top = z + size * 0.38
            for q in range(r.randint(3, 6)):
                kind = r.choice(["table", "bushy", "boulder", "brain", "staghorn", "fan"])
                place(kind, f"{name}_c{q}", x + r.uniform(-0.35, 0.35) * size, y + r.uniform(-0.2, 0.2) * size, top + r.uniform(-0.15, 0.05) * size, r)
            count += 1
    return count


# —— S2 海草床 ——
def seagrass_height(X, Y):
    """平平的沙地带一道道沙纹，y≈2.6 处是一道缓坡的坎，后面往下。"""
    ripples = 0.006 * np.sin(X * 22.0 + np.sin(Y * 3.0) * 2.0)
    back = np.maximum(0.0, Y - 2.6)
    return ripples + 0.03 * np.sin(X * 0.9 + 0.5) - 0.8 * back * back


def seagrass_far_height(X, Y):
    back = np.maximum(0.0, Y - 4.4)
    return 0.12 * np.sin(X * 0.5 + 1.0) * np.sin(Y * 0.8) - 0.5 * back * back


def seagrass_mask(X, Y):
    return 0.35 + 0.35 * np.sin(X * 1.7 + 2.0) * np.sin(Y * 2.1 + 1.0)


def grass_density(k, scale=1.0):
    def dens(X, Y):
        p = presence_v(k, X)
        patch = 0.55 + 0.6 * np.sin(X * 2.1 + 0.7) * np.sin(Y * 1.7 + 0.3) + 0.25 * np.sin(X * 7.3 + Y * 4.1)
        band = np.clip((2.75 - Y) / 0.3, 0, 1) * np.clip((Y + 1.0) / 0.3, 0, 1)
        return p * np.clip(patch, 0, 1) * band * scale

    return dens


def grass_length(k):
    """海草越靠近下一段越高（接到海藻林）。"""
    end = (k + 1) * J.SCENE_LEN

    def fn(x):
        return 1.0 + 1.6 * J.smooth((x - (end - 2.2)) / 2.4)

    return fn


def build_seagrass(k, xa, xb, fl):
    rp.make_materials()
    rc.make_materials()
    dens = grass_density(k)
    for c in cells(xa, xb, 1.0):
        rp.seagrass_meadow(f"grass_{c}", c * 1.0, c * 1.0 + 1.0, -1.0, 2.8, fl.z, dens, stable_hash("grass", c), rc.MATS["seagrass"], length_fn=grass_length(k))
    count = 0
    for i in cells(xa, xb, 0.5):
        r = rng("seagrass_items", i)
        for j in range(r.randint(0, 2)):
            x = (i + r.random()) * 0.5
            y = r.uniform(-0.8, 2.2)
            kind = pick(r, [("shell", 2), ("star", 2), ("stone", 2), ("urchin", 1), ("pebble", 3)])
            if r.random() < J.presence(k, x):
                place(kind, f"g_{i}_{j}_{kind}", x, y, fl.z(x, y), r)
                count += 1
    return count


def build_seagrass_far(k, xa, xb, fl):
    rp.make_materials()
    rc.make_materials()
    dens = grass_density(k, 0.9)
    for c in cells(xa, xb, 2.0):
        rp.seagrass_meadow(f"grassf_{c}", c * 2.0, c * 2.0 + 2.0, 0.0, 4.6, fl.z, lambda X, Y: dens(X, np.minimum(Y, 2.0)), stable_hash("grassf", c), rc.MATS["seagrass"], spacing=0.07, length=(0.25, 0.5), width=(0.012, 0.02), length_fn=grass_length(k))
    return 0


# —— S3 海藻森林 ——
def kelp_height(X, Y):
    rocks = 0.05 * np.sin(X * 2.3 + 1.0) * np.sin(Y * 1.9) + 0.03 * np.sin(X * 5.1 + Y * 3.7)
    back = np.maximum(0.0, Y - 2.4)
    return rocks - 0.8 * back * back


def kelp_far_height(X, Y):
    back = np.maximum(0.0, Y - 4.6)
    return 0.15 * np.sin(X * 0.8) * np.sin(Y * 0.6 + 1.0) - 0.5 * back * back


def kelp_mask(X, Y):
    return 0.5 + 0.45 * np.sin(X * 1.3 + 0.2) * np.sin(Y * 1.6 + 2.0)


def build_kelp(k, xa, xb, fl):
    rp.make_materials()
    rc.make_materials()
    count = 0
    for i in cells(xa, xb, 0.45):
        r = rng("kelp", i)
        for j in range(r.randint(1, 2)):
            x = (i + r.random()) * 0.45
            y = r.uniform(0.3, 2.3)
            if r.random() >= J.presence(k, x) * 0.9:
                continue
            z = fl.z(x, y)
            size = r.uniform(0.18, 0.4)
            name = f"k_{i}_{j}"
            rc.rock(name + "_rock", r.choice(["boulder_01", "namaqualand_boulder_02"]), (x, y, z), size, r.randrange(1 << 20), sink=0.35, mat=rc.MATS["rock2"])
            rp.kelp(name, (x, y, z + size * 0.25), r.randrange(1 << 20), height=r.uniform(2.3, 3.0), stipes=r.randint(2, 4), mats=rp.kelp_mats())
            count += 1
    for i in cells(xa, xb, 0.3):
        r = rng("kelp_items", i)
        for j in range(r.randint(0, 3)):
            x = (i + r.random()) * 0.3
            y = r.uniform(-0.85, 2.0)
            kind = pick(r, [("stone", 5), ("pebble", 4), ("urchin_purple", 2), ("star_ochre", 1), ("anemone", 1), ("rockhead_plain", 2)])
            if r.random() < J.presence(k, x):
                place(kind, f"ki_{i}_{j}_{kind}", x, y, fl.z(x, y), r)
                count += 1
    return count


def build_kelp_far(k, xa, xb, fl):
    rp.make_materials()
    rc.make_materials()
    for i in cells(xa, xb, 0.5):
        r = rng("kelp_far", i)
        for j in range(r.randint(1, 3)):
            x = (i + r.random()) * 0.5
            y = r.uniform(0.8, 4.4)
            if r.random() >= J.presence(k, x):
                continue
            rp.kelp(f"kf_{i}_{j}", (x, y, fl.z(x, y) - 0.02), r.randrange(1 << 20), height=r.uniform(3.2, 4.2), stipes=r.randint(2, 5), mats=rp.kelp_mats())
    return 0


def span_presence(k, xa, xb):
    return max(J.presence(k, x) for x in np.linspace(xa, xb, 17))


# —— S4 岩石峡谷 ——
def canyon_height(X, Y):
    return 0.04 * np.sin(X * 1.9) * np.sin(Y * 2.3 + 1.0) + 0.03 * np.sin(X * 4.7 + Y * 3.1)


def canyon_mask(X, Y):
    return 0.5 + 0.4 * np.sin(X * 1.1 + 2.0) * np.sin(Y * 1.4)


def canyon_y(k, x):
    """峡谷的岩壁在哪：入口那头从水雾里弯过来，越往尽头越近（峡谷收窄），收到和闸墙同一个面上，接上闸墙。"""
    start = k * J.SCENE_LEN
    end = (k + 1) * J.SCENE_LEN
    narrow = J.smooth((x - (end - 2.8)) / 2.8)
    enter = J.smooth((x - (start - J.BLEND)) / (2 * J.BLEND))
    return 1.9 - 0.55 * narrow + 9.0 * (1 - enter)


def build_canyon(k, xa, xb, fl):
    rc.make_materials()
    if span_presence(k, xa, xb) < 0.01:
        return 0
    if "canyon_wall" not in rc.MATS:
        rc.MATS["canyon_wall"] = rr.wall_material("canyon_wall", "rock_face", 2.38, sat=0.45, value=0.62)
    # 岩壁只从入口的交界带起才有（那里它还退在九米外的水雾里），尽头接闸墙。
    # 不能整段都铺：一块里搭到了峡谷就铺满、相邻一块没搭到就没有，退在水雾里的墙也会在接缝两边一边有一边没有（出过）
    wx0 = max(xa, k * J.SCENE_LEN - J.BLEND)
    wx1 = min(xb, (k + 1) * J.SCENE_LEN + 0.35)
    if wx1 <= wx0:
        return 0
    rr.rock_wall(f"canyon_{k}", wx0, wx1, -0.7, 3.4, lambda x, z: canyon_y(k, x) + 0.12 * max(0.0, z) + 0.12 * math.sin(z * 2.1 + x * 0.7), "rock_face", 2.38, rc.MATS["canyon_wall"], relief=0.1, seed=k)
    count = 0
    # 岩壁上的小台子：一块突出的石头，上面长着海扇、海绵或海葵
    for i in cells(wx0, wx1, 0.55):
        r = rng("canyon_ledge", i)
        x = (i + r.random()) * 0.55
        z = r.uniform(0.0, 1.3)
        if r.random() >= J.presence(k, x) * 0.85:
            continue
        y = canyon_y(k, x) + 0.12 * z - 0.12
        size = r.uniform(0.18, 0.35)
        rc.rock(f"ledge_{i}", "boulder_01", (x, y, z), size, r.randrange(1 << 20), sink=0.1, mat=rc.MATS["canyon_wall"])
        kind = pick(r, [("fan", 3), ("sponge", 2), ("anemone", 2), ("bushy", 1)])
        place(kind, f"ledge_{i}_{kind}", x, y - 0.03, z + size * 0.3, r)
        count += 1
    for i in cells(xa, xb, 0.35):
        r = rng("canyon_items", i)
        for j in range(r.randint(0, 2)):
            x = (i + r.random()) * 0.35
            y = r.uniform(-0.85, 1.4)
            kind = pick(r, [("stone", 4), ("pebble", 3), ("rockhead_plain", 2), ("urchin", 1), ("sponge", 1)])
            if r.random() < J.presence(k, x):
                place(kind, f"ci_{i}_{j}_{kind}", x, y, fl.z(x, y), r)
                count += 1
    return count


def build_canyon_far(k, xa, xb, fl):
    return 0


# —— S5 船闸闸室 ——
def lock_height(X, Y):
    return 0.005 * np.sin(X * 3.0)


def lock_mask(X, Y):
    return 0.45 + 0.4 * np.sin(X * 2.3 + 1.0) * np.sin(Y * 1.7 + 0.5)


LOCK_Y = 1.35


def lock_y(k, x):
    return LOCK_Y


def build_lock(k, xa, xb, fl):
    rc.make_materials()
    if span_presence(k, xa, xb) < 0.01:
        return 0
    x0 = k * J.SCENE_LEN
    culverts = [(x0 + 1.5, 0.6, 0.45), (x0 + 3.6, 0.6, 0.45)]
    # 闸墙从这一段起点前一点到终点后一点，两头是收口的墙端（不退进水雾，免得一块块石头散在水里）
    wx0, wx1 = max(xa, x0 - 0.25), min(xb, x0 + J.SCENE_LEN + 0.25)
    if wx1 <= wx0:
        return 0
    rr.masonry_wall(f"lockwall_{k}", wx0, wx1, lambda x: lock_y(k, x), -0.35, 3.2, stable_hash("lockwall", k), culverts=[c for c in culverts if xa - 1 < c[0] < xb + 1], ends=(x0 - 0.25, x0 + J.SCENE_LEN + 0.25))
    # 进闸处的门龛：开着的闸门收在墙里，看到的是一大块带加劲肋的钢板
    gx0, gx1 = x0 + 0.2, x0 + 1.0
    if gx1 > xa and gx0 < xb:
        rr.steel_panel(f"gate_{k}", gx0, gx1, lock_y(k, (gx0 + gx1) / 2) - 0.06, -0.3, 3.0)
    lx = x0 + 2.6
    if xa < lx < xb:
        rr.rungs(f"rungs_{k}", lx, lock_y(k, lx) - 0.02, 0.1, 3.0)
    count = 0
    for i in cells(xa, xb, 0.4):
        r = rng("lock_items", i)
        for j in range(r.randint(0, 1)):
            x = (i + r.random()) * 0.4
            y = r.uniform(-0.85, 1.1)
            kind = pick(r, [("stone", 3), ("pebble", 3), ("rubble", 1)])
            if r.random() < J.presence(k, x):
                place(kind, f"li_{i}_{j}_{kind}", x, y, fl.z(x, y), r)
                count += 1
    return count


def build_lock_far(k, xa, xb, fl):
    return 0


# —— S6 水母群（深水） ——
def jelly_height(X, Y):
    """出了闸是一片深水：暗暗的淤泥地缓缓往下，只在画面最底下露一线（太陡的话交界带里地面会卷起来，一下没了又显得两头突兀）。"""
    return -0.22 - 0.12 * Y - 1.2 * np.maximum(0.0, Y - 2.2) ** 2


def jelly_mask(X, Y):
    return 0.3 + 0.3 * np.sin(X * 0.9) * np.sin(Y * 1.3)


def build_jelly(k, xa, xb, fl):
    return 0


def build_jelly_far(k, xa, xb, fl):
    return 0


# —— S7 清澈的河道 ——
def river_height(X, Y):
    """卵石河床，后面是缓缓升起的河岸，岸顶再往下（把更远处藏起来）。"""
    bank = 0.26 * np.maximum(0.0, Y - 1.7) ** 1.5
    top = 1.2 * np.maximum(0.0, Y - 2.85) ** 2
    return 0.03 * np.sin(X * 2.1) * np.sin(Y * 1.7) + bank - top


def river_far_height(X, Y):
    return 0.6 * np.maximum(0.0, Y - 2.0) - 0.8 * np.maximum(0.0, Y - 4.0) ** 2


def river_mask(X, Y):
    return 0.5 + 0.45 * np.sin(X * 1.6 + 0.4) * np.sin(Y * 2.2 + 1.3)


def build_river(k, xa, xb, fl):
    rp.make_materials()
    rc.make_materials()
    if span_presence(k, xa, xb) < 0.01:
        return 0

    def dens(X, Y):
        p = presence_v(k, X)
        patch = 0.35 + 0.6 * np.sin(X * 1.7 + 0.9) * np.sin(Y * 1.3 + 0.2)
        band = np.clip((2.85 - Y) / 0.3, 0, 1) * np.clip((Y - 0.2) / 0.3, 0, 1)
        return p * np.clip(patch, 0, 1) * band

    for c in cells(xa, xb, 1.0):
        rp.seagrass_meadow(f"vallis_{c}", c * 1.0, c * 1.0 + 1.0, 0.0, 2.7, fl.z, dens, stable_hash("vallis", c), rc.MATS["vallis"], spacing=0.05, length=(0.35, 0.7), width=(0.008, 0.012), current=0.7, lean=(0.4, 0.9), droop=0.05, per=(2, 5))
    count = 0
    for i in cells(xa, xb, 0.4):
        r = rng("river_items", i)
        for j in range(r.randint(0, 2)):
            x = (i + r.random()) * 0.4
            y = r.uniform(-0.85, 2.8)
            kind = pick(r, [("mossy", 4), ("stone", 3), ("pebble", 3)])
            if r.random() < J.presence(k, x):
                place(kind, f"ri_{i}_{j}_{kind}", x, y, fl.z(x, y), r)
                count += 1
    return count


def build_river_far(k, xa, xb, fl):
    rp.make_materials()
    rc.make_materials()
    for i in cells(xa, xb, 0.7):
        r = rng("river_far", i)
        for j in range(r.randint(1, 3)):
            x = (i + r.random()) * 0.7
            y = r.uniform(1.0, 3.6)
            if r.random() < J.presence(k, x):
                place("mossy", f"rf_{i}_{j}", x, y, fl.z(x, y), r)
    return 0


# —— S8 浅水和出水 ——
def shallow_height(X, Y):
    return 0.02 * np.sin(X * 1.3) * np.sin(Y * 2.0) + 0.06 * np.tanh(Y - 1.0) - 2.5 * np.maximum(0.0, Y - 2.7) ** 2


def shallow_far_height(X, Y):
    return 0.2 * np.tanh(Y - 2.0) - 0.5 * np.maximum(0.0, Y - 4.2) ** 2


def shallow_mask(X, Y):
    return 0.4 + 0.4 * np.sin(X * 1.2 + 2.2) * np.sin(Y * 1.9 + 0.7)


def build_shallow(k, xa, xb, fl):
    rp.make_materials()
    rc.make_materials()
    if span_presence(k, xa, xb) < 0.01:
        return 0
    count = 0
    for i in cells(xa, xb, 0.3):
        r = rng("shallow", i)
        for j in range(r.randint(1, 2)):
            x = (i + r.random()) * 0.3
            y = r.uniform(0.3, 2.5)
            if r.random() >= J.presence(k, x):
                continue
            z = fl.z(x, y)
            if r.random() < 0.6:
                rp.reeds(f"reed_{i}_{j}", (x, y, z), r.randrange(1 << 20), count=r.randint(4, 9), height=2.6)
            else:
                rp.lily_stems(f"lily_{i}_{j}", (x, y, z), r.randrange(1 << 20), count=r.randint(3, 6), surface=1.35)
            count += 1
    for i in cells(xa, xb, 0.5):
        r = rng("shallow_items", i)
        for j in range(r.randint(0, 2)):
            x = (i + r.random()) * 0.5
            y = r.uniform(-0.85, 2.0)
            kind = pick(r, [("pebble", 3), ("stone", 1), ("mossy", 1)])
            if r.random() < J.presence(k, x):
                place(kind, f"si_{i}_{j}_{kind}", x, y, fl.z(x, y), r)
    return count


def build_shallow_far(k, xa, xb, fl):
    rp.make_materials()
    rc.make_materials()
    for i in cells(xa, xb, 0.5):
        r = rng("shallow_far", i)
        for j in range(r.randint(1, 3)):
            x = (i + r.random()) * 0.5
            y = r.uniform(1.0, 4.0)
            if r.random() < J.presence(k, x):
                rp.reeds(f"reedf_{i}_{j}", (x, y, fl.z(x, y)), r.randrange(1 << 20), count=r.randint(6, 12), height=4.0, spread=0.15)
    return 0


SAND = ("sand_01", 1.5, {"sat": 0.45, "value": 1.35, "tint": (1.0, 0.97, 0.9)})
FLOORS = {
    "coral": {"a": SAND, "b": ("coral_gravel", 2.0, {"sat": 0.5, "value": 1.25}), "mask": coral_rubble, "height": coral_height, "far_height": coral_far_height, "amp": (0.008, 0.03)},
    "seagrass": {"a": SAND, "b": ("damp_beach_sand", 2.0, {"sat": 0.55, "value": 1.3}), "mask": seagrass_mask, "height": seagrass_height, "far_height": seagrass_far_height, "amp": (0.008, 0.006)},
    "canyon": {"a": ("rocks_ground_01", 2.0, {"sat": 0.5, "value": 0.5}), "b": ("river_small_rocks", 2.9, {"sat": 0.5, "value": 0.55}), "mask": canyon_mask, "height": canyon_height, "far_height": canyon_height, "amp": (0.03, 0.03)},
    "lock": {"a": ("concrete_floor_worn_02", 2.0, {"sat": 0.4, "value": 0.5}), "b": ("damp_beach_sand", 2.0, {"sat": 0.4, "value": 0.45}), "mask": lock_mask, "height": lock_height, "far_height": lock_height, "amp": (0.004, 0.006)},
    "jelly": {"a": ("damp_beach_sand", 2.0, {"sat": 0.4, "value": 0.35}), "b": ("rocks_ground_01", 2.0, {"sat": 0.4, "value": 0.35}), "mask": jelly_mask, "height": jelly_height, "far_height": jelly_height, "amp": (0.01, 0.02)},
    "river": {"a": ("ganges_river_pebbles", 2.16, {"sat": 0.75, "value": 0.75}), "b": ("river_small_rocks", 2.9, {"sat": 0.7, "value": 0.7}), "mask": river_mask, "height": river_height, "far_height": river_far_height, "amp": (0.03, 0.03)},
    "shallow": {"a": ("damp_beach_sand", 2.0, {"sat": 0.7, "value": 0.55}), "b": ("sand_01", 1.5, {"sat": 0.55, "value": 0.7}), "mask": shallow_mask, "height": shallow_height, "far_height": shallow_far_height, "amp": (0.006, 0.006)},
    "kelp": {"a": ("low_tide_rocks", 2.17, {"sat": 0.75, "value": 0.7}), "b": ("rocks_ground_01", 2.0, {"sat": 0.6, "value": 0.6, "tint": (0.85, 0.8, 0.9)}), "mask": kelp_mask, "height": kelp_height, "far_height": kelp_far_height, "amp": (0.03, 0.05)},
}
BUILDERS = {
    "coral": (build_coral, build_coral_far),
    "seagrass": (build_seagrass, build_seagrass_far),
    "kelp": (build_kelp, build_kelp_far),
    "canyon": (build_canyon, build_canyon_far),
    "lock": (build_lock, build_lock_far),
    "jelly": (build_jelly, build_jelly_far),
    "river": (build_river, build_river_far),
    "shallow": (build_shallow, build_shallow_far),
}


def build_range(layer, xa, xb):
    """把 [xa, xb] 这一截要用到的东西都搭出来：地面（最多两段渐变）和各段的东西（多搭一圈，伸进画面的也有）。"""
    # 多搭一圈：伸进画面的东西要有，影子落进画面的也要有。太阳从右上方斜照（往左投影，三米高的海藻影子能落到左边两米），
    # 海藻的叶子顺水流往右飘一米多：所以右边多搭得多。少了的话相邻两块的接缝对不上（一块里有影子、一块里没有）。
    left, right = (1.6, 2.2) if layer == "mid" else (3.0, 4.5)
    floor_ks = [k for k in J.scenes_in(xa - left, xb + right) if J.SCENES[k]["key"] in FLOORS]
    weight_ks = sorted(floor_ks)[:4]
    if not weight_ks:
        # 路线两头以外：用最近那一段的地面
        weight_ks = [min(len(J.SCENES) - 1, max(0, int((xa + xb) / 2 // J.SCENE_LEN)))]
    parts = []
    for k in weight_ks:
        spec = dict(FLOORS[J.SCENES[k]["key"]])
        if layer == "far":
            spec["height"] = spec["far_height"]
        parts.append((lambda x, k=k: J.presence(k, x), spec))
    # 地面也铺到多搭的那一圈：摆在那里的东西要按真的地面高度放（查不到会贴着地面边上的高度，两块里不一样高）
    if layer == "mid":
        fl = rc.floor_multi("floor", xa - left, xb + right, -1.0, 3.0, parts, step=0.005)
    else:
        fl = rc.floor_multi("floor", xa - left, xb + right, -1.0, 5.5, parts, step=0.02)
    count = 0
    for k in J.scenes_in(xa - left, xb + right):
        key = J.SCENES[k]["key"]
        if key not in BUILDERS:
            continue
        build = BUILDERS[key][0 if layer == "mid" else 1]
        count += build(k, xa - left, xb + right, fl) or 0
    print(f"[reef] {layer} x {xa:.2f}–{xb:.2f}：摆了 {count} 样东西", flush=True)


def setup_fog(layer):
    """水沿 x 一段段变：每段在自己的中间一截是自己的颜色，交界带里渐变。"""
    stops = []
    for k, s in enumerate(J.SCENES):
        lo, hi = core.srgb(s["low"]), core.srgb(s["high"])
        a = k * J.SCENE_LEN + (J.BLEND if k > 0 else -20.0)
        b = (k + 1) * J.SCENE_LEN - (J.BLEND if k < len(J.SCENES) - 1 else -20.0)
        stops.append((a, lo, hi, s["vis"]))
        stops.append((b, lo, hi, s["vis"]))
    core.FOG.update(ramp=stops, absorb=(0.11, 0.03, 0.016), dist_add=0.0, dist_mul=1.0)
    if layer == "far":
        core.FOG.update(dist_add=2.0)


SUN = {"energy": 9.0, "color": (0.95, 0.98, 1.0), "tilt_x": 6.0, "tilt_y": 32.0}
AMBIENT = {"top": (0.16, 0.42, 0.55), "bottom": (0.003, 0.012, 0.022), "strength": 0.32}


def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def sky_backdrop(x0, x1):
    """天：一面竖在远处的自发光的板，地平线附近浅、头顶深的蓝，飘着几朵软软的云（不发白）。"""
    mat, g, bsdf, out_node = core.material("sky")
    pos = g.position()
    z = g.xyz(pos)[2]
    t = g.smooth(z, 4.0, 9.0)
    col = g.mix(t, core.srgb("#5ea8e0"), core.srgb("#1c55a6"))
    cloud = g.smooth(g.noise(g.scaled(pos, (0.12, 0.12, 0.35)), 1.0, 5, 0.6), 0.52, 0.7)
    col = g.mix(g.math("MULTIPLY", cloud, g.smooth(z, 3.0, 5.5)), col, core.srgb("#e8f1f6"))
    em = g.new("ShaderNodeEmission")
    g.put(em, "Color", col)
    g.put(em, "Strength", 1.0)
    mat.node_tree.links.new(em.outputs[0], out_node.inputs["Surface"])
    mat.node_tree.nodes.remove(bsdf)
    import bmesh as _bm

    bm = _bm.new()
    yb = 40.0
    v = [bm.verts.new((x, yb, zz)) for zz in (-10.0, 40.0) for x in (x0, x1)]
    bm.faces.new((v[0], v[1], v[3], v[2]))
    return core.obj_from_bm("sky", bm, mat)


def water_surface(x0, x1):
    """水面：深青绿、很光滑，带细碎的涟漪（法线起伏），倒映着天。"""
    mat, g, bsdf, _ = core.material("water_surface")
    pos = g.position()
    ripple = g.math("ADD", g.noise(g.scaled(pos, (1.0, 2.5, 1.0)), 18.0, 3, 0.55), g.math("MULTIPLY", g.noise(pos, 70.0, 2, 0.5), 0.3))
    g.put(bsdf, "Base Color", core.rgba(core.srgb("#14373a")))
    g.put(bsdf, "Roughness", 0.06)
    g.put(bsdf, "IOR", 1.33)
    g.put(bsdf, "Normal", g.bump(ripple, 0.25, 0.01))
    import bmesh as _bm

    bm = _bm.new()
    z = J.SURFACE_Z
    v = [bm.verts.new((x, y, z)) for y in (-10.0, 5.6) for x in (x0, x1)]
    bm.faces.new((v[0], v[1], v[3], v[2]))
    return core.obj_from_bm("water", bm, mat)


def lily_pads(xa, xb):
    """睡莲叶：浮在水面上的圆叶，一个缺口，叶面亮绿、边上发红；零星一两朵白里透粉的花。"""
    mat, g, bsdf, _ = core.material("lily_pad")
    pos = g.position()
    vein = g.noise(pos, 60.0, 2, 0.5)
    col = g.mix(g.smooth(vein, 0.4, 0.7), (0.04, 0.12, 0.02), (0.09, 0.2, 0.04))
    g.put(bsdf, "Base Color", col)
    g.put(bsdf, "Roughness", 0.25)
    g.put(bsdf, "Coat Weight", 0.4)
    verts, faces = [], []
    for i in cells(xa, xb, 0.35):
        r = rng("lily_pad", i)
        for j in range(r.randint(1, 3)):
            cx = (i + r.random()) * 0.35
            cy = r.uniform(-0.6, 4.5)
            rad = r.uniform(0.07, 0.13)
            notch = r.uniform(0, 2 * PI)
            base = len(verts)
            verts.append((cx, cy, J.SURFACE_Z + 0.004))
            segs = 28
            for k in range(segs + 1):
                a = notch + 0.3 + (2 * PI - 0.6) * k / segs
                verts.append((cx + math.cos(a) * rad, cy + math.sin(a) * rad, J.SURFACE_Z + 0.004 + 0.003 * math.sin(k)))
            for k in range(segs):
                faces.append((base, base + 1 + k, base + 2 + k))
    if not faces:
        return None
    mesh = bpy.data.meshes.new("lily_pads")
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new("lily_pads", mesh)
    mesh.materials.append(mat)
    core.collection("scene").objects.link(obj)
    return obj


def far_bank(xa, xb):
    """对岸：远处一道低低的泥岸，长满矮芦苇和草。"""
    rp.make_materials()
    rc.make_materials()
    parts = [(lambda x: 1.0, {"a": ("damp_beach_sand", 2.0, {"sat": 0.6, "value": 0.5}), "b": ("rocks_ground_01", 2.0, {"sat": 0.5, "value": 0.45}), "mask": lambda X, Y: 0.3 + 0 * X, "height": lambda X, Y: J.SURFACE_Z - 0.3 + 0.36 * np.clip((Y - 5.2) / 0.8, 0, 1) + 0.03 * np.sin(X * 1.7), "far_height": None, "amp": (0.01, 0.01)})]
    fl = rc.floor_multi("bank", xa - 1.0, xb + 1.0, 4.6, 8.0, parts, step=0.02)

    def dens(X, Y):
        return np.clip((Y - 5.3) / 0.3, 0, 1) * (0.7 + 0.3 * np.sin(X * 2.3))

    for c in cells(xa - 1, xb + 1, 1.0):
        rp.seagrass_meadow(f"bankgrass_{c}", c * 1.0, c * 1.0 + 1.0, 5.2, 7.5, fl.z, dens, stable_hash("bankgrass", c), rc.MATS["reed"], spacing=0.05, length=(0.1, 0.24), width=(0.005, 0.009), lean=(0.05, 0.3), droop=0.25, per=(3, 6))
    return fl


def build_above(xa, xb):
    """水面以上：近处的芦苇丛（就是浅水里那些，伸出水面）、浮着的睡莲叶、水面、对岸、天。"""
    rp.make_materials()
    rc.make_materials()
    k = len(J.SCENES) - 1
    for i in cells(xa, xb, 0.3):
        r = rng("shallow", i)
        for j in range(r.randint(1, 2)):
            x = (i + r.random()) * 0.3
            y = r.uniform(0.3, 2.5)
            if r.random() >= J.presence(k, x):
                continue
            if r.random() < 0.6:
                rp.reeds(f"reed_{i}_{j}", (x, y, 0.0), r.randrange(1 << 20), count=r.randint(4, 9), height=2.6)
            else:
                r.randrange(1 << 20)
                r.randint(3, 6)
    lily_pads(xa, xb)
    water_surface(xa - 3, xb + 3)
    far_bank(xa, xb)
    sky_backdrop(xa - 60, xb + 60)


def shoot(scene, layer, x_center, w, h, samples, out, aux=False, backdrop=False, blend=""):
    """搭好 x_center 附近、渲一张（中景可以顺带渲两张辅助图）。"""
    core.reset()
    rc.clear_caches()
    scale, tilt, s0 = J.LAYERS.get(layer, J.LAYERS["mid"])
    core.setup_render(scene, samples, transparent=not backdrop and layer not in ("back", "above"))
    setup_fog(layer)
    half = core.view_width(w, h, scale) / 2
    if layer in ("mid", "far"):
        build_range(layer, x_center - half, x_center + half)
    if layer == "above":
        # 芦苇的影子往左落一米多：右边多搭
        build_above(x_center - half - 1.0, x_center + half + 2.0)
        core.underwater_world(scene, top=core.srgb("#9cc8ec"), bottom=core.srgb("#3d5a4a"), strength=0.9)
        core.sun(scene, energy=4.5, color=(1.0, 0.97, 0.92), tilt_x=-35.0, tilt_y=30.0, angle=1.0)
    else:
        core.underwater_world(scene, **AMBIENT)
        core.sun(scene, **SUN)
    core.camera(scene, x_center, w, h, scale=scale, tilt=math.radians(tilt), s0=s0)
    if layer != "above":
        core.fog_all()
    if backdrop or layer == "back":
        core.water_backdrop(x0=x_center - half - 60, x1=x_center + half + 60)
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend))
    if aux != "only":
        render(scene, out)
        print(f"[reef] 渲好了：{out}", flush=True)
    if aux and layer == "mid":
        stem = out[:-4]
        core.override_materials("light")
        core.setup_aux(scene, "light")
        render(scene, stem + "-light.png")
        core.override_materials("sway")
        for obj in scene.objects:
            if obj.type == "LIGHT":
                obj.hide_render = True
        scene.cycles.samples = 8
        scene.cycles.use_denoising = False
        render(scene, stem + "-sway.png")
        print(f"[reef] 辅助图渲好了：{stem}-light.png、-sway.png", flush=True)


def parse_tiles(text, n):
    if text == "all":
        return list(range(n))
    out = []
    for part in text.split(","):
        if "-" in part:
            a, b = part.split("-")
            out += list(range(int(a), int(b) + 1))
        elif part.strip():
            out.append(int(part))
    return [i for i in out if 0 <= i < n]


def main():
    opts = core.options({"res": "1", "layer": "mid", "x": "", "size": "2250x1800", "samples": "128", "out": "", "outdir": ".shots/reef/strip", "tiles": "", "aux": "0", "blend": "", "backdrop": "0", "assets": "", "resume": "0"})
    if not core.ASSETS or not os.path.isdir(core.ASSETS):
        raise SystemExit("[reef] 没找到素材目录：用 --assets 或环境变量 REEF_ASSETS 指过去")
    scene = bpy.context.scene
    layer = opts["layer"]
    samples = int(opts["samples"])
    if opts["tiles"] or (layer == "back" and not opts["x"]):
        outdir = os.path.abspath(opts["outdir"])
        os.makedirs(os.path.join(outdir, layer), exist_ok=True)
        if layer == "back":
            # 水底色：一整条、八分之一的分辨率（只有渐变）
            x0, x1 = J.strip_range("far")
            w = int((x1 - x0) * J.px_per_m("mid") / 8)
            shoot(scene, "back", (x0 + x1) / 2, w, J.STRIP_PX // 8, 16, os.path.join(outdir, "back", "back.png"))
            return
        tiles = J.tiles(layer)
        for i, xa, xb in [tiles[i] for i in parse_tiles(opts["tiles"], len(tiles))]:
            out = os.path.join(outdir, layer, f"{i:02d}.png")
            if os.path.exists(out) and opts["resume"] == "1" and opts["aux"] != "only":
                continue
            res = float(opts["res"])
            shoot(scene, layer, (xa + xb) / 2, round((J.TILE_PX + 2 * J.PAD_PX) * res), round(J.STRIP_PX * res), samples, out, aux="only" if opts["aux"] == "only" else opts["aux"] == "1")
        return
    w, h = (int(v) for v in opts["size"].split("x"))
    out = os.path.abspath(opts["out"] or ".shots/reef/test.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    shoot(scene, layer, float(opts["x"] or "1.0"), w, h, samples, out, aux=opts["aux"] == "1", backdrop=opts["backdrop"] == "1", blend=opts["blend"])


if __name__ == "__main__":
    main()
