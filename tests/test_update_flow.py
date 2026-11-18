"""앱 안 [업데이트] 흐름 — 네 조각이 같은 약속을 지키는지.

빌드 자동화(CI) → Dropbox → 시트 '앱 버전' 탭 → 태블릿 띠 → 안드로이드 다운로드.
조각이 넷이라 하나만 어긋나도 "띠가 안 뜬다" 로만 보인다. 여기서 이음새를 본다.

(43) 화면 코드 · 스타일 · .gs 는 파일 이름 · 줄 모양에 묶이지 않게 본다 (tests/_src.py).
시트 쪽(publish · latest · 버전 비교 · 공개 칸 · 설치 링크 · 고정 주소 · 미리보기 거절)은
test_apps_script.mjs 가 가짜 시트에서 실제로 돌려 본다. 빌드 자동화(.yml) · 안드로이드(.java)
는 다른 검사가 없어 그대로 둔다.

실행: python tests/test_update_flow.py
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _src import HTML, JS, SW, body, calls, css_decls, css_has, defines, has, has_re, module_of  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


ci = read(".github", "workflows", "android.yml")
java = read("android", "app", "src", "main", "java", "com", "beyondhoneycomb", "fieldportal", "MainActivity.java")
manifest = read("android", "app", "src", "main", "AndroidManifest.xml")
update = module_of("checkForUpdate")       # 새 버전 띠 · 설치 링크
settings = module_of("settingsView")
connect = module_of("ensureSheetConnection")
check("업데이트 · 설정 · 시트 연결 모듈이 있다", all([update, settings, connect]))

print("== 1. 빌드 자동화 -> Dropbox -> 시트")
check("버전은 build.gradle 한 곳에서 읽는다", "grep -oP 'appVersionName" in ci and "FieldPortal-v3." not in ci)
check("Dropbox 비밀값이 없으면 건너뛴다 (빌드는 계속)", "ready=no" in ci and "steps.dbx.outputs.ready == 'yes'" in ci)
check("갱신 토큰으로 접근 토큰을 받는다 (만료 없는 방식)", "grant_type=refresh_token" in ci)
check("Dropbox 폴더 이름은 영문이다 (API 헤더는 ASCII 만)", "/FieldPortal/apk/" in ci)
check("공유 링크가 이미 있으면 그것을 쓴다", "list_shared_links" in ci)
check("미리보기(dl=0)가 아니라 바로 내려받기(dl=1) 링크를 적는다", "sed 's/dl=0/dl=1/'" in ci)
check("시트에 release:publish 로 적는다", 'release:"publish"' in ci)
check("시트 기록이 실패하면 빌드가 실패로 뜬다", "jq -e '.ok == true'" in ci)
check("웹 앱 주소는 저장소 변수에서 읽는다", "vars.SHEETS_WEBAPP_URL" in ci)

print()
print("== 2. 시트 (Apps Script) — test_apps_script.mjs 가 publish · latest · 버전 비교 · 공개 칸을 돌려 본다")

print()
print("== 3. 태블릿 화면")
check("띠 자리가 있다", has('id="update-banner"', "html"))
check("띠가 그리드 줄을 차지하고 본문이 한 줄 내려갔다",
      has_re(r"grid-template-rows\s*:\s*auto\s+auto\s+auto\s+minmax\(0,\s*1fr\)", "css")
      and css_has(".update-banner", "grid-row", r"^3$") and css_has(".screen", "grid-row", r"^4$"))
_banner_bg = css_decls(".update-banner").get("background", []) + css_decls(".update-banner").get("background-color", [])
check("띠는 토큰 색만 쓴다", bool(_banner_bg) and all(v.startswith("var(--") for v in _banner_bg), str(_banner_bg))
check("부팅 때 지난 정보로 먼저 그린다", bool(calls("initUpdateBanner")))
check("시트 받은 뒤 버전도 묻는다", "checkForUpdate(" in body("catchUpFromSheet"))
check("[새로고침] 때도 묻는다", "checkForUpdate(" in body("runRefresh"))
check("4분 안에는 다시 묻지 않는다", has_re(r"4\s*\*\s*60\s*\*\s*1000|240000", update))
check("지금 앱보다 높을 때만 띠를 띄운다",
      has_re(r"compareVersions\(\s*\w+\.version\s*,\s*APP_VERSION\s*\)\s*>\s*0"))
check("'나중에' 는 그 버전에만 적용된다", has("bh_update_skip_${"))
check("APK 안이면 안드로이드에 넘긴다", has_re(r"bhupdate:\$\{\s*encodeURIComponent\("))
check("브라우저면 새 탭으로 연다", has_re(r"window\.open\(\s*\w+\.url\s*,\s*'_blank'"))
# 설정을 열면 바로 묻는 것은 e2e ops(최소 버전 막) 가 본다.
check("설정 화면에 최신 여부 한 줄", has('id="appUpdateLine"'))

print()
print("== 4. 안드로이드")
check("웹이 APK 안인지 알 수 있게 UA 에 표식", 'FieldPortalAPK/' in java and has("FieldPortalAPK"))
check("bhupdate: 주소를 가로챈다", '"bhupdate".equals(url.getScheme())' in java)
check("시스템 다운로드 관리자로 받는다", "DownloadManager.Request" in java and "VISIBILITY_VISIBLE_NOTIFY_COMPLETED" in java)
check("받은 뒤 설치 화면을 연다", "application/vnd.android.package-archive" in java and "getUriForDownloadedFile" in java)
check("설치 권한이 매니페스트에 있다", "REQUEST_INSTALL_PACKAGES" in manifest)
check("방송 수신기를 EXPORTED 로 등록한다 (안드로이드 14)", "ContextCompat.RECEIVER_EXPORTED" in java)
check("수신기를 종료 때 푼다", "unregisterReceiver(updateReceiver)" in java)
check("다운로드 관리자가 없으면 브라우저로라도 받는다", "openInBrowser(httpsUrl)" in java)

print()
print("== 5. 웹 앱 URL 이 앱에 붙박이로 들어 있다")
check("팀 공용 URL 이 기본값이다", has_re(r"sheetsWebappUrl\s*:\s*TEAM_WEBAPP_URL"))
_team = re.search(r"TEAM_WEBAPP_URL\s*=\s*'([^']*)'", JS)
check("URL 이 실제 배포 주소다 (/exec 로 끝나는 script.google.com)",
      bool(_team) and _team.group(1).startswith("https://script.google.com/macros/s/")
      and _team.group(1).endswith("/exec"))
check("빈 값·예전 기본값이면 지금 기본값을 따라간다",
      has_re(r"PAST_WEBAPP_URLS\.includes\(\s*\w+\s*\)\s*\)\s*\w+\.sheetsWebappUrl\s*=\s*TEAM_WEBAPP_URL"))
# v3.23 — 말하는 대신 **한다.** 처음 켤 때 공용 주소를 설정에 적어 넣고 연결을 확인한다.
check("처음 켤 때 공용 주소를 설정에 적어 넣는다",
      defines("registerDefaultUrl")
      and has_re(r"saveSettings\(\s*\{\s*sheetsWebappUrl\s*:\s*(\w+\.)?TEAM_WEBAPP_URL", body("registerDefaultUrl")))
check("연결을 확인하고 '연결됐습니다' 를 한 번 알린다",
      has("구글 시트에 연결됐습니다") and has("'sheetVerifiedAt'"))
check("부팅 때 부른다", bool(calls("ensureSheetConnection")))
check("빌드가 기록하는 시트 주소와 앱 기본값이 같은 배포다",
      bool(_team) and "AKfycbzYFUuzAiKQGTo1QhHw2VvdJD3fs4n0Ab37-ucY_9e3WLecAsSTX8PH1OYS62KK0zAnBg" in _team.group(1))

print()
print("== 6. 내 이름 등록")
# 예전에는 이름 칸에 버튼이 없어서, 적어도 [새로고침] 이나 시트 카드의 [저장] 을
# 누르지 않으면 등록되지 않았다. 적고 화면을 나가면 그대로 사라졌다.
check("이름 칸에 [등록] 버튼이 있다", has('data-act="save-name"'))
check("버튼이 이름을 저장한다", has_re(r"===\s*'save-name'\s*\)\s*\{.{0,600}?setDeviceName\("))
check("빈 칸이면 저장하지 않고 알려 준다", has("이름을 먼저 입력해 주세요"))
check("등록 뒤 지금 이름을 그 자리에서 보여 준다", has('id="nameHint"'))
check("엔터로도 등록된다", has_re(r"\.key\s*(!==|===)\s*'Enter'", settings))

print()
print("== 7. 새 가이드 작성 — 요약 제거 · 단계마다 공구 고르기")
page = module_of("guideEditView")
# 요약 칸은 없앴다. v3.32 부터 제목 아래 요약 줄도 보이지 않고(e2e v332), 가이드를 고치면 요약을 비운다.
# 시트의 '요약' 열은 그대로 둔다 (예전 자료 · 검색).
check("요약 입력칸이 없다", not has('id="gSummary"') and not has("#gSummary"))
check("가이드를 고치면 요약을 비운다 (v3.32)",
      has_re(r"summary\s*:\s*''", page) and not has_re(r"summary\s*:\s*state\.summary", page))
check("시트의 '요약' 열은 그대로 둔다", has("'요약'", "gs"))
check("목록에서 '요약 없음' 을 더 이상 쓰지 않는다", not has("요약 없음"))
# 단계의 '기준 수치' 자유 입력 → 준비 공구에서 고르기
check("단계 라벨이 '필요 공구 · 부품' 이다",
      has("<label>필요 공구 · 부품</label>") and not has("기준 수치 (정량 판정값)"))
check("고를 거리는 준비 공구에서만 나온다", has_re(r"splitTools\(\s*\w+\.requiredTools\s*\)"))
check("고른 값은 예전 칸에 쉼표로 담는다 (시트 열을 새로 만들지 않는다)",
      has_re(r'<input(?=[^>]*type="hidden")[^>]*name="stepMetric"'))
check("칩을 다시 누르면 꺼진다",
      has_re(r"(\w+)\.includes\(\s*(\w+)\s*\)\s*\?\s*\1\.filter\(\s*\(\s*(\w+)\s*\)\s*=>\s*\3\s*!==\s*\2\s*\)", page))
check("준비 공구를 고치면 칩만 다시 그린다 (글자 칠 때 커서가 튀지 않게)",
      defines("paintToolChips") and bool(calls("paintToolChips")))
check("준비 공구에서 빠진 것은 단계 선택에서도 빠진다", defines("pruneStepTools") and bool(calls("pruneStepTools")))
check("공구를 안 적었으면 안내를 보여 준다", has("위 [준비 공구 · 부품] 에 먼저 적으면"))
check("상세 화면이 '기준값' 대신 공구 칩을 보여 준다",
      not has("기준값") and has('class="tag tag-accent"', module_of("guideDetailView")))
# 시트 쪽 표기 ('(공구: …)' 로 적고 되읽기) 는 test_apps_script.mjs 가 왕복으로 본다.
check("옛 '(기준: …)' 기록도 그대로 읽는다", has_re(r"\(기준:", "gs"))

print()
print("== 8. 차량 재고 — 부품 검색 (분류로 거르기는 test_inventory_groups.py · 부족만 · 분류 칩은 e2e)")
inv = module_of("inventoryView")
check("차량마다 검색칸이 있다 · 브라우저 기본 지우기(×)를 쓴다",
      has_re(r'<input(?=[^>]*id="invQ")(?=[^>]*type="search")'))
# 화면 전체를 다시 그리면 검색칸이 새로 만들어져 한 자 칠 때마다 커서가 빠진다.
check("검색할 때 표만 다시 그린다 (커서가 빠지지 않게)",
      has_re(r"addEventListener\(\s*'input'\s*,\s*\(\)\s*=>\s*\{\s*\w+\s*=\s*\w+\.value\s*;\s*(\w+)\(\)", inv)
      and not has_re(r"addEventListener\(\s*'input'\s*,\s*\(\)\s*=>\s*\{\s*\w+\s*=\s*\w+\.value\s*;\s*render\(\)", inv))
check("한글 조합이 끝날 때도 맞춘다", "compositionend" in inv)
check("칩을 눌러도 화면 전체를 다시 그리지 않는다 (검색칸 유지)",
      has_re(r"(\w+)\s*=\s*\1\s*===\s*\w+\s*\?\s*null\s*:\s*\w+\s*;\s*(\w+)\(\)", inv)
      and not has_re(r"(\w+)\s*=\s*\1\s*===\s*\w+\s*\?\s*null\s*:\s*\w+\s*;\s*render\(\)", inv))
check("찾은 것이 없으면 무엇을 찾았는지 보여 준다", has("에 맞는 부품이 없습니다"))
# v3.37 — 아래 알약('보인 것 / 전체')은 뺐다. 칩마다 종수가 붙어 있어 같은 말을 두 번 했고,
# 카드 목록이 화면 전체로 내려가면서 '아래' 자리가 사라졌다.
check("칩에 종수가 붙는다 (전체 · 부족만 · 분류마다)",
      has_re(r"'전체'\s*,\s*\w+\.length", inv) and not defines("countText"))

print()
print("== 9. 차량 재고 — [보충 필요] 는 '적을 때만'")
# 최소보유와 딱 같은 수량은 모자란 것이 아니다. 예전 '이하'(<=) 기준으로는
# 정확히 채워 둔 부품까지 빨갛게 떠서 현장에서 헷갈렸다.
# 예전에는 같은 비교가 세 군데 흩어져 있어 한 곳만 고치면 어긋났다.
low_cmp = re.findall(r"\w+\.quantity\s*(<=?)\s*\w+\.minQuantity", inv)
check("'적을 때만' 으로 한 곳에서 판정한다",
      low_cmp == ["<"] and not has_re(r"\.quantity\s*<=\s*\w+\.minQuantity"), str(low_cmp))
check("최소보유 0 은 판정하지 않는다 (안 쓰는 부품)", has_re(r"\.minQuantity\s*>\s*0\s*&&"))
# v3.23 — 설명 문구를 줄였다. 품목 수정 칸의 '보다 적어지면' 한 마디만 남긴다.
check("품목 수정 칸이 '보다 적어지면' 이라고 적는다", has("보다 적어지면</strong> [보충 필요]"))

print()
print("== 10. 사람에게 보내는 설치 링크 — 주소가 바뀌지 않는다")
# Dropbox 주소는 버전마다 파일 이름이 달라 매번 바뀐다. 한 번 보낸 주소가
# 계속 쓸모 있으려면 드라이브 파일 **하나**의 내용만 갈아 끼워야 한다.
check("빌드 자동화가 release:install 로 부른다", 'release:"install"' in ci)
# 주소만 넘겨 Apps Script 가 받아 오게 하면 UrlFetchApp 권한이 필요하고,
# 그 권한을 새로 넣는 순간 재승인 전까지 태블릿 전체가 시트에 못 닿는다.
check("APK 를 바이트로 직접 보낸다 (새 권한이 필요 없게)",
      'base64 -w0 "$FILE"' in ci and "--rawfile d apk.b64" in ci
      and 'data:$d' in ci)
check("링크 갱신이 실패해도 빌드를 무너뜨리지 않는다",
      "::warning::구글 드라이브 설치 링크를 갱신하지" in ci)
check("주소가 바뀌면 요약에서 알려 준다", "jq -r '.linkChanged'" in ci)
check("처음 만든 것도 알려 준다", "jq -r '.created'" in ci)
check("공개에 실패하면 알려 준다", "jq -r '.shared'" in ci)
# Apps Script 쪽(설치 갈래 · 내용만 갈아 끼우기 · 주소 모양 · 폴더 · 되찾기 · 미리보기 거절 ·
# latest 에 설치 주소)은 test_apps_script.mjs 가 돌려 본다.
# 태블릿
check("앱이 그 주소를 기기에 담아 둔다",
      has("'installLink'") and has_re(r"setMeta\(\s*\w+\s*,\s*\w+\s*\)", update))
# 예전 Apps Script 는 이 값을 안 준다. 그때 null 로 덮으면 알던 주소를 잃는다.
check("주소가 안 왔을 때 알던 주소를 지운다면 안 된다",
      has_re(r"if\s*\(\s*\w+\s*&&\s*\w+\.installUrl\s*\)", update))
check("설정 화면이 주소와 [링크 복사] 를 보여 준다",
      has('id="installLinkBox"') and has('data-act="copy-install"')
      and has_re(r"act\s*===\s*'copy-install'"))
check("아직 없으면 어디서 생기는지 알려 준다", has("다음 빌드가 올라간 뒤에 여기 보입니다"))
check("주소가 안 바뀐다는 것을 화면에서도 말해 준다", has("이 주소는 바뀌지 않습니다"))

print()
print("== 11. 버전은 세 곳이 같다 (tools/release.py 가 함께 바꾼다)")
_v_js = re.findall(r"APP_VERSION\s*=\s*'([0-9.]+)'", JS)
_v_sw = re.search(r"bh-shell-v([0-9.]+)", SW)
_v_gr = re.search(r'appVersionName = "([0-9.]+)"', read("android", "app", "build.gradle"))
_vs = [_v_js[0] if len(_v_js) == 1 else None] + [m.group(1) if m else None for m in (_v_sw, _v_gr)]
check("version.js · sw.js 캐시 · build.gradle 이 같은 버전 (앱 버전은 한 곳에만 적는다)",
      len(set(_vs)) == 1 and None not in _vs, " / ".join(map(str, _vs)))
_notes = re.search(r"version\s*:\s*'([0-9.]+)'", body("PATCH_NOTES"))      # 맨 위 항목
check("[패치 내용] 에 지금 버전이 맨 위에 있다", _vs[0] is not None and _notes is not None
      and _notes.group(1) == _vs[0], (_notes.group(1) if _notes else "없음") + " / " + str(_vs[0]))
check("[패치 내용] 버튼이 새로고침 옆에 있다",
      'id="btn-patch"' in HTML and HTML.index('id="btn-patch"') < HTML.index('id="btn-update"'))

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 업데이트 흐름의 네 조각이 같은 약속을 지킵니다.")
