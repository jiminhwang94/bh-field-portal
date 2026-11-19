// 동작 시험 보강 (v3.49 감사 뒤) ① 리포트 항목 — 시트 받기 안전 규칙 · 기본 항목 · 기본 순서
//
// 예전에는 코드 글자로만 지켰다 ("이런 줄이 있다"). 여기서는 앱을 연 채로 실제 함수를 불러
// 기기 저장소(IndexedDB)가 어떻게 바뀌는지 본다.
const { test, expect, openApp, SHEET } = require('./fixtures.js');

/** 시트의 '리포트 항목' 받기 답을 바꿔 끼운다 (null 이면 가짜 시트 그대로) */
async function fieldsAnswer(page) {
  const box = { items: null };
  await page.route(`${SHEET}/exec`, (route) => {
    const body = route.request().postData() || '';
    if (box.items && /"fields":"pull"/.test(body)) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: box.items, version: 'v-test' }) });
    }
    return route.continue();
  });
  return box;
}

const localFields = (page) => page.evaluate(async () => {
  const idb = await import('/js/local/idb.js');
  return (await idb.getAll('fields')).sort((a, b) => a.displayOrder - b.displayOrder)
    .map((f) => ({ id: f.id, label: f.fieldLabel, order: f.displayOrder }));
});

/** 기기 항목을 이 목록으로 바꿔 둔다 */
const setLocal = (page, list) => page.evaluate(async (rows) => {
  const idb = await import('/js/local/idb.js');
  await idb.clear('fields');
  for (const [i, r] of rows.entries()) {
    await idb.put('fields', { id: r.id, fieldLabel: r.label, fieldType: 'TEXT', options: null,
      isRequired: false, displayOrder: i + 1, createdAt: '2026-01-01T00:00:00' });
  }
}, list);

const pull = (page) => page.evaluate(async () => (await import('/js/fieldsheet.js')).pullFields());

async function ready(page) {
  await openApp(page, '#/settings');
  await page.waitForTimeout(1500);                // 켤 때 받기가 끝나기를 기다린다
}

test('항목 받기 — 안 올린 변경이 있으면 받지 않는다 (방금 고친 것이 덮이지 않는다)', async ({ page }) => {
  const answer = await fieldsAnswer(page);
  await ready(page);
  await setLocal(page, [{ id: 'mine1', label: '매장명' }, { id: 'mine2', label: '내가 방금 만든 칸' }]);
  await page.evaluate(async () => (await import('/js/local/store.js')).enqueue({ type: 'fieldsheet-push', changes: [] }));
  answer.items = [{ id: 'sheet1', fieldLabel: '매장명', fieldType: 'TEXT' }];
  const r = await pull(page);
  expect(r.skipped).toBe('pending');
  expect((await localFields(page)).map((f) => f.label)).toEqual(['매장명', '내가 방금 만든 칸']);
});

test('항목 받기 — 시트가 비어 있으면 기기 항목을 지우지 않는다', async ({ page }) => {
  const answer = await fieldsAnswer(page);
  await ready(page);
  await setLocal(page, [{ id: 'a1', label: '매장명' }, { id: 'a2', label: '증상 요약' }]);
  answer.items = [];
  const r = await pull(page);
  expect(r.removed).toBe(0);
  expect(await localFields(page)).toHaveLength(2);
});

test('항목 받기 — 이름으로 맞추고(띄어쓰기 무시) ID 는 시트를 따른다 · 두 줄로 갈라지지 않는다', async ({ page }) => {
  const answer = await fieldsAnswer(page);
  await ready(page);
  await setLocal(page, [{ id: 'devA', label: '로봇 모델' }, { id: 'devB', label: '매장명' }]);
  answer.items = [
    { id: 'sheetRM', fieldLabel: '로봇모델', fieldType: 'TEXT' },
    { id: 'sheetST', fieldLabel: '매장명', fieldType: 'TEXT' },
    { id: 'sheetDup', fieldLabel: '매 장 명', fieldType: 'TEXT' },        // 시트에 같은 이름이 또 있어도 하나만
  ];
  await pull(page);
  const after = await localFields(page);
  expect(after).toHaveLength(2);
  expect(after.map((f) => f.id).sort()).toEqual(['sheetRM', 'sheetST']);
});

test('항목 받기 — 순서는 이 기기 것을 지킨다 · 남이 새로 만든 항목은 맨 뒤에', async ({ page }) => {
  const answer = await fieldsAnswer(page);
  await ready(page);
  await setLocal(page, [{ id: 'x1', label: '가' }, { id: 'x2', label: '나' }, { id: 'x3', label: '다' }]);
  answer.items = [
    { id: 'x3', fieldLabel: '다', fieldType: 'TEXT' },
    { id: 'x1', fieldLabel: '가', fieldType: 'TEXT' },
    { id: 'new', fieldLabel: '새 칸', fieldType: 'TEXT' },
    { id: 'x2', fieldLabel: '나', fieldType: 'TEXT' },
  ];
  await pull(page);
  expect((await localFields(page)).map((f) => f.label)).toEqual(['가', '나', '다', '새 칸']);
});

test('기본 항목 — 비어 있을 때만 깔고 · 기본 순서는 한 번만 맞춘다', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const idb = await import('/js/local/idb.js');
    const store = await import('/js/local/store.js');
    const fields = await import('/js/local/store-fields.js');
    const out = {};
    out.whenFull = await store.ensureDefaultFields();                     // 이미 있으면 0
    await idb.clear('fields');
    out.whenEmpty = await store.ensureDefaultFields();
    out.defaults = fields.DEFAULT_FIELDS.length;
    // 기본 순서 — 기준 표시를 지우고 순서를 뒤집은 뒤 한 번 맞춘다
    await store.setMeta('fieldOrderBaseline', '');
    const rows = (await idb.getAll('fields')).sort((a, b) => a.displayOrder - b.displayOrder);
    for (const [i, f] of rows.reverse().entries()) await idb.put('fields', { ...f, displayOrder: i + 1 });
    out.firstMoved = await store.applyDefaultFieldOrderOnce();
    const sorted = (await idb.getAll('fields')).sort((a, b) => a.displayOrder - b.displayOrder);
    out.firstLabel = sorted[0].fieldLabel;
    // 그 뒤 기기에서 옮긴 순서는 다시 건드리지 않는다
    const flipped = sorted.slice().reverse();
    for (const [i, f] of flipped.entries()) await idb.put('fields', { ...f, displayOrder: i + 1 });
    out.secondMoved = await store.applyDefaultFieldOrderOnce();
    const again = (await idb.getAll('fields')).sort((a, b) => a.displayOrder - b.displayOrder);
    out.keptFirst = again[0].fieldLabel;
    out.expectedKept = flipped[0].fieldLabel;
    out.defaultFirst = fields.DEFAULT_FIELDS[0].fieldLabel;
    return out;
  });
  expect(result.whenFull).toBe(0);
  expect(result.whenEmpty).toBe(result.defaults);
  expect(result.firstMoved).toBe(true);
  expect(result.firstLabel).toBe(result.defaultFirst);
  expect(result.secondMoved).toBe(false);
  expect(result.keptFirst).toBe(result.expectedKept);
});
