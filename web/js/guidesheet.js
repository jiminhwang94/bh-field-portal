// 가이드 3종 ↔ 구글 스프레드시트 (v3.3 부터 양방향).
//
// 시트가 연결돼 있으면 가이드를 저장/삭제할 때 카테고리별 탭
// (오류 코드 가이드 · 하드웨어 교체 SOP · SW·명령어)을 통째로 다시 쓴다.
// 반대로 시트에서 사람이 고친 내용은 [새로고침](자동 포함) 때 받아온다 — PC 에서
// 여러 건을 한꺼번에 정리하는 편이 태블릿보다 빠르기 때문이다.
//
// 맨 뒤 숨김 ID 열로 같은 가이드를 알아본다. 그 칸이 비어 있으면 새 가이드로 본다.
import * as idb from './local/idb.js';
import * as store from './local/store.js';
import { callAppsScript } from './sheets.js';
import { sheetRead } from './sync.js';

/** 지난번 시트에 있던 가이드 ID — 다른 기기에서 지운 것을 알아보는 데 쓴다. */
const SHEET_IDS_KEY = 'guideSheetIds';

/** 아직 시트에 못 올린 내 가이드 변경의 ID */
async function pendingGuideIds() {
  return new Set((await store.outbox())
    .filter((op) => op.type === 'guidesheet-push')
    .flatMap((op) => (op.changes || []).map((c) => c.id)));
}

/**
 * 가이드를 시트 탭 3개로 내보낸다.
 *
 * `changes` 가 있으면 **시트 것과 합쳐서** 올린다 — 내가 안 건드린 가이드는
 * 시트에 있는 그대로 두고, 내가 고친·만든·지운 것만 얹는다. 이게 없으면
 * 마지막에 올린 사람의 기기 내용이 다른 사람 변경을 통째로 덮어쓴다.
 */
export async function pushGuides(changes = null) {
  const guides = await mergeWithSheet(await idb.getAll('guides'), changes);
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
      // 드라이브에 올라간 사진 주소. 기기 안에만 있는 것은 시트에 적지 않는다
      // (다른 사람이 열 수 없다) — .gs 쪽에서 http 로 시작하는 것만 적는다.
      imageUrl: s.imageUrl || '',
    })),
    updatedAt: g.updatedAt || '',
  }));
  const result = await callAppsScript({ guides: 'push', items }, 60000);
  await store.setMeta(SHEET_IDS_KEY, items.map((g) => g.id).filter(Boolean));
  return result;
}

/**
 * 내 변경(changes)만 시트 위에 얹는다. 시트 줄은 올리는 모양과 같아서 그대로 쓴다.
 *  - 내가 건드린 ID → 기기 것 (지웠으면 넣지 않는다)
 *  - 안 건드린 ID   → 시트 것 (남이 고친 것을 내 옛 모습으로 덮지 않는다)
 *  - 내가 새로 만든 것 → 뒤에 붙인다
 * 무엇을 바꿨는지 모르면(옛 대기열) 기기 내용을 통째로 올린다.
 *
 * 시트를 못 받으면 **올리지 않는다** (오류를 넘겨 대기열에 남긴다). 예전에는
 * 기기 내용을 통째로 올려서, 다른 기기에서 지운 가이드가 시트에 되살아났다.
 */
