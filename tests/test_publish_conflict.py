"""동시 [업데이트] 덮어쓰기 방지 검사.

두 기사가 각자 오프라인에서 가이드를 고치고 둘 다 [⬆ 업데이트] 를 누르면,
예전에는 **나중에 누른 쪽이 먼저 올린 사람의 가이드를 말없이 지웠다.**
기기가 "내가 마지막으로 받아간 버전"(baseRevision)을 보내는데 서버가 그걸 무시했기 때문이다.

이제 서버는 그 값이 현재 공개 버전보다 낮으면 **409 로 거절**하고,
앱이 사용자에게 물어본 뒤에만 force 로 덮어쓴다.

먼저 서버를 띄우고 실행한다:
    BH_DATA_DIR=/tmp/bhconflict python3 server.py --port 8791 &
    python3 tests/test_publish_conflict.py
"""

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("BH_TEST_BASE", "http://localhost:8791")
failures = []


def check(label, ok, detail=""):
    print(f"{'✅' if ok else '❌'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def call(method, path, body=None, device="test"):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"X-Device-Id": device}
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers,
                                 method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return exc.code, {"error": raw[:200]}


def snapshot(base_revision, code, force=False):
    body = {
        "deviceName": f"기사-{code}",
        "baseRevision": base_revision,
        "guides": [{"id": f"g-{code}", "categoryType": "ERROR_CODE",
                    "codeOrTitle": code, "summary": "", "requiredTools": "",
                    "commands": [], "steps": []}],
        "vehicles": [], "inventory": [], "fields": [],
    }
    if force:
        body["force"] = True
    return body


def codes():
    _, snap = call("GET", "/api/sync/pull")
    return sorted(g["codeOrTitle"] for g in snap.get("guides", []))


print("=" * 62)
print("동시 [업데이트] 덮어쓰기 방지 검사")
print("=" * 62)

status, head = call("GET", "/api/sync/head")
start = int(head.get("revision") or 0)
check("공개 버전을 읽을 수 있다", status == 200, f"버전 {start}")

# 기사 A: 최신을 받아간 상태에서 올린다 → 성공
status, result = call("POST", "/api/sync/push", snapshot(start, "E-AAA"), "devA")
check("최신을 받아간 기기는 올릴 수 있다", status == 200, f"버전 {result.get('revision')}")
after_a = int(result.get("revision") or 0)
check("공개 버전이 올라간다", after_a > start, f"{start} → {after_a}")
check("A 의 가이드가 공개본에 있다", codes() == ["E-AAA"], str(codes()))

# 기사 B: 아직 예전 버전을 들고 있다 → 거절돼야 한다
status, result = call("POST", "/api/sync/push", snapshot(start, "E-BBB"), "devB")
check("뒤처진 기기의 업데이트를 거절한다 (409)", status == 409, f"HTTP {status}")
check("거절 사유에 누가·언제가 들어 있다",
      "먼저 업데이트" in str(result.get("error", "")), str(result.get("error"))[:80])
check("거절됐으므로 A 의 가이드가 그대로다", codes() == ["E-AAA"], str(codes()))

# 사용자가 화면에서 확인하면 force 로 덮어쓴다
status, result = call("POST", "/api/sync/push",
                      snapshot(start, "E-BBB", force=True), "devB")
check("사용자가 확인하면 덮어쓸 수 있다 (force)", status == 200, f"HTTP {status}")
check("덮어쓴 뒤에는 B 의 가이드가 남는다", codes() == ["E-BBB"], str(codes()))

# 최신을 받아간 뒤에는 다시 정상으로 올라간다
_, head = call("GET", "/api/sync/head")
status, _ = call("POST", "/api/sync/push",
                 snapshot(int(head.get("revision") or 0), "E-CCC"), "devB")
check("최신을 받아가면 다시 정상으로 올라간다", status == 200, f"HTTP {status}")

# baseRevision 을 안 보내는 예전 앱은 막지 않는다 (배포 중 호환)
body = snapshot(0, "E-OLD")
body.pop("baseRevision")
status, _ = call("POST", "/api/sync/push", body, "devOld")
check("baseRevision 을 안 보내는 예전 앱은 그대로 통과시킨다", status == 200,
      f"HTTP {status}")

print("=" * 62)
if failures:
    print(f"❌ 실패 {len(failures)}건: {', '.join(failures)}")
    sys.exit(1)
print("✅ 전부 통과 — 먼저 올린 사람의 가이드가 말없이 지워지지 않습니다.")
