#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Monitor 1999 的站点图标兜底文件（hub 1.4.0 起图标由面板管，`ICON_PATHS` 认这几条路径）。

站长在面板「设置 → 站点图标」里选了图之后，这几条路径全部由 hub 回答；没设时回落到
本主题目录里的同名文件。所以主题侧只要把四份放好，「没设图标」与「设了图标」两种状态
就都正确了：

    src/favicon.svg         矢量（64 格设计稿）——标签页 / 书签图标，任何缩放都清晰
    src/favicon.ico         16/32/48 三帧多尺寸——老浏览器、书签管理器、RSS 阅读器会
                            **不看 <link> 直接来要**这条，缺了它们拿到的是回落页（HTML）
    src/apple-touch-icon.png  iOS 主屏幕图标：180×180、**不透明**（iOS 会把透明的填黑）
    src/apple-touch-icon-precomposed.png  与前者同一份字节（老 iOS 的老路径）

设计照主题本身：强调色黄底（#FFE600）+ 黑色粗边框 + 居中黑菱形（页头那枚 ◆ 的同一语汇）。
SVG 与位图共用下面这一组几何常量（64 格坐标），改图标就改常量并重跑。

跑法：uv run --with pillow python scripts/make_icons.py [--check]
    --check 只比对不写盘（验证仓库里的四份产物确实由当前常量生成）。
"""
import io
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
SVG = os.path.join(ROOT, "src", "favicon.svg")
ICO = os.path.join(ROOT, "src", "favicon.ico")
TOUCH = os.path.join(ROOT, "src", "apple-touch-icon.png")
PRECOMPOSED = os.path.join(ROOT, "src", "apple-touch-icon-precomposed.png")

# ——— 几何常量（64 格设计稿；位图按边长等比换算） ———
SIZE = 64
BORDER = 6                                  # 粗边框的粗细（格）
DIAMOND = [(32, 10), (54, 32), (32, 54), (10, 32)]  # 居中菱形
YELLOW = "#FFE600"
BLACK = "#000000"

TOUCH_PX = 180
FAVICON_ICO_SIZES = [(16, 16), (32, 32), (48, 48)]
SUPERSAMPLE = 4                             # 位图先按 4 倍画再缩，免得斜边全是锯齿


def favicon_svg() -> str:
    d = "M" + " ".join("%d %d" % (x, y) for x, y in DIAMOND) + "Z"
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
        '  <!-- Monitor 1999 的主题图标：强调色黄底 + 黑色粗边框 + 居中菱形（页头 ◆ 的同一语汇）。\n'
        '       站长在「设置 → 站点图标」里设了图之后这几条路径由 hub 回答；清掉设置即回到这里。\n'
        '       由 scripts/make_icons.py 生成，位图版本（.ico / apple-touch-icon）与它同一组常量。 -->\n'
        '  <rect width="64" height="64" fill="%s"/>\n'
        '  <rect x="3" y="3" width="58" height="58" fill="none" stroke="%s" stroke-width="%d"/>\n'
        '  <path d="%s" fill="%s"/>\n'
        '</svg>\n'
    ) % (YELLOW, BLACK, BORDER, d, BLACK)


def render(size: int) -> Image.Image:
    """按几何常量画一张 size×size 的位图（内部 4 倍超采样，斜边更顺）。"""
    big = size * SUPERSAMPLE
    img = Image.new("RGB", (big, big), YELLOW)
    draw = ImageDraw.Draw(img)
    scale = big / SIZE
    # 边框：先整块铺黑、再盖上内部黄块 —— 一圈均匀的粗边（与 SVG 的 stroke 等价）
    edge = max(1, round(BORDER * scale))
    draw.rectangle([0, 0, big - 1, big - 1], fill=BLACK)
    draw.rectangle([edge, edge, big - 1 - edge, big - 1 - edge], fill=YELLOW)
    draw.polygon([(round(x * scale), round(y * scale)) for x, y in DIAMOND], fill=BLACK)
    return img.resize((size, size), Image.LANCZOS)


def ico_bytes() -> bytes:
    out = io.BytesIO()
    render(64).save(out, "ICO", sizes=FAVICON_ICO_SIZES, bitmap_format="png")
    return out.getvalue()


def touch_bytes() -> bytes:
    out = io.BytesIO()
    render(TOUCH_PX).save(out, "PNG", optimize=True)
    return out.getvalue()


def main() -> int:
    check = "--check" in sys.argv
    svg = favicon_svg().encode("utf-8")
    ico = ico_bytes()
    touch = touch_bytes()
    products = [(SVG, svg), (ICO, ico), (TOUCH, touch), (PRECOMPOSED, touch)]
    if check:
        ok = True
        for path, want in products:
            have = open(path, "rb").read() if os.path.exists(path) else b""
            if have != want:
                print("★ %s 与当前常量不一致（跑一次不带 --check 的）" % os.path.relpath(path, ROOT))
                ok = False
        print("图标产物与脚本常量一致" if ok else "图标产物需要重新生成")
        return 0 if ok else 1
    open(SVG, "wb").write(svg)
    open(ICO, "wb").write(ico)
    open(TOUCH, "wb").write(touch)
    open(PRECOMPOSED, "wb").write(touch)
    print("src/favicon.svg                   %d B（矢量）" % len(svg))
    print("src/favicon.ico                   %d B（16/32/48 三帧）" % len(ico))
    print("src/apple-touch-icon.png          %d B（%d×%d，不透明）" % (len(touch), TOUCH_PX, TOUCH_PX))
    print("src/apple-touch-icon-precomposed.png  与前者同字节")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
