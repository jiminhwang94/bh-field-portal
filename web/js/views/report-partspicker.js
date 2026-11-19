// 새 리포트 — 사용 부품 고르기 (v3.49: report.js 에서 옮김)
//
// 칸에는 넣은 부품 알약만, [부품 추가] 창에서 차량 · 분류 · 수량을 고른다.
// 새 리포트를 올릴 때 한 번만 고른 부품을 내 차량 재고에서 뺀다.
// 화면 상태는 get · set 두 개로만 만진다 (리포트 칸의 글자 '그리퍼 패드 ×2, 퓨즈').
import { api } from '../api.js';
import { $, h, openSheet, toast } from '../ui.js';
import { parseParts, partsText } from '../insights.js';

const MY_VEHICLE_KEY = 'bh_my_vehicle';

/**
 * @param {{ inventory: any[], partsField: any, editing: boolean, get: () => string, set: (text: string) => void }} ctx
 */
export function partsPicker({ inventory, partsField, editing, get, set }) {
  function myVehicle() {
    const names = [...new Set(inventory.map((i) => i.vehicleName))];
    const saved = localStorage.getItem(MY_VEHICLE_KEY);
    return names.includes(saved) ? saved : names[0] || '';
  }
  // ─── 사용 부품 (B안) — 칸에는 넣은 부품 알약만, [부품 추가] 창에서 분류 · 수량을 고른다
  const PART_CATS_KEY = 'bh_report_part_cats';     // 리포트에 보일 재고 분류 (기기마다)
  const NO_CAT = '분류 없음';
  let sheetCat = '';
  let catPicking = false;
  const catOf = (i) => String(i.category || '').trim() || NO_CAT;
  function allCats() {
    const out = [];
    for (const i of inventory) if (!out.includes(catOf(i))) out.push(catOf(i));
    return out;
  }
  /** 내가 고른 분류. 아직 안 골랐으면 전부 */
  function shownCats() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(PART_CATS_KEY) || '[]') || []; } catch { saved = []; }
    const all = allCats();
    const mine = all.filter((c) => saved.includes(c));
    return mine.length ? mine : all;
  }
  function chosenParts() {
    return parseParts(get());
  }
  function setParts(list) {
    set(partsText(list.filter((x) => x.n > 0)));
    const input = /** @type {HTMLInputElement} */ (document.querySelector(`#reportForm [data-input="${partsField.id}"]`));
    if (input) input.value = get();
    paintPartsHelper();
  }
  function changePart(name, delta) {
    const list = chosenParts();
    const hit = list.find((x) => x.name === name);
    if (hit) hit.n = Math.max(0, hit.n + delta);
    else if (delta > 0) list.push({ name, n: delta });
    setParts(list);
  }
  /** 칸 — 넣은 부품 알약(✕ 로 빼기) + [부품 추가] */
  function paintPartsHelper() {
    const box = $('#partsHelper');
    if (!box || !partsField) return;
    const list = chosenParts();
    box.innerHTML = `
      <div class="parts-field">
        ${list.map((x) => `
          <span class="part-pill">${h(x.name)}${x.n > 1 ? ` <b class="tnum">×${x.n}</b>` : ''}
            <button class="part-pill__x" data-act="part-remove" data-part="${h(x.name)}" type="button"
                    aria-label="${h(x.name)} 빼기">✕</button></span>`).join('')}
        <button class="parts-add" data-act="open-parts" type="button">＋ 부품 추가</button>
      </div>
      ${list.length ? `<span class="hint">올리면 ${h(myVehicle())} 재고에서 뺍니다</span>` : ''}`;
    const sheetBody = document.getElementById('partsSheet');
    if (sheetBody) paintPartsSheet(sheetBody);
  }
  /** [부품 추가] 창 — 차량 · 분류 탭(고른 것만) · 품목마다 −/+ · 목록에 없는 부품 */
  function paintPartsSheet(body) {
    const vehicles = [...new Set(inventory.map((i) => i.vehicleName))];
    const car = myVehicle();
    const cats = shownCats();
    if (!cats.includes(sheetCat)) sheetCat = cats[0] || '';
    const counts = new Map(chosenParts().map((x) => [x.name, x.n]));
    const items = inventory.filter((i) => i.vehicleName === car && catOf(i) === sheetCat);
    const picked = (c) => inventory.some((i) => i.vehicleName === car && catOf(i) === c && counts.get(i.partName));
    body.innerHTML = `
      ${vehicles.length > 1 ? `<div class="ps-row">
        ${vehicles.map((v) => `<button class="ps-chip${v === car ? ' is-on' : ''}" data-act="pick-car" data-car="${h(v)}" type="button">${h(v)}</button>`).join('')}
      </div>` : `<p class="muted ps-car">${h(car)} 재고</p>`}
      ${catPicking ? `
        <div class="ps-cats">
          <p class="muted">리포트에 보일 분류를 고르세요 · 이 기기에만 저장됩니다</p>
          ${allCats().map((c) => `
            <label class="ps-check"><input type="checkbox" data-act="toggle-cat" data-cat="${h(c)}"
              ${shownCats().includes(c) && localStorage.getItem(PART_CATS_KEY) ? 'checked' : ''} /> ${h(c)}</label>`).join('')}
          <button class="btn btn-secondary btn--sm" data-act="cats-done" type="button">선택</button>
        </div>` : `
        <div class="ps-tabs" role="tablist">
          ${cats.map((c) => `<button class="ps-tab${c === sheetCat ? ' is-on' : ''}" data-act="part-cat" data-cat="${h(c)}"
              role="tab" aria-selected="${c === sheetCat}" type="button">${h(c)}${picked(c) ? ' <i aria-hidden="true">●</i>' : ''}</button>`).join('')}
          <button class="ps-gear" data-act="cats-pick" type="button">보일 분류 고르기</button>
        </div>
        <div class="ps-list">
          ${items.length ? items.map((i) => {
            const n = counts.get(i.partName) || 0;
            const over = n > i.quantity;
            return `
              <div class="ps-item${n ? ' is-on' : ''}">
                <span class="ps-item__name">${h(i.partName)}
                  <small class="${over ? 'ps-over' : 'muted'}">재고 ${i.quantity}${over ? ' · 재고보다 많음' : ''}</small></span>
                <span class="ps-step">
                  <button data-act="part-dec" data-part="${h(i.partName)}" type="button" aria-label="${h(i.partName)} 하나 빼기" ${n ? '' : 'disabled'}>−</button>
                  <b class="tnum">${n}</b>
                  <button data-act="part-inc" data-part="${h(i.partName)}" type="button" aria-label="${h(i.partName)} 하나 넣기">+</button>
                </span>
              </div>`;
          }).join('') : '<p class="muted">이 분류에 품목이 없습니다.</p>'}
        </div>
        <div class="ps-free">
          <input class="input" id="partFree" placeholder="목록에 없는 부품 이름" autocomplete="off" />
          <button class="btn btn-secondary" data-act="part-free" type="button">넣기</button>
        </div>`}
      <button class="btn btn-primary btn--block" data-act="close" type="button">추가</button>`;
  }
  function openPartsSheet() {
    catPicking = false;
    openSheet('부품 추가', '<div id="partsSheet" class="parts-sheet"></div>');
    const body = document.getElementById('partsSheet');
    paintPartsSheet(body);
    body.addEventListener('click', (ev) => {
      const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-act]'));
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'pick-car') { localStorage.setItem(MY_VEHICLE_KEY, btn.dataset.car); paintPartsHelper(); }
      if (act === 'part-cat') { sheetCat = btn.dataset.cat; paintPartsSheet(body); }
      if (act === 'part-inc') changePart(btn.dataset.part, 1);
      if (act === 'part-dec') changePart(btn.dataset.part, -1);
      if (act === 'cats-pick') { catPicking = true; paintPartsSheet(body); }
      if (act === 'cats-done') { catPicking = false; paintPartsSheet(body); }
      if (act === 'part-free') {
        const inp = /** @type {HTMLInputElement} */ (document.getElementById('partFree'));
        const name = inp.value.trim();
        if (name) changePart(name, 1);
      }
    });
    body.addEventListener('change', (ev) => {
      const box = /** @type {HTMLInputElement} */ (ev.target);
      if (box.dataset.act !== 'toggle-cat') return;
      const on = [...body.querySelectorAll('[data-act="toggle-cat"]')]
        .filter((x) => /** @type {HTMLInputElement} */ (x).checked).map((x) => /** @type {HTMLElement} */ (x).dataset.cat);
      try {
        if (on.length) localStorage.setItem(PART_CATS_KEY, JSON.stringify(on));
        else localStorage.removeItem(PART_CATS_KEY);       // 하나도 안 고르면 전부 보인다
      } catch { /* 이번만 */ }
    });
  }
  /** 새 리포트를 올릴 때 한 번만 — 고른 부품을 내 차량 재고에서 뺀다 */
  async function deductParts(reportId) {
    if (!partsField || editing) return;
    const doneKey = `bh_parts_done_${reportId}`;
    if (localStorage.getItem(doneKey)) return;
    const car = myVehicle();
    const used = parseParts(get());
    const moved = [];
    let low = 0;
    for (const p of used) {
      const item = inventory.find((i) => i.vehicleName === car && i.partName === p.name);
      if (!item) continue;
      const updated = await api.patchInventory(item.id, { delta: -p.n }).catch(() => null);
      if (!updated) continue;
      moved.push(`${p.name} ×${p.n}`);
      if (item.minQuantity > 0 && updated.quantity < item.minQuantity) low += 1;
    }
    localStorage.setItem(doneKey, '1');
    if (moved.length) {
      window.dispatchEvent(new Event('bh-inventory-changed'));
      toast(`재고에서 뺐습니다 (${car}): ${moved.join(', ')}${low ? ` · 보충 필요 ${low}건` : ''}`, 'ok');
    }
  }

  return { paintPartsHelper, openPartsSheet, deductParts, chosenParts, setParts };
}
