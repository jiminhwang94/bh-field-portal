// 기기 안 데이터 조작 — 서버 app/db.py 와 같은 모양의 값을 돌려준다.
// 화면(views) 은 이 파일만 보고 동작하므로 오프라인/온라인 구분이 필요 없다.
import * as idb from './idb.js';

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
const byText = (a, b) => String(a).localeCompare(String(b), 'ko');

/**
 * 재고 변경을 한 번에 하나씩만 처리한다.
 *
 * [−] 를 빠르게 두 번 누르면 두 호출이 **같은 현재 수량을 읽고** 각자 1을 빼서,
 * 2개를 썼는데 1개만 빠진다. 장갑 낀 손으로 급하게 누를 때 실제로 나온다.
 * 앞의 작업이 끝난 뒤에 다음이 시작하도록 줄을 세운다.
 */
let inventoryChain = Promise.resolve();
function serialize(fn) {
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

/** 공유 데이터가 바뀌었음을 표시 ([업데이트] 버튼이 켜지는 근거) */
async function markDirty() {
  await setMeta('dirty', true);
}

/** 시트 재고 관리 중이면, 구조 변경(차량·품목)을 시트 전체 반영으로 예약한다. */
async function queueSheetPushIfOn() {
  if (await sheetInventoryOn()) await enqueue({ type: 'invsheet-push' });
}

/** 시트가 연결돼 있으면, 가이드 열람용 탭 갱신을 예약한다. */
async function queueGuideSheetPushIfOn() {
  if (await sheetInventoryOn()) await enqueue({ type: 'guidesheet-push' });
}

export const isDirty = () => getMeta('dirty', false).then(Boolean);

export async function syncState() {
  return {
    baseRevision: Number(await getMeta('baseRevision', 0)) || 0,
    dirty: Boolean(await getMeta('dirty', false)),
    lastPullAt: await getMeta('lastPullAt', ''),
    publishedAt: await getMeta('publishedAt', ''),
    publishedBy: await getMeta('publishedBy', ''),
  };
}

// ---------------------------------------------------------------- 설정

const SETTING_DEFAULTS = {
  sheetsWebappUrl: '',
  sheetsSpreadsheetId: '1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4',
  serverUrl: '',        // APK 에서 사무실 서버 주소 (웹에서는 비워두면 접속한 주소)
  deviceName: '',
};

/** 차량 재고를 구글 시트로 관리하는 상태인가 — 시트 연결이 있으면 항상 켜진다. */
export async function sheetInventoryOn() {
  const settings = await getSettings();
  return Boolean((settings.sheetsWebappUrl || '').trim());
}

export async function getSettings() {
  const stored = (await getMeta('settings', {})) || {};
  return { ...SETTING_DEFAULTS, ...stored };
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

// -------------------------------------------------------------- 가이드

const guideOut = (g, withSteps) => {
  const out = {
    id: g.id,
    categoryType: g.categoryType,
    codeOrTitle: g.codeOrTitle,
    summary: g.summary || '',
    requiredTools: g.requiredTools || '',
    commands: g.commands || [],
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
  if (withSteps) out.steps = g.steps || [];
  else out.stepCount = (g.steps || []).length;
  return out;
};

function matchesQuery(guide, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    guide.codeOrTitle, guide.summary, guide.requiredTools,
    ...(guide.commands || []).flatMap((c) => [c.label, c.cmd, c.desc]),
    ...(guide.steps || []).flatMap((s) => [s.instruction, s.expectedMetric]),
  ];
  return haystack.some((v) => String(v || '').toLowerCase().includes(q));
}

export async function listGuides(categoryType = null, query = null) {
  let rows = await idb.getAll('guides');
  if (categoryType) rows = rows.filter((g) => g.categoryType === categoryType);
  if (query) rows = rows.filter((g) => matchesQuery(g, query));
  rows.sort((a, b) => byText(a.codeOrTitle, b.codeOrTitle));
  return rows.map((g) => guideOut(g, false));
}

export async function getGuide(id) {
  const row = await idb.get('guides', id);
  return row ? guideOut(row, true) : null;
}

export async function saveGuide(payload, guideId = null) {
  if (!CATEGORY_TYPES.includes(payload.categoryType)) {
    throw new Error('categoryType 값이 올바르지 않습니다.');
  }
  const title = (payload.codeOrTitle || '').trim();
  if (!title) throw new Error('코드 / 제목은 필수입니다.');

  let commands = payload.commands || [];
  if (typeof commands === 'string') commands = [{ label: '', cmd: commands, desc: '' }];
  commands = commands
    .filter((c) => (c.cmd || '').trim())
    .map((c) => ({
      label: (c.label || '').trim(),
      cmd: (c.cmd || '').trim(),
      desc: (c.desc || '').trim(),
    }));

  const steps = [];
  for (const step of payload.steps || []) {
    const instruction = (step.instruction || '').trim();
    if (!instruction) continue;              // 빈 단계는 건너뛰고 번호를 다시 매긴다
    steps.push({
      id: step.id || newId(),
      stepOrder: steps.length + 1,
      instruction,
      expectedMetric: (step.expectedMetric || '').trim() || null,
      imageUrl: (step.imageUrl || '').trim() || null,
    });
  }

  const stamp = now();
  const existing = guideId ? await idb.get('guides', guideId) : null;
  if (guideId && !existing) throw new Error('가이드를 찾을 수 없습니다.');

  const row = {
    id: guideId || newId(),
    categoryType: payload.categoryType,
    codeOrTitle: title,
    summary: (payload.summary || '').trim(),
    requiredTools: (payload.requiredTools || '').trim(),
    commands,
    steps,
    createdAt: existing ? existing.createdAt : stamp,
    updatedAt: stamp,
  };
  await idb.put('guides', row);
  await markDirty();
  await queueGuideSheetPushIfOn();
  return guideOut(row, true);
}

export async function deleteGuide(id) {
  if (!(await idb.get('guides', id))) return false;
  await idb.remove('guides', id);
  await markDirty();
  await queueGuideSheetPushIfOn();
  return true;
}

// -------------------------------------------------------------- 차량

export async function listVehicles() {
  const rows = await idb.getAll('vehicles');
  rows.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)
    || byText(a.name, b.name));
  const names = rows.map((v) => v.name);
  // 차량 목록에 없지만 재고 품목만 있는 이름도 함께 보여준다.
  const items = await idb.getAll('inventory');
  for (const item of items) {
    if (!names.includes(item.vehicleName)) names.push(item.vehicleName);
  }
  return names;
}

