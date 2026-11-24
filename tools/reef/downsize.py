# 从压好的高清图缩出页面用的两套小图，写进 manifest.json（lock-reef.js 按它挑）：
#   预览图 <块>-lo.webp：长条图（远景、中景、水面以上）长宽各四分之一，二三十 KB，页面先下它垫着；
#   半分辨率 <块>-md.webp：长条图长宽各二分之一（900 像素高），中景的辅助图 <块>-aux-md.webp 再小一半（512×450），
#     鱼和水母的图集四分之三（鱼每帧 480×240）。画布不到 HALF_MAX 像素高（常见的笔记本、手机，lock-reef.js）用它代替高清的，
#     一段从 1.2～1.9 MB 降到 0.45 MB 上下。
# 国内的线路上（Cloudflare 把访客分到欧洲的节点，实测 100 来 KB/s）一段的高清图要十来秒，访客一路看到的都是预览图；
# 而常见笔记本上画布只有 700 来像素高，1800 像素高的原图用不上。
#
#   python -I tools/reef/downsize.py [--dir src/assets/reef]
#
# encode.py 压完会调它；只想重做小图时单独跑。要 Pillow（带 WebP）。不读写仓库以外的地方。
import argparse
import json
import os

from PIL import Image

LAYERS = ("far", "mid", "above")
# 长条图：后缀 → (缩小的倍数, 质量, 透明度的质量)。1/4、质量 60 一张平均 28 KB；1/2、质量 70 中景一张平均 118 KB
# （质量 78 是 133 KB，放大 1.33 倍并排看分不出来）
TILE_TIERS = {"lo": (4, 60, 70), "md": (2, 70, 75)}
# 辅助图（阳光直射、摆动量，本来就是糊开的）：半分辨率那套再缩一半，一张 48 KB → 14 KB
AUX_MD = (2, 75)
# 鱼和水母的图集缩到 3/4：鱼在 1200 像素高的画布上最宽 450 像素左右，每帧 480 宽不用放大；格子数不变，帧不会串
SPRITES = ("fish/idle", "fish/swim", "jelly")
SPRITE_SCALE = 0.75
# 鱼两套质量 80 共 522 KB，72 共 389 KB
SPRITE_QUALITY = (72, 75)


def save(im, out, quality, alpha_quality):
    im.save(out, "WEBP", quality=quality, method=6, alpha_quality=alpha_quality)
    return os.path.getsize(out)


def make(dst):
    sizes = {}
    for layer in LAYERS:
        folder = os.path.join(dst, layer)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            stem, ext = os.path.splitext(name)
            if ext == ".webp" and stem.endswith("-aux") and stem[:-4].isdigit():
                im = Image.open(os.path.join(folder, name))
                im.load()
                div, quality = AUX_MD
                small = im.resize((im.width // div, im.height // div), Image.LANCZOS)
                small.save(os.path.join(folder, f"{stem}-md.webp"), "WEBP", quality=quality, method=6)
                sizes["md"] = sizes.get("md", 0) + os.path.getsize(os.path.join(folder, f"{stem}-md.webp"))
                continue
            if ext != ".webp" or not stem.isdigit():
                continue
            im = Image.open(os.path.join(folder, name))
            im.load()
            for suffix, (div, quality, alpha) in TILE_TIERS.items():
                # RGBA 缩小时 Pillow 先预乘透明度再缩，边上不会出一圈黑边
                small = im.resize((im.width // div, im.height // div), Image.LANCZOS)
                sizes[suffix] = sizes.get(suffix, 0) + save(small, os.path.join(folder, f"{stem}-{suffix}.webp"), quality, alpha)
    for sprite in SPRITES:
        src = os.path.join(dst, f"{sprite}.webp")
        if not os.path.exists(src):
            continue
        im = Image.open(src)
        im.load()
        small = im.resize((round(im.width * SPRITE_SCALE), round(im.height * SPRITE_SCALE)), Image.LANCZOS)
        sizes["md"] = sizes.get("md", 0) + save(small, os.path.join(dst, f"{sprite}-md.webp"), *SPRITE_QUALITY)
    manifest_file = os.path.join(dst, "manifest.json")
    if sizes and os.path.exists(manifest_file):
        with open(manifest_file, encoding="utf-8") as fh:
            manifest = json.load(fh)
        manifest["preview"] = {"scale": 1 / TILE_TIERS["lo"][0]}
        manifest["half"] = {"scale": 1 / TILE_TIERS["md"][0], "sprites": SPRITE_SCALE}
        with open(manifest_file, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
    return sizes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="src/assets/reef")
    args = ap.parse_args()
    sizes = make(args.dir)
    print("小图：" + "，".join(f"{k} {v / 1e6:.2f} MB" for k, v in sizes.items()))


if __name__ == "__main__":
    main()
