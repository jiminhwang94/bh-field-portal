// 차량 재고 — 부품마다 카드 한 장, 카드에서 바로 −/+ (v3.37).
//
// 가로 태블릿에서 한 줄짜리 표가 안쪽 스크롤 칸에 갇혀 부품이 **3개만** 보였다. 이제
// 카드를 화면 폭에 맞춰 2칸(아주 넓으면 3칸 · 세로 태블릿과 폰은 1칸)으로 놓고, 목록은
// 화면 전체로 내려간다. 차량 탭은 제목 줄로 올렸고, 거르기 줄은 내려도 위에 붙어 있다.
// 카드 이름을 누르면 상세(다른 차량 수량 · 숫자로 입력 · 수정 · 삭제)를 창으로 띄운다.
//
// 위쪽 칩으로 거른다 — [전체] [부족만] [분류마다 하나]. 분류 머리줄을 눌러도 그 분류만 본다
// (v3.36.2 — 예전에는 머리줄을 누르면 묶음이 **접혀** 부품이 사라졌다. 보려고 누른 것인데).
//
// 순서는 [순서 바꾸기] 를 눌렀을 때만 바꾼다 (v3.37). 예전에는 줄마다 손잡이(≡)가 있어
// 목록을 손으로 밀어 내리다 손잡이를 잡으면 순서가 바뀌었다. 이제 평소 목록에는 손잡이가
// 없고, 순서 모드에서 큰 ↑↓ 로 옮긴 뒤 [완료] 를 한 번 누른다 (품목 목록과 순서는 차량 공용).
import { api } from '../api.js';
import { isEnabled as sheetInvEnabled, pullInventory } from '../invsheet.js';
import {
  $, h, closeModal, confirmDialog, loading, openSheet, promptDialog, toast,
} from '../ui.js';

