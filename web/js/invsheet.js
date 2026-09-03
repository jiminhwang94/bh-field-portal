// 차량 재고 ↔ 구글 스프레드시트('차량재고' 탭) 동기화.
//
// 구글 시트 연결(웹 앱 URL)이 있으면 항상 켜지며, 시트가 팀 공유 원본이 된다.
//  - 수량 [-]/[+]      → 대기열에 쌓였다가 시트의 해당 칸에 바로 기록
//  - 차량·품목 추가/삭제 → 탭 전체를 기기 내용으로 다시 쓰기
//  - 재고 화면 열기      → 시트 내용을 받아와 기기에 반영
//    (시트에서 직접 고친 차량 이름·품목·수량도 이때 내려온다)
import * as store from './local/store.js';
import { callAppsScript } from './sheets.js';

export const isEnabled = () => store.sheetInventoryOn();

/**
 * 시트 내용을 받아 기기에 반영한다.
 * 시트에 '차량재고' 탭이 아직 없으면 기기 재고로 탭을 만들어 채운다(최초 1회).
 */
export async function pullInventory() {
  const result = await callAppsScript({ inventory: 'pull' }, 30000);
  if (result.exists === false) return pushInventory();
  await store.applyInventorySheet(result);
  return result;
}

/**
 * 기기 재고 상태로 시트 탭을 다시 쓴다 (차량·품목 구조 변경 반영).
 *
 * `changes` 가 있으면 **시트 것과 합쳐서** 올린다. 내가 안 건드린 차량·품목은
 * 시트에 있는 그대로 두고, 내가 만든·고친·지운 것만 얹는다. 이게 없으면
 * 마지막에 올린 사람의 기기 내용이 다른 사람의 추가·삭제를 통째로 덮어쓴다.
 * 재고는 ID 가 아니라 **(차량, 부품명)** 으로 같은 줄을 알아본다.
 */
export async function pushInventory(changes = null) {
  const mine = await store.collectInventoryState();
  const state = await mergeWithSheet(mine, changes);
  const result = await callAppsScript({ inventory: 'push', ...state }, 60000);
  await store.applyInventorySheet(result);
  return result;
}

async function mergeWithSheet(mine, changes) {
  if (!changes || !changes.length) return mine;
  let sheet;
  try { sheet = await callAppsScript({ inventory: 'pull' }, 30000); }
  catch { return mine; }
  if (!sheet || sheet.exists === false) return mine;

  const key = (v, p) => store.qtyKey(String(v || '').trim(), String(p || '').trim());
  // 내가 건드린 줄 — 바꾸기 전 모습과 지금 모습 양쪽의 키를 모두 "내 것" 으로 본다
  // (부품명을 고쳤으면 옛 이름 줄은 빠지고 새 이름 줄이 들어가야 한다).
  const touchedKeys = new Set();
  const touchedVehicles = new Set();
  const mineByKey = new Map(mine.items.map((i) => [key(i.vehicleName, i.partName), i]));
  const mineIds = new Map();
  for (const row of await (await import('./local/idb.js')).getAll('inventory')) {
    mineIds.set(row.id, row);
  }
  for (const c of changes) {
    if (c.kind === 'vehicle') { touchedVehicles.add(String(c.id).trim()); continue; }
    if (c.before) touchedKeys.add(key(c.before.vehicleName, c.before.partName));
    const cur = mineIds.get(c.id);
    if (cur) touchedKeys.add(key(cur.vehicleName, cur.partName));
  }

  const items = [];
  const seen = new Set();
  for (const row of sheet.items || []) {
    const k = key(row.vehicleName, row.partName);
    if (seen.has(k)) continue;
    seen.add(k);
    const v = String(row.vehicleName || '').trim();
    if (touchedVehicles.has(v) && !mine.vehicles.includes(v)) continue;  // 내가 지운 차량
    if (touchedKeys.has(k)) {
      if (mineByKey.has(k)) items.push(mineByKey.get(k));   // 고친 것. 지운 것은 빠진다.
      continue;
    }
    items.push(mineByKey.has(k) ? mineByKey.get(k) : row);  // 안 건드린 것
  }
  for (const i of mine.items) {                              // 내가 새로 만든 것
    const k = key(i.vehicleName, i.partName);
    if (touchedKeys.has(k) && !seen.has(k)) items.push(i);
  }

  // 차량 목록 — 시트 순서 + 내가 새로 만든 차량, 내가 지운 차량은 빠진다
  const vehicles = [];
  for (const v of sheet.vehicles || []) {
    const name = String(v || '').trim();
    if (!name || vehicles.includes(name)) continue;
    if (touchedVehicles.has(name) && !mine.vehicles.includes(name)) continue;
    vehicles.push(name);
  }
  for (const name of mine.vehicles) if (!vehicles.includes(name)) vehicles.push(name);
  for (const i of items) if (!vehicles.includes(i.vehicleName)) vehicles.push(i.vehicleName);
  return { vehicles, items };
}

/** 수량 변경분만 시트의 해당 칸에 기록하고, 시트의 최신 상태를 받아온다. */
export async function pushQuantityOps(ops) {
  const result = await callAppsScript({ inventory: 'qty', ops }, 30000);
  return result;
}
