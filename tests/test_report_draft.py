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
     그래서 지금 검사는 "서버 요청이 되살아나지 않았는지" 를 본다
     (서버 요청 함수가 없는지는 test_design_contract.py 가 본다).

(43) 파일 이름 · 줄 모양에 묶이지 않는다 (tests/_src.py). 이력 상세의 [수정] · [삭제] 만 ·
매장별 이력의 [이 매장 새 리포트] · 이력을 받는 동안 먼저 그리기 · 오프라인에서 받아 둔 이력은
e2e(report · v3362 · v346) 가 실제로 눌러 본다.

실행: python3 tests/test_report_draft.py
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _src import JS, body, calls, has, has_re, module_of  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  — " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


print("새 리포트 / 리포트 수정 분리")

# v3.22 — 칸을 나누는 대신 **되살리기 자체를 없앴다.**
# 이미 시트에 올린 건의 내용까지 되살아나, 끝난 리포트를 다시 쓰고 있는 것처럼
# 보였다. 새 리포트는 언제나 빈 화면에서 시작한다. (v3.35 의 [이어 쓰기] 는 따로 — e2e v335)
check(
    "작성 내용을 옛 칸(localStorage)에 담아 두지 않는다",
    not has_re(r"localStorage\.setItem\(\s*['\"]bh_report_(edit_)?draft") and not has("saveDraft"),
)

check(
    "옛 버전이 남긴 칸은 화면을 열 때 지운다",
    has("'bh_report_draft'") and has("'bh_report_edit_draft'")
    and has_re(r"for\s*\(\s*const\s+(\w+)\s+of\s+\w+\s*\)\s*localStorage\.removeItem\(\s*\1\s*\)"),
)

check(
    "'복구했습니다' 띠가 없다",
    not has("작성 중이던 내용을 복구했습니다") and not has("clear-draft"),
)

check("무엇을 하는 화면인지는 주소가 정한다", has_re(r"===\s*'/report/edit'"))

# 이 한 줄이 사고의 핵심이었다. 수정 화면이 아니면 무조건 null 이고,
# 고칠 줄은 이력에서 넘겨받은 것 하나뿐이다. 기기에 담아 둔 것을 주워 오면
# 다른 줄을 고치러 들어왔을 때 엉뚱한 줄을 덮어쓸 수 있다.
m = re.search(r"\bconst\s+\w+\s*=\s*\w+\s*\?\s*\(\(\s*\w+\s*&&\s*\w+\.sheetLink\s*\)\s*\|\|\s*null\s*\)\s*:\s*(\w+)\s*;", JS)
check("수정 화면이 아니면 고칠 줄이 없다 · 고칠 줄은 이력에서 넘겨받은 것만",
      bool(m) and m.group(1) == "null",
      m.group(0) if m else "sheetLink 를 고르는 줄을 찾지 못했습니다")

check(
    "이력의 [수정] 은 수정 주소로 간다",
    has_re(r"seedFromEntry\([^)]*\{\s*edit\s*:\s*true\s*\}\s*\)") and has_re(r"location\.hash\s*=\s*'#/report/edit'"),
)

check(
    "라우터가 /report/edit 를 안다",
    has_re(r"\^\\/report\\/\(new\|edit\)\$"),
    "라우터에 수정 주소가 없으면 [수정] 을 눌러도 빈 화면이 뜬다",
)

print()
print("요청 폭주 방지")

check("요청이 끝날 때마다 무조건 알리던 줄이 없다", not has("serverReachable"))

check(
    "동시에 들어온 상태 확인은 한 번만 물어본다",
    has_re(r"if\s*\(\s*!\s*(\w+)\s*\)\s*\1\s*=", body("refreshState")),
)

check(
    "서버에 상태를 물어보는 함수가 없다",
    not has_re(r"export\s+async\s+function\s+state\s*\("),
    "이 함수가 화면을 열 때마다 서버를 불러 느렸다 — 이제 물어볼 서버가 없다",
)

