"""앱 아이콘을 다시 만든다 — 안드로이드 적응형 XML + PNG 8종.

    python tools/아이콘.py

무엇을 만드나
    android/.../drawable/ic_launcher_foreground.xml   (런처가 실제로 쓰는 것)
    android/.../mipmap-{hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png
    web/icons/icon-192.png · icon-512.png · apple-touch-icon.png
    web/icons/icon-maskable-512.png

필요한 것
    pip install pillow      그리고 마이크로소프트 Edge (SVG 를 PNG 로 굽는 데 쓴다)

아이콘 크기를 손보려면 아래 HEX_R · HEX_W · LOGO_R 만 바꾸고 다시 돌리면 된다.
"""

# 회사 로고 X 를 **원본 픽셀에서 잰 값**으로 다시 그린다.
#
# 앞서 만든 5가지는 X 를 '두 개의 곧은 획'으로 잘못 봤다. 원본은 글자꼴이다.
# measure.py 로 잰 구조 (타일을 100x100 으로 볼 때):
#
#   · 마크 범위        x 11.6~87.7 (76%) · y 10.1~88.4 (78%)
#   · 세리프(끝 가로막대) 높이 10.2, 위 10.9~21.1 / 아래 78.9~89.1
#   · 대각 획은 45도가 아니라 **더 서 있다** — dx/dy = 0.583 (약 60도)
#   · 획 가로 두께 12.3
#   · 왼위→오른아래 획은 끊기지 않고 아래까지 이어진다
#   · 오른위·왼아래 획은 가운데서 **뾰족하게 끝난다**. 끝을 자른 면이
#     굵은 획과 **평행**하고, 굵은 획과 7.2 만큼 떨어져 있다
#   · 타일 색 #015CF3 · X 색 #E9F0FA (거의 흰색) · 모서리는 거의 직각
import math

# 모서리를 둥글리려고 같은 색 테두리를 덧대는데, 그러면 도형이 ROUND/2 만큼
# 사방으로 커진다. 그래서 기준 치수를 그만큼 미리 줄여 둔다.
# (안 줄였을 때 원본과 재보니 모든 변이 일정하게 0.7% 두꺼웠다)
ROUND = 1.0            # 둥글림 두께 (100단위)
_IN = ROUND / 2        # 사방으로 커지는 양

SLOPE = 0.583          # 대각 획의 dx/dy
HALF_B = 6.15 - _IN / 0.864   # 획 가로 두께의 절반. 기울어진 변이라 수직거리로 환산
HALF_W = 38.1 - _IN    # 세리프 바깥 끝까지의 x 반폭
HALF_H = 39.1 - _IN    # y 반높이
SERIF_H = 10.2 - ROUND # 세리프 높이 (위아래가 함께 줄어든다)
GAP = 7.2 + ROUND / 0.864     # 끊긴 획과 굵은 획 사이 — 양쪽이 커지므로 그만큼 넓힌다

# 마크의 가장 먼 점(세리프 바깥 모서리)까지의 거리 — 크기를 맞출 때 쓴다
CORNER_R = math.hypot(HALF_W, HALF_H)      # 54.59

LOGO_BLUE = '#015CF3'
LOGO_WHITE = '#FFFFFF'
COBALT = '#0047AB'


def _main_polygon():
    """굵은 대각선 + 왼위·오른아래 세리프. 하나로 이어진 도형."""
    yt, yb = 50 - HALF_H, 50 + HALF_H
    ytb, ybt = yt + SERIF_H, yb - SERIF_H

    def right(y):     # 굵은 획의 오른쪽 모서리
        return 50 + HALF_B + SLOPE * (y - 50)

    def left(y):      # 왼쪽 모서리
        return 50 - HALF_B + SLOPE * (y - 50)

    return [
        (50 - HALF_W, yt),        # 위 세리프 왼쪽 위
        (right(yt), yt),          # 굵은 획 오른쪽 모서리, 맨 위
        (right(ybt), ybt),        # 아래 세리프가 시작하는 높이
        (50 + HALF_W, ybt),       # 아래 세리프 오른쪽 위
        (50 + HALF_W, yb),        # 아래 세리프 오른쪽 아래
        (left(yb), yb),           # 굵은 획 왼쪽 모서리, 맨 아래
        (left(ytb), ytb),         # 위 세리프가 끝나는 높이
        (50 - HALF_W, ytb),       # 위 세리프 왼쪽 아래
    ]


