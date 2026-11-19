"""리포트 이력(C안) 계약 검사.

이력 화면은 세 조각이 서로 맞아야 동작한다.
  1) google-apps-script.gs  — 월별 탭을 읽어 주고 상태 칸을 고쳐 쓰는 처리
  2) web/js/reportsheet.js  — 그 요청을 보내는 앱 쪽 창구
  3) web/js/sheets.js       — 첨부를 드라이브로 보내고 '상태' 열을 함께 만드는 전송

(43) 예전에는 양쪽이 같은 이름 · 같은 낱말을 쓰는지를 글자로 고정했다. 지금은
test_apps_script.mjs 가 .gs 를 가짜 시트에서 실제로 돌리고(월 목록 · 읽기 · 상태 · 첨부 ·
공개 실패 수), e2e(report · v3362 · v346 · upload) 가 앱에서 이력을 받고 상태를 바꾸고
첨부를 올려 본다. 여기는 그 밖의 것만 — 파일 이름 · 줄 모양에 묶이지 않게 (tests/_src.py).

소스에 섞여 든 NUL(0x00) 문자도 함께 잡는다. 이 저장소에서 두 번 발생했고
(.gs 편집 중 1회, store.js 1회) Apps Script 편집기가 저장을 거부하거나
git 이 파일을 바이너리로 취급해 diff 를 볼 수 없게 된다.

실행: python3 tests/test_report_history.py
"""

import io
import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _src import (CSS_FILES, GS_FILES, JS, JS_FILES, ROOT, calls, count, defines, has,  # noqa: E402
                  has_re, module_of)

failures = []


