// 차량 재고 (C-1 집중형) — 왼쪽 목록에서 고르고, 오른쪽 큰 패널에서 수량을 바꾼다.
//
// 장갑 낀 손으로 줄마다 붙은 작은 [−][+] 를 겨냥하면 옆 줄을 누르기 쉽다. 그래서
// 목록은 **고르기만** 하고, 수량은 오른쪽 패널의 큰 버튼으로 바꾼다. 좁은 화면
// (세로 태블릿·폰)에서는 패널 대신 같은 내용을 창으로 띄운다.
//
// 위쪽 칩으로 거른다 — [전체] [부족만] [분류마다 하나]. 분류 묶음은 그대로 접히고
// 펴지며, 순서는 손잡이(≡)를 잡고 끌어 바꾼다 (품목 목록과 순서는 차량 공용).
import { api } from '../api.js';
import { isEnabled as sheetInvEnabled, pullInventory } from '../invsheet.js';
import {
  $, h, closeModal, confirmDialog, loading, openSheet, promptDialog, toast,
} from '../ui.js';

const VEHICLE_KEY = 'bh_last_vehicle';
const COLLAPSED_KEY = 'bh_inv_collapsed';     // 접어 둔 분류 — 기기에 기억
const NONE_LABEL = '분류 없음';
const LOW = '__low';                          // 칩 [부족만]
/** 패널을 옆에 둘 만큼 넓은가. 좁으면 품목을 누를 때 창으로 띄운다. */
const wide = () => window.matchMedia('(min-width: 1000px)').matches;

