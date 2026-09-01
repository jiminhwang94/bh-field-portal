"""REST API 라우팅 계층."""

import hashlib
import json
import os
import re
import time
import unicodedata

from . import db
from . import sheets
from . import sync

# 앱 코드가 바뀌면 값이 달라지는 빌드 해시 — 화면 자동 갱신 판단에 사용
_BUILD_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BUILD_TARGETS = ("web", "app", "server.py")

MAX_UPLOAD_BYTES = 40 * 1024 * 1024  # 40MB
ALLOWED_UPLOAD_PREFIXES = ("image/", "video/", "audio/")
ALLOWED_UPLOAD_EXACT = ("application/pdf",)


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message



def build_hash() -> str:
    digest = hashlib.sha256()
    paths = []
    for target in _BUILD_TARGETS:
        full = os.path.join(_BUILD_ROOT, target)
        if os.path.isfile(full):
            paths.append(full)
            continue
        for root, dirs, files in os.walk(full):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            paths.extend(os.path.join(root, f) for f in files
                         if not f.endswith(".pyc"))
    for path in sorted(paths):
        try:
            with open(path, "rb") as handle:
                digest.update(os.path.relpath(path, _BUILD_ROOT).encode())
                digest.update(handle.read())
        except OSError:
            continue
    return digest.hexdigest()[:12]


def _safe_filename(name: str) -> str:
    name = unicodedata.normalize("NFC", name or "")
    name = os.path.basename(name).replace("\x00", "")
    stem, ext = os.path.splitext(name)
    ext = re.sub(r"[^A-Za-z0-9.]", "", ext)[:12]
    stem = re.sub(r"[^0-9A-Za-z가-힣._-]", "_", stem)[:60] or "file"
    return f"{time.strftime('%Y%m%d-%H%M%S')}-{db.new_id()[:8]}-{stem}{ext}"


# ------------------------------------------------------------------ 라우터

def handle(method: str, path: str, query: dict, body, content_type="",
           headers=None):
    """(status, payload) 반환. payload 는 JSON 직렬화 가능한 객체."""
    headers = headers or {}
    device_id = (headers.get("X-Device-Id") or headers.get("x-device-id") or "")

    segments = [s for s in path.strip("/").split("/") if s]
    if not segments or segments[0] != "api":
        raise ApiError(404, "존재하지 않는 API 경로입니다.")
    segments = segments[1:]

    def json_body():
        if body is None or len(body) == 0:
            return {}
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "요청 본문이 올바른 JSON 이 아닙니다.")
        if not isinstance(parsed, dict):
            raise ApiError(400, "요청 본문은 JSON 객체여야 합니다.")
        return parsed

    head = segments[0] if segments else ""
    rest = segments[1:]

    # ------------------------------------------------------------------ 버전
    if head == "version" and method == "GET":
        settings = db.get_settings()
        detected = _request_base_url(headers)
        return 200, {
            "version": db.APP_VERSION,
            "buildHash": build_hash(),
            "serverTime": db.now(),
            "siteUrl": (settings.get("site_url") or "").strip() or detected,
            "detectedUrl": detected,
            "siteUrlConfigured": bool((settings.get("site_url") or "").strip()),
        }

    # ---------------------------------------------------- 기기 ↔ 공개본 동기화
    if head == "sync":
        # 공개본 버전만 확인 (자주 호출되므로 가볍게)
        if rest == ["head"] and method == "GET":
            return 200, db.published_state()

        # 공개본 전체 내려주기
        if rest == ["pull"] and method == "GET":
            return 200, sync.build_snapshot()

        # 기기 내용을 공개본으로 받기 (= [⬆️ 업데이트])
        if rest == ["push"] and method == "POST":
            data = json_body()
            name = (data.get("deviceName") or "").strip()
            try:
                return 200, sync.apply_snapshot(data, name)
            except ValueError as exc:
                raise ApiError(400, str(exc))

        # v2 에서 서버에 남아 있던 리포트 넘겨주기 (앱 첫 실행 1회)
        if rest == ["legacy"] and method == "GET":
            return 200, sync.legacy_payload(device_id)

        # 재고 수량 즉시 반영
        if rest == ["quantities"] and method == "POST":
            try:
                return 200, sync.apply_quantities(json_body().get("ops"))
            except ValueError as exc:
                raise ApiError(400, str(exc))

    # 브라우저가 구글로 직접 보내지 못할 때만 쓰는 우회 통로
    if head == "sheets" and rest == ["relay"] and method == "POST":
        return _relay_to_sheets(json_body())

    # ----------------------------------------------------------- settings
    if head == "settings":
        if not rest:
            if method in ("PUT", "PATCH"):
                data = json_body()
                if "sheets_spreadsheet_id" in data:
                    data["sheets_spreadsheet_id"] = sheets.extract_spreadsheet_id(
                        data["sheets_spreadsheet_id"])
                if "sheets_webapp_url" in data:
                    data["sheets_webapp_url"] = _clean_webapp_url(
                        data["sheets_webapp_url"])
                if "site_url" in data:
                    data["site_url"] = str(data["site_url"] or "").strip().rstrip("/")
                data.pop("access_pin", None)      # v3.2 에서 제거된 설정
                db.save_settings(data)
                return 200, _settings_payload()

    # -------------------------------------------------------------- media
    if head == "media" and not rest and method == "POST":
        return _upload(query, body, content_type)

    raise ApiError(404, f"지원하지 않는 요청입니다: {method} /{path.strip('/')}")