async function mergeWithSheet(local, changes) {
  if (!changes || !changes.length) return local;
  const sheet = (await callAppsScript({ guides: 'pull' }, 60000)).items || [];
  if (!sheet.length) return local;

  const mine = new Map(local.map((g) => [g.id, g]));
  const touched = new Set(changes.map((c) => c.id));
  // 예전 기기는 시트에서 받은 가이드에 **다른 ID** 를 붙여 들고 있다. 그 ID 로
  // 지우면 시트 줄과 짝이 안 맞아 지운 가이드가 남는다 — 제목으로도 알아본다.
  const titleKey = (g) => `${g.categoryType}|${String(g.codeOrTitle || '').trim()}`;
  const touchedTitles = new Set(changes.filter((c) => c.before).map((c) => titleKey(c.before)));
  const out = [];
  const seen = new Set();
  for (const row of sheet) {
    const id = row.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    // ID 가 비었거나 이 기기가 모르는 ID 인 옛 줄은 분류·제목으로 알아본다.
    if ((!id || !mine.has(id)) && !(id && touched.has(id))
        && touchedTitles.has(titleKey(row))) continue;
    if (id && touched.has(id)) {
      if (mine.has(id)) out.push(mine.get(id));     // 고친 것. 지운 것은 빠진다.
      continue;
    }
    // 안 건드린 것은 **시트 것**이다. 기기 것을 쓰면 다른 사람이 그새 고친 내용이
    // 내가 마지막으로 받은 옛 모습으로 덮인다. (시트에는 드라이브 사진 주소만
    // 적히므로 기기에만 있는 사진은 어느 쪽이든 올라가지 않는다.)
    out.push(row);
  }
  for (const g of local) {
    if (touched.has(g.id) && !seen.has(g.id)) out.push(g);   // 새로 만든 것
  }
  return out;
}

/**
 * 시트의 가이드를 기기에 반영한다.
 *
 * 반환: { changed, added, removed, deleted }
 *   removed — 같은 분류·제목으로 늘어난 복사본을 정리한 수
 *   deleted — 다른 기기에서 지워져 이 기기에서도 뺀 수
 *
 * 안전 규칙.
 *  1. **내가 아직 안 올린 가이드는 건드리지 않는다.** 시트 내용으로 덮으면 현장에서
 *     방금 쓴 것이 사라지고, 방금 지운 것이 되살아난다. 나머지는 그대로 받는다.
 *  2. **지난번 시트에 있던** 가이드가 이번에 없으면 다른 기기에서 지운 것이다 —
 *     이 기기에서도 뺀다. 예전에는 빼지 않아서, 지운 가이드가 다른 기기에 남아
 *     있다가 그 기기가 올릴 때 시트에 되살아났다. 한 번도 시트에 오른 적 없는
 *     가이드(내가 새로 만든 것)는 빼지 않는다.
 *  3. 한꺼번에 절반 넘게 사라졌으면 삭제로 보지 않는다 — 사람이 시트에서 실수로
 *     줄을 지웠을 가능성이 크다. 되돌릴 수 없는 일은 의심스러우면 하지 않는다.
 */
export function pullGuides() {
  return sheetRead(pullGuidesNow);
}

