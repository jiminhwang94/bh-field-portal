// 기기 저장소 — 차량 · 재고 · 품목 순서 · 재고 ↔ 시트 변환.
// (store.js 가 전부 다시 내보낸다 — 밖에서는 store.js 만 부른다)
import * as idb from './idb.js';
import { testMode } from '../mode.js';
import { byText, enqueue, getMeta, newId, now, outbox, qtyKey, queueSheetPushIfOn, serialize, setMeta } from './store-core.js';

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

// ------------------------------------------------ 품목 순서 · 분류
//
// 품목 목록은 차량 공용이므로 **순서도 공용**이다. 순서는 부품명 배열 하나
// (meta.partOrder)로 들고 다니고, 시트의 [차량재고] 탭 줄 순서와 같다.
// 분류(category)는 품목마다 한 칸 — 같은 부품은 모든 차량에서 같은 분류다.
const PART_ORDER_KEY = 'partOrder';

export async function partOrder() {
  return (await getMeta(PART_ORDER_KEY, [])) || [];
}

/**
 * 부품명을 보여 줄 순서로 늘어놓는다.
 *  · 기본은 partOrder 순서, 거기 없는 것은 이름순으로 뒤에
 *  · **같은 분류는 이어서** — 묶음 순서는 그 분류가 처음 나오는 자리, '분류 없음' 은 맨 뒤
 * 시트에도 이 순서로 적히므로 사람이 시트를 열어도 분류끼리 모여 있다.
 */
export function orderParts(rows, order) {
  const idx = new Map((order || []).map((n, i) => [n, i]));
  const cat = new Map();
  for (const r of rows) {
    if (!cat.has(r.partName) || (r.category && !cat.get(r.partName))) cat.set(r.partName, r.category || '');
  }
  const base = [...new Set(rows.map((r) => r.partName))].sort((a, b) => {
    const ia = idx.has(a) ? idx.get(a) : 1e9;
    const ib = idx.has(b) ? idx.get(b) : 1e9;
    return (ia - ib) || byText(a, b);
  });
  const groupRank = new Map();
  for (const p of base) {
    const c = cat.get(p) || '';
    if (c && !groupRank.has(c)) groupRank.set(c, groupRank.size);
  }
  return [...base].sort((a, b) => {
    const ca = cat.get(a) || '';
    const cb = cat.get(b) || '';
    if (ca !== cb) {
      if (!ca) return 1;
      if (!cb) return -1;
      return groupRank.get(ca) - groupRank.get(cb);
    }
    return base.indexOf(a) - base.indexOf(b);
  });
}

/**
 * 순서를 바꾼다 (손잡이로 끌어 놓은 결과). 시트에는 줄 순서로 올라간다.
 * 되돌리기를 위해 바꾸기 전 순서를 함께 남긴다.
 */
export async function reorderParts(order) {
  const before = await partOrder();
  const next = [];
  for (const raw of order || []) {
    const name = String(raw || '').trim();
    if (name && !next.includes(name)) next.push(name);
  }
  if (next.join('|') === before.join('|')) return next;
  await setMeta(PART_ORDER_KEY, next);
  await queueSheetPushIfOn([{ kind: 'order', id: PART_ORDER_KEY, before }]);
  return next;
}

