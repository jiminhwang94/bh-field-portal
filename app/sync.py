"""기기 ↔ 서버 공개본 동기화.

앱(기기)은 데이터를 IndexedDB 에 두고 오프라인에서 전부 동작한다.
서버가 하는 일은 두 가지뿐이다.

- **내려주기** (`build_snapshot`) : 공개본 전체를 기기가 쓰는 모양(JSON)으로 만들어 준다.
- **받기** (`apply_snapshot`) : 기기가 [⬆️ 업데이트] 를 누르면 그 내용으로 공개본을 교체한다.

재고 **수량** 만은 [업데이트] 를 기다리지 않고 `apply_quantities` 로 즉시 반영된다.
"""

import json
import os
import sqlite3

from . import db

# [업데이트] 로 통째로 교체되는 테이블 (자식 → 부모 순서)
SHARED_TABLES = ("guide_step", "guide_master", "vehicle", "vehicle_inventory",
                 "report_field_config")


# ------------------------------------------------------------------ 내려주기

def build_snapshot() -> dict:
    """공개본 전체를 기기가 그대로 저장할 수 있는 모양으로 만든다."""
    conn = db.connect()
    try:
        steps_by_guide = {}
        for row in conn.execute(
                "SELECT * FROM guide_step ORDER BY step_order, rowid").fetchall():
            steps_by_guide.setdefault(row["guide_master_id"], []).append({
                "id": row["id"],
                "stepOrder": row["step_order"],
                "instruction": row["instruction"],
                "expectedMetric": row["expected_metric"],
                "imageUrl": row["image_url"],
            })

        guides = []
        for row in conn.execute("SELECT * FROM guide_master").fetchall():
            try:
                commands = json.loads(row["commands"] or "[]")
            except json.JSONDecodeError:
                commands = []
            guides.append({
                "id": row["id"],
                "categoryType": row["category_type"],
                "codeOrTitle": row["code_or_title"],
                "summary": row["summary"],
                "requiredTools": row["required_tools"],
                "commands": commands,
                "steps": steps_by_guide.get(row["id"], []),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            })

        vehicles = [{"name": r["name"], "displayOrder": r["display_order"],
                     "createdAt": r["created_at"]}
                    for r in conn.execute(
                        "SELECT * FROM vehicle ORDER BY display_order, name")]

        inventory = [{"id": r["id"], "vehicleName": r["vehicle_name"],
                      "partName": r["part_name"], "quantity": r["quantity"],
                      "minQuantity": r["min_quantity"], "updatedAt": r["updated_at"]}
                     for r in conn.execute("SELECT * FROM vehicle_inventory")]

        quantities = [{"vehicleName": r["vehicle_name"], "partName": r["part_name"],
                       "quantity": r["quantity"], "updatedAt": r["updated_at"]}
                      for r in conn.execute("SELECT * FROM inventory_quantity")]

        fields = [{"id": r["id"], "fieldLabel": r["field_label"],
                   "fieldType": r["field_type"], "options": r["options"],
                   "isRequired": bool(r["is_required"]),
                   "displayOrder": r["display_order"],
                   "createdAt": r["created_at"]}
                  for r in conn.execute(
                      "SELECT * FROM report_field_config "
                      "ORDER BY display_order, created_at")]
    finally:
        conn.close()

    state = db.published_state()
    settings = db.get_settings()
    return {
        "revision": state["revision"], "at": state["at"], "by": state["by"],
        "guides": guides, "vehicles": vehicles, "inventory": inventory,
        "quantities": quantities, "fields": fields,
        "media": _guide_media(guides),
        "summary": db.shared_summary(),
        # 팀 공통 설정도 함께 내려보낸다 — 기기가 오프라인이어도
        # 구글 시트로 바로 보낼 수 있어야 하기 때문이다.
        "settings": {
            "sheetsWebappUrl": settings.get("sheets_webapp_url") or "",
            "sheetsSpreadsheetId": settings.get("sheets_spreadsheet_id") or "",
        },
    }


def _guide_media(guides) -> list:
    """가이드 단계가 쓰는 사진 목록 (기기가 없는 것만 내려받는다)."""
    names = set()
    for guide in guides:
        for step in guide.get("steps") or []:
            url = step.get("imageUrl") or ""
            if url.startswith("/media/"):
                names.add(os.path.basename(url))
    if not names:
        return []
    conn = db.connect()
    try:
        rows = conn.execute("SELECT filename, mime, original_name, size "
                            "FROM media").fetchall()
    finally:
        conn.close()
    known = {r["filename"]: r for r in rows}
    out = []
    for name in sorted(names):
        row = known.get(name)
        out.append({
            "filename": name,
            "mime": row["mime"] if row else "image/jpeg",
            "originalName": row["original_name"] if row else name,
            "size": row["size"] if row else 0,
        })
    return out


# --------------------------------------------------------------------- 받기

def _text(value, limit=4000) -> str:
    return str(value if value is not None else "")[:limit]


