"""[새 리포트] 와 [리포트 수정] 이 서로 새지 않는지, 그리고 요청 폭주 방지.

**1. 새 리포트에 수정 내용이 새어 나오던 사고**
임시보관 칸이 하나뿐이라, 한 번 리포트를 수정하고 나면 그 뒤로는
[새 리포트] 를 눌러도 저장돼 있던 수정 내용이 되살아나 "리포트 수정"
화면이 열렸다. 새 리포트를 쓸 수 없는 상태가 된다.

원인은 `sheetLink`(고칠 시트 줄 번호)를 **공용** 임시보관 칸에 같이
담아 둔 것이었다. 새 리포트로 들어와도 그 줄 번호를 그대로 주워 왔다.

  → 칸을 둘로 나눈다. 새 리포트 칸은 줄 번호를 **절대** 갖지 않는다.
  → 무엇을 하는 화면인지는 임시보관이 아니라 **주소** 가 정한다.

**2. 요청이 서로를 부르며 끝없이 도는 사고**
`request()` 가 끝날 때마다 무조건 "서버 상태가 바뀌었다" 고 알렸다.
그 알림을 받은 화면이 상태를 다시 물어보는데, 그것도 요청이라 또 알림이
가서 초당 수십 건이 돌았다. 브라우저가 한 서버에 동시에 여는 연결은
6개뿐이라 진짜 요청들이 전부 그 뒤에 밀렸고, 무엇을 눌러도 느려졌다.

  → 처음에는 "값이 바뀔 때만 알린다" 로 막았다.
  → v3.8 에서 **사무실 서버 자체를 걷어냈다.** 요청이 없으니 폭주도 없다.
     그래서 지금 검사는 "서버 요청이 되살아나지 않았는지" 를 본다.

실행: python3 tests/test_report_draft.py
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  — " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


print("새 리포트 / 리포트 수정 분리")

report = read("web/js/views/report.js")

check(
    "임시보관 칸이 새 리포트용과 수정용으로 나뉘어 있다",
    "const NEW_DRAFT_KEY" in report and "const EDIT_DRAFT_KEY" in report,
)

check(
    "두 칸의 이름이 서로 다르다",
    re.search(r"NEW_DRAFT_KEY\s*=\s*'([^']+)'", report).group(1)
    != re.search(r"EDIT_DRAFT_KEY\s*=\s*'([^']+)'", report).group(1),
)

# 예전 이름을 그대로 두면 두 화면이 다시 한 칸을 쓰게 된다.
check(
    "공용 DRAFT_KEY 는 더 이상 없다",
    not re.search(r"\bconst DRAFT_KEY\b", report),
)

check(
    "무엇을 하는 화면인지는 주소가 정한다",
    "const editMode" in report and "'/report/edit'" in report,
)

# 이 한 줄이 사고의 핵심이었다. editMode 가 아니면 무조건 null 이어야 한다.
m = re.search(r"const editingLink = editMode\s*\?(.*?);\n", report, re.S)
check("수정 화면이 아니면 고칠 줄이 없다 (editingLink = null)",
      bool(m) and re.search(r":\s*null\s*$", m.group(1).strip()) is not None,
      m.group(1).strip() if m else "editingLink 를 찾지 못했습니다")

check(
    "이력의 [수정] 은 수정 주소로 간다",
    "{ edit: true });" in report
    and re.search(r"edit: true \}\);\s*\n\s*closeModal\(\);\s*\n\s*location\.hash = '#/report/edit';",
                  report) is not None,
)

check(
    "이력의 [이어서 작성] 은 새 리포트 주소로 간다",
    re.search(r"seedFromEntry\(entry\);\s*\n\s*closeModal\(\);\s*\n\s*location\.hash = '#/report/new';",
              report) is not None,
)

check(
    "임시보관을 읽고 쓰고 지우는 곳이 모두 그때그때의 칸(draftKey)을 쓴다",
    "localStorage.setItem(draftKey" in report
    and "localStorage.removeItem(draftKey)" in report
    and "localStorage.getItem(DRAFT_KEY)" not in report,
)

app = read("web/js/app.js")
check(
    "라우터가 /report/edit 를 안다",
    re.search(r"\^\\/report\\/\(new\|edit\)\$", app) is not None,
    "라우터에 수정 주소가 없으면 [수정] 을 눌러도 빈 화면이 뜬다",
)

print()
print("요청 폭주 방지")

sync = read("web/js/sync.js")

check(
    # v3.8: 사무실 서버를 아예 쓰지 않게 되면서 폭주의 원인 자체가 사라졌다.
    # "값이 바뀔 때만 알린다" 보다 **요청 자체가 없다** 가 더 강한 보장이다.
    "앱이 사무실 서버에 요청하지 않는다",
    "function request(" not in sync and "serverRequest" not in sync,
    "서버 요청이 되살아나면 그때 폭주도 함께 돌아온다",
)

check(
    "요청이 끝날 때마다 무조건 알리던 줄이 없다",
    "serverReachable = true; emit();" not in sync
    and "serverReachable = false; emit();" not in sync,
)

syncnow = read("web/js/syncnow.js")
check(
    "동시에 들어온 상태 확인은 한 번만 물어본다",
    "let inFlight" in syncnow and "if (!inFlight) inFlight =" in syncnow,
)

check(
    "서버에 상태를 물어보는 함수가 없다",
    "export async function state()" not in sync,
    "이 함수가 화면을 열 때마다 서버를 불러 느렸다 — 이제 물어볼 서버가 없다",
)

print()
print("화면을 먼저 그리고 나중에 갱신한다")

inventory = read("web/js/views/inventory.js")
check(
    "재고: 시트를 기다렸다가 그리지 않는다",
    "if (sheetMode && isOnline()) {\n    try { await pullInventory(); }" not in inventory,
)
check(
    "재고: 그린 뒤에 시트를 받아 다시 그린다",
    "try { await pullInventory(); } catch { return; }" in inventory,
)
check(
    "재고: 창이 열려 있으면 다시 그리지 않는다 (적던 내용이 날아간다)",
    "getElementById('modalRoot').innerHTML) return;" in inventory,
)
check(
    "이력: 받아 둔 것으로 먼저 보여 준다",
    "await load({ refresh: false });" in report,
)
check(
    "이력: 최신본 받기가 화면 전환을 붙잡지 않는다",
    re.search(r"\(async \(\) => \{\s*\n\s*try \{ await load\(\{ refresh: true \}\); \}", report) is not None,
)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과")
