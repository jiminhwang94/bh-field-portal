// [올릴 내용 N건] — 무엇이 아직 안 올라갔는지 보여 주고, 하나씩 고치거나 취소한다.
//
// 예전에는 숫자만 떴다. 무엇이 밀려 있는지 알 수 없어서, 고칠 것이 있어도
// 어디로 가야 할지 몰랐고 잘못 눌러 쌓인 것도 지울 수 없었다.
//
// 취소(삭제)는 **되돌리기**다. 그 변경을 없던 일로 하고 **바꾸기 전 내용**을
// 그대로 남긴다. 자료를 지우는 것이 아니다.
import * as store from './local/store.js';
import * as idb from './local/idb.js';
import { closeModal, h, openSheet, toast, when } from './ui.js';

/** 대기열 한 줄을 사람이 읽을 수 있게 풀어 쓴다. */
async function describe(op) {
  if (op.type === 'sheet') {
    const report = await store.getReport(op.reportId).catch(() => null);
    return {
      title: report ? report.title : '리포트',
      what: '구글 시트에 올릴 리포트',
      goto: report ? `#/reports/${report.id}` : '#/reports',
      undoLabel: '올리기 취소',
      undoNote: '리포트는 기기에 그대로 남습니다. 나중에 다시 올릴 수 있습니다.',
    };
  }
  if (op.type === 'quantity') {
    const moved = op.before === null || op.before === undefined
      ? `${op.quantity}개로 설정`
      : `${op.before}개 → ${op.quantity}개`;
    return {
      title: `${op.partName} · ${op.vehicleName}`,
      what: `재고 수량 ${moved}`,
      goto: '#/inventory',
      undoLabel: '되돌리기',
      undoNote: op.before === null || op.before === undefined
        ? '이 변경만 취소합니다.'
        : `수량을 ${op.before}개로 되돌립니다.`,
    };
  }
  if (op.type === 'quantity-delete') {
    return {
      title: `${op.partName} · ${op.vehicleName}`,
      what: '재고 품목 삭제',
      goto: '#/inventory',
      undoLabel: '올리기 취소',
      undoNote: '시트에서 지우지 않습니다. 기기 화면은 그대로입니다.',
    };
  }
  if (op.type === 'report-status') {
    return {
      title: `${op.sheetName} 시트 ${op.row}행`,
      what: `이력 상태 → ${op.status}`,
      goto: '#/reports',
      undoLabel: '되돌리기',
      undoNote: '상태 변경을 취소합니다. 시트의 값은 그대로입니다.',
    };
  }
  if (op.type === 'invsheet-push') {
    return { title: '재고 전체', what: '차량·품목 구성을 시트에 반영',
             goto: '#/inventory', undoLabel: '올리기 취소',
             undoNote: '기기 화면은 그대로입니다. 시트에만 반영하지 않습니다.' };
  }
  if (op.type === 'guidesheet-push') {
    return { title: '가이드 전체', what: '가이드를 시트에 반영',
             goto: '#/', undoLabel: '올리기 취소',
             undoNote: '기기 화면은 그대로입니다. 시트에만 반영하지 않습니다.' };
  }
  return { title: op.type, what: '올릴 내용', goto: '', undoLabel: '취소',
           undoNote: '이 작업만 대기열에서 뺍니다.' };
}

/**
 * 대기열의 한 건을 취소한다. **바꾸기 전 내용으로 되돌린다.**
 * 자료 자체를 지우지는 않는다.
 */
async function undo(op) {
  if (op.type === 'quantity' && op.before !== null && op.before !== undefined) {
    // 수량을 바꾸기 전 값으로 되돌린다. 되돌리는 것 자체는 새 대기 건을
    // 만들지 않는다 — 시트는 아직 이 변경을 받지 못했으므로 맞출 것이 없다.
    const key = store.qtyKey(op.vehicleName, op.partName);
    const row = await idb.get('quantities', key);
    if (row) await idb.put('quantities', { ...row, quantity: op.before });
  }
  if (op.type === 'sheet') {
    // 리포트는 남기고 '올리는 중' 표시만 되돌린다.
    await store.markReport(op.reportId, { status: 'DRAFT', errorMessage: null })
      .catch(() => {});
  }
  await store.dequeue(op.id);
}

/**
 * 한 줄. 되돌리기는 **그 줄 안에서** 한 번 더 묻는다.
 * 창을 또 띄우면 이 시트를 덮어써서 둘 다 사라진다 (실제로 그랬다).
 */
function rowHtml(op, info, idx, asking) {
  return `
    <div class="row" data-idx="${idx}"
         style="align-items:flex-start;gap:var(--space-3);padding:var(--space-3) 0;
                border-bottom:1px solid var(--color-border);flex-wrap:nowrap">
      <button class="row__main" data-act="goto" data-idx="${idx}" type="button"
              style="flex:1;min-width:0;text-align:left">
        <span class="row__title">${h(info.title)}</span>
        <span class="row__meta">${h(info.what)}</span>
        <span class="row__meta">${h(when(op.queuedAt))}${asking ? ` · ${h(info.undoNote)}` : ''}</span>
      </button>
      ${asking ? `
        <button class="btn btn-secondary" data-act="undo-no" data-idx="${idx}"
                type="button">그대로 두기</button>
        <button class="btn btn-primary" data-act="undo-yes" data-idx="${idx}"
                type="button">${h(info.undoLabel)}</button>`
      : `
        <button class="btn btn-secondary" data-act="undo-ask" data-idx="${idx}"
                type="button">${h(info.undoLabel)}</button>`}
    </div>`;
}

/** [올릴 내용] 목록을 연다. */
export async function openPendingList() {
  await store.compactOutbox();
  const ops = await store.outbox();
  ops.sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')));

  if (!ops.length) {
    toast('올릴 내용이 없습니다. 시트와 같은 상태입니다.', 'ok');
    return;
  }

  const infos = [];
  for (const op of ops) infos.push(await describe(op));

  let asking = -1;                 // 지금 되묻고 있는 줄

  const body = openSheet(`올릴 내용 ${ops.length}건`, `
    <p class="muted" style="margin:0 0 var(--space-3);line-height:1.6">
      아직 구글 시트에 올라가지 않은 것들입니다.
      <strong>[⬆ 업데이트]</strong> 를 누르면 한꺼번에 올라갑니다.<br />
      고칠 것이 있으면 항목을 누르고, 올리고 싶지 않으면 오른쪽 버튼을 누르세요
      — <strong>취소해도 기기의 내용은 그대로 남습니다.</strong>
    </p>
    <div id="pendingRows">${ops.map((op, i) => rowHtml(op, infos[i], i, false)).join('')}</div>`);

  function paintRows() {
    const box = body.querySelector('#pendingRows');
    if (box) box.innerHTML = ops.map((op, i) => rowHtml(op, infos[i], i, i === asking)).join('');
  }

  body.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const idx = Number(btn.dataset.idx);
    const op = ops[idx];
    const info = infos[idx];
    if (!op) return;

    if (act === 'goto') {
      closeModal();
      if (info.goto) location.hash = info.goto;
      return;
    }
    if (act === 'undo-ask') { asking = idx; paintRows(); return; }
    if (act === 'undo-no') { asking = -1; paintRows(); return; }

    if (act === 'undo-yes') {
      await undo(op);
      ops.splice(idx, 1);
      infos.splice(idx, 1);
      asking = -1;
      const syncnow = await import('./syncnow.js');
      await syncnow.paint();
      toast('취소했습니다. 기기의 내용은 그대로입니다.', 'ok');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      if (!ops.length) { closeModal(); return; }
      paintRows();
    }
  });
}
