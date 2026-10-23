// 기기 저장소 — 가이드 · 가이드 로봇 분류.
// (store.js 가 전부 다시 내보낸다 — 밖에서는 store.js 만 부른다)
import * as idb from './idb.js';
import { testMode } from '../mode.js';
import { CATEGORY_TYPES, byText, getMeta, newId, now, queueGuideSheetPushIfOn, setMeta } from './store-core.js';

// -------------------------------------------------------------- 가이드

const guideOut = (g, withSteps) => {
  const out = {
    id: g.id,
    categoryType: g.categoryType,
    robotModel: g.robotModel || '',
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
    guide.codeOrTitle, guide.summary, guide.requiredTools, guide.robotModel,
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
    robotModel: String(payload.robotModel ?? (existing ? existing.robotModel : '') ?? '').trim(),
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

// ------------------------------------------------------- 가이드 로봇 분류
//
// 같은 오류 코드라도 로봇(Gen.1 · Gen.2 · Zephyr …)마다 절차가 다르다. 그래서
// 가이드는 **로봇 → 종류(오류 코드 · 하드웨어 · SW) → 목록** 으로 찾아 들어간다.
// 로봇 목록은 팀 공통이라 시트의 [가이드 로봇] 탭과 주고받는다 — 가이드가 아직
// 하나도 없는 로봇도 모두에게 보여야 하기 때문이다. 바꾼 것은 가이드와 같은 대기열
// (guidesheet-push)에 kind:'model' 로 담겨, 올릴 때 시트 목록 위에 얹힌다.
//   추가        { kind:'model', id: 새 이름, before: null }
//   이름 바꾸기 { kind:'model', id: 새 이름, before: 옛 이름 }
//   삭제        { kind:'model', id: 이름,    before: 이름 }
export const DEFAULT_GUIDE_MODELS = ['Gen.1', 'Gen.2', 'Zephyr'];
const GUIDE_MODELS_KEY = 'guideModels';

/** 로봇 분류 목록. 한 번도 정한 적이 없으면 기본 셋. */
export async function listGuideModels() {
  const saved = await getMeta(GUIDE_MODELS_KEY, null);
  return Array.isArray(saved) ? saved : [...DEFAULT_GUIDE_MODELS];
}

/** 시트에서 받은 목록을 그대로 기기에 둔다 (guidesheet 가 부른다). */
export async function setGuideModels(models) {
  const clean = [];
  for (const raw of models || []) {
    const name = String(raw || '').trim();
    if (name && !clean.includes(name)) clean.push(name);
  }
  await setMeta(GUIDE_MODELS_KEY, clean);
  return clean;
}

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export async function addGuideModel(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('로봇 이름을 입력하세요.');
  const models = await listGuideModels();
  if (models.some((m) => sameName(m, name))) throw new Error('이미 있는 로봇입니다.');
  await setGuideModels([...models, name]);
  await queueGuideSheetPushIfOn([{ kind: 'model', id: name, before: null }]);
  return name;
}

/** 이름을 바꾸면 그 로봇의 가이드도 함께 옮긴다. */
export async function renameGuideModel(oldName, nextName) {
  nextName = String(nextName || '').trim();
  if (!nextName) throw new Error('로봇 이름을 입력하세요.');
  if (nextName === oldName) return nextName;
  const models = await listGuideModels();
  if (models.some((m) => m !== oldName && sameName(m, nextName))) {
    throw new Error('이미 있는 로봇입니다.');
  }
  await setGuideModels(models.map((m) => (m === oldName ? nextName : m)));
  const changes = [{ kind: 'model', id: nextName, before: oldName }];
  const stamp = now();
  for (const g of await idb.getAll('guides')) {
    if ((g.robotModel || '') !== oldName) continue;
    await idb.put('guides', { ...g, robotModel: nextName, updatedAt: stamp });
    changes.push({ kind: 'guide', id: g.id, before: g });
  }
  await queueGuideSheetPushIfOn(changes);
  return nextName;
}

/** 지우면 그 로봇의 가이드는 지우지 않고 '로봇 미지정' 으로 옮긴다. */
export async function deleteGuideModel(name) {
  const models = await listGuideModels();
  await setGuideModels(models.filter((m) => m !== name));
  const changes = [{ kind: 'model', id: name, before: name }];
  const stamp = now();
  let moved = 0;
  for (const g of await idb.getAll('guides')) {
    if ((g.robotModel || '') !== name) continue;
    await idb.put('guides', { ...g, robotModel: '', updatedAt: stamp });
    changes.push({ kind: 'guide', id: g.id, before: g });
    moved += 1;
  }
  await queueGuideSheetPushIfOn(changes);
  return { moved };
}

/**
 * 가이드 여러 건의 로봇을 한 번에 정한다 (로봇 미지정 정리용).
 * 대기열에는 한 건으로 들어간다 — 열 건을 옮겨도 시트에는 한 번만 올린다.
 * model 이 빈 문자열이면 '로봇 미지정' 으로 되돌린다.
 */
export async function assignGuideModel(ids, model) {
  model = String(model || '').trim();
  const changes = [];
  const stamp = now();
  for (const id of ids || []) {
    const g = await idb.get('guides', id);
    if (!g || (g.robotModel || '') === model) continue;
    await idb.put('guides', { ...g, robotModel: model, updatedAt: stamp });
    changes.push({ kind: 'guide', id, before: g });
  }
  if (changes.length) await queueGuideSheetPushIfOn(changes);
  return { moved: changes.length };
}

/** [올릴 내용] 에서 취소했을 때 로봇 목록을 바꾸기 전으로 되돌린다. */
export async function undoGuideModelChanges(changes) {
  let models = await listGuideModels();
  for (const c of [...(changes || [])].reverse()) {
    if (c.kind !== 'model') continue;
    if (!c.before) { models = models.filter((m) => m !== c.id); continue; }   // 추가 취소
    if (c.before === c.id) { if (!models.includes(c.id)) models.push(c.id); continue; }  // 삭제 취소
    models = models.map((m) => (m === c.id ? c.before : m));                   // 이름 되돌리기
  }
  await setGuideModels(models);
}
