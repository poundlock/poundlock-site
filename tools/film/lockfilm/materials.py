# 全部材质。没有贴图，都是程序算出来的：石头、木头、铁、漆、水、草、玻璃里的灯。
import bpy

from .util import material


def stone(name="stone", tone=1.0, wetness=0.35):
    """闸墙的砂岩。dz（顶点上的数）> 0 的地方常年泡水：发黑、长青苔、发亮。
    石缝和凹处积着黑泥、长着苔；朝上的面有积水。"""
    mat, g, bsdf, _ = material(name)
    pos = g.position()
    rnd = g.attr("rnd")
    dz = g.attr("dz")
    big = g.noise(pos, 0.3, 3)
    mid = g.noise(pos, 2.2, 5, 0.62)
    fine = g.noise(pos, 26.0, 4, 0.7)
    grit = g.noise(pos, 90.0, 2, 0.6)
    streak = g.noise(g.scaled(pos, (3.0, 3.0, 0.22)), 2.2, 3)
    crevice = g.new("ShaderNodeAmbientOcclusion", {"samples": 8, "only_local": True}, Distance=0.09).outputs["AO"]
    crevice = g.smooth(crevice, 0.92, 0.45)

    base = g.mix(mid, (0.055 * tone, 0.05 * tone, 0.045 * tone), (0.19 * tone, 0.17 * tone, 0.14 * tone))
    # 每块石头自己的深浅和冷暖。
    base = g.mix(g.remap(rnd, 0, 1, 0.0, 0.4), base, g.mix(g.noise(pos, 0.9, 1), (0.05, 0.048, 0.045), (0.2, 0.175, 0.135)))
    # 矿物的斑：细碎的浅色点和铁锈色的晕。
    base = g.mix(g.math("MULTIPLY", g.smooth(grit, 0.6, 0.8), 0.35), base, (0.38, 0.36, 0.32))
    base = g.mix(g.math("MULTIPLY", g.smooth(g.noise(pos, 0.7, 4, 0.7), 0.58, 0.74), 0.4), base, (0.2, 0.11, 0.05))
    base = g.mix(g.math("MULTIPLY", g.smooth(big, 0.42, 0.7), 0.7), base, (0.022, 0.022, 0.025))
    base = g.mix(g.math("MULTIPLY", g.smooth(streak, 0.56, 0.78), 0.6), base, (0.03, 0.03, 0.028))
    # 干的地方有浅色的地衣。
    lichen = g.math("MULTIPLY", g.smooth(g.noise(pos, 1.3, 4, 0.7), 0.62, 0.7), g.smooth(dz, -0.2, -0.9))
    base = g.mix(g.math("MULTIPLY", lichen, 0.5), base, (0.36, 0.4, 0.3))

    # 水线：不是一条直线，跟着噪声上下错开。
    wet = g.smooth(g.math("ADD", dz, g.math("MULTIPLY", g.math("SUBTRACT", mid, 0.5), 0.7)), -0.12, 0.3)
    algae = g.mix(g.smooth(g.noise(pos, 1.6, 3), 0.3, 0.7), (0.012, 0.022, 0.014), (0.03, 0.06, 0.022))
    soaked = g.mix(0.55, g.mix(0.75, base, (0.0, 0.0, 0.0)), algae)
    color = g.mix(wet, base, soaked)

    # 苔：长在石缝里、朝上的面上，一块一块的。
    up = g.smooth(g.xyz(g.normal())[2], 0.75, 0.95)
    moss_field = g.smooth(g.noise(pos, 1.9, 5, 0.72), 0.4, 0.58)
    moss = g.math("MULTIPLY", moss_field, g.math("MAXIMUM", crevice, g.math("MULTIPLY", up, 0.75)), clamp=True)
    moss_color = g.mix(g.noise(pos, 38.0, 3, 0.7), (0.012, 0.035, 0.008), (0.06, 0.11, 0.025))
    color = g.mix(g.math("MULTIPLY", crevice, 0.8), color, (0.008, 0.008, 0.007))
    color = g.mix(moss, color, moss_color)

    # 朝上的面：夜里的露水和积水，一洼一洼的。
    puddle = g.math("MULTIPLY", up, g.smooth(g.noise(pos, 0.55, 3), 0.52 - wetness * 0.3, 0.7 - wetness * 0.3))
    puddle = g.math("MULTIPLY", puddle, g.math("SUBTRACT", 1.0, moss, clamp=True))
    color = g.mix(g.math("MULTIPLY", puddle, 0.6), color, (0.01, 0.012, 0.014))

    rough_dry = g.math("ADD", 0.58, g.math("MULTIPLY", fine, 0.34))
    rough_wet = g.math("ADD", 0.1, g.math("MULTIPLY", fine, 0.22))
    rough = g.mixf(wet, rough_dry, rough_wet)
    rough = g.mixf(moss, rough, 0.9)
    rough = g.mixf(puddle, rough, 0.03)

    height = g.math("ADD", g.math("MULTIPLY", fine, 0.55), g.math("ADD", g.math("MULTIPLY", mid, 0.9), g.math("MULTIPLY", grit, 0.14)))
    height = g.math("ADD", height, g.math("MULTIPLY", moss, g.math("ADD", 0.6, g.noise(pos, 60.0, 2))))
    normal = g.bump(height, g.mixf(puddle, 0.9, 0.05), 0.035)

    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", rough)
    g.put(bsdf, "Normal", normal)
    g.put(bsdf, "Specular IOR Level", 0.5)
    return mat


