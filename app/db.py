"""SQLite 데이터 계층 (서버 = 팀 공개본 보관소).

**v3.0 구조**

앱은 모든 데이터를 **기기 안(IndexedDB)** 에 두고 오프라인에서 전부 동작한다.
서버는 팀이 공유하는 **공개본 한 벌**(`data/app.db`)만 보관하며, 하는 일은 둘뿐이다.

- 기기가 **[⬆️ 업데이트]** 를 누르면 그 기기 내용을 공개본으로 받는다 (`sync.apply_snapshot`)
- 다른 기기가 접속하면 공개본을 통째로 내려 준다 (`sync.build_snapshot`)

재고 **수량** 은 실물 상태 기록이라 [업데이트] 를 기다리지 않고 바로 반영된다.
리포트는 기기 전용이라 서버로 올라오지 않는다 (구글 시트로 직접 전송).
"""

import json
import os
import sqlite3
import threading
import time
import uuid

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 데이터 폴더는 BH_DATA_DIR 로 옮길 수 있다.
#
# 이게 없으면 테스트나 확인용 서버가 **운영 데이터를 그대로 건드린다.**
# 실제로 v3.0 개발 중 리포트가 날아갔고, v3.2 작업 중에도 충돌 테스트가
# 운영 가이드를 덮어써 백업에서 되살렸다. 두 번 같은 사고가 났으므로
# 폴더를 갈아끼울 수 있게 만들어 두고, tests/ 는 항상 이 값을 쓴다.
DATA_DIR = os.environ.get("BH_DATA_DIR") or os.path.join(BASE_DIR, "data")
DB_PATH = os.environ.get("DATABASE_URL") or os.path.join(DATA_DIR, "app.db")
MEDIA_DIR = os.environ.get("MEDIA_DIR") or os.path.join(DATA_DIR, "media")

CATEGORY_TYPES = ("ERROR_CODE", "HARDWARE_SOP", "SOFTWARE_CMD")
FIELD_TYPES = ("TEXT", "TEXTAREA", "NUMBER", "DROPDOWN", "MEDIA")
VEHICLES = ("스타리아 1호차", "스타리아 2호차")

APP_VERSION = "3.6.1"

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

