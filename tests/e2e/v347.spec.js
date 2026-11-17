// v3.47 — 서버: 받은 뒤 그 사이 다른 기기가 먼저 올렸으면 다시 받아 합친다 (한쪽 변경이 사라지지 않는다)
const { test, expect, openApp, SHEET } = require('./fixtures.js');
const { seed } = require('./seed.js');

test('재고 — 내가 합쳐 올리는 사이 다른 태블릿이 품목을 더해도 둘 다 남는다', async ({ page, sheet }) => {
  await seed(sheet);
  await openApp(page, '#/inventory');
  await expect(page.locator('.inv-card').first()).toBeVisible({ timeout: 15000 });

  // 내 '올리기' 가 시트에 닿기 직전에, 다른 태블릿이 먼저 '남품목' 을 올린다
  let raced = false;
  let pushes = 0;
  await page.route(`${SHEET}/exec`, async (route) => {
    const body = route.request().postData() || '';
    if (body.includes('"inventory":"push"')) {
      pushes += 1;
      if (!raced) {
        raced = true;
        const now = await sheet.call({ inventory: 'pull' });
        await sheet.call({ inventory: 'push', vehicles: now.vehicles,
          items: [...now.items, { vehicleName: now.vehicles[0], partName: '남품목', category: '', quantity: 3, minQuantity: 0 }] });
      }
    }
    return route.continue();
  });

  await page.evaluate(async () => {
    const store = await import('/js/local/store.js');
    const items = await store.listInventory();
    await store.addInventoryItem(items[0].vehicleName, '내품목', 1, 0);
    await (await import('/js/sync.js')).flushOutbox({ force: true });
  });

  await expect.poll(async () => (await sheet.call({ inventory: 'pull' })).items.map((i) => i.partName), { timeout: 15000 })
    .toEqual(expect.arrayContaining(['내품목', '남품목']));
  expect(pushes).toBe(2);                                                       // 한 번 거절되고, 다시 합쳐 올렸다
  const local = await page.evaluate(async () => (await (await import('/js/local/store.js')).listInventory()).map((i) => i.partName));
  expect(local).toEqual(expect.arrayContaining(['내품목', '남품목']));            // 기기에도 둘 다
});