class StaleSnapshot(Exception):
    """내가 받아간 뒤 다른 사람이 먼저 올렸다."""

    def __init__(self, current, mine):
        super().__init__("다른 사용자가 먼저 업데이트했습니다.")
        self.current = current
        self.mine = mine


def apply_snapshot(payload: dict, device_name="", force=False) -> dict:
    """기기가 보낸 내용으로 공개본 공유 테이블을 통째로 교체한다.

    두 사람이 동시에 눌러도 반쪽만 반영되지 않도록 잠금 + 단일 트랜잭션으로 처리한다.

    **덮어쓰기 방지**: 기기는 자기가 마지막으로 받아간 버전(baseRevision)을 함께 보낸다.
    그 사이 다른 사람이 먼저 올렸다면 지금 올리는 내용이 그 사람의 변경을 지운다.
    그래서 기본은 거절하고, 사용자가 화면에서 확인한 뒤 force 로 다시 부른다.
    (예전에는 이 값을 무시하고 그냥 덮어써서, 먼저 올린 사람의 가이드가 말없이 사라졌다)
    """
    guides = payload.get("guides") or []
    vehicles = payload.get("vehicles") or []
    inventory = payload.get("inventory") or []
    fields = payload.get("fields") or []
    for name, value in (("guides", guides), ("vehicles", vehicles),
                        ("inventory", inventory), ("fields", fields)):
        if not isinstance(value, list):
            raise ValueError(f"{name} 은 배열이어야 합니다.")

    stamp = db.now()
    with db.PUBLISH_LOCK:
        if not force:
            current = int(db.published_state().get("revision") or 0)
            mine = payload.get("baseRevision")
            # baseRevision 을 안 보내는 예전 앱은 그대로 통과시킨다.
            if mine is not None and int(mine or 0) < current:
                raise StaleSnapshot(current, int(mine or 0))
        conn = db.connect()
        try:
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("BEGIN")
            for table in SHARED_TABLES:
                conn.execute(f"DELETE FROM {table}")

            for guide in guides:
                gid = _text(guide.get("id"), 64) or db.new_id()
                category = guide.get("categoryType")
                if category not in db.CATEGORY_TYPES:
                    continue
                conn.execute(
                    "INSERT INTO guide_master (id, category_type, code_or_title, "
                    "summary, required_tools, commands, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (gid, category, _text(guide.get("codeOrTitle"), 300),
                     _text(guide.get("summary")), _text(guide.get("requiredTools")),
                     json.dumps(guide.get("commands") or [], ensure_ascii=False),
                     _text(guide.get("createdAt"), 40) or stamp,
                     _text(guide.get("updatedAt"), 40) or stamp))
                for order, step in enumerate(guide.get("steps") or [], start=1):
                    conn.execute(
                        "INSERT INTO guide_step (id, guide_master_id, step_order, "
                        "instruction, expected_metric, image_url) VALUES (?,?,?,?,?,?)",
                        (_text(step.get("id"), 64) or db.new_id(), gid, order,
                         _text(step.get("instruction")),
                         step.get("expectedMetric") or None,
                         step.get("imageUrl") or None))

            for order, vehicle in enumerate(vehicles, start=1):
                name = _text(vehicle.get("name"), 120).strip()
                if not name:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO vehicle (id, name, display_order, "
                    "created_at) VALUES (?,?,?,?)",
                    (db.new_id(), name, vehicle.get("displayOrder") or order,
                     _text(vehicle.get("createdAt"), 40) or stamp))

            for item in inventory:
                vehicle_name = _text(item.get("vehicleName"), 120).strip()
                part_name = _text(item.get("partName"), 200).strip()
                if not vehicle_name or not part_name:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO vehicle_inventory (id, vehicle_name, "
                    "part_name, quantity, min_quantity, updated_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (_text(item.get("id"), 64) or db.new_id(), vehicle_name,
                     part_name, max(0, int(item.get("quantity") or 0)),
                     max(0, int(item.get("minQuantity") or 0)),
                     _text(item.get("updatedAt"), 40) or stamp))

            for order, field in enumerate(fields, start=1):
                label = _text(field.get("fieldLabel"), 200).strip()
                ftype = field.get("fieldType")
                if not label or ftype not in db.FIELD_TYPES:
                    continue
                conn.execute(
                    "INSERT INTO report_field_config (id, field_label, field_type, "
                    "options, is_required, display_order, created_at) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (_text(field.get("id"), 64) or db.new_id(), label, ftype,
                     field.get("options") or None,
                     1 if field.get("isRequired") else 0,
                     field.get("displayOrder") or order,
                     _text(field.get("createdAt"), 40) or stamp))
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

        # 새 품목이 생겼으면 수량 행도 만들어 둔다 (없던 품목의 초기 수량).
        _seed_missing_quantities()
        result = db.bump_revision(device_name)
    result["summary"] = db.shared_summary()
    return result


