"""앱 아이콘을 다시 만든다 — 안드로이드 적응형 XML + PNG 8종.

    python tools/아이콘.py

무엇을 만드나
    android/.../drawable/ic_launcher_foreground.xml   (런처가 실제로 쓰는 것)
    android/.../mipmap-{hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png
    web/icons/icon-192.png · icon-512.png · apple-touch-icon.png
    web/icons/icon-maskable-512.png

필요한 것
    pip install pillow fonttools      그리고 마이크로소프트 Edge (SVG 를 PNG 로 굽는 데 쓴다)
    글꼴 Pretendard ExtraBold (C:/Windows/Fonts/Pretendard-ExtraBold.ttf) — 앱이 쓰는 글꼴

아이콘 = 앱 안 왼쪽 위 'BH' 마크 (v3.38)
    앱 안 마크(css/focus.css .tabbar__logo)와 **같은 모양**으로 맞춘다:
      · 바탕 코발트 #0047AB (디자인 토큰 --color-accent) · 글자 흰색
      · 글꼴 Pretendard 800(ExtraBold) · 자간 0.02em
      · 타일 38 에 글자 14 → 글자 크기 = 타일의 36.8% · 모서리 10/38 = 26%
    글자는 글꼴의 **윤곽선을 그대로 path 로** 옮긴다 (안드로이드 벡터에는 글꼴을 쓸 수 없다).
    예전 아이콘(허니컴 육각형 + 회사 로고 X)은 git 기록에 있다 (v3.37 까지).
"""
import io
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = Path(os.path.dirname(os.path.abspath(__file__)))
ROOT = HERE.parent                        # 저장소 뿌리
COBALT = '#0047AB'
WHITE = '#FFFFFF'
MASTER = 1024           # 한 번 구울 크기

TEXT = 'BH'
FONT = Path(r'C:\Windows\Fonts\Pretendard-ExtraBold.ttf')
TEXT_RATIO = 14 / 38    # 앱 안 마크: 타일 38px 에 글자 14px
TRACKING = 0.02         # 자간 (em)
CORNER = 10 / 38        # 앱 안 마크의 모서리 (border-radius 10px / 38px)
SAFE = 72               # 적응형 아이콘에서 보이는 타일 한 변 (108 중 가운데 72)
MASKABLE_SCALE = 0.816  # 웹 maskable — 둘레가 잘려도 글자가 남게

EDGE = next((c for c in (
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
) if os.path.exists(c)), None)
assert EDGE, 'Edge 를 찾지 못했습니다'
assert FONT.exists(), f'글꼴이 없습니다: {FONT}'


def text_path(tile, cx=54.0, cy=54.0):
    """'BH' 의 윤곽선을 108 좌표의 path 하나로. tile = 마크가 앉는 타일 한 변."""
    font = TTFont(str(FONT))
    upm = font['head'].unitsPerEm
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    size = tile * TEXT_RATIO                 # 글자 크기 (108 단위)
    k = size / upm
    # 먼저 글꼴 단위로 늘어놓고 잉크가 차지하는 상자를 잰다 (가운데 맞춤은 실제 잉크로)
    x = 0.0
    placed = []
    for ch in TEXT:
        name = cmap[ord(ch)]
        placed.append((name, x))
        x += glyphs[name].width + TRACKING * upm
    bounds = BoundsPen(glyphs)
    for name, gx in placed:
        glyphs[name].draw(TransformPen(bounds, (1, 0, 0, 1, gx, 0)))
    x0, y0, x1, y1 = bounds.bounds
    # 글꼴은 y 가 위로 커진다 → 뒤집고, 잉크 상자의 가운데를 (cx, cy) 에
    dx = cx - (x0 + x1) / 2 * k
    dy = cy + (y0 + y1) / 2 * k
    pen = SVGPathPen(glyphs, ntos=lambda v: f'{v:.2f}'.rstrip('0').rstrip('.'))
    for name, gx in placed:
        glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, dx + gx * k, dy)))
    return pen.getCommands()


