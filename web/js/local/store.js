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
async function queueSheetPushIfOn(changes = []) {
  if (await sheetInventoryOn()) await enqueue({ type: 'invsheet-push', changes });
}

async function queueGuideSheetPushIfOn(changes = []) {
  if (await sheetInventoryOn()) await enqueue({ type: 'guidesheet-push', changes });
}

/** 항목은 **팀 공통**이라 한 사람이 바꾸면 모두가 같이 바뀌어야 한다. */
async function queueFieldSheetPushIfOn(changes = []) {
  if (await sheetInventoryOn()) await enqueue({ type: 'fieldsheet-push', changes });
}

// ---------------------------------------------------------------- 설정

const SETTING_DEFAULTS = {
  sheetsWebappUrl: '',
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
  await queueGuideSheetPushIfOn([{ kind: 'guide', id: row.id, before: existing || null }]);
  return guideOut(row, true);
}

export async function deleteGuide(id) {
  const existing = await idb.get('guides', id);
  if (!existing) return false;
  await idb.remove('guides', id);
  await queueGuideSheetPushIfOn([{ kind: 'guide', id, before: existing }]);
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
  await queueSheetPushIfOn([{ kind: 'vehicle', id: name, before: null }]);
  return { name, itemCount: 0 };
}

export async function deleteVehicle(name) {
  name = (name || '').trim();
  const exists = await idb.get('vehicles', name);
  const items = (await idb.getAll('inventory')).filter((i) => i.vehicleName === name);
  if (!exists && !items.length) return null;
  const live = await quantityMap();
  const changes = [];
  if (exists) changes.push({ kind: 'vehicle', id: name, before: exists });
  for (const item of items) {
    const q = live.get(qtyKey(name, item.partName));
    changes.push({ kind: 'item', id: item.id,
                   before: { ...item, quantity: q ? q.quantity : item.quantity } });
    await idb.remove('inventory', item.id);
    await idb.remove('quantities', qtyKey(name, item.partName));
    await enqueue({ type: 'quantity-delete', vehicleName: name, partName: item.partName });
  }
  if (exists) await idb.remove('vehicles', name);
  await queueSheetPushIfOn(changes);
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
  const key = qtyKey(vehicleName, partName);
  const value = Math.max(0, Number(quantity) || 0);
  const updatedAt = stamp || now();

  // 바꾸기 **전** 값을 함께 적어 둔다. [올릴 내용] 목록에서 이 변경을 지우면
  // 이 값으로 되돌린다 — 취소했는데 엉뚱한 수량이 남으면 안 된다.
  const prev = await idb.get('quantities', key);
  const before = prev ? prev.quantity : null;

  await idb.put('quantities', {
    key, vehicleName, partName, quantity: value, updatedAt,
  });
  await enqueue({ type: 'quantity', vehicleName, partName,
                  quantity: value, before, updatedAt });
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
  const changes = [{ kind: 'item', id: row.id, before: null }];

  // 품목은 모든 차량 공용 — 다른 차량에도 수량 0 으로 함께 등록한다.
  for (const vehicle of await listVehicles()) {
    if (vehicle === vehicleName) continue;
    if (rows.some((r) => r.vehicleName === vehicle && r.partName === partName)) continue;
    const sibling = {
      id: newId(), vehicleName: vehicle, partName,
      quantity: 0, minQuantity: row.minQuantity, updatedAt: stamp,
    };
    await idb.put('inventory', sibling);
    await setQuantity(vehicle, partName, 0, stamp);
    changes.push({ kind: 'item', id: sibling.id, before: null });
  }

  await queueSheetPushIfOn(changes);
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
  const changes = siblings.map((item) => ({ kind: 'item', id: item.id, before: item }));
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
  if (nameChanged || minChanged) await queueSheetPushIfOn(changes);

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
  const live = await quantityMap();
  const changes = [];
  for (const item of siblings) {
    const q = live.get(qtyKey(item.vehicleName, item.partName));
    changes.push({ kind: 'item', id: item.id,
                   before: { ...item, quantity: q ? q.quantity : item.quantity } });
    await idb.remove('inventory', item.id);
    await idb.remove('quantities', qtyKey(item.vehicleName, item.partName));
    await enqueue({ type: 'quantity-delete', vehicleName: item.vehicleName,
                    partName: item.partName });
  }
  await queueSheetPushIfOn(changes);
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
  await queueFieldSheetPushIfOn([{ kind: 'field', id: row.id, before: existing || null }]);
  return { ...row, isRequired: Boolean(row.isRequired) };
}

