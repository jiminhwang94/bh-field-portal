"""가이드 (v3.28 C-1) — 로봇 → 종류 → 목록 → 한눈에 보는 상세. 메뉴 차례 · 홈 우선순위.

같은 오류 코드라도 로봇(Gen.1 · Gen.2 · Zephyr …)마다 절차가 다르다. 그래서 가이드는
로봇을 먼저 고르고, 그 안에서 오류 코드 · 하드웨어 · SW 를 고른다. 로봇은 앱에서
추가 · 이름 바꾸기 · 삭제한다. 다음 회차에 되돌아가지 않도록 묶어 둔다.

(43) 파일 이름 · 줄 모양에 묶이지 않는다 (tests/_src.py). 주소 · 로봇 미지정 띠 · 한 번에
지정 · 로봇별 항목 · 고른 항목 기억 · 작성 주소 · 위치 줄 · 홈 세 문의 차례 · 이어 쓰기는
e2e(v335 · v340 · guide-inventory) 가 실제로 눌러 본다. 여기는 그 밖의 것만.

실행: python tests/test_guide_hub.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _src import HTML, body, css_has, defines, has, has_re, module_of, module_with  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


hub = module_of("guideHubView")            # 로봇 고르기 · 로봇 화면
page = module_of("guideDetailView")        # 상세 · 작성
check("가이드 화면 모듈이 있다", bool(hub) and bool(page))

print("== 왼쪽 메뉴 — 하는 일의 차례")
order = ["home", "new", "reports", "guides", "driving", "inventory", "settings"]
at = [HTML.find('data-tab="%s"' % t) for t in order]
check("홈 · 새 리포트 · 리포트 이력 · 가이드 · 운행일지 · 차량 재고 · (설정)",
      all(a >= 0 for a in at) and at == sorted(at), str(at))
check("메뉴에 글자가 붙어 있다", HTML.count('class="tab__label"') == len(order))
check("[차량 재고] 옆에 보충 필요 숫자 자리가 있다", has('id="invBadge"', "html") and defines("paintNavBadge"))
check("가이드 화면에서는 메뉴의 [가이드] 가 켜진다", has_re(r"startsWith\(\s*'/guides'\s*\)\s*\?\s*'guides'"))

print()
print("== 로봇 고르기 (가이드 탭)")
check("로봇 띠 · 로봇 추가 · 관리(이름 바꾸기 · 삭제)",
      has("rband__main") and has('data-act="add-model"') and has('data-act="model-menu"')
      and has_re(r"api\.renameGuideModel\(") and has_re(r"api\.deleteGuideModel\("))
check("기본 로봇 셋", has("DEFAULT_GUIDE_MODELS = ['Gen.1', 'Gen.2', 'Zephyr']"))
check("로봇을 지워도 가이드는 지우지 않는다 (로봇 칸만 비운다)",
      has_re(r"robotModel\s*:\s*''", body("deleteGuideModel")))

print()
print("== 로봇 하나 — 로봇별 항목 + 목록 (항목 만들기 · 고른 것 기억 · 작성 주소는 e2e v340)")
check("목록 칸이 스크롤 영역이다", has_re(r'<div(?=[^>]*class="rows scroll")[^>]*id="gList"'))
check("검색은 목록만 다시 그린다 (커서를 지킨다)",
      has_re(r"addEventListener\(\s*'input'\s*,\s*\(\)\s*=>\s*\{\s*\w+\s*=\s*\w+\.value\s*;\s*paint\(\)", hub))
check("작성 폼에서 로봇을 고른다",
      has('data-act="pick-model"') and has_re(r"robotModel\s*:\s*\w+\.robotModel"))

print()
print("== 상세 — 한눈에")
check("진행률 막대가 단계 체크를 따라간다", has('id="gdBar"') and has_re(r"paintProgress\(\)"))
check("단계 · 공구 · 명령어를 한 화면에", has("gd-steps") and has("gd-side")
      and css_has(".gd-body", "display", r"^grid$")
      and css_has(".gd-body", "grid-template-columns", r"minmax\(0,\s*1fr\)\s+320px"))
check("단계는 줄 전체가 버튼이다 (장갑)",
      has_re(r'<button(?=[^>]*data-act="toggle-step")[^>]*type="button"|data-act="toggle-step"\s+type="button"'))

print()
print("== 홈 — 우선순위 차례 (세 문의 차례 · 이어 쓰기는 e2e v335)")
home = module_with('class="door door--new"')     # 홈 화면을 그리는 곳
check("가이드 문에서 로봇으로 바로 간다", has_re(r'class="door__robot"\s+href="\$\{modelHref\('))
check("홈에 가이드 작성 버튼이 없다", bool(home) and 'href="#/guides/new' not in home)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 가이드는 로봇 → 종류 → 목록, 홈은 우선순위 차례입니다.")
