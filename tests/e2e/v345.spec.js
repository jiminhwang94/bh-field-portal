// v3.45 — 지난 작업을 나중에 쓸 때 작성일시를 바꾼다. 시트 탭 · 리포트 번호 · 작성일시 칸이 그 날짜를 따른다
const { test, expect, openApp, pick } = require('./fixtures.js');
const { NOW } = require('./seed.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

const cellOf = (rows, header, has) => {
  const head = (rows || []).find((r) => r.includes(header)) || [];
  const line = (rows || []).find((r) => r.join(' ').includes(has)) || [];
  return line[head.indexOf(header)];
};

async function finish(page, action) {
  await field(page, '매장명').fill('지난작업점');
  await field(page, '로봇 시리얼').fill('SN-PAST-1');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await field(page, '증상 요약').fill('지난 날짜 검사');
  await field(page, '조치 내용').fill(action);
  await pick(page, '처리 결과', '완료');
  await page.locator('#reportForm button[type=submit]').click();
}

test('작성일시 바꾸기 — 지난 날짜면 그 달 탭 · 그날 번호 · 그 시각으로 올라간다', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);                                         // 2026-10-22
  await openApp(page, '#/report/new');
  const when = page.locator('#rfWhen');
  await expect(when.locator('.rf-when__value')).toHaveText('지금');
  await expect(when).not.toHaveClass(/is-past/);

  // 앞으로 올 날짜는 안 된다
  await when.locator('[data-act="when-open"]').click();
  await page.locator('#rfWhenInput').fill('2026-10-25T09:00');
  await when.locator('[data-act="when-ok"]').click();
  await expect(page.locator('.toast', { hasText: '앞으로 올 날짜' })).toBeVisible();

  await page.locator('#rfWhenInput').fill('2026-09-20T10:30');
  await when.locator('[data-act="when-ok"]').click();
  await expect(when).toHaveClass(/is-past/);
  await expect(when.locator('.rf-when__value')).toHaveText('9월 20일 (일) 10:30');
  await expect(when.locator('.rf-when__hint')).toContainText('2026-09');
  await expect(when.locator('.rf-when__hint')).toContainText('P260920-');
  await expect(page.locator('.auto-no__hint')).toContainText('P260920-01');   // 번호 예시도 그 날짜로

  // [지금으로] 되돌렸다가 다시 정한다
  await when.locator('[data-act="when-now"]').click();
  await expect(when.locator('.rf-when__value')).toHaveText('지금');
  await expect(page.locator('.auto-no__hint')).toContainText('P261022-01');
  await when.locator('[data-act="when-open"]').click();
  await page.locator('#rfWhenInput').fill('2026-09-20T10:30');
  await page.locator('#rfWhenInput').press('Enter');                          // Enter 도 [이 날짜로]
  await expect(when.locator('.rf-when__value')).toHaveText('9월 20일 (일) 10:30');

  await finish(page, '지난 날짜 조치');
  await expect.poll(async () => cellOf((await sheet.dump())['2026-09'], '리포트 번호', '지난 날짜 조치'),
    { timeout: 15000 }).toBe('P260920-01');
  const rows = (await sheet.dump())['2026-09'];
  expect(cellOf(rows, '작성일시', '지난 날짜 조치')).toBe('2026-09-20 10:30:00');
  expect(((await sheet.dump())['2026-10'] || []).some((r) => r.join(' ').includes('지난 날짜 조치'))).toBe(false);
});

test('작성일시를 안 바꾸면 예전처럼 올리는 날 · 임시보관한 날짜는 이어 쓰기에서도 남는다', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/report/new');
  await page.locator('#rfWhen [data-act="when-open"]').click();
  await page.locator('#rfWhenInput').fill('2026-10-01T08:00');
  await page.locator('#rfWhen [data-act="when-ok"]').click();
  await field(page, '매장명').fill('보관점');
  await page.locator('[data-act="save-draft"]').first().click();
  await expect(page.locator('.toast', { hasText: '기기에 저장했습니다' })).toBeVisible();
  const id = await page.evaluate(async () => {
    const { api } = await import('/js/api.js');
    const list = await api.listReports();
    return list.items ? list.items[0].id : list[0].id;
  });
  await openApp(page, `#/report/new?draft=${id}`);
  await expect(page.locator('#rfWhen .rf-when__value')).toHaveText('10월 1일 (목) 08:00');

  await openApp(page, '#/report/new?fresh=1');
  await expect(page.locator('#rfWhen .rf-when__value')).toHaveText('지금');
  await finish(page, '오늘 날짜 조치');
  await expect.poll(async () => cellOf((await sheet.dump())['2026-10'], '리포트 번호', '오늘 날짜 조치'),
    { timeout: 15000 }).toBe('P261022-01');
});
