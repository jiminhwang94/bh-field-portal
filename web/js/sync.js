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

// ------------------------------------------------- 올리기 · 받기 순서 지키기
//
// 올리기(flush)와 받기(pull)는 **겹쳐 돌지 않는다.**
//
// 겹치면 받기가 "내가 올리기 직전의 시트" 를 읽어 와 기기에 덮는다. 그러면
// 방금 지운 품목·가이드가 기기에 되살아나고, 다음 올리기 때 그 되살아난 것이
// 다시 시트로 올라가 **삭제가 영영 사라졌다** ([새로고침] 을 눌러도 지운 게
// 다시 생기던 원인). 올리기끼리 겹쳐도 같은 리포트가 두 줄 올라갔다.
//
//  - 올리기는 한 번에 하나. 도는 중에 또 부르면 끝난 뒤 한 번만 더 돈다.
//  - 받기끼리는 함께 돌아도 된다 (서로 다른 탭이다). 올리기가 돌거나 기다리는
//    중이면 그게 끝난 뒤에 시작하고, 올리기는 도는 중인 받기를 기다렸다 시작한다.
let flushRun = null;       // 도는 중이거나 차례를 기다리는 올리기
let queuedFlush = null;    // 아직 시작하지 않은 다음 올리기 (여러 번 불러도 하나)
const pulls = new Set();

export function flushOutbox() {
  if (queuedFlush) return queuedFlush;
  const prev = flushRun || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    queuedFlush = null;    // 시작했다 — 지금부터 부르면 다음 차례가 된다
    await Promise.allSettled([...pulls]);
    return doFlushOutbox();
  });
  queuedFlush = run;
  flushRun = run;
  run.catch(() => {}).finally(() => { if (flushRun === run) flushRun = null; });
  return run;
}

/** 시트에서 받아 기기에 반영하는 일을 올리기와 겹치지 않게 돌린다. */
export async function sheetRead(fn) {
  while (flushRun) await flushRun.catch(() => {});
  const run = (async () => fn())();
  pulls.add(run);
  try { return await run; } finally { pulls.delete(run); }
}

// ------------------------------------------------------------ 대기열 처리