def mortar():
    mat, g, bsdf, _ = material("mortar")
    pos = g.position()
    g.put(bsdf, "Base Color", g.mix(g.noise(pos, 8.0, 3), (0.01, 0.01, 0.009), (0.03, 0.028, 0.024)))
    g.put(bsdf, "Roughness", 0.85)
    return mat


def timber():
    """闸门的橡木：刷过焦油，发黑；下半截泡水，长青苔。ax = 1 的木料横着放，纹理跟着转。"""
    mat, g, bsdf, _ = material("timber")
    obj = g.object_coords()
    pos = g.position()
    rnd = g.attr("rnd")
    dz = g.attr("dz")
    ax = g.attr("ax")
    upright = g.scaled(obj, (9.0, 9.0, 0.35))
    lying = g.scaled(obj, (0.35, 9.0, 9.0))
    grain_v = g.noise(upright, 3.0, 5, 0.65)
    grain_h = g.noise(lying, 3.0, 5, 0.65)
    grain = g.mixf(ax, grain_v, grain_h)
    crack_v = g.noise(g.scaled(obj, (30.0, 30.0, 0.5)), 2.0, 2, 0.5)
    crack_h = g.noise(g.scaled(obj, (0.5, 30.0, 30.0)), 2.0, 2, 0.5)
    crack = g.smooth(g.mixf(ax, crack_v, crack_h), 0.6, 0.68)
    fine = g.noise(pos, 40.0, 3, 0.7)

    base = g.mix(grain, (0.012, 0.01, 0.008), (0.075, 0.055, 0.036))
    base = g.mix(g.remap(rnd, 0, 1, 0.0, 0.6), base, g.mix(grain, (0.02, 0.018, 0.016), (0.11, 0.095, 0.075)))
    base = g.mix(g.math("MULTIPLY", crack, 0.8), base, (0.004, 0.004, 0.004))
    wet = g.smooth(g.math("ADD", dz, g.math("MULTIPLY", g.math("SUBTRACT", g.noise(pos, 2.0, 3), 0.5), 0.8)), -0.2, 0.3)
    algae = g.mix(g.noise(pos, 3.0, 3), (0.008, 0.016, 0.01), (0.022, 0.05, 0.02))
    color = g.mix(g.math("MULTIPLY", wet, 0.8), base, algae)

    rough = g.mixf(wet, g.math("ADD", 0.42, g.math("MULTIPLY", grain, 0.3)), g.math("ADD", 0.1, g.math("MULTIPLY", fine, 0.15)))
    height = g.math("ADD", g.math("MULTIPLY", grain, 1.0), g.math("ADD", g.math("MULTIPLY", crack, -1.5), g.math("MULTIPLY", fine, 0.15)))
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", rough)
    g.put(bsdf, "Normal", g.bump(height, 0.6, 0.012))
    return mat


