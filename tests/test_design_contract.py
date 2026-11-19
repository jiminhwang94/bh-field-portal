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

(43) 파일 이름 · 줄 모양에 묶이지 않는다 — 화면 코드 · 스타일 · Apps Script 를 통째로
느슨하게 본다 (tests/_src.py). 실제로 눌러 보는 검사(tests/e2e) · 가짜 시트에서 .gs 를
돌리는 검사(test_apps_script.mjs) 가 이미 보는 것은 여기서 뺐다.

실행: python3 tests/test_design_contract.py
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _src import (CSS, JS_FILES, body, calls, count, css_has, defines, has, has_re,  # noqa: E402
                  module_of, read, ROOT)

fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  — " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


print("화면 머리는 한 줄이다")

# 이 두 줄이 되살아나면 앱 전체가 다시 예전 디자인처럼 보인다.
check(
    "page-head 안의 h1 을 한 줄 통째로 늘리지 않는다",
    not re.search(r"\.page-head\s+h1\s*\{[^}]*flex:\s*1\s+1\s+100%", CSS),
    "이 규칙이 디자인의 한 줄 머리를 세 줄로 쪼갠다",
)
check(
    "page-head 안의 p 를 한 줄 통째로 늘리지 않는다",
    not re.search(r"\.page-head\s*>\s*p\s*\{[^}]*flex:\s*1\s+1\s+100%", CSS),
)

# 화면은 디자인의 이름표를 쓴다. 옛 <h1> 은 스타일을 못 받는다. (화면 코드 전부)
bad_h1 = ["%s %s" % (os.path.basename(rel), tag) for rel, src in JS_FILES.items()
          for tag in re.findall(r"<h1(?![^>]*page-head__title)[^>]*>", src)]
check("화면 제목이 모두 page-head__title 이다", not bad_h1, " / ".join(bad_h1[:3]))

print()
print("버튼과 제목은 순수 텍스트다")

# 디자인이 남겨 둔 것만 예외. 그 밖의 그림문자는 버튼·제목에 넣지 않는다.
KEEP = ("⬆", "📖", "＋", "−", "↑", "↓", "✕", "→", "←", "›", "‹", "↗", "✓")
EMOJI = re.compile(
    r"[\U0001F000-\U0001FAFF←-⇿⌀-➿⬀-⯿]")

bad_emoji = []
for rel, src in JS_FILES.items():
    for m in re.finditer(
            r"<(?:button|a)\b[^>]*class=\"[^\"]*btn[^\"]*\"[^>]*>([^<]{0,60}?)</(?:button|a)>", src):
        if any(ch not in KEEP for ch in EMOJI.findall(m.group(1))):
            bad_emoji.append("%s: %s" % (os.path.basename(rel), m.group(1).strip()[:30]))
    for m in re.finditer(r"panel__title\"[^>]*>([^<]{0,60})", src):
        if any(ch not in KEEP for ch in EMOJI.findall(m.group(1))):
            bad_emoji.append("%s: %s" % (os.path.basename(rel), m.group(1).strip()[:30]))
check("버튼·패널 제목에 그림문자가 없다", not bad_emoji, " / ".join(dict.fromkeys(bad_emoji))[:160])

print()
print("디자인이 정한 구조를 쓴다")
# 재고 카드(v3.37) · 단계식 리포트(v3.35) · 가이드 한 줄 행은 e2e(v337 · v335 · v348) 가 실제로 본다.
check("새 리포트 입력은 2열 격자다", has_re(r'class="form-grid"'))
check("여러 줄 항목은 두 칸을 다 쓴다", has_re(r'class="field field--wide[^"]*"'))
# v3.23 — ↑↓ 대신 손잡이(≡)를 잡고 끌어 옮긴다. 줄 구조는 같다.
check("항목 설정도 같은 한 줄 행이다",
      has_re(r'class="row"\s+data-id=') and has_re(r'class="order-btns"')
      and has_re(r'class="drag-handle"'))

# 디자인이 쓰는 이름표는 스타일이 반드시 있어야 한다 (없으면 기본 모양으로 찌그러진다)
print()
print("쓰는 이름표에 스타일이 있다")
NEEDED = ["page-head__title", "page-head__meta", "page-head__spacer", "rows", "row__code",
          "row__main", "row__title", "row__meta", "order-btns", "form-grid", "field--wide",
          "table--touch", "settings-list", "tnum", "is-low", "tag-neutral"]
