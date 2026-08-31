"""리포트 이력(C안) 계약 검사.

이력 화면은 세 조각이 서로 맞아야 동작한다.
  1) google-apps-script.gs  — 월별 탭을 읽어 주고 상태 칸을 고쳐 쓰는 처리
  2) web/js/reportsheet.js  — 그 요청을 보내는 앱 쪽 창구
  3) web/js/sheets.js       — 첨부를 드라이브로 보내고 '상태' 열을 함께 만드는 전송

Apps Script 는 구글 서버에서만 도는 코드라 여기서 실행할 수 없다.
대신 **양쪽이 같은 이름·같은 낱말을 쓰고 있는지**를 고정한다.
한쪽만 고치고 재배포하면 이력 화면이 통째로 비는 종류의 사고를 막는 것이 목적이다.

소스에 섞여 든 NUL(0x00) 문자도 함께 잡는다. 이 저장소에서 두 번 발생했고
(.gs 편집 중 1회, store.js 1회) Apps Script 편집기가 저장을 거부하거나
git 이 파일을 바이너리로 취급해 diff 를 볼 수 없게 된다.

실행: python3 tests/test_report_history.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
failures = []


def check(label, ok, detail=""):
    print(f"{'✅' if ok else '❌'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def read(*parts):
    return open(os.path.join(ROOT, *parts), encoding="utf-8").read()


print("=" * 62)
print("리포트 이력(C안) 계약 검사")
print("=" * 62)

gs = read("google-apps-script.gs")
sheet_js = read("web", "js", "reportsheet.js")
sheets_js = read("web", "js", "sheets.js")
sync_js = read("web", "js", "sync.js")
view_js = read("web", "js", "views", "report.js")
store_js = read("web", "js", "local", "store.js")

# ---------------------------------------------------------- Apps Script 쪽
check("Apps Script 가 reports 요청을 받는다", "body.reports" in gs)
check("Apps Script 에 handleReports 가 있다", "function handleReports" in gs)
for action in ("months", "pull", "status"):
    check(f"reports '{action}' 처리가 있다", f"'{action}'" in gs)
check("월별 탭을 읽는 readReportSheet 가 있다", "function readReportSheet" in gs)
check("'상태' 열을 찾는 statusColumn 이 있다", "function statusColumn" in gs)
check("첨부를 드라이브에 넣는 saveMediaToDrive 가 있다",
      "function saveMediaToDrive" in gs)
check("드라이브 링크를 '링크가 있는 사람은 보기' 로 연다",
      "ANYONE_WITH_LINK" in gs)
check("상태 쓰기에 잠금이 걸려 있다 (동시 변경 대비)",
      "handleReports" in gs and "LockService" in gs)
check("표시값으로 읽는다 (날짜가 숫자로 오지 않도록)",
      "getDisplayValues" in gs)

# ------------------------------------------------------------- 앱 쪽 창구
for action in ("'months'", "'pull'", "'status'"):
    check(f"reportsheet.js 가 reports {action} 를 보낸다",
          f"reports: {action}" in sheet_js)
check("오프라인이면 마지막으로 받아 둔 내용을 쓴다", "fromCache" in sheet_js)
check("오프라인 상태 변경을 대기열에 넣는다",
      "report-status" in sheet_js and "enqueue" in sheet_js)
check("드라이브 파일 id 를 뽑아 썸네일 주소를 만든다",
      "driveId" in sheet_js and "thumbnail?id=" in sheet_js)
check("줄 순서가 아니라 작성일시로 정렬한다 (시트에서 정렬해도 안전)",
      "createdAt" in sheet_js and ".sort(" in sheet_js)

# --------------------------------------------------------------- 전송 형식
check("시트 헤더 맨 뒤에 '상태' 열을 만든다", "STATUS_HEADER" in sheets_js)
check("상태 4종이 정의돼 있다", "STATUS_VALUES" in sheets_js)
for value in ("조치 완료", "모니터링", "조치 진행 중", "교체 예정"):
    check(f"상태 '{value}' 가 있다", value in sheets_js)
check("첫 상태를 [처리 결과]에서 가져온다", "seedStatus" in sheets_js)
check("[처리 결과]를 덮지 않고 따로 둔다 (열이 분리돼 있다)",
      "RESULT_TO_STATUS" in sheets_js)
check("첨부를 media 로 보낸다 (시트 삽입이 아니라 드라이브)",
      "media," in sheets_js and "mediaSkipped" in sheets_js)
check("첨부 용량 상한이 있다",
      "MEDIA_FILE_LIMIT" in sheets_js and "MEDIA_TOTAL_LIMIT" in sheets_js)

# ------------------------------------------------------------ 대기열 처리
check("sync.js 가 밀린 상태 변경을 시트에 반영한다",
      "report-status" in sync_js and "pushStatusOps" in sync_js)
check("같은 줄의 상태는 마지막 것만 남긴다", "lastStatusByRow" in store_js)

# ----------------------------------------------------------------- 화면
check("이력 화면에 상태별 건수 타일이 있다", "hist-tile" in view_js)
check("타일이 필터로 동작한다", "data-act=\"filter\"" in view_js)
check("검색이 식당명과 날짜를 함께 본다",
      "e.store" in view_js and "e.date" in view_js)
check("월 선택기가 있다", "histMonth" in view_js)

# ------------------------------------------------- 소스에 NUL 이 없는지
for rel in ("google-apps-script.gs",
            os.path.join("web", "js", "reportsheet.js"),
            os.path.join("web", "js", "sheets.js"),
            os.path.join("web", "js", "local", "store.js"),
            os.path.join("web", "js", "views", "report.js")):
    raw = open(os.path.join(ROOT, rel), "rb").read()
    check(f"{rel} 에 NUL 문자가 없다", b"\x00" not in raw,
          "" if b"\x00" not in raw else f"{raw.count(chr(0).encode())}개 발견")

print("=" * 62)
if failures:
    print(f"❌ 실패 {len(failures)}건: {', '.join(failures)}")
    sys.exit(1)
print("✅ 전부 통과 — 이력 화면과 Apps Script 가 같은 계약을 씁니다.")