export async function addVehicle(name) {
  name = (name || '').trim();
  if (!name) throw new Error('차량 이름은 필수입니다.');
  if (await idb.get('vehicles', name)) throw new Error('이미 등록된 차량입니다.');
  const rows = await idb.getAll('vehicles');
  const order = rows.reduce((max, v) => Math.max(max, v.displayOrder || 0), 0) + 1;
  await idb.put('vehicles', { name, displayOrder: order, createdAt: now() });
  await markDirty();
  await queueSheetPushIfOn();
  return { name, itemCount: 0 };
}

export async function deleteVehicle(name) {
  name = (name || '').trim();
  const exists = await idb.get('vehicles', name);
  const items = (await idb.getAll('inventory')).filter((i) => i.vehicleName === name);
  if (!exists && !items.length) return null;
  for (const item of items) {
    await idb.remove('inventory', item.id);
    await idb.remove('quantities', qtyKey(name, item.partName));
    await enqueue({ type: 'quantity-delete', vehicleName: name, partName: item.partName });
  }
  if (exists) await idb.remove('vehicles', name);
  await markDirty();
  await queueSheetPushIfOn();
  return { name, deletedItems: items.length };
}

// -------------------------------------------------------------- 재고

async function quantityMap() {
  const rows = await idb.getAll('quantities');
  const map = new Map();
  rows.forEach((r) => map.set(r.key, r));
  return map;
}