missing = [c for c in NEEDED if not re.search(r"\.%s\b" % re.escape(c), CSS)]
check("디자인 이름표가 모두 정의되어 있다", not missing, ", ".join(missing))

print()
print("화면이 손잡이를 빠뜨리지 않는다")

# 디자인을 새로 그리면서 마크업이 손잡이(data-*)를 빠뜨리면, 눌러도 아무 일이
# 없거나 더 나쁘게는 핸들러가 중간에서 터진다. 실제로 재고를 표로 바꾸면서
# data-qty 를 빠뜨려 [+]/[-] 가 죽었고, 그때 기억 속 수량만 올라가 있다가
# [수정] 창에 그 값이 채워져 **보유 수량이 엉뚱하게 저장**됐다.
# (카드의 +/− 가 수량 글자를 바꾸는지는 e2e v335 · v337 이 눌러 본다)
# 칸을 querySelectorAll 로 찾는다 — 없으면 forEach 가 아무것도 하지 않는다 (멈추지 않는다).
check("수량 칸을 못 찾아도 멈추지 않는다",
      has_re(r"querySelectorAll\(\s*[`'\"]\[data-qty=[^)]*\)\s*\.forEach"))
check("실패하면 원래 값으로 되돌린다 (뺄셈이 아니라)",
      has_re(r"\.quantity\s*=\s*before\s*;") and not has_re(r"\.quantity\s*-=\s*delta"))
check("수정 창은 손대지 않은 칸을 보내지 않는다",
      has_re(r"if\s*\(\s*(\w+)\s*!==\s*\w+\.quantity\s*\)\s*\w+\.quantity\s*=\s*\1\b"),
      "최소보유만 고쳤는데 보유 수량까지 덮어쓰면 안 된다")

print()
print("앱 아이콘이 디자인 색을 쓴다")

check("적응형 아이콘이 있다 (없으면 런처가 옛 PNG 를 흰 판에 욱여넣는다)",
      os.path.exists(os.path.join(ROOT, "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml")))
bg = read("android", "app", "src", "main", "res", "drawable", "ic_launcher_background.xml")
check("아이콘 바탕이 코발트다", "#0047AB" in bg.upper())
themes = read("android", "app", "src", "main", "res", "values", "themes.xml")
check("실행 순간 색이 옛 남색이 아니다", "#0f172a" not in themes)
manifest = read("web", "manifest.webmanifest")
check("홈 화면 추가 색도 옛 남색이 아니다", "#0f172a" not in manifest)

print()
print("사진은 기기 안 파일에서 꺼낸다")

# 사진은 기기 안(IndexedDB)에 있는데 주소는 `/media/<파일명>` 이라는 서버 경로다.
# 브라우저는 서버가 내주니 우연히 보였지만, APK 는 화면 파일이 기기 안에 있어
# 그 경로에 아무것도 없다 — 액박이 떴다.
check("기기 안 사진을 꺼내는 도우미가 있다", defines("hydrateMedia"))
# v3.49 — 사무실 서버(/media/)는 없어졌다. 기기에 없으면 사진 자리에 까닭을 적는다
check("기기에 없으면 '찾을 수 없음' 을 적는다 (옛 서버 경로로 가지 않는다)",
      "brokenNote(" in body("hydrateMedia") and "serverBase(" not in body("hydrateMedia"))
# 가이드 · 이력 두 화면이 쓴다 (가이드 사진은 e2e v343 이 실제로 본다)
check("사진을 data-media 로 그린다", has_re(r'data-media="\$\{'))
check("그린 뒤 채워 넣는다 (가이드 · 이력 · 작성)", len(calls("hydrateMedia")) >= 2)
check("단계 사진은 높이가 묶여 있다", css_has(".step__img", "max-height"),
      "폭만 막으면 4000px 사진이 화면 몇 개 높이로 늘어난다")