def paint(name, color, rough=0.32, chips=0.25, coat=0.4, under=(0.05, 0.035, 0.025)):
    """上了漆的铁和木头：漆面有脏、有磕掉的地方，露出底下的锈或者木头。"""
    mat, g, bsdf, _ = material(name)
    pos = g.position()
    dirt = g.noise(pos, 3.0, 5, 0.65)
    fine = g.noise(pos, 45.0, 3, 0.7)
    chip = g.math("MULTIPLY", g.smooth(g.noise(pos, 14.0, 4, 0.75), 0.66, 0.7), chips)
    base = g.mix(g.math("MULTIPLY", g.smooth(dirt, 0.45, 0.8), 0.45), color, tuple(c * 0.35 for c in color))
    base = g.mix(chip, base, under)
    g.put(bsdf, "Base Color", base)
    g.put(bsdf, "Roughness", g.mixf(chip, g.math("ADD", rough, g.math("MULTIPLY", fine, 0.18)), 0.75))
    g.put(bsdf, "Coat Weight", coat)
    g.put(bsdf, "Coat Roughness", 0.12)
    g.put(bsdf, "Normal", g.bump(g.math("ADD", g.math("MULTIPLY", chip, -1.0), g.math("MULTIPLY", fine, 0.1)), 0.25, 0.004))
    return mat


def metal(name, color, rough=0.3, tarnish=0.4):
    mat, g, bsdf, _ = material(name)
    pos = g.position()
    spots = g.smooth(g.noise(pos, 9.0, 5, 0.7), 0.45, 0.75)
    g.put(bsdf, "Base Color", g.mix(g.math("MULTIPLY", spots, tarnish), color, tuple(c * 0.25 for c in color)))
    g.put(bsdf, "Metallic", 1.0)
    g.put(bsdf, "Roughness", g.mixf(spots, rough, min(1.0, rough + 0.3)))
    return mat


def glow(name, color, strength):
    """自己发光的面：灯泡、船舱的窗。返回 (材质, 强度所在的节点)，渲染每一帧时可以改强度。"""
    mat, g, bsdf, _ = material(name)
    g.put(bsdf, "Base Color", (*color, 1.0))
    g.put(bsdf, "Emission Color", (*color, 1.0))
    g.put(bsdf, "Emission Strength", strength)
    return mat


def window():
    """船舱的窗：里面亮着灯，拉着半截帘子，亮度不匀。"""
    mat, g, bsdf, _ = material("cabin-window")
    obj = g.object_coords()
    pos = g.position()
    drape = g.smooth(g.noise(g.scaled(pos, (16.0, 16.0, 0.5)), 2.0, 3), 0.25, 0.8)
    warm = g.mix(drape, (0.8, 0.26, 0.06), (1.0, 0.72, 0.36))
    g.put(bsdf, "Base Color", (0.02, 0.02, 0.02, 1.0))
    g.put(bsdf, "Roughness", 0.05)
    g.put(bsdf, "Emission Color", warm)
    g.put(bsdf, "Emission Strength", g.math("MULTIPLY", g.math("ADD", 0.12, g.math("POWER", drape, 1.6)), 6.0))
    del obj
    return mat


