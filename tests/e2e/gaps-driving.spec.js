// 동작 시험 보강 ⑥ 운행일지 — 빈 칸은 0 이 아니다 · 거꾸로 막기 · 지난 ⑥ → 다음 ⑤ · 쉼표와 커서 ·
// 적은 곳 기억 · 받을 때 다른 차량 · 빈 시트 때문에 기기 기록을 지우지 않는다
const { test, expect, openApp, SHEET } = require('./fixtures.js');
const { seed } = require('./seed.js');

async function openDriving(page, sheet) {
  await seed(sheet);
  await openApp(page, '#/driving');
  await expect(page.locator('.veh-tab').first()).toBeVisible({ timeout: 15000 });
}
async function openAdd(page) {
  await page.locator('.drv-hero__add').click();
  await expect(page.locator('#drvForm')).toBeVisible();
}

test('빈 칸은 0 이 아니다 · 주행 후가 주행 전보다 작으면 막는다', async ({ page, sheet }) => {
  await openDriving(page, sheet);
  await openAdd(page);
  await page.locator('#drvBefore').fill('');
  await page.locator('#drvAfter').fill('120');
  await page.locator('#drvForm button[type=submit]').click();
  await expect(page.locator('#toasts .toast--err')).toContainText('주행 전');
  await page.locator('#drvBefore').fill('200');
  await page.locator('#drvAfter').fill('150');
  await page.locator('#drvForm button[type=submit]').click();
  await expect(page.locator('#toasts .toast--err').last()).toContainText('작습니다');
  expect(await page.evaluate(async () => (await (await import('/js/local/idb.js')).getAll('driving')).length)).toBe(0);
});

test('지난번 ⑥ 주행 후 거리가 다음 기록의 ⑤ 에 들어간다 · 적은 출발지 · 도착지는 기억한다', async ({ page, sheet }) => {
  await openDriving(page, sheet);
  await openAdd(page);
  await page.locator('#drvBefore').fill('15000');
  await page.locator('#drvAfter').fill('15320');
  await page.locator('#drvFrom').fill('새로운출발지');
  await page.locator('#drvTo').fill('새로운도착지');
  await page.locator('#drvForm button[type=submit]').click();
  await expect(page.locator('#toasts')).toContainText('추가했습니다');
  await openAdd(page);
  await expect(page.locator('#drvBefore')).toHaveValue('15,320');
  const places = await page.evaluate(async () => (await (await import('/js/local/store.js')).drivingOptions()).places);
  expect(places).toEqual(expect.arrayContaining(['새로운출발지', '새로운도착지']));
});

test('계기판 칸 — 쉼표가 붙어도 커서가 제자리에 남는다', async ({ page, sheet }) => {
  await openDriving(page, sheet);
  await openAdd(page);
  const box = page.locator('#drvAfter');
  await box.fill('');
  await box.click();
  await page.keyboard.type('15000');
  await expect(box).toHaveValue('15,000');
  expect(await box.evaluate((el) => el.selectionStart)).toBe(6);
  await box.evaluate((el) => el.setSelectionRange(1, 1));         // '1|5,000'
  await page.keyboard.type('2');
  await expect(box).toHaveValue('125,000');
  expect(await box.evaluate((el) => el.selectionStart)).toBe(2);  // '12|5,000' — 끝으로 튀지 않는다
});

test('받기 — 한 차량만 받을 때 다른 차량 기록 · 빈 시트 때문에 기기 기록을 지우지 않는다', async ({ page, sheet }) => {
  await openDriving(page, sheet);
  await page.route(`${SHEET}/exec`, (route) => {
    const body = route.request().postData() || '';
    if (/"driving":"pull"/.test(body)) {
      const one = /"vehicleName":"스타리아 5868"/.test(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, options: {}, info: {}, version: 'v',
        rows: one ? [{ id: 'sheetA', vehicleName: '스타리아 5868', date: '2026-10-20', odoBefore: 1, odoAfter: 2 }] : [],
      }) });
    }
    return route.continue();
  });
  const left = await page.evaluate(async () => {
    const idb = await import('/js/local/idb.js');
    await idb.clear('outbox');
    const mk = (id, v) => idb.put('driving', { id, vehicleName: v, date: '2026-10-19', weekday: '월', dept: '', driverName: '',
      odoBefore: 10, odoAfter: 20, distance: 10, fromPlace: '', toPlace: '', note: '', createdAt: 'x', updatedAt: 'x' });
    await mk('otherCar', '스타리아 4373');
    const drive = await import('/js/drivesheet.js');
    await drive.pullDriving('스타리아 5868');                        // 한 차량만 받기
    await drive.pullDriving();                                        // 시트가 비었다 (모든 차량)
    return (await idb.getAll('driving')).map((r) => r.id).sort();
  });
  expect(left).toEqual(['otherCar', 'sheetA']);
});
