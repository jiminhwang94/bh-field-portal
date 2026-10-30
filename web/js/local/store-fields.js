// 기기 저장소 — 리포트 입력 항목 · 기본 항목.
// (store.js 가 전부 다시 내보낸다 — 밖에서는 store.js 만 부른다)
import * as idb from './idb.js';
import { testMode } from '../mode.js';
import { FIELD_TYPES, getMeta, newId, now, queueFieldSheetPushIfOn, setMeta } from './store-core.js';

// -------------------------------------------------- 리포트 입력 항목 설정

export async function listFields() {
  const rows = await idb.getAll('fields');
  rows.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  return rows.map((f) => ({
    id: f.id, fieldLabel: f.fieldLabel, fieldType: f.fieldType,
    options: f.options || null, isRequired: Boolean(f.isRequired),
    displayOrder: f.displayOrder,
  }));
}

export async function saveField(payload, fieldId = null) {
  const label = (payload.fieldLabel || '').trim();
  if (!label) throw new Error('항목명은 필수입니다.');
  if (!FIELD_TYPES.includes(payload.fieldType)) {
    throw new Error('지원하지 않는 항목 종류입니다.');
  }
  const options = (payload.options || '').trim() || null;
  if (payload.fieldType === 'DROPDOWN' && !options) {
    throw new Error('드롭다운은 선택지를 1개 이상 입력해야 합니다.');
  }
  const existing = fieldId ? await idb.get('fields', fieldId) : null;
  if (fieldId && !existing) throw new Error('항목을 찾을 수 없습니다.');

  const rows = await idb.getAll('fields');
  const row = {
    id: fieldId || newId(),
    fieldLabel: label,
    fieldType: payload.fieldType,
    options,
    isRequired: payload.isRequired ? 1 : 0,
    displayOrder: existing ? existing.displayOrder
      : rows.reduce((max, f) => Math.max(max, f.displayOrder || 0), 0) + 1,
    createdAt: existing ? existing.createdAt : now(),
  };
  await idb.put('fields', row);
  await queueFieldSheetPushIfOn([{ kind: 'field', id: row.id, before: existing || null }]);
  return { ...row, isRequired: Boolean(row.isRequired) };
}

export async function deleteField(fieldId) {
  const existing = await idb.get('fields', fieldId);
  if (!existing) return false;
  await idb.remove('fields', fieldId);
  await queueFieldSheetPushIfOn([{ kind: 'field', id: fieldId, before: existing }]);
  return true;
}

/**
 * 항목 순서를 바꾼다 — **이 기기에만 저장한다. 시트로 올리지 않는다.**
 *
 * 순서는 사람마다 손에 익은 것이 달라서, 팀이 같아야 할 이유가 없다.
 * 예전에는 순서도 시트로 올려서, 다른 사람이 자기 태블릿에서 옮기면
 * **내가 맞춰 둔 양식이 다음 동기화에 통째로 날아갔다.**
 *
 * 항목을 **더하거나 지우는 것은 그대로 팀 공통**이다 (그건 시트로 올린다).
 */
export async function reorderFields(orderedIds) {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const row = await idb.get('fields', orderedIds[i]);
    if (!row) continue;
    await idb.put('fields', { ...row, displayOrder: i + 1 });
  }
  return listFields();
}



// ------------------------------------------------------- 기본 리포트 항목

/**
 * 리포트 항목은 **앱에 붙박이로 들어 있다.**
 *
 * 예전에는 기기가 비어 있으면 사무실 서버에서 받아왔다. 그런데 APK 로 새로
 * 설치하면 서버 주소를 모르니 항목이 **하나도 없는 상태**로 시작했고,
 * 급한 대로 항목을 하나 만들어 올리면 구글 시트의 열 순서가 통째로 바뀌어
 * **이미 쌓여 있던 리포트가 어긋났다.**
 *
 * 그래서 기본 항목을 앱 안에 고정으로 넣는다. 어느 기기에서 설치해도 같은
 * 순서, 같은 열이다. 항목을 바꾸고 싶으면 [설정 → 리포트 항목 설정] 에서
 * 바꿀 수 있고, 그때는 시트도 **새 탭**에 새로 시작한다 (기존 탭은 그대로 둔다).
 */
