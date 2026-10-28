// 기기 저장소 — 가이드 · 가이드 로봇 분류.
// (store.js 가 전부 다시 내보낸다 — 밖에서는 store.js 만 부른다)
import * as idb from './idb.js';
import { testMode } from '../mode.js';
import { CATEGORY_TYPES, byText, getMeta, newId, now, queueGuideSheetPushIfOn, setMeta } from './store-core.js';

// -------------------------------------------------------------- 가이드

/**
 * 단계의 사진 · 영상 목록 (v3.40) — [{ url, sec }]. sec 은 영상 길이(초), 모르면 null.
 * 예전 단계는 imageUrl 하나뿐이었다.
 */
export function stepMedia(step) {
  const list = step && Array.isArray(step.media)
    ? step.media
    : (step && step.imageUrl ? [{ url: step.imageUrl, sec: null }] : []);
  return list
    .map((m) => (typeof m === 'string' ? { url: m, sec: null } : m))
    .filter((m) => m && String(m.url || '').trim())
    .map((m) => ({ url: String(m.url).trim(), sec: Number(m.sec) > 0 ? Math.round(Number(m.sec)) : null }));
}

const guideOut = (g, withSteps) => {
  const out = {
    id: g.id,
    categoryType: g.categoryType,
    category: g.category || '',     // 로봇별 항목 id (v3.40) — 비면 categoryType 기본 항목
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
    const media = stepMedia(step);
    steps.push({
      id: step.id || newId(),
      stepOrder: steps.length + 1,
      instruction,
      expectedMetric: (step.expectedMetric || '').trim() || null,
      media,
      imageUrl: media.length ? media[0].url : null,     // 옛 앱 · 옛 코드는 첫 하나만 본다
    });
  }

  const stamp = now();
  const existing = guideId ? await idb.get('guides', guideId) : null;
  if (guideId && !existing) throw new Error('가이드를 찾을 수 없습니다.');

  const row = {
    id: guideId || newId(),
    categoryType: payload.categoryType,
    // 기본 항목(id = 종류)이면 비워 둔다 — 시트 '항목' 칸이 비면 기본 항목이다
    category: payload.category && payload.category !== payload.categoryType ? String(payload.category) : '',
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
  // 그 로봇의 항목 목록도 새 이름으로 옮긴다 (v3.40)
  const cats = await allGuideCats();
  if (cats[oldName]) {
    cats[nextName] = cats[oldName];
    delete cats[oldName];
    await setMeta(GUIDE_CATS_KEY, cats);
    changes.push({ kind: 'cat', id: nextName, before: null }, { kind: 'cat', id: oldName, before: null });
  }
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
  // 그 로봇의 항목 목록도 지운다 (v3.40) — 옮겨 간 가이드는 '로봇 미지정' 항목에 든다
  const cats = await allGuideCats();
  if (cats[name]) {
    delete cats[name];
    await setMeta(GUIDE_CATS_KEY, cats);
    changes.push({ kind: 'cat', id: name, before: null });
  }
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

// ------------------------------------------------------- 로봇별 가이드 항목 (v3.40)
//
// 예전에는 모든 로봇이 '오류 코드 · 하드웨어 교체 · SW · 명령어' 세 항목으로 고정이었다.
// 이제 로봇마다 항목을 만들고 · 이름을 바꾸고 · 지운다. 항목마다 **형식** 이 있다 —
// 오류 코드형(ERROR_CODE) · 교체 절차형(HARDWARE_SOP) · 명령어형(SOFTWARE_CMD).
// 형식은 가이드가 어느 시트 탭에 들고 오류 코드를 리포트와 잇는지를 정한다.
// 기본 항목의 id 는 형식 이름과 같다 — 예전 가이드(category 없음)가 그대로 제자리에 든다.
// 목록은 팀 공통 — 시트 '가이드 항목' 탭과 주고받는다 (대기열 kind:'cat', id = 로봇).
export const DEFAULT_GUIDE_CATS = [
  { id: 'ERROR_CODE', name: '오류 코드', form: 'ERROR_CODE' },
  { id: 'HARDWARE_SOP', name: '하드웨어 교체', form: 'HARDWARE_SOP' },
  { id: 'SOFTWARE_CMD', name: 'SW · 명령어', form: 'SOFTWARE_CMD' },
];
const GUIDE_CATS_KEY = 'guideCats';
const NONE_KEY = '_none';
const robotKeyOf = (g) => (g.robotModel || '').trim() || NONE_KEY;
/** 가이드가 든 항목 id */
export const guideCatOf = (g) => (g && g.category) || (g && g.categoryType) || '';

/** 로봇마다 항목 { 로봇: [{ id, name, form }] } — 정한 적 없는 로봇은 빠져 있다 */
export async function allGuideCats() {
  const saved = await getMeta(GUIDE_CATS_KEY, null);
  return saved && typeof saved === 'object' ? { ...saved } : {};
}

/** 그 로봇의 항목 — 정한 적이 없으면 기본 셋 */
export async function listGuideCats(robotKey) {
  const list = (await allGuideCats())[robotKey || NONE_KEY];
  return Array.isArray(list) && list.length ? list.map((c) => ({ ...c })) : DEFAULT_GUIDE_CATS.map((c) => ({ ...c }));
}

/** 시트에서 받은 목록을 그대로 둔다 (guidesheet 가 부른다) */
export async function setGuideCats(map) {
  const clean = {};
  for (const [robot, list] of Object.entries(map || {})) {
    const items = (Array.isArray(list) ? list : [])
      .filter((c) => c && c.id && String(c.name || '').trim())
      .map((c) => ({ id: String(c.id), name: String(c.name).trim(),
                     form: CATEGORY_TYPES.includes(c.form) ? c.form : 'HARDWARE_SOP' }));
    if (items.length) clean[robot] = items;
  }
  await setMeta(GUIDE_CATS_KEY, clean);
  return clean;
}

async function writeCats(robotKey, list) {
  const all = await allGuideCats();
  all[robotKey] = list;
  await setMeta(GUIDE_CATS_KEY, all);
  await queueGuideSheetPushIfOn([{ kind: 'cat', id: robotKey, before: null }]);
}

const sameCatName = (a, b) => String(a || '').replace(/\s/g, '') === String(b || '').replace(/\s/g, '');

export async function addGuideCat(robotKey, name, form) {
  name = String(name || '').trim();
  if (!name) throw new Error('항목 이름을 적어 주세요.');
  if (!CATEGORY_TYPES.includes(form)) throw new Error('형식을 골라 주세요.');
  const list = await listGuideCats(robotKey);
  if (list.some((c) => sameCatName(c.name, name))) throw new Error('같은 이름의 항목이 있습니다.');
  const item = { id: `c-${newId()}`, name, form };
  await writeCats(robotKey, [...list, item]);
  return item;
}

export async function renameGuideCat(robotKey, id, name) {
  name = String(name || '').trim();
  if (!name) throw new Error('항목 이름을 적어 주세요.');
  const list = await listGuideCats(robotKey);
  if (list.some((c) => c.id !== id && sameCatName(c.name, name))) throw new Error('같은 이름의 항목이 있습니다.');
  await writeCats(robotKey, list.map((c) => (c.id === id ? { ...c, name } : c)));
}

/** 가이드가 남아 있는 항목은 지우지 않는다 — 가이드를 옮기거나 지운 뒤에 */
export async function deleteGuideCat(robotKey, id) {
  const inside = (await idb.getAll('guides')).filter((g) => robotKeyOf(g) === robotKey && guideCatOf(g) === id);
  if (inside.length) throw new Error(`안에 가이드 ${inside.length}건이 있어 지울 수 없습니다. 가이드를 다른 항목으로 옮기거나 지운 뒤에 지우세요.`);
  const list = await listGuideCats(robotKey);
  const next = list.filter((c) => c.id !== id);
  if (!next.length) throw new Error('항목이 하나는 있어야 합니다.');
  await writeCats(robotKey, next);
}

export async function moveGuideCat(robotKey, id, dir) {
  const list = await listGuideCats(robotKey);
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await writeCats(robotKey, list);
}
