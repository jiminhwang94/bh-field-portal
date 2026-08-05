"""구글 시트 업로드 검증.

Apps Script 를 실제로 실행할 수는 없으므로, `google-apps-script.gs` 와 **같은 규칙**
(월별 시트 / 1행 공백 / 2행 헤더 / 3행부터 데이터)을 구현한 모의 서버로 검증한다.
"""
import json
import os
import shutil
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CODE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ["DATABASE_URL"] = "/tmp/bh-sheets.db"
os.environ["DRAFT_DIR"] = "/tmp/bh-sheets-drafts"
os.environ["MEDIA_DIR"] = "/tmp/bh-sheets-media"
for path in ("/tmp/bh-sheets.db", "/tmp/bh-sheets.db-wal", "/tmp/bh-sheets.db-shm"):
    if os.path.exists(path):
        os.remove(path)
shutil.rmtree("/tmp/bh-sheets-drafts", ignore_errors=True)
sys.path.insert(0, CODE)

from app import db, sheets  # noqa: E402

db.init()

# ---------------------------------------------- Apps Script 규칙 모의 구현
BOOK = {}
CALLS = []
IMAGES = []


class MockScript(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        size = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(size).decode() or "{}")
        CALLS.append(body)

        if body.get("ping"):
            return self._json({"ok": True, "spreadsheetName": "이슈 관리",
                               "sheets": list(BOOK.keys())})

        name = body["sheetName"]
        headers = body.get("headers") or []
        row = body.get("row") or []
        images = body.get("images") or []
        created = name not in BOOK
        if created:
            BOOK[name] = [[], []]              # 1행 공백, 2행 자리
        sheet = BOOK[name]
        if headers:
            sheet[1] = list(headers)           # 2행 = 헤더
        last_row = len(sheet)
        target = 3 if last_row < 2 else last_row + 1
        if target < 3:
            target = 3
        while len(sheet) < target:
            sheet.append([])
        sheet[target - 1] = list(row)
        # insertImages 와 같은 동작: base64 를 디코드해 (행, 열)에 이미지 기록
        import base64
        inserted = 0
        for img in images:
            try:
                raw = base64.b64decode(img["data"])
            except Exception:
                continue
            IMAGES.append({"sheet": name, "row": target, "column": img["column"],
                           "filename": img["filename"], "mime": img["mimeType"],
                           "bytes": raw})
            inserted += 1
        return self._json({"ok": True, "sheetName": name, "row": target,
                           "created": created, "images": inserted})

    def _json(self, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


server = ThreadingHTTPServer(("127.0.0.1", 8799), MockScript)
threading.Thread(target=server.serve_forever, daemon=True).start()

db.save_settings({"sheets_webapp_url": "http://127.0.0.1:8799/exec",
                  "site_url": "https://errorcode.beyondhoneycomb.com"})
db.set_device("testdev")
db.save_settings({"device_name": "황지민"})

fields = db.list_fields()
print("항목 순서:", [f["fieldLabel"] for f in fields])


def make_report(created_at, restaurant, media=None):
    values = []
    for f in fields:
        if f["fieldType"] == "MEDIA":
            values.append({"fieldId": f["id"], "label": f["fieldLabel"],
                           "type": "MEDIA", "media": media or []})
        else:
            value = {"DROPDOWN": "완료", "NUMBER": "45"}.get(
                f["fieldType"], restaurant if f["fieldLabel"] == "방문 식당명"
                else f"{f['fieldLabel']} 내용")
            values.append({"fieldId": f["id"], "label": f["fieldLabel"],
                           "type": f["fieldType"], "value": value})
    report = db.save_report({"values": values})
    conn = db.connect()
    conn.execute("UPDATE report SET created_at = ? WHERE id = ?",
                 (created_at, report["id"]))
    conn.commit()
    conn.close()
    return db.get_report(report["id"])


print("\n=== 페이로드 형식 ===")
r1 = make_report("2026-08-02T09:15:00", "행복식당 강남점",
                 [{"url": "/media/a.png", "filename": "a.png",
                   "originalName": "현장1.png", "mime": "image/png"}])
payload = sheets.build_payload(r1, fields)
print("  시트 이름:", payload["sheetName"])
print("  헤더:", payload["headers"])
print("  행:", payload["row"])
assert payload["sheetName"] == "2026-08"
assert payload["headers"][:2] == ["작성일시", "작성자"]
assert payload["headers"][2:] == [f["fieldLabel"] for f in fields]
assert payload["row"][0] == "2026-08-02 09:15:00"
assert payload["row"][1] == "황지민"
assert payload["row"][2] == "행복식당 강남점"
assert payload["row"][-1] == "https://errorcode.beyondhoneycomb.com/media/a.png"

print("\n=== 첫 업로드: 새 시트 생성 ===")
res = sheets.upload_report(r1, fields)
print("  결과:", res["sheetName"], res["row"], "새 시트:", res["created"])
assert res["created"] is True and res["row"] == 3
sheet = BOOK["2026-08"]
print("  1행:", sheet[0], "(비어 있어야 함)")
print("  2행:", sheet[1][:4], "...")
print("  3행:", sheet[2][:4], "...")
assert sheet[0] == [], "1행이 비어 있지 않다"
assert sheet[1][0] == "작성일시" and sheet[1][2] == "방문 식당명"
assert sheet[2][2] == "행복식당 강남점"

print("\n=== 같은 달 추가 업로드 → 4행, 5행 ===")
for i, name in enumerate(["미트로 판교", "행복식당 역삼"], start=4):
    r = make_report("2026-08-05T11:00:00", name)
    res = sheets.upload_report(r, fields)
    print(f"  {name} → {res['sheetName']} {res['row']}행 (새 시트: {res['created']})")
    assert res["row"] == i and res["created"] is False
assert len(BOOK["2026-08"]) == 5
assert BOOK["2026-08"][3][2] == "미트로 판교"
assert BOOK["2026-08"][4][2] == "행복식당 역삼"

print("\n=== 다음 달 → 새 시트 생성, 다시 3행부터 ===")
r = make_report("2026-09-01T08:30:00", "9월 첫 방문")
res = sheets.upload_report(r, fields)
print(f"  {res['sheetName']} {res['row']}행 (새 시트: {res['created']})")
assert res["sheetName"] == "2026-09" and res["created"] is True and res["row"] == 3
assert BOOK["2026-09"][0] == [] and BOOK["2026-09"][1][0] == "작성일시"
assert sorted(BOOK.keys()) == ["2026-08", "2026-09"]
assert len(BOOK["2026-08"]) == 5, "8월 시트가 영향을 받았다"

print("\n=== 항목 설정을 바꾸면 헤더도 갱신 ===")
db.save_field({"fieldLabel": "재방문 예정일", "fieldType": "TEXT"})
fields2 = db.list_fields()
r = make_report("2026-09-10T10:00:00", "항목 변경 후")
res = sheets.upload_report(r, fields2)
print("  2행 마지막 항목:", BOOK["2026-09"][1][-1])
print("  기록된 행:", res["row"])
assert BOOK["2026-09"][1][-1] == "재방문 예정일"
assert res["row"] == 4

print("\n=== 사진: 링크가 아니라 이미지 자체가 전송되는지 ===")
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000020000000208060000"
    "00727b0ae70000001849444154789c6360606060000000050001a5f6"
    "45400000000049454e44ae426082")
