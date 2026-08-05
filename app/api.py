"""REST API 라우팅 계층."""

import hashlib
import json
import os
import re
import time
import unicodedata

from . import db
from . import sheets

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


def _int(value, default=None):
    if value in (None, ""):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(400, "숫자 값이 올바르지 않습니다.")


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


AUTH_COOKIE = "bh_access"
# 인증 없이 접근 가능한 경로 (로그인 화면 자체와 버전 확인)
OPEN_PATHS = ("auth", "version")


def _cookie_token(headers) -> str:
    raw = headers.get("Cookie") or headers.get("cookie") or ""
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        if name == AUTH_COOKIE:
            return value.strip()
    return ""


def authorized(headers, device_id="") -> bool:
    """PIN 이 설정돼 있으면 유효한 토큰(쿠키 또는 헤더)이 있어야 한다."""
    if not db.access_pin():
        return True
    token = (_cookie_token(headers)
             or headers.get("X-Access-Token") or headers.get("x-access-token") or "")
    return db.token_valid(token, device_id)


# ------------------------------------------------------------------ 라우터

def handle(method: str, path: str, query: dict, body, content_type="",
           headers=None):
    """(status, payload) 반환. payload 는 JSON 직렬화 가능한 객체."""
    headers = headers or {}
    device_id = (headers.get("X-Device-Id") or headers.get("x-device-id") or "")
    db.set_device(device_id)
    # 조회 시점마다: 내 변경이 없고 다른 사람이 업데이트했다면 최신 내용을 반영
    if method == "GET" and device_id:
        db.auto_refresh_if_clean(device_id)

    segments = [s for s in path.strip("/").split("/") if s]
    if not segments or segments[0] != "api":
        raise ApiError(404, "존재하지 않는 API 경로입니다.")
    segments = segments[1:]

    def q(key, default=None):
        values = query.get(key)
        return values[0] if values else default

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

    # -------------------------------------------------------- 접근 보호 (PIN)
    if head == "auth":
        if rest == ["status"] and method == "GET":
            return 200, {"required": bool(db.access_pin()),
                         "authorized": authorized(headers, device_id)}
        if not rest and method == "POST":
            if not device_id:
                raise ApiError(400, "기기를 확인할 수 없습니다. 앱을 새로고침해 주세요.")
            token = db.verify_pin(json_body().get("pin"), device_id)
            if not token:
                raise ApiError(401, "PIN 이 맞지 않습니다.")
            return 200, {"ok": True, "token": token, "setCookie": token}

    if head not in OPEN_PATHS and not authorized(headers, device_id):
        raise ApiError(401, "접근 PIN 이 필요합니다.")

    # ---------------------------------------------------------- 메타 / 버전
    if head == "meta" and method == "GET":
        return 200, {
            "categoryTypes": list(db.CATEGORY_TYPES),
            "fieldTypes": list(db.FIELD_TYPES),
            "vehicles": db.list_vehicles(),
        }

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

    # ------------------------------------------- 업데이트(공개본 반영) 상태
    if head == "state" and method == "GET":
        state = db.sync_state(device_id)
        state["deviceName"] = (db.get_settings().get("device_name") or "").strip()
        return 200, state

    if head == "publish" and method == "POST":
        if not device_id:
            raise ApiError(400, "기기를 확인할 수 없습니다. 앱을 새로고침해 주세요.")
        data = json_body()
        name = (data.get("deviceName") or "").strip()
        if name:
            db.save_settings({"device_name": name})
        else:
            name = (db.get_settings().get("device_name") or "").strip()
        try:
            return 200, db.publish(device_id, name)
        except ValueError as exc:
            raise ApiError(400, str(exc))

    if head == "take-latest" and method == "POST":
        if not device_id:
            raise ApiError(400, "기기를 확인할 수 없습니다.")
        return 200, db.take_latest(device_id)

    # ------------------------------------------------------------ 차량 관리
    if head == "vehicles":
        if not rest:
            if method == "GET":
                counts = {}
                for item in db.list_inventory():
                    counts[item["vehicleName"]] = counts.get(item["vehicleName"], 0) + 1
                return 200, {"items": [{"name": name, "itemCount": counts.get(name, 0)}
                                       for name in db.list_vehicles()]}
            if method == "POST":
                try:
                    return 201, db.add_vehicle(json_body().get("name"))
                except ValueError as exc:
                    raise ApiError(400, str(exc))
        elif len(rest) == 1 and method == "DELETE":
            result = db.delete_vehicle(rest[0])
            if not result:
                raise ApiError(404, "차량을 찾을 수 없습니다.")
            return 200, result

    # ------------------------------------------------------------- guides
    if head == "guides":
        if not rest:
            if method == "GET":
                return 200, {"items": db.list_guides(q("type"), q("q"))}
            if method == "POST":
                try:
                    return 201, db.save_guide(json_body())
                except ValueError as exc:
                    raise ApiError(400, str(exc))
        elif len(rest) == 1:
            guide_id = rest[0]
            if method == "GET":
                guide = db.get_guide(guide_id)
                if not guide:
                    raise ApiError(404, "가이드를 찾을 수 없습니다.")
                return 200, guide
            if method in ("PUT", "PATCH"):
                try:
                    return 200, db.save_guide(json_body(), guide_id)
                except ValueError as exc:
                    raise ApiError(400, str(exc))
                except LookupError as exc:
                    raise ApiError(404, str(exc))
            if method == "DELETE":
                if not db.delete_guide(guide_id):
                    raise ApiError(404, "가이드를 찾을 수 없습니다.")
                return 200, {"deleted": True}

    # ---------------------------------------------------------- inventory
    if head == "inventory":
        if not rest:
            if method == "GET":
                return 200, {"vehicles": db.list_vehicles(),
                             "items": db.list_inventory(q("vehicle"))}
            if method == "POST":
                data = json_body()
                try:
                    return 201, db.add_inventory_item(
                        data.get("vehicleName"), data.get("partName"),
                        _int(data.get("quantity"), 0),
                        _int(data.get("minQuantity"), 0))
                except ValueError as exc:
                    raise ApiError(400, str(exc))
        elif len(rest) == 1:
            item_id = rest[0]
            if method in ("PATCH", "PUT"):
                data = json_body()
                item = db.update_inventory_item(
                    item_id, delta=_int(data.get("delta")),
                    quantity=_int(data.get("quantity")),
                    min_quantity=_int(data.get("minQuantity")),
                    part_name=data.get("partName"))
                if not item:
                    raise ApiError(404, "부품 항목을 찾을 수 없습니다.")
                return 200, item
            if method == "DELETE":
                if not db.delete_inventory_item(item_id):
                    raise ApiError(404, "부품 항목을 찾을 수 없습니다.")
                return 200, {"deleted": True}

    # ------------------------------------------------------- 리포트 입력 항목
    if head == "report-fields":
        if not rest:
            if method == "GET":
                return 200, {"items": db.list_fields()}
            if method == "POST":
                try:
                    return 201, db.save_field(json_body())
                except ValueError as exc:
                    raise ApiError(400, str(exc))
        elif rest == ["reorder"] and method == "POST":
            ids = json_body().get("ids") or []
            if not isinstance(ids, list):
                raise ApiError(400, "ids 는 배열이어야 합니다.")
            return 200, {"items": db.reorder_fields(ids)}
        elif len(rest) == 1:
            field_id = rest[0]
            if method in ("PUT", "PATCH"):
                try:
                    return 200, db.save_field(json_body(), field_id)
                except ValueError as exc:
                    raise ApiError(400, str(exc))
                except LookupError as exc:
                    raise ApiError(404, str(exc))
            if method == "DELETE":
                if not db.delete_field(field_id):
                    raise ApiError(404, "항목을 찾을 수 없습니다.")
                return 200, {"deleted": True}

    # ------------------------------------------------------------ reports
    if head == "reports":
        if not rest:
            if method == "GET":
                return 200, {"items": db.list_reports(_int(q("limit"), 100))}
            if method == "POST":
                data = json_body()
                if not data.get("draft"):
                    _validate_report(data)
                return 201, db.save_report(data)
        elif len(rest) == 1:
            report_id = rest[0]
            if method == "GET":
                report = db.get_report(report_id)
                if not report:
                    raise ApiError(404, "리포트를 찾을 수 없습니다.")
                return 200, report
            if method in ("PUT", "PATCH"):
                data = json_body()
                if not data.get("draft"):
                    _validate_report(data)
                try:
                    return 200, db.save_report(data, report_id)
                except LookupError as exc:
                    raise ApiError(404, str(exc))
            if method == "DELETE":
                if not db.delete_report(report_id):
                    raise ApiError(404, "리포트를 찾을 수 없습니다.")
                return 200, {"deleted": True}
        elif len(rest) == 2 and rest[1] == "sheet" and method == "POST":
            return _upload_to_sheet(rest[0], _request_base_url(headers))

    # ----------------------------------------------------------- settings
    if head == "settings":
        if not rest:
            if method == "GET":
                return 200, _settings_payload()
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
                new_pin = data.pop("access_pin", None)
                db.save_settings(data)
                if new_pin is not None:
                    try:
                        db.set_access_pin(new_pin)
                    except ValueError as exc:
                        raise ApiError(400, str(exc))
                    # PIN 이 바뀌면 이 기기 토큰을 새로 발급해 로그아웃되지 않게 한다
                    payload = _settings_payload()
                    if device_id:
                        payload["newToken"] = db.access_token(device_id)
                    return 200, payload
                return 200, _settings_payload()
        elif rest == ["sheets-test"] and method == "POST":
            try:
                return 200, sheets.test_connection()
            except sheets.SheetsError as exc:
                raise ApiError(400, str(exc))

    # -------------------------------------------------------------- media
    if head == "media" and not rest and method == "POST":
        return _upload(query, body, content_type)

    raise ApiError(404, f"지원하지 않는 요청입니다: {method} /{path.strip('/')}")


