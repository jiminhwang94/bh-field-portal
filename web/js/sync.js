// 서버 동기화 — 기기(로컬)와 사무실 서버의 공개본을 주고받는다.
//
// 오프라인에서는 아무것도 하지 않고, 모든 작업은 기기 안에서 끝난다.
// 온라인이 되면 대기열(outbox)을 자동으로 처리한다.
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
let serverReachable = null;      // null = 아직 확인 안 함
const listeners = new Set();

export const isOnline = () => online;
export const isServerReachable = () => serverReachable === true;
/** 인터넷은 되는데 사무실 서버에만 못 닿는 상태 (현장 LTE 등) */
export const serverUnreachable = () => online && serverReachable === false;

export function onNetChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => {
    try { fn({ online, serverReachable }); } catch { /* 화면 갱신 실패는 무시 */ }
  });
}

window.addEventListener('online', () => {
  online = true; emit();
  // 연결되면 대기 중인 작업을 자동으로 처리한다.
  runPendingWork();
});
window.addEventListener('offline', () => {
  online = false; serverReachable = null; emit();
});

// ------------------------------------------------------------ 서버 주소·요청

/** APK 는 설정에 적힌 서버 주소를, 웹은 접속한 주소를 쓴다. */
export async function serverBase() {
  const settings = await store.getSettings();
  const configured = (settings.serverUrl || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (location.protocol.startsWith('http')) return location.origin;
  return '';       // file:// 등 — 서버 주소 미설정
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

class OfflineError extends Error {
  constructor(message) {
    super(message || '오프라인 상태입니다. 이 작업은 인터넷에 연결되면 처리됩니다.');
    this.offline = true;
  }
}
export { OfflineError };

async function request(method, path, body, { timeout = 15000 } = {}) {
  const base = await serverBase();
  if (!base) throw new OfflineError('서버 주소가 설정되지 않았습니다. 설정에서 등록해 주세요.');
  if (!online) throw new OfflineError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const opts = {
    method,
    headers: { 'X-Device-Id': deviceId() },
    credentials: 'include',
    signal: controller.signal,
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(base + path, opts);
  } catch {
    serverReachable = false; emit();
    throw new OfflineError('사무실 서버에 연결할 수 없습니다. (사무실 Wi-Fi 여부를 확인하세요)');
  } finally {
    clearTimeout(timer);
  }
  serverReachable = true; emit();

  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !path.startsWith('/api/auth')) {
      onUnauthorized();
    }
    const error = new Error((data && data.error) || `요청 실패 (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}
export { request as serverRequest };

// ------------------------------------------------------------------- 받기

/** 서버 공개본을 기기로 받아온다. */
export async function pull() {
  const snapshot = await request('GET', '/api/sync/pull');
  const revision = await store.applySnapshot(snapshot);
  downloadMissingMedia(snapshot.media || []);      // 사진은 뒤에서 천천히
  return { revision, summary: snapshot.summary || {} };
}

/**
 * v2 에서 서버에 있던 리포트를 기기로 옮긴다 (앱 첫 실행 때 1회).
 * 이미 기기에 있는 리포트는 건드리지 않는다.
 */
export async function importLegacy() {
  if (await store.getMeta('legacyImported', false)) return 0;
  let payload;
  try {
    payload = await request('GET', '/api/sync/legacy');
  } catch {
    return 0;        // 서버에 못 닿으면 다음 기회에 다시 시도
  }
  let added = 0;
  for (const report of payload.reports || []) {
    if (await idb.get('reports', report.id)) continue;
    await idb.put('reports', report);
    added += 1;
  }
  await downloadMissingMedia(payload.media || []);
  await store.setMeta('legacyImported', true);
  return added;
}

/** 내 변경이 없을 때만 조용히 최신본을 받는다. */
export async function autoPullIfClean() {
  const local = await store.syncState();
  let head;
  try {
    head = await request('GET', '/api/sync/head');
  } catch {
    return false;
  }
  if (local.dirty) return false;
  if ((head.revision || 0) <= local.baseRevision) return false;
  await pull();
  return true;
}

async function downloadMissingMedia(list) {
  const base = await serverBase();
  for (const item of list) {
    if (await idb.get('media', item.filename)) continue;
    try {
      const res = await fetch(`${base}/media/${item.filename}`, {
        headers: { 'X-Device-Id': deviceId() }, credentials: 'include',
      });
      if (!res.ok) continue;
      const blob = await res.blob();
      await idb.put('media', {
        filename: item.filename, blob, mime: item.mime || blob.type,
        originalName: item.originalName || item.filename,
        size: blob.size, createdAt: store.now(), localOnly: false,
      });
    } catch {
      // 사진 하나 실패해도 나머지는 계속 받는다.
    }
  }
}

// ------------------------------------------------------------------- 올리기

/** [업데이트] — 기기 내용을 모든 사용자가 보는 공개본으로 만든다. */
export async function push(deviceName) {
  // 1) 기기에만 있는 가이드 사진을 먼저 서버로 올린다.
  const base = await serverBase();
  for (const media of await store.localOnlyGuideMedia()) {
    const res = await fetch(
      `${base}/api/media?filename=${encodeURIComponent(media.filename)}`,
      { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': media.mime, 'X-Device-Id': deviceId() },
        body: media.blob });
    if (!res.ok) throw new Error('사진을 서버에 올리지 못했습니다.');
    await store.markMediaSynced(media.filename);
  }

  // 2) 공유 데이터를 통째로 올린다.
  const snapshot = await store.collectSnapshot();
  const local = await store.syncState();
  const result = await request('POST', '/api/sync/push', {
    deviceName: deviceName || '',
    baseRevision: local.baseRevision,
    ...snapshot,
  }, { timeout: 30000 });

  await store.setMeta('baseRevision', result.revision);
  await store.setMeta('publishedAt', result.at || '');
  await store.setMeta('publishedBy', result.by || '');
  await store.setMeta('dirty', false);
  return result;
}

// ------------------------------------------------------------ 대기열 처리

/** 재고 수량 변경 등 쌓인 작업을 서버에 반영한다. */
export async function flushOutbox() {
  await store.compactOutbox();
  const rows = await store.outbox();
  if (!rows.length) return { sent: 0 };

  const quantityOps = rows.filter(
    (r) => r.type === 'quantity' || r.type === 'quantity-delete');
  let sent = 0;

  if (quantityOps.length) {
    const result = await request('POST', '/api/sync/quantities', {
      ops: quantityOps.map((r) => ({
        type: r.type, vehicleName: r.vehicleName, partName: r.partName,
        quantity: r.quantity, updatedAt: r.updatedAt,
      })),
    });
    for (const op of quantityOps) {
      await store.dequeue(op.id);
      sent += 1;
    }
    // 서버가 돌려준 값이 최종 결과다.
    // (같은 부품을 다른 사람이 더 나중에 만졌다면 그 값이 남는다)
    const stillPending = await store.pendingQuantityKeys();
    for (const row of result.quantities || []) {
      const key = `${row.vehicleName} ${row.partName}`;
      if (stillPending.has(key)) continue;      // 그 사이 또 바뀐 것은 건드리지 않는다
      await idb.put('quantities', { key, ...row });
    }
  }

  // 시트 업로드 대기분
  const { uploadReport } = await import('./sheets.js');
  for (const row of rows.filter((r) => r.type === 'sheet')) {
    const report = await store.getReport(row.reportId);
    if (!report) { await store.dequeue(row.id); continue; }
    try {
      await uploadReport(report);
      await store.dequeue(row.id);
      sent += 1;
    } catch {
      break;      // 한 건이라도 실패하면 다음 기회에 다시 시도
    }
  }
  return { sent };
}

let working = false;

/** 온라인 복귀 시 자동 처리: 대기열 → 최신본 받기 */
export async function runPendingWork() {
  if (working || !online) return null;
  working = true;
  const result = { flushed: 0, pulled: false, error: null };
  try {
    const flushed = await flushOutbox();
    result.flushed = flushed.sent;
  } catch (err) {
    result.error = err;
  }
  try {
    result.pulled = await autoPullIfClean();
  } catch (err) {
    result.error = result.error || err;
  }
  working = false;
  listeners.forEach((fn) => {
    try { fn({ online, serverReachable, work: result }); } catch { /* 무시 */ }
  });
  return result;
}

// ----------------------------------------------------------------- 상태

/** 상단 [업데이트] 버튼용 상태. 오프라인이면 기기에 있는 정보만으로 답한다. */
export async function state() {
  const local = await store.syncState();
  const summary = {
    guides: await idb.count('guides'),
    steps: (await idb.getAll('guides'))
      .reduce((n, g) => n + (g.steps || []).length, 0),
    vehicles: await idb.count('vehicles'),
    inventoryItems: await idb.count('inventory'),
    fields: await idb.count('fields'),
  };
  const base = {
    published: { revision: local.baseRevision, at: local.publishedAt,
                 by: local.publishedBy },
    myRevision: local.baseRevision,
    hasLocalChanges: local.dirty,
    behind: false,
    autoUpdated: false,
    offline: true,
    pendingCount: await store.outboxCount(),
    summary,
  };
  if (!online) return base;

  let head;
  try {
    head = await request('GET', '/api/sync/head', undefined, { timeout: 6000 });
  } catch {
    return base;        // 서버가 안 닿아도 앱은 그대로 동작한다
  }
  const auto = !local.dirty && (head.revision || 0) > local.baseRevision;
  if (auto) {
    try {
      await pull();
    } catch {
      return { ...base, offline: false };
    }
  }
  const after = await store.syncState();
  return {
    published: { revision: head.revision || 0, at: head.at || '', by: head.by || '' },
    myRevision: after.baseRevision,
    hasLocalChanges: after.dirty,
    behind: (head.revision || 0) > after.baseRevision,
    autoUpdated: auto,
    offline: false,
    pendingCount: await store.outboxCount(),
    summary,
  };
}
