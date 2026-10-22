// 차량 재고 ↔ 구글 스프레드시트('차량재고' 탭) 동기화.
//
// 구글 시트 연결(웹 앱 URL)이 있으면 항상 켜지며, 시트가 팀 공유 원본이 된다.
//  - 수량 [-]/[+]      → 대기열에 쌓였다가 시트의 해당 칸에 바로 기록
//  - 차량·품목 추가/삭제 → 탭 전체를 기기 내용으로 다시 쓰기
//  - 재고 화면 열기      → 시트 내용을 받아와 기기에 반영
//    (시트에서 직접 고친 차량 이름·품목·수량도 이때 내려온다)
import * as store from './local/store.js';
import { callAppsScript } from './sheets.js';
import { sheetRead } from './sync.js';

export const isEnabled = () => store.sheetInventoryOn();

/**
 * 시트의 차량 재고를 기기에 반영한다.
 * 시트에 '차량재고' 탭이 아직 없으면 기기 재고로 탭을 만들어 채운다(최초 1회).
 *
 * 반환: { vehicles, items, changed } — `changed` 가 false 면 시트 내용이
 * 지난번과 똑같아서 아무것도 건드리지 않았다는 뜻이다. 부르는 쪽은 이걸 보고
 * **화면을 다시 그릴지** 정한다.
 */
export function pullInventory() {
  return sheetRead(async () => {
    const result = await callAppsScript({ inventory: 'pull' }, 30000);
    if (result.exists === false) {
      await pushInventory();
      return { vehicles: 0, items: 0, changed: false };
    }
    return store.applyInventorySheet(result);
  });
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
  // 시트를 못 읽으면 **올리지 않는다** (오류를 그대로 넘겨 대기열에 남긴다).
  // 예전에는 기기 내용을 통째로 올렸다. 그러면 그사이 다른 사람이 지운 품목이
  // 되살아나고, 다른 사람이 바꾼 수량이 내 옛 값으로 덮였다.
  const sheet = await callAppsScript({ inventory: 'pull' }, 30000);
  if (!sheet || sheet.exists === false) return mine;

  const key = (v, p) => store.qtyKey(String(v || '').trim(), String(p || '').trim());
  const { keys: touchedKeys, vehicles: touchedVehicles, reordered } =
    await store.touchedInventory(changes);
  const myQty = await store.pendingQuantityKeys();
  const mineByKey = new Map(mine.items.map((i) => [key(i.vehicleName, i.partName), i]));

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
    // 안 건드린 줄은 **시트 것**이다. 기기 것을 쓰면 남이 바꾼 수량·최소보유가
    // 내가 마지막으로 받은 옛 값으로 되돌아간다. 아직 못 올린 내 수량만 얹는다.
    items.push(myQty.has(k) && mineByKey.has(k)
      ? { ...row, quantity: mineByKey.get(k).quantity }
      : row);
  }
  const sheetVehicles = new Set((sheet.vehicles || []).map((v) => String(v || '').trim()));
  for (const i of mine.items) {                              // 내가 새로 만든 것
    const k = key(i.vehicleName, i.partName);
    if (!touchedKeys.has(k) || seen.has(k)) continue;
    // 새 품목은 기기의 모든 차량에 함께 생긴다. 그중 시트에 없는 차량(남이 지운
    // 것)의 줄은 올리지 않는다 — 올리면 지워진 차량이 통째로 되살아난다.
    if (!sheetVehicles.has(i.vehicleName) && !touchedVehicles.has(i.vehicleName)) continue;
    items.push(i);
  }

  // 차량 목록 — 시트 순서 + 내가 새로 만든 차량, 내가 지운 차량은 빠진다.
  // 내가 건드리지 않은 기기 차량은 붙이지 않는다 — 다른 사람이 지운 차량이다.
  const vehicles = [];
  for (const v of sheet.vehicles || []) {
    const name = String(v || '').trim();
    if (!name || vehicles.includes(name)) continue;
    if (touchedVehicles.has(name) && !mine.vehicles.includes(name)) continue;
    vehicles.push(name);
  }
  for (const name of mine.vehicles) {
    if (touchedVehicles.has(name) && !vehicles.includes(name)) vehicles.push(name);
  }
  for (const i of items) if (!vehicles.includes(i.vehicleName)) vehicles.push(i.vehicleName);

  // 내가 순서를 바꿨으면 **내 순서**로 늘어놓는다. 내가 모르는 부품(남이 그새 만든 것)은
  // 시트에 있던 자리 순서대로 뒤에 붙는다. 줄 자체는 하나도 잃지 않는다.
  if (reordered) {
    const seq = [];
    for (const i of mine.items) if (!seq.includes(i.partName)) seq.push(i.partName);
    const rank = (p) => { const k = seq.indexOf(p); return k < 0 ? 1e9 : k; };
    items.sort((a, b) => rank(a.partName) - rank(b.partName));
  }
  return { vehicles, items };
}

/** 수량 변경분만 시트의 해당 칸에 기록하고, 시트의 최신 상태를 받아온다. */
export async function pushQuantityOps(ops) {
  const result = await callAppsScript({ inventory: 'qty', ops }, 30000);
  return result;
}