export async function listInventory(vehicleName = null) {
  const all = await idb.getAll('inventory');
  const sequence = orderParts(all, await partOrder());
  const rank = new Map(sequence.map((n, i) => [n, i]));
  let rows = vehicleName ? all.filter((i) => i.vehicleName === vehicleName) : all;
  rows = [...rows].sort((a, b) => (rank.get(a.partName) - rank.get(b.partName))
    || byText(a.vehicleName, b.vehicleName));
  const live = await quantityMap();
  const pending = await pendingQuantityKeys();
  return rows.map((r) => {
    const key = qtyKey(r.vehicleName, r.partName);
    const q = live.get(key);
    return {
      id: r.id,
      vehicleName: r.vehicleName,
      partName: r.partName,
      category: r.category || '',
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
  // opId — 같은 작업을 다시 보내도(응답을 못 받은 재시도) 시트가 두 번 더하지 않게 한다.
  await enqueue({ type: 'quantity', vehicleName, partName,
                  quantity: value, before, updatedAt, opId: newId() });
  return value;
}

export function addInventoryItem(...args) {
  return serialize(() => _addInventoryItem(...args));
}

async function _addInventoryItem(vehicleName, partName, quantity = 0,
                                       minQuantity = 0, category = '') {
  vehicleName = (vehicleName || '').trim();
  partName = (partName || '').trim();
  category = String(category || '').trim();
  if (!vehicleName || !partName) throw new Error('차량과 부품명은 필수입니다.');
  const rows = await idb.getAll('inventory');
  if (rows.some((r) => r.vehicleName === vehicleName && r.partName === partName)) {
    throw new Error('이미 등록된 부품입니다.');
  }
  const newVehicle = !(await idb.get('vehicles', vehicleName));
  if (newVehicle) {
    const order = (await idb.getAll('vehicles'))
      .reduce((max, v) => Math.max(max, v.displayOrder || 0), 0) + 1;
    await idb.put('vehicles', { name: vehicleName, displayOrder: order, createdAt: now() });
  }
  const stamp = now();
  const row = {
    id: newId(), vehicleName, partName, category,
    quantity: Math.max(0, Number(quantity) || 0),
    minQuantity: Math.max(0, Number(minQuantity) || 0),
    updatedAt: stamp,
  };
  await idb.put('inventory', row);
  await setQuantity(vehicleName, partName, row.quantity, stamp);
  // 새 품목은 순서의 맨 뒤 (같은 분류 안에서 뒤) — 보여 줄 때 분류끼리 모인다.
  const order = await partOrder();
  if (!order.includes(partName)) await setMeta(PART_ORDER_KEY, [...order, partName]);
  const changes = [{ kind: 'item', id: row.id, before: null }];
  // 차량도 새로 생겼으면 적어 둔다 — 시트에 없는 차량의 품목은 "남이 지운 차량"
  // 으로 보고 올리지 않으므로, 내가 만든 차량인지 알아야 한다.
  if (newVehicle) changes.push({ kind: 'vehicle', id: vehicleName, before: null });

  // 품목은 모든 차량 공용 — 다른 차량에도 수량 0 으로 함께 등록한다.
  for (const vehicle of await listVehicles()) {
    if (vehicle === vehicleName) continue;
    if (rows.some((r) => r.vehicleName === vehicle && r.partName === partName)) continue;
    const sibling = {
      id: newId(), vehicleName: vehicle, partName, category,
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

/**
 * @param {string} itemId
 * @param {{ delta?: number, quantity?: number, minQuantity?: number, partName?: string, category?: string }} [patch]
 */
async function _updateInventoryItem(itemId, { delta, quantity, minQuantity,
                                              partName, category } = {}) {
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

  const nextCat = category === undefined || category === null
    ? (row.category || '') : String(category).trim();
  const nameChanged = nextName !== row.partName;
  const minChanged = nextMin !== row.minQuantity;
  const catChanged = nextCat !== (row.category || '');
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
                                 category: nextCat, updatedAt: stamp });
    if (nameChanged && item.id !== itemId) {
      const old = live.get(qtyKey(item.vehicleName, row.partName));
      await idb.remove('quantities', qtyKey(item.vehicleName, row.partName));
      await enqueue({ type: 'quantity-delete', vehicleName: item.vehicleName,
                      partName: row.partName });
      await setQuantity(item.vehicleName, nextName,
                        old ? old.quantity : item.quantity, stamp);
    }
  }
  if (nameChanged) {
    const order = await partOrder();
    await setMeta(PART_ORDER_KEY, order.map((n) => (n === row.partName ? nextName : n)));
  }
  if (nameChanged || minChanged || catChanged) await queueSheetPushIfOn(changes);

  if (nameChanged) {
    await idb.remove('quantities', qtyKey(row.vehicleName, row.partName));
    await enqueue({ type: 'quantity-delete', vehicleName: row.vehicleName,
                    partName: row.partName });
  }
  await setQuantity(row.vehicleName, nextName, nextQty, stamp);
  return { id: itemId, vehicleName: row.vehicleName, partName: nextName, category: nextCat,
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
      category: i.category || '',
      quantity: i.quantity,
      minQuantity: i.minQuantity,
    })),
  };
}