print()
print("리포트 항목은 고정이다")
# 기본 항목이 앱 안에 있고 첫 실행에 깔리는지는 e2e 가 빈 시트 · 새 기기로 리포트를 쓰며 본다.
check("비어 있을 때만 채운다",
      has_re(r"count\(\s*'fields'\s*\)\s*\)?\s*>\s*0\s*\)\s*return", body("ensureDefaultFields")))
# 항목은 ID 가 아니라 **이름**이 기준이다. ID 로만 맞추면 기기마다 ID 가 달라
# 같은 항목이 시트에 두 줄로 쌓인다 ([로봇 모델] 이 실제로 그랬다). 시트 쪽은 test_apps_script.mjs.
fields_mod = module_of("pullFields")
check("기기는 항목을 이름으로 맞춘다 (공백 무시)",
      has_re(r"fieldLabel[^;\n]*replace\(\s*/\\s/g"),
      "ID 로만 맞추면 기기마다 ID 가 달라 같은 항목이 갈라진다")
check("기기가 항목 ID 를 새로 지어내지 않는다 (시트 ID 를 따른다)",
      has_re(r"id\s*:\s*\w+\.id\s*\|\|\s*\(\s*\w+\s*\?\s*\w+\.id\s*:", fields_mod),
      "기기마다 ID 가 갈라지면 다음 업로드에서 또 중복이 된다")
# 항목 순서는 사람마다 손에 익은 것이 다르다. 순서까지 팀 공통으로 맞추면
# 남이 자기 태블릿에서 옮길 때 내가 맞춰 둔 양식이 날아간다.
_reorder = body("reorderFields")
check("항목 순서는 기기에만 남는다 (시트로 올리지 않는다)",
      "displayOrder" in _reorder and "queueFieldSheetPush" not in _reorder
      and has_re(r"displayOrder\s*:\s*\w+\s*\?\s*\w+\.displayOrder"),
      "순서를 올리면 남이 옮길 때 내 양식이 날아간다")
_defaults = re.sub(r"\s+", "", body("DEFAULT_FIELDS"))
check("리포트 번호가 첫 칸이다 (기본 순서)",
      "fieldLabel:'리포트번호'" in _defaults and "fieldLabel:'매장명'" in _defaults
      and _defaults.index("fieldLabel:'리포트번호'") < _defaults.index("fieldLabel:'매장명'"),
      "접수 건을 먼저 골라야 나머지 칸이 정해진다")
check("기본 순서는 한 번만 깔고 그 뒤 기기 순서를 지킨다",
      bool(calls("applyDefaultFieldOrderOnce"))
      and has_re(r"getMeta\(", body("applyDefaultFieldOrderOnce"))
      and has_re(r"setMeta\(", body("applyDefaultFieldOrderOnce")),
      "매번 깔면 기기에서 옮긴 순서가 다시 날아간다")
check("항목을 더하고 지우는 것은 팀 공통이다",
      len(calls("queueFieldSheetPushIfOn")) >= 1 and has_re(r"removed\s*=\s*new Set\(", fields_mod),
      "순서만 빼는 것이지 추가·삭제까지 끊으면 안 된다")
check("올리기 버튼은 위아래가 같이 잠긴다",
      defines("setSubmitState") and has_re(r"\w+\.disabled\s*=\s*\w+\.disabled"),
      "한쪽만 '올리는 중' 이면 멀쩡해 보이는 쪽을 한 번 더 누른다")

# 한 달 탭 · 이름으로 열 맞추기 · 갈라진 탭 합치기 · 항목 줄 알아보기 · 상태 칸 · 시트가 매기는 번호 ·
# 콘솔에서 끝난 접수 빼기 — 모두 test_apps_script.mjs 가 가짜 시트에서 실제로 돌려 본다.
check("읽은 줄마다 자기 항목으로 칸을 맞춘다 (앱 쪽)", has_re(r"\(\s*\w+\.headers\s*\|\|\s*\[\]\s*\)"),
      "맨 아래 항목만 믿으면 항목이 바뀌기 전 줄이 어긋난다")
check("예전 판이 만든 갈라진 탭도 목록에 보여 준다", has_re(r"\\\(\\d\+\\\)", "gs"),
      "이미 쌓인 리포트를 못 보게 하면 안 된다")

