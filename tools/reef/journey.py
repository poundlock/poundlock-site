# 过闸这一路怎么排：八段场景沿 x 排开，每段多长、在哪交界、水是什么颜色、长条图切成多少块。
# 不依赖 Blender：渲染脚本、压图脚本都读它，压图时还把要给页面的那部分写进清单（manifest.json）。
#
# 坐标和 reef_core.py 一样：x 朝右（米，中景的尺度），镜头中心从 X_START 走到 X_END。
# 中景一屏高 VIEW_H 米、渲成 STRIP_PX 像素高；远景的 scale 是 0.4（同样的像素高装下 2.5 倍的米数），横向的米数各层共用。
import math

SCENE_LEN = 5.0
BLEND = 1.2  # 交界带的半宽（米）：前一段从交界前 BLEND 开始变稀，后一段在交界后 BLEND 才长满
VIEW_H = 1.6
VIEW_S0 = -0.15
STRIP_PX = 1800
TILE_PX = 2048
PAD_PX = 32  # 每块左右多渲一截再裁掉：降噪在图的边上会有一点不同，裁掉以后块与块接得上
X_START = 1.6
X_END = 8 * SCENE_LEN - 1.6
MAX_ASPECT = 2.4  # 最宽的视口（宽比高）：长条图要盖到这么宽也不露底

# 每段：名字、水的颜色（画面下沿、上沿，sRGB）、能见距离（米）
SCENES = [
    {"key": "coral", "low": "#0a3c58", "high": "#2f8fb5", "vis": 6.0},
    {"key": "seagrass", "low": "#0c4650", "high": "#3a9db0", "vis": 7.0},
    {"key": "kelp", "low": "#0b3a38", "high": "#2c8580", "vis": 5.0},
    {"key": "canyon", "low": "#082c44", "high": "#1d6890", "vis": 5.0},
    {"key": "lock", "low": "#0e3133", "high": "#2b6563", "vis": 4.0},
    {"key": "jelly", "low": "#040d24", "high": "#102c62", "vis": 6.0},
    {"key": "river", "low": "#1a4636", "high": "#56a486", "vis": 9.0},
    {"key": "shallow", "low": "#25554a", "high": "#86c8b6", "vis": 8.0},
]
LAYERS = {
    # 名字: (scale, 俯角（度）, 画面下沿的 s)
    "mid": (1.0, 12.0, VIEW_S0),
    "far": (0.4, 8.0, -1.44),
    # 水面以上：出水时从画面上方露出来，镜头几乎平视，水面在画面下面三成处
    "above": (1.0, 4.0, 0.87),
}
SURFACE_Z = 1.35  # 浅水那一段的水面高（米）
ABOVE_TO = 0.74  # 出水停下时，水面以上那张图的水线在画面从上往下的哪里（0 顶 1 底）


def scene_index(key):
    return next(i for i, s in enumerate(SCENES) if s["key"] == key)


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def presence(k, x):
    """第 k 段在 x 处有多少（0 到 1）：段内是 1，交界带里和相邻那段此消彼长，两段加起来是 1。"""
    a = k * SCENE_LEN
    b = (k + 1) * SCENE_LEN
    left = 1.0 if k == 0 else smooth((x - (a - BLEND)) / (2 * BLEND))
    right = 1.0 if k == len(SCENES) - 1 else 1.0 - smooth((x - (b - BLEND)) / (2 * BLEND))
    return left * right


def scenes_in(xa, xb):
    """x 在 [xa, xb] 里出现了哪几段（有一点就算）。"""
    out = []
    for k in range(len(SCENES)):
        # 第一段往左、最后一段往右一直延伸（路线两头以外还是它们）
        a = k * SCENE_LEN - BLEND if k > 0 else -1e9
        b = (k + 1) * SCENE_LEN + BLEND if k < len(SCENES) - 1 else 1e9
        if b > xa and a < xb:
            out.append(k)
    return out


def px_per_m(layer):
    return STRIP_PX * LAYERS[layer][0] / VIEW_H


def strip_range(layer):
    """这一层的长条图要盖住的 x 范围：镜头走过的地方，两头再各加最宽视口的半屏。"""
    scale = LAYERS[layer][0]
    half = VIEW_H / scale * MAX_ASPECT / 2
    if layer == "above":
        # 只有最后出水那一截用得到
        return X_END - 1.4 - half, X_END + half
    return X_START - half, X_END + half


def tiles(layer):
    """这一层切成几块：[(第几块, 左边的 x, 右边的 x), ...]，每块正好 TILE_PX 宽（最后一块也是）。"""
    x0, x1 = strip_range(layer)
    w = TILE_PX / px_per_m(layer)
    n = math.ceil((x1 - x0) / w)
    return [(i, x0 + i * w, x0 + (i + 1) * w) for i in range(n)]
