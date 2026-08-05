"""v2.0 검증: 기기별 작업본 격리 · [업데이트] 공개 반영 · 구글 시트 페이로드."""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CODE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8791
DB = "/tmp/bh-v2.db"
DRAFTS = "/tmp/bh-v2-drafts"
MEDIA = "/tmp/bh-v2-media"
fails = []
proc = None


def call(method, path, body=None, expect=200, device=None):
    url = f"http://localhost:{PORT}" + urllib.parse.quote(path, safe="/?=&.")
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if device:
        headers["X-Device-Id"] = device
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            status, text = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        status, text = exc.code, exc.read().decode("utf-8", "replace")
    ok = status == expect
    if not ok:
        fails.append(f"{method} {path} [{device}] -> {status} (기대 {expect}): {text[:200]}")
        print(f"  FAIL {method} {path} [{device}] {status} {text[:150]}")
    try:
        return json.loads(text) if text else None
    except json.JSONDecodeError:
        return text


def start():
    global proc
    for path in (DB, DB + "-wal", DB + "-shm"):
        if os.path.exists(path):
            os.remove(path)
    shutil.rmtree(DRAFTS, ignore_errors=True)
    shutil.rmtree(MEDIA, ignore_errors=True)
    env = dict(os.environ, DATABASE_URL=DB, DRAFT_DIR=DRAFTS, MEDIA_DIR=MEDIA)
    proc = subprocess.Popen(
        [sys.executable, "server.py", "--port", str(PORT), "--host", "127.0.0.1"],
        cwd=CODE, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    time.sleep(2.5)


start()
try:
    A, B = "deviceAAA", "deviceBBB"

    print("=== 초기 상태 (공개본 = 시드) ===")
    st = call("GET", "/api/state", device=A)
    print("  공개 버전:", st["published"]["revision"], "| 요약:", st["summary"])
    assert st["published"]["revision"] == 0
    assert st["hasLocalChanges"] is False
    base_guides = len(call("GET", "/api/guides", device=A)["items"])
    print("  A 가이드:", base_guides)

    print("\n=== A 가 가이드 추가 → A 에만 보여야 함 ===")
    call("POST", "/api/guides", {
        "categoryType": "ERROR_CODE", "codeOrTitle": "E-777 A만 추가",
        "summary": "실시간 공개 금지 확인", "requiredTools": "", "commands": [],
        "steps": [{"instruction": "1단계"}]}, expect=201, device=A)
    a_titles = [g["codeOrTitle"] for g in call("GET", "/api/guides", device=A)["items"]]
    b_titles = [g["codeOrTitle"] for g in call("GET", "/api/guides", device=B)["items"]]
    print("  A 에 보임:", "E-777 A만 추가" in a_titles)
    print("  B 에 보임:", "E-777 A만 추가" in b_titles, "(False 여야 정상)")
    assert "E-777 A만 추가" in a_titles
    assert "E-777 A만 추가" not in b_titles, "업데이트 전인데 다른 사용자에게 보였다"

    st = call("GET", "/api/state", device=A)
    print("  A 업데이트 필요 표시:", st["hasLocalChanges"])
    assert st["hasLocalChanges"] is True
    st_b = call("GET", "/api/state", device=B)
    assert st_b["hasLocalChanges"] is False

    print("\n=== A 가 [업데이트] → 모든 사용자에게 적용 ===")
    result = call("POST", "/api/publish", {"deviceName": "황지민"}, device=A)
    print("  공개 버전:", result["revision"], "| by", result["by"])
    assert result["revision"] == 1

    b_titles = [g["codeOrTitle"] for g in call("GET", "/api/guides", device=B)["items"]]
    print("  B 에 반영됨:", "E-777 A만 추가" in b_titles)
    assert "E-777 A만 추가" in b_titles, "업데이트 후에도 다른 사용자에게 반영되지 않았다"

    st = call("GET", "/api/state", device=A)
    assert st["hasLocalChanges"] is False, "업데이트 후에도 변경 표시가 남았다"
    st_b = call("GET", "/api/state", device=B)
    print("  B 자동 최신 반영:", st_b["autoUpdated"] or st_b["myRevision"] == 1)
    assert st_b["myRevision"] == 1

    print("\n=== 리포트는 기기별 개인 데이터 ===")
    fields = call("GET", "/api/report-fields", device=A)["items"]
    values = [{"fieldId": f["id"], "label": f["fieldLabel"], "type": f["fieldType"],
               "value": ("완료" if f["fieldType"] == "DROPDOWN"
                         else "7" if f["fieldType"] == "NUMBER" else f"{f['fieldLabel']} 값"),
               "media": []} for f in fields]
    rep = call("POST", "/api/reports", {"values": values}, expect=201, device=A)
    print("  A 리포트:", rep["title"], "| status", rep["status"])
    assert call("GET", "/api/reports", device=B)["items"] == [], "리포트가 공유됐다"
    # 업데이트해도 리포트는 넘어가지 않아야 함
    call("POST", "/api/guides", {
        "categoryType": "HARDWARE_SOP", "codeOrTitle": "SOP 추가", "summary": "",
        "requiredTools": "", "commands": [], "steps": [{"instruction": "x"}]},
        expect=201, device=A)
    call("POST", "/api/publish", {"deviceName": "황지민"}, device=A)
    assert call("GET", "/api/reports", device=B)["items"] == [], "업데이트로 리포트가 공유됐다"
    assert len(call("GET", "/api/reports", device=A)["items"]) == 1

    print("\n=== 동시 변경 (B 가 먼저 업데이트한 뒤 A 상태) ===")
    call("POST", "/api/vehicles", {"name": "B차량"}, expect=201, device=B)
    call("POST", "/api/guides", {
        "categoryType": "ERROR_CODE", "codeOrTitle": "A 나중 변경", "summary": "",
        "requiredTools": "", "commands": [], "steps": [{"instruction": "y"}]},
        expect=201, device=A)
    call("POST", "/api/publish", {"deviceName": "정비2팀"}, device=B)
    st = call("GET", "/api/state", device=A)
    print(f"  A: 내 변경={st['hasLocalChanges']} 뒤처짐={st['behind']} (경고 대상)")
    assert st["hasLocalChanges"] and st["behind"]

    print("\n=== 내 변경 버리고 최신 받기 ===")
    call("POST", "/api/take-latest", {}, device=A)
    st = call("GET", "/api/state", device=A)
    a_titles = [g["codeOrTitle"] for g in call("GET", "/api/guides", device=A)["items"]]
    print("  내 변경 사라짐:", "A 나중 변경" not in a_titles)
    print("  B 차량 반영:", "B차량" in [v["name"] for v in call("GET", "/api/vehicles", device=A)["items"]])
    assert not st["hasLocalChanges"] and not st["behind"]
    assert "A 나중 변경" not in a_titles
    assert len(call("GET", "/api/reports", device=A)["items"]) == 1, "최신 받기로 내 리포트가 사라졌다"

    print("\n=== 노션 API 완전 제거 확인 ===")
    for path in ("/api/settings/notion-test", "/api/report-fields/import-notion",
                 "/api/report-fields/notion-preview", "/api/sync/check"):
        method = "GET" if "preview" in path or "check" in path else "POST"
        call(method, path, {} if method == "POST" else None, expect=404, device=A)

    print("\n=== 구글 시트 설정 검증 ===")
    s = call("GET", "/api/settings", device=A)
    print("  기본 스프레드시트 ID:", s["sheets_spreadsheet_id"])
    print("  기본 서비스 주소   :", repr(s["site_url"]), "(비어 있으면 접속 주소 자동 사용)")
    assert s["sheets_spreadsheet_id"] == "1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4"
    assert s["site_url"] == "", "기본 서비스 주소가 비어 있지 않다(도메인 잔재)"
    ver = call("GET", "/api/version", device=A)
    print("  자동 감지 주소     :", ver["detectedUrl"], "| siteUrl:", ver["siteUrl"])
    assert ver["siteUrl"] == ver["detectedUrl"] and ver["siteUrlConfigured"] is False
    assert "errorcode.beyondhoneycomb.com" not in ver["siteUrl"]
    assert s["sheetsReady"] is False
    r = call("PUT", "/api/settings", {"sheets_webapp_url": "http://x.com/exec"},
             expect=400, device=A)
    print("  http URL 거부:", str(r["error"])[:40])
    r = call("PUT", "/api/settings", {"sheets_webapp_url": "https://example.com/exec"},
             expect=400, device=A)
    print("  타 도메인 거부:", str(r["error"])[:40])
    r = call("PUT", "/api/settings",
             {"sheets_webapp_url": "https://script.google.com/macros/s/AKfy/dev"},
             expect=400, device=A)
    print("  /exec 아님 거부:", str(r["error"])[:40])
    s = call("PUT", "/api/settings", {
        "sheets_webapp_url": "https://script.google.com/macros/s/AKfyTEST/exec",
        "sheets_spreadsheet_id":
            "https://docs.google.com/spreadsheets/d/1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4/edit?usp=sharing",
    }, device=A)
    print("  URL 에서 ID 추출:", s["sheets_spreadsheet_id"])
    assert s["sheets_spreadsheet_id"] == "1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4"
    assert s["sheetsReady"] is True
    # 전역 설정이므로 다른 기기에서도 보여야 함
    s_b = call("GET", "/api/settings", device=B)
    assert s_b["sheetsReady"] is True, "구글 시트 설정이 기기별로 갈라졌다"

    print("\n=== 시트 업로드 실패 처리 (가짜 URL) ===")
    r = call("POST", f"/api/reports/{rep['id']}/sheet", {}, expect=400, device=A)
    print("  오류 메시지:", str(r["error"])[:70].replace("\n", " "))
    after = call("GET", f"/api/reports/{rep['id']}", device=A)
    assert after["status"] == "FAILED" and after["errorMessage"]

    print()
    if fails:
        print(f"❌ 실패 {len(fails)}건")
        for f in fails:
            print("  -", f)
        raise SystemExit(1)
    print("✅ v2.0 서버 동작 전체 통과")
finally:
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    for path in (DB, DB + "-wal", DB + "-shm"):
        if os.path.exists(path):
            os.remove(path)
    shutil.rmtree(DRAFTS, ignore_errors=True)
    shutil.rmtree(MEDIA, ignore_errors=True)