/**
 * 차량·품목 변경(changes)이 건드린 줄.
 *  keys     — (차량, 부품) 키. 바꾸기 전 모습과 지금 모습 양쪽을 다 넣는다
 *             (부품명을 고쳤으면 옛 이름 줄은 빠지고 새 이름 줄이 들어가야 한다).
 *  vehicles — 만들거나 지운 차량 이름
 *  reordered — 품목 순서를 바꿨는가
 */
export async function touchedInventory(changes) {
  const byId = new Map((await idb.getAll('inventory')).map((r) => [r.id, r]));
  const trim = (v) => String(v || '').trim();
  const keys = new Set();
  const vehicles = new Set();
  let reordered = false;
  for (const c of changes || []) {
    if (c.kind === 'order') { reordered = true; continue; }
    if (c.kind === 'vehicle') { vehicles.add(trim(c.id)); continue; }
    if (c.before) keys.add(qtyKey(trim(c.before.vehicleName), trim(c.before.partName)));
    const cur = byId.get(c.id);
    if (cur) keys.add(qtyKey(cur.vehicleName, cur.partName));
  }
  return { keys, vehicles, reordered };
}

/**
 * 구글 시트에서 받은 재고 상태를 기기에 반영한다.
 * (시트가 공유 원본 — 차량 이름 변경·품목 추가/삭제도 여기로 내려온다)
 *
 * 아직 시트로 보내지 못한 **내 변경은 시트 위에 다시 얹는다.**
 *  - 수량 변경(quantity)        → 기기 수량을 지킨다
 *  - 차량·품목 변경(invsheet-push) → 내가 건드린 줄은 기기 모습을 따른다.
 *    만든 것·고친 것은 남기고, **지운 것은 시트에 아직 있어도 되살리지 않는다.**
 *
 * 예전에는 지운 것을 지키지 않았다. 올리기가 한 번 실패하거나 받기와 겹치면
 * 지운 품목이 시트에서 되살아났고, 다음 올리기가 그 되살아난 것을 "내 것" 으로
 * 다시 올려 **삭제가 사라졌다.**
 */
