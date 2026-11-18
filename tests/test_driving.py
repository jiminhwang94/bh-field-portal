"""차량 운행 일지 — 화면 · 저장 · 시트가 같은 서식을 쓰는지.

국세청 '법인 차량 운행 일지' 서식의 항목 번호(①~⑩)를 세 곳이 똑같이 써야
연말에 시트 탭을 그대로 인쇄해 낼 수 있다. 한 곳만 어긋나면 제출 직전에야
알게 된다 — 그래서 여기서 이음새를 본다.

(43) 파일 이름 · 줄 모양에 묶이지 않는다 (tests/_src.py). 시트 쪽 서식 · 차량별 탭 ·
⑦ 다시 세기 · 날짜 읽기는 test_apps_script.mjs 가, 화면에서 적고 고르는 것은
e2e(v335 · v343 · v344 · v3441) 가 실제로 돌려 본다. 여기는 그 밖의 이음새만.

실행: python tests/test_driving.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _src import body, calls, defines, has, has_re, module_of  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


view = module_of("drivingView")            # 운행일지 화면을 맡은 모듈
sheet = module_of("pullDriving")           # 시트와 주고받는 모듈
sync_mod = module_of("flushOutbox")        # 자동 올리기
check("운행일지 화면 · 시트 창구 · 자동 올리기가 있다", bool(view) and bool(sheet) and bool(sync_mod))

print("== 1. 서식의 항목을 그대로 쓴다")
# 서식 그대로여야 세무 담당자가 한 칸씩 맞춰 볼 수 있다. (시트 머리줄은 test_apps_script.mjs)
missing = [item for item in ["③사용일자", "④부서", "⑤주행 전", "⑥주행 후", "⑦주행거리",
                             "⑧출발지", "⑨도착지", "⑩비고", "①차종", "②자동차등록번호"]
           if not has(item)]
check("화면에 서식의 ①~⑩ 항목이 있다", not missing, ", ".join(missing))
check("법인명 · 사업자등록번호가 양식의 값 그대로다", has("'비욘드허니컴'") and has("697-86-01767"))

print()
print("== 2. 차량마다 한 장")
check("차량 탭으로 고른다", has_re(r'class="veh-tabs') and has_re(r"act\s*===\s*'vehicle'"))
check("한 차량을 올릴 때 차량 이름을 함께 보낸다 (다른 차량 탭은 시트가 지킨다)",
      has_re(r"driving\s*:\s*'push'") and has_re(r"vehicleName\s*:", body("pushDriving")))
check("기기 저장소도 차량으로 나눠 찾는다",
      has("driving: { keyPath: 'id', indexes: [['vehicleName', 'vehicleName']] }"))
# 저장소를 새로 만들었으면 번호를 올려야 이미 쓰던 기기에도 생긴다.
_db = re.search(r"DB_VERSION\s*=\s*(\d+)", module_of("DB_VERSION"))
check("저장소 번호를 올렸다 (이미 쓰던 기기에도 생기게)", bool(_db) and int(_db.group(1)) >= 2)

print()
print("== 3. 요청한 다섯 가지")
# ① 사용일자 자동
check("사용일자에 오늘이 미리 들어간다", defines("today") and has_re(r"\?\s*\w+\.date\s*:\s*(\w+\.)?today\(\)"))
check("요일도 함께 적는다 (서식의 (요일) 칸)", defines("weekdayOf") and "weekdayOf(" in view)
# ② 부서 선택 + 만들기/고치기/지우기
check("부서는 고르는 칸이다", has_re(r'<select\b[^>]*id="drvDept"'))
check("부서 · 장소를 만들고 고치고 지울 수 있다",
      has_re(r"optionListHtml\(\s*'depts'") and has_re(r"optionListHtml\(\s*'places'")
      and has('data-oact="edit"') and has('data-oact="del"') and has_re(r'data-add="\$\{'))
# ③ 숫자에 쉼표 (쉼표 붙은 값을 숫자로 저장하는 것은 e2e v335 가 1,000 → 1,042 = 42㎞ 로 본다)
check("치는 대로 쉼표가 붙는다",
      defines("formatOdoInput")
      and has_re(r"addEventListener\(\s*'input'[^;]*formatOdoInput\("))
# 값을 다시 넣으면 커서가 맨 뒤로 튄다 — 가운데를 고치던 사람이 엉뚱한 자리에 친다.
check("쉼표를 붙여도 커서가 제자리에 남는다", "setSelectionRange(" in body("formatOdoInput"))
# ④ 주행거리 자동
check("주행거리는 ⑥−⑤ 로 화면에서도 저절로 채워진다",
      has_re(r"addEventListener\(\s*'input'[^;]*formatOdoInput\(\s*\w+\s*\)\s*;\s*\w+\(\)"))
check("주행거리 칸은 사람이 못 고친다", has_re(r'readonly\s+aria-readonly="true"', view))
# ⑤ 출발지·도착지 — 고르기도 되고 직접 쓰기도 된다 (태그 · 최근 5곳 · 비슷한 곳은 e2e v344)
# 같은 것을 고르는 길이 둘이면(목록 + 태그) 칸을 누를 때 목록이 태그를 가린다.
check("출발지·도착지에 고르는 목록(datalist)을 두지 않는다",
      "<datalist" not in view and not has_re(r'\blist="', view))
# 직접 친 곳을 기억하지 않으면 자주 가는 곳을 매번 다시 쳐야 한다.
check("직접 친 곳은 다음부터 고를 수 있게 기억한다",
      defines("rememberPlaces") and bool(calls("rememberPlaces")))

print()
print("== 4. 틀린 장부가 남지 않게")
# 빈 칸을 Number() 에 넣으면 0 이 된다 — 0㎞ 기록이 조용히 저장됐었다.
check("빈 칸은 0 이 아니다", has_re(r"if\s*\(\s*!\s*\w+\s*\)\s*return\s+null", module_of("saveDriving")))
check("계기판이 거꾸로면 막고 이유를 말한다", has("주행 후 거리가 주행 전보다 작습니다"))
check("계기판은 이어진다 — 지난번 ⑥이 다음 ⑤에 들어간다",
      defines("lastOdometer") and has_re(r"\w+\s*===\s*null\s*\?\s*''\s*:\s*\w+", view))

print()
print("== 5. 오프라인 · 팀 공유")
check("적으면 대기열에 쌓였다가 시트로 올라간다",
      has_re(r"type\s*:\s*'drivesheet-push'") and "'drivesheet-push'" in sync_mod
      and "pushDriving(" in sync_mod)
check("차량별로 묶어 한 번씩 올린다 (탭이 다르므로)", has_re(r"\.vehicleName\b", sync_mod))
check("선택지를 일지보다 먼저 올린다",
      "pushOptions(" in sync_mod and "pushDriving(" in sync_mod
      and sync_mod.index("pushOptions(") < sync_mod.index("pushDriving("))
check("올릴 내용 화면에서 되돌릴 수 있다",
      has_re(r"\.type\s*===\s*'drivesheet-push'")
      and has_re(r"restoreRows\(\s*'driving'"))
# 시트 것으로 덮으면 방금 적은 것이 사라진다.
check("못 올린 내 변경이 있으면 받지 않는다", has_re(r"skipped\s*:\s*'pending'", sheet))
check("시트가 비어 있어도 기기 것을 지우지 않는다",
      has_re(r"if\s*\(\s*!\s*\w+\.length\s*&&\s*!\s*\w+\s*\)\s*return\s*\{\s*changed", sheet))
check("받은 차량 범위 안에서만 견준다 (다른 차량을 지우지 않게)",
      has_re(r"\.includes\(\s*\w+\.vehicleName\s*\)", sheet))
# 화면에서는 이 사실을 글로 말하지 않는다 (v3.23 — 설명 문구 정리). 동작으로만 지킨다.
check("선택지는 팀 공통이다 (시트 [운행일지 항목] 탭으로 올린다)",
      has_re(r"type\s*:\s*'drivesheet-options'") and defines("pushOptions"))

print()
print("== 6. 화면에 붙어 있다 (주소 · 오프라인 캐시는 e2e · test_offline_shell 이 본다)")
check("왼쪽 레일에 [운행일지] 가 있다",
      has_re(r'data-tab="driving"[^>]*href="#/driving"', "html") and has("운행일지", "html"))
check("레일 표시가 운행일지에서 켜진다", has_re(r"startsWith\(\s*'/driving'\s*\)\s*\?\s*'driving'"))

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 운행 일지가 서식과 어긋나지 않습니다.")