import os as _os
_os.makedirs(_os.environ["MEDIA_DIR"], exist_ok=True)
with open(_os.path.join(_os.environ["MEDIA_DIR"], "shot1.png"), "wb") as fh:
    fh.write(PNG)
with open(_os.path.join(_os.environ["MEDIA_DIR"], "shot2.png"), "wb") as fh:
    fh.write(PNG)
photo_media = [
    {"url": "/media/shot1.png", "filename": "shot1.png",
     "originalName": "현장1.png", "mime": "image/png"},
    {"url": "/media/shot2.png", "filename": "shot2.png",
     "originalName": "현장2.png", "mime": "image/png"},
]
rp = make_report("2026-08-02T09:15:00", "사진 포함 리포트", photo_media)
pl = sheets.build_payload(rp, fields)
photo_col = pl["headers"].index("현장 사진") + 1
print("  사진 열 번호:", photo_col)
print("  전송 이미지:", [(i["filename"], i["column"], len(i["data"])) for i in pl["images"]])
print("  사진 칸 내용:", repr(pl["row"][photo_col - 1]))
assert len(pl["images"]) == 2, pl["images"]
assert all(i["column"] == photo_col for i in pl["images"])
assert "http" not in pl["row"][photo_col - 1], "여전히 링크가 들어간다"
assert pl["row"][photo_col - 1] == "사진 2장"

