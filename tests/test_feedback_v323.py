"""v3.23 — 팀 피드백 11건 + 3건에 답한 것들이 코드에 남아 있는지.

피드백을 그대로 옮기고, 항목마다 고른 방법(1-나 · 2-가 · 3-가 · 4-나 · 5-가 · 6-가 ·
7-가 · 8-가 · 9-가 · 10-가 · 11-나)이 지켜지는지 본다. 한 번 고친 것이 다음 회차에
슬그머니 되돌아가는 일이 잦아서 검사로 묶어 둔다.

(43) 파일 이름 · 줄 모양에 묶이지 않는다 (tests/_src.py) — 스타일은 선택자 · 속성으로,
화면 코드는 통째로 본다. 다른 검사 파일과 겹치던 것(연결 알림 · 영상 한도 문구 ·
자동 받기 없음 · 홈의 가이드 작성)은 그쪽 한 곳에만 둔다.

실행: python tests/test_feedback_v323.py
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _src import (ROOT, body, calls, css_decls, css_has, defines, has, has_re,  # noqa: E402
                  module_of)

fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


def px(values):
    return [int(m) for v in values for m in re.findall(r"^(\d+)px$", v.strip())]


java = io.open(os.path.join(ROOT, "android", "app", "src", "main", "java", "com", "beyondhoneycomb",
                            "fieldportal", "MainActivity.java"), encoding="utf-8").read()
fields = module_of("fieldsView")
settings = module_of("settingsView")

print("== 1-나. 홈에서 뒤로가기 두 번이면 종료")
check("홈이 아니면 앱 안에서 뒤로", "if (!isOnHome() && webView.canGoBack())" in java)
check("홈에서는 안내를 띄우고 2초 안에 다시 누르면 닫는다",
      "한 번 더 누르면 앱이 종료됩니다" in java and "now - lastHomeBackAt < 2000L" in java)
check("홈 판정은 해시 주소로 한다", 'route.equals("/")' in java)

print()
print("== 2-가 · 3-가. 눌리는 것은 48px 이상 · 뒤로는 상단바 한 곳")
# v3.28 에서 56px 로 올렸다 (장갑). 48px 아래로 내려가지 않는지만 본다.
btn_heights = px(css_decls(".btn").get("min-height", []))
check("버튼 기본 48px 이상", bool(btn_heights) and min(btn_heights) >= 48, str(btn_heights))
top = css_decls(".topbar .btn--icon")
check("상단바 뒤로 56px", 56 in px(top.get("min-width", [])) and 56 in px(top.get("min-height", [])))
check("화면 속 ← 링크가 하나도 없다", not has('class="back"'))
# 올라간 첨부 타일이 <a> 였고 그 안에 ✕ 버튼이 있었다. 상세 화면의 첨부 링크(버튼 없음)는 그대로다.
check("링크 안에 버튼이 없다 (첨부 타일)",
      not has_re(r'<a\b[^>]*class="media-tile[^"]*"(?:(?!</a>).)*<button') and has('class="media-tile__open"'))
delb = css_decls(".media-tile__del")
check("첨부 지우기 버튼 44px",
      min(px(delb.get("width", [])) or [0]) >= 44 and min(px(delb.get("height", [])) or [0]) >= 44)

print()
print("== 4-나. 시트 연결은 사람이 할 일이 없다 (공용 주소 · 연결 알림은 test_update_flow.py)")
check("실패 이유를 남긴다", has("sheetConnectError"))
check("설정에는 상태 한 줄 · 주소 칸은 실패했을 때만",
      has_re(r"Boolean\(\s*\w+\.error\s*\)\s*\|\|") and has('data-act="sheet-recheck"'))

print()
print("== 5-가. 새 리포트에서는 상단바 오른쪽이 [업로드]")
check("상단바에 주 동작 버튼이 있다", has('id="btn-topaction"', "html"))
check("새 리포트 화면에서만 바뀐다", has_re(r"startsWith\(\s*'/report/'\s*\)"))
check("글자는 폼의 버튼에서 가져온다 (수정이면 '시트에 저장')", defines("syncTopActionLabel"))
check("저장 규칙은 폼 한 곳에만 — 상단바는 폼 버튼을 대신 누른다",
      has("#reportForm button[type=submit]") and has_re(r"\w+\.click\(\)"))

print()
print("== 6-가. 첨부는 아이콘 타일 셋")
check("타일 셋", len(calls("tile", body("mediaPickHtml"))) == 3)
check("아이콘이 들어간다", has("ICON_CAMERA") and has("ICON_VIDEO") and has("ICON_ALBUM"))
check("타일 높이 76px", 76 in px(css_decls(".media-pick__tile").get("min-height", [])))
check("글자 버튼 셋은 없다", not has_re(r'class="btn[^"]*"\s+data-act="capture"'))

print()
print("== 7-가. 항목 순서는 손잡이를 잡고 끌어 옮긴다")
check("↑↓ 버튼이 없다", bool(fields) and 'data-act="up"' not in fields and not has_re(r"act\s*===\s*'up'", fields))
check("손잡이가 있다", has('class="drag-handle"') and defines("bindDrag"))
check("손잡이만 잡힌다 (줄 어디서나 끌리면 스크롤과 헷갈린다)",
      has_re(r"closest\(\s*'\[data-drag\]'\s*\)") and has_re(r"touch-action\s*:\s*none", "css"))
check("놓았을 때 한 번 저장한다", has_re(r"reorderFields\(", fields))
check("제자리에 놓으면 저장하지 않는다", has_re(r"\.join\(\s*'\|'\s*\)\s*===\s*\w+\s*\)\s*return", fields))

print()
print("== 8-가 · 추가 3. 바탕 회청 · 카드 흰색 · 글자 한 단계 크게")
check("바탕 색 토큰이 있다", has_re(r"--color-page\s*:", "css")
      and css_has(".app", "background", r"var\(--color-page\)")
      and css_has(".screen", "background", r"var\(--color-page\)"))
# v3.28(C-1) 에서 레일은 남색 메뉴가 되었다가 밝은 레일이 되었다 — 바탕색이 토큰으로 정해져 있는지만 본다.
# (v3.49 CSS 정리 때 뒤에서 덮여 쓰이지 않던 --nav-bg 선언이 빠졌다)
check("레일 바탕은 토큰 색", css_has(".tabbar", "background", r"var\(--[a-z-]+\)"))
# v3.29(D2) 에서 테두리 없는 흰 카드 + 옅은 그림자가 되었다.
check("카드는 흰색 + 그림자", css_has(".panel", "background", r"var\(--color-bg\)")
      and css_has(".panel", "border", r"^0$") and css_has(".panel", "border-radius", r"^20px$")
      and css_has(".panel", "box-shadow", r"var\(--shadow-sm\)"))
check("본문 17px", css_has("body", "font-size", r"^17px$"))
check("작은 글자가 남지 않았다 (12px 없음)", not has_re(r"font-size\s*:\s*12px", "css"))
check("표 글자 17px", css_has(".table--touch td", "font-size", r"^17px$"))

print()
print("== 추가 1. 이력 줄도 줄마다 카드")
# `.row` 는 패널 안 버튼 묶음에도 쓰는 이름 — 목록 안의 줄에만 걸어야 상자 안의 상자가 안 생긴다.
check("목록 안의 줄에만 테두리·흰 배경",
      css_has(".rows > .row", "background", r"var\(--color-bg\)") and not css_has(".row", "background"))

print()
print("== 9-가. 가이드 작성은 가이드 화면에서 (종류 없는 주소는 e2e v335 가 연다)")
check("종류는 폼 안에서 큰 버튼으로 고른다",
      has('class="type-pick"') and has_re(r"act\s*===\s*'pick-type'")
      and has_re(r'<input(?=[^>]*type="hidden")[^>]*id="gCategory"'))

print()
print("== 10-가. 설명 문장 삭제")
for phrase in ["따로 누를 것이 없습니다", "저장 즉시 모든 기기에 공유됩니다", "미리 들어 있습니다",
               "그대로 두면 됩니다", "저절로 들어갑니다", "처음 오셨네요", "오프라인에서도 동작",
               "구글 시트의 팀 전체 기록", "상태 변경은 시트에 즉시 기록", "기록 방식"]:
    check(f"'{phrase}' 가 없다", not has(phrase))
check("빈 화면 안내는 남는다", has("등록된 품목이 없습니다") and has("운행 기록이 없습니다"))

print()
print("== 11-나. 정상이면 조용하다")
check("상단바 칩은 문제 있을 때만", has_re(r"\.hidden\s*=\s*!\s*\w+\.offline\s*&&"))
check("처음부터 숨겨져 있다", has_re(r'<[^>]*\bid="sync-chip"[^>]*\shidden\b', "html"))
check("재고 알약에 '시트 연결됨' 이 없다", bool(module_of("inventoryView"))
      and not has("시트 연결됨", module_of("inventoryView")))
check("설정에 '시트와 같은 내용' 배지 글이 없다", bool(settings) and not has("'시트와 같은 내용'", settings))

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 피드백에 답한 것이 그대로 남아 있습니다.")
