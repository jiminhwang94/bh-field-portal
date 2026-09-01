// 가이드 3종 ↔ 구글 스프레드시트 (v3.3 부터 양방향).
//
// 시트가 연결돼 있으면 가이드를 저장/삭제할 때 카테고리별 탭
// (오류 코드 가이드 · 하드웨어 교체 SOP · SW·명령어)을 통째로 다시 쓴다.
// 반대로 시트에서 사람이 고친 내용은 [⬆ 업데이트] 때 받아온다 — PC 에서
// 여러 건을 한꺼번에 정리하는 편이 태블릿보다 빠르기 때문이다.
//
// 맨 뒤 숨김 ID 열로 같은 가이드를 알아본다. 그 칸이 비어 있으면 새 가이드로 본다.
import * as idb from './local/idb.js';
import * as store from './local/store.js';
import { callAppsScript } from './sheets.js';

export const isEnabled = () => store.sheetInventoryOn();

/** 기기의 모든 가이드를 시트 탭 3개로 내보낸다. */
export async function pushGuides() {
  const guides = await idb.getAll('guides');
  const items = guides.map((g) => ({
    id: g.id,
    categoryType: g.categoryType,
    codeOrTitle: g.codeOrTitle || '',
    summary: g.summary || '',
    requiredTools: g.requiredTools || '',
    commands: (g.commands || []).map((c) => ({
      label: c.label || '', cmd: c.cmd || '', desc: c.desc || '',
    })),
    steps: (g.steps || []).map((s) => ({
      instruction: s.instruction || '',
      expectedMetric: s.expectedMetric || '',
    })),
    updatedAt: g.updatedAt || '',
  }));
  return callAppsScript({ guides: 'push', items }, 60000);
}

/**
 * 시트에서 고친 가이드를 기기에 반영한다.
 *
 * 반환: { changed, added } — 바뀐 것이 없으면 둘 다 0.
 *
 * 안전 규칙 두 가지.
 *  1. **내가 아직 안 올린 변경이 있으면 아무것도 하지 않는다.** 시트 내용으로 덮으면
 *     현장에서 방금 쓴 것이 사라진다. 이 경우는 내 것을 먼저 올린 뒤 다음에 받는다.
 *  2. 시트에서 줄을 지운 것은 **삭제로 보지 않는다.** 사람이 실수로 지웠을 때
 *     가이드가 통째로 날아가면 되돌릴 수 없다. 삭제는 앱에서만 한다.
 */
export async function pullGuides() {
  if (await store.isDirty()) return { changed: 0, added: 0, skipped: 'dirty' };

  const result = await callAppsScript({ guides: 'pull' }, 60000);
  const rows = result.items || [];
  if (!rows.length) return { changed: 0, added: 0 };

  const mine = new Map((await idb.getAll('guides')).map((g) => [g.id, g]));
  let changed = 0;
  let added = 0;

  for (const row of rows) {
    const title = String(row.codeOrTitle || '').trim();
    if (!title) continue;

    const existing = row.id ? mine.get(row.id) : null;
    const next = {
      id: existing ? existing.id : store.newId(),
      categoryType: row.categoryType,
      codeOrTitle: title,
      summary: String(row.summary || '').trim(),
      requiredTools: String(row.requiredTools || '').trim(),
      commands: (row.commands || [])
        .filter((c) => (c.cmd || '').trim())
        .map((c) => ({
          label: (c.label || '').trim(),
          cmd: (c.cmd || '').trim(),
          desc: (c.desc || '').trim(),
        })),
      steps: (row.steps || [])
        .filter((s) => (s.instruction || '').trim())
        .map((s, i) => ({
          id: (existing && (existing.steps || [])[i] || {}).id || store.newId(),
          stepOrder: i + 1,
          instruction: (s.instruction || '').trim(),
          expectedMetric: (s.expectedMetric || '').trim() || null,
          // 사진은 시트에 실리지 않으므로 기기에 있던 것을 지키고 지나간다.
          imageUrl: (existing && (existing.steps || [])[i] || {}).imageUrl || null,
        })),
      createdAt: existing ? existing.createdAt : store.now(),
      updatedAt: store.now(),
    };

    if (existing && same(existing, next)) continue;
    await idb.put('guides', next);
    if (existing) changed += 1; else added += 1;
  }

  // 시트에서 받은 것은 이미 팀이 보는 내용이라 [업데이트] 대상으로 표시하지 않는다.
  return { changed, added };
}

/** 시트에서 온 내용이 기기 것과 같은가 (같으면 건드리지 않는다) */
function same(a, b) {
  const key = (g) => JSON.stringify([
    g.categoryType, g.codeOrTitle, g.summary, g.requiredTools,
    (g.commands || []).map((c) => [c.label, c.cmd, c.desc]),
    (g.steps || []).map((s) => [s.instruction, s.expectedMetric || '']),
  ]);
  return key(a) === key(b);
}