def check(label, ok, detail=""):
    print(f"{'✅' if ok else '❌'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


print("=" * 62)
print("리포트 이력(C안) 계약 검사")
print("=" * 62)

rs = module_of("pushStatusOps")        # 이력 창구 (reportsheet)
sheets = module_of("seedStatus")       # 시트로 보내는 전송 (sheets)
sync_mod = module_of("flushOutbox")
history = module_of("reportListView")  # 이력 화면
check("이력 창구 · 전송 · 이력 화면이 있다", all([rs, sheets, sync_mod, history]))

# ---------------------------------------------------------- Apps Script 쪽
# 월 목록 · 읽기 · 상태 · 첨부 · 링크 공개 는 test_apps_script.mjs 가 돌려 본다.
check("상태 쓰기에 잠금이 걸려 있다 (동시 변경 대비)", has_re(r"LockService\.\w+\(", "gs"))
check("표시값으로 읽는다 (날짜가 숫자로 오지 않도록)", has_re(r"getDisplayValues\(", "gs"))

# ------------------------------------------------------------- 앱 쪽 창구
# months · pull · status 요청과 오프라인 사본은 e2e(report · v3362 · v346) 가 본다.
check("오프라인 상태 변경을 대기열에 넣는다", has("'report-status'", rs) and has_re(r"enqueue\(", rs))
check("드라이브 파일 id 를 뽑아 썸네일 주소를 만든다", defines("driveId") and defines("thumbUrl"))
check("줄 순서가 아니라 작성일시로 정렬한다 (시트에서 정렬해도 안전)",
      has_re(r"\.sort\([^;]*createdAt", rs))

# --------------------------------------------------------------- 전송 형식
# '상태' 열 · 상태 넷 · 첨부를 드라이브로는 e2e(report · upload) 가 실제로 본다.
for value in ("조치 완료", "모니터링", "조치 진행 중", "교체 예정"):
    check(f"상태 '{value}' 가 있다", has(f"'{value}'"))
check("첫 상태를 [처리 결과]에서 가져온다", defines("seedStatus") and bool(calls("seedStatus")))
check("[처리 결과]를 덮지 않고 따로 둔다 (열이 분리돼 있다)",
      has_re(r"const\s+\w+\s*=\s*\{[^}]*'[^']+'\s*:\s*'(조치 완료|모니터링|조치 진행 중|교체 예정)'"))

# ------------------------------------------------------------ 대기열 처리
check("자동 올리기가 밀린 상태 변경을 시트에 반영한다",
      has("'report-status'", sync_mod) and bool(calls("pushStatusOps")))
check("같은 줄의 상태는 마지막 것만 남긴다",
      has_re(r"\$\{\s*\w+\.sheetName\s*\}#\$\{\s*\w+\.row\s*\}", module_of("outbox")))

# ----------------------------------------------------------------- 화면
check("이력 화면에 상태별 건수 칩 · 타일이 필터로 동작한다",
      has("hist-chips") and has('data-act="filter"'))
check("검색이 식당명과 날짜를 함께 본다", has_re(r"\w+\.store\b", history) and has_re(r"\w+\.date\b", history))
check("월 선택기가 있다", has('id="histMonth"'))

# ------------------------------------------------- 소스에 NUL 이 없는지 (화면 코드 · 스타일 · .gs 전부)
nul = [rel for rel in list(JS_FILES) + list(CSS_FILES) + list(GS_FILES)
       if b"\x00" in open(os.path.join(ROOT, rel), "rb").read()]
check("소스에 NUL 문자가 없다", not nul, ", ".join(nul))


# ── 동영상 첨부 — 한도를 고르는 순간 알려 준다 (v3.15) ─────────────────
#
# 첨부는 시트 웹 앱에 한 번의 요청으로 실려 가서 파일당 20MB · 리포트 25MB 가
# 기술 한계다. 예전에는 넘는 파일을 저장할 때 조용히 건너뛰어서, 현장에서 찍은
# 동영상이 빠진 것을 사무실에서야 알았다. 시간(초) 기준 문구는 화질에 따라
# 거짓이 되므로 용량 기준으로 적고 초 환산은 참고로만 붙인다.
print()
print("── 동영상 첨부")
check("한도를 한 곳에서 정한다 (화면과 전송이 같은 숫자를 쓴다)",
      count("const MEDIA_FILE_LIMIT =") == 1 and count("const MEDIA_TOTAL_LIMIT =") == 1
      and not has("20 * 1024 * 1024"))
check("[영상 촬영] 타일이 있다", has_re(r"tile\(\s*'record'"))
check("동영상 촬영 입력은 카메라를 바로 연다",
      has_re(r'<input(?=[^>]*id="mediaRecord")(?=[^>]*accept="video/\*")(?=[^>]*capture="environment")'))
check("고르는 순간 크기를 확인한다 (저장 때 조용히 빼지 않는다)",
      defines("tooBigReason") and bool(calls("tooBigReason"))
      and has_re(r"if\s*\(\s*\w+\s*\)\s*\{\s*toast\(\s*\w+\s*,\s*'err'\s*\)\s*;\s*continue\s*;"))
# 작성 화면을 여러 파일로 나눠도 — 크기를 재는 첫 자리 바로 앞(같은 함수 안)에서 사진을 줄인다
_size = re.search(r"(?<!function )tooBigReason\(", JS)
check("사진은 줄인 뒤 크기로 판단한다",
      bool(_size) and "shrinkImage(" in JS[max(0, _size.start() - 300):_size.start()])
check("리포트 전체 한도도 고르는 순간 확인한다",
      has_re(r"\+\s*\w+\.size\s*>\s*MEDIA_TOTAL_LIMIT"))
check("붙인 첨부에 크기를 남긴다 (전체 한도 계산용)",
      has_re(r"originalName\s*:\s*\w+\.originalName\s*,\s*size\s*:\s*\w+\.size"))
# 20초는 카메라가 실제로 멈추는 한도다(MainActivity 의 EXTRA_DURATION_LIMIT).
# 그래서 시간 안내를 써도 거짓이 아니다. 용량 한도는 그대로 함께 적는다.
# v3.23 — 설명은 한 줄로 줄였지만 한도 둘은 그대로 적는다 (거짓이 아니어야 한다).
# v3.36 — 고화질로 1분 찍고 APK 가 720p · 2.2Mbps 로 줄인다 (1분 ≈ 17MB, 파일당 25MB 안)
_main = read("android", "app", "src", "main", "java", "com", "beyondhoneycomb", "fieldportal", "MainActivity.java")
_vc = read("android", "app", "src", "main", "java", "com", "beyondhoneycomb", "fieldportal", "VideoCompressor.java")
check("안내 문구에 진짜 한도 둘(최대 1분 · 파일당 25MB)이 함께 있다",
      has("영상 최대 1분 · 파일 ${MEDIA_FILE_LIMIT_TEXT}")
      and "EXTRA_DURATION_LIMIT, VIDEO_SECONDS_LIMIT" in _main
      and "VIDEO_SECONDS_LIMIT = 60" in _main
      and has("MEDIA_FILE_LIMIT = 25 * 1024 * 1024"))
check("영상은 고화질로 찍고 앱이 720p · 2.2Mbps 로 줄인다",
      "EXTRA_VIDEO_QUALITY, 1" in _main and "VideoCompressor.needsWork(this, picked)" in _main
      and "VIDEO_BITRATE = 2_200_000" in _vc and "SHORT_SIDE = 720" in _vc
      and "FILE_LIMIT = 25L * 1024 * 1024" in _vc and "MAX_DURATION_MS = 60_000L" in _vc)
check("전송이 공개 실패 수와 동영상 수를 화면에 넘긴다",
      has_re(r"mediaPrivate\s*:") and has_re(r"mediaVideos\s*:"))
check("동영상이 비공개로 남으면 화면이 알린다 (사진과 달리 우회가 없다 · 새로 쓰기와 다시 올리기 둘 다)",
      defines("warnPrivateVideo") and len(calls("warnPrivateVideo")) >= 2)

print("=" * 62)
if failures:
    print(f"❌ 실패 {len(failures)}건: {', '.join(failures)}")
    sys.exit(1)
print("✅ 전부 통과 — 이력 화면과 Apps Script 가 같은 계약을 씁니다.")
