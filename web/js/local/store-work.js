// 기기 저장소 — 작업 목록 (구분 › 대분류 › 세부 작업). 팀 공용 — 시트 '작업 목록' 탭.
// (store.js 가 전부 다시 내보낸다 — 밖에서는 store.js 만 부른다)
//
// 리포트의 '작업' 은 이 목록에서 고른다. 사람마다 다르게 적던 것("로더 교체" · "팔 교체")을
// 하나로 모으려는 것이다. 목록은 현장에서 새로 적으며 늘어나고(새 항목), 설정의
// [작업 목록] 에서 합치기 · 별칭 · 가이드 잇기로 정리한다.
//
// 바꿀 때는 '무엇을 바꿨는지(ops)' 를 대기열에 넣고, 시트도 그 ops 만 적용한다 —
// 둘이 동시에 고쳐도 서로를 지우지 않는다.
import { enqueue, getMeta, newId, outbox, setMeta, sheetInventoryOn } from './store-core.js';

export const WORK_KINDS = ['로봇 이슈', '로봇 외 이슈'];

/** 처음 쓰는 팀을 위한 대분류 — 설정 → 작업 목록에서 바꾼다 */
export const DEFAULT_WORK_CATS = {
  '로봇 이슈': ['유지 보수', '오류', '하드웨어 교체', 'SW · 설정', '설치', '점검'],
  '로봇 외 이슈': ['네트워크 · 와이파이', '전원 · 콘센트', '매장 환경', '사용 안내 (교육)', '기타'],
};

const KEY = 'workList';

/**
 * @typedef {{ kind: string, name: string }} WorkCat
 * @typedef {{ id: string, kind: string, cat: string, name: string, aliases: string[], guides: string[], isNew?: boolean }} WorkItem
 * @typedef {{ cats: WorkCat[], items: WorkItem[] }} WorkList
 */

/** @returns {Promise<WorkList>} */
export async function getWorkList() {
  const v = await getMeta(KEY, null);
  return v && Array.isArray(v.cats) ? v : { cats: [], items: [] };
}

const uniq = (list) => [...new Set((list || []).map((x) => String(x || '').trim()).filter(Boolean))];

/**
 * ops 를 목록에 적용한다 — 시트(.gs 의 applyWorkOps)와 **같은 규칙**이다.
 * @param {WorkList} list
 * @param {any[]} ops
 * @returns {WorkList}
 */
export function applyWorkOps(list, ops) {
  const out = { cats: list.cats.map((c) => ({ ...c })), items: list.items.map((i) => ({ ...i })) };
  const kindOf = (k) => (WORK_KINDS.includes(k) ? k : WORK_KINDS[0]);
  const catAt = (kind, name) => out.cats.findIndex((c) => c.kind === kind && c.name === name);
  for (const op of ops || []) {
    const kind = kindOf(op.kind);
    if (op.op === 'cat-add') {
      const name = String(op.name || '').trim();
      if (name && catAt(kind, name) < 0) out.cats.push({ kind, name });
    } else if (op.op === 'cat-rename') {
      const from = String(op.from || '').trim();
      const to = String(op.to || '').trim();
      const at = catAt(kind, from);
      if (at >= 0 && to && catAt(kind, to) < 0) {
        out.cats[at].name = to;
        for (const it of out.items) if (it.kind === kind && it.cat === from) it.cat = to;
      }
    } else if (op.op === 'cat-delete') {
      const at = catAt(kind, op.name);
      if (at >= 0 && !out.items.some((it) => it.kind === kind && it.cat === op.name)) out.cats.splice(at, 1);
    } else if (op.op === 'item-upsert') {
      const it = op.item || {};
      if (!it.id || !String(it.name || '').trim() || !String(it.cat || '').trim()) continue;
      const row = { id: it.id, kind: kindOf(it.kind), cat: String(it.cat).trim(), name: String(it.name).trim(),
                    aliases: uniq(it.aliases), guides: uniq(it.guides), isNew: Boolean(it.isNew) };
      if (catAt(row.kind, row.cat) < 0) out.cats.push({ kind: row.kind, name: row.cat });
      const was = out.items.findIndex((x) => x.id === row.id);
      if (was >= 0) out.items[was] = row; else out.items.push(row);
    } else if (op.op === 'item-delete') {
      out.items = out.items.filter((x) => x.id !== op.id);
    }
  }
  return out;
}

/** 목록을 바꾼다 — 기기에 바로 적용하고, 시트에 올릴 ops 를 대기열에 넣는다. */
export async function workOps(ops) {
  const next = applyWorkOps(await getWorkList(), ops);
  await setMeta(KEY, next);
  if (await sheetInventoryOn()) await enqueue({ type: 'worklist-push', ops });
  return next;
}

/** 아직 시트에 못 올린 ops (받을 때 그 위에 다시 얹는다) */
export async function pendingWorkOps() {
  return (await outbox()).filter((o) => o.type === 'worklist-push').flatMap((o) => o.ops || []);
}

/** 시트에서 받은 목록을 기기에 — 내가 아직 안 올린 변경은 그 위에 다시 얹는다. */
export async function setWorkFromSheet(sheetList) {
  const base = { cats: sheetList.cats || [], items: sheetList.items || [] };
  const next = applyWorkOps(base, await pendingWorkOps());
  await setMeta(KEY, next);
  return next;
}

/** 목록이 비었으면 기본 대분류를 깐다 (팀에서 처음 한 번) */
export async function ensureDefaultWork() {
  const list = await getWorkList();
  if (list.cats.length) return list;
  const ops = [];
  for (const kind of WORK_KINDS) for (const name of DEFAULT_WORK_CATS[kind]) ops.push({ op: 'cat-add', kind, name });
  return workOps(ops);
}

/** 현장에서 새로 적은 세부 작업 — '새 항목' 표시로 목록에 들어간다 */
export async function addWorkItem(kind, cat, name, { isNew = true } = {}) {
  const item = { id: newId(), kind, cat, name: String(name || '').trim(), aliases: [], guides: [], isNew };
  if (!item.name) throw new Error('작업 이름을 적어 주세요.');
  await workOps([{ op: 'item-upsert', item }]);
  return item;
}

/** 합치기 — source 를 target 의 별칭으로 남기고 source 항목은 뺀다 */
export async function mergeWorkItems(sourceId, targetId) {
  const list = await getWorkList();
  const src = list.items.find((i) => i.id === sourceId);
  const dst = list.items.find((i) => i.id === targetId);
  if (!src || !dst || src.id === dst.id) throw new Error('합칠 항목을 찾지 못했습니다.');
  const item = { ...dst, aliases: uniq([...dst.aliases, src.name, ...src.aliases]).filter((a) => a !== dst.name),
                 guides: uniq([...dst.guides, ...src.guides]) };
  return workOps([{ op: 'item-upsert', item }, { op: 'item-delete', id: src.id }]);
}