print()
print("가이드 사진도 팀이 함께 본다")
# 드라이브 폴더 · 사진 열(test_apps_script.mjs), 올리기 · 받기 · 미리보기 주소(e2e v340 · v343) 는 실제로 돈다.
check("사진 주소도 같은지 비교한다", "imageUrl" in body("same", module_of("pullGuides")),
      "빼면 시트의 새 사진이 영영 안 내려온다")

print()
print("사무실 서버 주소는 없앴다")

check("설정에 서버 주소 칸이 없다", not has("sSiteUrl"))
# v3.8 — 앱에서 사무실 서버를 통째로 걷어냈다.
check("서버로 보내는 통로가 없다 (앱이 서버에 버전도 묻지 않는다)",
      not has_re(r"function\s+request\s*\(") and not has("serverRequest"))
check("구글 시트로 곧바로 보낸다 (서버 우회 없음)", not has("/api/sheets/relay"),
      "우회가 실패하면 '서버 주소가 없다' 고 말해 진짜 원인을 가린다")

print()
print("리포트 항목은 팀 공통이다")

check("항목을 시트로 올리고 받는다", defines("pushFields") and defines("pullFields"))
check("항목을 고치면 시트 반영이 예약된다",
      defines("queueFieldSheetPushIfOn") and has("'fieldsheet-push'", body("queueFieldSheetPushIfOn")))
check("여러 번 고쳐도 한 건으로 합친다", has_re(r"new Set\(\[[^\]]*'fieldsheet-push'"))
check("자동 올리기가 항목을 올리고, 새로고침이 받아온다",
      bool(calls("pushFields")) and bool(calls("pullFields")))
check("탭을 통째로 쓰는 종류는 무엇을 바꿨는지(changes)를 함께 올린다",
      len(calls("changesOf")) >= 3,
      "이게 없으면 마지막에 올린 사람이 다른 사람 변경을 통째로 덮어쓴다")
check("가이드 · 항목 · 재고 — 올리기 전에 시트 것과 합친다", count("function mergeWithSheet(") >= 3)
check("안 올린 항목 변경이 있으면 덮어쓰지 않는다",
      has("'fieldsheet-push'", fields_mod) and has_re(r"skipped\s*:\s*'pending'", fields_mod),
      "시트 내용으로 덮으면 방금 고친 것이 사라진다")
check("시트가 비어 있으면 항목을 지우지 않는다",
      has_re(r"if\s*\(\s*!\s*\w+\.length\s*\)\s*return\s*\{\s*changed\s*:\s*0", fields_mod),
      "아직 아무도 안 올린 것이지, 전부 지우라는 뜻이 아니다")
check("업데이트가 서버에 올리지 않는다", not has_re(r"\bapi\.publish\("))
check("대기 건수를 두 번 세지 않는다",
      not has_re(r"\.pending\s*\+\s*\(\s*\w+\.dirty\s*\?"),
      "dirty 와 대기열이 같은 변경을 각각 세면 정체 모를 1건이 뜬다")
check("서버 못 닿음 빨간 띠가 없다", not has("serverUnreachable"))

print()
print("올릴 내용 목록")
# 목록 화면 · 칩을 누르면 열림 · [다시 시도] 는 e2e v346 이 실제로 누른다.
check("되돌리면 바꾸기 전 값으로 돌아간다",
      has_re(r"quantity\s*:\s*\w+\.before")
      and has_re(r"before\s*=\s*\w+\s*\?\s*\w+\.quantity\s*:\s*null"),
      "수량을 바꿀 때 바꾸기 전 값을 함께 적어 둬야 되돌릴 수 있다")
check("여러 번 누른 것을 합쳐도 맨 처음 값을 잃지 않는다",
      has_re(r"if\s*\(\s*!\s*\w+\.has\(\s*\w+\s*\)\s*\)\s*\w+\.set\(\s*\w+\s*,\s*\w+\.before\s*\)"),
      "[+] 를 세 번 누른 뒤 취소하면 중간값이 아니라 원래 값으로 가야 한다")
pending_mod = module_of("openPendingList")
check("확인은 창을 겹치지 않고 줄 안에서 묻는다",
      has("undo-ask") and bool(pending_mod) and not has_re(r"\bconfirmDialog\(", pending_mod),
      "시트 위에 창을 또 띄우면 둘 다 사라진다")

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 화면이 디자인 구조를 따릅니다.")
