"""차량 운행 일지 — 화면 · 저장 · 시트가 같은 서식을 쓰는지.

국세청 '법인 차량 운행 일지' 서식의 항목 번호(①~⑩)를 세 곳이 똑같이 써야
연말에 시트 탭을 그대로 인쇄해 낼 수 있다. 한 곳만 어긋나면 제출 직전에야
알게 된다 — 그래서 여기서 이음새를 본다.

실행: python tests/test_driving.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


gs = read("google-apps-script.gs")
view = read("web", "js", "views", "driving.js")
store = read("web", "js", "local", "store.js")
sheet = read("web", "js", "drivesheet.js")
api = read("web", "js", "api.js")
app = read("web", "js", "app.js")
index = read("web", "index.html")
sw = read("web", "sw.js")
idb = read("web", "js", "local", "idb.js")
sync = read("web", "js", "sync.js")
pending = read("web", "js", "pending.js")

print("== 1. 서식의 항목을 그대로 쓴다")
# 서식 그대로여야 세무 담당자가 한 칸씩 맞춰 볼 수 있다.
for item in ["③사용일자", "④부서", "⑤주행 전", "⑥주행 후", "⑦주행거리",
             "⑧출발지", "⑨도착지", "⑩비고"]:
    check(f"화면에 {item} 이 있다", item in view)
check("시트 머리줄도 같은 항목이다",
      "'③사용일자', '요일', '④부서', '성명'," in gs
      and "'⑤주행 전 계기판의 거리(㎞)', '⑥주행 후 계기판의 거리(㎞)', '⑦주행거리(㎞)'," in gs)
check("①차종 ②자동차등록번호를 차량마다 적어 둔다",
      "①차종" in view and "②자동차등록번호" in view
      and "'①차종'" in gs and "'②자동차등록번호'" in gs)
check("법인명 · 사업자등록번호가 양식의 값 그대로다",
      "'비욘드허니컴'" in view and "'697-86-01767'" in view
      and "COMPANY_NAME = '비욘드허니컴'" in gs
      and "COMPANY_BIZ_NO = '697-86-01767'" in gs)

print()
print("== 2. 차량마다 한 장")
check("차량 탭으로 고른다", 'class="veh-tabs"' in view and "act === 'vehicle'" in view)
check("시트도 차량마다 탭 하나다", "DRIVING_PREFIX = '운행일지 '" in gs)
check("탭 이름에 못 쓰는 글자를 걸러 낸다", "function drivingSheetName(" in gs)
check("한 차량을 올릴 때 다른 차량 탭은 건드리지 않는다",
      "driving: 'push'," in sheet and "vehicleName: name," in sheet)
check("기기 저장소도 차량으로 나눠 찾는다",
      "driving: { keyPath: 'id', indexes: [['vehicleName', 'vehicleName']] }," in idb)
# 저장소를 새로 만들었으면 번호를 올려야 이미 쓰던 기기에도 생긴다.
check("저장소 번호를 올렸다 (이미 쓰던 기기에도 생기게)", "DB_VERSION = 2;" in idb)

print()
print("== 3. 요청한 다섯 가지")
# ① 사용일자 자동
check("사용일자에 오늘이 미리 들어간다",
      "date = row ? row.date : store.today()" in view and "export function today()" in store)
check("요일도 함께 적는다 (서식의 (요일) 칸)",
      "export function weekdayOf(" in store and "drvWeekday" in view)
# ② 부서 선택 + 만들기/고치기/지우기
check("부서는 고르는 칸이다", 'id="drvDept"' in view and '<select class="select" id="drvDept">' in view)
check("부서를 만들고 고치고 지울 수 있다",
      "optionListHtml('depts'" in view and "data-oact=\"edit\"" in view
      and "data-oact=\"del\"" in view and 'data-add="${kind}"' in view)
# ③ 숫자에 쉼표
check("치는 대로 쉼표가 붙는다",
      "export function formatOdoInput(" in view
      and "box.addEventListener('input', () => { formatOdoInput(box); paintDistance(); });" in view)
# 값을 다시 넣으면 커서가 맨 뒤로 튄다 — 가운데를 고치던 사람이 엉뚱한 자리에 친다.
check("쉼표를 붙여도 커서가 제자리에 남는다",
      "digitsBefore" in view and "setSelectionRange(at, at)" in view)
check("저장할 때는 쉼표를 떼고 숫자로 넣는다",
      "export function unComma(" in view and "odoBefore: unComma(beforeBox.value)" in view)
# ④ 주행거리 자동
check("주행거리는 ⑥−⑤ 로 저절로 채워진다",
      "distance: odoAfter - odoBefore" in store and "const paintDistance = () =>" in view)
check("주행거리 칸은 사람이 못 고친다", "readonly aria-readonly=\"true\"" in view)
check("시트도 ⑦을 다시 계산한다 (앱이 틀린 값을 보내도)",
      "after >= before ? after - before :" in gs)
# ⑤ 출발지·도착지 — 고르기도 되고 직접 쓰기도 된다
check("출발지·도착지는 고르거나 직접 적는다",
      'list="${listId}"' in view and "<datalist id=" in view
      and "placeField('drvFrom', '⑧출발지'" in view)
check("자주 가는 곳은 눌러서 넣는다", "data-place=" in view)
check("장소도 만들고 고치고 지울 수 있다", "optionListHtml('places'" in view)
# 직접 친 곳을 기억하지 않으면 자주 가는 곳을 매번 다시 쳐야 한다.
check("직접 친 곳은 다음부터 고를 수 있게 기억한다",
      "export async function rememberPlaces(" in store
      and "await store.rememberPlaces(row.fromPlace, row.toPlace);" in api)

print()
print("== 4. 틀린 장부가 남지 않게")
# 빈 칸을 Number() 에 넣으면 0 이 된다 — 0㎞ 기록이 조용히 저장됐었다.
check("빈 칸은 0 이 아니다", "if (!text) return null;" in store)
check("계기판이 거꾸로면 막고 이유를 말한다",
      "주행 후 거리가 주행 전보다 작습니다" in store)
check("계기판은 이어진다 — 지난번 ⑥이 다음 ⑤에 들어간다",
      "export async function lastOdometer(" in store and "lastOdo === null ? '' : lastOdo" in view)
check("시트가 날짜로 바꿔 담은 칸도 읽는다", "function drivingDateText(" in gs)

print()
print("== 5. 오프라인 · 팀 공유")
check("적으면 대기열에 쌓였다가 시트로 올라간다",
      "type: 'drivesheet-push'" in store and "drivesheet-push" in sync)
check("차량별로 묶어 한 번씩 올린다 (탭이 다르므로)",
      "const byVehicle = new Map();" in sync)
check("선택지를 일지보다 먼저 올린다",
      sync.index("drivesheet-options") < sync.index("운행일지 ${name}"))
check("올릴 내용 화면에서 되돌릴 수 있다",
      "op.type === 'drivesheet-push'" in pending and "restoreRows('driving', op.changes)" in pending)
# 시트 것으로 덮으면 방금 적은 것이 사라진다.
check("못 올린 내 변경이 있으면 받지 않는다", "skipped: 'pending'" in sheet)
check("시트가 비어 있어도 기기 것을 지우지 않는다",
      "if (!rows.length && !vehicleName) return { changed, added, removed };" in sheet)
check("받은 차량 범위 안에서만 견준다 (다른 차량을 지우지 않게)",
      "scope.includes(r.vehicleName)" in sheet)
check("선택지는 팀 공통이다 (시트 [운행일지 항목] 탭)",
      "DRIVING_OPTION_SHEET = '운행일지 항목'" in gs and "팀 공통" in view)

print()
print("== 6. 화면에 붙어 있다")
check("주소가 있다", "[/^\\/driving$/, () => drivingView(view)]," in app)
check("왼쪽 레일에 [운행일지] 가 있다",
      'data-tab="driving" href="#/driving"' in index and "<span>운행일지</span>" in index)
check("레일 표시가 운행일지에서 켜진다", "path.startsWith('/driving') ? 'driving'" in app)
# 화면 파일이 캐시 목록에 없으면 인터넷이 없을 때 그 화면만 안 열린다.
check("오프라인에서도 열린다 (캐시 목록에 있다)",
      "'./js/views/driving.js'," in sw and "'./js/drivesheet.js'," in sw)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 운행 일지가 서식과 어긋나지 않습니다.")
