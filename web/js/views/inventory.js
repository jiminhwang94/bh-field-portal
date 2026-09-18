// 스타리아 차량 수동 재고 관리 (차량 추가/삭제 + 품목 수량 조절)
//
// 품목은 **분류**(케이블 · 패드 · 보드 …)로 묶여 접히고 펴진다. 케이블만 해도
// C to C · USB to C · 1m · 2m 로 줄이 늘어, 묶지 않으면 표가 한 화면을 넘는다.
// 순서는 손잡이(≡)를 잡고 끌어 바꾼다 — 묶음 안에서 품목을, 묶음끼리 묶음을.
// 품목 목록과 순서는 차량 공용이다 (1호차에서 옮기면 2호차도 같은 순서).
import { api } from '../api.js';
import { isEnabled as sheetInvEnabled, pullInventory } from '../invsheet.js';
import {
  $, h, closeModal, confirmDialog, loading, openSheet, toast,
} from '../ui.js';

const VEHICLE_KEY = 'bh_last_vehicle';
const COLLAPSED_KEY = 'bh_inv_collapsed';     // 접어 둔 분류 — 기기에 기억
const NONE_LABEL = '분류 없음';

export async function inventoryView(view) {
  loading(view);
  const sheetMode = await sheetInvEnabled();
  let vehicles = (await api.listVehicles()).items;   // [{name, itemCount}]
  let current = localStorage.getItem(VEHICLE_KEY);
  if (!vehicles.some((v) => v.name === current)) {
    current = vehicles.length ? vehicles[0].name : null;
  }
  let items = current ? (await api.listInventory(current)).items : [];
  let lowOnly = false;
  let query = '';          // 부품 이름 검색어. 차량을 바꿔도 그대로 둔다
                           // (같은 부품을 차량별로 견줘 보는 일이 잦다)
  let collapsed = new Set();
  try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')); } catch { collapsed = new Set(); }
  const saveCollapsed = () => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* 비공개 창 */ }
  };

  /**
   * 보충이 필요한가.
   *
   * 최소보유와 **같은 수량은 아직 모자란 것이 아니다.** 예전에는 '이하'로 봐서
   * 딱 맞게 채워 둔 부품까지 빨갗게 떴다. 최소보유보다 적을 때만 표시한다.
   */
  const isLow = (i) => i.minQuantity > 0 && i.quantity < i.minQuantity;
  const catOf = (i) => String(i.category || '').trim();
  const catKey = (c) => c || '';                    // '' = 분류 없음

  /** 지금 등록된 분류 이름들 (품목 수정 창의 고르기 태그에 쓴다). */
  const categories = () => {
    const out = [];
    for (const i of items) { const c = catOf(i); if (c && !out.includes(c)) out.push(c); }
    return out;
  };

  /** [부족 항목만] 과 검색어를 함께 적용한 목록. */
  function visibleItems() {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (lowOnly && !isLow(i)) return false;
      if (q && !`${i.partName} ${catOf(i)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  /**
   * 보이는 품목을 분류로 묶는다. 순서는 품목 순서(저장소가 분류끼리 모아 준다)를
   * 그대로 따르고, '분류 없음' 은 맨 뒤다.
   */
  function groupsOf(list) {
    const groups = [];
    const byKey = new Map();
    for (const i of list) {
      const key = catKey(catOf(i));
      if (!byKey.has(key)) {
        const g = { key, label: key || NONE_LABEL, items: [], all: items.filter((x) => catKey(catOf(x)) === key) };
        byKey.set(key, g);
        groups.push(g);
      }
      byKey.get(key).items.push(i);
    }
    return groups;
  }

  /** 표의 한 줄. 디자인의 `.table--touch` 구조를 그대로 쓴다. */
  function itemRow(item, groupKey) {
    const low = isLow(item);
    const name = h(item.partName);
    return `
      <tr data-id="${item.id}" data-group="${h(groupKey)}" data-part="${name}" class="inv-item ${low ? 'is-low-row' : ''}">
        <td class="drag-td">
          <button class="drag-handle" type="button" data-drag="item"
                  aria-label="${name} 순서 옮기기 (잡고 끌기)">≡</button>
        </td>
        <td class="name-cell">
          ${name}
          ${low ? '<span class="tag tag--low">보충 필요</span>' : ''}
          ${item.pending ? '<span class="tag tag-neutral">반영 대기</span>' : ''}
        </td>
        <td class="tnum ${low ? 'is-low' : ''}" style="text-align:right"
            data-label="보유">${item.quantity}</td>
        <td class="tnum" style="text-align:right" data-label="최소보유">${item.minQuantity}</td>
        <td style="text-align:right">
          <span class="qty">
            <button class="btn btn-secondary qty__btn" data-act="dec" data-id="${item.id}"
                    type="button" aria-label="${name} 하나 사용">−</button>
            <span class="qty__val tnum ${low ? 'is-low' : ''}"
                  data-qty="${item.id}">${item.quantity}</span>
            <button class="btn btn-secondary qty__btn" data-act="inc" data-id="${item.id}"
                    type="button" aria-label="${name} 하나 보충">＋</button>
          </span>
        </td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-secondary" data-act="edit" data-id="${item.id}"
                  type="button" aria-label="${name} 항목 수정">수정</button>
          <button class="btn btn-secondary" data-act="del" data-id="${item.id}"
                  type="button" aria-label="${name} 항목 삭제">삭제</button>
        </td>
      </tr>`;
  }

  /**
   * 묶음 머리줄. 종수와 부족 건수는 **접혀 있어도** 보여야 한다 — 안 그러면
   * 접어 둔 묶음 안의 '보충 필요' 를 놓친다.
   */
  function groupRow(g, open) {
    const low = g.all.filter(isLow).length;
    return `
      <tr class="grp-row" data-group="${h(g.key)}">
        <td class="drag-td">
          <button class="drag-handle" type="button" data-drag="group"
                  aria-label="${h(g.label)} 묶음 순서 옮기기 (잡고 끌기)">≡</button>
        </td>
        <td colspan="5">
          <button class="grp-toggle" type="button" data-act="toggle-group" data-group="${h(g.key)}"
                  aria-expanded="${open}">
            <span class="grp-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
            <span class="grp-name">${h(g.label)}</span>
            <span class="grp-count tnum">${g.all.length}종${low ? ` · <span class="is-low">부족 ${low}</span>` : ''}</span>
          </button>
        </td>
      </tr>`;
  }

  /** 표 자리만 만드는 조각. 검색할 때 이 부분만 다시 그린다. */
  function bodyHtml() {
    const visible = visibleItems();
    if (!visible.length) {
      const why = query.trim()
        ? `'${h(query.trim())}' 에 맞는 부품이 없습니다.`
        : (lowOnly ? '보충이 필요한 품목이 없습니다.'
          : '등록된 품목이 없습니다. [＋ 품목 추가]로 등록하세요.');
      return `<div class="empty">${why}</div>`;
    }
    // 검색 중이거나 부족만 볼 때는 전부 펼친다 — 찾은 것이 접힌 묶음 안에 숨으면 안 된다.
    const forceOpen = Boolean(query.trim()) || lowOnly;
    const rows = groupsOf(visible).map((g) => {
      const open = forceOpen || !collapsed.has(g.key);
      return groupRow(g, open) + (open ? g.items.map((i) => itemRow(i, g.key)).join('') : '');
    }).join('');
    return `
      <table class="table table--touch inv-table">
        <thead>
          <tr>
            <th class="drag-td"></th>
            <th>부품</th>
            <th style="text-align:right">보유</th>
            <th style="text-align:right">최소보유</th>
            <th style="text-align:right">수량 조절</th>
            <th style="text-align:right">항목</th>
          </tr>
        </thead>
        <tbody id="invRows">${rows}</tbody>
      </table>`;
  }

  /** 오른쪽 아래 알약에 적을 글자. 거르는 중이면 '보인 것 / 전체' 로 적는다. */
  function countText() {
    const shown = visibleItems().length;
    const filtering = Boolean(query.trim()) || lowOnly;
    return `품목 ${filtering ? `${shown} / ${items.length}종` : `${items.length}종`}`;
  }

  /**
   * 검색 중에는 화면 전체를 다시 그리지 않는다.
   * 다시 그리면 검색칸이 새로 만들어져 **글자를 한 자 칠 때마다 커서가 빠진다.**
   */
  function paintBody() {
    const body = $('#invBody');
    if (body) { body.innerHTML = bodyHtml(); bindDrag(); }
    const count = $('#invCount');
    if (count) count.textContent = countText();
  }

  /** [부족 항목만] 칩의 켜짐 표시만 고친다. */
  function refreshLowChip() {
    const chip = view.querySelector('[data-act="toggle-low"]');
    if (!chip) return;
    chip.classList.toggle('is-on', lowOnly);
    chip.setAttribute('aria-pressed', String(lowOnly));
  }

  function render() {
    const lowCount = items.filter(isLow).length;

    view.innerHTML = `
      <div id="pageRoot">
        <div class="page-head">
          <h1 class="page-head__title">차량 재고</h1>
          <span class="page-head__spacer"></span>
          ${current ? `
            ${sheetMode ? `
              <button class="btn btn-secondary" data-act="sheet-refresh" type="button">시트에서 받기</button>` : ''}
            <button class="filter-toggle ${lowOnly ? 'is-on' : ''}" data-act="toggle-low"
                    type="button" aria-pressed="${lowOnly}">부족 항목만${lowCount ? ` · ${lowCount}` : ''}</button>
            <button class="btn btn-primary" data-act="add-item" type="button">＋ 품목 추가</button>` : ''}
        </div>

        <div class="veh-tabs">
          ${vehicles.map((v) => `
            <button class="veh-tab ${v.name === current ? 'is-active' : ''}" data-act="vehicle"
                    data-name="${h(v.name)}" type="button">${h(v.name)}</button>`).join('')}
          <button class="veh-tab veh-tab--manage" data-act="manage-vehicles"
                  type="button">＋ 차량</button>
        </div>

        ${current ? `
          <div class="toolbar" style="margin-bottom:var(--space-3)">
            <input class="input" id="invQ" type="search" style="flex:1"
                   placeholder="부품 · 분류로 찾기 (패드, 케이블)"
                   aria-label="${h(current)} 부품 검색" />
            <button class="btn btn-secondary" data-act="clear-q" type="button">지우기</button>
            <button class="btn btn-secondary" data-act="fold-all" type="button">모두 접기</button>
            <button class="btn btn-secondary" data-act="unfold-all" type="button">모두 펴기</button>
          </div>
          <div class="scroll" id="invBody">${bodyHtml()}</div>

          <div class="page-head">
            <span class="page-head__meta">
              ${lowCount ? `보충 필요 <span class="tnum is-low">${lowCount}</span>건` : ''}
            </span>
            <span class="page-head__spacer"></span>
            <span class="tag tag-neutral" id="invCount">${countText()}</span>
          </div>`
        : `<div class="empty">
             등록된 차량이 없습니다.<br />
             <button class="btn btn-primary" data-act="manage-vehicles" type="button"
                     style="margin-top:14px">＋ 차량 추가하기</button>
           </div>`}
      </div>`;

    $('#pageRoot').addEventListener('click', onClick);
    bindDrag();

    const box = $('#invQ');
    if (box) {
      box.value = query;
      box.addEventListener('input', () => { query = box.value; paintBody(); });
      // 한글은 조합이 끝나야 값이 확정되는 기기가 있다 — 그때도 한 번 더 맞춘다.
      box.addEventListener('compositionend', () => { query = box.value; paintBody(); });
    }
  }

  async function reload() {
    vehicles = (await api.listVehicles()).items;
    if (!vehicles.some((v) => v.name === current)) {
      current = vehicles.length ? vehicles[0].name : null;
      if (current) localStorage.setItem(VEHICLE_KEY, current);
      else localStorage.removeItem(VEHICLE_KEY);
    }
    items = current ? (await api.listInventory(current)).items : [];
    render();
  }

  /** 수량 칸 하나만 고쳐 그린다. 칸이 없으면 아무 일도 하지 않는다. */
  function paintQty(item) {
    const cell = view.querySelector(`[data-qty="${item.id}"]`);
    if (!cell) return;
    cell.textContent = item.quantity;
    cell.classList.toggle('is-low', isLow(item));
  }

  // ------------------------------------------------------------ 끌어 옮기기
  //
  // 리포트 항목 설정과 같은 방식 — **손잡이(≡)만** 잡힌다. 줄 어디서나 끌리면
  // 표를 넘기려던 손가락이 품목을 옮겨 버린다. 끄는 동안은 화면(DOM)만 옮기고,
  // 놓았을 때 새 순서를 한 번 저장한다. 품목은 자기 묶음 안에서만 움직인다
  // (묶음을 바꾸는 것은 [수정] 창의 분류 칸으로).
  function bindDrag() {
    const tbody = $('#invRows');
    if (!tbody || tbody.dataset.dragBound) return;
    tbody.dataset.dragBound = '1';
    let dragging = null;      // { kind: 'item'|'group', rows: [tr...], group }
    let pointerId = null;

    const itemRowsOf = (group) => Array.from(tbody.querySelectorAll(`tr.inv-item[data-group="${CSS.escape(group)}"]`));
    const groupHeads = () => Array.from(tbody.querySelectorAll('tr.grp-row'));
    const blockOf = (head) => [head, ...itemRowsOf(head.dataset.group)];
    const clearMarks = () => tbody.querySelectorAll('.is-drop-before, .is-drop-after')
      .forEach((r) => r.classList.remove('is-drop-before', 'is-drop-after'));

    tbody.addEventListener('pointerdown', (ev) => {
      const handle = ev.target.closest('[data-drag]');
      if (!handle) return;
      const tr = handle.closest('tr');
      if (handle.dataset.drag === 'item') {
        dragging = { kind: 'item', rows: [tr], group: tr.dataset.group };
      } else {
        dragging = { kind: 'group', rows: blockOf(tr), group: tr.dataset.group };
      }
      pointerId = ev.pointerId;
      dragging.rows.forEach((r) => r.classList.add('is-dragging'));
      try { handle.setPointerCapture(pointerId); } catch { /* 일부 기기 */ }
      ev.preventDefault();
    });

    tbody.addEventListener('pointermove', (ev) => {
      if (!dragging || ev.pointerId !== pointerId) return;
      clearMarks();
      if (dragging.kind === 'item') {
        const others = itemRowsOf(dragging.group).filter((r) => r !== dragging.rows[0]);
        const next = others.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
        if (next) { next.classList.add('is-drop-before'); tbody.insertBefore(dragging.rows[0], next); }
        else if (others.length) {
          const last = others[others.length - 1];
          last.classList.add('is-drop-after');
          last.after(dragging.rows[0]);
        }
      } else {
        const heads = groupHeads().filter((r) => r !== dragging.rows[0]);
        const next = heads.find((r) => {
          const block = blockOf(r);
          const top = r.getBoundingClientRect().top;
          const bottom = block[block.length - 1].getBoundingClientRect().bottom;
          return ev.clientY < top + (bottom - top) / 2;
        });
        const frag = document.createDocumentFragment();
        dragging.rows.forEach((r) => frag.appendChild(r));
        if (next) { next.classList.add('is-drop-before'); tbody.insertBefore(frag, next); }
        else if (heads.length) {
          const lastBlock = blockOf(heads[heads.length - 1]);
          lastBlock[lastBlock.length - 1].classList.add('is-drop-after');
          lastBlock[lastBlock.length - 1].after(frag);
        }
      }
    });

    const finish = async (ev) => {
      if (!dragging || ev.pointerId !== pointerId) return;
      dragging.rows.forEach((r) => r.classList.remove('is-dragging'));
      clearMarks();
      dragging = null; pointerId = null;

      // 화면에 보이는 순서로 새 품목 순서를 만든다. 접힌 묶음(줄이 안 보이는 것)은
      // 저장소의 순서를 그대로 이어 붙인다 — 보이지 않는 것을 잃으면 안 된다.
      const domOrder = [];
      for (const head of groupHeads()) {
        const shown = itemRowsOf(head.dataset.group).map((r) => r.dataset.part);
        const all = items.filter((i) => catKey(catOf(i)) === head.dataset.group).map((i) => i.partName);
        for (const p of shown) if (!domOrder.includes(p)) domOrder.push(p);
        for (const p of all) if (!domOrder.includes(p)) domOrder.push(p);
      }
      for (const i of items) if (!domOrder.includes(i.partName)) domOrder.push(i.partName);
      const before = items.map((i) => i.partName).join('|');
      if (domOrder.join('|') === before) return;          // 제자리에 놓았다
      try {
        await api.reorderInventory(domOrder);
        await reload();
        toast('순서를 바꿨습니다.', 'ok');
      } catch (err) { toast(err.message, 'err'); await reload(); }
    };
    tbody.addEventListener('pointerup', finish);
    tbody.addEventListener('pointercancel', finish);
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'vehicle') {
      current = btn.dataset.name;
      localStorage.setItem(VEHICLE_KEY, current);
      await reload();
      return;
    }
    if (act === 'toggle-low') { lowOnly = !lowOnly; paintBody(); refreshLowChip(); return; }
    if (act === 'clear-q') {
      query = '';
      const box = $('#invQ');
      if (box) { box.value = ''; box.focus(); }
      paintBody();
      return;
    }
    if (act === 'toggle-group') {
      const key = btn.dataset.group;
      if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
      saveCollapsed();
      paintBody();
      return;
    }
    if (act === 'fold-all') {
      for (const g of groupsOf(items)) collapsed.add(g.key);
      saveCollapsed(); paintBody(); return;
    }
    if (act === 'unfold-all') { collapsed.clear(); saveCollapsed(); paintBody(); return; }
    if (act === 'manage-vehicles') { openVehicleManager(); return; }

    if (act === 'sheet-refresh') {
      btn.disabled = true;
      btn.textContent = '받는 중…';
      try {
        await pullInventory();
        await reload();
        toast('시트에서 최신 재고를 받았습니다.', 'ok');
      } catch (err) {
        toast(err.message, 'err');
        render();
      }
      return;
    }

    if (act === 'inc' || act === 'dec') {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      const delta = act === 'inc' ? 1 : -1;
      if (item.quantity + delta < 0) return;

      // 눌린 느낌이 바로 나도록 화면부터 고치고, 서버는 뒤따라간다.
      // 화면 칸을 못 찾아도 **여기서 멈추면 안 된다** — 예전에 그렇게 터져서
      // 화면은 그대로인데 기억 속 수량만 올라갔고, 그 값이 [수정] 창에 채워져
      // 저장하는 순간 보유 수량이 엉뚱하게 바뀌었다.
      const before = item.quantity;
      item.quantity = before + delta;
      paintQty(item);
      try {
        const updated = await api.patchInventory(id, { delta });
        item.quantity = updated.quantity;
        item.pending = updated.pending;
        render();          // 상단 요약(총 개수·반영 대기 표시)도 함께 갱신
      } catch (err) {
        item.quantity = before;   // 보낸 만큼 빼는 게 아니라 **원래 값으로** 되돌린다
        paintQty(item);
        toast(err.message, 'err');
      }
      return;
    }

    if (act === 'del') {
      const item = items.find((i) => i.id === id);
      const ok = await confirmDialog('품목 삭제',
        `"${item.partName}" 품목을 모든 차량에서 삭제합니다. (품목 목록은 차량 공용)`, '삭제', true);
      if (!ok) return;
      try {
        await api.deleteInventory(id);
        toast('삭제했습니다.', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'err'); }
      return;
    }

    if (act === 'edit') { openEditor(items.find((i) => i.id === id)); return; }
    if (act === 'add-item') { openEditor(null); return; }
  }

  // ------------------------------------------------------------ 차량 관리
  function openVehicleManager() {
    const body = openSheet('차량 관리', vehicleManagerHtml());
    body.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-vact]');
      if (!btn) return;
      const name = btn.dataset.name;

      if (btn.dataset.vact === 'del-vehicle') {
        const target = vehicles.find((v) => v.name === name);
        const ok = await confirmDialog(
          '차량 삭제',
          `"${name}" 차량을 삭제합니다.\n이 차량에 등록된 품목 ${target ? target.itemCount : 0}종의 재고 기록도 함께 삭제되며 되돌릴 수 없습니다.`,
          '차량 삭제', true);
        if (!ok) return;
        try {
          const result = await api.deleteVehicle(name);
          toast(`${name} 삭제 완료 (품목 ${result.deletedItems}종 정리)`, 'ok');
          await reload();
          if ($('#modalRoot').innerHTML) {
            $('#sheetBody').innerHTML = vehicleManagerHtml();
          }
        } catch (err) { toast(err.message, 'err'); }
      }
    });

    $('#vehicleAddForm', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = $('#vehicleName', body);
      const name = input.value.trim();
      if (!name) { toast('차량 이름을 입력하세요.', 'err'); return; }
      try {
        await api.addVehicle(name);
        current = name;
        localStorage.setItem(VEHICLE_KEY, current);
        toast(`${name} 를 추가했습니다. 품목을 등록하세요.`, 'ok');
        await reload();
        closeModal();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  function vehicleManagerHtml() {
    return `
      <div class="list" style="margin-bottom:18px">
        ${vehicles.length ? vehicles.map((v) => `
          <div class="item" style="cursor:default">
            <div class="item__body">
              <div class="item__title">${h(v.name)}</div>
              <div class="item__sub">품목 ${v.itemCount}종${v.name === current ? ' · 현재 선택됨' : ''}</div>
            </div>
            <button class="btn btn--danger btn--sm" data-vact="del-vehicle"
                    data-name="${h(v.name)}" type="button">삭제</button>
          </div>`).join('')
          : '<div class="empty">등록된 차량이 없습니다.</div>'}
      </div>
      <form id="vehicleAddForm">
        <div class="field">
          <label>차량 추가</label>
          <input class="input" id="vehicleName" placeholder="예) 스타리아 3호차" />
          <span class="hint">차량을 삭제하면 그 차량의 재고 품목도 함께 삭제됩니다.</span>
        </div>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-act="close">닫기</button>
          <button class="btn btn--primary" type="submit">＋ 추가</button>
        </div>
      </form>`;
  }

  // ------------------------------------------------------------ 품목 편집
  function openEditor(item) {
    const cats = categories();
    const body = openSheet(item ? '품목 수정' : '품목 추가', `
      <form id="invForm">
        <div class="field">
          <label>부품명<span class="req">*</span></label>
          <input class="input" id="invName" value="${h(item ? item.partName : '')}" placeholder="예) 그리퍼 실리콘 패드" />
        </div>
        <div class="field">
          <label>분류</label>
          <input class="input" id="invCat" value="${h(item ? catOf(item) : '')}"
                 placeholder="아래에서 누르거나 직접 적으세요 (비우면 '분류 없음')" autocomplete="off" />
          ${cats.length ? `
            <div class="tag-list" style="margin-top:8px">
              ${cats.map((c) => `
                <button class="tag tag-neutral" data-cat="${h(c)}" type="button">${h(c)}</button>`).join('')}
            </div>` : ''}
          <span class="hint">같은 분류끼리 한 묶음으로 접힙니다 · 모든 차량에 같이 적용</span>
        </div>
        <div class="grid-2">
          <div class="field">
            <label>현재 수량</label>
            <input class="input" id="invQty" type="number" min="0" inputmode="numeric" value="${item ? item.quantity : 0}" />
          </div>
          <div class="field">
            <label>최소 보유 수량</label>
            <input class="input" id="invMin" type="number" min="0" inputmode="numeric" value="${item ? item.minQuantity : 0}" />
            <span class="hint">이 수량<strong>보다 적어지면</strong> [보충 필요]</span>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-act="close">취소</button>
          <button class="btn btn--primary" type="submit">저장</button>
        </div>
      </form>`);

    body.addEventListener('click', (ev) => {
      const tag = ev.target.closest('[data-cat]');
      if (!tag) return;
      const field = $('#invCat', body);
      field.value = tag.dataset.cat;
      field.focus();
    });

    $('#invName', body).focus();
    $('#invForm', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const partName = $('#invName', body).value.trim();
      const category = $('#invCat', body).value.trim();
      const quantity = Number($('#invQty', body).value || 0);
      const minQuantity = Number($('#invMin', body).value || 0);
      if (!partName) { toast('부품명을 입력하세요.', 'err'); return; }
      try {
        if (item) {
          // **손대지 않은 칸은 보내지 않는다.** 최소보유만 고쳤는데 보유 수량까지
          // 함께 보내면, 창을 연 사이에 바뀐 실제 수량을 창에 적혀 있던 옛 값으로
          // 덮어쓴다. 실제로 보유 수량이 엉뚱하게 바뀌는 일이 있었다.
          const patch = { partName, minQuantity, category };
          if (quantity !== item.quantity) patch.quantity = quantity;
          await api.patchInventory(item.id, patch);
        } else {
          await api.addInventory({ vehicleName: current, partName, category, quantity, minQuantity });
        }
        // 새로 만든 분류는 펴져 있어야 방금 넣은 품목이 보인다.
        collapsed.delete(catKey(category));
        saveCollapsed();
        closeModal();
        toast('저장했습니다.', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  render();

  // 시트에서 받아오는 일은 **사람이 누를 때만** 한다 — 위의 [시트에서 받기] 나
  // 오른쪽 위 [새로고침]. 화면을 열 때 뒤에서 받아 다시 그리면 적던 것이 날아간다.
}
