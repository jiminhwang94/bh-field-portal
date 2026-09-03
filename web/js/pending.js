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

/** changes 를 "만듦 N · 고침 N · 지움 N" 으로 요약한다. */
function summarize(changes) {
  let created = 0; let touched = 0;
  for (const c of changes || []) {
    if (c.before === null || c.before === undefined) created += 1;
    else touched += 1;
  }
  const parts = [];
  if (created) parts.push(`새로 만듦 ${created}`);
  if (touched) parts.push(`고치거나 지움 ${touched}`);
  return parts.join(' · ') || '변경';
}

/** 대기열 한 줄을 사람이 읽을 수 있게 풀어 쓴다. */
async function describe(op) {
  if (op.type === 'sheet') {
    const report = await store.getReport(op.reportId).catch(() => null);
    return {
      title: report ? report.title : '리포트',
      what: '구글 시트에 올릴 리포트',
      goto: report ? `#/reports/${report.id}` : '#/reports',
      undoLabel: '작성 취소',
      // 아직 올리지 않은 리포트는 이 기기에만 있다. 올리기를 취소한다는 것은
      // 그 리포트를 없던 일로 하는 것 — 리포트도 함께 지운다.
      undoNote: '이 리포트를 지웁니다. 아직 시트에 올라가지 않았던 것입니다.',
    };
  }
  if (op.type === 'quantity') {
    const known = op.before !== null && op.before !== undefined;
    return {
      title: `${op.partName} · ${op.vehicleName}`,
      what: `재고 수량 ${known ? `${op.before}개 → ${op.quantity}개` : `${op.quantity}개로 설정`}`,
      goto: '#/inventory',
      undoLabel: '되돌리기',
      undoNote: known ? `수량을 ${op.before}개로 되돌립니다.` : '이 변경만 취소합니다.',
    };
  }
  if (op.type === 'quantity-delete') {
    return {
      title: `${op.partName} · ${op.vehicleName}`,
      what: '재고 품목 삭제 (수량 칸)',
      goto: '#/inventory',
      undoLabel: '올리기 취소',
      undoNote: '이 항목만 대기열에서 뺍니다. 품목 되돌리기는 [재고 구성] 줄에서 하세요.',
    };
  }
  if (op.type === 'report-status') {
    const known = op.before !== null && op.before !== undefined;
    return {
      title: `${op.sheetName} 시트 ${op.row}행`,
      what: `이력 상태 → ${op.status}`,
      goto: '#/reports',
      undoLabel: '되돌리기',
      undoNote: known ? `상태를 '${op.before}' 로 되돌립니다.` : '상태 변경을 취소합니다.',
    };
  }
  if (op.type === 'invsheet-push') {
    return { title: '재고 구성 (차량 · 품목)', what: summarize(op.changes),
             goto: '#/inventory', undoLabel: '되돌리기',
             undoNote: '차량·품목을 바꾸기 전으로 되돌립니다. 새로 만든 것은 지웁니다.' };
  }
  if (op.type === 'guidesheet-push') {
    return { title: '가이드', what: summarize(op.changes),
             goto: '#/', undoLabel: '되돌리기',
             undoNote: '가이드를 바꾸기 전으로 되돌립니다. 새로 만든 것은 지웁니다.' };
  }
  if (op.type === 'fieldsheet-push') {
    return { title: '리포트 항목 설정', what: summarize(op.changes),
             goto: '#/fields', undoLabel: '되돌리기',
             undoNote: '항목 설정을 바꾸기 전으로 되돌립니다. 새로 만든 것은 지웁니다.' };
  }
  return { title: op.type, what: '올릴 내용', goto: '', undoLabel: '취소',
           undoNote: '이 작업만 대기열에서 뺍니다.' };
}

/** changes 목록을 그대로 거꾸로 적용한다 — before 가 있으면 되살리고, 없으면 지운다. */
async function restoreRows(storeName, changes) {
  for (const c of changes || []) {
    if (c.before) await idb.put(storeName, c.before);
    else await idb.remove(storeName, c.id);
  }
}

/**
 * 대기열의 한 건을 취소한다. **바꾸기 전 내용으로 되돌린다.**
 * 새로 만든 것은 지운다 — 오프라인에서 만들고 올리기를 취소했으면
 * 그 자료가 남아 있을 이유가 없다.
 */