export async function inventoryView(view) {
  loading(view);
  const sheetMode = await sheetInvEnabled();
  let vehicles = (await api.listVehicles()).items;   // [{name, itemCount}]
  let current = localStorage.getItem(VEHICLE_KEY);
  if (!vehicles.some((v) => v.name === current)) {
    current = vehicles.length ? vehicles[0].name : null;
  }
  let items = current ? (await api.listInventory(current)).items : [];
  let others = await otherVehicleQty();               // 다른 차량의 같은 품목 수량
  let chip = null;         // null = 전체 · LOW = 부족만 · 그 밖 = 분류 이름('' 은 분류 없음)
  let query = '';          // 부품 이름 검색어. 차량을 바꿔도 그대로 둔다
                           // (같은 부품을 차량별로 견줘 보는 일이 잦다)
  let selectedId = null;
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

  /** 지금 등록된 분류 이름들 (칩과 품목 수정 창의 고르기 태그에 쓴다). */
  const categories = () => {
    const out = [];
    for (const i of items) { const c = catOf(i); if (c && !out.includes(c)) out.push(c); }
    return out;
  };

  /** 다른 차량에 있는 같은 품목의 수량 — 패널에 "다른 차량" 으로 보여 준다. */
  async function otherVehicleQty() {
    const map = new Map();          // partName → [{ vehicle, quantity }]
    for (const v of vehicles) {
      if (v.name === current) continue;
      for (const i of (await api.listInventory(v.name)).items) {
        if (!map.has(i.partName)) map.set(i.partName, []);
        map.get(i.partName).push({ vehicle: v.name, quantity: i.quantity });
      }
    }
    return map;
  }

  /** 칩과 검색어를 함께 적용한 목록. */
  function visibleItems() {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (chip === LOW && !isLow(i)) return false;
      if (chip !== null && chip !== LOW && catKey(catOf(i)) !== chip) return false;
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

  /** 거르기 칩 — 전체 · 부족만 · 분류마다 하나. 분류 칩에도 부족 건수를 붙인다. */
  function chipsHtml() {
    const lowCount = items.filter(isLow).length;
    const cats = groupsOf(items);
    const one = (value, label, count, { extra = '', low = 0 } = {}) => {
      const on = chip === value;
      return `<button class="inv-chip${on ? ' is-on' : ''}${extra}" data-act="chip"
                      data-chip="${h(value === null ? '' : value)}" data-all="${value === null ? '1' : ''}"
                      type="button" aria-pressed="${on}">${h(label)} <span class="tnum">${count}</span>${low
        ? `<span class="inv-chip__low tnum" aria-label="부족 ${low}">${low}</span>` : ''}</button>`;
    };
    return [
      one(null, '전체', items.length),
      one(LOW, '부족만', lowCount, { extra: ' inv-chip--low' }),
      ...cats.map((g) => one(g.key, g.label, g.all.length, { low: g.all.filter(isLow).length })),
    ].join('');
  }

  /** 목록의 한 줄 — 손잡이 · 이름 · 수량/최소. 누르면 오른쪽 패널에 연다. */
  function itemRow(item, groupKey) {
    const low = isLow(item);
    const name = h(item.partName);
    const on = item.id === selectedId;
    return `
      <tr data-id="${item.id}" data-group="${h(groupKey)}" data-part="${name}"
          class="inv-item ${low ? 'is-low-row' : ''} ${on ? 'is-selected' : ''}">
        <td class="drag-td">
          <button class="drag-handle" type="button" data-drag="item"
                  aria-label="${name} 순서 옮기기 (잡고 끌기)">≡</button>
        </td>
        <td class="name-cell">
          <button class="inv-pick" data-act="select" data-id="${item.id}" type="button"
                  aria-pressed="${on}">
            <span class="inv-pick__name">${name}</span>
            ${low ? `<span class="tag tag--low">${item.minQuantity - item.quantity}개 부족</span>` : ''}
            ${item.pending ? '<span class="tag tag-neutral">반영 대기</span>' : ''}
          </button>
        </td>
        <td class="qty-cell">
          <button class="inv-pick inv-pick--qty" data-act="select" data-id="${item.id}" type="button"
                  aria-label="${name} 수량 ${item.quantity}, 최소 ${item.minQuantity}">
            <span class="inv-qty tnum ${low ? 'is-low' : ''}" data-qty="${item.id}">${item.quantity}</span>
            <span class="inv-min tnum">/ ${item.minQuantity}</span>
          </button>
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
        <td colspan="2">
          <button class="grp-toggle" type="button" data-act="toggle-group" data-group="${h(g.key)}"
                  aria-expanded="${open}">
            <span class="grp-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
            <span class="grp-name">${h(g.label)}</span>
            <span class="grp-count tnum">${g.all.length}종${low ? ` · <span class="is-low">부족 ${low}</span>` : ''}</span>
          </button>
        </td>
      </tr>`;
  }

  /** 목록 자리만 만드는 조각. 검색·칩을 바꿀 때 이 부분만 다시 그린다. */
  function bodyHtml() {
    const visible = visibleItems();
    if (!visible.length) {
      const why = query.trim()
        ? `'${h(query.trim())}' 에 맞는 부품이 없습니다.`
        : (chip === LOW ? '보충이 필요한 품목이 없습니다.'
          : '등록된 품목이 없습니다. [＋ 품목 추가]로 등록하세요.');
      return `<div class="empty">${why}</div>`;
    }
    // 검색 중이거나 칩으로 거를 때는 전부 펼친다 — 찾은 것이 접힌 묶음 안에 숨으면 안 된다.
    const forceOpen = Boolean(query.trim()) || chip !== null;
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
            <th style="text-align:right">보유 / 최소</th>
          </tr>
        </thead>
        <tbody id="invRows">${rows}</tbody>
      </table>`;
  }

  /** 오른쪽 패널 — 고른 품목 하나를 크게. */
  function panelHtml(item) {
    if (!item) {
      return `<div class="inv-panel__empty">왼쪽에서 품목을 고르면<br />여기서 수량을 바꿉니다.</div>`;
    }
    const low = isLow(item);
    const elsewhere = others.get(item.partName) || [];
    return `
      <div class="inv-panel__head">
        <span class="inv-panel__cat">${h(catOf(item) || NONE_LABEL)} · ${h(current)}</span>
        <h2 class="inv-panel__name">${h(item.partName)}</h2>
        <span class="inv-panel__min ${low ? 'is-low' : ''}">최소 ${item.minQuantity}개${low ? ` · ${item.minQuantity - item.quantity}개 부족` : ''}</span>
      </div>
      <div class="inv-stepper">
        <button class="inv-stepper__btn" data-act="dec" data-id="${item.id}" type="button"
                aria-label="${h(item.partName)} 하나 사용" ${item.quantity <= 0 ? 'disabled' : ''}>−</button>
        <span class="inv-stepper__val tnum ${low ? 'is-low' : ''}" data-qty="${item.id}">${item.quantity}</span>
        <button class="inv-stepper__btn inv-stepper__btn--plus" data-act="inc" data-id="${item.id}" type="button"
                aria-label="${h(item.partName)} 하나 보충">＋</button>
      </div>
      <button class="btn btn-secondary btn--block" data-act="set-qty" data-id="${item.id}" type="button">숫자로 바로 입력</button>
      ${elsewhere.length ? `
        <div class="inv-panel__others">
          <span class="inv-panel__label">다른 차량</span>
          ${elsewhere.map((o) => `
            <span class="inv-panel__other"><span>${h(o.vehicle)}</span><b class="tnum">${o.quantity}개</b></span>`).join('')}
        </div>` : ''}
      <span class="spacer"></span>
      <div class="inv-panel__actions">
        <button class="btn btn-secondary" data-act="edit" data-id="${item.id}" type="button">수정</button>
        <button class="btn btn--danger" data-act="del" data-id="${item.id}" type="button">삭제</button>
      </div>`;
  }

  /** 오른쪽 아래 알약에 적을 글자. 거르는 중이면 '보인 것 / 전체' 로 적는다. */
  function countText() {
    const shown = visibleItems().length;
    const filtering = Boolean(query.trim()) || chip !== null;
    return `품목 ${filtering ? `${shown} / ${items.length}종` : `${items.length}종`}`;
  }

  /**
   * 검색 중에는 화면 전체를 다시 그리지 않는다.
   * 다시 그리면 검색칸이 새로 만들어져 **글자를 한 자 칠 때마다 커서가 빠진다.**
   */
  function paintBody() {
    const body = $('#invBody');
    if (body) { body.innerHTML = bodyHtml(); bindDrag(); }
    const chips = $('#invChips');
    if (chips) chips.innerHTML = chipsHtml();
    const count = $('#invCount');
    if (count) count.textContent = countText();
  }

  function paintPanel() {
    const panel = $('#invPanel');
    if (panel) panel.innerHTML = panelHtml(items.find((i) => i.id === selectedId));
    // 창으로 띄운 경우(좁은 화면)도 같이 맞춘다.
    const sheet = document.querySelector('#sheetBody .inv-sheet');
    if (sheet) sheet.innerHTML = panelHtml(items.find((i) => i.id === selectedId));
  }

  function select(id) {
    selectedId = id;
    view.querySelectorAll('tr.inv-item').forEach((tr) => {
      const on = tr.dataset.id === id;
      tr.classList.toggle('is-selected', on);
      tr.querySelectorAll('[data-act="select"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    });
    if (wide()) { paintPanel(); return; }
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const body = openSheet(item.partName, `<div class="inv-panel inv-sheet">${panelHtml(item)}</div>`);
    body.addEventListener('click', onClick);
  }

  function render() {
    if (!items.some((i) => i.id === selectedId)) {
      // 처음엔 보충이 필요한 것부터 보여 준다 — 그게 이 화면에 온 이유인 경우가 많다.
      selectedId = (items.find(isLow) || items[0] || {}).id || null;
    }

    view.innerHTML = `
      <div id="pageRoot" class="page-stack">
        <div class="page-head">
          <h1 class="page-head__title">차량 재고</h1>
          <div class="veh-tabs" role="tablist" aria-label="차량">
            ${vehicles.map((v) => `
              <button class="veh-tab ${v.name === current ? 'is-active' : ''}" data-act="vehicle"
                      role="tab" aria-selected="${v.name === current}"
                      data-name="${h(v.name)}" type="button">${h(v.name)}</button>`).join('')}
            <button class="veh-tab veh-tab--manage" data-act="manage-vehicles"
                    type="button" aria-label="차량 추가 · 삭제">＋ 차량</button>
          </div>
          <span class="page-head__spacer"></span>
          ${current ? `
            ${sheetMode ? `
              <button class="btn btn-secondary" data-act="sheet-refresh" type="button">시트에서 받기</button>` : ''}
            <button class="btn btn-secondary" data-act="cat-order" type="button">분류 순서</button>
            <button class="btn btn-primary" data-act="add-item" type="button">＋ 품목 추가</button>` : ''}
        </div>

        ${current ? `
          <div class="inv-filter">
            <div class="inv-chips" id="invChips" role="group" aria-label="거르기">${chipsHtml()}</div>
            <input class="input inv-search" id="invQ" type="search"
                   placeholder="부품 찾기" aria-label="${h(current)} 부품 검색" />
          </div>
          <div class="inv-split">
            <section class="inv-list">
              <div class="scroll" id="invBody">${bodyHtml()}</div>
              <div class="inv-list__foot">
                <span class="tag tag-neutral" id="invCount">${countText()}</span>
                <span class="spacer"></span>
                <button class="btn btn-secondary btn--sm" data-act="fold-all" type="button">모두 접기</button>
                <button class="btn btn-secondary btn--sm" data-act="unfold-all" type="button">모두 펴기</button>
              </div>
            </section>
            <aside class="inv-panel" id="invPanel" aria-label="고른 품목">${panelHtml(items.find((i) => i.id === selectedId))}</aside>
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
    others = await otherVehicleQty();
    render();
    window.dispatchEvent(new Event('bh-inventory-changed'));
  }

  /** 수량 칸만 고쳐 그린다 (목록 · 패널 · 창). 칸이 없으면 아무 일도 하지 않는다. */
  function paintQty(item) {
    view.ownerDocument.querySelectorAll(`[data-qty="${item.id}"]`).forEach((cell) => {
      cell.textContent = item.quantity;
      cell.classList.toggle('is-low', isLow(item));
    });
  }

  // ------------------------------------------------------------ 분류 순서 (v3.32)
  //
  // 묶음 머리줄의 손잡이(≡)로 끌어도 되지만, 장갑을 끼면 끌기가 어렵다. 그래서 창에서
  // 큰 ↑ ↓ 로 옮기고 [저장] 을 한 번 누른다. 순서는 모든 차량 공용 · 시트 줄 순서로 올라간다.
  // '분류 없음' 은 늘 맨 뒤다 (저장소 규칙).
  function openCatOrder() {
    let order = groupsOf(items).map((g) => g.key).filter((k) => k);
    const hasNone = items.some((i) => !catOf(i));
    if (order.length < 2) { toast('분류가 2개 이상일 때 순서를 바꿀 수 있습니다.'); return; }
    openSheet('분류 순서', '<div id="catOrder" class="cat-order"></div>');
    const body = $('#catOrder');
    const paint = () => {
      body.innerHTML = `
        <p class="muted">위에서부터 이 차례로 보입니다. 모든 차량에 같이 적용됩니다.</p>
        <ol class="cat-order__list">
          ${order.map((k, i) => `
            <li class="cat-order__row">
              <span class="cat-order__name">${h(k)} <small class="muted tnum">${items.filter((x) => catOf(x) === k).length}종</small></span>
              <button class="cat-order__btn" data-move="${i}" data-dir="-1" type="button" ${i === 0 ? 'disabled' : ''}
                      aria-label="${h(k)} 위로">↑</button>
              <button class="cat-order__btn" data-move="${i}" data-dir="1" type="button" ${i === order.length - 1 ? 'disabled' : ''}
                      aria-label="${h(k)} 아래로">↓</button>
            </li>`).join('')}
          ${hasNone ? `<li class="cat-order__row is-fixed"><span class="cat-order__name">${h(NONE_LABEL)} <small class="muted">늘 맨 뒤</small></span></li>` : ''}
        </ol>
        <button class="btn btn-primary btn--block" data-save="1" type="button">저장</button>`;
    };
    paint();
    body.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.move !== undefined) {
        const i = Number(b.dataset.move);
        const j = i + Number(b.dataset.dir);
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        paint();
        return;
      }
      if (b.dataset.save) {
        // 분류 차례대로 그 분류의 품목을 지금 순서 그대로 이어 붙인다
        const parts = [];
        for (const k of [...order, '']) {
          for (const i of items) if (catKey(catOf(i)) === k && !parts.includes(i.partName)) parts.push(i.partName);
        }
        const before = items.map((i) => i.partName).join('|');
        closeModal();
        if (parts.join('|') === before) return;
        try {
          await api.reorderInventory(parts);
          await reload();
          toast('분류 순서를 바꿨습니다.', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      }
    });
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
    if (act === 'cat-order') { openCatOrder(); return; }
    if (act === 'chip') {
      const value = btn.dataset.all ? null : btn.dataset.chip;
      chip = chip === value ? null : value;      // 켜진 칩을 다시 누르면 전체로
      paintBody();
      return;
    }
    if (act === 'select') { select(id); return; }
    if (act === 'set-qty') {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      const raw = await promptDialog(`${item.partName} 수량`, {
        label: `${current} 에 지금 몇 개 있나요?`, value: String(item.quantity), okLabel: '저장',
      });
      if (raw === null || raw === '') return;
      const quantity = Number(raw);
      if (!Number.isFinite(quantity) || quantity < 0) { toast('0 이상의 숫자를 넣으세요.', 'err'); return; }
      try {
        await api.patchInventory(id, { quantity: Math.floor(quantity) });
        await reload();
        toast('저장했습니다.', 'ok');
      } catch (err) { toast(err.message, 'err'); }
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
        // 목록(부족 표시·칩 숫자)과 패널을 함께 맞춘다. 검색칸은 그대로 둔다.
        paintBody();
        paintPanel();
        window.dispatchEvent(new Event('bh-inventory-changed'));
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
        closeModal();
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
