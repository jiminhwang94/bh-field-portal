"""구글 스프레드시트 전송 (서버 우회 통로).

**v3.0 부터 시트 업로드는 기기가 직접 한다.** (`web/js/sheets.js`)
사무실 서버를 거치지 않으므로 현장 LTE 에서도 리포트를 올릴 수 있다.

이 모듈은 두 경우에만 쓰인다.
- 브라우저가 구글로의 직접 요청을 막았을 때 (`/api/sheets/relay`)
- 설정 화면의 [연결 테스트]

전송 형식(기기가 만들어 보내는 값):
    {
      "sheetName": "2026-08",          # 월별 시트 이름
      "headers":   ["작성일시", ...],   # 2행에 기록될 항목명
      "row":       ["2026-08-02 ...", ...],
      "images":    [{"column": 11, "filename": "a.jpg",
                     "mimeType": "image/jpeg", "data": "<base64>"}]
    }
사진은 **링크가 아니라 이미지 자체**를 실어 보내고, 스크립트가 해당 칸에 삽입한다.
응답:
    {"ok": true, "sheetName": "2026-08", "row": 3, "created": true, "images": 2}
"""

import json
import os
import ssl
import urllib.error
import urllib.request

from . import db

TIMEOUT = 120                       # 사진을 함께 올리므로 넉넉하게
_SSL_CONTEXT = None


class SheetsError(Exception):
    pass


def ssl_context():
    """python.org macOS 빌드에 루트 인증서가 없는 경우까지 대응."""
    global _SSL_CONTEXT
    if _SSL_CONTEXT is not None:
        return _SSL_CONTEXT
    context = ssl.create_default_context()
    candidates = []
    try:
        import certifi
        candidates.append(certifi.where())
    except ImportError:
        pass
    candidates += ["/etc/ssl/cert.pem", "/opt/homebrew/etc/openssl@3/cert.pem",
                   "/etc/pki/tls/certs/ca-bundle.crt",
                   "/etc/ssl/certs/ca-certificates.crt"]
    for path in candidates:
        if path and os.path.isfile(path):
            try:
                context.load_verify_locations(cafile=path)
            except (ssl.SSLError, OSError):
                continue
    _SSL_CONTEXT = context
    return context


def spreadsheet_url(settings=None) -> str:
    settings = settings or db.get_settings()
    sid = (settings.get("sheets_spreadsheet_id") or "").strip()
    return f"https://docs.google.com/spreadsheets/d/{sid}/edit" if sid else ""


def extract_spreadsheet_id(value: str) -> str:
    """스프레드시트 URL 에서 ID 만 뽑는다. 이미 ID 면 그대로."""
    text = (value or "").strip()
    if not text:
        return ""
    marker = "/spreadsheets/d/"
    if marker in text:
        rest = text.split(marker, 1)[1]
        return rest.split("/")[0].split("?")[0]
    return text


def post_to_webapp(endpoint: str, payload: dict, timeout=TIMEOUT) -> dict:
    """Apps Script 웹 앱으로 JSON 을 보내고 결과를 돌려준다."""
    endpoint = (endpoint or "").strip()
    if not endpoint:
        raise SheetsError(
            "구글 시트 연결이 아직 설정되지 않았습니다.\n"
            "[⚙️ 설정 → 구글 시트 연결]에서 Apps Script 웹 앱 URL 을 등록하세요.")
    local = endpoint.startswith(("http://localhost", "http://127.0.0.1"))
    if not endpoint.startswith("https://") and not local:
        raise SheetsError("웹 앱 URL 은 https:// 로 시작해야 합니다.")

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint, data=data, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout,
                                    context=ssl_context()) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        if exc.code in (401, 403):
            raise SheetsError(
                "구글이 접근을 거부했습니다 (권한).\n"
                "Apps Script 배포 시 [액세스 권한]을 '모든 사용자'로 설정했는지 확인하세요."
            ) from exc
        raise SheetsError(f"구글 시트 오류 {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SheetsError(f"구글에 연결할 수 없습니다: {exc.reason}") from exc

    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        # 배포 URL 이 잘못되면 구글 로그인 HTML 이 돌아온다.
        if "<html" in body.lower():
            raise SheetsError(
                "웹 앱 URL 이 올바르지 않거나 로그인이 필요한 상태입니다.\n"
                "Apps Script → [배포 관리]에서 '웹 앱' URL(/exec 로 끝남)을 복사하고, "
                "액세스 권한을 '모든 사용자'로 설정하세요.")
        raise SheetsError(f"구글 응답을 해석할 수 없습니다: {body[:200]}")

    if not result.get("ok"):
        raise SheetsError(f"구글 시트 기록 실패: {result.get('error') or result}")
    return result


def test_connection(settings=None) -> dict:
    """설정 화면의 [연결 테스트]. 실제 기록 없이 응답만 확인한다."""
    settings = settings or db.get_settings()
    endpoint = (settings.get("sheets_webapp_url") or "").strip()
    if not endpoint:
        raise SheetsError("웹 앱 URL 을 먼저 입력하고 저장하세요.")
    result = post_to_webapp(endpoint, {"ping": True}, timeout=30)
    return {
        "ok": True,
        "spreadsheetName": result.get("spreadsheetName") or "",
        "spreadsheetUrl": result.get("spreadsheetUrl") or spreadsheet_url(settings),
        "sheets": result.get("sheets") or [],
    }
