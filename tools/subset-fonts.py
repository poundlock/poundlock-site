"""把 IBM Plex 的原始字体裁成网页用的子集。

用法：python tools/subset-fonts.py <放原始 woff2 的目录>

原始文件从 npm 的这几个包里取（fonts/complete/woff2/ 下）：
  @ibm/plex-sans@2.0.0            IBMPlexSans-Regular.woff2、IBMPlexSans-SemiBold.woff2
  @ibm/plex-sans-condensed@3.0.0  IBMPlexSansCondensed-SemiBold.woff2
  @ibm/plex-mono@2.5.0            IBMPlexMono-Regular.woff2
  @ibm/plex-sans-sc@1.1.0         hinted/IBMPlexSansSC-Text.woff2、hinted/IBMPlexSansSC-SemiBold.woff2

中文两款按 src/copy/zh.json 和 hero-demo.json（首屏演示）里实际用到的字裁；用到了哪些字写进 src/assets/fonts/zh-chars.txt，
tests/tokens.test.js 拿它核文案有没有超出子集。文案改了就重新跑一遍这个脚本。
要 fonttools 和 brotli（pip install fonttools brotli）。
"""

import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "assets" / "fonts"

# 西文：基本拉丁、Latin-1，加上几个排版用的标点。
LATIN = "U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026"
# 窄体只用来排数字和阶段编号。
DIGITS = "U+0020-007E"


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


# 首屏演示里终端的字（中英两页都是中文）也用这两款字体
ZH_SOURCES = ("zh.json", "hero-demo.json")


def zh_chars():
    chars = set()
    for name in ZH_SOURCES:
        copy = json.loads((ROOT / "src" / "copy" / name).read_text(encoding="utf-8"))
        chars |= {ch for text in strings(copy) for ch in text if ord(ch) > 0x7F}
    return "".join(sorted(chars))


def cut(source, target, *, unicodes=None, text=None):
    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.desubroutinize = True
    options.layout_features = ["*"]
    options.name_IDs = [1, 2, 4, 6]
    options.notdef_outline = True
    font = TTFont(source)
    subsetter = subset.Subsetter(options)
    if unicodes:
        subsetter.populate(unicodes=subset.parse_unicodes(unicodes))
    else:
        subsetter.populate(text=text)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(target)
    print(f"{target.name}: {target.stat().st_size} 字节")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)

    cut(src / "IBMPlexSans-Regular.woff2", OUT / "plex-sans-400.woff2", unicodes=LATIN)
    cut(src / "IBMPlexSans-SemiBold.woff2", OUT / "plex-sans-600.woff2", unicodes=LATIN)
    cut(src / "IBMPlexSansCondensed-SemiBold.woff2", OUT / "plex-condensed-600.woff2", unicodes=DIGITS)
    cut(src / "IBMPlexMono-Regular.woff2", OUT / "plex-mono-400.woff2", unicodes=LATIN)

    chars = zh_chars()
    (OUT / "zh-chars.txt").write_text(chars, encoding="utf-8", newline="")
    cut(src / "IBMPlexSansSC-Text.woff2", OUT / "plex-sc-450.woff2", text=chars)
    cut(src / "IBMPlexSansSC-SemiBold.woff2", OUT / "plex-sc-600.woff2", text=chars)
    print(f"中文子集 {len(chars)} 个字")


if __name__ == "__main__":
    main()
