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
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 화면이 디자인 구조를 따릅니다.")