/** 아직 서버에 반영하지 못한 수량 변경의 대상 목록.
 *
 * "대기 중" 표시는 이 대기열 하나만 보고 판단한다. 별도 표시값을 두면
 * 전송이 끝난 뒤에도 표시가 남는 어긋남이 생긴다.
 */
export async function pendingQuantityKeys() {
  const rows = await idb.getAll('outbox');
  return new Set(rows
    .filter((r) => r.type === 'quantity' || r.type === 'quantity-delete')
    .map((r) => qtyKey(r.vehicleName, r.partName)));
}

export async function listInventory(vehicleName = null) {
  let rows = await idb.getAll('inventory');
  if (vehicleName) rows = rows.filter((i) => i.vehicleName === vehicleName);
  rows.sort((a, b) => byText(a.partName, b.partName));
  const live = await quantityMap();
  const pending = await pendingQuantityKeys();
  return rows.map((r) => {
    const key = qtyKey(r.vehicleName, r.partName);
    const q = live.get(key);
    return {
      id: r.id,
      vehicleName: r.vehicleName,
      partName: r.partName,
      quantity: q ? q.quantity : r.quantity,
      minQuantity: r.minQuantity,
      updatedAt: q ? q.updatedAt : r.updatedAt,
      pending: pending.has(key),
    };
  });
}

async function setQuantity(vehicleName, partName, quantity, stamp) {
  const value = Math.max(0, Number(quantity) || 0);
  const updatedAt = stamp || now();
  await idb.put('quantities', {
    key: qtyKey(vehicleName, partName), vehicleName, partName,
    quantity: value, updatedAt,
  });
  await enqueue({ type: 'quantity', vehicleName, partName, quantity: value, updatedAt });
  return value;
}

export function addInventoryItem(...args) {
  return serialize(() => _addInventoryItem(...args));
}

async function _addInventoryItem(vehicleName, partName, quantity = 0,
                                       minQuantity = 0) {
  vehicleName = (vehicleName || '').trim();
  partName = (partName || '').trim();
  if (!vehicleName || !partName) throw new Error('차량과 부품명은 필수입니다.');
  const rows = await idb.getAll('inventory');
  if (rows.some((r) => r.vehicleName === vehicleName && r.partName === partName)) {
    throw new Error('이미 등록된 부품입니다.');
  }
  if (!(await idb.get('vehicles', vehicleName))) {
    const order = (await idb.getAll('vehicles'))
      .reduce((max, v) => Math.max(max, v.displayOrder || 0), 0) + 1;
    await idb.put('vehicles', { name: vehicleName, displayOrder: order, createdAt: now() });
  }
  const stamp = now();
  const row = {
    id: newId(), vehicleName, partName,
    quantity: Math.max(0, Number(quantity) || 0),
    minQuantity: Math.max(0, Number(minQuantity) || 0),
    updatedAt: stamp,
  };
  await idb.put('inventory', row);
  await setQuantity(vehicleName, partName, row.quantity, stamp);

  // 품목은 모든 차량 공용 — 다른 차량에도 수량 0 으로 함께 등록한다.
  for (const vehicle of await listVehicles()) {
    if (vehicle === vehicleName) continue;
    if (rows.some((r) => r.vehicleName === vehicle && r.partName === partName)) continue;
    await idb.put('inventory', {
      id: newId(), vehicleName: vehicle, partName,
      quantity: 0, minQuantity: row.minQuantity, updatedAt: stamp,
    });
    await setQuantity(vehicle, partName, 0, stamp);
  }

  await markDirty();
  await queueSheetPushIfOn();
  return { ...row, pending: true };
}

export function updateInventoryItem(itemId, patch = {}) {
  return serialize(() => _updateInventoryItem(itemId, patch));
}