def full_svg(tile):
    """108 viewBox 를 꽉 채운 코발트 바탕 + 가운데 BH. tile 이 클수록 글자가 커진다."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" '
            f'width="108" height="108"><rect width="108" height="108" fill="{COBALT}"/>'
            f'<path d="{text_path(tile)}" fill="{WHITE}"/></svg>')


def bake(svg_text):
    """SVG 를 MASTER x MASTER 불투명 PNG 로 한 번 굽는다."""
    page = ('<!doctype html><meta charset="utf-8">'
            '<style>html,body{margin:0;padding:0;overflow:hidden}'
            'svg{display:block;width:100vw;height:100vh}</style>' + svg_text)
    html = HERE / '_tmp.html'
    png = HERE / '_tmp.png'
    io.open(html, 'w', encoding='utf-8').write(page)
    png.unlink(missing_ok=True)
    prof = HERE / '_edge'
    shutil.rmtree(prof, ignore_errors=True)
    subprocess.run([
        EDGE, '--headless=new', f'--user-data-dir={prof}', '--no-first-run',
        '--disable-gpu', '--hide-scrollbars',
        f'--screenshot={png}', f'--window-size={MASTER},{MASTER}', html.as_uri(),
    ], check=True, timeout=180, capture_output=True)
    im = Image.open(png).convert('RGBA')
    assert im.size == (MASTER, MASTER), f'구운 크기가 {im.size} 입니다 (기대 {MASTER})'
    return im


def save_size(master, size, out_path, corner_pct=None):
    """구운 그림을 원하는 크기로 줄여 저장한다. corner_pct 면 모서리를 투명하게 깎는다."""
    im = master.copy()
    if corner_pct:
        r = int(MASTER * corner_pct)
        mask = Image.new('L', im.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, MASTER - 1, MASTER - 1],
                                               radius=r, fill=255)
        im.putalpha(mask)
    im = im.resize((size, size), Image.LANCZOS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    im.save(out_path)
    print(f'  {out_path.relative_to(ROOT)}  {size}x{size}'
          + ('  (모서리 둥금)' if corner_pct else ''))


def vector_xml():
    d = text_path(SAFE)
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!-- 아이콘 마크 — 앱 안 왼쪽 위 'BH' 와 같은 모양 (v3.38, tools/아이콘.py 가 만든다).

     글꼴 Pretendard 800 · 자간 0.02em 의 윤곽선을 그대로 옮겼다
     (안드로이드 벡터에는 글꼴을 쓸 수 없다). 바탕은 ic_launcher_background 의 코발트.

     적응형 아이콘은 108x108 중 가운데 {SAFE} 이 보이는 타일이다. 앱 안 마크처럼
     글자 크기를 그 타일의 {TEXT_RATIO * 100:.1f}% 로 잡았다. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
  <path
      android:fillColor="#FFFFFF"
      android:pathData="{d}" />
</vector>
'''


if __name__ == '__main__':
    print('■ 안드로이드 적응형 아이콘 (앞 레이어)')
    p = ROOT / 'android/app/src/main/res/drawable/ic_launcher_foreground.xml'
    io.open(p, 'w', encoding='utf-8', newline='').write(vector_xml())
    print(f'  {p.relative_to(ROOT)}')

    print(f'■ {MASTER}px 로 한 번 굽는다')
    normal = bake(full_svg(108))                      # 108 전체가 타일 (예전 런처 · 웹)
    masked = bake(full_svg(108 * MASKABLE_SCALE))     # 둘레가 잘려도 되게 글자를 조금 작게
    print('  완료')

    print('■ 런처 PNG (예전 안드로이드용)')
    for dpi, size in (('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        save_size(normal, size,
                  ROOT / f'android/app/src/main/res/mipmap-{dpi}/ic_launcher.png',
                  corner_pct=CORNER)

    print('■ 웹 아이콘')
    save_size(normal, 192, ROOT / 'web/icons/icon-192.png', corner_pct=CORNER)
    save_size(normal, 512, ROOT / 'web/icons/icon-512.png', corner_pct=CORNER)
    save_size(normal, 180, ROOT / 'web/icons/apple-touch-icon.png', corner_pct=CORNER)
    save_size(masked, 512, ROOT / 'web/icons/icon-maskable-512.png')   # 꽉 찬 정사각

    for f in ('_tmp.html', '_tmp.png'):
        (HERE / f).unlink(missing_ok=True)
    shutil.rmtree(HERE / '_edge', ignore_errors=True)
    print('완료')
