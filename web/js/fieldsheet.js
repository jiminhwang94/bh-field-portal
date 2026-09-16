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

/**
 * 항목 설정을 시트로 내보낸다.
 * `changes` 가 있으면 시트 것과 합친다 (가이드와 같은 규칙). 순서는 시트 순서를
 * 따르고, 내가 새로 만든 항목은 뒤에 붙는다.
 */
export async function pushFields(changes = null) {
  const items = await mergeWithSheet(await store.listFields(), changes);
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
 * 항목을 알아보는 기준은 **이름**이다.
 *
 * ID 로만 맞추면 안 된다. 기기마다 같은 항목에 다른 ID 를 들고 있을 수 있고,
 * 그러면 "시트에 없는 항목" 으로 보여 **같은 이름이 두 줄로 쌓인다.**
 * (실제로 [로봇 모델] 이 선택지만 다른 두 줄로 갈라졌다.)
 * 띄어쓰기 차이도 같은 항목으로 본다.
 */
const labelKey = (f) => String((f && f.fieldLabel) || '').replace(/\s/g, '');

async function mergeWithSheet(local, changes) {
  let sheet;
  try { sheet = (await callAppsScript({ fields: 'pull' }, 60000)).items || []; }
  catch { return local; }
  if (!sheet.length) return local;

  // **시트 순서를 그대로 둔다.** 아래에서 시트 줄 차례로 담기 때문에, 내가
  // 기기에서 옮겨 둔 순서는 올라가지 않는다 (순서는 기기마다 따로다).
  const edits = changes || [];
  const touched = new Set(edits.map((c) => c.id));
  const localIds = new Set(local.map((f) => f.id));
  // 내가 지운 항목 — 시트에서도 빠져야 한다 (제거는 팀 공통).
  // ID 는 기기마다 다를 수 있어 **이름**으로 알아본다.
  const removed = new Set(edits
    .filter((c) => c.before && !localIds.has(c.id))
    .map((c) => labelKey(c.before)));

  const mineById = new Map(local.map((f) => [f.id, f]));
  const mineByLabel = new Map(local.map((f) => [labelKey(f), f]));

  const out = [];
  const usedLabels = new Set();
  const usedIds = new Set();
  /** 같은 이름·같은 ID 는 한 번만 넣는다 (시트에 이미 중복이 있어도). */
  const add = (f) => {
    const key = labelKey(f);
    if (!key || usedLabels.has(key) || usedIds.has(f.id)) return;
    usedLabels.add(key);
    usedIds.add(f.id);
    out.push(f);
  };

  const handled = new Set();      // 시트 줄에 짝지어진 내 항목
  for (const row of sheet) {
    if (removed.has(labelKey(row))) continue;      // 내가 지운 항목
    const mineHere = (row.id && mineById.get(row.id)) || mineByLabel.get(labelKey(row));
    if (!mineHere) { add(row); continue; }
    handled.add(mineHere.id);
    // 방금 고친 항목이면 내 것으로 덮되 **ID 는 시트를 따른다** — 기기마다
    // ID 가 달라지지 않아야 다음 번에 또 갈라지지 않는다.
    // 안 고친 항목은 시트 것을 그대로 둔다.
    add(touched.has(mineHere.id)
      ? { ...mineHere, id: row.id || mineHere.id }
      : row);
  }
  // 내가 새로 만든 항목만 뒤에 붙인다 (시트에 같은 이름이 없을 때만)
  for (const f of local) {
    if (touched.has(f.id) && !handled.has(f.id)) add(f);
  }
  return out;
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
  const byLabel = new Map(local.map((f) => [labelKey(f), f]));

  const seen = new Set();
  const seenLabels = new Set();
  let changed = 0;
  let added = 0;
  const stamp = store.now();
  // 순서는 **이 기기 것을 지킨다.** 시트 순서로 덮으면 다른 사람이 자기
  // 태블릿에서 항목을 옮길 때마다 내가 맞춰 둔 양식이 날아간다.
  // 남이 새로 만든 항목만 내 목록 맨 뒤에 붙인다.
  let lastOrder = local.reduce(
    (max, f) => Math.max(max, Number(f.displayOrder) || 0), 0);

  for (const row of rows) {
    // 시트에 같은 이름이 두 줄 있어도 기기에는 하나만 둔다.
    const key = labelKey(row);
    if (!key || seenLabels.has(key)) continue;
    seenLabels.add(key);

    const found = (row.id && byId.get(row.id)) || byLabel.get(key);
    const next = {
      // **ID 는 시트를 따른다.** 예전에는 시트 줄을 못 알아보면 기기가 ID 를
      // 새로 지어냈다. 그러면 기기마다 같은 항목의 ID 가 달라지고, 올릴 때
      // 서로 "시트에 없는 항목" 으로 보여 같은 이름이 두 줄로 쌓였다.
      id: row.id || (found ? found.id : store.newId()),
      fieldLabel: row.fieldLabel,
      fieldType: row.fieldType,
      options: row.options || null,
      isRequired: !!row.isRequired,
      displayOrder: found ? found.displayOrder : (lastOrder += 1),
      createdAt: found ? found.createdAt : stamp,
    };
    seen.add(next.id);
    if (!found) { await idb.put('fields', next); added += 1; continue; }
    // ID 가 시트 것으로 바뀌는 경우도 다시 써야 한다. 안 그러면 옛 ID 짜리가
    // 아래 정리에서 지워지면서 항목이 통째로 사라진다.
    const same = found.id === next.id
      && found.fieldLabel === next.fieldLabel
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