export async function applyInventorySheet(state) {
  const pushOps = (await idb.getAll('outbox')).filter((op) => op.type === 'invsheet-push');
  // 무엇을 바꿨는지 적혀 있지 않은 옛 대기열이면 기기에만 있는 줄을 전부 지킨다.
  const keepAllMine = pushOps.some((op) => !(op.changes || []).length);
  const touched = await touchedInventory(pushOps.flatMap((op) => op.changes || []));
  const myVehicles = new Set((await idb.getAll('vehicles')).map((v) => v.name));
  const deletedByMe = (name) => touched.vehicles.has(name) && !myVehicles.has(name);

  const stamp = now();
  const names = [];
  for (const raw of state.vehicles || []) {
    const name = String(raw || '').trim();
    if (name && !names.includes(name) && !deletedByMe(name)) names.push(name);
  }
  for (const item of state.items || []) {
    const name = String(item.vehicleName || '').trim();
    if (name && !names.includes(name) && !deletedByMe(name)) names.push(name);
  }
  // 내가 새로 만든 차량 (품목이 아직 없어도 남긴다)
  for (const name of touched.vehicles) {
    if (myVehicles.has(name) && !names.includes(name)) names.push(name);
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
    // 내가 건드린 줄은 아래에서 기기 모습으로 채운다 (지웠으면 채우지 않는다).
    if (touched.keys.has(key) || deletedByMe(vehicleName)) continue;
    seen.add(key);
    const prev = prevItems.get(key);
    const quantity = Math.max(0, Number(item.quantity) || 0);
    inventoryRows.push({
      id: prev ? prev.id : newId(),
      vehicleName,
      partName,
      category: String(item.category || '').trim(),
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

  // 아직 시트에 못 올린 **구조 변경**(차량·품목 추가·수정)은 기기 모습을 지킨다.
  // 시트에는 없지만 기기에만 있는 줄을 지우면, 오프라인에서 추가한 품목이
  // 전송되기도 전에 사라진다. 그 뒤 invsheet-push 는 이미 지워진 상태를 올려
  // 되돌릴 수 없게 된다.
  if (pushOps.length) {
    const sheetVehicles = new Set(names);
    for (const [key, prev] of prevItems) {
      if (seen.has(key)) continue;
      if (!keepAllMine && !touched.keys.has(key)) continue;   // 남이 지운 줄
      // 남이 지운 차량에 내가 덧붙인 품목 (새 품목은 모든 차량에 함께 생긴다)
      if (!keepAllMine && !sheetVehicles.has(prev.vehicleName)
          && !touched.vehicles.has(prev.vehicleName)) continue;
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

  // 시트 내용이 지난번과 **똑같으면 아무것도 하지 않는다.**
  //
  // 예전에는 받아올 때마다 저장소 세 개를 통째로 다시 쓰고, 화면도 무조건
  // 다시 그렸다. 대부분은 바뀐 게 없는데도 그랬다. 그래서 화면에 들어간 뒤
  // 1~2초 있다가 내용이 한 번 덜컥 다시 그려지는 것처럼 보였다.
  // 시트 줄 순서가 곧 품목 순서다. 아직 못 올린 내 순서 변경이 있으면 내 것을 지킨다.
  const sheetOrder = [];
  for (const r of inventoryRows) if (!sheetOrder.includes(r.partName)) sheetOrder.push(r.partName);
  const keepMyOrder = (await idb.getAll('outbox'))
    .some((op) => op.type === 'invsheet-push' && (op.changes || []).some((c) => c.kind === 'order'));
  const nextOrder = keepMyOrder ? await partOrder() : sheetOrder;

  const signature = inventorySignature(vehicleRows, inventoryRows, quantityRows, nextOrder);
  if (signature === (await getMeta('sheetInventorySignature', ''))) {
    await setMeta('sheetInventoryPulledAt', stamp);
    return { vehicles: names.length, items: inventoryRows.length, changed: false };
  }

  await idb.replaceStores({
    vehicles: vehicleRows,
    inventory: inventoryRows,
    quantities: quantityRows,
  });
  await setMeta(PART_ORDER_KEY, nextOrder);
  await setMeta('sheetInventorySignature', signature);
  await setMeta('sheetInventoryPulledAt', stamp);
  return { vehicles: names.length, items: inventoryRows.length, changed: true };
}

/**
 * 재고 상태를 짧은 글자로 요약한다 — 지난번과 같은지 비교하는 데만 쓴다.
 *
 * 시각(updatedAt)은 넣지 않는다. 시트에서 받을 때마다 새 시각이 붙어
 * 내용이 같아도 늘 "달라졌다" 가 되기 때문이다.
 */
function inventorySignature(vehicles, items, quantities, order = []) {
  const qty = new Map(quantities.map((q) => [q.key, q.quantity]));
  const lines = items
    .map((r) => [r.vehicleName, r.partName, r.category || '',
                 qty.get(qtyKey(r.vehicleName, r.partName)), r.minQuantity].join('|'))
    .sort();
  return [vehicles.map((v) => v.name).sort().join(','), (order || []).join(','), ...lines]
    .join(String.fromCharCode(10));
}
