# -*- coding: utf-8 -*-
"""アプリアイコン生成（Pillow使用）
使い方: python3 tools/make_icons.py
1024pxで描画して 180/192/512 に縮小し icons/ に保存する。
※ iOSはホーム画面追加時のアイコンをキャッシュするため、
   デザイン変更しても既存の追加済みアイコンは変わらない。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent.parent
OUT = BASE / "icons"
OUT.mkdir(exist_ok=True)

S = 1024
GREEN = (22, 163, 74)
GREEN_DARK = (18, 130, 60)
WHITE = (255, 255, 255)
ORANGE = (245, 158, 11)

FONT_CANDIDATES = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Osaka.ttf",
]


def load_font(size):
    for p in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return None


img = Image.new("RGB", (S, S), GREEN)
d = ImageDraw.Draw(img)

# 下半分をわずかに暗くして立体感
d.rectangle([0, S // 2, S, S], fill=GREEN_DARK)
d.rounded_rectangle([0, 0, S, S], radius=0, outline=None)

# 白いフラッシュカード
card = [132, 200, 892, 800]
d.rounded_rectangle(card, radius=72, fill=WHITE)

# カードに「英」
font = load_font(400)
text = "英"
if font is not None:
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    cx = (card[0] + card[2]) / 2 - tw / 2 - bbox[0]
    cy = (card[1] + card[3]) / 2 - th / 2 - bbox[1] - 20
    d.text((cx, cy), text, font=font, fill=GREEN)
else:
    # フォントが無い環境: カードに緑の丸
    d.ellipse([362, 350, 662, 650], fill=GREEN)

# 進捗バー（オレンジ→緑）
d.rounded_rectangle([212, 862, 812, 918], radius=28, fill=(255, 255, 255))
d.rounded_rectangle([212, 862, 632, 918], radius=28, fill=ORANGE)

for size, name in [(180, "icon-180.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    img.resize((size, size), Image.LANCZOS).save(OUT / name, "PNG")
    print("wrote", OUT / name)
