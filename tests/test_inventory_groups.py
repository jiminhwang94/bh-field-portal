"""차량 재고 — 분류로 묶어 접기 · 손잡이로 끌어 옮기기 (A안).

품목이 케이블 · 패드 · 보드처럼 늘어나 한 화면을 넘겼다. 분류 한 칸으로 묶어 접고,
순서는 손잡이(≡)로 끌어 바꾼다. 품목 목록은 차량 공용이라 분류와 순서도 공용이며
시트 [차량재고] 탭에 분류 열 하나가 늘고 줄 순서가 곧 품목 순서다.

실행: python tests/test_inventory_groups.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from webcss import all_css, all_store as _all_store  # noqa: E402  (스타일 5개 · 저장소 여러 파일을 차례대로)
view = read("web", "js", "views", "inventory.js")
store = _all_store()
api = read("web", "js", "api.js")
invsheet = read("web", "js", "invsheet.js")
pending = read("web", "js", "pending.js")
gs = read("google-apps-script.gs")
css = all_css()

print("== 분류로 묶는다")
check("품목에 분류 칸이 있다 (모든 차량 공용)",
      "category = String(category || '').trim();" in store
      and "category: nextCat, updatedAt: stamp" in store)
check("수정 창에 분류 칸 + 기존 분류 태그", 'id="invCat"' in view and "data-cat=" in view)
check("묶음 머리줄에 종수 · 부족 건수", "function groupHead(g)" in view and "부족 ${low}" in view)
# v3.36.2 — 머리줄을 누르면 묶음이 접혀 부품이 사라졌다. 이제 그 분류만 본다 (접기 없음).
check("머리줄을 누르면 그 분류만 본다 (접지 않는다)",
      'data-act="chip" data-chip="${h(g.key)}"' in view and "toggle-group" not in view
      and "collapsed.has" not in view)
check("분류로도 검색된다", "`${i.partName} ${catOf(i)}`.toLowerCase().includes(q)" in view)
check("[모두 접기] [모두 펴기] 는 없다", "fold-all" not in view)
check("'분류 없음' 은 맨 뒤", "if (!ca) return 1;" in store and "const NONE_LABEL = '분류 없음';" in view)

print()
print("== 순서는 [순서 바꾸기] 모드에서만 (v3.37)")
# 줄마다 손잡이가 있으면 목록을 손으로 밀다 잡혀 순서가 바뀌었다.
check("평소 목록에는 손잡이가 없다", "data-drag" not in view and "function bindDrag" not in view)
check("[순서 바꾸기] → ▲▼ → [완료] 한 번 저장", "data-act=\"order-start\"" in view
      and "data-act=\"ord-move\"" in view and "await api.reorderInventory(next);" in view
      and "export async function reorderParts(order)" in store)
check("품목은 자기 분류 안에서만 · 분류는 분류끼리",
      "const list = kind === 'cat' ? ordering.cats : ordering.parts[key];" in view)
check("'분류 없음' 은 늘 맨 뒤", "[...ordering.cats, ''].flatMap" in view)
check("그대로면 저장하지 않는다", "next.join('|') === items.map((i) => i.partName).join('|')" in view)
check("순서는 차량 공용 — 부품명 배열 하나(partOrder)", "const PART_ORDER_KEY = 'partOrder';" in store)
# 이름순 정렬이 남아 있으면 끌어 놓은 순서가 다음 화면에서 도로 흩어진다.
check("이름순으로 다시 정렬하지 않는다", "rows.sort((a, b) => byText(a.partName, b.partName));" not in store)
check("같은 분류는 이어서 보인다", "export function orderParts(rows, order)" in store and "groupRank" in store)

print()
print("== 시트와 주고받기")
check("올릴 때 분류와 순서를 함께", "category: i.category || ''," in store and "driving: 'push'" not in invsheet)
check("시트에서 받은 줄 순서가 품목 순서", "const sheetOrder = [];" in store and "await setMeta(PART_ORDER_KEY, nextOrder);" in store)
# 내 순서 변경이 대기 중인데 시트 순서로 덮으면 끌어 놓은 것이 사라진다.
check("못 올린 내 순서 변경은 지킨다", "(c) => c.kind === 'order'" in store)
check("합칠 때 내 순서를 적용하되 남의 줄은 잃지 않는다", "if (reordered) {" in invsheet and "rank(a.partName) - rank(b.partName)" in invsheet)
check("[올릴 내용]에서 순서 변경을 되돌릴 수 있다", "await store.setMeta('partOrder', c.before || []);" in pending
      and "parts.push('순서 바꿈');" in pending)
check("시트 탭 머리줄: 부품명 · 분류 · 최소보유 · 차량…", "['부품명', INV_CATEGORY_HEADER, '최소보유'].concat(names)" in gs)
check("옛 배치(분류 열 없음)도 읽는다", "function invLayout(header)" in gs and "hasCat ? 3 : INV_FIXED" in gs)
# 3.26 이하 앱이 올릴 때 분류 · 순서를 덮어쓰면 새 앱에서 정한 것이 한 번에 지워진다.
check("옛 앱이 올려도 분류와 순서를 지킨다", "var legacyClient = true;" in gs and "keepCat[part]" in gs and "keepOrder.indexOf(a)" in gs)
check("수량 고치기가 배치를 보고 차량 열을 찾는다", "for (var c = layout.fixed; c < header.length; c++)" in gs)

print()
print("== 모양")
check("카드 칸 · 분류 머리줄 · 순서 줄 스타일", ".inv-grid {" in css and ".inv-card {" in css
      and ".grp-row {" in css and ".ord-btn {" in css)
check("목록은 안쪽 스크롤 칸에 갇히지 않는다", 'class="scroll" id="invBody"' not in view)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 재고가 분류로 묶이고, 순서는 순서 모드에서만 바뀐다.")
