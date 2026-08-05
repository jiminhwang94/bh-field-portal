"""재고 수량 즉시 공유 검증 (D-3).

수량은 공개본에 바로 기록되어 모든 사용자에게 즉시 보이고,
품목·차량 추가/삭제는 [업데이트] 를 눌러야 공유된다.

실행: python3 tests/test_inventory_live.py
"""
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
PORT = 8793
DB = "/tmp/bh-d3.db"
DRAFTS = "/tmp/bh-d3-drafts"
MEDIA = "/tmp/bh-d3-media"
fails = []


def call(method, path, body=None, expect=200, device=None):
    url = f"http://localhost:{PORT}" + urllib.parse.quote(path, safe="/?=&.")
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if device:
        headers["X-Device-Id"] = device
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status, text = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        status, text = exc.code, exc.read().decode("utf-8", "replace")
    if status != expect:
        fails.append(f"{method} {path}[{device}] -> {status} (기대 {expect}): {text[:150]}")
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
    A, B = "devA", "devB"
    V = "스타리아 1호차"

    def qty(device, part="퓨즈 10A"):
        items = call("GET", f"/api/inventory?vehicle={V}", device=device)["items"]
        return next(i for i in items if i["partName"] == part)

    print("=== 초기: 두 기기가 같은 수량을 본다 ===")
    a, b = qty(A), qty(B)
    print(f"  A={a['quantity']} B={b['quantity']}")
    assert a["quantity"] == b["quantity"] == 10

    print("\n=== A 가 [-] 3회 → B 에게 즉시 반영되어야 함 ===")
    for _ in range(3):
        call("PATCH", f"/api/inventory/{a['id']}", {"delta": -1}, device=A)
    a2, b2 = qty(A), qty(B)
    print(f"  A={a2['quantity']} B={b2['quantity']} ([업데이트] 없이)")
    assert a2["quantity"] == 7, a2
    assert b2["quantity"] == 7, "수량이 즉시 공유되지 않았다"

    print("=== 수량 변경으로 [업데이트] 버튼이 켜지지 않아야 함 ===")
    st = call("GET", "/api/state", device=A)
    print(f"  A hasLocalChanges={st['hasLocalChanges']} (False 여야 정상)")
    assert st["hasLocalChanges"] is False, "수량 변경이 '내 변경'으로 잡혔다"

    print("\n=== B 가 [+] → A 에게도 즉시 ===")
    call("PATCH", f"/api/inventory/{b2['id']}", {"delta": +5}, device=B)
    print(f"  A={qty(A)['quantity']} B={qty(B)['quantity']}")
    assert qty(A)["quantity"] == 12 and qty(B)["quantity"] == 12

    print("\n=== 반대로: 품목 추가는 [업데이트] 전까지 공유 안 됨 ===")
    call("POST", "/api/inventory", {"vehicleName": V, "partName": "신규부품",
                                    "quantity": 4}, expect=201, device=A)
    a_names = [i["partName"] for i in call("GET", f"/api/inventory?vehicle={V}",
                                          device=A)["items"]]
    b_names = [i["partName"] for i in call("GET", f"/api/inventory?vehicle={V}",
                                          device=B)["items"]]
    print(f"  A 에 보임={'신규부품' in a_names} / B 에 보임={'신규부품' in b_names} (B는 False)")
    assert "신규부품" in a_names and "신규부품" not in b_names
    st = call("GET", "/api/state", device=A)
    print(f"  A hasLocalChanges={st['hasLocalChanges']} (True 여야 정상)")
    assert st["hasLocalChanges"] is True, "품목 추가가 '내 변경'으로 안 잡혔다"

    print("=== [업데이트] 후 B 에게도 보이고, 수량도 유지 ===")
    call("POST", "/api/publish", {"deviceName": "A기기"}, device=A)
    b_items = call("GET", f"/api/inventory?vehicle={V}", device=B)["items"]
    new_item = next((i for i in b_items if i["partName"] == "신규부품"), None)
    print(f"  B 에 신규부품={bool(new_item)} 수량={new_item and new_item['quantity']}")
    assert new_item and new_item["quantity"] == 4
    print(f"  퓨즈 수량 유지: {qty(B)['quantity']} (12 여야 함 — 업데이트가 덮어쓰지 않음)")
    assert qty(B)["quantity"] == 12, "[업데이트]가 실시간 수량을 덮어썼다"

    print("\n=== 품목 삭제 시 수량 기록도 정리 ===")
    call("DELETE", f"/api/inventory/{new_item['id']}", device=B)
    call("POST", "/api/publish", {"deviceName": "B기기"}, device=B)
    names = [i["partName"] for i in call("GET", f"/api/inventory?vehicle={V}",
                                        device=A)["items"]]
    assert "신규부품" not in names
    print("  삭제 반영 확인")

    print("\n=== 이름 변경 시 수량 이관 ===")
    fuse = qty(A)
    call("PATCH", f"/api/inventory/{fuse['id']}", {"partName": "퓨즈 15A"}, device=A)
    renamed = qty(A, "퓨즈 15A")
    print(f"  퓨즈 15A 수량={renamed['quantity']} (12 유지되어야 함)")
    assert renamed["quantity"] == 12, "이름 변경 후 수량이 사라졌다"

    print()
    if fails:
        print(f"❌ 실패 {len(fails)}건")
        for f in fails:
            print("  -", f)
        raise SystemExit(1)
    print("✅ D-3 재고 수량 즉시 공유 전체 통과")
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
