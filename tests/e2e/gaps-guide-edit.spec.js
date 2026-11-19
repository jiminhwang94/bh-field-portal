// 동작 시험 보강 ⑬ 가이드 고치기 — 단계 공구는 준비 공구에서만 · 빠진 공구는 단계에서도 빠진다 · 고치면 요약을 비운다
const { test, expect, openApp } = require('./fixtures.js');
const { seed, GUIDES } = require('./seed.js');

test('단계 공구 칩은 [준비 공구] 에서만 · 준비 공구에서 빼면 단계에서도 빠진다 · 저장하면 요약은 비운다', async ({ page, sheet }) => {
  await seed(sheet);
  const g = GUIDES[0];                       // 준비: 테스터, 육각 렌치 · 1단계 테스터 · 2단계 육각 렌치 · 요약 있음
  await openApp(page, '#/');
  await page.locator('#btn-update').click();
  await expect(page.locator('#btn-update')).toBeEnabled({ timeout: 15000 });
  await openApp(page, `#/guides/edit/${g.id}`);
  const chipsOf = (i) => page.locator(`[data-tool-pick="${i}"] [data-act="toggle-tool"]`);
  await expect(chipsOf(0)).toHaveText(['테스터', '육각 렌치']);
  await expect(chipsOf(1).filter({ hasText: '육각 렌치' })).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#gTools').fill('테스터, 드라이버');
  await expect(chipsOf(1)).toHaveText(['테스터', '드라이버']);
  await expect(chipsOf(1).filter({ hasText: '드라이버' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-tool-pick] [aria-pressed="true"]')).toHaveCount(1);   // 1단계 테스터만 남았다

  await page.locator('#guideForm button[type=submit]').click();
  await expect(page).toHaveURL(new RegExp(`#/guides/${g.id}$`));
  const saved = await page.evaluate(async (id) => (await import('/js/local/idb.js')).get('guides', id), g.id);
  expect(saved.steps.map((s) => s.expectedMetric || '')).toEqual(['테스터', '']);
  expect(saved.summary || '').toBe('');
});