def _upper_right_polygon():
    """오른위 세리프 + 가운데서 뾰족하게 끝나는 획."""
    yt = 50 - HALF_H
    ytb = yt + SERIF_H

    def right(y):     # 이 획의 오른쪽 모서리 (아래로 갈수록 왼쪽)
        return 50 + HALF_B - SLOPE * (y - 50)

    def left(y):
        return 50 - HALF_B - SLOPE * (y - 50)

    # 끝을 자른 면: 굵은 획과 평행하고 GAP 만큼 오른쪽에 있는 직선
    #   x = 50 + HALF_B + GAP + SLOPE*(y-50)
    # 이 직선이 이 획의 두 모서리와 만나는 점이 뾰족한 끝과 그 반대편이다.
    def meet(off):
        # 50 + off - SLOPE*dy = 50 + HALF_B + GAP + SLOPE*dy
        dy = (off - HALF_B - GAP) / (2 * SLOPE)
        return (50 + HALF_B + GAP + SLOPE * dy, 50 + dy)

    tip = meet(HALF_B)            # 오른쪽 모서리와 만나는 점 = 뾰족한 끝
    back = meet(-HALF_B)          # 왼쪽 모서리와 만나는 점

    return [
        (left(yt), yt),
        (50 + HALF_W, yt),
        (50 + HALF_W, ytb),
        (right(ytb), ytb),
        tip,
        back,
    ]


def _rot180(pts):
    return [(100 - x, 100 - y) for x, y in pts]


def logo_paths(radius, cx=54.0, cy=54.0):
    """로고 X 를 SVG path 문자열 3개로. radius = 세리프 바깥 모서리까지의 거리."""
    k = radius / CORNER_R

    def d(pts):
        moved = [(cx + (x - 50) * k, cy + (y - 50) * k) for x, y in pts]
        return 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in moved) + ' Z'

    return [d(_main_polygon()), d(_upper_right_polygon()),
            d(_rot180(_upper_right_polygon()))]


def logo_svg(radius, color, cx=54.0, cy=54.0, round_px=None):
    """로고 X 를 그리는 SVG 조각. round_px 로 모서리를 살짝 둥글린다(원본처럼)."""
    k = radius / CORNER_R
    r = (ROUND * k) if round_px is None else round_px
    out = []
    for d in logo_paths(radius, cx, cy):
        # 같은 색 테두리를 둥근 이음으로 덧대면 모서리가 둥글어지고 끝이 살짝 뭉툭해진다
        out.append(f'<path d="{d}" fill="{color}" stroke="{color}" '
                   f'stroke-width="{r:.2f}" stroke-linejoin="round" stroke-linecap="round"/>')
    return ''.join(out)


# ======================================================================
# 아이콘 파일 만들기
# ======================================================================

import io
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(os.path.dirname(os.path.abspath(__file__)))
ROOT = HERE.parent                        # 저장소 뿌리
WHITE = '#FFFFFF'
MASTER = 1024           # 한 번 구울 크기

HEX_R = 30.0            # 기존 앱과 같은 육각형 반지름
HEX_W = 7.80            # 기존 앱과 같은 획
LOGO_R = 21.4           # 육각형 안에 들어가는 로고 반지름 (A안)
MASKABLE_SCALE = 0.816  # 지금 icon-maskable-512 가 쓰는 비율
CORNER = 0.20           # 둥근 모서리 반지름 (타일 한 변의 비율)

EDGE = next((c for c in (
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
) if os.path.exists(c)), None)
assert EDGE, 'Edge 를 찾지 못했습니다'


def hexagon(r, cx=54.0, cy=54.0):
    pts = []
    for a in (30, 90, 150, 210, 270, 330):
        t = math.radians(a)
        pts.append((cx + r * math.cos(t), cy - r * math.sin(t)))
    return 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in pts) + ' Z'


