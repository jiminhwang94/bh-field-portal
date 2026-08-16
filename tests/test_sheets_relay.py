"""구글 시트 전송 검사 (v3.0).

v3.0 부터 리포트는 **기기에서 구글로 직접** 보낸다 (web/js/sheets.js).
서버는 브라우저가 직접 요청을 막았을 때만 대신 보내 준다.

여기서는 서버가 책임지는 부분만 검사한다.
- 웹 앱 URL 검증 (잘못된 주소를 그냥 흘려보내지 않는지)
- 응답 해석과 오류 메시지 (구글 로그인 HTML 이 오는 흔한 실수 포함)
- 대신 보내기(relay) 경로가 리포트를 서버에 저장하지 않는지

기기 쪽 전송 형식(월별 시트 이름·2행 항목명·사진 삽입)은 web/js/sheets.js 에 있고
브라우저에서 확인한다. → docs/WORKLOG.md 의 "확인한 것 / 확인 못 한 것" 참고

실행: python3 tests/test_sheets_relay.py
"""
import http.server
import json
import os
import shutil
import sys
import threading

CODE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = "/tmp/bh-sheets-test"
sys.path.insert(0, CODE)

shutil.rmtree(ROOT, ignore_errors=True)
os.makedirs(os.path.join(ROOT, "media"), exist_ok=True)
os.environ["DATABASE_URL"] = os.path.join(ROOT, "app.db")
os.environ["MEDIA_DIR"] = os.path.join(ROOT, "media")

from app import api, db, sheets       # noqa: E402

fails = []


def check(label, ok, detail=""):
    print(f"{'✅' if ok else '❌'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(label)


# ------------------------------------------------ 가짜 Apps Script 서버
received = []


class FakeScript(http.server.BaseHTTPRequestHandler):
    mode = "ok"

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        received.append(json.loads(body.decode()))
        if FakeScript.mode == "html":          # 배포 URL 오류 시 구글이 주는 응답
            payload = b"<html><body>Sign in</body></html>"
            ctype = "text/html"
        elif FakeScript.mode == "error":
            payload = json.dumps({"ok": False, "error": "시트를 찾을 수 없음"}).encode()
            ctype = "application/json"
        else:
            payload = json.dumps({"ok": True, "sheetName": "2026-08", "row": 3,
                                  "created": True, "images": 2}).encode()
            ctype = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


server = http.server.HTTPServer(("127.0.0.1", 0), FakeScript)
threading.Thread(target=server.serve_forever, daemon=True).start()
ENDPOINT = f"http://127.0.0.1:{server.server_port}/exec"

print("=" * 62)
print("구글 시트 전송 검사 (v3.0 — 서버는 우회 통로만 담당)")
print("=" * 62)

db.init()

# ------------------------------------------------------------ URL 검증
for bad, why in (
    ("", "빈 값"),
    ("http://example.com/exec", "https 아님"),
    ("https://example.com/exec", "script.google.com 아님"),
    ("https://script.google.com/macros/s/AAA/dev", "/exec 로 끝나지 않음"),
):
    try:
        api._clean_webapp_url(bad)
        check(f"잘못된 URL 을 거부한다 ({why})", bad == "", "통과됨")
    except api.ApiError:
        check(f"잘못된 URL 을 거부한다 ({why})", True)

good = "https://script.google.com/macros/s/AKfycbxxxx/exec"
check("정상 Apps Script URL 은 통과한다", api._clean_webapp_url(good) == good)

# 사용자가 스프레드시트 링크를 붙여넣어도 ID 만 뽑아낸다
check("스프레드시트 링크에서 ID 만 뽑는다",
      sheets.extract_spreadsheet_id(
          "https://docs.google.com/spreadsheets/d/ABC123/edit?usp=sharing") == "ABC123")

# -------------------------------------------------------- 응답 해석
FakeScript.mode = "ok"
payload = {"sheetName": "2026-08", "headers": ["작성일시", "작성자", "방문 식당명"],
           "row": ["2026-08-17 10:00:00", "황지민", "미트로"], "images": []}
result = sheets.post_to_webapp(ENDPOINT, payload)
check("정상 응답을 해석한다",
      result.get("row") == 3 and result.get("sheetName") == "2026-08", str(result))
check("보낸 내용이 그대로 전달된다",
      received[-1]["headers"][:2] == ["작성일시", "작성자"]
      and received[-1]["row"][2] == "미트로")

FakeScript.mode = "html"
try:
    sheets.post_to_webapp(ENDPOINT, payload)
    check("로그인 HTML 이 오면 안내 메시지를 준다", False, "예외가 나지 않음")
except sheets.SheetsError as exc:
    check("로그인 HTML 이 오면 안내 메시지를 준다",
          "배포 관리" in str(exc) or "모든 사용자" in str(exc), str(exc)[:60])

FakeScript.mode = "error"
try:
    sheets.post_to_webapp(ENDPOINT, payload)
    check("구글이 실패를 알리면 그대로 알려 준다", False, "예외가 나지 않음")
except sheets.SheetsError as exc:
    check("구글이 실패를 알리면 그대로 알려 준다", "시트를 찾을 수 없음" in str(exc))

# ------------------------------------------------- 대신 보내기(relay) 경로
def relay(endpoint, body_payload=None):
    return api.handle(
        "POST", "/api/sheets/relay", {},
        json.dumps({"endpoint": endpoint,
                    "payload": body_payload if body_payload is not None else payload}).encode(),
        "application/json", {"X-Device-Id": "devA"})


# 서버를 아무 주소로나 요청을 보내는 통로로 쓸 수 없어야 한다 (사내망 보호).
for target, why in ((ENDPOINT, "사내 주소"),
                    ("https://evil.example.com/exec", "구글 아님"),
                    ("http://169.254.169.254/latest/meta-data/", "내부 메타데이터 주소")):
    try:
        relay(target)
        check(f"임의 주소로 대신 보내기를 거부한다 ({why})", False, "통과됨")
    except api.ApiError as exc:
        check(f"임의 주소로 대신 보내기를 거부한다 ({why})", exc.status == 400)

try:
    relay("https://script.google.com/macros/s/AKfycbxxxx/exec", "문자열")
    check("payload 가 객체가 아니면 거부한다", False, "통과됨")
except api.ApiError as exc:
    check("payload 가 객체가 아니면 거부한다", exc.status == 400)

import sqlite3       # noqa: E402
conn = sqlite3.connect(os.environ["DATABASE_URL"])
tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
conn.close()
check("서버에 리포트를 저장하지 않는다 (기기 전용)", "report" not in tables,
      ", ".join(sorted(tables)))

server.shutdown()
print("=" * 62)
if fails:
    print(f"❌ 실패 {len(fails)}건: {', '.join(fails)}")
    sys.exit(1)
print("✅ 전부 통과")
