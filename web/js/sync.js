// 네트워크 상태와 대기열 처리.
//
// 팀이 함께 보는 원본은 **구글 시트 하나**다. 이 파일은 사무실 서버로
// 무언가를 보내지 않는다 — 예전에는 서버에도 따로 올렸는데, 시트로 이미
// 다 올라가고 있어 하는 일이 없으면서 주소를 안 넣은 기기에서는
// "서버 주소가 설정되지 않았습니다" 라는 엉뚱한 알림만 띄웠다.
//
// 오프라인에서는 모든 작업이 기기 안에서 끝나고, 온라인이 되면
// 대기열(outbox)을 구글 시트로 자동 처리한다.
import * as store from './local/store.js';
import * as idb from './local/idb.js';

const DEVICE_KEY = 'bh_device_id';

export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = 'd' + Math.random().toString(36).slice(2, 10)
      + Math.random().toString(36).slice(2, 6);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// ------------------------------------------------------------ 네트워크 상태

let online = navigator.onLine;
const listeners = new Set();

export const isOnline = () => online;

export function onNetChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(extra) {
  listeners.forEach((fn) => {
    try { fn({ online, ...extra }); }
    catch { /* 화면 갱신 실패는 무시 */ }
  });
}

window.addEventListener('online', () => {
  online = true; emit();
  // 연결되면 대기 중인 작업을 자동으로 처리한다.
  runPendingWork();
});
window.addEventListener('offline', () => {
  online = false; emit();
});

// ------------------------------------------------------------ 접속한 주소

// APK 로 설치한 앱은 화면 파일이 기기 안에 있어 이 주소로 열린다.
const APP_ASSET_ORIGIN = 'https://appassets.androidplatform.net';

export const isPackagedApp = () => location.origin === APP_ASSET_ORIGIN;

/**
 * 화면을 내려준 주소. 웹으로 접속했을 때 그 주소에서 사진을 받아오는 데만 쓴다.
 * APK 는 화면이 기기 안에 있으므로 빈 값이다 (그래도 앱은 그대로 동작한다).
 */
export async function serverBase() {
  if (isPackagedApp()) return '';
  if (location.protocol.startsWith('http')) return location.origin;
  return '';
}


class OfflineError extends Error {
  constructor(message) {
    super(message || '오프라인 상태입니다. 이 작업은 인터넷에 연결되면 처리됩니다.');
    this.offline = true;
  }
}
export { OfflineError };

// --------------------------------------------------------- 기기 안 사진 받기

/**
 * 다른 기기에서 올린 사진을 이 기기로 가져온다.
 *
 * 사진 파일 자체는 찍은 기기 안에만 있다. 웹으로 접속했을 때는 접속한 주소에서
 * 받아올 수 있으므로 그때만 쓴다. 못 받아도 앱은 그대로 동작한다.
 */
