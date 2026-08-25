// 차량 재고 ↔ 구글 스프레드시트('차량재고' 탭) 동기화.
//
// 설정에서 [차량 재고를 구글 시트로 관리]를 켜면 시트가 팀 공유 원본이 된다.
//  - 수량 [-]/[+]      → 대기열에 쌓였다가 시트의 해당 칸에 바로 기록
//  - 차량·품목 추가/삭제 → 탭 전체를 기기 내용으로 다시 쓰기
//  - 재고 화면 열기      → 시트 내용을 받아와 기기에 반영
//    (시트에서 직접 고친 차량 이름·품목·수량도 이때 내려온다)
import * as store from './local/store.js';
import { callAppsScript } from './sheets.js';

export const isEnabled = () => store.sheetInventoryOn();

/** 시트 내용을 받아 기기에 반영한다. */
export async function pullInventory() {
  const result = await callAppsScript({ inventory: 'pull' }, 30000);
  if (result.exists === false) return { exists: false, vehicles: [], items: [] };
  await store.applyInventorySheet(result);
  return result;
}

/** 기기 재고 상태로 시트 탭 전체를 다시 쓴다 (차량·품목 구조 변경 반영). */
export async function pushInventory() {
  const state = await store.collectInventoryState();
  const result = await callAppsScript({ inventory: 'push', ...state }, 60000);
  await store.applyInventorySheet(result);
  return result;
}

/** 수량 변경분만 시트의 해당 칸에 기록하고, 시트의 최신 상태를 받아온다. */
export async function pushQuantityOps(ops) {
  const result = await callAppsScript({ inventory: 'qty', ops }, 30000);
  return result;
}

/**
 * 처음 켤 때 1회: 시트가 비어 있으면 기기 내용으로 채우고,
 * 이미 내용이 있으면 그쪽을 받아온다.
 */
export async function seedOrAdopt() {
  const pulled = await callAppsScript({ inventory: 'pull' }, 30000);
  const empty = pulled.exists === false
    || (!(pulled.items || []).length && !(pulled.vehicles || []).length);
  if (empty) {
    const result = await pushInventory();
    return { seeded: true, ...result };
  }
  await store.applyInventorySheet(pulled);
  return { seeded: false, ...pulled };
}
