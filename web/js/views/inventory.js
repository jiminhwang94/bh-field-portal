// 스타리아 차량 수동 재고 관리 (차량 추가/삭제 + 품목 수량 조절)
import { api } from '../api.js';
import { isOnline } from '../sync.js';
import { isEnabled as sheetInvEnabled, pullInventory } from '../invsheet.js';
import {
  $, h, closeModal, confirmDialog, loading, openSheet, toast,
} from '../ui.js';

const VEHICLE_KEY = 'bh_last_vehicle';

export async function inventoryView(view) {
  loading(view);
  // 시트 재고 관리 중이면 화면을 열 때 시트 내용을 먼저 받아온다.
  // (시트에서 직접 고친 차량 이름·품목·수량이 이때 반영된다)
  const sheetMode = await sheetInvEnabled();
  if (sheetMode && isOnline()) {
    try { await pullInventory(); } catch { /* 시트에 못 닿아도 기기 내용으로 표시 */ }
  }
  let vehicles = (await api.listVehicles()).items;   // [{name, itemCount}]
  let current = localStorage.getItem(VEHICLE_KEY);
  if (!vehicles.some((v) => v.name === current)) {
    current = vehicles.length ? vehicles[0].name : null;
  }
  let items = current ? (await api.listInventory(current)).items : [];
  let lowOnly = false;

  function itemRow(item) {
    const low = item.minQuantity > 0 && item.quantity <= item.minQuantity;
    return `
      <div class="item" data-id="${item.id}" style="cursor:default">
        <div class="item__body">
          <div class="item__title">${h(item.partName)}</div>
          <div class="item__sub">
            최소 보유 ${item.minQuantity} · ${h(item.updatedAt)} 수정
            ${low ? ' · <span style="color:var(--danger);font-weight:700">보충 필요</span>' : ''}
            ${item.pending ? ' · <span style="color:var(--pending);font-weight:700">⏳ 반영 대기</span>'
              : ''}
          </div>
        </div>
        <div class="qty">
          <button class="qty__btn" data-act="dec" data-id="${item.id}" type="button" aria-label="수량 감소">−</button>
          <div class="qty__val ${low ? 'is-low' : ''}" data-qty="${item.id}">${item.quantity}</div>
          <button class="qty__btn" data-act="inc" data-id="${item.id}" type="button" aria-label="수량 증가">＋</button>
        </div>
        <div class="item__actions">
          <button class="btn btn--icon btn--ghost" data-act="edit" data-id="${item.id}" type="button" aria-label="항목 수정">✏️</button>
          <button class="btn btn--icon btn--danger" data-act="del" data-id="${item.id}" type="button" aria-label="항목 삭제">🗑</button>
        </div>
      </div>`;
  }

  function render() {
    const visible = lowOnly
      ? items.filter((i) => i.minQuantity > 0 && i.quantity <= i.minQuantity)
      : items;
    const lowCount = items.filter((i) => i.minQuantity > 0 && i.quantity <= i.minQuantity).length;
    const total = items.reduce((sum, i) => sum + i.quantity, 0);

    view.innerHTML = `
      <div id="pageRoot">
        <div class="page-head">
          <h1>🚐 스타리아 차량 재고</h1>
          ${sheetMode ? `
            <p>부품 사용 즉시 [−]를 눌러 반영하세요.
              <strong>차량·품목·수량이 구글 시트(차량재고 탭)와 동기화됩니다.</strong>
              시트에서 직접 고친 내용도 이 화면을 열 때 반영됩니다.</p>`
          : `
            <p>부품 사용 즉시 [−]를 눌러 반영하세요.
              <strong>수량은 모든 사용자에게 바로 공유됩니다.</strong>
              품목·차량 추가/삭제는 상단 <strong>[⬆️ 업데이트]</strong> 후 공유됩니다.</p>`}
        </div>

        <div class="veh-tabs">
          ${vehicles.map((v) => `
            <button class="veh-tab ${v.name === current ? 'is-active' : ''}" data-act="vehicle"
                    data-name="${h(v.name)}" type="button">${h(v.name)}</button>`).join('')}
          <button class="veh-tab veh-tab--manage" data-act="manage-vehicles"
                  type="button">🚐 차량 관리</button>
        </div>

        ${current ? `
          <div class="row row--between" style="margin-bottom:14px">
            <div class="row" style="gap:8px">
              <span class="badge">품목 ${items.length}종</span>
              <span class="badge">총 ${total}개</span>
              ${lowCount ? `<span class="badge badge--danger">보충 필요 ${lowCount}</span>`
                : '<span class="badge badge--ok">재고 정상</span>'}
              ${sheetMode ? '<span class="badge">📊 시트 연동</span>' : ''}
            </div>
            <div class="row" style="gap:8px">
              ${sheetMode ? `
                <button class="btn btn--ghost btn--sm" data-act="sheet-refresh"
                        type="button">🔄 시트에서 받기</button>` : ''}
              <button class="btn btn--sm filter-toggle ${lowOnly ? 'is-on' : ''}"
                      data-act="toggle-low" type="button"
                      aria-pressed="${lowOnly}">부족 항목만</button>
              <button class="btn btn--primary btn--sm" data-act="add-item" type="button">＋ 품목 추가</button>
            </div>
          </div>

          <div class="list">
            ${visible.length ? visible.map(itemRow).join('')
              : `<div class="empty">${lowOnly ? '보충이 필요한 품목이 없습니다.'
                : '등록된 품목이 없습니다. [＋ 품목 추가]로 등록하세요.'}</div>`}
          </div>`
        : `<div class="empty">
             등록된 차량이 없습니다.<br />
             <button class="btn btn--primary" data-act="manage-vehicles" type="button"
                     style="margin-top:14px">🚐 차량 추가하기</button>
           </div>`}
      </div>`;

    $('#pageRoot').addEventListener('click', onClick);
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
    if (act === 'toggle-low') { lowOnly = !lowOnly; render(); return; }
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
      item.quantity += delta;
      const cell = $(`[data-qty="${id}"]`);
      cell.textContent = item.quantity;
      cell.classList.toggle('is-low', item.minQuantity > 0 && item.quantity <= item.minQuantity);
      try {
        const updated = await api.patchInventory(id, { delta });
        item.quantity = updated.quantity;
        item.pending = updated.pending;
        cell.textContent = updated.quantity;
        render();          // 상단 요약(총 개수·반영 대기 표시)도 함께 갱신
      } catch (err) {
        item.quantity -= delta;
        cell.textContent = item.quantity;
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
                    data-name="${h(v.name)}" type="button">🗑 삭제</button>
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
    const body = openSheet(item ? '품목 수정' : '품목 추가', `
      <form id="invForm">
        <div class="field">
          <label>부품명<span class="req">*</span></label>
          <input class="input" id="invName" value="${h(item ? item.partName : '')}" placeholder="예) 그리퍼 실리콘 패드" />
        </div>
        <div class="grid-2">
          <div class="field">
            <label>현재 수량</label>
            <input class="input" id="invQty" type="number" min="0" inputmode="numeric" value="${item ? item.quantity : 0}" />
          </div>
          <div class="field">
            <label>최소 보유 수량</label>
            <input class="input" id="invMin" type="number" min="0" inputmode="numeric" value="${item ? item.minQuantity : 0}" />
            <span class="hint">이 수량 이하가 되면 [보충 필요]로 표시됩니다.
              (최소 보유 수량 변경은 [업데이트] 대상)</span>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-act="close">취소</button>
          <button class="btn btn--primary" type="submit">저장</button>
        </div>
      </form>`);

    $('#invName', body).focus();
    $('#invForm', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const partName = $('#invName', body).value.trim();
      const quantity = Number($('#invQty', body).value || 0);
      const minQuantity = Number($('#invMin', body).value || 0);
      if (!partName) { toast('부품명을 입력하세요.', 'err'); return; }
      try {
        if (item) {
          await api.patchInventory(item.id, { partName, quantity, minQuantity });
        } else {
          await api.addInventory({ vehicleName: current, partName, quantity, minQuantity });
        }
        closeModal();
        toast('저장했습니다.', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  render();
}
