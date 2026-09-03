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
  // 시트에서 받아오는 데 몇 초가 걸린다. 그 동안 빈 화면을 보고 기다리지 않도록
  // **기기에 있는 내용을 먼저 그려 두고**, 시트는 뒤에서 받아 조용히 다시 그린다.
  // (시트에서 직접 고친 차량 이름·품목·수량은 받아온 뒤에 반영된다)
  const sheetMode = await sheetInvEnabled();
  let vehicles = (await api.listVehicles()).items;   // [{name, itemCount}]
  let current = localStorage.getItem(VEHICLE_KEY);
  if (!vehicles.some((v) => v.name === current)) {
    current = vehicles.length ? vehicles[0].name : null;
  }
  let items = current ? (await api.listInventory(current)).items : [];
  let lowOnly = false;

  /** 표의 한 줄. 디자인의 `.table--touch` 구조를 그대로 쓴다. */
  function itemRow(item) {
    const low = item.minQuantity > 0 && item.quantity <= item.minQuantity;
    const name = h(item.partName);
    return `
      <tr data-id="${item.id}">
        <td>
          ${name}
          ${item.pending ? '<span class="tag tag-neutral">반영 대기</span>' : ''}
        </td>
        <td class="tnum ${low ? 'is-low' : ''}" style="text-align:right">${item.quantity}</td>
        <td class="tnum" style="text-align:right">${item.minQuantity}</td>
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

  function render() {
    const visible = lowOnly
      ? items.filter((i) => i.minQuantity > 0 && i.quantity <= i.minQuantity)
      : items;
    const lowCount = items.filter((i) => i.minQuantity > 0 && i.quantity <= i.minQuantity).length;

    view.innerHTML = `
      <div id="pageRoot" class="screen">
        <div class="page-head">
          <h1 class="page-head__title">차량 재고</h1>
          <span class="page-head__meta">수량은 [⬆ 업데이트] 없이 즉시 공유됩니다</span>
          <span class="page-head__spacer"></span>
          ${current ? `
            ${sheetMode ? `
              <button class="btn btn-secondary" data-act="sheet-refresh" type="button">시트에서 받기</button>` : ''}
            <button class="btn btn-secondary ${lowOnly ? 'is-active' : ''}" data-act="toggle-low"
                    type="button" aria-pressed="${lowOnly}">부족 항목만</button>
            <button class="btn btn-primary" data-act="add-item" type="button">＋ 품목 추가</button>` : ''}
        </div>

        <div class="veh-tabs">
          ${vehicles.map((v) => `
            <button class="veh-tab ${v.name === current ? 'is-active' : ''}" data-act="vehicle"
                    data-name="${h(v.name)}" type="button">${h(v.name)}</button>`).join('')}
          <button class="veh-tab" data-act="manage-vehicles" type="button"
                  style="color:var(--color-accent-700)">＋ 차량</button>
        </div>

        ${current ? `
          <div class="scroll">
            ${visible.length ? `
              <table class="table table--touch">
                <thead>
                  <tr>
                    <th>부품</th>
                    <th style="text-align:right">보유</th>
                    <th style="text-align:right">최소보유</th>
                    <th style="text-align:right">수량 조절</th>
                    <th style="text-align:right">항목</th>
                  </tr>
                </thead>
                <tbody>${visible.map(itemRow).join('')}</tbody>
              </table>`
              : `<div class="empty">${lowOnly ? '보충이 필요한 품목이 없습니다.'
                : '등록된 품목이 없습니다. [＋ 품목 추가]로 등록하세요.'}</div>`}
          </div>

          <div class="page-head">
            <span class="page-head__meta">
              ${lowCount ? `보충 필요 <span class="tnum is-low">${lowCount}</span>건 · ` : ''}최소보유 이하는 강조 표시됩니다
            </span>
            <span class="page-head__spacer"></span>
            <span class="tag tag-neutral">${sheetMode ? '시트 연결됨' : '기기에만 저장'} · 품목 ${items.length}종</span>
          </div>`
        : `<div class="empty">
             등록된 차량이 없습니다.<br />
             <button class="btn btn-primary" data-act="manage-vehicles" type="button"
                     style="margin-top:14px">＋ 차량 추가하기</button>
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

  /** 수량 칸 하나만 고쳐 그린다. 칸이 없으면 아무 일도 하지 않는다. */
  function paintQty(item) {
    const cell = view.querySelector(`[data-qty="${item.id}"]`);
    if (!cell) return;
    cell.textContent = item.quantity;
    cell.classList.toggle('is-low',
      item.minQuantity > 0 && item.quantity <= item.minQuantity);
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
          // **손대지 않은 칸은 보내지 않는다.** 최소보유만 고쳤는데 보유 수량까지
          // 함께 보내면, 창을 연 사이에 바뀐 실제 수량을 창에 적혀 있던 옛 값으로
          // 덮어쓴다. 실제로 보유 수량이 엉뚱하게 바뀌는 일이 있었다.
          const patch = { partName, minQuantity };
          if (quantity !== item.quantity) patch.quantity = quantity;
          await api.patchInventory(item.id, patch);
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

  // 화면이 이미 보이는 상태에서 시트를 받아온다. 받고 나서 달라진 게 있으면
  // 그때 다시 그린다. 사용자는 기다리지 않는다.
  if (sheetMode && isOnline()) {
    (async () => {
      try { await pullInventory(); } catch { return; }   // 못 닿으면 기기 내용 그대로
      const fresh = (await api.listVehicles()).items;
      if (!fresh.some((v) => v.name === current)) {
        current = fresh.length ? fresh[0].name : null;
      }
      const freshItems = current ? (await api.listInventory(current)).items : [];
      // 그 사이 다른 화면으로 넘어갔거나, 사용자가 창을 열어 놓고 무언가
      // 적는 중이면 손대지 않는다. 다시 그리면 적던 내용이 날아간다.
      if (!view.querySelector('#pageRoot')) return;
      if (document.getElementById('modalRoot').innerHTML) return;
      vehicles = fresh;
      items = freshItems;
      render();
    })();
  }
}
