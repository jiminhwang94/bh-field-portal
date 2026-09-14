"""v3.23 — 팀 피드백 11건 + 3건에 답한 것들이 코드에 남아 있는지.

피드백을 그대로 옮기고, 항목마다 고른 방법(1-나 · 2-가 · 3-가 · 4-나 · 5-가 · 6-가 ·
7-가 · 8-가 · 9-가 · 10-가 · 11-나)이 지켜지는지 본다. 한 번 고친 것이 다음 회차에
슬그머니 되돌아가는 일이 잦아서 검사로 묶어 둔다.

실행: python tests/test_feedback_v323.py
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


css = read("web", "css", "app.css")
app = read("web", "js", "app.js")
index = read("web", "index.html")
report = read("web", "js", "views", "report.js")
fields = read("web", "js", "views", "fields.js")
guides = read("web", "js", "views", "guides.js")
inv = read("web", "js", "views", "inventory.js")
drv = read("web", "js", "views", "driving.js")
settings = read("web", "js", "views", "settings.js")
syncnow = read("web", "js", "syncnow.js")
connect = read("web", "js", "connect.js")
java = read("android", "app", "src", "main", "java", "com", "beyondhoneycomb", "fieldportal", "MainActivity.java")
views = report + fields + guides + inv + drv + settings + app

print("== 1-나. 홈에서 뒤로가기 두 번이면 종료")
check("홈이 아니면 앱 안에서 뒤로", "if (!isOnHome() && webView.canGoBack())" in java)
check("홈에서는 안내를 띄우고 2초 안에 다시 누르면 닫는다",
      "한 번 더 누르면 앱이 종료됩니다" in java and "now - lastHomeBackAt < 2000L" in java)
check("홈 판정은 해시 주소로 한다", 'route.equals("/")' in java)

print()
print("== 2-가 · 3-가. 눌리는 것은 48px 이상 · 뒤로는 상단바 한 곳")
check("버튼 기본 48px", ".btn { min-height: 48px; }" in css)
check("상단바 뒤로 56px", ".topbar .btn--icon { min-width: 56px; min-height: 56px;" in css)
check("화면 속 ← 링크가 하나도 없다", 'class="back"' not in views)
# 올라간 첨부 타일이 <a> 였고 그 안에 ✕ 버튼이 있었다. 상세 화면의 첨부 링크(버튼 없음)는 그대로다.
check("링크 안에 버튼이 없다 (첨부 타일)",
      '<a class="media-tile" href="${h(link.url)}"' not in report and 'class="media-tile__open"' in report)
check("첨부 지우기 버튼 44px", ".media-tile__del {\n  top: 4px; right: 4px; width: 44px; height: 44px;" in css)

print()
print("== 4-나. 시트 연결은 사람이 할 일이 없다")
check("처음 켤 때 공용 주소를 설정에 적어 넣는다", "export async function registerDefaultUrl()" in connect)
check("연결을 확인하고 한 번 알린다", "구글 시트에 연결됐습니다" in connect)
check("실패 이유를 남긴다", "sheetConnectError" in connect)
check("설정에는 상태 한 줄 · 주소 칸은 실패했을 때만",
      "const showSheetForm = Boolean(conn.error) || sheetFormOpen;" in settings
      and 'data-act="sheet-recheck"' in settings)
check("폼이 없을 때 리스너를 붙이지 않는다", "if (sheetsForm) sheetsForm.addEventListener" in settings)

print()
print("== 5-가. 새 리포트에서는 상단바 오른쪽이 [업로드]")
check("상단바에 주 동작 버튼이 있다", 'id="btn-topaction"' in index)
check("새 리포트 화면에서만 바뀐다", "const onReport = path.startsWith('/report/');" in app)
check("글자는 폼의 버튼에서 가져온다 (수정이면 '시트에 저장')", "function syncTopActionLabel()" in app)
check("저장 규칙은 폼 한 곳에만 — 상단바는 폼 버튼을 대신 누른다",
      "document.querySelector('#reportForm button[type=submit]')" in app and "submit.click();" in app)

print()
print("== 6-가. 첨부는 아이콘 타일 셋")
check("타일 셋", "function mediaPickHtml(fieldId)" in report and report.count("tile('") == 3)
check("아이콘이 들어간다", "ICON_CAMERA" in report and "ICON_VIDEO" in report and "ICON_ALBUM" in report)
check("타일 높이 76px", ".media-pick__tile {\n  min-height: 76px;" in css)
check("글자 버튼 셋은 없다", 'class="btn btn--ghost" data-act="capture"' not in report)

print()
print("== 7-가. 항목 순서는 손잡이를 잡고 끌어 옮긴다")
check("↑↓ 버튼이 없다", "data-act=\"up\"" not in fields and "act === 'up'" not in fields)
check("손잡이가 있다", 'class="drag-handle"' in fields and "function bindDrag(list)" in fields)
check("손잡이만 잡힌다 (줄 어디서나 끌리면 스크롤과 헷갈린다)",
      "const handle = ev.target.closest('[data-drag]');" in fields and "touch-action: none" in css)
check("놓았을 때 한 번 저장한다", "await api.reorderFields(order);" in fields)
check("제자리에 놓으면 저장하지 않는다", "if (order.join('|') === before) return;" in fields)

print()
print("== 8-가 · 추가 3. 바탕 회청 · 카드 흰색 · 글자 한 단계 크게")
check("바탕 색 토큰이 있다", "--color-page:" in css and ".app, .screen { background: var(--color-page); }" in css)
check("레일은 흰 틀", ".tabbar { background: var(--color-bg); }" in css)
check("카드는 흰색 + 그림자", ".panel, .setting, .card { background: var(--color-bg); box-shadow: var(--shadow-raise); }" in css)
check("본문 17px", "font-size: 17px;\n  font-weight: 400;" in css)
check("작은 글자가 남지 않았다 (12px 없음)", "font-size: 12px" not in css)
check("표 글자 17px", ".table--touch td { font-size: 17px; }" in css)

print()
print("== 추가 1. 이력 줄도 줄마다 카드")
# `.row` 는 패널 안 버튼 묶음에도 쓰는 이름 — 목록 안의 줄에만 걸어야 상자 안의 상자가 안 생긴다.
check("목록 안의 줄에만 테두리·흰 배경",
      ".rows > .row, .list > .item, .rows > .item, .list > .row {\n  background: var(--color-bg);\n  border: 1px solid var(--color-border);" in css
      and "\n.row, .item {\n  background: var(--color-bg);" not in css)

print()
print("== 9-가. 가이드 작성은 홈에서 바로")
# v3.25 — 가이드 탭(B안)이 생기면서 홈의 작성 버튼은 가이드 탭으로 옮겼다.
check("가이드 작성은 가이드 탭 오른쪽 위 (홈에는 없다)",
      'href="#/guides/new/${type}">＋ 가이드 작성</a>' in guides
      and 'href="#/guides/new">＋ 가이드 작성</a>' not in app)
check("종류 없는 작성 주소가 있다", "[/^\\/guides\\/new$/, () => guideEditView(view, null, null)]" in app)
check("종류는 폼 안에서 큰 버튼으로 고른다",
      'class="type-pick"' in guides and "act === 'pick-type'" in guides
      and '<input type="hidden" id="gCategory"' in guides)

print()
print("== 10-가. 설명 문장 삭제")
for phrase in ["따로 누를 것이 없습니다", "저장 즉시 모든 기기에 공유됩니다", "미리 들어 있습니다",
               "그대로 두면 됩니다", "저절로 들어갑니다", "처음 오셨네요", "오프라인에서도 동작",
               "구글 시트의 팀 전체 기록", "상태 변경은 시트에 즉시 기록", "기록 방식"]:
    check(f"'{phrase}' 가 없다", phrase not in views)
check("빈 화면 안내는 남는다", "등록된 품목이 없습니다" in inv and "운행 기록이 없습니다" in drv)
check("한도는 남는다 (거짓 안내가 되면 안 된다)", "영상 최대 20초 · 파일 ${MEDIA_FILE_LIMIT_TEXT}" in report)

print()
print("== 11-나. 정상이면 조용하다")
check("상단바 칩은 문제 있을 때만", "chip.hidden = !state.offline && !failed && waiting === 0;" in syncnow)
check("처음부터 숨겨져 있다", 'id="sync-chip" type="button" title="아직 올리지 않은 내용 보기" hidden' in index)
check("재고 알약에 '시트 연결됨' 이 없다", "sheetMode ? '시트 연결됨'" not in inv)
check("설정에 '시트와 같은 내용' 배지 글이 없다", "'시트와 같은 내용'" not in settings)

print()
print("== 6번(자동 새로고침 제거)이 되돌아오지 않았다")
check("자동 받기 없음", "setInterval(() => runRefresh" not in syncnow)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 피드백에 답한 것이 그대로 남아 있습니다.")
