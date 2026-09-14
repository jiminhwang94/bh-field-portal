"""가이드 탭 (B안) — 왼쪽 종류 카드 셋 · 오른쪽 스크롤 목록.

레일의 [홈] 바로 아래에 [가이드] 가 있다. 종류 카드는 색이 서로 다르고(코발트 · 주황 ·
초록), 오른쪽 목록은 제 자리에서 스크롤된다. 홈의 가이드 카드 둘과 작성 버튼은 여기로
옮겼다. 다음 회차에 되돌아가지 않도록 묶어 둔다.

실행: python tests/test_guide_hub.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


guides = read("web", "js", "views", "guides.js")
app = read("web", "js", "app.js")
index = read("web", "index.html")
css = read("web", "css", "app.css")

print("== 레일 · 주소")
check("[가이드] 탭이 [홈] 바로 아래에 있다",
      index.index('data-tab="guides"') > index.index('data-tab="home"')
      and index.index('data-tab="guides"') < index.index('data-tab="inventory"'))
check("주소가 있다", "[/^\\/guides$/, () => guideHubView(view)]" in app)
check("가이드 화면에서는 레일의 [가이드] 가 켜진다 (홈이 아니라)",
      "path.startsWith('/guides') ? 'guides'" in app
      and "path.startsWith('/guides') ? 'home'" not in app)

print()
print("== 왼쪽 종류 카드 — 색이 서로 다르다")
check("종류마다 색 토큰이 고정돼 있다",
      "ERROR_CODE: { color: 'var(--color-accent)'" in guides
      and "HARDWARE_SOP: { color: 'var(--color-warn)'" in guides
      and "SOFTWARE_CMD: { color: 'var(--color-ok)'" in guides)
check("카드가 자기 색을 들고 다닌다 (--cat)", "style=\"--cat:${c.color};--cat-tint:${c.tint}\"" in guides
      and "border-left: 6px solid var(--cat);" in css and ".cat-card.is-on { background: var(--cat-tint); border-color: var(--cat); }" in css)
check("카드에 건수와 마지막 수정이 있다", "cat-card__count" in guides and "수정` : '아직 없음'" in guides)
check("고른 종류는 기억한다", "localStorage.setItem(HUB_TYPE_KEY, type);" in guides)

print()
print("== 오른쪽 목록 — 제 자리에서 스크롤")
check("목록 칸이 스크롤 영역이다", '<div class="scroll rows" id="hubList">' in guides
      and ".guide-hub__list .scroll { flex: 1; min-height: 0; overflow-y: auto;" in css)
check("화면 뿌리가 높이를 채운다 (그래야 목록이 그 안에서 스크롤된다)",
      'id="pageRoot" style="display:flex;flex-direction:column;gap:var(--space-3);flex:1;min-height:0"' in guides
      and ".guide-hub { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: var(--space-4); flex: 1; min-height: 0; }" in css)
check("검색은 목록만 다시 그린다 (커서를 지킨다)", "function paintList()" in guides
      and "box.addEventListener('input', () => { query = box.value; paintList(); });" in guides)
check("세로로 들면 카드가 가로 한 줄로", ".guide-hub__cats { flex-direction: row; }" in css)

print()
print("== 홈에서 옮겨 온 것")
check("홈에 가이드 카드 둘이 없다", "home-split" not in app and "최근 수정된 가이드" not in app and "recentRow" not in app)
check("홈에 가이드 작성 버튼이 없다", 'href="#/guides/new">' not in app)
check("작성은 가이드 탭 오른쪽 위, 지금 보는 종류로 열린다",
      'href="#/guides/new/${type}">＋ 가이드 작성</a>' in guides)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 가이드 탭이 B안 그대로입니다.")
