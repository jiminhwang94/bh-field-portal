// v3.39 — 리포트 번호는 올릴 때 시트가 (P + 작성일 + 차례) · 고객사 접수는 '고객사 리포트' 칸 ·
//          고치며 ✕ 로 뺀 사진은 드라이브 휴지통으로
const { test, expect, openApp, pick } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

const monthRows = (dump) => dump['2026-10'] || [];
const cellOf = (rows, header, has) => {
  const head = rows.find((r) => r.includes(header)) || [];
  const line = rows.find((r) => r.join(' ').includes(has)) || [];
  return line[head.indexOf(header)];
};

async function finish(page, store, action) {
  await field(page, '로봇 시리얼').fill('SN-NO-1');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await field(page, '증상 요약').fill('번호 검사');
  await field(page, '조치 내용').fill(action);
  await pick(page, '처리 결과', '완료');
  await page.locator('#reportForm button[type=submit]').click();
}

test('리포트 번호는 자동 — 고객사 리포트를 고르면 그 칸에 · 안 고르면 번호만 · 같은 날은 차례대로', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);                                         // 2026-10-22
  await openApp(page, '#/report/new');
  await expect(page.locator('.auto-no__value')).toHaveText('자동');
  await expect(page.locator('.auto-no__hint')).toContainText('P261022-01');
  await expect(page.locator('.ticket--none')).toHaveClass(/is-on/);            // 처음엔 '고객사 리포트 없음'
  await pick(page, '고객사 리포트', 'P260912-01');
  await expect(field(page, '매장명')).toHaveValue('홍기와');                    // 고르면 매장이 채워진다
  await finish(page, '홍기와', '고객사 건 조치');
  await expect.poll(async () => cellOf(monthRows(await sheet.dump()), '리포트 번호', '고객사 건 조치'), { timeout: 15000 })
    .toBe('P261022-01');
  expect(cellOf(monthRows(await sheet.dump()), '고객사 리포트', '고객사 건 조치')).toBe('P260912-01');

  await openApp(page, '#/report/new');
  await field(page, '매장명').fill('자체점');                                  // 고객사 리포트 없음 — 매장은 직접
  await finish(page, '자체점', '자체 건 조치');
  await expect.poll(async () => cellOf(monthRows(await sheet.dump()), '리포트 번호', '자체 건 조치'), { timeout: 15000 })
    .toBe('P261022-02');
  expect(cellOf(monthRows(await sheet.dump()), '고객사 리포트', '자체 건 조치') || '').toBe('');
});

test('고치며 ✕ 로 뺀 사진은 올리면 드라이브 휴지통으로 (변경기록에 남는다)', async ({ page, sheet }) => {
  await seed(sheet);
  const up = async (name) => (await sheet.call({ media: 'finish', uploadId: `e2e-${name}`, total: 1, data: 'QUJD',
    filename: name, mimeType: 'image/jpeg', storeName: '고침점', dateText: '2026-10-20' })).url;
  const keep = await up('남길.jpg');
  const drop = await up('뺄.jpg');
  const H = ['작성일시', '작성자', '리포트 번호', '매장명', '로봇 시리얼', '로봇 모델', '증상 요약', '조치 내용', '처리 결과', '현장 사진', '상태'];
  await sheet.call({ sheetName: '2026-10', headers: H, row: ['2026-10-20 09:00', '검사봇', 'P261020-01', '고침점', 'SN-EDIT',
    'Gen.1(D1)', '사진 두 장', '조치', '완료', [keep, drop].join(String.fromCharCode(10)), '조치 완료'] });
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');
  await page.locator('.hist-row', { hasText: '고침점' }).first().click({ timeout: 15000 });
  await page.locator('#modalRoot [data-act="edit"]').click();
  await expect(page).toHaveURL(/#\/report\/edit/);
  await expect(page.locator('.auto-no__value')).toHaveText('P261020-01');      // 고칠 때는 붙은 번호 그대로
  const kept = page.locator('[data-act="del-kept"]');
  await expect(kept).toHaveCount(2);
  await kept.nth(1).click();                                                   // 두 번째(뺄.jpg)를 뺀다
  await expect(kept).toHaveCount(1);
  await page.locator('#reportForm button[type=submit]').click();
  await expect.poll(async () => ((await sheet.dump())['변경기록'] || []).flat().join(' '), { timeout: 15000 })
    .toContain('뺀 사진 · 영상 1개 드라이브 휴지통');
  const cell = cellOf(monthRows(await sheet.dump()), '현장 사진', '사진 두 장');
  expect(cell).toContain(keep.split('/d/')[1].split('/')[0]);
  expect(cell).not.toContain(drop.split('/d/')[1].split('/')[0]);
});
