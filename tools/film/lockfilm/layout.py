# 船闸的尺寸和各处的高度。单位是米：x 是船走的方向（往上游），y 横着，z 朝上。
# 八室连着排成一道梯级：第 i 室占 x ∈ [i·L, (i+1)·L]，低水位 i·R，注满 (i+1)·R。
# 第 g 道闸门在 x = g·L。下游的运河在 x < 0，水位 0；上游的运河在 x > N·L，水位 N·R。
import math

N = 8
L = 24.0  # 一室多长
W = 5.6  # 水面多宽
R = 2.4  # 一级升多高
D = 1.8  # 室底在低水位以下多深
RIM = 0.55  # 墙顶比这一室的满水位高多少
SB = 5.0  # 闸门下游这么长的一段岸，已经是上一级的高度（推门的人站在这里）
COPING = 0.28  # 压顶石多厚
MITRE = math.radians(70)  # 人字门关严时，门扇和闸墙的夹角
HINGE = W / 2 - 0.15  # 门轴离中线多远
LEAF = HINGE / math.sin(MITRE)  # 一扇门多宽
TIP = LEAF * math.cos(MITRE)  # 关严时两扇门的尖顶比门轴往上游多出多少
X_MIN = -110.0
X_MAX = N * L + 520.0


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def quay_top(x):
    """这一处的岸顶多高。"""
    k = clamp(math.floor((x + SB) / L), -1, N - 1)
    return (k + 1) * R + RIM


def floor_z(x):
    """这一处的河底多高。"""
    j = clamp(math.floor(x / L), 0, N)
    return j * R - D


def full_level(x):
    """这一处常年泡到的最高水位。"""
    j = math.floor(x / L)
    if j < 0:
        return 0.0
    return min(j + 1, N) * R


def gate_bottom(g):
    return min(g, N) * R - D


def gate_top(g):
    """门板顶：比上游一侧的满水位高一点。"""
    return min(g + 1, N) * R + 0.35


def steps():
    """岸顶抬高一级的那些 x。"""
    return [k * L - SB for k in range(N)]