# ------------------------------------------------------------------ helpers

def _settings_payload() -> dict:
    settings = db.get_settings()
    settings["spreadsheetUrl"] = sheets.spreadsheet_url(settings)
    settings["sheetsReady"] = bool((settings.get("sheets_webapp_url") or "").strip())
    # 폐기된 키가 예전 DB 에 남아 있을 수 있다 — 내보내지 않는다.
    settings.pop("access_pin", None)
    settings.pop("auth_secret", None)
    return settings


def _clean_webapp_url(value) -> str:
    url = str(value or "").strip()
    if not url:
        return ""
    if not url.startswith("https://"):
        raise ApiError(400, "웹 앱 URL 은 https:// 로 시작해야 합니다.")
    if "script.google.com" not in url:
        raise ApiError(
            400,
            "Apps Script 웹 앱 URL 이 아닙니다. "
            "script.google.com/macros/s/.../exec 형태여야 합니다.")
    if not url.rstrip("/").endswith("/exec"):
        raise ApiError(
            400,
            "URL 이 /exec 로 끝나야 합니다. Apps Script [배포 관리]의 웹 앱 URL 을 복사하세요.")
    return url


def _lan_ip(fallback="127.0.0.1") -> str:
    """태블릿에서 접속할 수 있는 이 PC 의 사설 IP."""
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except OSError:
        return fallback


def _request_base_url(headers) -> str:
    """클라이언트가 실제로 접속한 주소. 설정이 비어 있을 때 사진 링크에 사용."""
    host = (headers.get("Host") or "").strip()
    if not host:
        return f"http://{_lan_ip()}:{os.environ.get('PORT', '8787')}"
    scheme = os.environ.get("BH_SCHEME", "http")
    # localhost 로 접속했더라도 다른 기기에서 열릴 수 있게 사설 IP 로 바꿔준다.
    name = host.split(":")[0]
    if name in ("localhost", "127.0.0.1", "::1"):
        port = host.split(":")[1] if ":" in host else os.environ.get("PORT", "8787")
        host = f"{_lan_ip()}:{port}"
    return f"{scheme}://{host}"


def _relay_to_sheets(data: dict):
    """기기 → 구글 직접 전송이 막혔을 때만 서버가 대신 보내 준다.

    리포트 내용은 서버에 저장하지 않고 그대로 넘기기만 한다.
    """
    endpoint = _clean_webapp_url(data.get("endpoint"))
    payload = data.get("payload")
    if not isinstance(payload, dict):
        raise ApiError(400, "payload 는 JSON 객체여야 합니다.")
    try:
        return 200, sheets.post_to_webapp(endpoint, payload)
    except sheets.SheetsError as exc:
        raise ApiError(400, str(exc))


def _upload(query, body, content_type):
    if not body:
        raise ApiError(400, "업로드할 파일이 비어 있습니다.")
    if len(body) > MAX_UPLOAD_BYTES:
        raise ApiError(413, "파일이 너무 큽니다. (최대 40MB)")
    mime = (content_type or "application/octet-stream").split(";")[0].strip()
    if not (mime.startswith(ALLOWED_UPLOAD_PREFIXES) or mime in ALLOWED_UPLOAD_EXACT):
        raise ApiError(415, f"허용되지 않는 파일 형식입니다: {mime}")
    original = (query.get("filename") or ["upload"])[0]
    filename = _safe_filename(original)
    os.makedirs(db.MEDIA_DIR, exist_ok=True)
    target = os.path.join(db.MEDIA_DIR, filename)
    with open(target, "wb") as handle:
        handle.write(body)
    return 201, db.register_media(filename, original, mime, len(body))
