"""SQLite 데이터 계층.

**공개본 / 작업본 구조**

- `data/app.db` : 공개본. 모든 사용자가 보는 확정된 내용.
- `data/drafts/<기기ID>.db` : 각 기기의 작업본. 생성/수정/삭제는 여기에만 반영된다.
- 사용자가 **[업데이트]** 를 누르면 작업본의 공유 데이터가 공개본으로 올라가고,
  다른 기기들은 (자기 변경이 없으면) 자동으로 최신 공개본을 받는다.

리포트·설정은 기기별 데이터라 공개본으로 올라가지 않는다.
"""

import json
import os
import shutil
import sqlite3
import threading
import time
import uuid

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.environ.get("DATABASE_URL") or os.path.join(DATA_DIR, "app.db")
DRAFT_DIR = os.environ.get("DRAFT_DIR") or os.path.join(DATA_DIR, "drafts")
MEDIA_DIR = os.environ.get("MEDIA_DIR") or os.path.join(DATA_DIR, "media")

CATEGORY_TYPES = ("ERROR_CODE", "HARDWARE_SOP", "SOFTWARE_CMD")
FIELD_TYPES = ("TEXT", "TEXTAREA", "NUMBER", "DROPDOWN", "MEDIA")
VEHICLES = ("스타리아 1호차", "스타리아 2호차")

APP_VERSION = "2.0.0"