/** 쌓인 작업(리포트·재고·이력 상태·가이드)을 구글 시트에 반영한다. */
async function doFlushOutbox() {
  await store.compactOutbox();
  const rows = await store.outbox();
  if (!rows.length) {
    // 올릴 것이 없으면 지난 실패 표시도 지운다 — 남겨 두면 "올리지 못한 것 0건"
    // 이라는 말이 안 되는 칩이 계속 떠 있다 (실제로 그랬다).
    await store.setMeta('flushFailed', '');
    return { sent: 0, failed: [] };
  }

  const quantityOps = rows.filter(
    (r) => r.type === 'quantity' || r.type === 'quantity-delete');
  const sheetPushOps = rows.filter((r) => r.type === 'invsheet-push');
  const guidePushOps = rows.filter((r) => r.type === 'guidesheet-push');
  const fieldPushOps = rows.filter((r) => r.type === 'fieldsheet-push');
  const drivePushOps = rows.filter((r) => r.type === 'drivesheet-push');
  const workOps = rows.filter((r) => r.type === 'worklist-push');
  const driveOptionOps = rows.filter((r) => r.type === 'drivesheet-options');
  const statusOps = rows.filter((r) => r.type === 'report-status');
  let sent = 0;

  // 종류마다 따로 감싼다. 한 종류가 실패해도 나머지는 계속 보내야 한다.
  // 예전에는 가이드 탭 갱신 한 번이 실패하면 밀린 리포트가 전부 막혔다.
  const failed = [];
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      failed.push(`${label}: ${err.message}`);
      // 오프라인은 오류가 아니다. 그 밖의 실패는 시트 '오류기록' 탭으로 간다.
      if (!(err && err.offline)) {
        import('./errlog.js').then((e) => e.recordError(`올리기 실패 — ${label}`, err.message)).catch(() => {});
      }
    }
  };

  const onSheet = await store.sheetInventoryOn();
  // 탭을 통째로 쓰는 종류는 "무엇을 바꿨는지" 를 함께 넘겨 시트 것과 합치게 한다.
  const changesOf = (ops) => ops.flatMap((o) => o.changes || []);

  // 가이드 열람용 탭 갱신 (시트 연결 시)
  if (guidePushOps.length && onSheet) {
    await step('가이드 탭', async () => {
      const guidesheet = await import('./guidesheet.js');
      await guidesheet.pushGuides(changesOf(guidePushOps));
      for (const op of guidePushOps) {
        await store.dequeue(op.id);
        sent += 1;
      }
    });
  }

  // 이슈 유형 목록 (팀 공통) — 바뀐 것(ops)만 차례대로 한 번에. 시트가 돌려준 목록이 최종본이다.
  if (workOps.length && onSheet) {
    await step('이슈 유형 목록', async () => {
      const worksheet = await import('./worksheet.js');
      const result = await worksheet.pushWorkOps(workOps.flatMap((o) => o.ops || []));
      for (const op of workOps) {
        await store.dequeue(op.id);
        sent += 1;
      }
      if (result && Array.isArray(result.cats)) await store.setWorkFromSheet(result);
    });
  }

  // 리포트 항목 설정 (팀 공통) — 가장 먼저 올린다.
  // 리포트보다 뒤에 올리면, 내가 바꾼 항목이 반영되기 전 옛 항목으로
  // 리포트가 올라가 시트 탭이 쓸데없이 갈라진다.
  if (fieldPushOps.length && onSheet) {
    await step('리포트 항목', async () => {
      const fieldsheet = await import('./fieldsheet.js');
      await fieldsheet.pushFields(changesOf(fieldPushOps));
      for (const op of fieldPushOps) {
        await store.dequeue(op.id);
        sent += 1;
      }
    });
  }

  // 운행일지 선택지(부서·장소) — 일지보다 먼저 올린다.
  // 뒤에 올리면 새로 만든 부서가 아직 시트에 없는 채로 일지가 올라간다.
  if (driveOptionOps.length && onSheet) {
    await step('운행일지 항목', async () => {
      const drivesheet = await import('./drivesheet.js');
      const last = driveOptionOps[driveOptionOps.length - 1];
      await drivesheet.pushOptions({ depts: last.depts, places: last.places });
      for (const op of driveOptionOps) {
        await store.dequeue(op.id);
        sent += 1;
      }
    });
  }

  // 운행일지 — 차량마다 탭이 다르므로 차량별로 묶어 한 번씩 올린다.
  if (drivePushOps.length && onSheet) {
    const byVehicle = new Map();
    for (const op of drivePushOps) {
      const name = op.vehicleName || '';
      if (!byVehicle.has(name)) byVehicle.set(name, []);
      byVehicle.get(name).push(op);
    }
    for (const [name, ops] of byVehicle) {
      await step(`운행일지 ${name}`, async () => {
        const drivesheet = await import('./drivesheet.js');
        await drivesheet.pushDriving(name, ops.flatMap((o) => o.changes || []));
        for (const op of ops) {
          await store.dequeue(op.id);
          sent += 1;
        }
      });
    }
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
          result = await invsheet.pushInventory(changesOf(sheetPushOps));
        } else {
          // before · opId — 시트가 '바뀐 만큼' 만 더해 다른 기기 변경과 합친다.
          result = await invsheet.pushQuantityOps(quantityOps.map((r) => ({
            type: r.type, vehicleName: r.vehicleName, partName: r.partName,
            quantity: r.quantity, updatedAt: r.updatedAt, before: r.before, opId: r.opId,
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

  // 실패가 있으면 기억해 둔다 — 상단 칩은 **이때만** 눈에 띄게 보인다.
  // 올리기는 자동이라 정상일 때는 숫자를 보일 이유가 없다.
  await store.setMeta('flushFailed', failed.length ? failed[0] : '');
  // 모아 둔 오류를 시트로 (실패해도 다음에 다시)
  if (onSheet) {
    try { await (await import('./errlog.js')).flushErrors(); } catch { /* 다음 기회에 */ }
  }
  return { sent, failed };
}

let working = false;

/** 온라인으로 돌아오면 대기열을 자동으로 처리한다. */
export async function runPendingWork() {
  if (working || !online) return null;
  working = true;
  // 무엇을 올렸는지 종류별로 센다 — "시트에 올렸습니다 · 재고 2건" 에 쓴다.
  // 올린 뒤에는 대기열에서 사라지므로 **올리기 전에** 적어 둔다.
  const result = { flushed: 0, error: null, sentByType: {} };
  try {
    const before = await store.outbox();
    const flushed = await flushOutbox();
    result.flushed = flushed.sent;
    const left = new Set((await store.outbox()).map((op) => op.id));
    for (const op of before) {
      if (left.has(op.id)) continue;
      result.sentByType[op.type] = (result.sentByType[op.type] || 0) + 1;
    }
  } catch (err) {
    result.error = err;
  }
  working = false;
  listeners.forEach((fn) => {
    try { fn({ online, work: result }); } catch { /* 무시 */ }
  });
  return result;
}