async function _updateInventoryItem(itemId, { delta, quantity, minQuantity,
                                              partName } = {}) {
  const row = await idb.get('inventory', itemId);
  if (!row) return null;
  const live = await quantityMap();
  const currentQty = live.has(qtyKey(row.vehicleName, row.partName))
    ? live.get(qtyKey(row.vehicleName, row.partName)).quantity
    : row.quantity;

  let nextQty = currentQty;
  if (delta !== undefined && delta !== null) nextQty = currentQty + Number(delta);
  if (quantity !== undefined && quantity !== null) nextQty = Number(quantity);
  nextQty = Math.max(0, nextQty);

  const nextMin = minQuantity === undefined || minQuantity === null
    ? row.minQuantity : Math.max(0, Number(minQuantity));
  const nextName = (partName || '').trim() || row.partName;
  const stamp = now();

  const nameChanged = nextName !== row.partName;
  const minChanged = nextMin !== row.minQuantity;
  if (nameChanged) {
    const clash = (await idb.getAll('inventory'))
      .some((r) => r.partName === nextName);
    if (clash) throw new Error('이미 등록된 부품입니다.');
  }

  // 부품명·최소보유는 모든 차량 공용 — 같은 부품의 다른 차량 항목도 함께 바꾼다.
  const siblings = (await idb.getAll('inventory'))
    .filter((r) => r.partName === row.partName);
  for (const item of siblings) {
    await idb.put('inventory', { ...item, partName: nextName, minQuantity: nextMin,
                                 updatedAt: stamp });
    if (nameChanged && item.id !== itemId) {
      const old = live.get(qtyKey(item.vehicleName, row.partName));
      await idb.remove('quantities', qtyKey(item.vehicleName, row.partName));
      await enqueue({ type: 'quantity-delete', vehicleName: item.vehicleName,
                      partName: row.partName });
      await setQuantity(item.vehicleName, nextName,
                        old ? old.quantity : item.quantity, stamp);
    }
  }
  if (nameChanged || minChanged) {
    await markDirty();   // 이름·최소보유는 [업데이트] 대상
    await queueSheetPushIfOn();
  }

  if (nameChanged) {
    await idb.remove('quantities', qtyKey(row.vehicleName, row.partName));
    await enqueue({ type: 'quantity-delete', vehicleName: row.vehicleName,
                    partName: row.partName });
  }
  await setQuantity(row.vehicleName, nextName, nextQty, stamp);
  return { id: itemId, vehicleName: row.vehicleName, partName: nextName,
           quantity: nextQty, minQuantity: nextMin, updatedAt: stamp, pending: true };
}

export function deleteInventoryItem(itemId) {
  return serialize(() => _deleteInventoryItem(itemId));
}

async function _deleteInventoryItem(itemId) {
  const row = await idb.get('inventory', itemId);
  if (!row) return false;
  // 품목은 모든 차량 공용 — 전 차량에서 함께 삭제한다.
  const siblings = (await idb.getAll('inventory'))
    .filter((r) => r.partName === row.partName);
  for (const item of siblings) {
    await idb.remove('inventory', item.id);
    await idb.remove('quantities', qtyKey(item.vehicleName, item.partName));
    await enqueue({ type: 'quantity-delete', vehicleName: item.vehicleName,
                    partName: item.partName });
  }
  await markDirty();
  await queueSheetPushIfOn();
  return true;
}

// ------------------------------------------- 재고 ↔ 구글 시트 상태 변환

/** 구글 시트('차량재고' 탭)에 올릴 현재 재고 상태를 모은다. */
export async function collectInventoryState() {
  const vehicles = await listVehicles();
  const items = await listInventory();
  return {
    vehicles,
    items: items.map((i) => ({
      vehicleName: i.vehicleName,
      partName: i.partName,
      quantity: i.quantity,
      minQuantity: i.minQuantity,
    })),
  };
}