# [업데이트] 로 모든 사용자에게 반영되는 공유 테이블 (순서 = 삭제/삽입 순서)
SHARED_TABLES = (
    "guide_step", "guide_master", "vehicle", "vehicle_inventory",
    "report_field_config",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS vehicle (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guide_master (
    id             TEXT PRIMARY KEY,
    category_type  TEXT NOT NULL,
    code_or_title  TEXT NOT NULL,
    summary        TEXT NOT NULL DEFAULT '',
    required_tools TEXT NOT NULL DEFAULT '',
    commands       TEXT NOT NULL DEFAULT '[]',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guide_category ON guide_master(category_type);

CREATE TABLE IF NOT EXISTS guide_step (
    id              TEXT PRIMARY KEY,
    guide_master_id TEXT NOT NULL REFERENCES guide_master(id) ON DELETE CASCADE,
    step_order      INTEGER NOT NULL DEFAULT 1,
    instruction     TEXT NOT NULL DEFAULT '',
    expected_metric TEXT,
    image_url       TEXT
);
CREATE INDEX IF NOT EXISTS idx_step_master ON guide_step(guide_master_id);

CREATE TABLE IF NOT EXISTS vehicle_inventory (
    id           TEXT PRIMARY KEY,
    vehicle_name TEXT NOT NULL,
    part_name    TEXT NOT NULL,
    quantity     INTEGER NOT NULL DEFAULT 0,
    min_quantity INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL,
    UNIQUE(vehicle_name, part_name)
);

CREATE TABLE IF NOT EXISTS report_field_config (
    id             TEXT PRIMARY KEY,
    field_label    TEXT NOT NULL,
    field_type     TEXT NOT NULL,
    options        TEXT,
    is_required    INTEGER NOT NULL DEFAULT 0,
    display_order  INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL DEFAULT '',
    payload_json   TEXT NOT NULL DEFAULT '[]',
    status         TEXT NOT NULL DEFAULT 'DRAFT',
    sheet_name     TEXT,
    sheet_row      INTEGER,
    error_message  TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
    id            TEXT PRIMARY KEY,
    filename      TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    mime          TEXT NOT NULL DEFAULT 'application/octet-stream',
    size          INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_setting (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
"""

# 공개본에만 두는 설정 (모든 기기 공통)
GLOBAL_SETTINGS = {
    "sheets_webapp_url": "",
    "sheets_spreadsheet_id": "1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4",
    "site_url": "",        # 비우면 접속한 서버 주소를 자동 사용
    "published_revision": "0",
    "published_at": "",
    "published_by": "",
}

# 기기(작업본)별 설정
DEVICE_SETTINGS = {
    "device_name": "",
    "base_revision": "0",
    "base_hash": "",
}

DEFAULT_SETTINGS = {**GLOBAL_SETTINGS, **DEVICE_SETTINGS}

_local = threading.local()


# ------------------------------------------------------------------ 기기 컨텍스트

def set_device(device_id=""):
    """요청을 보낸 기기를 지정한다. 이후 이 스레드의 DB 접근은 그 기기의 작업본을 쓴다."""
    _local.device = _safe_device_id(device_id)


def current_device():
    return getattr(_local, "device", "")


def _safe_device_id(device_id) -> str:
    raw = str(device_id or "").strip()
    keep = [c for c in raw if c.isalnum() or c in "-_"]
    return "".join(keep)[:48]


def draft_path(device_id) -> str:
    return os.path.join(DRAFT_DIR, f"{_safe_device_id(device_id)}.db")


def current_db_path() -> str:
    device = current_device()
    if not device:
        return DB_PATH
    path = draft_path(device)
    if not os.path.isfile(path):
        _create_draft(device, path)
    return path


def _create_draft(device_id, path):
    """공개본을 복사해 그 기기의 작업본을 만든다."""
    os.makedirs(DRAFT_DIR, exist_ok=True)
    _checkpoint(DB_PATH)
    shutil.copyfile(DB_PATH, path)
    conn = sqlite3.connect(path, timeout=15)
    try:
        conn.executescript(SCHEMA)
        _migrate_columns(conn)
        # 리포트는 기기별 데이터이므로 복사본에서 비운다.
        conn.execute("DELETE FROM report")
        for key, value in DEVICE_SETTINGS.items():
            conn.execute(
                "INSERT INTO app_setting(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
        conn.commit()
    finally:
        conn.close()
    published = _read_setting(DB_PATH, "published_revision") or "0"
    _write_settings(path, {"base_revision": published,
                           "base_hash": shared_data_hash(path)})


def _checkpoint(path):
    """WAL 내용을 본 파일에 반영해 복사해도 최신이 되도록 한다."""
    if not os.path.isfile(path):
        return
    conn = sqlite3.connect(path, timeout=15)
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except sqlite3.DatabaseError:
        pass
    finally:
        conn.close()


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def new_id() -> str:
    return uuid.uuid4().hex


def connect() -> sqlite3.Connection:
    os.makedirs(MEDIA_DIR, exist_ok=True)
    conn = sqlite3.connect(current_db_path(), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _connect_path(path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(DRAFT_DIR, exist_ok=True)
    conn = _connect_path(DB_PATH)
    try:
        conn.executescript(SCHEMA)
        _migrate_columns(conn)
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO app_setting(key, value) VALUES (?, ?)",
                (key, value),
            )
        conn.commit()
        if conn.execute("SELECT COUNT(*) FROM guide_master").fetchone()[0] == 0:
            _seed(conn)
            conn.commit()
        _migrate_vehicles(conn)
        conn.commit()
    finally:
        conn.close()


def _migrate_columns(conn: sqlite3.Connection) -> None:
    """이전 버전 DB 에 없던 컬럼을 추가하고, 더 이상 쓰지 않는 설정을 정리한다."""
    def columns(table):
        try:
            return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        except sqlite3.DatabaseError:
            return set()

    report_cols = columns("report")
    if report_cols:
        if "sheet_name" not in report_cols:
            conn.execute("ALTER TABLE report ADD COLUMN sheet_name TEXT")
        if "sheet_row" not in report_cols:
            conn.execute("ALTER TABLE report ADD COLUMN sheet_row INTEGER")
        # 이전 전송 상태는 '저장됨' 으로 되돌린다(전송 대상이 바뀌었으므로).
        conn.execute("UPDATE report SET status = 'DRAFT' WHERE status = 'SENT'")

    # 더 이상 사용하지 않는 설정 제거
    conn.execute(
        "DELETE FROM app_setting WHERE key IN "
        "('notion_token','notion_database_id','notion_version','notion_title_prop',"
        " 'engineer_name','public_base_url','sync_hub_url','sync_key','hub_id')")


def _migrate_vehicles(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM vehicle").fetchone()[0]:
        return
    names = [
        r["vehicle_name"] for r in conn.execute(
            "SELECT DISTINCT vehicle_name FROM vehicle_inventory "
            "ORDER BY vehicle_name").fetchall()
    ]
    for name in VEHICLES:
        if name not in names:
            names.append(name)
    for order, name in enumerate(sorted(names), start=1):
        conn.execute(
            "INSERT OR IGNORE INTO vehicle (id, name, display_order, created_at) "
            "VALUES (?,?,?,?)", (new_id(), name, order, now()))


# ---------------------------------------------------------------- settings

def _read_setting(path, key):
    if not os.path.isfile(path):
        return None
    conn = _connect_path(path)
    try:
        row = conn.execute(
            "SELECT value FROM app_setting WHERE key = ?", (key,)).fetchone()
    except sqlite3.DatabaseError:
        return None
    finally:
        conn.close()
    return row["value"] if row else None


def _write_settings(path, values: dict):
    conn = _connect_path(path)
    try:
        for key, value in values.items():
            conn.execute(
                "INSERT INTO app_setting(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, "" if value is None else str(value)))
        conn.commit()
    finally:
        conn.close()


def get_settings() -> dict:
    """전역 설정은 공개본에서, 기기 설정은 작업본에서 읽는다."""
    out = dict(DEFAULT_SETTINGS)
    for key in GLOBAL_SETTINGS:
        value = _read_setting(DB_PATH, key)
        if value is not None:
            out[key] = value
    if current_device():
        for key in DEVICE_SETTINGS:
            value = _read_setting(current_db_path(), key)
            if value is not None:
                out[key] = value
    return out


def save_settings(values: dict) -> dict:
    """전역 설정은 공개본에 바로 저장(모든 사용자 공통)."""
    global_values = {k: v for k, v in values.items()
                     if k in GLOBAL_SETTINGS and k not in
                     ("published_revision", "published_at", "published_by")}
    device_values = {k: v for k, v in values.items() if k in DEVICE_SETTINGS
                     and k not in ("base_revision", "base_hash")}
    if global_values:
        _write_settings(DB_PATH, global_values)
    if device_values and current_device():
        _write_settings(current_db_path(), device_values)
    return get_settings()


# ------------------------------------------------------------------ guides

def _guide_row(row: sqlite3.Row, steps=None) -> dict:
    try:
        commands = json.loads(row["commands"] or "[]")
    except json.JSONDecodeError:
        commands = []
    guide = {
        "id": row["id"],
        "categoryType": row["category_type"],
        "codeOrTitle": row["code_or_title"],
        "summary": row["summary"],
        "requiredTools": row["required_tools"],
        "commands": commands,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if steps is not None:
        guide["steps"] = steps
    return guide


def _step_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "stepOrder": row["step_order"],
        "instruction": row["instruction"],
        "expectedMetric": row["expected_metric"],
        "imageUrl": row["image_url"],
    }


def list_guides(category_type=None, query=None) -> list:
    sql = "SELECT * FROM guide_master"
    where, params = [], []
    if category_type:
        where.append("category_type = ?")
        params.append(category_type)
    if query:
        like = f"%{query.strip()}%"
        where.append(
            "(code_or_title LIKE ? OR summary LIKE ? OR required_tools LIKE ? "
            "OR commands LIKE ? OR id IN (SELECT guide_master_id FROM guide_step "
            "WHERE instruction LIKE ? OR expected_metric LIKE ?))")
        params.extend([like] * 6)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY code_or_title COLLATE NOCASE"

    conn = connect()
    try:
        rows = conn.execute(sql, params).fetchall()
        counts = {
            r["guide_master_id"]: r["n"] for r in conn.execute(
                "SELECT guide_master_id, COUNT(*) AS n FROM guide_step "
                "GROUP BY guide_master_id").fetchall()
        }
    finally:
        conn.close()
    out = []
    for row in rows:
        guide = _guide_row(row)
        guide["stepCount"] = counts.get(row["id"], 0)
        out.append(guide)
    return out


def get_guide(guide_id: str):
    conn = connect()
    try:
        row = conn.execute(
            "SELECT * FROM guide_master WHERE id = ?", (guide_id,)).fetchone()
        if row is None:
            return None
        steps = conn.execute(
            "SELECT * FROM guide_step WHERE guide_master_id = ? "
            "ORDER BY step_order, rowid", (guide_id,)).fetchall()
    finally:
        conn.close()
    return _guide_row(row, [_step_row(s) for s in steps])


def save_guide(payload: dict, guide_id=None) -> dict:
    category = payload.get("categoryType")
    if category not in CATEGORY_TYPES:
        raise ValueError("categoryType 값이 올바르지 않습니다.")
    title = (payload.get("codeOrTitle") or "").strip()
    if not title:
        raise ValueError("코드 / 제목은 필수입니다.")

    commands = payload.get("commands") or []
    if isinstance(commands, str):
        commands = [{"label": "", "cmd": commands, "desc": ""}]
    commands = [
        {"label": (c.get("label") or "").strip(),
         "cmd": (c.get("cmd") or "").strip(),
         "desc": (c.get("desc") or "").strip()}
        for c in commands if (c.get("cmd") or "").strip()
    ]

    steps = []
    for step in payload.get("steps") or []:
        instruction = (step.get("instruction") or "").strip()
        if not instruction:
            continue
        steps.append((
            step.get("id") or new_id(),
            len(steps) + 1,
            instruction,
            (step.get("expectedMetric") or "").strip() or None,
            (step.get("imageUrl") or "").strip() or None,
        ))

    stamp = now()
    conn = connect()
    try:
        if guide_id:
            if not conn.execute("SELECT 1 FROM guide_master WHERE id = ?",
                                (guide_id,)).fetchone():
                raise LookupError("가이드를 찾을 수 없습니다.")
            conn.execute(
                "UPDATE guide_master SET category_type = ?, code_or_title = ?, "
                "summary = ?, required_tools = ?, commands = ?, updated_at = ? "
                "WHERE id = ?",
                (category, title, (payload.get("summary") or "").strip(),
                 (payload.get("requiredTools") or "").strip(),
                 json.dumps(commands, ensure_ascii=False), stamp, guide_id))
            conn.execute("DELETE FROM guide_step WHERE guide_master_id = ?",
                         (guide_id,))
        else:
            guide_id = new_id()
            conn.execute(
                "INSERT INTO guide_master (id, category_type, code_or_title, "
                "summary, required_tools, commands, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (guide_id, category, title, (payload.get("summary") or "").strip(),
                 (payload.get("requiredTools") or "").strip(),
                 json.dumps(commands, ensure_ascii=False), stamp, stamp))
        conn.executemany(
            "INSERT INTO guide_step (id, guide_master_id, step_order, "
            "instruction, expected_metric, image_url) VALUES (?,?,?,?,?,?)",
            [(s[0], guide_id, s[1], s[2], s[3], s[4]) for s in steps])
        conn.commit()
    finally:
        conn.close()
    return get_guide(guide_id)


def delete_guide(guide_id: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM guide_master WHERE id = ?", (guide_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# --------------------------------------------------------------- inventory

def list_inventory(vehicle_name=None) -> list:
    sql = "SELECT * FROM vehicle_inventory"
    params = []
    if vehicle_name:
        sql += " WHERE vehicle_name = ?"
        params.append(vehicle_name)
    sql += " ORDER BY part_name COLLATE NOCASE"
    conn = connect()
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    return [{
        "id": r["id"], "vehicleName": r["vehicle_name"], "partName": r["part_name"],
        "quantity": r["quantity"], "minQuantity": r["min_quantity"],
        "updatedAt": r["updated_at"],
    } for r in rows]


def list_vehicles() -> list:
    conn = connect()
    try:
        registered = [r["name"] for r in conn.execute(
            "SELECT name FROM vehicle ORDER BY display_order, name").fetchall()]
        orphans = [r["vehicle_name"] for r in conn.execute(
            "SELECT DISTINCT vehicle_name FROM vehicle_inventory "
            "WHERE vehicle_name NOT IN (SELECT name FROM vehicle) "
            "ORDER BY vehicle_name").fetchall()]
    finally:
        conn.close()
    return registered + orphans


def add_vehicle(name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise ValueError("차량 이름은 필수입니다.")
    conn = connect()
    try:
        if conn.execute("SELECT 1 FROM vehicle WHERE name = ?", (name,)).fetchone():
            raise ValueError("이미 등록된 차량입니다.")
        order = conn.execute(
            "SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM vehicle"
        ).fetchone()["n"]
        conn.execute(
            "INSERT INTO vehicle (id, name, display_order, created_at) "
            "VALUES (?,?,?,?)", (new_id(), name, order, now()))
        conn.commit()
    finally:
        conn.close()
    return {"name": name, "itemCount": 0}


def delete_vehicle(name: str):
    name = (name or "").strip()
    conn = connect()
    try:
        exists = conn.execute("SELECT 1 FROM vehicle WHERE name = ?",
                              (name,)).fetchone()
        has_items = conn.execute(
            "SELECT COUNT(*) AS n FROM vehicle_inventory WHERE vehicle_name = ?",
            (name,)).fetchone()["n"]
        if not exists and not has_items:
            return None
        conn.execute("DELETE FROM vehicle_inventory WHERE vehicle_name = ?", (name,))
        conn.execute("DELETE FROM vehicle WHERE name = ?", (name,))
        conn.commit()
    finally:
        conn.close()
    return {"name": name, "deletedItems": has_items}


def _ensure_vehicle(conn: sqlite3.Connection, name: str) -> None:
    if conn.execute("SELECT 1 FROM vehicle WHERE name = ?", (name,)).fetchone():
        return
    order = conn.execute(
        "SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM vehicle"
    ).fetchone()["n"]
    conn.execute(
        "INSERT INTO vehicle (id, name, display_order, created_at) VALUES (?,?,?,?)",
        (new_id(), name, order, now()))


def add_inventory_item(vehicle_name: str, part_name: str, quantity=0,
                       min_quantity=0) -> dict:
    vehicle_name = (vehicle_name or "").strip()
    part_name = (part_name or "").strip()
    if not vehicle_name or not part_name:
        raise ValueError("차량과 부품명은 필수입니다.")
    conn = connect()
    try:
        if conn.execute(
                "SELECT id FROM vehicle_inventory WHERE vehicle_name = ? "
                "AND part_name = ?", (vehicle_name, part_name)).fetchone():
            raise ValueError("이미 등록된 부품입니다.")
        _ensure_vehicle(conn, vehicle_name)
        item_id = new_id()
        conn.execute(
            "INSERT INTO vehicle_inventory (id, vehicle_name, part_name, "
            "quantity, min_quantity, updated_at) VALUES (?,?,?,?,?,?)",
            (item_id, vehicle_name, part_name, max(0, int(quantity)),
             max(0, int(min_quantity)), now()))
        conn.commit()
    finally:
        conn.close()
    return {"id": item_id, "vehicleName": vehicle_name, "partName": part_name,
            "quantity": max(0, int(quantity)),
            "minQuantity": max(0, int(min_quantity)), "updatedAt": now()}


def update_inventory_item(item_id: str, delta=None, quantity=None,
                          min_quantity=None, part_name=None):
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM vehicle_inventory WHERE id = ?",
                           (item_id,)).fetchone()
        if row is None:
            return None
        new_qty = row["quantity"]
        if delta is not None:
            new_qty = row["quantity"] + int(delta)
        if quantity is not None:
            new_qty = int(quantity)
        new_qty = max(0, new_qty)
        new_min = row["min_quantity"] if min_quantity is None else max(0, int(min_quantity))
        new_name = row["part_name"] if not part_name else part_name.strip()
        conn.execute(
            "UPDATE vehicle_inventory SET quantity = ?, min_quantity = ?, "
            "part_name = ?, updated_at = ? WHERE id = ?",
            (new_qty, new_min, new_name, now(), item_id))
        conn.commit()
    finally:
        conn.close()
    return {"id": item_id, "vehicleName": row["vehicle_name"],
            "partName": new_name, "quantity": new_qty, "minQuantity": new_min,
            "updatedAt": now()}


def delete_inventory_item(item_id: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM vehicle_inventory WHERE id = ?", (item_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ----------------------------------------------------- 리포트 입력 항목 설정

def _field_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "fieldLabel": row["field_label"],
        "fieldType": row["field_type"],
        "options": row["options"],
        "isRequired": bool(row["is_required"]),
        "displayOrder": row["display_order"],
    }


def list_fields() -> list:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM report_field_config ORDER BY display_order, created_at"
        ).fetchall()
    finally:
        conn.close()
    return [_field_row(r) for r in rows]


def save_field(payload: dict, field_id=None) -> dict:
    label = (payload.get("fieldLabel") or "").strip()
    ftype = payload.get("fieldType")
    if not label:
        raise ValueError("항목명은 필수입니다.")
    if ftype not in FIELD_TYPES:
        raise ValueError("지원하지 않는 항목 종류입니다.")
    options = (payload.get("options") or "").strip() or None
    if ftype == "DROPDOWN" and not options:
        raise ValueError("드롭다운은 선택지를 1개 이상 입력해야 합니다.")
    is_required = 1 if payload.get("isRequired") else 0

    conn = connect()
    try:
        if field_id:
            if not conn.execute("SELECT 1 FROM report_field_config WHERE id = ?",
                                (field_id,)).fetchone():
                raise LookupError("항목을 찾을 수 없습니다.")
            conn.execute(
                "UPDATE report_field_config SET field_label = ?, field_type = ?, "
                "options = ?, is_required = ? WHERE id = ?",
                (label, ftype, options, is_required, field_id))
        else:
            field_id = new_id()
            nxt = conn.execute(
                "SELECT COALESCE(MAX(display_order), 0) + 1 AS n "
                "FROM report_field_config").fetchone()["n"]
            conn.execute(
                "INSERT INTO report_field_config (id, field_label, field_type, "
                "options, is_required, display_order, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (field_id, label, ftype, options, is_required, nxt, now()))
        conn.commit()
        row = conn.execute("SELECT * FROM report_field_config WHERE id = ?",
                           (field_id,)).fetchone()
    finally:
        conn.close()
    return _field_row(row)


def delete_field(field_id: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM report_field_config WHERE id = ?",
                           (field_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def reorder_fields(ordered_ids: list) -> list:
    conn = connect()
    try:
        for idx, fid in enumerate(ordered_ids, start=1):
            conn.execute(
                "UPDATE report_field_config SET display_order = ? WHERE id = ?",
                (idx, fid))
        conn.commit()
    finally:
        conn.close()
    return list_fields()


# ----------------------------------------------------------------- reports

def _report_row(row: sqlite3.Row) -> dict:
    try:
        payload = json.loads(row["payload_json"] or "[]")
    except json.JSONDecodeError:
        payload = []
    return {
        "id": row["id"],
        "title": row["title"],
        "payload": payload,
        "status": row["status"],
        "sheetName": row["sheet_name"],
        "sheetRow": row["sheet_row"],
        "errorMessage": row["error_message"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_reports(limit=100) -> list:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM report ORDER BY created_at DESC LIMIT ?",
            (limit,)).fetchall()
    finally:
        conn.close()
    return [_report_row(r) for r in rows]


def get_report(report_id: str):
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM report WHERE id = ?",
                           (report_id,)).fetchone()
    finally:
        conn.close()
    return _report_row(row) if row else None


def save_report(payload: dict, report_id=None) -> dict:
    values = payload.get("values") or []
    title = (payload.get("title") or "").strip()
    if not title:
        for item in values:
            if item.get("type") in ("TEXT", "TEXTAREA") and item.get("value"):
                title = str(item["value"]).splitlines()[0][:80]
                break
    if not title:
        title = f"현장 리포트 {now()}"

    stamp = now()
    conn = connect()
    try:
        if report_id:
            if not conn.execute("SELECT 1 FROM report WHERE id = ?",
                                (report_id,)).fetchone():
                raise LookupError("리포트를 찾을 수 없습니다.")
            conn.execute(
                "UPDATE report SET title = ?, payload_json = ?, updated_at = ? "
                "WHERE id = ?",
                (title, json.dumps(values, ensure_ascii=False), stamp, report_id))
        else:
            report_id = new_id()
            conn.execute(
                "INSERT INTO report (id, title, payload_json, status, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?)",
                (report_id, title, json.dumps(values, ensure_ascii=False),
                 "DRAFT", stamp, stamp))
        conn.commit()
    finally:
        conn.close()
    return get_report(report_id)


def mark_report_uploaded(report_id: str, sheet_name: str, sheet_row) -> None:
    conn = connect()
    try:
        conn.execute(
            "UPDATE report SET status = 'UPLOADED', sheet_name = ?, "
            "sheet_row = ?, error_message = NULL, updated_at = ? WHERE id = ?",
            (sheet_name, sheet_row, now(), report_id))
        conn.commit()
    finally:
        conn.close()


def mark_report_failed(report_id: str, message: str) -> None:
    conn = connect()
    try:
        conn.execute(
            "UPDATE report SET status = 'FAILED', error_message = ?, "
            "updated_at = ? WHERE id = ?", (message[:2000], now(), report_id))
        conn.commit()
    finally:
        conn.close()


def delete_report(report_id: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM report WHERE id = ?", (report_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ------------------------------------------------------------------- media

def register_media(filename: str, original_name: str, mime: str,
                   size: int) -> dict:
    media_id = new_id()
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO media (id, filename, original_name, mime, size, "
            "created_at) VALUES (?,?,?,?,?,?)",
            (media_id, filename, original_name, mime, size, now()))
        conn.commit()
    finally:
        conn.close()
    return {"id": media_id, "filename": filename, "originalName": original_name,
            "mime": mime, "size": size, "url": f"/media/{filename}"}


# ------------------------------------------- 업데이트(공개본 반영) / 최신 받기

def shared_data_hash(path=None) -> str:
    """공유 데이터의 내용 해시. 내 변경이 있는지 판단하는 데 쓴다."""
    import hashlib

    target = path or current_db_path()
    conn = _connect_path(target)
    digest = hashlib.sha256()
    try:
        for table, order in (
            ("guide_master", "id"), ("guide_step", "id"), ("vehicle", "name"),
            ("vehicle_inventory", "id"), ("report_field_config", "id"),
        ):
            try:
                rows = conn.execute(
                    f"SELECT * FROM {table} ORDER BY {order}").fetchall()
            except sqlite3.DatabaseError:
                continue
            for row in rows:
                digest.update(table.encode())
                for key in sorted(row.keys()):
                    if key in ("updated_at", "created_at"):
                        continue
                    digest.update(f"{key}={row[key]}".encode())
    finally:
        conn.close()
    return digest.hexdigest()[:16]


def published_state() -> dict:
    return {
        "revision": int(_read_setting(DB_PATH, "published_revision") or 0),
        "at": _read_setting(DB_PATH, "published_at") or "",
        "by": _read_setting(DB_PATH, "published_by") or "",
    }


def _copy_shared(src_path, dst_path):
    """공유 테이블만 src → dst 로 통째로 옮긴다."""
    _checkpoint(src_path)
    conn = sqlite3.connect(dst_path, timeout=20)
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("ATTACH DATABASE ? AS src", (src_path,))
        conn.execute("BEGIN")
        for table in SHARED_TABLES:                 # 자식 → 부모 순서로 삭제
            conn.execute(f"DELETE FROM main.{table}")
        for table in reversed(SHARED_TABLES):       # 부모 → 자식 순서로 삽입
            conn.execute(
                f"INSERT INTO main.{table} SELECT * FROM src.{table}")
        conn.execute("COMMIT")
        conn.execute("DETACH DATABASE src")
    finally:
        conn.close()


def publish(device_id, device_name="") -> dict:
    """이 기기의 작업본 내용을 공개본으로 올린다 (= [업데이트])."""
    device = _safe_device_id(device_id)
    if not device:
        raise ValueError("기기를 확인할 수 없습니다. 앱을 새로고침해 주세요.")
    path = draft_path(device)
    if not os.path.isfile(path):
        raise ValueError("올릴 변경 내용이 없습니다.")

    _copy_shared(path, DB_PATH)
    state = published_state()
    revision = state["revision"] + 1
    stamp = now()
    _write_settings(DB_PATH, {
        "published_revision": revision,
        "published_at": stamp,
        "published_by": device_name or "",
    })
    new_hash = shared_data_hash(path)
    _write_settings(path, {"base_revision": revision, "base_hash": new_hash})
    return {"revision": revision, "at": stamp, "by": device_name,
            "hash": new_hash, "summary": shared_summary(path)}


def take_latest(device_id) -> dict:
    """공개본 최신 내용을 이 기기의 작업본으로 받아온다 (내 변경은 사라진다)."""
    device = _safe_device_id(device_id)
    path = draft_path(device)
    if not os.path.isfile(path):
        current_db_path()      # 작업본 생성
        return {"revision": published_state()["revision"], "refreshed": True}
    _copy_shared(DB_PATH, path)
    state = published_state()
    _write_settings(path, {"base_revision": state["revision"],
                           "base_hash": shared_data_hash(path)})
    return {"revision": state["revision"], "refreshed": True}


def shared_summary(path=None) -> dict:
    target = path or current_db_path()
    conn = _connect_path(target)
    try:
        def count(table):
            try:
                return conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
            except sqlite3.DatabaseError:
                return 0
        return {
            "guides": count("guide_master"),
            "steps": count("guide_step"),
            "vehicles": count("vehicle"),
            "inventoryItems": count("vehicle_inventory"),
            "fields": count("report_field_config"),
        }
    finally:
        conn.close()


def auto_refresh_if_clean(device_id) -> bool:
    """내 변경이 없고 공개본이 더 새로우면 조용히 최신으로 맞춘다.

    조회 요청마다 호출되므로, 뒤처지지 않은 경우에는 정수 비교만 하고 끝낸다.
    """
    device = _safe_device_id(device_id)
    if not device:
        return False
    path = draft_path(device)
    if not os.path.isfile(path):
        return False
    published = int(_read_setting(DB_PATH, "published_revision") or 0)
    base = int(_read_setting(path, "base_revision") or 0)
    if published <= base:
        return False
    base_hash = _read_setting(path, "base_hash") or ""
    if base_hash and shared_data_hash(path) != base_hash:
        return False        # 내 변경이 있으면 덮지 않는다
    take_latest(device)
    return True


def sync_state(device_id) -> dict:
    """앱 상단 [업데이트] 버튼 상태 계산 + 필요하면 최신본 자동 반영."""
    device = _safe_device_id(device_id)
    published = published_state()
    if not device:
        return {"published": published, "hasLocalChanges": False,
                "behind": False, "autoUpdated": False,
                "summary": shared_summary(DB_PATH)}

    path = draft_path(device)
    created = not os.path.isfile(path)
    if created:
        set_device(device)
        current_db_path()

    auto = auto_refresh_if_clean(device)
    base_revision = int(_read_setting(path, "base_revision") or 0)
    base_hash = _read_setting(path, "base_hash") or ""
    has_local = bool(base_hash) and shared_data_hash(path) != base_hash
    behind = published["revision"] > base_revision

    return {
        "published": published,
        "myRevision": base_revision,
        "hasLocalChanges": has_local,
        "behind": behind,
        "autoUpdated": auto,
        "summary": shared_summary(path),
    }


# -------------------------------------------------------------------- seed

def _seed(conn: sqlite3.Connection) -> None:
    stamp = now()

    def guide(category, title, summary, tools, commands, steps):
        gid = new_id()
        conn.execute(
            "INSERT INTO guide_master (id, category_type, code_or_title, "
            "summary, required_tools, commands, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (gid, category, title, summary, tools,
             json.dumps(commands, ensure_ascii=False), stamp, stamp))
        for i, (instruction, metric) in enumerate(steps, start=1):
            conn.execute(
                "INSERT INTO guide_step (id, guide_master_id, step_order, "
                "instruction, expected_metric, image_url) VALUES (?,?,?,?,?,?)",
                (new_id(), gid, i, instruction, metric, None))

    guide("ERROR_CODE", "E-101 로더 모터 과전류",
          "로더 축 이동 중 과전류 감지로 컨트롤러가 축을 정지시킨 상태.",
          "멀티미터, 육각 렌치 3mm, 절연 장갑", [],
          [("컨트롤러 전면 LED 상태를 확인하고 비상정지 버튼을 눌러 안전 확보.", None),
           ("로더 레일 위 이물질(면·기름 찌꺼기)을 제거하고 손으로 축을 밀어 걸림 여부 확인.", "손으로 밀 때 저항 없이 이동"),
           ("모터 커넥터 CN3 양단 전압을 멀티미터로 측정.", "DC 24V ±0.5V"),
           ("드라이버 보드 U-V-W 상간 저항 측정. 편차가 크면 모터 교체 진행.", "상간 저항 편차 10% 이내"),
           ("이물질/전압 정상이면 컨트롤러 리셋 후 로더 원점 복귀 실행.", None)])
    guide("ERROR_CODE", "E-204 온도센서 통신 오류",
          "조리 모듈 온도센서(RTD) 값이 수신되지 않아 조리 시퀀스가 중단됨.",
          "멀티미터, 십자 드라이버 PH2, 케이블 타이", [],
          [("조리 모듈 전원을 내리고 센서 하네스 커넥터 체결 상태 확인.", None),
           ("RTD 센서 양단 저항 측정(상온 기준).", "PT100: 약 110Ω @25℃"),
           ("센서 신호선 실드 접지 상태 확인 및 단선 여부 도통 시험.", "도통 저항 1Ω 이하"),
           ("통신 보드 RS-485 종단 저항 확인.", "120Ω"),
           ("센서 교체 후 조리 모듈 온도값이 실온과 ±2℃ 내로 표시되는지 확인.", "실온 ±2℃")])
    guide("ERROR_CODE", "E-330 그리퍼 홈 포지션 실패",
          "그리퍼가 원점 센서를 찾지 못해 초기화 단계에서 정지.",
          "육각 렌치 2.5mm, 알코올 스왑, 토크 드라이버", [],
          [("그리퍼 원점 포토센서 렌즈를 알코올 스왑으로 청소.", None),
           ("도그(감지판) 위치가 센서 중앙을 지나는지 육안 확인 후 재정렬.", "센서-도그 간극 1~2mm"),
           ("센서 출력 전압을 감지/비감지 상태로 나누어 측정.", "감지 0.5V 이하 / 비감지 4.5V 이상"),
           ("정렬 후 원점 복귀 3회 반복하여 재현성 확인.", "3회 연속 성공")])
    guide("HARDWARE_SOP", "로더 모듈 전체 교체",
          "로더 모듈 어셈블리를 통째로 교체하는 표준 작업 절차 (약 60분).",
          "육각 렌치 세트, 토크 렌치, 십자 드라이버 PH2, 절연 장갑, 케이블 타이", [],
          [("메인 브레이커 OFF → 컨트롤러 전원 케이블 분리 → LOTO 태그 부착.", None),
           ("로더 하네스 커넥터 CN3/CN4 분리, 커넥터별 라벨 부착.", None),
           ("모듈 고정 볼트 4개(M6) 대각 순서로 해체. 하단 2개는 마지막에 해체.", None),
           ("모듈 탈거 후 신규 모듈 안착, 고정 볼트 대각 순서로 가조립 후 최종 토크.", "M6 볼트 10N·m"),
           ("하네스 재결선 후 커넥터 락 체결음 확인, 케이블 타이로 정리.", None),
           ("전원 투입 → 원점 복귀 → 무부하 왕복 5회 시운전.", "5회 무이상")])
    guide("HARDWARE_SOP", "그리퍼 실리콘 패드 교체",
          "마모/변색된 그리퍼 실리콘 패드 교체 (약 15분).",
          "육각 렌치 2.5mm, 탈지제, 마른 천", [],
          [("비상정지 후 그리퍼를 개방 위치로 수동 이동.", None),
           ("패드 고정 나사 2개(M3) 해체 후 기존 패드 제거.", None),
           ("접착면 유분을 탈지제로 제거하고 완전히 건조.", None),
           ("신규 패드 장착 후 나사 조임. 과조임 시 패드 변형 주의.", "M3 볼트 0.8N·m"),
           ("파지 테스트 3회 실시하여 슬립 여부 확인.", "슬립 0회")])
    guide("SOFTWARE_CMD", "로봇 컨트롤러 펌웨어 업데이트",
          "SSH 접속 후 펌웨어 이미지를 적용하고 버전을 확인한다.",
          "노트북, LAN 케이블, 펌웨어 이미지 파일",
          [{"label": "컨트롤러 SSH 접속", "cmd": "ssh bh@192.168.0.10",
            "desc": "기본 IP. 현장에 따라 변경될 수 있음"},
           {"label": "현재 버전 확인", "cmd": "bhctl version", "desc": "업데이트 전/후 비교용"},
           {"label": "서비스 정지", "cmd": "sudo systemctl stop bh-robot",
            "desc": "업데이트 전 반드시 정지"},
           {"label": "펌웨어 적용", "cmd": "sudo bhctl fw upgrade /tmp/fw.bin",
            "desc": "진행 중 전원 차단 금지"},
           {"label": "서비스 재시작", "cmd": "sudo systemctl restart bh-robot", "desc": ""},
           {"label": "로그 확인", "cmd": "journalctl -u bh-robot -n 200 -f",
            "desc": "ERROR 라인 확인"}],
          [("LAN 직결 후 컨트롤러 IP로 SSH 접속.", None),
           ("현재 버전 기록 → 서비스 정지 → 펌웨어 적용.", None),
           ("재시작 후 버전이 목표 버전과 일치하는지 확인.", "목표 버전과 동일"),
           ("원점 복귀 및 조리 시퀀스 1회 무부하 실행으로 검증.", None)])
    guide("SOFTWARE_CMD", "축 캘리브레이션 실행",
          "로더/그리퍼 축 원점 및 스트로크를 재교정한다.", "노트북, LAN 케이블",
          [{"label": "축 상태 조회", "cmd": "bhctl axis status --all", "desc": ""},
           {"label": "원점 복귀", "cmd": "bhctl axis home --axis loader",
            "desc": "축 이름: loader | gripper | lift"},
           {"label": "캘리브레이션 실행", "cmd": "bhctl calib run --axis loader --save",
            "desc": "--save 미입력 시 결과가 저장되지 않음"},
           {"label": "캘리브레이션 값 확인", "cmd": "bhctl calib show --axis loader", "desc": ""},
           {"label": "설정 백업", "cmd": "bhctl config export > ~/bh-config-backup.json",
            "desc": "작업 전 백업 권장"}],
          [("작업 전 config export로 설정 백업.", None),
           ("축 주변 간섭물 제거 후 원점 복귀 실행.", None),
           ("캘리브레이션 실행 후 스트로크 편차 확인.", "설계값 대비 ±0.5mm"),
           ("결과 저장(--save) 후 축 상태 재조회로 반영 확인.", None)])

    parts = [("로더 모터 어셈블리", 1, 1), ("그리퍼 실리콘 패드", 6, 4),
             ("온도센서 PT100", 3, 2), ("드라이버 보드", 1, 1),
             ("하네스 케이블 세트", 2, 1), ("퓨즈 10A", 10, 6),
             ("베어링 6002ZZ", 4, 2), ("타이밍 벨트 200mm", 2, 1)]
    for vehicle_name in VEHICLES:
        for name, qty, minq in parts:
            conn.execute(
                "INSERT INTO vehicle_inventory (id, vehicle_name, part_name, "
                "quantity, min_quantity, updated_at) VALUES (?,?,?,?,?,?)",
                (new_id(), vehicle_name, name,
                 qty if vehicle_name == VEHICLES[0] else max(0, qty - 1),
                 minq, stamp))

    fields = [("방문 식당명", "TEXT", None, 1), ("로봇 시리얼", "TEXT", None, 1),
              ("오류 코드", "TEXT", None, 0), ("증상 요약", "TEXTAREA", None, 1),
              ("조치 내용", "TEXTAREA", None, 1), ("사용 부품", "TEXT", None, 0),
              ("소요 시간(분)", "NUMBER", None, 0),
              ("처리 결과", "DROPDOWN", "완료,재방문 필요,부품 대기,모니터링", 1),
              ("현장 사진", "MEDIA", None, 0)]
    for i, (label, ftype, options, req) in enumerate(fields, 1):
        conn.execute(
            "INSERT INTO report_field_config (id, field_label, field_type, "
            "options, is_required, display_order, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (new_id(), label, ftype, options, req, i, stamp))
