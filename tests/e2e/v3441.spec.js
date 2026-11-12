// v3.44.1 — 위 [새로고침] 이 운행일지 · 이슈 유형도 받는다
const { test, expect, openApp } = require('./fixtures.js');
const { seed } = require('./seed.js');

// v3.44.1 — 위 [새로고침] 이 운행일지도 받는다 (예전에는 운행일지 화면의 [시트에서 받기] 를 눌러야 했다)
test('위 [새로고침] — 다른 태블릿이 올린 운행 기록 · 이슈 유형도 받는다', async ({ page, sheet }) => {
  await seed(sheet);
  await openApp(page, '#/inventory');
  await expect(page.locator('.inv-card').first()).toBeVisible({ timeout: 15000 });
  await openApp(page, '#/driving');
  await expect(page.locator('.drv-hero')).toBeVisible();
  const vehicleName = await page.evaluate(() => localStorage.getItem('bh_driving_vehicle'));
  // 다른 태블릿이 시트에 올렸다
  await sheet.call({ driving: 'push', vehicleName, info: {}, rows: [{
    id: 'other-tablet-1', date: '2026-11-10', weekday: '월', dept: '', driverName: '다른기사',
    odoBefore: 5000, odoAfter: 5030, distance: 30, fromPlace: '다른기기출발', toPlace: '다른기기도착', note: '',
  }] });
  await sheet.call({ work: 'push', ops: [{ op: 'cat-add', kind: '로봇 이슈', name: '새로고침분류' }] });
  await expect(page.locator('.drv-card')).toHaveCount(0);
  await page.locator('#btn-update').click();
  await expect(page.locator('.drv-card__route')).toContainText('다른기기출발', { timeout: 15000 });
  await expect.poll(async () => page.evaluate(async () => {
    const store = await import('/js/local/store.js');
    return (await store.getWorkList()).cats.map((c) => c.name);
  }), { timeout: 15000 }).toContain('새로고침분류');
});