/**
 * 구글 시트에서 받은 재고 상태를 기기에 통째로 반영한다.
 * (시트가 공유 원본 — 차량 이름 변경·품목 추가/삭제도 여기로 내려온다)
 * 아직 시트로 보내지 못한 내 수량 변경(outbox)은 덮지 않는다.
 */
/** 아직 시트에 못 올린 차량·품목 구조 변경이 대기 중인가 */
async function hasPendingStructureChange() {
  return (await idb.getAll('outbox')).some((op) => op.type === 'invsheet-push');
}

export async function applyInventorySheet(state) {
  const stamp = now();
  const names = [];
  for (const raw of state.vehicles || []) {
    const name = String(raw || '').trim();
    if (name && !names.includes(name)) names.push(name);
  }
  for (const item of state.items || []) {
    const name = String(item.vehicleName || '').trim();
    if (name && !names.includes(name)) names.push(name);
  }

  const prevVehicles = new Map((await idb.getAll('vehicles')).map((v) => [v.name, v]));
  const vehicleRows = names.map((name, i) => ({
    name,
    displayOrder: i + 1,
    createdAt: (prevVehicles.get(name) || {}).createdAt || stamp,
  }));

  const prevItems = new Map((await idb.getAll('inventory'))
    .map((r) => [qtyKey(r.vehicleName, r.partName), r]));
  const pending = await pendingQuantityKeys();
  const inventoryRows = [];
  const quantityRows = [];
  const seen = new Set();
  for (const item of state.items || []) {
    const vehicleName = String(item.vehicleName || '').trim();
    const partName = String(item.partName || '').trim();
    if (!vehicleName || !partName) continue;
    const key = qtyKey(vehicleName, partName);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = prevItems.get(key);
    const quantity = Math.max(0, Number(item.quantity) || 0);
    inventoryRows.push({
      id: prev ? prev.id : newId(),
      vehicleName,
      partName,
      quantity,
      minQuantity: Math.max(0, Number(item.minQuantity) || 0),
      updatedAt: prev ? prev.updatedAt : stamp,
    });
    if (!pending.has(key)) {
      quantityRows.push({ key, vehicleName, partName, quantity, updatedAt: stamp });
    }
  }
  // 내 대기 중 수량은 기기 값을 유지한다 (전송되면 시트 값과 같아진다).
  for (const q of await idb.getAll('quantities')) {
    if (pending.has(q.key)) quantityRows.push(q);
  }

  // 아직 시트에 못 올린 **구조 변경**(차량·품목 추가)도 지키고 지나간다.
  // 시트에는 없지만 기기에만 있는 줄을 지우면, 오프라인에서 추가한 품목이
  // 전송되기도 전에 사라진다. 그 뒤 invsheet-push 는 이미 지워진 상태를 올려
  // 되돌릴 수 없게 된다.
  if (await hasPendingStructureChange()) {
    for (const [key, prev] of prevItems) {
      if (seen.has(key)) continue;
      seen.add(key);
      inventoryRows.push(prev);
      if (!names.includes(prev.vehicleName)) {
        names.push(prev.vehicleName);
        vehicleRows.push({
          name: prev.vehicleName,
          displayOrder: vehicleRows.length + 1,
          createdAt: (prevVehicles.get(prev.vehicleName) || {}).createdAt || stamp,
        });
      }
      if (!pending.has(key)) {
        quantityRows.push({
          key, vehicleName: prev.vehicleName, partName: prev.partName,
          quantity: prev.quantity, updatedAt: stamp,
        });
      }
    }
  }

  await idb.replaceStores({
    vehicles: vehicleRows,
    inventory: inventoryRows,
    quantities: quantityRows,
  });
  await setMeta('sheetInventoryPulledAt', stamp);
  return { vehicles: names.length, items: inventoryRows.length };
}

// -------------------------------------------------- 리포트 입력 항목 설정

