"""기본 CRUD API 스모크 테스트.

실행 방법 (저장소 루트에서):
    DATABASE_URL=/tmp/bh-test.db DRAFT_DIR=/tmp/bh-test-drafts \
        MEDIA_DIR=/tmp/bh-test-media python3 server.py --port 8788 &
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
        return text


print("--- 가이드 CRUD ---")
g = call("POST", "/api/guides", {
    "categoryType": "ERROR_CODE", "codeOrTitle": "E-999 테스트",
    "summary": "요약", "requiredTools": "멀티미터, 렌치",
    "commands": [{"label": "확인", "cmd": "bhctl version", "desc": "주의"},
                 {"label": "빈 명령", "cmd": "  ", "desc": ""}],
    "steps": [{"instruction": "1단계", "expectedMetric": "DC 24V"},
              {"instruction": "  "},
              {"instruction": "2단계"}],
}, expect=201)
gid = g["id"]
assert len(g["commands"]) == 1, "빈 명령어가 걸러지지 않음"
assert len(g["steps"]) == 2, f"빈 단계가 걸러지지 않음: {g['steps']}"
assert g["steps"][1]["stepOrder"] == 2, "단계 순서 재정렬 실패"

detail = call("GET", f"/api/guides/{gid}")
assert detail["codeOrTitle"] == "E-999 테스트"

upd = call("PUT", f"/api/guides/{gid}", {
    "categoryType": "SOFTWARE_CMD", "codeOrTitle": "E-999 수정", "summary": "",
    "requiredTools": "", "commands": [], "steps": [{"instruction": "수정 단계"}]})
assert upd["categoryType"] == "SOFTWARE_CMD" and len(upd["steps"]) == 1

call("POST", "/api/guides", {"categoryType": "BAD", "codeOrTitle": "x"}, expect=400)
call("POST", "/api/guides", {"categoryType": "ERROR_CODE", "codeOrTitle": " "}, expect=400)
call("GET", "/api/guides/nonexistent000000", expect=404)
call("DELETE", f"/api/guides/{gid}")
call("GET", f"/api/guides/{gid}", expect=404)

print("--- 검색 ---")
res = call("GET", "/api/guides?q=24V")
assert len(res["items"]) == 1 and "E-101" in res["items"][0]["codeOrTitle"]
res = call("GET", "/api/guides?q=bhctl")
assert len(res["items"]) >= 2, "명령어 본문 검색 실패"

print("--- 재고 ---")
inv = call("GET", "/api/inventory?vehicle=스타리아 1호차")
assert len(inv["items"]) == 8
item = call("POST", "/api/inventory", {
    "vehicleName": "스타리아 1호차", "partName": "테스트 부품",
    "quantity": 2, "minQuantity": 1}, expect=201)
call("POST", "/api/inventory", {
    "vehicleName": "스타리아 1호차", "partName": "테스트 부품"}, expect=400)
r = call("PATCH", f"/api/inventory/{item['id']}", {"delta": 3})
assert r["quantity"] == 5, r
r = call("PATCH", f"/api/inventory/{item['id']}", {"delta": -99})
assert r["quantity"] == 0, "음수 방어 실패"
r = call("PATCH", f"/api/inventory/{item['id']}", {"quantity": 7, "minQuantity": 3,
                                                  "partName": "이름변경"})
assert r["quantity"] == 7 and r["partName"] == "이름변경"
call("DELETE", f"/api/inventory/{item['id']}")
call("PATCH", f"/api/inventory/{item['id']}", {"delta": 1}, expect=404)

print("--- 동적 필드 ---")
fields = call("GET", "/api/report-fields")["items"]
assert len(fields) == 9
f = call("POST", "/api/report-fields", {
    "fieldLabel": "테스트 항목", "fieldType": "DROPDOWN",
    "options": "A,B", "isRequired": True}, expect=201)
call("POST", "/api/report-fields", {"fieldLabel": "x", "fieldType": "DROPDOWN"},
     expect=400)
call("POST", "/api/report-fields", {"fieldLabel": "x", "fieldType": "WRONG"},
     expect=400)
ids = [x["id"] for x in call("GET", "/api/report-fields")["items"]]
reordered = call("POST", "/api/report-fields/reorder", {"ids": ids[::-1]})["items"]
assert reordered[0]["id"] == ids[-1], "정렬 변경 실패"
call("POST", "/api/report-fields/reorder", {"ids": ids})
call("PUT", f"/api/report-fields/{f['id']}", {
    "fieldLabel": "수정 항목", "fieldType": "TEXT", "isRequired": False})
call("DELETE", f"/api/report-fields/{f['id']}")

print("--- 미디어 업로드 ---")
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001od".replace("od", "0d")
    + "0a2db40000000049454e44ae426082")
media = call("POST", "/api/media?filename=현장 사진.png", raw=png,
             ctype="image/png", expect=201)
assert media["url"].startswith("/media/")
got = call("GET", media["url"])
call("POST", "/api/media?filename=x.exe", raw=b"MZ",
     ctype="application/x-msdownload", expect=415)
call("POST", "/api/media?filename=empty.png", raw=b"", ctype="image/png", expect=400)
call("GET", "/media/../app.db", expect=404)

print("--- 리포트 ---")
fields = call("GET", "/api/report-fields")["items"]
values = []
for fl in fields:
    if fl["fieldType"] == "MEDIA":
        values.append({"fieldId": fl["id"], "label": fl["fieldLabel"],
                       "type": "MEDIA", "media": [media]})
    else:
        v = "완료" if fl["fieldType"] == "DROPDOWN" else (
            "30" if fl["fieldType"] == "NUMBER" else f"{fl['fieldLabel']} 값")
        values.append({"fieldId": fl["id"], "label": fl["fieldLabel"],
                       "type": fl["fieldType"], "value": v})

incomplete = [dict(v, value="") if v["type"] != "MEDIA" else v for v in values]
call("POST", "/api/reports", {"values": incomplete}, expect=400)
draft = call("POST", "/api/reports", {"values": incomplete, "draft": True}, expect=201)
call("DELETE", f"/api/reports/{draft['id']}")

rep = call("POST", "/api/reports", {"values": values}, expect=201)
assert rep["title"] == "방문 식당명 값", rep["title"]
assert rep["status"] == "DRAFT"
call("GET", f"/api/reports/{rep['id']}")
listed = call("GET", "/api/reports")["items"]
assert any(x["id"] == rep["id"] for x in listed)

print("--- 구글 시트 업로드 (미설정 → 오류) ---")
call("POST", f"/api/reports/{rep['id']}/sheet", expect=400)
call("DELETE", f"/api/reports/{rep['id']}")

print("--- 설정 ---")
s2 = call("PUT", "/api/settings", {"site_url": "https://errorcode.beyondhoneycomb.com"})
assert s2["site_url"] == "https://errorcode.beyondhoneycomb.com"
s2 = call("PUT", "/api/settings", {
    "sheets_spreadsheet_id":
        "https://docs.google.com/spreadsheets/d/1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4/edit"})
assert s2["sheets_spreadsheet_id"] == "1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4"
call("PUT", "/api/settings", {"sheets_webapp_url": "https://evil.example.com/exec"},
     expect=400)

print("--- 잘못된 요청 ---")
call("GET", "/api/unknown", expect=404)
call("POST", "/api/guides", raw=b"{not json", ctype="application/json", expect=400)
call("DELETE", "/api/settings", expect=404)

print()
if fails:
    print(f"❌ 실패 {len(fails)}건")
    for f in fails:
        print("  -", f)
    raise SystemExit(1)
print("✅ 기본 CRUD API 전체 통과")
