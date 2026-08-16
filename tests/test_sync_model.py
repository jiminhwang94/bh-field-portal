"""v3.0 검증: 기기 ↔ 서버 공개본 동기화.

앱은 데이터를 기기에 두고 오프라인에서 동작한다. 서버가 책임지는 부분만 검사한다.

- 공개본 전체 내려주기(pull) → 기기가 쓰는 모양인지
- 기기 내용 받기(push) → 공개본이 통째로 교체되고 버전이 오르는지
- 재고 수량 즉시 반영 + 늦게 도착한 값은 무시(마지막 기록 우선)
- v2 에서 서버에 남은 리포트를 기기로 넘겨주는지 (자료 유실 방지)

실행: python3 tests/test_sync_model.py
"""
import json
import os
import shutil
import sqlite3
import sys

CODE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = "/tmp/bh-sync-test"
sys.path.insert(0, CODE)

shutil.rmtree(ROOT, ignore_errors=True)
os.makedirs(os.path.join(ROOT, "media"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "drafts"), exist_ok=True)
os.environ["DATABASE_URL"] = os.path.join(ROOT, "app.db")
os.environ["MEDIA_DIR"] = os.path.join(ROOT, "media")
os.environ["DRAFT_DIR"] = os.path.join(ROOT, "drafts")

from app import db, sync            # noqa: E402  (환경변수 설정 후 import)

fails = []