export async function listFields() {
  const rows = await idb.getAll('fields');
  rows.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  return rows.map((f) => ({
    id: f.id, fieldLabel: f.fieldLabel, fieldType: f.fieldType,
    options: f.options || null, isRequired: Boolean(f.isRequired),
    displayOrder: f.displayOrder,
  }));
}

export async function saveField(payload, fieldId = null) {
  const label = (payload.fieldLabel || '').trim();
  if (!label) throw new Error('항목명은 필수입니다.');
  if (!FIELD_TYPES.includes(payload.fieldType)) {
    throw new Error('지원하지 않는 항목 종류입니다.');
  }
  const options = (payload.options || '').trim() || null;
  if (payload.fieldType === 'DROPDOWN' && !options) {
    throw new Error('드롭다운은 선택지를 1개 이상 입력해야 합니다.');
  }
  const existing = fieldId ? await idb.get('fields', fieldId) : null;
  if (fieldId && !existing) throw new Error('항목을 찾을 수 없습니다.');

  const rows = await idb.getAll('fields');
  const row = {
    id: fieldId || newId(),
    fieldLabel: label,
    fieldType: payload.fieldType,
    options,
    isRequired: payload.isRequired ? 1 : 0,
    displayOrder: existing ? existing.displayOrder
      : rows.reduce((max, f) => Math.max(max, f.displayOrder || 0), 0) + 1,
    createdAt: existing ? existing.createdAt : now(),
  };
  await idb.put('fields', row);
  await markDirty();
  return { ...row, isRequired: Boolean(row.isRequired) };
}

export async function deleteField(fieldId) {
  if (!(await idb.get('fields', fieldId))) return false;
  await idb.remove('fields', fieldId);
  await markDirty();
  return true;
}

export async function reorderFields(orderedIds) {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const row = await idb.get('fields', orderedIds[i]);
    if (row) await idb.put('fields', { ...row, displayOrder: i + 1 });
  }
  await markDirty();
  return listFields();
}

// ------------------------------------------------------------- 리포트

const reportOut = (r) => ({
  id: r.id, title: r.title, payload: r.payload || [], status: r.status,
  sheetName: r.sheetName || null, sheetRow: r.sheetRow || null,
  errorMessage: r.errorMessage || null,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
});

export async function listReports(limit = 100) {
  const rows = await idb.getAll('reports');
  rows.sort((a, b) => byText(b.createdAt, a.createdAt));
  return rows.slice(0, limit).map(reportOut);
}

export async function getReport(id) {
  const row = await idb.get('reports', id);
  return row ? reportOut(row) : null;
}

export async function saveReport(payload, reportId = null) {
  const values = payload.values || [];
  let title = (payload.title || '').trim();
  if (!title) {
    for (const item of values) {
      if (['TEXT', 'TEXTAREA'].includes(item.type) && item.value) {
        title = String(item.value).split('\n')[0].slice(0, 80);
        break;
      }
    }
  }
  if (!title) title = `현장 리포트 ${now()}`;

  const stamp = now();
  const existing = reportId ? await idb.get('reports', reportId) : null;
  if (reportId && !existing) throw new Error('리포트를 찾을 수 없습니다.');

  const row = {
    id: reportId || newId(),
    title,
    payload: values,
    status: existing ? existing.status : 'DRAFT',
    sheetName: existing ? existing.sheetName : null,
    sheetRow: existing ? existing.sheetRow : null,
    errorMessage: existing ? existing.errorMessage : null,
    createdAt: existing ? existing.createdAt : stamp,
    updatedAt: stamp,
  };
  await idb.put('reports', row);        // 리포트는 기기 전용 — [업데이트] 대상 아님
  return reportOut(row);
}

export async function markReport(reportId, patch) {
  const row = await idb.get('reports', reportId);
  if (!row) return null;
  const next = { ...row, ...patch, updatedAt: now() };
  await idb.put('reports', next);
  return reportOut(next);
}