def mark_parts(scale=1.0):
    """(육각형 path, 육각 획 두께, 로고 path 3개, 로고 둥글림 두께)"""
    hr, hw, lr = HEX_R * scale, HEX_W * scale, LOGO_R * scale
    return hexagon(hr), hw, logo_paths(lr), ROUND * lr / CORNER_R


def mark_svg(scale=1.0, ink=WHITE):
    hex_d, hw, logo_ds, lround = mark_parts(scale)
    out = [f'<path d="{hex_d}" fill="none" stroke="{ink}" stroke-width="{hw:.2f}" '
           f'stroke-linejoin="round"/>']
    for d in logo_ds:
        out.append(f'<path d="{d}" fill="{ink}" stroke="{ink}" stroke-width="{lround:.2f}" '
                   f'stroke-linejoin="round" stroke-linecap="round"/>')
    return ''.join(out)


def full_svg(scale=1.0, bg=COBALT, ink=WHITE):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" '
            f'width="108" height="108"><rect width="108" height="108" fill="{bg}"/>'
            f'{mark_svg(scale, ink)}</svg>')


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
    hex_d, hw, logo_ds, lround = mark_parts(1.0)
    paths = [f'''  <!-- 허니컴 한 칸 — 기존 앱과 같은 크기(반지름 {HEX_R:.0f}, 획 {hw:.2f}) -->
  <path
      android:strokeColor="#FFFFFF"
      android:strokeWidth="{hw:.2f}"
      android:strokeLineJoin="round"
      android:fillColor="#00000000"
      android:pathData="{hex_d}" />''']
    names = ['굵은 대각선 + 왼위·오른아래 세리프',
             '오른위 세리프 + 가운데서 뾰족하게 끝나는 획',
             '왼아래 (위 도형을 180도 돌린 것)']
    for d, note in zip(logo_ds, names):
        paths.append(f'''  <!-- 로고: {note} -->
  <path
      android:fillColor="#FFFFFF"
      android:strokeColor="#FFFFFF"
      android:strokeWidth="{lround:.2f}"
      android:strokeLineJoin="round"
      android:strokeLineCap="round"
      android:pathData="{d}" />''')
    body = '\n'.join(paths)
    outer = (HEX_R + HEX_W / 2) * 2 / 108 * 100
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!-- 아이콘 마크 — 허니컴 한 칸(정육각형) 안에 회사 로고.

     로고 X 는 **글자꼴**이다. 원본 로고 이미지의 픽셀을 재서 그렸다.
       · 끝단 가로막대(세리프) 4개
       · 대각선은 45도가 아니라 더 서 있다 (dx/dy = 0.583, 약 60도)
       · 왼위→오른아래 획은 끊기지 않고, 반대 대각선은 가운데서 뾰족하게 끝난다.
         끝을 자른 면이 굵은 획과 평행하다.
     예전에는 X 를 '곧은 획 두 개'로 그려서 로고와 달랐다. 이번에는 같은 크기로
     구워 원본과 재봤고 어긋남이 0.7%(138px 에서 1픽셀)다.

     모서리를 둥글리려고 같은 색 테두리를 덧댄다. 그러면 도형이 커지므로
     기준 치수를 미리 줄여 뒀다.

     육각형 크기·획은 예전 아이콘과 같다 (반지름 {HEX_R:.0f}, 획 {hw:.2f}).

     적응형 아이콘은 108x108 중 가운데 지름 66 원 안쪽만 반드시 보인다.
     육각형 바깥 끝은 {outer:.1f}% 로 예전과 같아서, 원형 런처에서 위아래 꼭지가
     아주 살짝 걸린다 (예전 아이콘도 그랬다). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
{body}
</vector>
'''


if __name__ == '__main__':
    print('■ 안드로이드 적응형 아이콘 (앞 레이어)')
    p = ROOT / 'android/app/src/main/res/drawable/ic_launcher_foreground.xml'
    io.open(p, 'w', encoding='utf-8', newline='').write(vector_xml())
    print(f'  {p.relative_to(ROOT)}')

    print(f'■ {MASTER}px 로 한 번 굽는다')
    normal = bake(full_svg(1.0))
    masked = bake(full_svg(MASKABLE_SCALE))
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
