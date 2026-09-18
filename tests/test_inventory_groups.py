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


view = read("web", "js", "views", "inventory.js")
store = read("web", "js", "local", "store.js")
api = read("web", "js", "api.js")
invsheet = read("web", "js", "invsheet.js")
pending = read("web", "js", "pending.js")
gs = read("google-apps-script.gs")
css = read("web", "css", "app.css")

print("== 분류로 묶는다")
check("품목에 분류 칸이 있다 (모든 차량 공용)",
      "category = String(category || '').trim();" in store
      and "category: nextCat, updatedAt: stamp" in store)
check("수정 창에 분류 칸 + 기존 분류 태그", 'id="invCat"' in view and "data-cat=" in view)
check("묶음 머리줄에 종수 · 부족 건수 (접혀 있어도)", "function groupRow(g, open)" in view
      and "부족 ${low}" in view)
check("접힘은 기기에 기억한다", "const COLLAPSED_KEY = 'bh_inv_collapsed';" in view)
# 찾은 것이 접힌 묶음 안에 숨으면 검색이 헛돈다.
check("검색 중 · 부족만 볼 때는 전부 펼친다", "const forceOpen = Boolean(query.trim()) || lowOnly;" in view)
check("분류로도 검색된다", "`${i.partName} ${catOf(i)}`.toLowerCase().includes(q)" in view)
check("[모두 접기] [모두 펴기]", "act === 'fold-all'" in view and "act === 'unfold-all'" in view)
check("'분류 없음' 은 맨 뒤", "if (!ca) return 1;" in store and "const NONE_LABEL = '분류 없음';" in view)

print()
print("== 손잡이로 끌어 옮긴다")
check("손잡이만 잡힌다", "const handle = ev.target.closest('[data-drag]');" in view)
check("품목은 자기 묶음 안에서만", "itemRowsOf(dragging.group).filter((r) => r !== dragging.rows[0])" in view)
check("묶음은 묶음끼리 (머리줄 + 그 품목 줄을 한 덩이로)", "const blockOf = (head) => [head, ...itemRowsOf(head.dataset.group)];" in view)
check("놓았을 때 한 번 저장", "await api.reorderInventory(domOrder);" in view
      and "export async function reorderParts(order)" in store)
# 접힌 묶음의 줄은 화면에 없다 — 저장소 순서를 이어 붙여야 잃지 않는다.
check("접힌 묶음의 품목을 잃지 않는다", "for (const p of all) if (!domOrder.includes(p)) domOrder.push(p);" in view)
check("제자리에 놓으면 저장하지 않는다", "if (domOrder.join('|') === before) return;" in view)
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
check("묶음 머리줄 · 손잡이 · 놓을 자리 스타일", ".grp-row td {" in css and ".inv-table .drag-handle" in css
      and ".inv-table tr.is-drop-before td" in css)
check("손잡이 칸이 첫 칸이 되어도 이름 칸이 가로 배치", ".inv-table td.name-cell { display: flex;" in css)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 재고가 묶이고 끌린다.")
