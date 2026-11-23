# 把渲好的长条图压成页面用的 WebP，写 manifest.json（页面按它摆图、算位置）。
#
#   python -I tools/reef/encode.py --from .shots/reef/strip --to src/assets/reef [--res 1] [--quality 82]
#
# 每块左右多渲的 PAD_PX 在这里裁掉；中景的两张辅助图（阳光直射、摆动量）合成一张：红 = 阳光，绿 = 摆动，半分辨率。
# --res 和渲染时一样（试渲用的四分之一分辨率就写 0.25），只影响像素数，横向的米数不变。
# 要 Pillow（带 WebP）。不读写仓库以外的地方。
import argparse
import json
import os
import sys

from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import journey as J  # noqa: E402


def save_webp(img, path, quality, lossless=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=6, alpha_quality=88, lossless=lossless)
    return os.path.getsize(path)


def feathered(padded, i, pad):
    """第 i 块裁掉两边多渲的 pad，并且和左右邻居在接缝两边各 pad 像素里交叉淡过去：
    两块在重叠的那一截里渲出来的东西有一丁点不一样（降噪、远处的影子）也看不出接缝。"""
    import numpy as np

    cur = np.asarray(padded[i], dtype=np.float32)
    w = cur.shape[1]
    out = cur[:, pad : w - pad].copy()
    ramp = (np.arange(pad, dtype=np.float32) + 0.5) / (2 * pad)
    if i + 1 < len(padded):
        nxt = np.asarray(padded[i + 1], dtype=np.float32)
        # 这一块最后 pad 列 = 接缝左边那一截；邻居同一截在它的第 0 到 pad 列。混的比例从 0 升到 0.5
        t = ramp[None, :, None]
        out[:, -pad:] = cur[:, w - 2 * pad : w - pad] * (1 - t) + nxt[:, 0:pad] * t
    if i > 0:
        prv = np.asarray(padded[i - 1], dtype=np.float32)
        pw = prv.shape[1]
        # 这一块头 pad 列 = 接缝右边那一截；邻居同一截在它倒数第 pad 列以后。混的比例从 0.5 降到 0
        t = (0.5 - ramp)[None, :, None]
        out[:, :pad] = cur[:, pad : 2 * pad] * (1 - t) + prv[:, pw - pad : pw] * t
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), "RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", default=".shots/reef/strip")
    ap.add_argument("--to", dest="dst", default="src/assets/reef")
    ap.add_argument("--res", type=float, default=1.0)
    ap.add_argument("--quality", type=int, default=82)
    args = ap.parse_args()
    res = args.res
    pad = round(J.PAD_PX * res)
    total = 0
    layers = {}
    for layer in ("far", "mid", "above"):
        if layer == "above" and not os.path.isdir(os.path.join(args.src, "above")):
            continue
        tiles = J.tiles(layer)
        aux = False
        padded = [Image.open(os.path.join(args.src, layer, f"{i:02d}.png")).convert("RGBA") for i, _, _ in tiles]
        for i, xa, xb in tiles:
            w, h = padded[i].size
            im = feathered(padded, i, pad)
            total += save_webp(im, os.path.join(args.dst, layer, f"{i:02d}.webp"), args.quality)
            light = os.path.join(args.src, layer, f"{i:02d}-light.png")
            sway = os.path.join(args.src, layer, f"{i:02d}-sway.png")
            if os.path.exists(light) and os.path.exists(sway):
                aux = True
                lo = Image.open(light).convert("L").crop((pad, 0, w - pad, h))
                sw = Image.open(sway).convert("L").crop((pad, 0, w - pad, h))
                # 摆动量往外扩一圈再糊开：页面按它把这一处的像素左右挪，植物边上的水也得跟着挪，叶子才摆得出去
                sw = sw.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(5))
                zero = Image.new("L", lo.size, 0)
                merged = Image.merge("RGB", (lo, sw, zero)).resize((lo.width // 2, lo.height // 2), Image.BILINEAR)
                total += save_webp(merged, os.path.join(args.dst, layer, f"{i:02d}-aux.webp"), 80)
        scale, tilt, s0 = J.LAYERS[layer]
        layers[layer] = {
            "scale": scale,
            "tiles": len(tiles),
            "x0": round(tiles[0][1], 5),
            "tileM": round(tiles[0][2] - tiles[0][1], 6),
            "aux": aux,
        }
    back_src = os.path.join(args.src, "back", "back.png")
    bx0, bx1 = J.strip_range("far")
    back = Image.open(back_src).convert("RGB")
    total += save_webp(back, os.path.join(args.dst, "back.webp"), 90)
    manifest = {
        "version": 1,
        "viewH": J.VIEW_H,
        "stripPx": round(J.STRIP_PX * res),
        "tilePx": round(J.TILE_PX * res),
        "xStart": J.X_START,
        "xEnd": J.X_END,
        "sceneLen": J.SCENE_LEN,
        "blend": J.BLEND,
        "scenes": [{"key": s["key"], "low": s["low"], "high": s["high"]} for s in J.SCENES],
        "layers": layers,
        "back": {"x0": round(bx0, 5), "x1": round(bx1, 5)},
        # 出水：水面以上那张图停下时水线在画面从上往下的哪里
        "aboveTo": J.ABOVE_TO,
        # 鱼的序列帧：一张图集 6 列 4 行，一圈 24 帧；鱼身长 len 米（中景的尺度），一帧宽是鱼身长的 frameOverLen 倍
        "fish": {"cols": 6, "rows": 4, "frames": 24, "len": 0.42, "frameW": 640, "frameH": 320, "frameOverLen": 1.43},
    }
    if os.path.exists(os.path.join(args.dst, "jelly.webp")):
        # 水母的序列帧（tools/reef/jelly.py 渲的，atlas.py --jelly 拼的）：4 列 4 行，一圈 16 帧
        manifest["jelly"] = {"cols": 4, "rows": 4, "frames": 16}
    with open(os.path.join(args.dst, "manifest.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"压好了：{args.dst}，{total / 1e6:.1f} MB")


main()