async function pullGuidesNow() {
  const result = await callAppsScript({ guides: 'pull' }, 60000);
  const rows = result.items || [];
  if (!rows.length) return { changed: 0, added: 0, removed: 0, deleted: 0 };

  // 받는 사이에 고친 것도 지키도록, 시트를 받은 **뒤에** 내 대기분을 본다.
  const pending = await pendingGuideIds();
  const local = await idb.getAll('guides');
  const byId = new Map(local.map((g) => [g.id, g]));
  // ID 로 못 찾을 때를 대비한 두 번째 기준.
  // 예전 시트에는 ID 열이 없어서 ID 가 빈 채로 온다. 그때 ID 만 믿으면
  // 매번 "새 가이드" 로 보고 복사본을 쌓는다(실제로 그렇게 늘어났다).
  const key = (type, title) => `${type}${String.fromCharCode(0)}${String(title).trim()}`;
  const byTitle = new Map();
  for (const g of local) {
    const k = key(g.categoryType, g.codeOrTitle);
    // 이미 늘어난 복사본이 있으면 가장 먼저 만든 것을 남긴다.
    const prev = byTitle.get(k);
    if (!prev || String(g.createdAt) < String(prev.createdAt)) byTitle.set(k, g);
  }

  let changed = 0;
  let added = 0;
  const seen = new Set();        // 이번 시트에 있는 가이드의 (기기) ID

  for (const row of rows) {
    const title = String(row.codeOrTitle || '').trim();
    if (!title) continue;
    if (row.id && pending.has(row.id)) { seen.add(row.id); continue; }   // 내 것이 먼저다

    const existing = (row.id && byId.get(row.id))
      || byTitle.get(key(row.categoryType, title))
      || null;
    if (existing && pending.has(existing.id)) { seen.add(existing.id); continue; }
    // **ID 는 시트를 따른다.** 예전에는 시트에서 처음 받은 가이드에 기기가 새 ID 를
    // 지어 붙였다. 그러면 이 기기에서 지워도 시트 줄(다른 ID)이 남아 다음
    // 새로고침에 되살아났다. 이미 다른 ID 로 들고 있던 것도 여기서 시트 ID 로 맞춘다.
    const id = row.id || (existing ? existing.id : store.newId());
    seen.add(id);
    const next = {
      id,
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
          // 시트에 드라이브 주소가 있으면 그것을 쓴다 (다른 사람도 볼 수 있다).
          // 없으면 기기에 있던 것을 지키고 지나간다.
          imageUrl: (s.imageUrl || '').trim()
            || (existing && (existing.steps || [])[i] || {}).imageUrl || null,
        })),
      createdAt: existing ? existing.createdAt : store.now(),
      updatedAt: store.now(),
    };

    const rekey = existing && existing.id !== id;
    if (existing && !rekey && same(existing, next)) continue;
    if (rekey) await idb.remove('guides', existing.id);
    await idb.put('guides', next);
    if (existing) changed += 1; else added += 1;
  }

  // 다른 기기에서 지운 가이드를 이 기기에서도 뺀다 (규칙 2·3).
  const known = new Set((await store.getMeta(SHEET_IDS_KEY, [])) || []);
  const gone = (await idb.getAll('guides'))
    .filter((g) => known.has(g.id) && !seen.has(g.id) && !pending.has(g.id));
  let deleted = 0;
  if (gone.length && gone.length <= Math.max(3, Math.floor(known.size / 2))) {
    for (const g of gone) { await idb.remove('guides', g.id); deleted += 1; }
  }
  await store.setMeta(SHEET_IDS_KEY, [...seen]);

  // 같은 분류·같은 제목의 복사본을 정리한다.
  let removed = 0;
  const keep = new Map();
  for (const g of await idb.getAll('guides')) {
    const k = key(g.categoryType, g.codeOrTitle);
    const prev = keep.get(k);
    if (!prev) { keep.set(k, g); continue; }
    if (pending.has(g.id) || pending.has(prev.id)) continue;   // 올리는 중인 것은 두고 본다
    // 시트에서 방금 갱신한 쪽을 남기고, 아니면 먼저 만든 쪽을 남긴다.
    const drop = seen.has(prev.id) ? g
      : seen.has(g.id) ? prev
        : (String(g.createdAt) < String(prev.createdAt) ? prev : g);
    keep.set(k, drop === g ? prev : g);
    await idb.remove('guides', drop.id);
    removed += 1;
  }

  return { changed, added, removed, deleted };
}

/** 시트에서 온 내용이 기기 것과 같은가 (같으면 건드리지 않는다) */
function same(a, b) {
  const key = (g) => JSON.stringify([
    g.categoryType, g.codeOrTitle, g.summary, g.requiredTools,
    (g.commands || []).map((c) => [c.label, c.cmd, c.desc]),
    // 사진 주소도 비교에 넣는다. 빼면 시트에 새 사진이 올라와도
    // "같다" 고 보고 넘어가 **다른 사람 사진이 영영 안 내려온다.**
    (g.steps || []).map((s) => [s.instruction, s.expectedMetric || '', s.imageUrl || '']),
  ]);
  return key(a) === key(b);
}
