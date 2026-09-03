"""디자인이 조용히 예전 모습으로 되돌아가는 것을 막는다.

디자인 모음집(`회사 내부 앱 디자인.zip`)의 규칙은 `handoff/README.md` 에 있다.
그중 **화면 구조**에 해당하는 것만 여기서 검사한다. 색·간격 같은 토큰 규칙은
`test_css_contract.py` 가 본다.

**실제로 있었던 일**
`app.css` 를 디자인 것으로 갈아끼우면서, 예전 마크업(`.page-head` 안의
`<h1>` + `<p>`)이 깨지지 않게 호환 레이어를 덧붙였다.

    .page-head h1  { flex: 1 1 100%; }
    .page-head > p { flex: 1 1 100%; }

이 두 줄이 디자인의 **한 줄 머리**(제목 · 설명 · 오른쪽 버튼)를 통째로
세 줄로 쪼갰다. 스타일시트는 새것인데 화면은 전부 예전 모습으로 보였고,
CSS 를 아무리 대조해도 원인이 안 보였다 — 클래스는 다 있었기 때문이다.

그래서 이 검사는 **CSS 가 아니라 화면 구조**를 본다.

실행: python3 tests/test_design_contract.py
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEWS = ["web/js/app.js"] + [
    "web/js/views/%s" % n for n in sorted(os.listdir(os.path.join(ROOT, "web/js/views")))
    if n.endswith(".js")
]


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  — " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


print("화면 머리는 한 줄이다")

css = read("web/css/app.css")

# 이 두 줄이 되살아나면 앱 전체가 다시 예전 디자인처럼 보인다.
check(
    "page-head 안의 h1 을 한 줄 통째로 늘리지 않는다",
    not re.search(r"\.page-head\s+h1\s*\{[^}]*flex:\s*1\s+1\s+100%", css),
    "이 규칙이 디자인의 한 줄 머리를 세 줄로 쪼갠다",
)
check(
    "page-head 안의 p 를 한 줄 통째로 늘리지 않는다",
    not re.search(r"\.page-head\s*>\s*p\s*\{[^}]*flex:\s*1\s+1\s+100%", css),
)

# 화면은 디자인의 이름표를 쓴다. 옛 <h1> 은 스타일을 못 받는다.
for rel in VIEWS:
    src = read(rel)
    bad = re.findall(r"<h1(?![^>]*page-head__title)[^>]*>", src)
    check(
        "%s — 제목이 page-head__title 이다" % os.path.basename(rel),
        not bad,
        " / ".join(bad[:3]),
    )

print()
print("버튼과 제목은 순수 텍스트다")

# 디자인이 남겨 둔 것만 예외. 그 밖의 그림문자는 버튼·제목에 넣지 않는다.
KEEP = ("⬆", "📖", "＋", "−", "↑", "↓", "✕", "→", "←", "›", "‹", "↗", "✓")
EMOJI = re.compile(
    r"[\U0001F000-\U0001FAFF←-⇿⌀-➿⬀-⯿]")

for rel in VIEWS:
    src = read(rel)
    bad = []
    for m in re.finditer(
            r"<(?:button|a)\b[^>]*class=\"[^\"]*btn[^\"]*\"[^>]*>([^<]{0,60}?)</(?:button|a)>", src):
        text = m.group(1)
        for ch in EMOJI.findall(text):
            if ch not in KEEP:
                bad.append(text.strip()[:30])
                break
    for m in re.finditer(r"panel__title\"[^>]*>([^<]{0,60})", src):
        for ch in EMOJI.findall(m.group(1)):
            if ch not in KEEP:
                bad.append(m.group(1).strip()[:30])
                break
    check(
        "%s — 버튼·패널 제목에 그림문자가 없다" % os.path.basename(rel),
        not bad,
        " / ".join(dict.fromkeys(bad))[:120],
    )

print()
print("디자인이 정한 구조를 쓴다")

inventory = read("web/js/views/inventory.js")
check("재고는 카드가 아니라 표다",
      'class="table table--touch"' in inventory and '<thead>' in inventory)

report = read("web/js/views/report.js")
check("새 리포트 입력은 2열 격자다", 'class="form-grid"' in report)
check("여러 줄 항목은 두 칸을 다 쓴다", 'class="field field--wide"' in report)

guides = read("web/js/views/guides.js")
fields = read("web/js/views/fields.js")
check("가이드 목록은 디자인의 한 줄 행이다",
      'class="row" href=' in guides and 'row__code' in guides)
check("항목 설정도 같은 한 줄 행이다",
      'class="row">' in fields and 'order-btns' in fields)

# 디자인이 쓰는 이름표는 스타일이 반드시 있어야 한다 (없으면 기본 모양으로 찌그러진다)
print()
print("쓰는 이름표에 스타일이 있다")
NEEDED = ["page-head__title", "page-head__meta", "page-head__spacer", "rows", "row__code",
          "row__main", "row__title", "row__meta", "order-btns", "form-grid", "field--wide",
          "table--touch", "settings-list", "tnum", "is-low", "tag-neutral", "back"]
missing = [c for c in NEEDED if not re.search(r"\.%s\b" % re.escape(c), css)]
check("디자인 이름표가 모두 정의되어 있다", not missing, ", ".join(missing))

print()
print("화면이 손잡이를 빠뜨리지 않는다")

# 디자인을 새로 그리면서 마크업이 손잡이(data-*)를 빠뜨리면, 눌러도 아무 일이
# 없거나 더 나쁘게는 핸들러가 중간에서 터진다. 실제로 재고를 표로 바꾸면서
# data-qty 를 빠뜨려 [+]/[-] 가 죽었고, 그때 기억 속 수량만 올라가 있다가
# [수정] 창에 그 값이 채워져 **보유 수량이 엉뚱하게 저장**됐다.
inv = read("web/js/views/inventory.js")
check("재고 표의 수량 칸에 data-qty 가 있다",
      'data-qty="${item.id}"' in inv,
      "이게 없으면 [+]/[-] 가 조용히 죽는다")
check("수량 칸을 못 찾아도 멈추지 않는다",
      "function paintQty(" in inv and "if (!cell) return;" in inv)
check("실패하면 원래 값으로 되돌린다 (뺄셈이 아니라)",
      "item.quantity = before;" in inv and "item.quantity -= delta;" not in inv)
check("수정 창은 손대지 않은 칸을 보내지 않는다",
      "if (quantity !== item.quantity) patch.quantity = quantity;" in inv,
      "최소보유만 고쳤는데 보유 수량까지 덮어쓰면 안 된다")

print()
print("앱 아이콘이 디자인 색을 쓴다")

check("적응형 아이콘이 있다 (없으면 런처가 옛 PNG 를 흰 판에 욱여넣는다)",
      os.path.exists(os.path.join(ROOT, "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml")))
bg = read("android/app/src/main/res/drawable/ic_launcher_background.xml")
check("아이콘 바탕이 코발트다", "#0047AB" in bg.upper())
themes = read("android/app/src/main/res/values/themes.xml")
check("실행 순간 색이 옛 남색이 아니다", "#0f172a" not in themes)
manifest = read("web/manifest.webmanifest")
check("홈 화면 추가 색도 옛 남색이 아니다", "#0f172a" not in manifest)

print()
print("사진은 기기 안 파일에서 꺼낸다")

# 사진은 기기 안(IndexedDB)에 있는데 주소는 `/media/<파일명>` 이라는 서버 경로다.
# 브라우저는 서버가 내주니 우연히 보였지만, APK 는 화면 파일이 기기 안에 있어
# 그 경로에 아무것도 없다 — 액박이 떴다.
ui = read("web/js/ui.js")
check("기기 안 사진을 꺼내는 도우미가 있다", "export async function hydrateMedia" in ui)
check("기기에 없으면 서버 경로로 되돌아간다", "await sync.serverBase()" in ui)
for rel in ["web/js/views/guides.js", "web/js/views/report.js"]:
    src = read(rel)
    name = os.path.basename(rel)
    check("%s — 사진을 data-media 로 그린다" % name, 'data-media="${' in src)
    check("%s — 그린 뒤 채워 넣는다" % name, "hydrateMedia(view)" in src)
check("단계 사진은 높이가 묶여 있다",
      re.search(r"\.step__img\s*\{[^}]*max-height:", css) is not None,
      "폭만 막으면 4000px 사진이 화면 몇 개 높이로 늘어난다")

print()
print("리포트 항목은 고정이다")

store_js = read("web/js/local/store.js")
check("기본 항목이 앱 안에 있다", "export const DEFAULT_FIELDS" in store_js)
check("비어 있을 때만 채운다",
      "export async function ensureDefaultFields" in store_js
      and "if ((await idb.count('fields')) > 0) return 0;" in store_js)
check("첫 실행에 기본 항목을 넣는다", "store.ensureDefaultFields()" in read("web/js/net.js"))

gs = read("google-apps-script.gs")
check("이미 있는 탭의 머리를 고쳐 쓰지 않는다",
      "function pickReportSheet" in gs
      and "// 항목 설정이 바뀐 경우 2행 헤더를 최신으로 유지" not in gs,
      "옛 줄이 새 머리 아래 놓여 통째로 어긋난다")
check("항목이 바뀌면 다음 탭으로 간다", "baseName + ' (' + n + ')'" in gs)
check("갈라진 탭도 월 목록에 나온다", "( \(\d+\))?$" in gs)

print()
print("사무실 서버 주소는 없앴다")

settings = read("web/js/views/settings.js")
check("설정에 서버 주소 칸이 없다", "sSiteUrl" not in settings)
# v3.8 — 앱에서 사무실 서버를 통째로 걷어냈다.
sync_js = read("web/js/sync.js")
check("서버로 보내는 통로가 없다",
      "function request(" not in sync_js and "serverRequest" not in sync_js)
check("구글 시트로 곧바로 보낸다 (서버 우회 없음)",
      "/api/sheets/relay" not in read("web/js/sheets.js"),
      "우회가 실패하면 '서버 주소가 없다' 고 말해 진짜 원인을 가린다")
api_js = read("web/js/api.js")
check("앱이 서버에 버전을 묻지 않는다", "serverRequest" not in api_js)

print()
print("리포트 항목은 팀 공통이다")

fieldsheet = read("web/js/fieldsheet.js")
check("항목을 시트로 올리고 받는다",
      "export async function pushFields" in fieldsheet
      and "export async function pullFields" in fieldsheet)
check("항목을 고치면 시트 반영이 예약된다",
      "queueFieldSheetPushIfOn" in store_js
      and "'fieldsheet-push'" in store_js)
check("여러 번 고쳐도 한 건으로 합친다", "PUSH_TYPES" in store_js)
check("업데이트가 항목을 올리고 받는다",
      "fieldsheet.pushFields()" in sync_js
      and "fieldsheet.pullFields()" in read("web/js/syncnow.js"))
check("안 올린 항목 변경이 있으면 덮어쓰지 않는다",
      "'fieldsheet-push'" in fieldsheet and "skipped: 'pending'" in fieldsheet,
      "시트 내용으로 덮으면 방금 고친 것이 사라진다")
check("시트가 비어 있으면 항목을 지우지 않는다",
      "if (!rows.length) return { changed: 0, added: 0, removed: 0 };" in fieldsheet,
      "아직 아무도 안 올린 것이지, 전부 지우라는 뜻이 아니다")
gs2 = read("google-apps-script.gs")
check("Apps Script 가 항목 탭을 다룬다",
      "function handleFields" in gs2 and "var FIELD_SHEET" in gs2)
syncnow = read("web/js/syncnow.js")
check("업데이트가 서버에 올리지 않는다", "api.publish(" not in syncnow)
check("대기 건수를 두 번 세지 않는다",
      "state.pending + (state.dirty ? 1 : 0)" not in syncnow
      and "state.pending + (state.dirty ? 1 : 0)" not in settings,
      "dirty 와 대기열이 같은 변경을 각각 세면 정체 모를 1건이 뜬다")
net = read("web/js/net.js")
check("서버 못 닿음 빨간 띠가 없다", "serverUnreachable()" not in net)

print()
print("올릴 내용 목록")

pending = read("web/js/pending.js")
check("목록 화면이 있다", "export async function openPendingList" in pending)
check("상단 칩을 누르면 열린다", "openPendingList()" in syncnow)
check("되돌리면 바꾸기 전 값으로 돌아간다",
      "quantity: op.before" in pending
      and "const before = prev ? prev.quantity : null;" in store_js,
      "수량을 바꿀 때 바꾸기 전 값을 함께 적어 둬야 되돌릴 수 있다")
check("여러 번 누른 것을 합쳐도 맨 처음 값을 잃지 않는다",
      "firstBefore" in store_js,
      "[+] 를 세 번 누른 뒤 취소하면 중간값이 아니라 원래 값으로 가야 한다")
check("확인은 창을 겹치지 않고 줄 안에서 묻는다",
      "undo-ask" in pending and "confirmDialog" not in pending,
      "시트 위에 창을 또 띄우면 둘 다 사라진다")

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 화면이 디자인 구조를 따릅니다.")