res = sheets.upload_report(rp, fields)
print("  업로드 결과: 사진", res["images"], "장 삽입 |", res["sheetName"], res["row"], "행")
assert res["images"] == 2
got = [i for i in IMAGES if i["row"] == res["row"]]
assert len(got) == 2
assert got[0]["bytes"] == PNG, "전달된 이미지가 원본과 다르다"
assert got[0]["column"] == photo_col
print("  시트에 도착한 이미지:", [(g["filename"], g["column"], len(g["bytes"])) for g in got])

print("\n=== 영상은 시트에 넣을 수 없어 링크로 ===")
with open(_os.path.join(_os.environ["MEDIA_DIR"], "clip.mp4"), "wb") as fh:
    fh.write(b"fake video data")
rv = make_report("2026-08-02T10:00:00", "영상 리포트",
                 [{"url": "/media/clip.mp4", "filename": "clip.mp4",
                   "originalName": "clip.mp4", "mime": "video/mp4"}])
# (1) 설정에 주소가 있으면 그것을 사용
pv = sheets.build_payload(rv, fields, base_url="http://192.168.0.83:8787")
cell = pv["row"][photo_col - 1]
print("  설정 주소 있을 때:", repr(cell))
assert pv["images"] == []
assert cell == "https://errorcode.beyondhoneycomb.com/media/clip.mp4"
print("  제외 사유:", pv["imagesSkipped"])

# (2) 설정을 비우면 접속한 서버 주소(base_url)를 사용
db.save_settings({"site_url": ""})
pv2 = sheets.build_payload(rv, fields, base_url="http://192.168.0.83:8787")
cell2 = pv2["row"][photo_col - 1]
print("  설정 비었을 때:", repr(cell2))
assert cell2 == "http://192.168.0.83:8787/media/clip.mp4"
assert "errorcode.beyondhoneycomb.com" not in cell2
db.save_settings({"site_url": "https://errorcode.beyondhoneycomb.com"})

print("\n=== 연결 테스트 ===")
info = sheets.test_connection()
print("  ", info["spreadsheetName"], "| 시트:", info["sheets"])
assert info["ok"] and "2026-08" in info["sheets"]

print("\n=== 오류 처리 ===")
db.save_settings({"sheets_webapp_url": ""})
try:
    sheets.upload_report(r, fields2)
    raise AssertionError("URL 없이 성공해버렸다")
except sheets.SheetsError as exc:
    print("  URL 미설정:", str(exc).splitlines()[0])
db.save_settings({"sheets_webapp_url": "http://127.0.0.1:8798/exec"})
try:
    sheets.upload_report(r, fields2)
    raise AssertionError("죽은 서버인데 성공해버렸다")
except sheets.SheetsError as exc:
    print("  연결 불가:", str(exc)[:60])

print("\n=== 스프레드시트 ID 추출 ===")
for raw, expect in [
    ("https://docs.google.com/spreadsheets/d/1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4/edit?usp=sharing",
     "1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4"),
    ("1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4",
     "1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4"),
]:
    got = sheets.extract_spreadsheet_id(raw)
    print("  ", raw[:48], "→", got)
    assert got == expect

server.shutdown()
for path in ("/tmp/bh-sheets.db", "/tmp/bh-sheets.db-wal", "/tmp/bh-sheets.db-shm"):
    if os.path.exists(path):
        os.remove(path)
shutil.rmtree("/tmp/bh-sheets-drafts", ignore_errors=True)
shutil.rmtree("/tmp/bh-sheets-media", ignore_errors=True)
print("\n✅ 구글 시트 기록 규칙 전체 통과 (월별 시트 · 1행 공백 · 2행 헤더 · 3행부터 데이터)")