def _seed_missing_quantities() -> None:
    conn = db.connect()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO inventory_quantity "
            "(vehicle_name, part_name, quantity, updated_at) "
            "SELECT vehicle_name, part_name, quantity, updated_at "
            "FROM vehicle_inventory")
        # 품목이 사라진 수량 행은 정리한다.
        conn.execute(
            "DELETE FROM inventory_quantity WHERE (vehicle_name, part_name) NOT IN "
            "(SELECT vehicle_name, part_name FROM vehicle_inventory)")
        conn.commit()
    except sqlite3.DatabaseError:
        pass
    finally:
        conn.close()


# ------------------------------------------------------------ 재고 수량 즉시 반영

def apply_quantities(ops: list) -> dict:
    """기기가 보낸 수량 변경을 공개본에 반영한다.

    같은 부품을 두 사람이 만졌다면 **더 나중 시각의 값**이 남는다.
    """
    if not isinstance(ops, list):
        raise ValueError("ops 는 배열이어야 합니다.")
    applied = 0
    conn = db.connect()
    try:
        for op in ops:
            if not isinstance(op, dict):
                continue
            vehicle_name = _text(op.get("vehicleName"), 120).strip()
            part_name = _text(op.get("partName"), 200).strip()
            if not vehicle_name or not part_name:
                continue
            if op.get("type") == "quantity-delete":
                conn.execute(
                    "DELETE FROM inventory_quantity WHERE vehicle_name = ? "
                    "AND part_name = ?", (vehicle_name, part_name))
                applied += 1
                continue
            stamp = _text(op.get("updatedAt"), 40) or db.now()
            conn.execute(
                "INSERT INTO inventory_quantity (vehicle_name, part_name, "
                "quantity, updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT(vehicle_name, part_name) DO UPDATE SET "
                "quantity = excluded.quantity, updated_at = excluded.updated_at "
                "WHERE excluded.updated_at >= inventory_quantity.updated_at",
                (vehicle_name, part_name,
                 max(0, int(op.get("quantity") or 0)), stamp))
            applied += 1
        conn.commit()
    finally:
        conn.close()
    return {"applied": applied, "quantities": _current_quantities()}


# --------------------------------------- 이전 버전(v2) 데이터 넘겨주기

LEGACY_DRAFT_DIR = os.environ.get("DRAFT_DIR") or os.path.join(db.DATA_DIR, "drafts")


def legacy_payload(device_id="") -> dict:
    """v2 에서 서버에 남아 있던 리포트를 기기로 넘겨준다.

    v2 는 리포트를 서버(공개본 + 기기별 작업본)에 두었다. v3 는 기기에만 두므로,
    앱이 처음 실행될 때 이 값을 받아 기기로 옮기고 나면 서버 쪽은 더 이상 쓰이지 않는다.
    """
    reports = []
    seen = set()
    paths = [db.DB_PATH]
    device = db.safe_device_id(device_id)
    if device:
        paths.append(os.path.join(LEGACY_DRAFT_DIR, f"{device}.db"))

    for path in paths:
        if not os.path.isfile(path):
            continue
        conn = sqlite3.connect(path, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute("SELECT * FROM report").fetchall()
        except sqlite3.DatabaseError:
            continue            # report 표가 없는(이미 정리된) DB
        finally:
            conn.close()
        for row in rows:
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            try:
                payload = json.loads(row["payload_json"] or "[]")
            except json.JSONDecodeError:
                payload = []
            reports.append({
                "id": row["id"], "title": row["title"], "payload": payload,
                # 전송 상태는 기기에서 다시 판단하도록 '저장됨' 으로 넘긴다.
                "status": "UPLOADED" if row["status"] == "UPLOADED" else "DRAFT",
                "sheetName": row["sheet_name"], "sheetRow": row["sheet_row"],
                "errorMessage": None,
                "createdAt": row["created_at"], "updatedAt": row["updated_at"],
            })
    reports.sort(key=lambda r: r["createdAt"] or "", reverse=True)
    return {"reports": reports, "media": _report_media(reports)}


def _report_media(reports) -> list:
    """리포트가 참조하는 사진 (기기가 없는 것만 내려받는다)."""
    names = set()
    for report in reports:
        for item in report.get("payload") or []:
            for media in (item or {}).get("media") or []:
                name = os.path.basename(media.get("filename") or "")
                if name:
                    names.add(name)
    if not names:
        return []
    conn = db.connect()
    try:
        known = {r["filename"]: r for r in
                 conn.execute("SELECT filename, mime, original_name, size FROM media")}
    finally:
        conn.close()
    out = []
    for name in sorted(names):
        if not os.path.isfile(os.path.join(db.MEDIA_DIR, name)):
            continue        # 이미 정리된 사진은 건너뛴다
        row = known.get(name)
        out.append({
            "filename": name,
            "mime": row["mime"] if row else "image/jpeg",
            "originalName": row["original_name"] if row else name,
            "size": row["size"] if row else 0,
        })
    return out


def _current_quantities() -> list:
    conn = db.connect()
    try:
        return [{"vehicleName": r["vehicle_name"], "partName": r["part_name"],
                 "quantity": r["quantity"], "updatedAt": r["updated_at"]}
                for r in conn.execute("SELECT * FROM inventory_quantity")]
    finally:
        conn.close()