export async function deleteReport(id) {
  const row = await idb.get('reports', id);
  if (!row) return false;
  await idb.remove('reports', id);
  await pruneOrphanMedia();
  return true;
}

// --------------------------------------------------------------- 사진

/** 파일을 기기에 저장하고 서버와 동일한 모양의 정보를 돌려준다. */
export async function saveMedia(file) {
  const ext = (file.name || '').includes('.')
    ? '.' + file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
    : ((file.type || '').includes('png') ? '.png' : '.jpg');
  const filename = `${Date.now().toString(36)}-${newId().slice(0, 8)}${ext}`;
  const row = {
    filename,
    blob: file,
    mime: file.type || 'application/octet-stream',
    originalName: file.name || 'upload',
    size: file.size || 0,
    createdAt: now(),
    localOnly: true,          // 아직 서버에 올리지 않음
  };
  await idb.put('media', row);
  return { id: filename, filename, originalName: row.originalName,
           mime: row.mime, size: row.size, url: `/media/${filename}` };
}

export async function getMediaBlob(filename) {
  const row = await idb.get('media', filename);
  return row ? row.blob : null;
}

/** 어디에서도 참조하지 않는 사진을 정리한다. */
export async function pruneOrphanMedia() {
  const used = new Set();
  for (const guide of await idb.getAll('guides')) {
    for (const step of guide.steps || []) {
      const url = step.imageUrl || '';
      if (url.startsWith('/media/')) used.add(url.slice('/media/'.length));
    }
  }
  for (const report of await idb.getAll('reports')) {
    for (const item of report.payload || []) {
      for (const media of item.media || []) {
        if (media.filename) used.add(media.filename.replace(/^.*\//, ''));
      }
    }
  }
  // 아직 저장하지 않은 작성 중 리포트의 첨부도 쓰이는 중이다.
  // (임시보관은 localStorage 에 있어 위 조회에 잡히지 않는다)
  try {
    const draft = JSON.parse(localStorage.getItem('bh_report_draft') || 'null');
    for (const entry of Object.values((draft && draft.values) || {})) {
      for (const media of (entry && entry.media) || []) {
        if (media.filename) used.add(media.filename.replace(/^.*\//, ''));
      }
    }
  } catch { /* 임시보관이 깨져 있으면 무시한다 */ }
  let deleted = 0;
  for (const media of await idb.getAll('media')) {
    if (used.has(media.filename)) continue;
    // 방금 올려 아직 리포트에 담기지 않은 파일은 남긴다(10분).
    const age = Date.now() - new Date(media.createdAt || 0).getTime();
    if (age < 600000) continue;
    await idb.remove('media', media.filename);
    deleted += 1;
  }
  return { deleted };
}

// ------------------------------------------------------- 대기열(outbox)

/** 온라인이 되면 처리할 작업을 줄 세운다. */
export async function enqueue(op) {
  await idb.put('outbox', { ...op, queuedAt: now() });
}

export const outbox = () => idb.getAll('outbox');
export const outboxCount = () => idb.count('outbox');
export const dequeue = (id) => idb.remove('outbox', id);

/** 같은 (차량, 부품) 수량 작업은 마지막 것만 남긴다. 시트 전체 반영도 종류별 1건만. */
export async function compactOutbox() {
  const rows = await idb.getAll('outbox');
  const lastByTarget = new Map();
  const lastPushByType = new Map();      // 'invsheet-push' | 'guidesheet-push'
  const lastStatusByRow = new Map();     // 같은 줄의 상태는 마지막 것만
  for (const row of rows) {
    if (row.type === 'invsheet-push' || row.type === 'guidesheet-push') {
      lastPushByType.set(row.type, row.id);
      continue;
    }
    if (row.type === 'report-status') {
      lastStatusByRow.set(`${row.sheetName}#${row.row}`, row.id);
      continue;
    }
    if (row.type !== 'quantity' && row.type !== 'quantity-delete') continue;
    lastByTarget.set(qtyKey(row.vehicleName, row.partName), row.id);
  }
  for (const row of rows) {
    if (row.type === 'invsheet-push' || row.type === 'guidesheet-push') {
      if (row.id !== lastPushByType.get(row.type)) await idb.remove('outbox', row.id);
      continue;
    }
    if (row.type === 'report-status') {
      if (row.id !== lastStatusByRow.get(`${row.sheetName}#${row.row}`)) {
        await idb.remove('outbox', row.id);
      }
      continue;
    }
    if (row.type !== 'quantity' && row.type !== 'quantity-delete') continue;
    if (lastByTarget.get(qtyKey(row.vehicleName, row.partName)) !== row.id) {
      await idb.remove('outbox', row.id);
    }
  }
}

// ------------------------------------------------- 서버 동기화 적용/추출

/** 서버 공개본 스냅샷을 기기에 통째로 반영한다. */
export async function applySnapshot(snapshot) {
  // 재고를 구글 시트로 관리 중이면 시트가 원본이므로
  // 서버 공개본의 차량·재고·수량으로 덮지 않는다.
  const sheetInv = await sheetInventoryOn();
  await idb.replaceStores({
    guides: snapshot.guides || [],
    fields: snapshot.fields || [],
    ...(sheetInv ? {} : {
      vehicles: snapshot.vehicles || [],
      inventory: snapshot.inventory || [],
    }),
  });
  if (!sheetInv) {
    // 아직 서버로 보내지 못한 내 수량 변경은 덮지 않는다.
    const pendingKeys = await pendingQuantityKeys();
    const incoming = (snapshot.quantities || [])
      .map((q) => ({ key: qtyKey(q.vehicleName, q.partName), ...q }))
      .filter((q) => !pendingKeys.has(q.key));
    await idb.putAll('quantities', incoming);
  }

  // 팀 공통 설정(시트 주소 등)을 기기에 반영해 오프라인에서도 쓸 수 있게 한다.
  // 사무실 서버 주소(serverUrl)는 기기마다 다르므로 덮지 않는다.
  const incomingSettings = snapshot.settings || {};
  if (incomingSettings.sheetsWebappUrl !== undefined) {
    await saveSettings({
      sheetsWebappUrl: incomingSettings.sheetsWebappUrl,
      sheetsSpreadsheetId: incomingSettings.sheetsSpreadsheetId,
    });
  }

  await setMeta('baseRevision', snapshot.revision || 0);
  await setMeta('publishedAt', snapshot.at || '');
  await setMeta('publishedBy', snapshot.by || '');
  await setMeta('lastPullAt', now());
  await setMeta('dirty', false);
  return snapshot.revision || 0;
}

/** [업데이트] 로 서버에 올릴 공유 데이터를 모은다 (리포트·사진 blob 제외). */
export async function collectSnapshot() {
  return {
    guides: await idb.getAll('guides'),
    vehicles: await idb.getAll('vehicles'),
    inventory: await idb.getAll('inventory'),
    fields: await idb.getAll('fields'),
  };
}

/** 아직 서버에 없는(기기에만 있는) 가이드 사진 목록 */
export async function localOnlyGuideMedia() {
  const referenced = new Set();
  for (const guide of await idb.getAll('guides')) {
    for (const step of guide.steps || []) {
      const url = step.imageUrl || '';
      if (url.startsWith('/media/')) referenced.add(url.slice('/media/'.length));
    }
  }
  return (await idb.getAll('media'))
    .filter((m) => m.localOnly && referenced.has(m.filename));
}

export async function markMediaSynced(filename) {
  const row = await idb.get('media', filename);
  if (row) await idb.put('media', { ...row, localOnly: false });
}

export async function isEmpty() {
  return (await idb.count('guides')) === 0 && (await idb.count('fields')) === 0;
}
