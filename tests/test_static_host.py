"""화면 서버 검사 — 서버는 화면 파일만 내주고, 그 밖의 일은 하지 않는다.

v3.9 에서 '사무실 서버' 의 자료·동기화 API 를 통째로 걷어냈다. 이제 서버가
책임지는 것은 셋뿐이다.
  - `web/` 의 화면 파일을 올바른 종류(MIME)로 내준다
  - 없는 화면 파일은 404 로 분명히 알린다 (index.html 로 얼버무리지 않는다)
  - 자료를 받거나 바꾸는 요청(POST 등)은 받지 않는다

실행 (저장소 루트에서):
    BH_TEST_BASE=http://127.0.0.1:8799 python tests/test_static_host.py
서버는 검사 스크립트가 직접 띄운다 (BH_TEST_BASE 가 없으면 빈 포트에 띄운다).
"""

import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  — " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def fetch(base, path, method="GET", body=None):
    # 한글 경로는 요청 줄에 그대로 실을 수 없다 — 퍼센트 인코딩해서 보낸다.
    req = urllib.request.Request(base + urllib.parse.quote(path), data=body, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


base = os.environ.get("BH_TEST_BASE", "").rstrip("/")
proc = None
if not base:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ, BH_QUIET="1")
    proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py"),
                             "--port", str(port), "--host", "127.0.0.1"],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            fetch(base, "/")
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.1)

try:
    print("화면 파일을 내준다")
    status, headers, body = fetch(base, "/")
    check("/ 가 index.html 을 준다", status == 200 and b"<html" in body.lower(), str(status))
    check("HTML 에 charset 이 붙는다", "charset=utf-8" in headers.get("Content-Type", ""),
          headers.get("Content-Type", ""))

    status, headers, _ = fetch(base, "/js/app.js")
    check("JS 를 javascript 로 준다", status == 200
          and headers.get("Content-Type", "").startswith("application/javascript"),
          headers.get("Content-Type", ""))
    status, headers, _ = fetch(base, "/css/app.css")
    check("CSS 를 text/css 로 준다", status == 200
          and headers.get("Content-Type", "").startswith("text/css"),
          headers.get("Content-Type", ""))
    status, headers, _ = fetch(base, "/manifest.webmanifest")
    check("매니페스트를 준다", status == 200, str(status))
    status, headers, _ = fetch(base, "/js/app.js")
    check("화면 파일은 매번 서버에 확인한다 (no-cache)",
          "no-cache" in headers.get("Cache-Control", ""), headers.get("Cache-Control", ""))

    print()
    print("없는 것은 없다고 말한다")
    status, _, _ = fetch(base, "/js/없는파일.js")
    check("없는 JS 는 404 (index.html 로 얼버무리지 않는다)", status == 404, str(status))
    status, _, body = fetch(base, "/#/inventory".split("#")[0] + "inventory")
    check("확장자 없는 화면 주소는 index.html 로 연다 (SPA)", status == 200 and b"<html" in body.lower(),
          str(status))
    status, _, _ = fetch(base, "/../server.py")
    check("루트 밖으로 나가는 경로를 막는다", status in (403, 404), str(status))

    print()
    print("자료 API 는 없다")
    status, _, body = fetch(base, "/api/version")
    check("/api/* 는 404 다", status == 404, str(status))
    check("왜 없는지 알려 준다", "구글 시트" in body.decode("utf-8", "ignore"),
          body.decode("utf-8", "ignore")[:60])
    status, _, _ = fetch(base, "/", method="POST", body=b"{}")
    check("POST 는 받지 않는다 (405)", status == 405, str(status))
finally:
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 서버는 화면 파일만 내줍니다.")
