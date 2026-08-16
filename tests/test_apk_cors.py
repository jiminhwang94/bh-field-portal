"""APK 앱 ↔ 사무실 서버 연결 규칙 검사.

APK 로 설치한 앱은 화면 파일이 기기 안에 있어 서버와 **출처가 다르다**.
이 규칙이 어긋나면 앱에서 [업데이트]가 조용히 실패한다(원인을 찾기 매우 어렵다).

- 앱 출처의 사전 확인(OPTIONS)에 허용 헤더가 붙는지
- 같은 헤더가 **두 번** 나가지 않는지 (두 번 나가면 브라우저가 응답을 통째로 거부한다)
- 낯선 사이트에는 허용 헤더를 주지 않는지 (사내망 서버 보호)
- 사진(/media)도 앱에서 받아갈 수 있는지

실행: python3 tests/test_apk_cors.py
"""
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

CODE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8796
ROOT = "/tmp/bh-cors-test"
APP_ORIGIN = "https://appassets.androidplatform.net"
fails = []


def check(label, ok, detail=""):
    print(f"{'✅' if ok else '❌'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(label)


def call(method, path, origin=None, headers=None):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method=method)
    req.add_header("X-Device-Id", "apktest")
    if origin:
        req.add_header("Origin", origin)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.headers
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers


shutil.rmtree(ROOT, ignore_errors=True)
os.makedirs(os.path.join(ROOT, "media"), exist_ok=True)
env = dict(os.environ, DATABASE_URL=os.path.join(ROOT, "app.db"),
           MEDIA_DIR=os.path.join(ROOT, "media"))
proc = subprocess.Popen([sys.executable, "server.py", "--port", str(PORT),
                         "--host", "127.0.0.1"], cwd=CODE, env=env,
                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
time.sleep(2.5)

print("=" * 62)
print("APK 앱 ↔ 서버 연결 규칙 검사")
print("=" * 62)

try:
    # ------------------------------------------------- 사전 확인(preflight)
    status, headers = call("OPTIONS", "/api/sync/pull", origin=APP_ORIGIN,
                           headers={"Access-Control-Request-Method": "GET"})
    check("앱 출처의 사전 확인을 받아 준다", status in (200, 204), str(status))

    origins = headers.get_all("Access-Control-Allow-Origin") or []
    check("허용 출처 헤더가 정확히 한 번만 나간다", len(origins) == 1,
          f"{len(origins)}번: {origins}")
    check("허용 출처가 앱 주소와 일치한다",
          origins and origins[0] == APP_ORIGIN, origins[0] if origins else "")
    check("쓸 메서드를 허용한다",
          "POST" in (headers.get("Access-Control-Allow-Methods") or ""),
          headers.get("Access-Control-Allow-Methods") or "없음")
    allowed = (headers.get("Access-Control-Allow-Headers") or "").lower()
    check("기기 구분·토큰 헤더를 허용한다",
          "x-device-id" in allowed and "x-access-token" in allowed,
          headers.get("Access-Control-Allow-Headers") or "없음")

    # ---------------------------------------------------------- 실제 요청
    status, headers = call("GET", "/api/sync/head", origin=APP_ORIGIN)
    check("앱에서 보낸 실제 요청이 통과한다", status == 200, str(status))
    check("응답에도 허용 출처가 한 번만 붙는다",
          len(headers.get_all("Access-Control-Allow-Origin") or []) == 1)
    check("자격 증명 허용이 켜져 있다",
          headers.get("Access-Control-Allow-Credentials") == "true")
    check("출처에 따라 응답이 달라짐을 알린다 (중간 캐시 오작동 방지)",
          "Origin" in (headers.get("Vary") or ""), headers.get("Vary") or "없음")

    # -------------------------------------------------- 낯선 사이트 차단
    status, headers = call("GET", "/api/sync/head", origin="https://evil.example.com")
    check("낯선 사이트에는 허용 헤더를 주지 않는다",
          not headers.get("Access-Control-Allow-Origin"),
          headers.get("Access-Control-Allow-Origin") or "없음")

    status, _ = call("OPTIONS", "/api/sync/pull", origin="https://evil.example.com")
    check("낯선 사이트의 사전 확인은 거부한다", status == 405, str(status))

    # ------------------------------------------------------------ 사진
    status, headers = call("GET", "/media/none.png", origin=APP_ORIGIN)
    check("사진 경로도 앱에서 받아갈 수 있다 (가이드 사진 동기화)",
          headers.get("Access-Control-Allow-Origin") == APP_ORIGIN,
          headers.get("Access-Control-Allow-Origin") or "없음")

    # ------------------------------------------- 브라우저(같은 출처)는 그대로
    status, headers = call("GET", "/api/sync/head")
    check("일반 브라우저 접속은 예전과 동일하게 동작한다",
          status == 200 and not headers.get("Access-Control-Allow-Origin"))
finally:
    proc.terminate()
    proc.wait(timeout=5)

print("=" * 62)
if fails:
    print(f"❌ 실패 {len(fails)}건: {', '.join(fails)}")
    sys.exit(1)
print("✅ 전부 통과")
