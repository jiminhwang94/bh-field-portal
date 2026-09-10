"""앱 안 [업데이트] 흐름 — 네 조각이 같은 약속을 지키는지.

빌드 자동화(CI) → Dropbox → 시트 '앱 버전' 탭 → 태블릿 띠 → 안드로이드 다운로드.
조각이 넷이라 하나만 어긋나도 "띠가 안 뜬다" 로만 보인다. 여기서 이음새를 본다.

실행: python tests/test_update_flow.py
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
ci = read(".github", "workflows", "android.yml")
java = read("android", "app", "src", "main", "java", "com", "beyondhoneycomb", "fieldportal", "MainActivity.java")
manifest = read("android", "app", "src", "main", "AndroidManifest.xml")
update = read("web", "js", "update.js")
index = read("web", "index.html")
css = read("web", "css", "app.css")
net = read("web", "js", "net.js")
syncnow = read("web", "js", "syncnow.js")
sw = read("web", "sw.js")
settings = read("web", "js", "views", "settings.js")

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
check("릴리스 안내문에 낡은 '비공개' 문단이 없다", "이 저장소는 **비공개**" not in ci)

print()
print("== 2. 시트 (Apps Script)")
check("publish · latest 두 길이 있다", "body.release === 'publish'" in gs and "body.release === 'latest'" in gs)
check("탭 이름과 머리줄이 정해져 있다", "var RELEASE_SHEET = '앱 버전'" in gs and "'공개'" in gs)
check("버전을 숫자로 비교한다", "function compareVersions" in gs)
check("공개 칸으로 사람이 막을 수 있다", "function isReleasePublic" in gs)

print()
print("== 3. 태블릿 화면")
check("띠 자리가 있다", 'id="update-banner"' in index)
check("띠가 그리드 줄을 차지하고 본문이 한 줄 내려갔다",
      "grid-template-rows: auto auto auto minmax(0, 1fr)" in css
      and ".update-banner  { grid-column: 2; grid-row: 3; }" in css
      and ".screen         { grid-column: 2; grid-row: 4; }" in css)
check("띠는 토큰 색만 쓴다", "background: var(--color-accent-tint)" in css.split(".update-banner {")[1].split("}")[0])
check("update.js 가 오프라인 목록에 있다", "'./js/update.js'" in sw)
check("부팅 때 지난 정보로 먼저 그린다", "initUpdateBanner();" in read("web", "js", "app.js"))
check("시트 받은 뒤 버전도 묻는다 (net.js)", "u.checkForUpdate()" in net)
check("[새로고침]·5분 자동 때도 묻는다 (syncnow.js)", "checkForUpdate({ force: !quiet })" in syncnow)
check("4분 안에는 다시 묻지 않는다", "CHECK_GAP_MS = 4 * 60 * 1000" in update)
check("지금 앱보다 높을 때만 띠를 띄운다", "compareVersions(info.version, APP_VERSION) > 0" in update)
check("'나중에' 는 그 버전에만 적용된다", "bh_update_skip_${v}" in update)
check("APK 안이면 안드로이드에 넘긴다", "location.href = `bhupdate:${encodeURIComponent(info.url)}`" in update)
check("브라우저면 새 탭으로 연다", "window.open(info.url, '_blank', 'noopener')" in update)
check("설정 화면에 최신 여부 한 줄", 'id="appUpdateLine"' in settings and "checkForUpdate({ force: true })" in settings)

print()
print("== 4. 안드로이드")
check("웹이 APK 안인지 알 수 있게 UA 에 표식", 'FieldPortalAPK/' in java and 'FieldPortalAPK' in update)
check("bhupdate: 주소를 가로챈다", '"bhupdate".equals(url.getScheme())' in java)
check("시스템 다운로드 관리자로 받는다", "DownloadManager.Request" in java and "VISIBILITY_VISIBLE_NOTIFY_COMPLETED" in java)
check("받은 뒤 설치 화면을 연다", "application/vnd.android.package-archive" in java and "getUriForDownloadedFile" in java)
check("설치 권한이 매니페스트에 있다", "REQUEST_INSTALL_PACKAGES" in manifest)
check("방송 수신기를 EXPORTED 로 등록한다 (안드로이드 14)", "ContextCompat.RECEIVER_EXPORTED" in java)
check("수신기를 종료 때 푼다", "unregisterReceiver(updateReceiver)" in java)
check("다운로드 관리자가 없으면 브라우저로라도 받는다", "openInBrowser(httpsUrl)" in java)

print()
print("== 5. 웹 앱 URL 이 앱에 붙박이로 들어 있다")
store_js = read("web", "js", "local", "store.js")
check("팀 공용 URL 이 기본값이다", "sheetsWebappUrl: TEAM_WEBAPP_URL" in store_js)
check("URL 이 실제 배포 주소다 (/exec 로 끝나는 script.google.com)",
      "https://script.google.com/macros/s/" in store_js
      and "/exec';" in store_js.split("TEAM_WEBAPP_URL = ")[1][:200])
check("빈 값·예전 기본값이면 지금 기본값을 따라간다",
      "PAST_WEBAPP_URLS.includes(url)) merged.sheetsWebappUrl = TEAM_WEBAPP_URL" in store_js)
check("설정 화면이 '미리 들어 있다' 고 말한다", "미리 들어 있습니다" in settings)
check("빌드가 기록하는 시트 주소와 앱 기본값이 같은 배포다",
      "AKfycbzYFUuzAiKQGTo1QhHw2VvdJD3fs4n0Ab37-ucY_9e3WLecAsSTX8PH1OYS62KK0zAnBg" in store_js)

print()
print("== 6. 내 이름 등록")
# 예전에는 이름 칸에 버튼이 없어서, 적어도 [새로고침] 이나 시트 카드의 [저장] 을
# 누르지 않으면 등록되지 않았다. 적고 화면을 나가면 그대로 사라졌다.
check("이름 칸에 [등록] 버튼이 있다", 'data-act="save-name"' in settings)
check("버튼이 이름을 저장한다", "setDeviceName(name);" in settings.split("'save-name'")[1][:600])
check("빈 칸이면 저장하지 않고 알려 준다",
      "이름을 먼저 입력해 주세요" in settings)
check("등록 뒤 지금 이름을 그 자리에서 보여 준다", 'id="nameHint"' in settings)
check("엔터로도 등록된다", "ev.key !== 'Enter'" in settings)

print()
print("== 7. 새 가이드 작성 — 요약 제거 · 단계마다 공구 고르기")
guides = read("web", "js", "views", "guides.js")
gs_src = read("google-apps-script.gs")
# 요약 칸은 없앴다. 다만 예전 가이드가 가진 요약과 시트의 '요약' 열은 건드리지 않는다.
check("요약 입력칸이 없다", 'id="gSummary"' not in guides)
check("요약을 collect 에서 덮어쓰지 않는다", "state.summary = $('#gSummary')" not in guides)
check("예전 가이드의 요약은 그대로 저장된다", "summary: state.summary," in guides)
check("시트의 '요약' 열은 그대로 둔다", "'요약'" in gs_src)
check("목록에서 '요약 없음' 을 더 이상 쓰지 않는다", "요약 없음" not in guides)
# 단계의 '기준 수치' 자유 입력 → 준비 공구에서 고르기
check("단계 라벨이 '필요 공구 · 부품' 이다",
      "<label>필요 공구 · 부품</label>" in guides
      and "기준 수치 (정량 판정값)" not in guides)
check("고를 거리는 준비 공구에서만 나온다",
      "const options = splitTools(state.requiredTools);" in guides)
check("고른 값은 예전 칸에 쉼표로 담는다 (시트 열을 새로 만들지 않는다)",
      "name=\"stepMetric\"" in guides and "type=\"hidden\"" in guides)
check("칩을 다시 누르면 꺼진다",
      "chosen.includes(tool)" in guides and "chosen.filter((t) => t !== tool)" in guides)
check("준비 공구를 고치면 칩만 다시 그린다 (글자 칠 때 커서가 튀지 않게)",
      "paintToolChips();" in guides and "function paintToolChips()" in guides)
check("준비 공구에서 빠진 것은 단계 선택에서도 빠진다", "function pruneStepTools()" in guides)
check("공구를 안 적었으면 안내를 보여 준다",
      "위 [준비 공구 · 부품] 에 먼저 적으면" in guides)
check("상세 화면이 '기준값' 대신 공구 칩을 보여 준다",
      "기준값" not in guides and 'class="tag tag-accent"' in guides)
# 시트 쪽 표기
check("시트에는 '(공구: …)' 로 적는다", "'  (공구: '" in gs_src)
check("옛 '(기준: …)' 기록도 그대로 읽는다", "indexOf('  (기준: ')" in gs_src)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 업데이트 흐름의 네 조각이 같은 약속을 지킵니다.")
