// 동작 시험 보강 ⑧ 켤 때 — 시트를 기다리지 않고 그린다 · 받기는 동시에 · 바뀐 게 있을 때만 다시 그린다
const { test, expect, openApp, SHEET } = require('./fixtures.js');
const { seed } = require('./seed.js');

/** 시트 답을 ms 만큼 늦춘다. 받기 요청이 언제 나가고 언제 끝났는지 적는다 */
async function slowSheet(page, ms) {
  const log = [];
  await page.route(`${SHEET}/exec`, async (route) => {
    const body = route.request().postData() || '';
    const kind = (/"(fields|inventory|guides|work)":"pull"/.exec(body) || [])[1];
    const entry = kind ? { kind, start: Date.now(), end: 0 } : null;
    if (entry) log.push(entry);
    await new Promise((r) => setTimeout(r, ms));
    try { await route.continue(); } catch { /* 페이지가 닫혔다 */ }
    if (entry) entry.end = Date.now();
  });
  return log;
}

test('켤 때 — 시트가 늦어도 화면부터 그린다 · 항목 · 재고 · 가이드를 한꺼번에 받는다', async ({ page, sheet }) => {
  await seed(sheet);
  const log = await slowSheet(page, 2500);
  const t0 = Date.now();
  await openApp(page, '#/');
  await expect(page.locator('.door--new')).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(2500);                 // 2.5초 늦는 시트를 기다리지 않았다
  await expect.poll(() => ['fields', 'inventory', 'guides'].every((k) => log.some((e) => e.kind === k && e.end)),
    { timeout: 20000 }).toBe(true);
  const first = (k) => log.find((e) => e.kind === k);
  const starts = ['fields', 'inventory', 'guides'].map((k) => first(k).start);
  const ends = ['fields', 'inventory', 'guides'].map((k) => first(k).end);
  expect(Math.max(...starts)).toBeLessThan(Math.min(...ends));  // 하나가 끝나기 전에 셋 다 나갔다 (차례로가 아니다)
});

test('켤 때 — 시트에서 바뀐 것이 없으면 화면을 다시 그리지 않는다', async ({ page, sheet }) => {
  await seed(sheet);
  await openApp(page, '#/guides');
  await page.waitForTimeout(2500);                              // 처음 받기 (바뀐 것이 있어 다시 그림)
  // 같은 자료로 다시 켠다 — 이번에는 받아도 바뀐 것이 없다
  const log = await slowSheet(page, 300);
  await page.reload();
  await expect(page.locator('#view')).not.toBeEmpty();
  await page.evaluate(() => { document.querySelector('#view > *').dataset.mark = 'same'; });
  await expect.poll(() => log.filter((e) => e.end).length, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (document.querySelector('#view > *') || {}).dataset?.mark)).toBe('same');
});
