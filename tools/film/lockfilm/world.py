# 天、光、雾、镜头和后期。天是自己搭的渐变（不是现成的天空模型），颜色跟着网站的配色走：
# 夜里是深海军蓝，地平线上一抹青；天亮时地平线发白，太阳从船头那边升起来。
import math

import bpy
from mathutils import Vector

from . import layout as lay
from .util import Boxes, Graph, assign, link


def _lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def _mix3(keys, t):
    """keys：[(t0, 值), (t1, 值), …]，按 t 在相邻两个之间插值。"""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, a), (t1, b) in zip(keys, keys[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0)
            f = f * f * (3 - 2 * f)
            return _lerp(a, b, f) if isinstance(a, tuple) else a + (b - a) * f
    return keys[-1][1]


# 天色的几个关键时刻。t：0 是深夜，0.6 是天快亮（蓝调时刻），1 是日出。
SKY = {
    "zenith": [(0.0, (0.003, 0.01, 0.032)), (0.6, (0.007, 0.03, 0.08)), (1.0, (0.045, 0.16, 0.4))],
    "horizon": [(0.0, (0.012, 0.055, 0.095)), (0.6, (0.045, 0.2, 0.3)), (1.0, (0.46, 0.76, 0.95))],
    "glow": [(0.0, (0.035, 0.2, 0.28)), (0.6, (0.14, 0.62, 0.76)), (1.0, (1.25, 1.2, 1.05))],
    "cloud_dark": [(0.0, (0.006, 0.018, 0.045)), (0.6, (0.014, 0.045, 0.1)), (1.0, (0.2, 0.3, 0.46))],
    "cloud_lit": [(0.0, (0.03, 0.15, 0.22)), (0.6, (0.14, 0.52, 0.64)), (1.0, (1.8, 1.3, 0.9))],
    "ground": [(0.0, (0.002, 0.007, 0.012)), (0.6, (0.006, 0.02, 0.028)), (1.0, (0.05, 0.09, 0.1))],
    "stars": [(0.0, 1.0), (0.6, 0.35), (0.85, 0.0), (1.0, 0.0)],
    "sun": [(0.0, 0.0), (0.72, 0.0), (1.0, 2.6)],
    "sun_disc": [(0.0, 0.0), (0.7, 0.0), (1.0, 140.0)],
    "sun_elevation": [(0.0, -8.0), (0.6, -4.0), (1.0, 4.2)],
    "moon": [(0.0, 0.36), (0.6, 0.28), (1.0, 0.0)],
    "lamps": [(0.0, 1.0), (0.7, 1.0), (1.0, 0.22)],
    "fog": [(0.0, 0.0055), (0.6, 0.0065), (1.0, 0.0075)],
    "exposure": [(0.0, 1.25), (0.6, 0.9), (1.0, -1.0)],
}
COLORS = ("zenith", "horizon", "glow", "ground", "cloud_dark", "cloud_lit")
SUN_AZIMUTH = math.radians(2.5)  # 太阳差不多就在运河的尽头，偏左一点点


def sun_direction(t):
    """指向太阳的单位向量。"""
    elevation = math.radians(_mix3(SKY["sun_elevation"], t))
    return Vector((math.cos(elevation) * math.cos(SUN_AZIMUTH), math.cos(elevation) * math.sin(SUN_AZIMUTH), math.sin(elevation)))


def build(scene, mats):
    """返回一个字典，里面是渲染每一帧时要调的东西。"""
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    scene.world = world
    tree = world.node_tree
    g = Graph(tree)
    background = next(n for n in tree.nodes if n.type == "BACKGROUND")

    ctl = {name: g.rgb((0, 0, 0)) for name in COLORS}
    for name in ("stars", "sun_disc", "drift"):
        ctl[name] = g.value(0.0)
    sun_vec = g.new("ShaderNodeCombineXYZ")
    ctl["sun_vec"] = sun_vec

    direction = g.vmath("NORMALIZE", g.new("ShaderNodeTexCoord").outputs["Generated"]).outputs[0]
    z = g.xyz(direction)[2]
    up = g.math("MAXIMUM", z, 0.0)
    band = g.math("POWER", g.math("SUBTRACT", 1.0, up, clamp=True), 5.0)
    sky = g.mix(band, ctl["zenith"], ctl["horizon"])
    toward = g.vmath("DOT_PRODUCT", direction, sun_vec.outputs[0]).outputs[1]
    # 朝着日出那边的一大片辉光，贴着地平线。
    wide = g.math("MULTIPLY", g.math("POWER", g.smooth(toward, 0.0, 1.0), 3.0), g.math("POWER", g.math("SUBTRACT", 1.0, up, clamp=True), 4.0))
    sky = g.mix(wide, sky, ctl["glow"], "ADD")
    # 太阳本身和它周围的光晕。
    disc = g.smooth(toward, 0.99955, 0.99985)
    halo = g.math("POWER", g.math("MAXIMUM", toward, 0.0), 900.0)
    sun = g.math("MULTIPLY", g.math("ADD", disc, g.math("MULTIPLY", halo, 0.12)), ctl["sun_disc"])
    sky = g.mix(1.0, sky, g.vmath("SCALE", g.rgb((1.0, 0.92, 0.8)), scale=sun).outputs[0], "ADD")
    # 云：一层高高的云，往地平线压成一道一道的；朝着日出的那一面被天光照亮。
    parts = g.xyz(direction)
    lift = g.math("MAXIMUM", g.math("ADD", z, 0.06), 0.03)
    plane = g.new("ShaderNodeCombineXYZ", X=g.math("DIVIDE", parts[0], lift), Y=g.math("DIVIDE", parts[1], lift), Z=ctl["drift"]).outputs[0]
    billow = g.noise(g.scaled(plane, (0.85, 0.3, 1.0)), 1.0, 8, 0.62)
    wisps = g.noise(g.scaled(plane, (2.6, 0.5, 1.0), (7.0, 3.0, 0.0)), 1.0, 6, 0.7)
    cover = g.smooth(g.math("ADD", g.math("MULTIPLY", billow, 0.7), g.math("MULTIPLY", wisps, 0.3)), 0.45, 0.68)
    cover = g.math("MULTIPLY", cover, g.smooth(z, -0.01, 0.1))
    lit = g.math("MULTIPLY", g.math("POWER", g.smooth(toward, -0.2, 1.0), 2.0), g.smooth(billow, 0.75, 0.45))
    cloud = g.mix(lit, ctl["cloud_dark"], ctl["cloud_lit"])
    sky = g.mix(g.math("MULTIPLY", cover, 0.9), sky, cloud)
    # 星星：只在天上，越靠近地平线越淡；被云挡住的看不见。
    cells = g.new("ShaderNodeTexVoronoi", {"feature": "F1"}, Vector=direction, Scale=190.0)
    spark = g.math("MULTIPLY", g.smooth(cells.outputs[0], 0.06, 0.0), g.math("POWER", g.xyz(cells.outputs[1])[0], 4.0))
    stars = g.math("MULTIPLY", g.math("MULTIPLY", spark, ctl["stars"]), g.smooth(z, 0.03, 0.4))
    stars = g.math("MULTIPLY", stars, g.math("SUBTRACT", 1.0, cover, clamp=True))
    sky = g.mix(1.0, sky, g.vmath("SCALE", g.rgb((0.8, 0.9, 1.0)), scale=g.math("MULTIPLY", stars, 9.0)).outputs[0], "ADD")
    below = g.smooth(z, 0.0, -0.06)
    sky = g.mix(below, sky, ctl["ground"])
    g.put(background, "Color", sky)
    g.put(background, "Strength", 1.0)

    def sun_lamp(name, color, angle):
        data = bpy.data.lights.new(name, "SUN")
        data.color = color
        data.angle = math.radians(angle)
        return data, link(bpy.data.objects.new(name, data))

    ctl["sun_data"], ctl["sun_obj"] = sun_lamp("sun", (1.0, 0.82, 0.62), 2.2)
    ctl["moon_data"], moon = sun_lamp("moon", (0.52, 0.72, 1.0), 2.0)
    moon.rotation_euler = Vector((0.52, 0.42, 0.74)).to_track_quat("Z", "Y").to_euler()

    # 薄雾：一个罩住全场的大盒子。
    shell = Boxes()
    shell.span(lay.X_MIN - 30.0, lay.X_MAX + 30.0, -210.0, 210.0, -5.0, 72.0)
    box = link(bpy.data.objects.new("fog", shell.mesh("fog")))
    box.visible_shadow = False
    assign(box, mats["fog"])
    ctl["fog"] = [(mats["fog"].node_tree.nodes["density"].outputs[0], 1.0)]

    cam = bpy.data.cameras.new("camera")
    cam.lens = 27.0
    cam.sensor_width = 36.0
    cam.clip_start = 0.1
    cam.clip_end = 2000.0
    cam.dof.use_dof = True
    cam.dof.aperture_fstop = 2.0
    cam.dof.aperture_blades = 7
    ctl["cam"] = link(bpy.data.objects.new("camera", cam))
    scene.camera = ctl["cam"]
    ctl["world"] = world
    return ctl


def set_time(scene, ctl, t, lamps):
    """把天色调到 t（0 深夜，1 日出）。"""
    for name in COLORS:
        ctl[name].default_value = (*_mix3(SKY[name], t), 1.0)
    for name in ("stars", "sun_disc"):
        ctl[name].default_value = _mix3(SKY[name], t)
    direction = sun_direction(t)
    for k in range(3):
        ctl["sun_vec"].inputs[k].default_value = direction[k]
    ctl["sun_obj"].rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    ctl["sun_data"].energy = _mix3(SKY["sun"], t)
    ctl["moon_data"].energy = _mix3(SKY["moon"], t)
    for socket, share in ctl["fog"]:
        socket.default_value = _mix3(SKY["fog"], t) * share
    scene.view_settings.exposure = _mix3(SKY["exposure"], t)
    level = _mix3(SKY["lamps"], t)
    for data, base in lamps:
        data.energy = base * level


def aim(ctl, position, target, focus=None, lens=None, roll=0.0):
    cam = ctl["cam"]
    cam.location = position
    look = Vector(target) - Vector(position)
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    if roll:
        cam.rotation_euler.rotate_axis("Z", roll)
    cam.data.dof.focus_distance = (Vector(focus if focus is not None else target) - Vector(position)).length
    if lens:
        cam.data.lens = lens


def compositor(scene, bloom=0.45):
    """后期：高光溢出一点柔光，边缘带一点色散，像真镜头拍的。"""
    tree = bpy.data.node_groups.new("post", "CompositorNodeTree")
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    layers = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.inputs["Type"].default_value = "Bloom"
    glare.inputs["Quality"].default_value = "High"
    glare.inputs["Threshold"].default_value = 1.0
    glare.inputs["Strength"].default_value = bloom
    glare.inputs["Size"].default_value = 0.55
    lens = tree.nodes.new("CompositorNodeLensdist")
    lens.inputs["Distortion"].default_value = 0.0
    lens.inputs["Dispersion"].default_value = 0.012
    out = tree.nodes.new("NodeGroupOutput")
    tree.links.new(layers.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], lens.inputs["Image"])
    tree.links.new(lens.outputs["Image"], out.inputs[0])
    scene.compositing_node_group = tree
    scene.render.use_compositing = True


def render_settings(scene, width, height, samples):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == "OPTIX"
    cycles = scene.cycles
    cycles.device = "GPU"
    cycles.samples = samples
    cycles.use_adaptive_sampling = True
    cycles.adaptive_threshold = 0.02
    cycles.use_denoising = True
    cycles.denoiser = "OPENIMAGEDENOISE"
    cycles.denoising_use_gpu = True
    cycles.max_bounces = 8
    cycles.diffuse_bounces = 3
    cycles.glossy_bounces = 4
    cycles.transmission_bounces = 6
    cycles.volume_bounces = 1
    cycles.caustics_reflective = False
    cycles.caustics_refractive = False
    cycles.sample_clamp_indirect = 6.0
    cycles.volume_step_rate = 1.0
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.use_persistent_data = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - High Contrast"
