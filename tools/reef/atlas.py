# 把序列帧拼成页面用的图集（带透明的 WebP，一格一帧，从左到右、从上到下）。
#
#   鱼（tools/reef/fish.py 渲的两套，各 24 帧，6 列 4 行）：
#     python -I tools/reef/atlas.py --from .shots/reef/fish24 --to src/assets/reef/fish
#   水母（tools/reef/jelly.py 渲的一套，16 帧，4 列 4 行）：
#     python -I tools/reef/atlas.py --jelly --from .shots/reef/jelly --to src/assets/reef
#
# 帧的大小、列数要和 encode.py 写进清单的 fish、jelly 两项对上。
import argparse
import os

from PIL import Image


def sheet(frames_dir, count, cols, out):
    first = Image.open(os.path.join(frames_dir, "f00.png"))
    w, h = first.size
    rows = (count + cols - 1) // cols
    img = Image.new("RGBA", (w * cols, h * rows), (0, 0, 0, 0))
    for f in range(count):
        im = Image.open(os.path.join(frames_dir, f"f{f:02d}.png")).convert("RGBA")
        img.paste(im, ((f % cols) * w, (f // cols) * h))
    img.save(out, "WEBP", quality=86, method=6, alpha_quality=90)
    print(f"{out}：{os.path.getsize(out) / 1e3:.0f} KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", default=".shots/reef/fish24")
    ap.add_argument("--to", dest="dst", default="src/assets/reef/fish")
    ap.add_argument("--jelly", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.dst, exist_ok=True)
    if args.jelly:
        sheet(args.src, 16, 4, os.path.join(args.dst, "jelly.webp"))
        return
    for act in ("idle", "swim"):
        sheet(os.path.join(args.src, act), 24, 6, os.path.join(args.dst, f"{act}.webp"))


main()