def check(label, ok, detail=""):
    print(f"{'✅' if ok else '❌'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(label)


print("=" * 62)
print("v3.0 동기화 모델 테스트")
print("=" * 62)

db.init()

# ---------------------------------------------------------------- 내려주기
snap = sync.build_snapshot()
check("초기 공개 버전은 0", snap["revision"] == 0, str(snap["revision"]))
check("가이드를 내려준다", len(snap["guides"]) > 0, f"{len(snap['guides'])}건")
check("가이드에 단계가 포함된다",
      all("steps" in g for g in snap["guides"]),
      f"총 {sum(len(g['steps']) for g in snap['guides'])}단계")
check("기기가 쓰는 이름(camelCase)으로 내려준다",
      {"categoryType", "codeOrTitle", "requiredTools"} <= set(snap["guides"][0]),
      ", ".join(sorted(snap["guides"][0])[:4]))
check("리포트 입력 항목을 내려준다", len(snap["fields"]) > 0, f"{len(snap['fields'])}개")
check("팀 공통 설정을 함께 내려준다 (오프라인 시트 전송용)",
      "sheetsWebappUrl" in (snap.get("settings") or {}))
check("PIN 값 자체는 내려보내지 않는다",
      "access_pin" not in json.dumps(snap) and "auth_secret" not in json.dumps(snap))

# ------------------------------------------------------------------ 받기
snap["guides"][0]["codeOrTitle"] = "E-000 기기에서 고침"
snap["guides"].append({
    "id": "newguide001", "categoryType": "HARDWARE_SOP",
    "codeOrTitle": "기기에서 새로 만든 SOP", "summary": "", "requiredTools": "",
    "commands": [], "steps": [{"instruction": "1단계"}, {"instruction": "2단계"}],
})
before_guides = len(snap["guides"])
result = sync.apply_snapshot(snap, "황지민")

check("[업데이트] 후 공개 버전이 오른다", result["revision"] == 1, str(result["revision"]))
check("올린 사람이 기록된다", result["by"] == "황지민", result["by"])

after = sync.build_snapshot()
check("기기에서 고친 내용이 공개본에 반영된다",
      any(g["codeOrTitle"] == "E-000 기기에서 고침" for g in after["guides"]))
check("기기에서 새로 만든 가이드가 올라간다",
      any(g["id"] == "newguide001" for g in after["guides"]))
check("가이드 수가 맞는다", len(after["guides"]) == before_guides,
      f"{len(after['guides'])} / {before_guides}")
new_guide = [g for g in after["guides"] if g["id"] == "newguide001"][0]
check("단계 순서가 1부터 다시 매겨진다",
      [s["stepOrder"] for s in new_guide["steps"]] == [1, 2],
      str([s["stepOrder"] for s in new_guide["steps"]]))

# 삭제도 반영되는지 (기기에서 지운 가이드는 공개본에서도 사라져야 한다)
after["guides"] = [g for g in after["guides"] if g["id"] != "newguide001"]
sync.apply_snapshot(after, "황지민")
check("기기에서 지운 가이드는 공개본에서도 사라진다",
      not any(g["id"] == "newguide001" for g in sync.build_snapshot()["guides"]))

# 잘못된 값은 거부
try:
    sync.apply_snapshot({"guides": "배열아님"}, "x")
    check("잘못된 형식은 거부한다", False, "예외가 나지 않음")
except ValueError:
    check("잘못된 형식은 거부한다", True)

# ---------------------------------------------------- 재고 수량 즉시 반영
snapshot = sync.build_snapshot()
item = snapshot["inventory"][0]
vehicle, part = item["vehicleName"], item["partName"]

sync.apply_quantities([{"type": "quantity", "vehicleName": vehicle,
                        "partName": part, "quantity": 7, "updatedAt": db.now()}])
quantities = {(q["vehicleName"], q["partName"]): q
              for q in sync.build_snapshot()["quantities"]}
check("재고 수량이 [업데이트] 없이 바로 반영된다",
      quantities[(vehicle, part)]["quantity"] == 7,
      str(quantities[(vehicle, part)]["quantity"]))

revision_before = db.published_state()["revision"]
check("수량 변경은 공개 버전을 올리지 않는다",
      revision_before == db.published_state()["revision"])

sync.apply_quantities([{"type": "quantity", "vehicleName": vehicle,
                        "partName": part, "quantity": 99,
                        "updatedAt": "2020-01-01T00:00:00"}])
quantities = {(q["vehicleName"], q["partName"]): q
              for q in sync.build_snapshot()["quantities"]}
check("늦게 도착한 예전 값은 무시한다 (마지막 기록 우선)",
      quantities[(vehicle, part)]["quantity"] == 7,
      str(quantities[(vehicle, part)]["quantity"]))

result = sync.apply_quantities([{"type": "quantity-delete", "vehicleName": vehicle,
                                 "partName": part}])
check("품목 삭제 시 수량 기록도 지운다",
      not any(q["vehicleName"] == vehicle and q["partName"] == part
              for q in result["quantities"]))

# --------------------------------------- v2 리포트 넘겨주기 (자료 유실 방지)
conn = sqlite3.connect(os.environ["DATABASE_URL"])
conn.execute("""CREATE TABLE IF NOT EXISTS report (
    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'DRAFT',
    sheet_name TEXT, sheet_row INTEGER, error_message TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
conn.execute("INSERT INTO report (id,title,payload_json,status,created_at,updated_at) "
             "VALUES ('r1','예전 리포트','[]','DRAFT','2026-08-01T10:00:00','2026-08-01T10:00:00')")
conn.commit()
conn.close()

legacy = sync.legacy_payload("devA")
check("v2 에서 서버에 남은 리포트를 기기로 넘겨준다",
      any(r["title"] == "예전 리포트" for r in legacy["reports"]),
      f"{len(legacy['reports'])}건")

db.init()      # 서버를 다시 켜도(마이그레이션 재실행)
conn = sqlite3.connect(os.environ["DATABASE_URL"])
try:
    left = conn.execute("SELECT COUNT(*) FROM report").fetchone()[0]
except sqlite3.DatabaseError:
    left = "표가 삭제됨"
finally:
    conn.close()
check("서버를 다시 켜도 예전 리포트를 지우지 않는다", left == 1, str(left))

print("=" * 62)
if fails:
    print(f"❌ 실패 {len(fails)}건: {', '.join(fails)}")
    sys.exit(1)
print("✅ 전부 통과")
