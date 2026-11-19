"""차량 재고 — 분류로 묶어 접기 · 손잡이로 끌어 옮기기 (A안).

품목이 케이블 · 패드 · 보드처럼 늘어나 한 화면을 넘겼다. 분류 한 칸으로 묶어 접고,
순서는 손잡이(≡)로 끌어 바꾼다. 품목 목록은 차량 공용이라 분류와 순서도 공용이며
시트 [차량재고] 탭에 분류 열 하나가 늘고 줄 순서가 곧 품목 순서다.

(43) 파일 이름 · 줄 모양에 묶이지 않는다 (tests/_src.py). 머리줄을 누르면 그 분류만 ·
평소 목록에 손잡이 없음 · [순서 바꾸기] ▲▼ · 분류 밖으로 못 나감 · 시트 줄 순서 = 품목 순서는
e2e(v332 · v3362 · v337) 가, 시트 쪽 머리줄 · 옛 배치 · 옛 앱 보호는 test_apps_script.mjs 가
실제로 돌려 본다. 쓰는 클래스에 스타일이 있는지는 test_css_contract.py 가 통째로 본다.

실행: python tests/test_inventory_groups.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _src import body, defines, has, has_re, module_of  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


view = module_of("inventoryView")          # 재고 화면
store = module_of("orderParts")            # 기기 저장소의 재고 쪽
invsheet = module_of("pushInventory")      # 시트와 주고받기
pending = module_of("openPendingList")     # [올릴 내용]
check("재고 화면 · 저장소 · 시트 창구 · 올릴 내용이 있다", all([view, store, invsheet, pending]))

print("== 분류로 묶는다")
check("품목에 분류 칸이 있다 (모든 차량 공용)",
      has_re(r"category\s*=\s*String\(\s*category\s*\|\|\s*''\s*\)\.trim\(\)")
      and has_re(r"category\s*:\s*\w+\s*,\s*updatedAt\s*:", store))
check("수정 창에 분류 칸 + 기존 분류 태그", has('id="invCat"') and has("data-cat="))
check("묶음 머리줄에 종수 · 부족 건수", has_re(r"\$\{\s*\w+\.all\.length\s*\}종") and has_re(r"부족 \$\{"))
check("분류로도 검색된다",
      has_re(r"`\$\{\s*\w+\.partName\s*\}\s*\$\{\s*\w+\(\s*\w+\s*\)\s*\}`\s*\.toLowerCase\(\)\s*\.includes\("))
check("[모두 접기] [모두 펴기] 는 없다", "fold-all" not in view)
check("'분류 없음' 은 맨 뒤", has_re(r"if\s*\(\s*!\s*\w+\s*\)\s*return\s+1\s*;", body("orderParts"))
      and has("'분류 없음'"))

print()
print("== 순서는 [순서 바꾸기] 모드에서만 (v3.37 — 누르고 옮기고 저장하는 것은 e2e v337)")
check("'분류 없음' 은 늘 맨 뒤", has_re(r"\[\s*\.\.\.\s*\w+\.cats\s*,\s*''\s*\]"))
check("그대로면 저장하지 않는다",
      has_re(r"\.join\(\s*'\|'\s*\)\s*===\s*\w+\.map\(\s*\(\s*\w+\s*\)\s*=>\s*\w+\.partName\s*\)\.join\("))
check("순서는 차량 공용 — 부품명 배열 하나(partOrder)", has("'partOrder'"))
# 이름순 정렬이 남아 있으면 끌어 놓은 순서가 다음 화면에서 도로 흩어진다.
check("이름순으로 다시 정렬하지 않는다",
      not has_re(r"\.sort\(\s*\(\s*a\s*,\s*b\s*\)\s*=>\s*\w+\(\s*a\.partName\s*,\s*b\.partName\s*\)\s*\)", store))
check("같은 분류는 이어서 보인다", defines("orderParts") and "category" in body("orderParts"))

print()
print("== 시트와 주고받기")
check("올릴 때 분류를 함께", has_re(r"category\s*:\s*\w+\.category\s*\|\|\s*''")
      and not has_re(r"driving\s*:\s*'push'", invsheet))
# 내 순서 변경이 대기 중인데 시트 순서로 덮으면 끌어 놓은 것이 사라진다.
check("못 올린 내 순서 변경은 지킨다", has_re(r"\.kind\s*===\s*'order'", body("applyInventorySheet")))
check("합칠 때 내 순서를 적용하되 남의 줄은 잃지 않는다",
      has_re(r"\w+\(\s*a\.partName\s*\)\s*-\s*\w+\(\s*b\.partName\s*\)"))
check("[올릴 내용]에서 순서 변경을 되돌릴 수 있다",
      has_re(r"setMeta\(\s*'partOrder'\s*,\s*\w+\.before") and has("순서 바꿈"))

print()
print("== 모양")
check("목록은 안쪽 스크롤 칸에 갇히지 않는다", not has_re(r'<[^>]*class="[^"]*\bscroll\b[^"]*"[^>]*id="invBody"', view)
      and has('id="invBody"'))

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 재고가 분류로 묶이고, 순서는 순서 모드에서만 바뀐다.")