export async function deleteField(fieldId) {
  const existing = await idb.get('fields', fieldId);
  if (!existing) return false;
  await idb.remove('fields', fieldId);
  await queueFieldSheetPushIfOn([{ kind: 'field', id: fieldId, before: existing }]);
  return true;
}

export async function reorderFields(orderedIds) {
  const changes = [];
  for (let i = 0; i < orderedIds.length; i += 1) {
    const row = await idb.get('fields', orderedIds[i]);
    if (!row) continue;
    if (row.displayOrder !== i + 1) changes.push({ kind: 'field', id: row.id, before: row });
    await idb.put('fields', { ...row, displayOrder: i + 1 });
  }
  if (changes.length) await queueFieldSheetPushIfOn(changes);
  return listFields();
}

// ------------------------------------------------------------- 리포트

const reportOut = (r) => ({
  id: r.id, title: r.title, payload: r.payload || [], status: r.status,
  sheetName: r.sheetName || null, sheetRow: r.sheetRow || null,
  // 이력에서 [이어서 작성] 으로 온 경우, 고쳐 쓸 시트 줄
  sheetLink: r.sheetLink || null,
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
    sheetLink: payload.sheetLink !== undefined
      ? payload.sheetLink : (existing ? existing.sheetLink : null),
    sheetName: existing ? existing.sheetName : null,
    sheetRow: existing ? existing.sheetRow : null,
    errorMessage: existing ? existing.errorMessage : null,
    createdAt: existing ? existing.createdAt : stamp,
    updatedAt: stamp,
  };
  await idb.put('reports', row);        // 리포트는 기기 전용 — 시트에 올릴 때만 밖으로 나간다
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

// ------------------------------------------------------- 기본 리포트 항목

/**
 * 리포트 항목은 **앱에 붙박이로 들어 있다.**
 *
 * 예전에는 기기가 비어 있으면 사무실 서버에서 받아왔다. 그런데 APK 로 새로
 * 설치하면 서버 주소를 모르니 항목이 **하나도 없는 상태**로 시작했고,
 * 급한 대로 항목을 하나 만들어 올리면 구글 시트의 열 순서가 통째로 바뀌어
 * **이미 쌓여 있던 리포트가 어긋났다.**
 *
 * 그래서 기본 항목을 앱 안에 고정으로 넣는다. 어느 기기에서 설치해도 같은
 * 순서, 같은 열이다. 항목을 바꾸고 싶으면 [설정 → 리포트 항목 설정] 에서
 * 바꿀 수 있고, 그때는 시트도 **새 탭**에 새로 시작한다 (기존 탭은 그대로 둔다).
 */
export const DEFAULT_FIELDS = [
  { fieldLabel: '방문 식당명', fieldType: 'TEXT', options: null, isRequired: true },
  { fieldLabel: '로봇 시리얼', fieldType: 'TEXT', options: null, isRequired: true },
  { fieldLabel: '오류 코드', fieldType: 'TEXT', options: null, isRequired: false },
  { fieldLabel: '증상 요약', fieldType: 'TEXTAREA', options: null, isRequired: true },
  { fieldLabel: '조치 내용', fieldType: 'TEXTAREA', options: null, isRequired: true },
  { fieldLabel: '사용 부품', fieldType: 'TEXT', options: null, isRequired: false },
  { fieldLabel: '소요 시간(분)', fieldType: 'NUMBER', options: null, isRequired: false },
  { fieldLabel: '처리 결과', fieldType: 'DROPDOWN',
    options: '완료,재방문 필요,부품 대기,모니터링', isRequired: true },
  { fieldLabel: '현장 사진', fieldType: 'MEDIA', options: null, isRequired: false },
];

/** 항목이 하나도 없을 때만 기본값을 넣는다. 있으면 손대지 않는다. */
export async function ensureDefaultFields() {
  if ((await idb.count('fields')) > 0) return 0;
  const stamp = now();
  let order = 1;
  for (const f of DEFAULT_FIELDS) {
    await idb.put('fields', {
      id: newId(), fieldLabel: f.fieldLabel, fieldType: f.fieldType,
      options: f.options, isRequired: f.isRequired,
      displayOrder: order, createdAt: stamp,
    });
    order += 1;
  }
  return DEFAULT_FIELDS.length;
}
