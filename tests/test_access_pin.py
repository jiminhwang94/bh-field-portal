"""접근 보호(공용 PIN) 검증 (D-1).

PIN 설정 전에는 누구나 접근, 설정 후에는 토큰 없이는 401.
실행: python3 tests/test_access_pin.py
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

CODE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8794
DB = "/tmp/bh-pin.db"
DRAFTS = "/tmp/bh-pin-drafts"
MEDIA = "/tmp/bh-pin-media"
fails = []


def call(method, path, body=None, expect=200, device="pinDev", cookie=None):
    url = f"http://localhost:{PORT}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"X-Device-Id": device}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = f"bh_access={cookie}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            status, text = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        status, text = exc.code, exc.read().decode("utf-8", "replace")
    if status != expect:
        fails.append(f"{method} {path} -> {status} (기대 {expect}): {text[:120]}")
        print(f"  FAIL {method} {path} [{status}]")
    try:
        return json.loads(text) if text else None
    except json.JSONDecodeError:
        return text


for p in (DB, DB + "-wal", DB + "-shm"):
    if os.path.exists(p):
        os.remove(p)
shutil.rmtree(DRAFTS, ignore_errors=True)
shutil.rmtree(MEDIA, ignore_errors=True)
env = dict(os.environ, DATABASE_URL=DB, DRAFT_DIR=DRAFTS, MEDIA_DIR=MEDIA)
proc = subprocess.Popen([sys.executable, "server.py", "--port", str(PORT),
                         "--host", "127.0.0.1"], cwd=CODE, env=env,
                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
time.sleep(2.5)

try:
    print("=== PIN 설정 전: 보호 없음 ===")
    st = call("GET", "/api/auth/status")
    print("  required:", st["required"], "authorized:", st["authorized"])
    assert st["required"] is False and st["authorized"] is True
    assert call("GET", "/api/guides")["items"], "보호 없는데 조회가 막혔다"

    print("\n=== PIN 설정 ===")
    res = call("PUT", "/api/settings", {"access_pin": "4821"})
    token = res.get("newToken")
    print("  PIN 사용 중:", res["pinEnabled"], "| 이 기기 토큰 발급:", bool(token))
    assert res["pinEnabled"] is True and token
    assert "access_pin" not in res, "PIN 값이 응답에 노출됐다"
    assert "auth_secret" not in res, "서명 비밀값이 응답에 노출됐다"

    print("\n=== 잘못된 형식 거부 ===")
    r = call("PUT", "/api/settings", {"access_pin": "12"}, expect=400, cookie=token)
    print("  짧은 PIN:", str(r["error"])[:40])
    r = call("PUT", "/api/settings", {"access_pin": "abcd"}, expect=400, cookie=token)
    print("  숫자 아님:", str(r["error"])[:40])

    print("\n=== 토큰 없으면 401 ===")
    call("GET", "/api/guides", expect=401)
    call("GET", "/api/inventory", expect=401)
    call("POST", "/api/publish", {"deviceName": "x"}, expect=401)
    st = call("GET", "/api/auth/status")
    print("  status 는 열려 있음:", st["required"], st["authorized"])
    assert st["required"] is True and st["authorized"] is False

    print("=== 토큰 있으면 통과 ===")
    assert call("GET", "/api/guides", cookie=token)["items"]
    print("  쿠키로 조회 성공")

    print("\n=== 다른 기기: PIN 입력해야 함 ===")
    call("GET", "/api/guides", device="otherDev", expect=401)
    r = call("POST", "/api/auth", {"pin": "0000"}, expect=401, device="otherDev")
    print("  틀린 PIN:", str(r["error"])[:30])
    ok = call("POST", "/api/auth", {"pin": "4821"}, device="otherDev")
    other_token = ok["token"]
    print("  맞는 PIN → 토큰 발급:", bool(other_token))
    assert call("GET", "/api/guides", device="otherDev", cookie=other_token)["items"]

    print("=== 기기별로 토큰이 다르다 ===")
    assert other_token != token
    call("GET", "/api/guides", device="otherDev", cookie=token, expect=401)
    print("  남의 토큰으로는 통과 못 함")

    print("\n=== 사진(media)도 보호된다 ===")
    req = urllib.request.Request(f"http://localhost:{PORT}/media/none.png",
                                 headers={"X-Device-Id": "pinDev"})
    try:
        urllib.request.urlopen(req, timeout=10)
        code = 200
    except urllib.error.HTTPError as exc:
        code = exc.code
    print("  토큰 없이 /media:", code, "(401 이어야 정상)")
    assert code == 401

    print("\n=== PIN 변경 시 기존 토큰 무효 ===")
    res = call("PUT", "/api/settings", {"access_pin": "9999"}, cookie=token)
    new_token = res["newToken"]
    call("GET", "/api/guides", cookie=token, expect=401)
    assert call("GET", "/api/guides", cookie=new_token)["items"]
    print("  이전 토큰 차단 / 새 토큰 통과")

    print("\n=== 보호 해제 ===")
    call("PUT", "/api/settings", {"access_pin": ""}, cookie=new_token)
    assert call("GET", "/api/guides")["items"], "해제 후에도 막혀 있다"
    print("  해제 후 자유 접근 확인")

    print()
    if fails:
        print(f"❌ 실패 {len(fails)}건")
        for f in fails:
            print("  -", f)
        raise SystemExit(1)
    print("✅ 접근 보호(공용 PIN) 전체 통과")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    for p in (DB, DB + "-wal", DB + "-shm"):
        if os.path.exists(p):
            os.remove(p)
    shutil.rmtree(DRAFTS, ignore_errors=True)
    shutil.rmtree(MEDIA, ignore_errors=True)
