const { test, expect, openApp } = require('./fixtures.js');

const SCREENS = ['#/', '#/report/new', '#/reports', '#/guides', '#/driving', '#/inventory', '#/settings', '#/fields'];

test('모든 화면이 오류 없이 열린다 · 테스트 모드 띠가 보인다', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#test-banner')).toBeVisible();
  for (const hash of SCREENS) {
    await page.goto(`/${hash}`);
    await expect(page.locator('#view')).not.toBeEmpty();
    await expect(page.locator('#view .error, #view .error-view')).toHaveCount(0);
  }
});

test('가로로 넘치지 않는다 (폰 · 태블릿)', async ({ page }) => {
  for (const hash of SCREENS) {
    await openApp(page, hash);
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${hash} 가로 넘침`).toBeLessThanOrEqual(1);
  }
});
