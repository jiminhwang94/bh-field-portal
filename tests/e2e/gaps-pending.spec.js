// 동작 시험 보강 ④ [올릴 내용] 되돌리기 — 여러 번 누른 것도 맨 처음 값으로 · 운행일지 · 품목 순서
const { test, expect, openApp } = require('./fixtures.js');
const { seed } = require('./seed.js');

/** 앱을 열고 받은 뒤 오프라인으로 — 이후 바꾼 것은 대기열에 남는다 */
async function offlineWithData(page, sheet) {
  await seed(sheet);
  await openApp(page, '#/inventory');
  await page.locator('#btn-update').click();
  await expect(page.locator('#btn-update')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('.inv-card').first()).toBeVisible({ timeout: 15000 });
  // 되돌리기 창이 쓰는 화면 파일은 오프라인이 되기 전에 불러 둔다 (시험에서는 서비스 워커가 꺼져 있다)
  await page.evaluate(() => Promise.all(['/js/pending.js', '/js/syncnow.js', '/js/reportsheet.js', '/js/sync.js']
    .map((m) => import(m))));
  await page.context().setOffline(true);
  await page.evaluate(async () => (await import('/js/local/idb.js')).clear('outbox'));
}

/** 대기열 창을 열고 하나뿐인 줄을 [되돌리기] → [예] */
async function undoOnly(page) {
  await page.evaluate(async () => (await import('/js/pending.js')).openPendingList());
  const rows = page.locator('#pendingRows .row');
  await expect(rows).toHaveCount(1);
  await rows.locator('[data-act="undo-ask"]').click();
  await rows.locator('[data-act="undo-yes"]').click();
  await expect(page.locator('#toasts')).toContainText(/되돌렸습니다|지웠습니다/);
}

test('수량 — [+] 를 세 번 누르고 되돌리면 중간값이 아니라 맨 처음 값으로', async ({ page, sheet }) => {
  await offlineWithData(page, sheet);
  const { id, before } = await page.evaluate(async () => {
    const store = await import('/js/local/store.js');
    const item = (await store.listInventory()).find((i) => i.partName === '가스게이지');
    for (let i = 0; i < 3; i += 1) await store.updateInventoryItem(item.id, { delta: 1 });
    return { id: item.id, before: item.quantity };
  });
  await undoOnly(page);
  const after = await page.evaluate(async (itemId) => (await (await import('/js/local/store.js')).listInventory())
    .find((i) => i.id === itemId).quantity, id);
  expect(after).toBe(before);
});

test('운행일지 — 새로 적은 기록을 되돌리면 지워지고, 고친 기록은 고치기 전으로', async ({ page, sheet }) => {
  await offlineWithData(page, sheet);
  const vehicle = '스타리아 5868';
  const id = await page.evaluate(async (v) => {
    const store = await import('/js/local/store.js');
    const row = await store.saveDriving({ vehicleName: v, date: '2026-10-20', odoBefore: 100, odoAfter: 130 });
    await (await import('/js/local/idb.js')).clear('outbox');
    await store.saveDriving({ vehicleName: v, date: '2026-10-20', odoBefore: 100, odoAfter: 180 }, row.id);
    return row.id;
  }, vehicle);
  await undoOnly(page);                                            // 고친 것 되돌리기
  const row = await page.evaluate(async (rid) => (await import('/js/local/idb.js')).get('driving', rid), id);
  expect(row.odoAfter).toBe(130);

  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(async () => (await import('/js/ui.js')).closeModal());
  const fresh = await page.evaluate(async (v) => {
    await (await import('/js/local/idb.js')).clear('outbox');
    return (await (await import('/js/local/store.js')).saveDriving({ vehicleName: v, date: '2026-10-21', odoBefore: 200, odoAfter: 210 })).id;
  }, vehicle);
  await undoOnly(page);                                            // 새로 적은 것 되돌리기
  expect(await page.evaluate(async (rid) => (await import('/js/local/idb.js')).get('driving', rid), fresh)).toBeFalsy();
});

test('품목 순서 — 바꾼 순서를 되돌리면 바꾸기 전 순서로', async ({ page, sheet }) => {
  await offlineWithData(page, sheet);
  const { before } = await page.evaluate(async () => {
    const store = await import('/js/local/store.js');
    const names = [...new Set((await store.listInventory()).map((i) => i.partName))];
    const b = await store.partOrder();
    await store.reorderParts(names.slice().reverse());
    return { before: b };
  });
  await undoOnly(page);
  expect(await page.evaluate(async () => (await import('/js/local/store.js')).partOrder())).toEqual(before);
});