def water():
    """水：近乎一面镜子，带细碎的波纹；注水的时候上游那头翻白沫。
    物体上的 churn（0 到 1）是这一室翻腾得多厉害；物体的原点在这一室下游的闸门处，x 朝上游。"""
    mat, g, bsdf, _ = material("water")
    obj = g.object_coords()
    time = g.value(0.0)
    churn = g.attr("churn", "OBJECT")
    reach = g.attr("reach", "OBJECT")  # 这一段水面多长
    x = g.xyz(obj)[0]
    # 离上游那头多近（注水的口子在那边）。
    near_inlet = g.smooth(g.math("SUBTRACT", reach, x), 9.0, 0.0)
    boil = g.math("MULTIPLY", churn, g.math("ADD", 0.25, g.math("MULTIPLY", near_inlet, 0.75)))

    flat = g.scaled(obj, (1.0, 1.0, 0.0))
    slow = g.noise(flat, 0.55, 2, 0.5, w=g.math("MULTIPLY", time, 0.25))
    ripple = g.noise(g.scaled(obj, (1.0, 1.6, 0.0)), 3.2, 3, 0.55, w=g.math("MULTIPLY", time, 0.6))
    fine = g.noise(flat, 11.0, 3, 0.6, w=time)
    chop = g.noise(flat, 5.0, 4, 0.7, w=g.math("MULTIPLY", time, 2.0))
    height = g.math("ADD", g.math("MULTIPLY", slow, 0.7), g.math("ADD", g.math("MULTIPLY", ripple, 0.5), g.math("MULTIPLY", fine, 0.16)))
    height = g.math("ADD", height, g.math("MULTIPLY", chop, g.math("MULTIPLY", boil, 2.2)))
    normal = g.bump(height, g.math("ADD", 0.32, g.math("MULTIPLY", boil, 0.6)), 0.05)

    foam_field = g.noise(flat, 2.4, 5, 0.75, w=g.math("MULTIPLY", time, 1.5))
    foam = g.math("MULTIPLY", g.smooth(foam_field, g.math("SUBTRACT", 0.8, g.math("MULTIPLY", boil, 0.62)), 0.86), g.smooth(boil, 0.03, 0.3))

    body = g.mix(foam, (0.012, 0.085, 0.11), (0.8, 0.9, 0.94))
    g.put(bsdf, "Base Color", body)
    g.put(bsdf, "Roughness", g.mixf(foam, 0.035, 0.55))
    g.put(bsdf, "IOR", 1.333)
    g.put(bsdf, "Transmission Weight", g.mixf(foam, 0.3, 0.0))
    g.put(bsdf, "Specular IOR Level", 1.0)
    g.put(bsdf, "Coat Weight", 0.5)
    g.put(bsdf, "Coat Roughness", 0.03)
    g.put(bsdf, "Normal", normal)
    mat["time_node"] = time.node.name
    return mat


def ground():
    """岸上的地：靠闸的一条是碎石路（path = 1），往外是草坡。"""
    mat, g, bsdf, _ = material("ground")
    pos = g.position()
    path = g.attr("path")
    big = g.noise(pos, 0.12, 4, 0.6)
    mid = g.noise(pos, 1.6, 5, 0.7)
    fine = g.noise(pos, 30.0, 3, 0.7)
    blades = g.noise(pos, 140.0, 2, 0.5)
    grass = g.mix(mid, (0.012, 0.03, 0.01), (0.045, 0.075, 0.022))
    grass = g.mix(g.math("MULTIPLY", g.smooth(big, 0.45, 0.7), 0.6), grass, (0.05, 0.045, 0.02))
    gravel = g.mix(fine, (0.035, 0.032, 0.03), (0.16, 0.15, 0.135))
    puddle = g.math("MULTIPLY", path, g.smooth(g.noise(pos, 0.45, 3), 0.52, 0.6))
    color = g.mix(path, grass, gravel)
    color = g.mix(g.math("MULTIPLY", puddle, 0.8), color, (0.008, 0.01, 0.012))
    g.put(bsdf, "Base Color", color)
    g.put(bsdf, "Roughness", g.mixf(puddle, g.mixf(path, 0.8, 0.6), 0.02))
    height = g.math("ADD", g.math("MULTIPLY", mid, 0.8), g.math("ADD", g.math("MULTIPLY", fine, 0.35), g.math("MULTIPLY", blades, g.mixf(path, 0.5, 0.1))))
    g.put(bsdf, "Normal", g.bump(height, g.mixf(puddle, 0.7, 0.03), 0.06))
    return mat


def foliage():
    mat, g, bsdf, _ = material("foliage")
    pos = g.position()
    g.put(bsdf, "Base Color", g.mix(g.noise(pos, 2.5, 4, 0.7), (0.004, 0.012, 0.006), (0.02, 0.04, 0.015)))
    g.put(bsdf, "Roughness", 0.75)
    g.put(bsdf, "Normal", g.bump(g.noise(pos, 9.0, 4, 0.75), 1.0, 0.15))
    return mat


def canvas():
    mat, g, bsdf, _ = material("canvas")
    pos = g.position()
    folds = g.noise(g.scaled(pos, (0.6, 3.0, 3.0)), 2.2, 4, 0.6)
    weave = g.noise(pos, 120.0, 2, 0.5)
    g.put(bsdf, "Base Color", g.mix(folds, (0.006, 0.014, 0.024), (0.02, 0.045, 0.07)))
    g.put(bsdf, "Roughness", 0.55)
    g.put(bsdf, "Sheen Weight", 0.4)
    g.put(bsdf, "Normal", g.bump(g.math("ADD", folds, g.math("MULTIPLY", weave, 0.05)), 0.7, 0.03))
    return mat


