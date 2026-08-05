"""구글 스프레드시트 업로드.

구글 Sheets API 는 OAuth/서비스 계정이 필요해 일반 팀원이 쓰기 어렵다.
대신 스프레드시트에 붙인 **Apps Script 웹 앱** 으로 JSON 을 보내 기록한다.
(스크립트 코드는 프로젝트 루트의 `google-apps-script.gs` 참고)

전송 형식:
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
import time
import urllib.error
import urllib.parse
import urllib.request

from . import db

TIMEOUT = 120                       # 사진을 함께 올리므로 넉넉하게
META_HEADERS = ("작성일시", "작성자")
IMAGE_TOTAL_LIMIT = 20 * 1024 * 1024   # 한 리포트에 실어 보낼 사진 총 용량
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


def month_sheet_name(created_at: str) -> str:
    """리포트 작성 시각에서 'YYYY-MM' 시트 이름을 만든다."""
    text = (created_at or "").strip()
    if len(text) >= 7 and text[4] == "-":
        return text[:7]
    return time.strftime("%Y-%m", time.localtime())


def _image_entries(media_list, column, budget):
    """사진 파일을 base64 로 읽어 전송용 항목으로 만든다."""
    import base64
    import mimetypes as mt

    entries, skipped = [], []
    for media in media_list:
        filename = os.path.basename(media.get("filename") or "")
        if not filename:
            continue
        path = os.path.join(db.MEDIA_DIR, filename)
        if not os.path.isfile(path):
            skipped.append({"filename": filename, "reason": "파일 없음"})
            continue
        size = os.path.getsize(path)
        if size > budget[0]:
            skipped.append({"filename": filename, "reason": "용량 초과"})
            continue
        mime = media.get("mime") or mt.guess_type(filename)[0] or "image/jpeg"
        if not mime.startswith("image/"):
            # 영상 등은 시트에 넣을 수 없어 파일명만 남긴다.
            skipped.append({"filename": filename, "reason": "이미지 아님"})
            continue
        with open(path, "rb") as handle:
            raw = handle.read()
        budget[0] -= size
        entries.append({
            "column": column,
            "filename": media.get("originalName") or filename,
            "mimeType": mime,
            "data": base64.b64encode(raw).decode("ascii"),
        })
    return entries, skipped


def build_payload(report: dict, fields: list, settings=None, base_url="") -> dict:
    """리포트를 시트 한 줄 + 사진 이미지로 만든다.

    열 순서는 [항목 설정] 순서를 따르고, 사진 항목 칸에는 이미지가 삽입된다.
    """
    settings = settings or db.get_settings()
    site = (settings.get("site_url") or base_url or "").strip().rstrip("/")

    labels = [f["fieldLabel"] for f in fields]
    by_label = {}
    for item in report.get("payload") or []:
        by_label[item.get("label")] = item
    for item in report.get("payload") or []:
        label = item.get("label")
        if label and label not in labels:
            labels.append(label)

    headers = list(META_HEADERS) + labels
    row = [
        (report.get("createdAt") or "").replace("T", " "),
        (settings.get("device_name") or "").strip() or "-",
    ]
    images, skipped = [], []
    budget = [IMAGE_TOTAL_LIMIT]

    for index, label in enumerate(labels):
        column = len(META_HEADERS) + index + 1      # 1-based 열 번호
        item = by_label.get(label)
        if not item:
            row.append("")
            continue
        if item.get("type") == "MEDIA":
            media_list = item.get("media") or []
            entries, missed = _image_entries(media_list, column, budget)
            images.extend(entries)
            skipped.extend(missed)
            # 칸에는 이미지가 들어가므로 개수만 간단히 남긴다.
            leftover = [m for m in media_list
                        if any(s["filename"] == os.path.basename(m.get("filename") or "")
                               for s in missed)]
            note = f"사진 {len(entries)}장" if entries else ""
            if leftover:
                links = []
                for media in leftover:
                    url = media.get("url") or ""
                    links.append(f"{site}{url}" if site and url.startswith("/") else url)
                note = (note + "\n" if note else "") + "\n".join(links)
            row.append(note)
        else:
            row.append("" if item.get("value") is None else str(item["value"]))

    return {
        "sheetName": month_sheet_name(report.get("createdAt")),
        "headers": headers,
        "row": row,
        "images": images,
        "imagesSkipped": skipped,
    }


def upload_report(report: dict, fields: list, settings=None, base_url="") -> dict:
    settings = settings or db.get_settings()
    endpoint = (settings.get("sheets_webapp_url") or "").strip()
    if not endpoint:
        raise SheetsError(
            "구글 시트 연결이 아직 설정되지 않았습니다.\n"
            "[⚙️ 설정 → 구글 시트 연결]에서 Apps Script 웹 앱 URL 을 등록하세요.")
    local = endpoint.startswith(("http://localhost", "http://127.0.0.1"))
    if not endpoint.startswith("https://") and not local:
        raise SheetsError("웹 앱 URL 은 https:// 로 시작해야 합니다.")

    payload = build_payload(report, fields, settings, base_url)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint, data=data, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT,
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
    return {
        "sheetName": result.get("sheetName") or payload["sheetName"],
        "row": result.get("row"),
        "created": bool(result.get("created")),
        "images": int(result.get("images") or 0),
        "imagesSkipped": payload.get("imagesSkipped") or [],
        "spreadsheetUrl": spreadsheet_url(settings),
    }


def test_connection(settings=None) -> dict:
    """설정 화면의 [연결 테스트]. 실제 기록 없이 응답만 확인한다."""
    settings = settings or db.get_settings()
    endpoint = (settings.get("sheets_webapp_url") or "").strip()
    if not endpoint:
        raise SheetsError("웹 앱 URL 을 먼저 입력하고 저장하세요.")
    data = json.dumps({"ping": True}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint, data=data, method="POST",
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT,
                                    context=ssl_context()) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:200]
        raise SheetsError(f"연결 실패 {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SheetsError(f"연결 실패: {exc.reason}") from exc
    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        raise SheetsError(
            "응답이 JSON 이 아닙니다. 배포 URL(/exec)과 액세스 권한('모든 사용자')을 확인하세요.")
    if not result.get("ok"):
        raise SheetsError(f"응답 오류: {result.get('error') or result}")
    return {
        "ok": True,
        "spreadsheetName": result.get("spreadsheetName") or "",
        "spreadsheetUrl": result.get("spreadsheetUrl") or spreadsheet_url(settings),
        "sheets": result.get("sheets") or [],
    }