/**
 * **기본 순서** — 현장에서 적는 차례다. 리포트 번호가 언제나 맨 처음이다
 * (소비자 접수 건을 골라야 나머지 칸이 정해진다).
 *
 * 작성 화면은 두 칸짜리 격자라, 짧은 항목은 둘씩 짝지어 놓인다.
 * 긴 항목(여러 줄·첨부)은 한 줄을 통째로 쓴다:
 *
 *     리포트 번호 | 매장명
 *     로봇 시리얼 | 로봇 모델
 *     사용 부품   | 이슈 유형
 *     오류 코드
 *     현장 사진            ← 한 줄
 *     증상 요약            ← 한 줄 (이슈 유형을 이 칸 안에서 고른다 · v3.42)
 *     원인                 ← 한 줄 (v3.42 · 3C)
 *     조치 내용            ← 한 줄
 *     처리 결과
 */
export const DEFAULT_FIELDS = [
  { fieldLabel: '리포트 번호', fieldType: 'TEXT', options: null, isRequired: true },     // 올릴 때 시트가 매긴다 (v3.39)
  { fieldLabel: '고객사 리포트', fieldType: 'TEXT', options: null, isRequired: false },  // 고른 접수 번호 (v3.39)
  { fieldLabel: '매장명', fieldType: 'TEXT', options: null, isRequired: true },
  { fieldLabel: '로봇 시리얼', fieldType: 'TEXT', options: null, isRequired: true },
  { fieldLabel: '로봇 모델', fieldType: 'DROPDOWN',
    options: 'Gen.1(D1),Gen.1(D2),GEN.2(M12),GEN.2(D-SUB),Frame', isRequired: true },
  { fieldLabel: '사용 부품', fieldType: 'TEXT', options: null, isRequired: false },
  { fieldLabel: '이슈 유형', fieldType: 'TEXT', options: null, isRequired: false },  // 이슈 유형 목록에서 고른다
  { fieldLabel: '오류 코드', fieldType: 'TEXT', options: null, isRequired: false },
  { fieldLabel: '현장 사진', fieldType: 'MEDIA', options: null, isRequired: false },
  { fieldLabel: '증상 요약', fieldType: 'TEXTAREA', options: null, isRequired: true },
  { fieldLabel: '원인', fieldType: 'TEXTAREA', options: null, isRequired: false },   // 증상마다 고른 원인 (v3.42 · 3C)
  { fieldLabel: '조치 내용', fieldType: 'TEXTAREA', options: null, isRequired: true },
  { fieldLabel: '처리 결과', fieldType: 'DROPDOWN',
    options: '완료,재방문 필요,부품 대기,모니터링', isRequired: true },
];

/** 항목이 하나도 없을 때만 기본값을 넣는다. 있으면 손대지 않는다. */
export async function ensureDefaultFields() {
  if ((await idb.count('fields')) > 0) return 0;
  const stamp = now();
  let order = 1;
  for (const f of DEFAULT_FIELDS) {
    await idb.put('fields', {
      id: newId(), fieldLabel: f.fieldLabel, fieldType: f.fieldType,
      options: f.options, isRequired: f.isRequired,
      displayOrder: order, createdAt: stamp,
    });
    order += 1;
  }
  return DEFAULT_FIELDS.length;
}

/** 항목 이름을 맞출 때 쓰는 기준 — 띄어쓰기 차이는 같은 것으로 본다. */
const fieldLabelKey = (label) => String(label || '').replace(/\s/g, '');

/**
 * 기본 순서를 **한 번만** 깔아 준다.
 *
 * 순서는 기기마다 따로 두기로 했지만(`reorderFields`), 그 결정 전에 시트에서
 * 받아 온 제각각인 순서가 이미 기기에 남아 있다. 기준을 한 번 맞춰 놓고,
 * 그 뒤에 기기에서 옮긴 것은 다시 건드리지 않는다.
 *
 * 기본 목록에 없는 항목(팀이 따로 만든 것)은 순서를 지키며 뒤에 붙인다.
 * 반환: 순서가 실제로 바뀌었으면 true.
 */
const FIELD_ORDER_BASELINE_KEY = 'fieldOrderBaseline';
const FIELD_ORDER_BASELINE = '2026-09-16';

export async function applyDefaultFieldOrderOnce() {
  if ((await getMeta(FIELD_ORDER_BASELINE_KEY, '')) === FIELD_ORDER_BASELINE) return false;
  // listFields() 가 아니라 **원본 줄**을 읽는다 — 그쪽은 화면용으로 골라 담아
  // createdAt 같은 칸이 빠져 있어, 그대로 다시 쓰면 그 칸을 잃는다.
  const fields = await idb.getAll('fields');
  fields.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const base = DEFAULT_FIELDS.map((f) => fieldLabelKey(f.fieldLabel));
  const rankOf = (f) => {
    const at = base.indexOf(fieldLabelKey(f.fieldLabel));
    return at < 0 ? base.length : at;              // 기본 목록에 없으면 맨 뒤로
  };
  const sorted = fields
    .map((f, at) => ({ f, at }))                   // 동점이면 지금 순서를 지킨다
    .sort((a, b) => (rankOf(a.f) - rankOf(b.f)) || (a.at - b.at))
    .map((x) => x.f);

  const moved = sorted.some((f, i) => f.id !== fields[i].id);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].displayOrder !== i + 1) {
      await idb.put('fields', { ...sorted[i], displayOrder: i + 1 });
    }
  }
  await setMeta(FIELD_ORDER_BASELINE_KEY, FIELD_ORDER_BASELINE);
  return moved;
}