def rope():
    mat, g, bsdf, _ = material("rope")
    pos = g.position()
    twist = g.noise(g.scaled(pos, (4.0, 4.0, 14.0)), 6.0, 3, 0.6)
    g.put(bsdf, "Base Color", g.mix(twist, (0.05, 0.036, 0.02), (0.2, 0.15, 0.085)))
    g.put(bsdf, "Roughness", 0.9)
    g.put(bsdf, "Normal", g.bump(twist, 1.0, 0.02))
    return mat


def plaster():
    """看闸人的小屋：刷白的墙，墙根发潮。"""
    mat, g, bsdf, _ = material("plaster")
    pos = g.position()
    stain = g.noise(g.scaled(pos, (2.0, 2.0, 0.3)), 2.0, 4, 0.6)
    g.put(bsdf, "Base Color", g.mix(g.smooth(stain, 0.4, 0.8), (0.62, 0.62, 0.58), (0.3, 0.3, 0.27)))
    g.put(bsdf, "Roughness", 0.8)
    g.put(bsdf, "Normal", g.bump(g.noise(pos, 20.0, 4, 0.7), 0.35, 0.02))
    return mat


def slate():
    mat, g, bsdf, _ = material("slate")
    pos = g.position()
    rows = g.new("ShaderNodeTexBrick", {"offset": 0.5}, Vector=g.scaled(pos, (1.0, 1.0, 1.0)), Scale=3.2)
    g.put(rows, "Color1", (0.03, 0.036, 0.045, 1.0))
    g.put(rows, "Color2", (0.05, 0.058, 0.07, 1.0))
    g.put(rows, "Mortar", (0.01, 0.01, 0.012, 1.0))
    g.put(bsdf, "Base Color", rows.outputs[0])
    g.put(bsdf, "Roughness", 0.3)
    g.put(bsdf, "Normal", g.bump(rows.outputs[1], 0.6, 0.02))
    return mat


def fog(density=0.012):
    """罩住整个场景的雾：贴着地，越往上越薄（按离地的高度指数衰减），没有一刀切的顶。
    地面跟着船闸一级一级抬高，所以「离地多高」是相对这一处的岸顶算的。"""
    from . import layout as lay
    from .util import Graph

    mat = bpy.data.materials.new("fog")
    mat.use_nodes = True
    tree = mat.node_tree
    for node in list(tree.nodes):
        if node.type != "OUTPUT_MATERIAL":
            tree.nodes.remove(node)
    g = Graph(tree)
    out = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    amount = g.value(density)
    amount.node.name = "density"
    parts = g.xyz(g.position())
    ground = g.remap(parts[0], 0.0, lay.N * lay.L, 0.0, lay.N * lay.R)
    above = g.math("MAXIMUM", g.math("SUBTRACT", parts[2], ground), 0.0)
    thin = g.math("EXPONENT", g.math("MULTIPLY", above, -1.0 / 11.0))
    scatter = g.new("ShaderNodeVolumeScatter", Density=g.math("MULTIPLY", amount, thin), Anisotropy=0.55)
    scatter.inputs["Color"].default_value = (0.7, 0.88, 1.0, 1.0)
    tree.links.new(scatter.outputs[0], out.inputs["Volume"])
    return mat


def mist():
    """贴着水面的一层雾气，一团一团的，越往上越淡。物体的 z 从 0（水面）到 1（顶）。"""
    mat = bpy.data.materials.new("mist")
    mat.use_nodes = True
    tree = mat.node_tree
    for node in list(tree.nodes):
        if node.type != "OUTPUT_MATERIAL":
            tree.nodes.remove(node)
    from .util import Graph

    g = Graph(tree)
    out = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    time = g.value(0.0)
    time.node.name = "time"
    pos = g.position()
    generated = g.new("ShaderNodeTexCoord").outputs["Generated"]
    height = g.xyz(generated)[2]
    puffs = g.noise(g.scaled(pos, (0.22, 0.3, 0.5)), 1.0, 4, 0.6, w=g.math("MULTIPLY", time, 0.12))
    fall = g.math("POWER", g.math("SUBTRACT", 1.0, height, clamp=True), 2.2)
    density = g.math("MULTIPLY", g.math("MULTIPLY", g.smooth(puffs, 0.38, 0.7), fall), 0.55)
    density.node.name = "density"
    scatter = g.new("ShaderNodeVolumeScatter", Density=density, Anisotropy=0.35)
    scatter.inputs["Color"].default_value = (0.85, 0.93, 1.0, 1.0)
    tree.links.new(scatter.outputs[0], out.inputs["Volume"])
    return mat