-- 재고 "수량" 은 실물 상태 기록이므로 공개본에 바로 반영한다([업데이트] 불필요).
-- 품목 정의(이름·최소 보유)는 vehicle_inventory 에 남고 [업데이트] 대상이다.
CREATE TABLE IF NOT EXISTS inventory_quantity (
    vehicle_name TEXT NOT NULL,
    part_name    TEXT NOT NULL,
    quantity     INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (vehicle_name, part_name)
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

# 팀 공통 설정 (공개본에 보관)
DEFAULT_SETTINGS = {
    "sheets_webapp_url": "",
    "sheets_spreadsheet_id": "1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4",
    "site_url": "",        # 비우면 접속한 서버 주소를 자동 사용
    "published_revision": "0",
    "published_at": "",
    "published_by": "",
}

# 공개본을 통째로 바꾸는 작업([업데이트] 수신)은 한 번에 하나만 수행한다.
PUBLISH_LOCK = threading.Lock()



def safe_device_id(device_id) -> str:
    raw = str(device_id or "").strip()
    keep = [c for c in raw if c.isalnum() or c in "-_"]
    return "".join(keep)[:48]


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def new_id() -> str:
    return uuid.uuid4().hex


def connect() -> sqlite3.Connection:
    os.makedirs(MEDIA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
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
    """이전 버전 DB 를 현재 구조에 맞춘다.

    v3.0 부터 리포트는 기기에만 저장하지만, **이전 버전에서 만든 리포트는 지우지 않는다.**
    앱이 처음 실행될 때 `/api/sync/legacy` 로 가져가 기기에 옮긴다 (app/sync.py).
    """
    # 재고 수량을 공개본 전용 테이블로 이전 (v2.1)
    try:
        moved = conn.execute(
            "SELECT COUNT(*) FROM inventory_quantity").fetchone()[0]
        if not moved:
            conn.execute(
                "INSERT OR IGNORE INTO inventory_quantity "
                "(vehicle_name, part_name, quantity, updated_at) "
                "SELECT vehicle_name, part_name, quantity, updated_at "
                "FROM vehicle_inventory")
    except sqlite3.DatabaseError:
        pass

    # 더 이상 사용하지 않는 설정 제거
    conn.execute(
        "DELETE FROM app_setting WHERE key IN "
        "('notion_token','notion_database_id','notion_version','notion_title_prop',"
        " 'engineer_name','public_base_url','sync_hub_url','sync_key','hub_id',"
        " 'device_name','base_revision','base_hash')")


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
    out = dict(DEFAULT_SETTINGS)
    for key in DEFAULT_SETTINGS:
        value = _read_setting(DB_PATH, key)
        if value is not None:
            out[key] = value
    return out


def save_settings(values: dict) -> dict:
    """팀 공통 설정을 공개본에 저장한다."""
    allowed = {k: v for k, v in values.items()
               if k in DEFAULT_SETTINGS and k not in
               ("published_revision", "published_at", "published_by")}
    if allowed:
        _write_settings(DB_PATH, allowed)
    return get_settings()


# --------------------------------------------------------------- inventory
#
# v3.0 부터 재고는 기기(IndexedDB)와 구글 시트가 다룬다.
# 서버에 남은 것은 스냅샷 동기화(app/sync.py)가 쓰는 raw SQL 과 아래 하나뿐이다.

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


def _referenced_media() -> set:
    """공개본 가이드 단계가 참조하는 사진 파일명 집합.

    리포트 사진은 기기 안에만 있고 서버로 올라오지 않으므로 여기서 보지 않는다.
    """
    used = set()
    if not os.path.isfile(DB_PATH):
        return used
    conn = _connect_path(DB_PATH)
    try:
        for row in conn.execute(
                "SELECT image_url FROM guide_step "
                "WHERE image_url IS NOT NULL").fetchall():
            url = row["image_url"] or ""
            if url.startswith("/media/"):
                used.add(os.path.basename(url))
    except sqlite3.DatabaseError:
        pass
    finally:
        conn.close()
    return used


def cleanup_orphan_media(min_age_seconds=600) -> dict:
    """아무 곳에서도 참조하지 않는 사진 파일을 정리한다.

    방금 업로드해 아직 리포트에 담기지 않은 파일을 지우지 않도록
    기본 10분 이내 파일은 건너뛴다.
    """
    if not os.path.isdir(MEDIA_DIR):
        return {"deleted": 0, "freedBytes": 0}
    used = _referenced_media()
    now_ts = time.time()
    deleted, freed = 0, 0
    for name in os.listdir(MEDIA_DIR):
        path = os.path.join(MEDIA_DIR, name)
        if not os.path.isfile(path) or name in used:
            continue
        if now_ts - os.path.getmtime(path) < min_age_seconds:
            continue
        size = os.path.getsize(path)
        try:
            os.remove(path)
        except OSError:
            continue
        conn = connect()
        try:
            conn.execute("DELETE FROM media WHERE filename = ?", (name,))
            conn.commit()
        finally:
            conn.close()
        deleted += 1
        freed += size
    return {"deleted": deleted, "freedBytes": freed}


# ------------------------------------------------------- 공개본 버전 정보

def published_state() -> dict:
    return {
        "revision": int(_read_setting(DB_PATH, "published_revision") or 0),
        "at": _read_setting(DB_PATH, "published_at") or "",
        "by": _read_setting(DB_PATH, "published_by") or "",
    }


def bump_revision(device_name="") -> dict:
    """공개본이 갱신되었음을 기록한다 (기기가 [업데이트] 를 보낸 직후)."""
    revision = published_state()["revision"] + 1
    stamp = now()
    _write_settings(DB_PATH, {
        "published_revision": revision,
        "published_at": stamp,
        "published_by": device_name or "",
    })
    return {"revision": revision, "at": stamp, "by": device_name or ""}


def shared_summary(path=None) -> dict:
    conn = _connect_path(path or DB_PATH)
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
