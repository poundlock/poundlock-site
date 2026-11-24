# 给过闸的每块长条图（远景、中景、水面以上）压一张预览图：长宽各四分之一，二三十 KB。
# 页面先下它垫着，高清的下完再换上（lock-reef.js 的 ask）。国内的线路上（Cloudflare 把访客分到欧洲的节点，
# 实测 100 来 KB/s）一块高清的要好几秒，预览图一两秒就到，画面不用干等。
#
#   python -I tools/reef/preview.py [--dir src/assets/reef]
#
# 从已经压好的高清图缩出来（不用渲染的母版），写 <块>-lo.webp，再在 manifest.json 里写上 "preview"。
# encode.py 压完会调它；只想重做预览图时单独跑。要 Pillow（带 WebP）。不读写仓库以外的地方。
import argparse
import json
import os

from PIL import Image

LAYERS = ("far", "mid", "above")
# 缩小的倍数和压缩质量：1/4、质量 60 时一张平均 28 KB（三十七张共一 MB 上下）；1/3 要多一半多
SCALE = 4
QUALITY = 60


def make(dst):
    total = 0
    count = 0
    for layer in LAYERS:
        folder = os.path.join(dst, layer)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            stem, ext = os.path.splitext(name)
            if ext != ".webp" or not stem.isdigit():
                continue
            im = Image.open(os.path.join(folder, name))
            im.load()
            # RGBA 缩小时 Pillow 先预乘透明度再缩，边上不会出一圈黑边
            small = im.resize((im.width // SCALE, im.height // SCALE), Image.LANCZOS)
            out = os.path.join(folder, f"{stem}-lo.webp")
            small.save(out, "WEBP", quality=QUALITY, method=6, alpha_quality=70)
            total += os.path.getsize(out)
            count += 1
    manifest_file = os.path.join(dst, "manifest.json")
    if count and os.path.exists(manifest_file):
        with open(manifest_file, encoding="utf-8") as fh:
            manifest = json.load(fh)
        manifest["preview"] = {"scale": 1 / SCALE}
        with open(manifest_file, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
    return count, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="src/assets/reef")
    args = ap.parse_args()
    count, total = make(args.dir)
    print(f"预览图：{count} 张，共 {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
