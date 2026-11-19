// 동작 시험 보강 ⑦ 리포트 고치기 — 이력 [수정] 은 같은 줄을 고친다 · 새 리포트는 절대 옛 줄을 고치지 않는다
const { test, expect, openApp } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

const rowsOf = async (sheet) => (await sheet.dump())['2026-10'] || [];
const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

async function openFromHistory(page, store) {
  await openApp(page, '#/reports');
  const row = page.locator('.hist-row', { hasText: store });
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();
}

test('이력 [수정] → #/report/edit · 저장하면 같은 줄이 바뀌고 줄이 늘지 않는다', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);
  await seed(sheet);
  const before = await rowsOf(sheet);
  await openFromHistory(page, '옥동식 서초점');
  await page.locator('#modalRoot [data-act="edit"]').click();
  await expect(page).toHaveURL(/#\/report\/edit$/);
  await expect(page.locator('.page-head__title')).toHaveText('리포트 수정');
  await expect(field(page, '매장명')).toHaveValue('옥동식 서초점');
  await field(page, '조치 내용').fill('커넥터 재체결 · 고친 내용');
  await page.locator('#reportForm button[type=submit]').click();
  await expect(page.locator('#toasts')).toContainText(/기록했습니다|저장/, { timeout: 15000 });
  const after = await rowsOf(sheet);
  expect(after.length).toBe(before.length);
  expect(after.some((r) => r.join(' ').includes('고친 내용'))).toBe(true);
});

test('새 리포트는 [수정] 에서 남은 줄 정보를 절대 쓰지 않는다 — 새 줄로 올라간다', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);
  await seed(sheet);
  await openFromHistory(page, '옥동식 서초점');
  await page.locator('#modalRoot [data-act="edit"]').click();
  await expect(page).toHaveURL(/#\/report\/edit$/);
  const before = await rowsOf(sheet);
  // 고치다 말고 [새 리포트] 로 — 남아 있는 '고칠 줄' 정보가 따라오면 옛 줄을 덮어쓴다 (원래 사고)
  await openApp(page, '#/report/new?fresh=1');
  await expect(page.locator('.page-head__title')).toHaveText('새 현장 리포트');
  await field(page, '매장명').fill('새로온매장');
  await field(page, '로봇 시리얼').fill('SN-NEW-9');
  await page.locator('#reportForm .field', { has: page.locator('label', { hasText: '로봇 모델' }) }).locator('[data-value="Gen.1(D1)"]').first().click();
  await field(page, '증상 요약').fill('새 증상');
  await field(page, '조치 내용').fill('새 조치');
  await page.locator('#reportForm .field', { has: page.locator('label', { hasText: '처리 결과' }) }).locator('[data-value="완료"]').first().click();
  await page.locator('#reportForm button[type=submit]').click();
  await expect(page).toHaveURL(/#\/reports\/[0-9a-z]+$/, { timeout: 15000 });
  const after = await rowsOf(sheet);
  expect(after.length).toBe(before.length + 1);
  expect(after.some((r) => r.join(' ').includes('옥동식 서초점'))).toBe(true);           // 옛 줄은 그대로
  const link = await page.evaluate(async () => {
    const id = location.hash.split('/').pop();
    return (await (await import('/js/local/store.js')).getReport(id)).sheetLink;
  });
  expect(link).toBeNull();
});

test('#/report/edit 로 바로 들어오면(고칠 줄을 모르면) 이력으로 돌려보낸다', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.clear());
  await openApp(page, '#/report/edit');
  await expect(page).toHaveURL(/#\/reports$/);
});