print()
print("화면을 먼저 그리고 나중에 갱신한다")

inventory = module_of("inventoryView")
check("재고: 시트를 기다렸다가 그리지 않는다", bool(inventory) and not has_re(r"await\s+pullInventory\(", inventory))
# v3.22 — 화면을 연 뒤 뒤에서 받아 다시 그리던 것을 **없앴다.**
# 검색칸에 글자를 치거나 목록을 내려 본 뒤에 그 일이 벌어지면 다 날아갔다.
check("재고: 저절로 받아 와 다시 그리지 않는다", "pullInventory" not in inventory)
check("재고: 화면마다 따로 받는 버튼이 없다 — 위 [새로고침] 하나가 받는다 (v3.49)",
      "sheet-refresh" not in inventory)


# ── 3. 앱을 열 때 시트를 기다리지 않는다 (v3.14) ──────────────────────
#
# 예전에는 부팅에서 `await ensureFirstData()` 가 끝날 때까지 첫 화면을 그리지
# 않았고, 그 안에서 시트를 **세 번 차례로** 불렀다. 왕복 1.2초 회선에서 3.7초,
# LTE(2.5초)에서는 7.5초 동안 빈 화면이었다. 웹 페이지를 새로고침하거나 앱을
# 켤 때마다 그랬다. 재봐서 3,658ms -> 41ms 가 됐다.
print()
print("== 3. 앱을 열 때 시트를 기다리지 않는가")

boot = re.search(r"await\s+ensureFirstData\(\)(.*?)catchUpFromSheet\(\)", JS, re.S)
check("부팅: 화면을 먼저 그린다", bool(boot) and "render()" in boot.group(1))
check("부팅: 시트 받기를 기다리지 않는다",
      bool(calls("catchUpFromSheet")) and not has_re(r"await\s+catchUpFromSheet\("))
prep = body("ensureFirstData")
check("부팅 준비에는 시트 호출이 없다",
      bool(prep) and not has_re(r"pull\w*\(|callAppsScript\(", prep))
catch_up = body("catchUpFromSheet")
check("시트 받기 세 가지를 동시에 부른다 (차례로 부르면 왕복이 3배)",
      has_re(r"Promise\.all\(\s*\[[^\]]*pullFields\(", catch_up))
check("달라진 것이 있을 때만 다시 그린다",
      has_re(r"typeof\s+\w+\.changed\s*===\s*'boolean'")
      and "hashchange" in catch_up and re.search(r"if\s*\(", catch_up) is not None)
check("재고 받기가 바뀐 게 있는지 알려 준다",
      has_re(r"return\s+(?:\w+\.)?applyInventorySheet\(", module_of("pushInventory")))
check("시트 내용이 그대로면 저장소를 다시 쓰지 않는다",
      has_re(r"changed\s*:\s*false", body("applyInventorySheet")) and "signature" in body("applyInventorySheet").lower())
# 5분마다·앱으로 돌아올 때마다 조용히 받아 와 화면을 다시 그렸다.
# 적는 중이거나 한참 내려 본 뒤였으면 하던 것을 처음부터 다시 해야 했다.
check("받기가 시간마다 저절로 돌지 않는다",
      not has("AUTO_REFRESH_MS") and not has_re(r"setInterval\([^;]*runRefresh"))
check("앱으로 돌아올 때도 저절로 받지 않는다 (칩만 맞춘다)",
      has_re(r"visibilityState\s*===\s*'visible'\s*\)\s*refreshState\(\)"))
history = module_of("reportListView")
check("이력: 방금 받았으면 다시 받지 않는다", has_re(r"<\s*(60000|60\s*\*\s*1000)\s*\)\s*return", history))
check("이력: 목록이 그대로면 다시 그리지 않는다",
      has_re(r"(\w+)\(\s*\w+\.entries\s*\)\s*===\s*\w+", history))

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과")
