// v3.45.1 — 시트의 아이디 칸에 따옴표 · 꺾쇠가 든 값이 와도 화면에 코드가 끼어들지 않는다
const { test, expect, openApp } = require('./fixtures.js');

const EVIL = '"><img src=x onerror="window.__pwned=1">';

test('시트에서 온 이상한 아이디 — 가이드 · 가이드 항목 · 리포트 항목 화면이 안전하다', async ({ page, sheet }) => {
  await sheet.call({
    guides: 'push',
    items: [{ id: EVIL, categoryType: 'HARDWARE_SOP', category: 'c-ok', robotModel: 'Gen.1',
              codeOrTitle: '이상한 아이디 가이드', steps: [{ instruction: '단계', expectedMetric: '' }],
              updatedAt: '2026-10-20T10:00:00' }],
    models: ['Gen.1'],
    cats: { 'Gen.1': [{ id: 'c-ok', name: '정상 항목', form: 'HARDWARE_SOP' },
                      { id: `c-x${EVIL}`, name: '이상한 항목', form: 'HARDWARE_SOP' }] },
  });
  await sheet.call({ fields: 'push', items: [{ id: EVIL, fieldLabel: '이상한 칸', fieldType: 'TEXT', options: '' }] });

  await openApp(page, '#/guides');
  await expect.poll(async () => page.evaluate(async () => {
    const { api } = await import('/js/api.js');
    return (await api.listGuides()).items.map((g) => g.id);
  }), { timeout: 15000 }).toHaveLength(1);

  const ids = await page.evaluate(async () => {
    const { api } = await import('/js/api.js');
    const store = await import('/js/local/store.js');
    return {
      guide: (await api.listGuides()).items[0].id,
      cats: (await store.listGuideCats('Gen.1')).map((c) => c.id),
    };
  });
  expect(ids.guide).toMatch(/^[A-Za-z0-9_-]+$/);                               // 새 아이디로 바뀌었다
  expect(ids.cats).toEqual(['c-ok']);                                           // 이상한 항목은 받지 않는다

  for (const hash of ['#/guides', '#/guides/m/Gen.1', `#/guides/${ids.guide}`, '#/fields', '#/report/new']) {
    await openApp(page, hash);
    await page.waitForTimeout(300);
  }
  await openApp(page, '#/fields');
  await expect(page.locator('#view')).toContainText('이상한 칸', { timeout: 15000 });
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});
