"""화면이 쓰는 클래스가 CSS 에 정의돼 있는지 검사.

디자인을 통째로 갈아끼우면(v3.2) 기존 화면이 쓰던 클래스가 조용히 정의를 잃는다.
스타일이 안 붙은 button 은 브라우저 기본 모양으로 찌그러져 보이는데,
코드는 멀쩡하고 테스트도 통과하므로 눈으로 보기 전에는 알 수 없다.

실제로 v3.3 에서 재고 화면이 이렇게 깨졌다.
  - `.tabs` 와 `.chip` 이 정의를 잃어 차량 탭·필터가 기본 버튼으로 나왔다
  - `.tab` 은 더 나빴다. 새 디자인에서 **하단 탭바** 를 뜻하게 되어,
    차량 탭이 탭바 모양(세로 정렬·작은 글자)을 뒤집어썼다
  - `<textarea class="textarea">` 가 `.input` 스타일을 못 받아
    다크 모드에서 흰 배경 + 검은 글자가 됐다

실행: python3 tests/test_css_contract.py
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
failures = []


def check(label, ok, detail=""):
    print(f"{'✅' if ok else '❌'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


css = open(os.path.join(WEB, "css", "app.css"), encoding="utf-8").read()
defined = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))

# 화면 파일이 실제로 쓰는 클래스를 모은다
used = {}
for base, dirs, files in os.walk(WEB):
    dirs[:] = [d for d in dirs if d not in ("fonts", "icons")]
    for name in files:
        if not name.endswith((".js", ".html")):
            continue
        rel = os.path.relpath(os.path.join(base, name), WEB).replace(os.sep, "/")
        text = open(os.path.join(base, name), encoding="utf-8").read()
        for match in re.finditer(r'class="([^"]*)"', text):
            # `${...}` 로 런타임에 붙는 조각은 이름이 완성되지 않으므로 뺀다
            chunk = re.sub(r"\$\{[^}]*\}", " ", match.group(1))
            for cls in chunk.split():
                if re.fullmatch(r"[a-zA-Z][\w-]*", cls) and not cls.endswith("-"):
                    used.setdefault(cls, set()).add(rel)

print("=" * 62)
print("화면 ↔ 스타일 계약 검사")
print("=" * 62)

missing = sorted(c for c in used if c not in defined)
check("화면이 쓰는 클래스가 모두 CSS 에 있다", not missing,
      ", ".join(f".{c}({'·'.join(sorted(used[c]))})" for c in missing)
      if missing else f"{len(used)}개 확인")

# 입력 요소는 반드시 스타일이 붙어야 한다.
# 빠지면 다크 모드에서 흰 배경 + 검은 글자가 되어 글자가 안 보인다.
STYLED_INPUT = ("input", "textarea", "select", "check", "seg-opt")
bare = []
for base, dirs, files in os.walk(WEB):
    dirs[:] = [d for d in dirs if d not in ("fonts", "icons")]
    for name in files:
        if not name.endswith((".js", ".html")):
            continue
        rel = os.path.relpath(os.path.join(base, name), WEB).replace(os.sep, "/")
        for num, line in enumerate(
                open(os.path.join(base, name), encoding="utf-8"), 1):
            for tag in ("<input", "<textarea", "<select"):
                start = line.find(tag)
                if start < 0:
                    continue
                # 그 태그 안쪽만 본다. 한 줄에 감싸는 div 의 class 가 먼저
                # 나오는 경우가 많아, 줄 전체를 보면 엉뚱한 값을 읽는다.
                end = line.find(">", start)
                inner = line[start:end if end > 0 else len(line)]
                if any(x in inner for x in
                       ('type="hidden"', 'type="file"',
                        'type="checkbox"', 'type="radio"')):
                    continue
                classes = re.search(r'class="([^"]*)"', inner)
                names = (classes.group(1).split() if classes else [])
                if not any(n in STYLED_INPUT for n in names):
                    bare.append(f"{rel}:{num} {tag}")
check("모든 입력 칸에 스타일 클래스가 붙어 있다", not bare,
      ", ".join(bare) if bare else "확인")

# 하단 탭바의 .tab 은 화면 안에서 다른 뜻으로 쓰면 안 된다
misuse = []
for base, dirs, files in os.walk(os.path.join(WEB, "js")):
    for name in files:
        if not name.endswith(".js"):
            continue
        rel = os.path.relpath(os.path.join(base, name), WEB).replace(os.sep, "/")
        text = open(os.path.join(base, name), encoding="utf-8").read()
        if re.search(r'class="tab["\s]', text):
            misuse.append(rel)
check("화면이 하단 탭바의 .tab 을 빌려 쓰지 않는다", not misuse,
      ", ".join(misuse) if misuse else "확인")

# 토큰 밖의 새 색을 만들지 않는다 (디자인 규칙)
body = css[css.index("/* ── 2. 기본"):]
hexes = {h.lower() for h in re.findall(r"#[0-9a-fA-F]{3,8}", body)}
allowed = {"#fff", "#ffffff", "#000", "#000000"}
check("토큰 정의부 밖에서 새 색을 만들지 않는다", not (hexes - allowed),
      ", ".join(sorted(hexes - allowed)) if (hexes - allowed) else "확인")

print("=" * 62)
if failures:
    print(f"❌ 실패 {len(failures)}건: {', '.join(failures)}")
    sys.exit(1)
print("✅ 전부 통과 — 화면과 스타일이 어긋나지 않습니다.")
