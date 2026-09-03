// 리포트 항목 설정 ↔ 구글 스프레드시트 [리포트 항목] 탭.
//
// 리포트 입력 항목은 **팀 전체가 같아야** 한다. 사람마다 다르면 같은 달
// 시트가 사람 수만큼 갈라지고, 어느 것이 진짜인지 알 수 없게 된다.
// 그래서 가이드와 똑같이 시트에 두고 [⬆ 업데이트] 로 주고받는다.
//
// 시트에 적힌 **순서가 곧 리포트 시트의 열 순서**다.
import * as idb from './local/idb.js';
import * as store from './local/store.js';
import { callAppsScript } from './sheets.js';

export const isEnabled = () => store.sheetInventoryOn();

/** 기기의 항목 설정을 시트로 내보낸다. */
export async function pushFields() {
  const items = await store.listFields();
  return callAppsScript({
    fields: 'push',
    items: items.map((f) => ({
      id: f.id,
      fieldLabel: f.fieldLabel,
      fieldType: f.fieldType,
      options: f.options || '',
      isRequired: !!f.isRequired,
    })),
  }, 60000);
}

/**
 * 시트의 항목 설정을 기기에 반영한다.
 *
 * 안전 규칙.
 *  1. **내가 아직 안 올린 항목 변경이 있으면 받지 않는다.** 시트 내용으로 덮으면
 *     방금 고친 것이 사라진다. 내 것을 먼저 올린 뒤 다음 번에 받는다.
 *  2. 시트가 **비어 있으면 아무것도 하지 않는다.** 아직 아무도 올리지 않았다는
 *     뜻이지, 항목을 전부 지우라는 뜻이 아니다. 이걸 구분하지 않으면
 *     시트를 처음 연결한 기기에서 항목이 통째로 날아간다.
 *
 * 반환: { changed, added, removed }
 */
export async function pullFields() {
  const queued = (await store.outbox()).some((op) => op.type === 'fieldsheet-push');
  if (queued) return { changed: 0, added: 0, removed: 0, skipped: 'pending' };

  const result = await callAppsScript({ fields: 'pull' }, 60000);
  const rows = result.items || [];
  if (!rows.length) return { changed: 0, added: 0, removed: 0 };

  const local = await idb.getAll('fields');
  const byId = new Map(local.map((f) => [f.id, f]));
  // 예전 시트에는 ID 열이 비어 있을 수 있다. 그때 ID 만 믿으면 매번
  // "새 항목" 으로 보고 같은 항목이 두 줄씩 쌓인다 (가이드에서 그랬다).
  const byLabel = new Map(local.map((f) => [f.fieldLabel.trim(), f]));

  const seen = new Set();
  let changed = 0;
  let added = 0;
  const stamp = store.now();

  for (const row of rows) {
    const found = (row.id && byId.get(row.id)) || byLabel.get(row.fieldLabel.trim());
    const next = {
      id: found ? found.id : store.newId(),
      fieldLabel: row.fieldLabel,
      fieldType: row.fieldType,
      options: row.options || null,
      isRequired: !!row.isRequired,
      displayOrder: row.displayOrder,
      createdAt: found ? found.createdAt : stamp,
    };
    seen.add(next.id);
    if (!found) { await idb.put('fields', next); added += 1; continue; }
    const same = found.fieldLabel === next.fieldLabel
      && found.fieldType === next.fieldType
      && (found.options || null) === next.options
      && !!found.isRequired === next.isRequired
      && found.displayOrder === next.displayOrder;
    if (!same) { await idb.put('fields', next); changed += 1; }
  }

  // 시트에서 빠진 항목은 이 기기에서도 뺀다. 항목은 **팀 공통**이라
  // 한쪽에만 남아 있으면 시트가 갈라진다 (가이드와 다른 점이다).
  let removed = 0;
  for (const f of local) {
    if (!seen.has(f.id)) { await idb.remove('fields', f.id); removed += 1; }
  }
  return { changed, added, removed };
}
