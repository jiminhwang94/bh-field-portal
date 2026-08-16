"""서버 API 스모크 테스트 (v3.0).

v3.0 서버는 **팀 공개본 보관소**다. 앱의 생성/수정/삭제는 기기에서 끝나므로
서버에는 동기화·인증·사진 업로드 경로만 남아 있다.

실행 방법 (저장소 루트에서):
    DATABASE_URL=/tmp/bh-test.db MEDIA_DIR=/tmp/bh-test-media \
        python3 server.py --port 8788 &
    python3 tests/test_api_smoke.py
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://localhost:8788"
fails = []


def call(method, path, body=None, raw=None, ctype=None, expect=200):
    url = BASE + urllib.parse.quote(path, safe="/?=&.")
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if raw is not None:
        data = raw
        headers["Content-Type"] = ctype or "application/octet-stream"
    headers["X-Device-Id"] = "smoketest"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            status, text = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        status, text = exc.code, exc.read().decode("utf-8", "replace")
    ok = status == expect
    if not ok:
        fails.append(f"{method} {path} -> {status} (기대 {expect}): {text[:200]}")
    print(f"{'PASS' if ok else 'FAIL'} {method} {path} [{status}]")
    try:
        return json.loads(text) if text else None
    except json.JSONDecodeError:
        return None


def check(label, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(label)


print("=" * 62)
print("서버 API 스모크 테스트 (v3.0 — 동기화 전용 서버)")
print("=" * 62)

# ------------------------------------------------------------ 기본 정보
version = call("GET", "/api/version")
check("버전 정보를 준다", bool(version and version.get("version")),
      version.get("version") if version else "")
check("빌드 해시를 준다", bool(version and version.get("buildHash")))

meta = call("GET", "/api/meta")
check("카테고리·항목 종류를 준다",
      bool(meta and meta.get("categoryTypes") and meta.get("fieldTypes")))

auth = call("GET", "/api/auth/status")
check("PIN 설정 여부를 준다", bool(auth) and "pinEnabled" in auth)

# ------------------------------------------------------------- 동기화
head = call("GET", "/api/sync/head")
check("공개 버전을 준다", bool(head) and "revision" in head, str(head))

snap = call("GET", "/api/sync/pull")
check("공개본 전체를 내려준다",
      bool(snap) and isinstance(snap.get("guides"), list)
      and isinstance(snap.get("fields"), list),
      f"가이드 {len(snap.get('guides', []))}건" if snap else "")
check("가이드에 단계가 붙어 있다",
      bool(snap) and all("steps" in g for g in snap.get("guides", [])))
check("팀 공통 설정을 함께 내려준다",
      bool(snap) and "settings" in snap)

pushed = call("POST", "/api/sync/push",
              {"deviceName": "스모크테스트", **{k: snap[k] for k in
                                            ("guides", "vehicles", "inventory", "fields")}})
check("[업데이트] 를 받으면 버전이 오른다",
      bool(pushed) and pushed.get("revision", 0) > head.get("revision", 0),
      f"{head.get('revision')} → {pushed.get('revision') if pushed else '?'}")

if snap and snap.get("inventory"):
    item = snap["inventory"][0]
    qty = call("POST", "/api/sync/quantities",
               {"ops": [{"type": "quantity", "vehicleName": item["vehicleName"],
                         "partName": item["partName"], "quantity": 5,
                         "updatedAt": "2099-01-01T00:00:00"}]})
    check("재고 수량을 즉시 반영한다", bool(qty) and qty.get("applied") == 1)

legacy = call("GET", "/api/sync/legacy")
check("이전 버전 리포트 넘겨주기 경로가 있다",
      bool(legacy) and isinstance(legacy.get("reports"), list))

# ------------------------------------------------------------------ 설정
settings = call("GET", "/api/settings")
check("PIN 값 자체는 내보내지 않는다",
      bool(settings) and "access_pin" not in settings and "auth_secret" not in settings)

call("PUT", "/api/settings", {"sheets_webapp_url": "https://example.com/notascript"},
     expect=400)
check("Apps Script 가 아닌 주소는 거부한다", True)

# -------------------------------------------------------------- 사진 업로드
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000100" "05fe02fe" "0000000049454e44ae426082")
media = call("POST", "/api/media?filename=test.png", raw=png, ctype="image/png",
             expect=201)
check("사진을 올릴 수 있다 (가이드 사진 공유용)",
      bool(media) and media.get("url", "").startswith("/media/"),
      media.get("url") if media else "")
call("POST", "/api/media?filename=bad.exe", raw=b"MZ", ctype="application/x-msdownload",
     expect=415)
check("허용하지 않는 파일 형식은 거부한다", True)

# ------------------------------------------- 기기에서 처리하는 경로는 서버에 없다
for path in ("/api/guides", "/api/inventory", "/api/reports", "/api/report-fields"):
    call("GET", path, expect=404)
check("가이드·재고·리포트 CRUD 는 서버에 없다 (기기에서 처리)", True)

print("=" * 62)
if fails:
    print(f"실패 {len(fails)}건:")
    for f in fails:
        print("  -", f)
    raise SystemExit(1)
print("전부 통과")