export async function fetchMediaFromHost(filename) {
  const base = await serverBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/media/${filename}`, {
      headers: { 'X-Device-Id': deviceId() }, credentials: 'include',
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ 대기열 처리

/** 쌓인 작업(리포트·재고·이력 상태·가이드)을 구글 시트에 반영한다. */
export async function flushOutbox() {
  await store.compactOutbox();
  const rows = await store.outbox();
  if (!rows.length) return { sent: 0 };

  const quantityOps = rows.filter(
    (r) => r.type === 'quantity' || r.type === 'quantity-delete');
  const sheetPushOps = rows.filter((r) => r.type === 'invsheet-push');
  const guidePushOps = rows.filter((r) => r.type === 'guidesheet-push');
  const fieldPushOps = rows.filter((r) => r.type === 'fieldsheet-push');
  const statusOps = rows.filter((r) => r.type === 'report-status');
  let sent = 0;

  // 종류마다 따로 감싼다. 한 종류가 실패해도 나머지는 계속 보내야 한다.
  // 예전에는 가이드 탭 갱신 한 번이 실패하면 밀린 리포트가 전부 막혔다.
  const failed = [];
  const step = async (label, fn) => {
    try { await fn(); } catch (err) { failed.push(`${label}: ${err.message}`); }
  };

  const onSheet = await store.sheetInventoryOn();

  // 가이드 열람용 탭 갱신 (시트 연결 시)
  if (guidePushOps.length && onSheet) {
    await step('가이드 탭', async () => {
      const guidesheet = await import('./guidesheet.js');
      await guidesheet.pushGuides();
      for (const op of guidePushOps) {
        await store.dequeue(op.id);
        sent += 1;
      }
    });
  }

  // 리포트 항목 설정 (팀 공통) — 가장 먼저 올린다.
  // 리포트보다 뒤에 올리면, 내가 바꾼 항목이 반영되기 전 옛 항목으로
  // 리포트가 올라가 시트 탭이 쓸데없이 갈라진다.
  if (fieldPushOps.length && onSheet) {
    await step('리포트 항목', async () => {
      const fieldsheet = await import('./fieldsheet.js');
      await fieldsheet.pushFields();
      for (const op of fieldPushOps) {
        await store.dequeue(op.id);
        sent += 1;
      }
    });
  }

  // 오프라인에서 바꾼 이력 상태 — 한 건씩 시트에 반영한다.
  if (statusOps.length && onSheet) {
    await step('이력 상태', async () => {
      const reportsheet = await import('./reportsheet.js');
      for (const op of statusOps) {
        await reportsheet.pushStatusOps([op]);
        await store.dequeue(op.id);
        sent += 1;
      }
    });
  }

  if (onSheet) {
    // 재고를 구글 시트로 관리 — 서버 대신 시트에 반영한다.
    if (sheetPushOps.length || quantityOps.length) {
      await step('재고', async () => {
        const invsheet = await import('./invsheet.js');
        let result;
        if (sheetPushOps.length) {
          // 구조 변경(차량·품목)이 있으면 탭 전체를 다시 쓴다 (수량도 함께 실린다).
          result = await invsheet.pushInventory();
        } else {
          result = await invsheet.pushQuantityOps(quantityOps.map((r) => ({
            type: r.type, vehicleName: r.vehicleName, partName: r.partName,
            quantity: r.quantity, updatedAt: r.updatedAt,
          })));
        }
        for (const op of [...sheetPushOps, ...quantityOps]) {
          await store.dequeue(op.id);
          sent += 1;
        }
        // 시트가 돌려준 상태가 최종 결과다 — 다른 기기의 변경도 이때 내려온다.
        if (!sheetPushOps.length && result && result.items) {
          await store.applyInventorySheet(result);
        }
      });
    }
  }
  // 시트가 연결되지 않았으면 재고 변경은 대기열에 그대로 둔다.
  // 시트를 연결하고 [⬆ 업데이트] 를 누르면 그때 한꺼번에 올라간다.

  // 시트 업로드 대기분 — 가장 중요하므로 위에서 무엇이 실패했든 반드시 시도한다.
  await step('리포트 업로드', async () => {
    const { uploadReport } = await import('./sheets.js');
    for (const row of rows.filter((r) => r.type === 'sheet')) {
      const report = await store.getReport(row.reportId);
      if (!report) { await store.dequeue(row.id); continue; }
      await uploadReport(report);
      await store.dequeue(row.id);
      sent += 1;
    }
  });

  return { sent, failed };
}

let working = false;

/** 온라인으로 돌아오면 대기열을 자동으로 처리한다. */
export async function runPendingWork() {
  if (working || !online) return null;
  working = true;
  const result = { flushed: 0, error: null };
  try {
    const flushed = await flushOutbox();
    result.flushed = flushed.sent;
  } catch (err) {
    result.error = err;
  }
  working = false;
  listeners.forEach((fn) => {
    try { fn({ online, work: result }); } catch { /* 무시 */ }
  });
  return result;
}

