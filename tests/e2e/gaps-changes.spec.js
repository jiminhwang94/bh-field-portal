// 동작 시험 보강 ⑤ [새 내용] 점 — 남이 바꾸면 켜고 · 내 올리기는 끄지 않고 · 받으면 끈다 · 묻기만 한다
const { test, expect, openApp, SHEET } = require('./fixtures.js');

test('[새 내용] 점 — 켜기 · 내 올리기로 꺼지지 않기 · [새로고침] 으로 끄기 · 자료는 받지 않는다', async ({ page }) => {
  let stamp = '2026-10-22T01:00:00.000Z';
  const asked = [];
  await page.route(`${SHEET}/exec`, (route) => {
    const body = route.request().postData() || '';
    if (/"changed":true/.test(body)) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, changedAt: stamp, minVersion: '' }) });
    }
    asked.push(body.slice(0, 60));
    return route.continue();
  });
  await openApp(page, '#/');
  const btn = page.locator('#btn-update');
  await page.waitForTimeout(1500);
  await expect(btn).not.toHaveClass(/has-new/);                     // 켤 때 지금 시각을 '아는 것' 으로

  // 남이 올렸다 — 묻기만 하고 점을 켠다 (자료를 받거나 화면을 다시 그리지 않는다)
  stamp = '2026-10-22T02:00:00.000Z';
  await page.evaluate(() => { document.querySelector('#view > *').dataset.mark = 'same'; });
  asked.length = 0;
  await page.evaluate(async () => (await import('/js/changes.js')).checkChanges());
  await expect(btn).toHaveClass(/has-new/);
  await expect(btn).toContainText('새 내용');
  expect(asked.filter((b) => /pull|months/.test(b))).toEqual([]);
  expect(await page.evaluate(() => document.querySelector('#view > *').dataset.mark)).toBe('same');

  // 내가 무언가 올렸다 — 이미 켜진 점은 남긴다 (남이 올린 것을 아직 안 받았다)
  stamp = '2026-10-22T03:00:00.000Z';
  await page.evaluate(async () => (await import('/js/changes.js')).checkChanges({ absorb: true, keepNew: true }));
  await expect(btn).toHaveClass(/has-new/);

  // [새로고침] 으로 받으면 끈다
  await btn.click();
  await expect(btn).toBeEnabled({ timeout: 15000 });
  await expect(btn).not.toHaveClass(/has-new/, { timeout: 15000 });
});
