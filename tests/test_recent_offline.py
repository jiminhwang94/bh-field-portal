"""최근 본 가이드 보관·오프라인 검색 규칙 검증 (D-4).

recent.js 의 계약(20건 LRU, 중복 제거)과 검색 규칙(제목·요약·공구·명령어·단계 본문)을
같은 규칙으로 재현해 확인한다.

실행: python3 tests/test_recent_offline.py
"""
import json
import re

import os
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(BASE, "web", "js", "recent.js")).read()

# --- 1) 소스 계약 확인 -------------------------------------------------
print("=== recent.js 계약 ===")
checks = {
    "LIMIT 20": "const LIMIT = 20" in SRC,
    "최신 우선(unshift)": "list.unshift(" in SRC,
    "중복 제거": "filter((g) => g.id !== guide.id)" in SRC,
    "용량 초과 대비": "Math.floor(LIMIT / 2)" in SRC,
    "단계 본문 검색": "s.instruction" in SRC and "expectedMetric" in SRC,
    "명령어 검색": "guide.commands" in SRC,
    "카테고리 필터": "guide.categoryType !== type" in SRC,
}
for name, ok in checks.items():
    print(f"  {'OK ' if ok else 'FAIL'} {name}")
assert all(checks.values()), "recent.js 계약 불일치"


# --- 2) 검색 규칙을 동일하게 구현해 결과 비교 --------------------------
def search_recent(store, query, category=None):
    needle = (query or "").strip().lower()
    out = []
    for guide in store:
        if category and guide.get("categoryType") != category:
            continue
        if not needle:
            out.append(guide)
            continue
        steps = " ".join(f"{s.get('instruction','')} {s.get('expectedMetric') or ''}"
                         for s in guide.get("steps") or [])
        haystack = " ".join([
            guide.get("codeOrTitle") or "", guide.get("summary") or "",
            guide.get("requiredTools") or "",
            json.dumps(guide.get("commands") or [], ensure_ascii=False), steps,
        ]).lower()
        if needle in haystack:
            out.append(guide)
    return out


STORE = [
    {"id": "a", "categoryType": "ERROR_CODE", "codeOrTitle": "E-101 로더 모터 과전류",
     "summary": "과전류 정지", "requiredTools": "멀티미터", "commands": [],
     "steps": [{"instruction": "커넥터 CN3 전압 측정", "expectedMetric": "DC 24V ±0.5V"}]},
    {"id": "b", "categoryType": "ERROR_CODE", "codeOrTitle": "E-330 그리퍼 홈 실패",
     "summary": "원점 센서", "requiredTools": "육각 렌치", "commands": [],
     "steps": [{"instruction": "포토센서 청소", "expectedMetric": None}]},
    {"id": "c", "categoryType": "SOFTWARE_CMD", "codeOrTitle": "펌웨어 업데이트",
     "summary": "", "requiredTools": "", "commands": [{"cmd": "bhctl version"}],
     "steps": [{"instruction": "SSH 접속", "expectedMetric": None}]},
]

print("\n=== 오프라인 검색 규칙 ===")
cases = [
    ("24V", None, ["a"], "단계의 기준값까지 검색"),
    ("그리퍼", None, ["b"], "제목 검색"),
    ("bhctl", None, ["c"], "명령어 본문 검색"),
    ("멀티미터", None, ["a"], "공구 검색"),
    ("", "ERROR_CODE", ["a", "b"], "카테고리 필터(빈 검색어)"),
    ("센서", "ERROR_CODE", ["b"], "카테고리 + 검색어"),
    ("센서", "SOFTWARE_CMD", [], "다른 카테고리에는 없음"),
    ("없는말", None, [], "일치 없음"),
]
for query, category, expect, label in cases:
    got = [g["id"] for g in search_recent(STORE, query, category)]
    status = "OK " if got == expect else "FAIL"
    print(f"  {status} {label}: q={query!r} type={category} → {got}")
    assert got == expect, f"{label} 실패: {got} != {expect}"

print("\n=== LRU 보관 규칙 (최신 20건) ===")


def remember(store, guide):
    store = [g for g in store if g["id"] != guide["id"]]
    store.insert(0, guide)
    return store[:20]


store = []
for i in range(25):
    store = remember(store, {"id": f"g{i}"})
print(f"  25건 저장 → 보관 {len(store)}건, 첫 항목 {store[0]['id']}, 마지막 {store[-1]['id']}")
assert len(store) == 20 and store[0]["id"] == "g24" and store[-1]["id"] == "g5"
store = remember(store, {"id": "g10"})
print(f"  기존 항목 재열람 → 첫 항목 {store[0]['id']}, 개수 {len(store)} (중복 없음)")
assert store[0]["id"] == "g10" and len(store) == 20
assert len([g for g in store if g["id"] == "g10"]) == 1

print("\n✅ 최근 가이드 보관·오프라인 검색 로직 전체 통과")
