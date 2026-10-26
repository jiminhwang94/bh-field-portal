"""가이드 (v3.28 C-1) — 로봇 → 종류 → 목록 → 한눈에 보는 상세. 메뉴 차례 · 홈 우선순위.

같은 오류 코드라도 로봇(Gen.1 · Gen.2 · Zephyr …)마다 절차가 다르다. 그래서 가이드는
로봇을 먼저 고르고, 그 안에서 오류 코드 · 하드웨어 · SW 를 고른다. 로봇은 앱에서
추가 · 이름 바꾸기 · 삭제한다. 다음 회차에 되돌아가지 않도록 묶어 둔다.

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


guides = (read("web", "js", "views", "guides.js") + "\n" + read("web", "js", "views", "guide-page.js"))
app = read("web", "js", "app.js")
index = read("web", "index.html")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from webcss import all_css, all_store as _all_store  # noqa: E402  (스타일 5개 파일을 차례대로)
css = all_css()
store = _all_store()

print("== 왼쪽 메뉴 — 하는 일의 차례")
order = ["home", "new", "reports", "guides", "driving", "inventory", "settings"]
at = [index.find('data-tab="%s"' % t) for t in order]
check("홈 · 새 리포트 · 리포트 이력 · 가이드 · 운행일지 · 차량 재고 · (설정)",
      all(a >= 0 for a in at) and at == sorted(at), str(at))
check("메뉴에 글자가 붙어 있다", index.count('class="tab__label"') == len(order))
check("[차량 재고] 옆에 보충 필요 숫자 자리가 있다", 'id="invBadge"' in index
      and "async function paintNavBadge()" in app)
check("가이드 화면에서는 메뉴의 [가이드] 가 켜진다",
      "path.startsWith('/guides') ? 'guides'" in app)

print()
print("== 로봇 고르기 (가이드 탭)")
check("주소가 있다", "[/^\\/guides$/, () => guideHubView(view)]" in app)
check("로봇 화면 주소 (종류는 생략 가능)", "guideModelView(view, decodeURIComponent(m[1]), m[2] || null)" in app)
check("로봇 띠 · 로봇 추가 · 관리(이름 바꾸기 · 삭제)",
      "rband__main" in guides and "data-act=\"add-model\"" in guides
      and "data-act=\"model-menu\"" in guides and "api.renameGuideModel(" in guides
      and "api.deleteGuideModel(" in guides)
check("로봇이 없는 예전 가이드도 잃지 않는다 ('로봇 미지정')",
      "const NONE_LABEL = '로봇 미지정';" in guides and "const unassigned = all.filter((g) => modelKey(g) === NONE).length;" in guides
      and 'class="rband rband--none"' in guides)
check("예전 가이드에 로봇을 한 번에 지정한다",
      "[/^\/guides\/assign$/, () => guideAssignView(view)]" in app
      and "export async function guideAssignView(view)" in guides and "api.assignGuideModel(" in guides
      and "export async function assignGuideModel(ids, model)" in store)
check("기본 로봇 셋", "export const DEFAULT_GUIDE_MODELS = ['Gen.1', 'Gen.2', 'Zephyr'];" in store)
check("로봇을 지워도 가이드는 지우지 않는다", "robotModel: ''" in store and "export async function deleteGuideModel(" in store)

print()
print("== 로봇 하나 — 종류 셋 + 목록")
check("종류 셋이 큰 버튼으로", "class=\"guide-cat" in guides and "CAT_ORDER.map((t)" in guides)
check("고른 종류는 기억한다", "localStorage.setItem(LAST_CAT_KEY, type);" in guides)
check("목록 칸이 스크롤 영역이다", '<div class="rows scroll" id="gList">' in guides)
check("검색은 목록만 다시 그린다 (커서를 지킨다)",
      "box.addEventListener('input', () => { query = box.value; paint(); });" in guides)
check("작성은 지금 보는 종류 · 로봇으로 열린다",
      "const newHref = `#/guides/new/${type}${key === NONE ? '' : `?model=${encodeURIComponent(key)}`}`;" in guides)
check("작성 폼에서 로봇을 고른다", "data-act=\"pick-model\"" in guides and "robotModel: state.robotModel," in guides)

print()
print("== 상세 — 한눈에")
check("위치(로봇 › 종류)가 보인다", 'class="gd-crumb"' in guides)
check("진행률 막대가 단계 체크를 따라간다", 'id="gdBar"' in guides and "paintProgress();" in guides)
check("단계 · 공구 · 명령어를 한 화면에", "gd-steps" in guides and "gd-side" in guides
      and ".gd-body { display: grid; grid-template-columns: minmax(0, 1fr) 320px;" in css)
check("단계는 줄 전체가 버튼이다 (장갑)", 'data-act="toggle-step" type="button"' in guides)

print()
print("== 홈 — 우선순위 차례 (v3.35 세 개의 문)")
i_new, i_hist, i_guide = app.find('class="door door--new"'), app.find('class="door door--hist"'), app.find('class="door door--guide"')
i_more = app.find('class="home3__more"')
check("새 리포트 → 이력 → 가이드 → (운행일지 · 재고) 차례", 0 < i_new < i_hist < i_guide < i_more, str((i_new, i_hist, i_guide, i_more)))
check("임시보관한 리포트는 홈에서 바로 이어 쓴다", "#/report/new?draft=${h(draft.id)}" in app)
check("가이드 문에서 로봇으로 바로 간다", 'class="door__robot" href="${modelHref(m)}"' in app)
check("홈에 가이드 작성 버튼이 없다", 'href="#/guides/new">' not in app)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 가이드는 로봇 → 종류 → 목록, 홈은 우선순위 차례입니다.")