async function undo(op) {
  if (op.type === 'quantity' && op.before !== null && op.before !== undefined) {
    const key = store.qtyKey(op.vehicleName, op.partName);
    const row = await idb.get('quantities', key);
    if (row) await idb.put('quantities', { ...row, quantity: op.before });
  }
  if (op.type === 'sheet') {
    await store.deleteReport(op.reportId).catch(() => {});
  }
  if (op.type === 'report-status') {
    const reportsheet = await import('./reportsheet.js');
    await reportsheet.restoreStatusCache(op.sheetName, op.row, op.before);
  }
  if (op.type === 'guidesheet-push') {
    await restoreRows('guides', op.changes);
    await store.pruneOrphanMedia();
  }
  if (op.type === 'fieldsheet-push') {
    await restoreRows('fields', op.changes);
  }
  if (op.type === 'invsheet-push') {
    for (const c of op.changes || []) {
      if (c.kind === 'vehicle') {
        if (c.before) await idb.put('vehicles', c.before);
        else await idb.remove('vehicles', c.id);
        continue;
      }
      // 품목 — 재고 행과 수량 칸을 함께 되돌린다
      if (c.before) {
        const { quantity, ...row } = c.before;
        await idb.put('inventory', row);
        await idb.put('quantities', {
          key: store.qtyKey(row.vehicleName, row.partName),
          vehicleName: row.vehicleName, partName: row.partName,
          quantity: Number(quantity) || 0, updatedAt: store.now(),
        });
      } else {
        const row = await idb.get('inventory', c.id);
        await idb.remove('inventory', c.id);
        if (row) await idb.remove('quantities', store.qtyKey(row.vehicleName, row.partName));
      }
    }
    // 품목을 되살렸으니, 그 품목의 '수량 칸 지우기' 대기도 함께 뺀다.
    const restored = new Set((op.changes || [])
      .filter((c) => c.kind === 'item' && c.before)
      .map((c) => store.qtyKey(c.before.vehicleName, c.before.partName)));
    for (const other of await store.outbox()) {
      if (other.type === 'quantity-delete'
          && restored.has(store.qtyKey(other.vehicleName, other.partName))) {
        await store.dequeue(other.id);
      }
    }
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
      <strong>인터넷이 연결되면 자동으로</strong> 올라갑니다.<br />
      고칠 것이 있으면 항목을 누르고, 올리고 싶지 않으면 오른쪽 버튼을 누르세요
      — <strong>바꾸기 전으로 되돌리고, 새로 만든 것은 지웁니다.</strong>
    </p>
    <div id="pendingRows">${ops.map((op, i) => rowHtml(op, infos[i], i, false)).join('')}</div>`);

  // 되돌린 것이 있으면 시트가 **닫힐 때** 뒤 화면을 다시 그린다.
  // 되돌릴 때마다 그리면 라우터가 창을 닫아 버려(render → closeModal)
  // 두 번째 되돌리기를 할 수 없다 — 실제로 그랬다.
  let changed = false;
  const modal = body.closest('.modal');
  if (modal) {
    modal.addEventListener('click', (ev) => {
      if ((ev.target.dataset.close || ev.target.dataset.act === 'close') && changed) {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    });
  }
  function closeAndRepaint() {
    closeModal();
    if (changed) window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  function paintRows() {
    const box = body.querySelector('#pendingRows');
    if (box) box.innerHTML = ops.map((op, i) => rowHtml(op, infos[i], i, i === asking)).join('');
    const title = modal && modal.querySelector('.modal__title');
    if (title) title.textContent = `올릴 내용 ${ops.length}건`;
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
      if (info.goto && location.hash !== info.goto) location.hash = info.goto;
      else if (changed) window.dispatchEvent(new HashChangeEvent('hashchange'));
      return;
    }
    if (act === 'undo-ask') { asking = idx; paintRows(); return; }
    if (act === 'undo-no') { asking = -1; paintRows(); return; }

    if (act === 'undo-yes') {
      await undo(op);
      ops.splice(idx, 1);
      infos.splice(idx, 1);
      asking = -1;
      changed = true;
      const syncnow = await import('./syncnow.js');
      await syncnow.paint();
      toast(op.type === 'sheet' ? '리포트를 지웠습니다.' : '되돌렸습니다.', 'ok');
      if (!ops.length) { closeAndRepaint(); return; }
      paintRows();
    }
  });
}
