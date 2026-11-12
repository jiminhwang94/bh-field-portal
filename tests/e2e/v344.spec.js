// v3.44 — 운행 기록의 출발지 · 도착지: 최근 다녀온 5곳만 · 글자를 치면 그 전에 다녀온 비슷한 곳
const { test, expect, openApp } = require('./fixtures.js');
const { seed } = require('./seed.js');

// 오래된 것부터 — 날마다 언주사무실에서 한 곳씩 다녀왔다
const PLACES = ['옥동식 서초점', '홍기와 본점', '돈우마을 속초본점', '무연돈', '테스트매장', '강남창고', '판교센터'];

test('운행 기록 — 최근 다녀온 5곳만 · 치면 비슷한 곳 (이름 일부 · 초성)', async ({ page, sheet }) => {
  await seed(sheet);                                                         // 차량은 재고에서 온다
  await openApp(page, '#/inventory');
  await expect(page.locator('.inv-card').first()).toBeVisible({ timeout: 15000 });
  await openApp(page, '#/driving');
  await expect(page.locator('.drv-hero')).toBeVisible();
  await page.evaluate(async (places) => {
    const { api } = await import('/js/api.js');
    const vehicleName = localStorage.getItem('bh_driving_vehicle');
    let odo = 1000;
    for (const [i, to] of places.entries()) {
      await api.saveDriving({ vehicleName, date: `2026-11-0${i + 1}`, odoBefore: odo, odoAfter: odo + 10,
        fromPlace: '언주사무실', toPlace: to });
      odo += 10;
    }
  }, PLACES);
  await page.reload();
  await page.locator('.drv-hero__add').click();

  const tags = page.locator('[data-places-for="drvFrom"] [data-place]');
  await expect(page.locator('[data-places-for="drvFrom"] .drv-places__head')).toHaveText('최근 다녀온 곳');
  await expect(tags).toHaveText(['언주사무실', '판교센터', '강남창고', '테스트매장', '무연돈']);   // 새것부터 5곳

  await page.locator('#drvFrom').fill('옥동');                                // 그 전에 다녀온 곳은 치면 나온다
  await expect(page.locator('[data-places-for="drvFrom"] .drv-places__head')).toHaveText('비슷한 곳');
  await expect(tags).toHaveText(['옥동식 서초점']);
  await page.locator('#drvFrom').fill('ㅎㄱ');                                 // 초성만 쳐도
  await expect(tags).toHaveText(['홍기와 본점']);
  await tags.first().click();
  await expect(page.locator('#drvFrom')).toHaveValue('홍기와 본점');
  await expect(tags).toHaveCount(5);                                          // 고르면 다시 최근 5곳

  await page.locator('#drvTo').fill('없는곳');                                 // 맞는 곳이 없으면 태그 줄이 비고 숨는다
  await expect(page.locator('[data-places-for="drvTo"]')).toBeHidden();
  await expect(page.locator('[data-places-for="drvFrom"] [data-place]')).toHaveCount(5);   // 다른 칸은 그대로
});
