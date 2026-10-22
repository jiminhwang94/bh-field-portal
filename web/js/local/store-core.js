// 기기 저장소 — 공통 (ID · 시각 · meta · 설정 · 대기열). 다른 store-*.js 가 이것을 쓴다.
// (store.js 가 전부 다시 내보낸다 — 밖에서는 store.js 만 부른다)
import * as idb from './idb.js';
import { testMode } from '../mode.js';

// 기기 안 데이터 조작 — 앱의 모든 조회·생성·수정·삭제가 여기서 끝난다.
// 화면(views) 은 이 파일만 보고 동작하므로 오프라인/온라인 구분이 필요 없다.

export const CATEGORY_TYPES = ['ERROR_CODE', 'HARDWARE_SOP', 'SOFTWARE_CMD'];
export const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'DROPDOWN', 'MEDIA'];

export function newId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T`
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 수량 저장소의 키. sync.js 도 이 함수를 써야 한다 (다르면 값이 통째로 버려진다). */
export const qtyKey = (vehicleName, partName) => `${vehicleName}\u0000${partName}`;
export const byText = (a, b) => String(a).localeCompare(String(b), 'ko');

/**
 * 재고 변경을 한 번에 하나씩만 처리한다.
 *
 * [−] 를 빠르게 두 번 누르면 두 호출이 **같은 현재 수량을 읽고** 각자 1을 빼서,
 * 2개를 썼는데 1개만 빠진다. 장갑 낀 손으로 급하게 누를 때 실제로 나온다.
 * 앞의 작업이 끝난 뒤에 다음이 시작하도록 줄을 세운다.
 */
let inventoryChain = Promise.resolve();
/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function serialize(fn) {
  const next = inventoryChain.then(fn, fn);
  // 실패해도 줄이 끊기지 않게 한다 (에러는 호출한 쪽으로 그대로 넘긴다).
  inventoryChain = next.then(() => undefined, () => undefined);
  return next;
}

// ------------------------------------------------------------------ meta

export async function getMeta(key, fallback = null) {
  const row = await idb.get('meta', key);
  return row === undefined || row === null ? fallback : row.value;
}

export async function setMeta(key, value) {
  await idb.put('meta', { key, value });
  return value;
}

/*
 * 탭을 통째로 다시 쓰는 종류(가이드 · 항목 · 차량/품목)의 예약은
 * **무엇을 어떻게 바꿨는지**(changes) 를 함께 담는다.
 *
 *   changes: [{ kind, id, before }]
 *     before = null  → 새로 만든 것
 *     before = {...} → 고치거나 지운 것의 **바꾸기 전 모습**
 *
 * 이게 있어야 두 가지가 된다.
 *  1. 올릴 때 **시트 것과 합친다** — 내가 안 건드린 줄은 시트 것을 그대로 두고
 *     내가 바꾼 줄만 얹는다. 없으면 마지막에 올린 사람이 남을 다 덮어쓴다.
 *  2. [올릴 내용] 에서 취소하면 **바꾸기 전으로 되돌린다.** 새로 만든 것은 지운다.
 */
export async function queueSheetPushIfOn(changes = []) {
  if (await sheetInventoryOn()) await enqueue({ type: 'invsheet-push', changes });
}

export async function queueGuideSheetPushIfOn(changes = []) {
  if (await sheetInventoryOn()) await enqueue({ type: 'guidesheet-push', changes });
}

/** 항목은 **팀 공통**이라 한 사람이 바꾸면 모두가 같이 바뀌어야 한다. */
export async function queueFieldSheetPushIfOn(changes = []) {
  if (await sheetInventoryOn()) await enqueue({ type: 'fieldsheet-push', changes });
}

// ---------------------------------------------------------------- 설정

/**
 * 팀 공용 Apps Script 웹 앱 URL — 앱에 붙박이로 들어 있다.
 *
 * 새 태블릿·재설치·앱 데이터 삭제 뒤에도 설정을 열지 않고 바로 연결된다.
 * 예전에는 비어 있어서 기기마다 사람이 이 긴 주소를 넣어야 했고, 설정이
 * 사라질 때마다 다시 넣어야 했다.
 *
 * 이 주소는 '배포' 에 붙어 있어 자동 배포(버전 갱신)로는 바뀌지 않는다.
 * 누가 [새 배포] 를 만들 때만 바뀐다. 그때는 여기를 새 주소로 고치고, 옛 주소는
 * PAST_WEBAPP_URLS 에 옮겨 둔다 — 그러면 옛 기본값을 쓰던 기기가 새 앱을 깔 때
 * 스스로 따라온다.
 */
export const TEAM_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzYFUuzAiKQGTo1QhHw2VvdJD3fs4n0Ab37-ucY_9e3WLecAsSTX8PH1OYS62KK0zAnBg/exec';

/** 예전에 기본값이었던 주소들. 저장된 값이 이 중 하나면 새 기본값을 따라간다. */
const PAST_WEBAPP_URLS = [];

const SETTING_DEFAULTS = {
  sheetsWebappUrl: TEAM_WEBAPP_URL,
  sheetsSpreadsheetId: '1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4',
  deviceName: '',
};

/** 차량 재고를 구글 시트로 관리하는 상태인가 — 시트 연결이 있으면 항상 켜진다. */
export async function sheetInventoryOn() {
  const settings = await getSettings();
  return Boolean((settings.sheetsWebappUrl || '').trim());
}

export async function getSettings() {
  const stored = (await getMeta('settings', {})) || {};
  const merged = { ...SETTING_DEFAULTS, ...stored };
  // 비어 있거나 **예전 기본값 그대로**면 지금 기본값을 쓴다.
  // 사람이 설정에서 직접 다른 주소로 바꾼 기기는 그대로 둔다.
  const url = String(merged.sheetsWebappUrl || '').trim();
  if (!url || PAST_WEBAPP_URLS.includes(url)) merged.sheetsWebappUrl = TEAM_WEBAPP_URL;
  // 테스트 모드: 주소를 테스트 주소로 **강제**한다 (비어 있으면 아무 데도 안 보낸다).
  const tm = testMode();
  if (tm) {
    merged.sheetsWebappUrl = tm.url;
    merged.sheetsSpreadsheetId = tm.spreadsheetUrl || '';
  }
  return merged;
}

export async function saveSettings(values) {
  const current = await getSettings();
  const next = { ...current };
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (values[key] !== undefined) next[key] = String(values[key] ?? '').trim();
  }
  await setMeta('settings', next);
  return next;
}

// ------------------------------------------------------- 대기열(outbox)

/** 온라인이 되면 처리할 작업을 줄 세운다. */
export async function enqueue(op) {
  await idb.put('outbox', { ...op, queuedAt: now() });
}

export const outbox = () => idb.getAll('outbox');
export const outboxCount = () => idb.count('outbox');
export const dequeue = (id) => idb.remove('outbox', id);

const PUSH_TYPES = new Set(['invsheet-push', 'guidesheet-push', 'fieldsheet-push']);

/** 같은 (차량, 부품) 수량 작업은 마지막 것만 남긴다. 시트 전체 반영도 종류별 1건만. */
export async function compactOutbox() {
  const rows = await idb.getAll('outbox');
  const lastByTarget = new Map();
  const lastPushByType = new Map();      // '*-push' 는 종류별 마지막 1건만
  const lastStatusByRow = new Map();     // 같은 줄의 상태는 마지막 것만
  const firstBefore = new Map();         // 되돌릴 값은 맨 처음 것
  const mergedChanges = new Map();       // 종류별로 합친 changes
  for (const row of rows) {
    if (PUSH_TYPES.has(row.type)) {
      lastPushByType.set(row.type, row.id);
      // 같은 것을 여러 번 고쳤으면 **맨 처음의 바꾸기 전 모습**을 남긴다.
      const merged = mergedChanges.get(row.type) || new Map();
      for (const c of row.changes || []) {
        const k = c.kind + ':' + c.id;
        if (!merged.has(k)) merged.set(k, c);
      }
      mergedChanges.set(row.type, merged);
      continue;
    }
    if (row.type === 'report-status') {
      lastStatusByRow.set(`${row.sheetName}#${row.row}`, row.id);
      continue;
    }
    if (row.type !== 'quantity' && row.type !== 'quantity-delete') continue;
    const key = qtyKey(row.vehicleName, row.partName);
    // 여러 번 눌러 쌓인 것은 **마지막 하나만** 시트로 보내면 된다.
    // 다만 되돌릴 값(before)은 **맨 처음 것**을 이어받아야 한다.
    // 안 그러면 [+]를 세 번 누른 뒤 취소했을 때 중간값으로 돌아간다.
    if (!firstBefore.has(key)) firstBefore.set(key, row.before);
    lastByTarget.set(key, row.id);
  }
  for (const row of rows) {
    if (PUSH_TYPES.has(row.type)) {
      if (row.id !== lastPushByType.get(row.type)) { await idb.remove('outbox', row.id); continue; }
      const merged = [...(mergedChanges.get(row.type) || new Map()).values()];
      if (merged.length !== (row.changes || []).length) {
        await idb.put('outbox', { ...row, changes: merged });
      }
      continue;
    }
    if (row.type === 'report-status') {
      if (row.id !== lastStatusByRow.get(`${row.sheetName}#${row.row}`)) {
        await idb.remove('outbox', row.id);
      }
      continue;
    }
    if (row.type !== 'quantity' && row.type !== 'quantity-delete') continue;
    const key = qtyKey(row.vehicleName, row.partName);
    if (lastByTarget.get(key) !== row.id) {
      await idb.remove('outbox', row.id);
      continue;
    }
    // 남는 한 건이 맨 처음의 '바꾸기 전' 값을 이어받는다.
    const origin = firstBefore.get(key);
    if (row.before !== origin) await idb.put('outbox', { ...row, before: origin });
  }
}