/**
 * '이슈 유형' 항목을 갖춘다 — 리포트의 이슈 유형은 이슈 유형 목록에서 고른다.
 *
 * v3.31 에는 이름이 '작업' 이었다. 그 칸이 있으면 **이름만 바꾼다** (새로 만들면 같은 칸이 둘이 된다).
 * 둘 다 있으면(옛 앱이 '작업' 을 다시 만든 경우) '작업' 을 뺀다.
 * 항목은 팀 공통이라 시트 '리포트 항목' 탭에도 올라간다. 시트를 받은 **뒤에** 부른다 —
 * 받기 전에 만들면 시트에 아직 없는 항목으로 보여 받기가 지워 버린다.
 * 자리는 '오류 코드' 바로 앞 (순서는 기기마다 따로라 이 기기 순서만 맞춘다).
 */
/**
 * '고객사 리포트' 항목 (v3.39) — 없으면 만들어 '리포트 번호' 바로 뒤에 둔다.
 * 이 칸이 생기면 접수 카드는 여기서 고르고, 리포트 번호는 올릴 때 시트가 매긴다.
 * 시트를 쓰는 기기는 항목을 받은 뒤에 부른다 — 팀 공통 항목으로 올라간다.
 */
export async function ensureCustomerField() {
  const rows = await idb.getAll('fields');
  if (rows.some((f) => fieldLabelKey(f.fieldLabel) === '고객사리포트')) return false;
  const made = await saveField({ fieldLabel: '고객사 리포트', fieldType: 'TEXT', isRequired: false });
  const sorted = (await idb.getAll('fields')).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const ids = sorted.map((f) => f.id).filter((id) => id !== made.id);
  const number = sorted.find((f) => fieldLabelKey(f.fieldLabel) === '리포트번호');
  const at = number ? ids.indexOf(number.id) + 1 : 0;
  ids.splice(at, 0, made.id);
  await reorderFields(ids);
  return true;
}

/**
 * '원인' 항목 (v3.42 · 3C: 증상 → 원인 → 조치) — 없으면 만들어 '증상 요약' 바로 뒤에 둔다.
 * 시트를 쓰는 기기는 항목을 받은 뒤에 부른다 — 팀 공통 항목으로 올라간다.
 */
export async function ensureCauseField() {
  const rows = await idb.getAll('fields');
  if (rows.some((f) => fieldLabelKey(f.fieldLabel) === '원인')) return false;
  const made = await saveField({ fieldLabel: '원인', fieldType: 'TEXTAREA', isRequired: false });
  const sorted = (await idb.getAll('fields')).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const ids = sorted.map((f) => f.id).filter((id) => id !== made.id);
  const symptom = sorted.find((f) => fieldLabelKey(f.fieldLabel).includes('증상'));
  const action = sorted.find((f) => fieldLabelKey(f.fieldLabel).includes('조치내용'));
  const at = symptom ? ids.indexOf(symptom.id) + 1 : action ? ids.indexOf(action.id) : ids.length;
  ids.splice(at, 0, made.id);
  await reorderFields(ids);
  return true;
}

export async function ensureWorkField() {
  const rows = await idb.getAll('fields');
  const issue = rows.find((f) => fieldLabelKey(f.fieldLabel) === '이슈유형');
  const old = rows.find((f) => fieldLabelKey(f.fieldLabel) === '작업');
  if (issue && old) { await deleteField(old.id); return true; }
  if (issue) return false;
  if (old) {
    await saveField({ fieldLabel: '이슈 유형', fieldType: old.fieldType, options: old.options || '',
                      isRequired: Boolean(old.isRequired) }, old.id);
    return true;
  }
  const made = await saveField({ fieldLabel: '이슈 유형', fieldType: 'TEXT', isRequired: false });
  const sorted = (await idb.getAll('fields')).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const ids = sorted.map((f) => f.id).filter((id) => id !== made.id);
  const code = sorted.find((f) => fieldLabelKey(f.fieldLabel) === '오류코드');
  const at = code ? ids.indexOf(code.id) : ids.length;
  ids.splice(at < 0 ? ids.length : at, 0, made.id);
  await reorderFields(ids);
  return true;
}