const VEHICLE_KEY = 'bh_last_vehicle';
const NONE_LABEL = '분류 없음';
const LOW = '__low';                          // 칩 [부족만]
/** 패널을 옆에 둘 만큼 넓은가. 좁으면 품목을 누를 때 창으로 띄운다. */

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
  /** 순서 모드 — null 이면 평소. { cats: [분류 키], parts: {분류 키: [부품명]}, moved: 방금 옮긴 것 } */
  let ordering = null;
  // 예전 버전이 기억해 둔 '접어 둔 분류' — 이제 접지 않으니 지운다
  try { localStorage.removeItem('bh_inv_collapsed'); } catch { /* 비공개 창 */ }

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

  /** 부품 카드 — 이름(누르면 상세 창) · 부족 표시 · 바로 −/+ */
  function itemCard(item, groupKey) {
    const low = isLow(item);
    const name = h(item.partName);
    const on = item.id === selectedId;
    return `
      <div class="inv-card${low ? ' is-low' : ''}${on ? ' is-selected' : ''}" data-id="${item.id}"
           data-group="${h(groupKey)}" data-part="${name}">
        <button class="inv-pick" data-act="select" data-id="${item.id}" type="button" aria-pressed="${on}">
          <span class="inv-pick__name">${name}</span>
          ${low ? `<span class="tag tag--low">${item.minQuantity - item.quantity}개 부족</span>` : ''}
          ${item.pending ? '<span class="tag tag-neutral">반영 대기</span>' : ''}
        </button>
        <div class="inv-step" role="group" aria-label="${name} 수량">
          <button class="inv-step__btn" data-act="dec" data-id="${item.id}" type="button"
                  aria-label="${name} 하나 빼기"${item.quantity <= 0 ? ' disabled' : ''}>−</button>
          <span class="inv-step__val"><b class="inv-qty tnum ${low ? 'is-low' : ''}" data-qty="${item.id}">${item.quantity}</b><small class="inv-min tnum">/ ${item.minQuantity}</small></span>
          <button class="inv-step__btn inv-step__btn--plus" data-act="inc" data-id="${item.id}" type="button"
                  aria-label="${name} 하나 넣기">+</button>
        </div>
      </div>`;
  }

  /**
   * 분류 머리줄 — 카드 칸을 가로질러 한 줄. 누르면 그 분류만 본다 (위 칩과 같다).
   * 그 분류만 보는 중이면 전체로. 종수와 부족 건수는 늘 보인다.
   */
  function groupHead(g) {
    const low = g.all.filter(isLow).length;
    const only = chip === g.key;
    return `
      <div class="grp-row" data-group="${h(g.key)}">
        <button class="grp-toggle" type="button" data-act="chip" data-chip="${h(g.key)}"
                aria-pressed="${only}">
          <span class="grp-name">${h(g.label)}</span>
          <span class="grp-count tnum">${g.all.length}종${low ? ` · <span class="is-low">부족 ${low}</span>` : ''}</span>
          <span class="grp-go">${only ? '전체 보기 ✕' : '이 분류만 ›'}</span>
        </button>
      </div>`;
  }

  /** 목록 자리만 만드는 조각. 검색·칩을 바꿀 때 이 부분만 다시 그린다. */
  function bodyHtml() {
    if (ordering) return orderHtml();
    const visible = visibleItems();
    if (!visible.length) {
      const why = query.trim()
        ? `'${h(query.trim())}' 에 맞는 부품이 없습니다.`
        : (chip === LOW ? '보충이 필요한 품목이 없습니다.'
          : '등록된 품목이 없습니다. [＋ 품목 추가]로 등록하세요.');
      return `<div class="empty">${why}</div>`;
    }
    const cards = groupsOf(visible)
      .map((g) => groupHead(g) + g.items.map((i) => itemCard(i, g.key)).join('')).join('');
    return `<div class="inv-grid" id="invRows">${cards}</div>`;
  }

  // ------------------------------------------------------------ 순서 바꾸기 (v3.37)
  //
  // 분류도 품목도 큰 ↑↓ 로 한 칸씩. 품목은 자기 분류 안에서만 움직인다 (분류를 바꾸는 것은
  // [수정] 창의 분류 칸으로). '분류 없음' 은 늘 맨 뒤다 (저장소 규칙). [완료] 때 한 번 저장한다.
  function startOrdering() {
    const cats = [];
    const parts = {};
    for (const i of items) {
      const k = catKey(catOf(i));
      if (!parts[k]) { parts[k] = []; if (k) cats.push(k); }
      parts[k].push(i.partName);
    }
    ordering = { cats, parts, moved: null };
    chip = null;
    query = '';
    render();
  }

  function orderHtml() {
    const arrows = (kind, key, i, last, label) => `
      <span class="ord-btns">
        <button class="ord-btn" data-act="ord-move" data-kind="${kind}" data-key="${h(key)}" data-i="${i}" data-dir="-1"
                type="button" aria-label="${h(label)} 위로"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="ord-btn" data-act="ord-move" data-kind="${kind}" data-key="${h(key)}" data-i="${i}" data-dir="1"
                type="button" aria-label="${h(label)} 아래로"${i === last ? ' disabled' : ''}>↓</button>
      </span>`;
    const moved = (kind, key, name) => {
      const m = ordering.moved;
      return m && m.kind === kind && m.key === key && (kind === 'cat' || m.name === name) ? ' is-moved' : '';
    };
    const group = (k, ci) => {
      const names = ordering.parts[k] || [];
      const label = k || NONE_LABEL;
      return `
        <div class="ord-group">
          <div class="ord-row ord-row--cat${moved('cat', k)}">
            <b class="ord-name">${h(label)} <small class="tnum">${names.length}종</small></b>
            ${k ? arrows('cat', k, ci, ordering.cats.length - 1, label) : '<small class="ord-fixed">늘 맨 뒤</small>'}
          </div>
          ${names.map((n, i) => `
            <div class="ord-row${moved('part', k, n)}">
              <span class="ord-name">${h(n)}</span>
              ${arrows('part', k, i, names.length - 1, n)}
            </div>`).join('')}
        </div>`;
    };
    const keys = [...ordering.cats, ...(ordering.parts[''] ? [''] : [])];
    return `<div class="ord-list" id="invRows">${keys.map((k, ci) => group(k, ci)).join('')}</div>`;
  }

  function moveInOrder(btn) {
    const { kind, key } = btn.dataset;
    const i = Number(btn.dataset.i);
    const j = i + Number(btn.dataset.dir);
    const list = kind === 'cat' ? ordering.cats : ordering.parts[key];
    if (!list || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    ordering.moved = { kind, key, name: kind === 'part' ? list[j] : '' };
    const row = btn.closest('.ord-row');
    const before = row ? row.getBoundingClientRect().top : 0;
    paintBody();
    // 옮긴 줄을 손가락 밑 같은 높이에 둔다 — 누를 때마다 화면이 튀면 다음 ↑↓ 를 다시 찾아야 한다
    const again = view.querySelector('.ord-row.is-moved');
    if (row && again) view.scrollTop += again.getBoundingClientRect().top - before;
  }

  async function finishOrdering(save) {
    const next = save ? [...ordering.cats, ''].flatMap((k) => ordering.parts[k] || []) : null;
    ordering = null;
    if (!next || next.join('|') === items.map((i) => i.partName).join('|')) { render(); return; }
    try {
      await api.reorderInventory(next);
      await reload();
      toast('순서를 바꿨습니다.', 'ok');
    } catch (err) { toast(err.message, 'err'); await reload(); }
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

  /** 맨 위 '보충 필요' 띠 — 누르면 부족한 것만 (v3.35). 없으면 비운다. */
  function alertHtml() {
    const low = items.filter(isLow);
    if (!low.length) return '';
    return `
      <button class="inv-alert${chip === LOW ? ' is-on' : ''}" data-act="chip" data-chip="${h(LOW)}" type="button">
        <b>보충 필요 <span class="tnum">${low.length}</span>종</b>
        <span>${h(low.slice(0, 3).map((i) => i.partName).join(' · '))}${low.length > 3 ? ' 외' : ''}</span>
        <i aria-hidden="true">${chip === LOW ? '전체 보기 ›' : '부족만 보기 ›'}</i>
      </button>`;
  }

  /**
   * 검색 중에는 화면 전체를 다시 그리지 않는다.
   * 다시 그리면 검색칸이 새로 만들어져 **글자를 한 자 칠 때마다 커서가 빠진다.**
   */
  function paintBody() {
    const body = $('#invBody');
    if (body) body.innerHTML = bodyHtml();
    const chips = $('#invChips');
    if (chips) chips.innerHTML = chipsHtml();
    const alert = $('#invAlert');
    if (alert) alert.innerHTML = alertHtml();
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
    // 상세(다른 차량 수량 · 숫자로 입력 · 수정 · 삭제)는 창으로 — 수량은 줄에서 바로 바꾼다
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const body = openSheet(item.partName, `<div class="inv-panel inv-sheet">${panelHtml(item)}</div>`);
    body.addEventListener('click', onClick);
  }

  function render() {
    // 오른쪽 패널이 없어졌으니 미리 골라 두지 않는다 (v3.35) — 고른 줄은 창을 연 줄뿐이다.
    // 보충이 필요한 것은 맨 위 '보충 필요' 띠가 알려 준다.
    if (!items.some((i) => i.id === selectedId)) selectedId = null;

    const vehicleTabs = `
      <div class="veh-tabs inv-vehicles" role="tablist" aria-label="차량">
        ${vehicles.map((v) => `
          <button class="veh-tab ${v.name === current ? 'is-active' : ''}" data-act="vehicle"
                  role="tab" aria-selected="${v.name === current}"
                  data-name="${h(v.name)}" type="button">${h(v.name)}</button>`).join('')}
        <button class="veh-tab veh-tab--manage" data-act="manage-vehicles"
                type="button" aria-label="차량 추가 · 삭제">＋ 차량</button>
      </div>`;

    // 순서 모드 — 거르기 · 수량 버튼 · 차량 탭을 치우고 ↑↓ 와 [취소] [완료] 만 둔다
    if (ordering) {
      view.innerHTML = `
        <div id="pageRoot" class="page-stack inv is-ordering">
          <div class="page-head inv-head">
            <h1 class="page-head__title">순서 바꾸기</h1>
            <span class="page-head__meta">↑ ↓ 로 옮기고 [완료] 를 누르세요 · 모든 차량에 같은 순서</span>
            <span class="page-head__spacer"></span>
            <button class="btn btn-secondary" data-act="order-cancel" type="button">취소</button>
            <button class="btn btn-primary" data-act="order-done" type="button">완료</button>
          </div>
          <section class="inv-list" id="invBody">${bodyHtml()}</section>
        </div>`;
      $('#pageRoot').addEventListener('click', onClick);
      return;
    }

    view.innerHTML = `
      <div id="pageRoot" class="page-stack inv">
        <div class="page-head inv-head">
          <h1 class="page-head__title">차량 재고</h1>
          ${vehicleTabs}
          <span class="page-head__spacer"></span>
          ${current ? `
            ${sheetMode ? `
              <button class="btn btn-secondary" data-act="sheet-refresh" type="button">시트에서 받기</button>` : ''}
            ${items.length > 1 ? '<button class="btn btn-secondary" data-act="order-start" type="button">순서 바꾸기</button>' : ''}
            <button class="btn btn-secondary" data-act="add-item" type="button">＋ 품목 추가</button>` : ''}
        </div>
        ${current ? `<div id="invAlert">${alertHtml()}</div>` : ''}

        ${current ? `
          <div class="inv-filter">
            <div class="inv-chips" id="invChips" role="group" aria-label="거르기">${chipsHtml()}</div>
            <input class="input inv-search" id="invQ" type="search"
                   placeholder="부품 찾기" aria-label="${h(current)} 부품 검색" />
          </div>
          <section class="inv-list" id="invBody">${bodyHtml()}</section>`
        : `<div class="empty">
             등록된 차량이 없습니다.<br />
             <button class="btn btn-primary" data-act="manage-vehicles" type="button"
                     style="margin-top:14px">＋ 차량 추가하기</button>
           </div>`}
      </div>`;

    $('#pageRoot').addEventListener('click', onClick);

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
    if (act === 'order-start') { startOrdering(); return; }
    if (act === 'ord-move') { moveInOrder(btn); return; }
    if (act === 'order-done') { await finishOrdering(true); return; }
    if (act === 'order-cancel') { await finishOrdering(false); return; }
    if (act === 'chip') {
      const value = btn.dataset.all ? null : btn.dataset.chip;
      chip = chip === value ? null : value;      // 켜진 칩을 다시 누르면 전체로
      paintBody();
      // 고른 분류의 첫 부품부터 보이게 — 목록을 내려 둔 채로 거르면 위쪽이 가려진다.
      // 거르기 줄은 위에 붙어 있으니 목록 첫머리가 그 아래로 오게 화면을 올린다.
      const list = $('#invBody');
      const bar = view.querySelector('.inv-filter');
      if (list && bar) {
        const gap = list.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
        if (gap < 0) view.scrollTop += gap - 8;
      }
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
        // 다른 분류만 보는 중이면 방금 넣은 품목이 안 보인다 — 거르기를 푼다
        if (chip !== null && chip !== catKey(category)) chip = null;
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