# ------------------------------------------------------------------ helpers

def _settings_payload() -> dict:
    settings = db.get_settings()
    settings["spreadsheetUrl"] = sheets.spreadsheet_url(settings)
    settings["sheetsReady"] = bool((settings.get("sheets_webapp_url") or "").strip())
    # PIN 값 자체는 절대 내보내지 않는다 (설정 여부만)
    settings.pop("access_pin", None)
    settings.pop("auth_secret", None)
    settings["pinEnabled"] = bool(db.access_pin())
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


def _validate_report(data: dict):
    values = data.get("values")
    if not isinstance(values, list):
        raise ApiError(400, "values 는 배열이어야 합니다.")
    fields = {f["id"]: f for f in db.list_fields()}
    for item in values:
        if not isinstance(item, dict):
            raise ApiError(400, "values 항목 형식이 올바르지 않습니다.")
        field = fields.get(item.get("fieldId"))
        if field and field["isRequired"]:
            if field["fieldType"] == "MEDIA":
                if not item.get("media"):
                    raise ApiError(400, f"'{field['fieldLabel']}' 은 필수 항목입니다.")
            elif not str(item.get("value") or "").strip():
                raise ApiError(400, f"'{field['fieldLabel']}' 은 필수 항목입니다.")
    submitted = {item.get("fieldId") for item in values}
    for field in fields.values():
        if field["isRequired"] and field["id"] not in submitted:
            raise ApiError(400, f"'{field['fieldLabel']}' 은 필수 항목입니다.")


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


def _upload_to_sheet(report_id: str, base_url=""):
    report = db.get_report(report_id)
    if not report:
        raise ApiError(404, "리포트를 찾을 수 없습니다.")
    try:
        result = sheets.upload_report(report, db.list_fields(), base_url=base_url)
    except sheets.SheetsError as exc:
        db.mark_report_failed(report_id, str(exc))
        raise ApiError(400, str(exc))
    db.mark_report_uploaded(report_id, result["sheetName"], result.get("row"))
    return 200, {"report": db.get_report(report_id), **result}


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