def needles():
    """云杉的枝叶：很深的墨绿，背光的时候边上透一点亮。"""
    mat, g, bsdf, _ = material("needles")
    pos = g.position()
    tint = g.new("ShaderNodeObjectInfo").outputs["Random"]
    base = g.mix(g.noise(pos, 3.0, 4, 0.7), (0.003, 0.01, 0.006), (0.016, 0.035, 0.016))
    base = g.mix(g.math("MULTIPLY", tint, 0.5), base, (0.012, 0.02, 0.02))
    g.put(bsdf, "Base Color", base)
    g.put(bsdf, "Roughness", 0.7)
    g.put(bsdf, "Sheen Weight", 0.35)
    g.put(bsdf, "Normal", g.bump(g.noise(pos, 14.0, 4, 0.8), 1.0, 0.2))
    return mat


def grass():
    """草叶：根上深、尖上浅，每一丛的颜色不一样，有的已经枯黄。光能透过叶片。"""
    mat, g, bsdf, _ = material("grass")
    obj = g.object_coords()
    tint = g.new("ShaderNodeObjectInfo").outputs["Random"]
    tall = g.remap(g.xyz(obj)[2], 0.0, 0.4)
    green = g.mix(tall, (0.006, 0.014, 0.004), (0.035, 0.07, 0.016))
    dry = g.mix(tall, (0.02, 0.02, 0.008), (0.1, 0.085, 0.035))
    g.put(bsdf, "Base Color", g.mix(g.smooth(tint, 0.62, 0.95), green, dry))
    g.put(bsdf, "Roughness", 0.7)
    g.put(bsdf, "Specular IOR Level", 0.2)
    return mat


def spray():
    """注水时从闸门的阀口冲出来的水：发白、起泡，越往下越碎（边上和下半截是镂空的）。"""
    mat, g, bsdf, _ = material("spray")
    obj = g.object_coords()
    time = g.value(0.0)
    time.node.name = "time"
    parts = g.xyz(obj)
    fall = g.math("MULTIPLY", parts[2], -1.0)  # 0 在阀口，1 在落到水面的地方
    layer = g.attr("layer")
    flow = g.new("ShaderNodeCombineXYZ", X=g.math("MULTIPLY", parts[0], 1.2), Y=g.math("MULTIPLY", parts[1], 11.0), Z=g.math("ADD", g.math("MULTIPLY", parts[2], 1.6), g.math("MULTIPLY", layer, 7.0))).outputs[0]
    streaks = g.noise(flow, 2.6, 6, 0.72, w=g.math("MULTIPLY", time, 5.0))
    holes = g.noise(g.scaled(flow, (1.0, 0.45, 1.6)), 3.4, 4, 0.7, w=g.math("MULTIPLY", time, 3.0))
    across = g.attr("across")  # 0 在水柱正中，1 在边上
    solid = g.math("SUBTRACT", 1.15, g.math("ADD", g.math("MULTIPLY", across, 0.75), g.math("MULTIPLY", fall, 0.5)))
    alpha = g.smooth(g.math("ADD", holes, g.math("MULTIPLY", g.math("SUBTRACT", solid, 0.6), 0.9)), 0.42, 0.62)
    g.put(bsdf, "Base Color", g.mix(streaks, (0.5, 0.7, 0.8), (0.96, 0.98, 1.0)))
    g.put(bsdf, "Roughness", g.mixf(streaks, 0.12, 0.6))
    g.put(bsdf, "Transmission Weight", g.mixf(streaks, 0.75, 0.15))
    g.put(bsdf, "IOR", 1.33)
    g.put(bsdf, "Alpha", alpha)
    g.put(bsdf, "Normal", g.bump(streaks, 1.0, 0.06))
    return mat
