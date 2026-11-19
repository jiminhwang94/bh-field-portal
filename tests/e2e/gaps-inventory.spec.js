// 동작 시험 보강 ③ 차량 재고 — [+]/[−] 실패 되돌리기 · [수정] 은 바꾼 칸만 · 검색 · 칩은 목록만 다시 그린다
const { test, expect, openApp } = require('./fixtures.js');
const { seed } = require('./seed.js');

const PAD = '그리퍼 실리콘 패드';

async function open(page, sheet) {
  await seed(sheet);
  await openApp(page, '#/inventory');
  await page.locator('#btn-update').click();
  // [새로고침] 이 끝나면 화면을 한 번 다시 그린다 — 그 뒤에 시작한다
  await expect(page.locator('#btn-update')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#btn-update')).not.toHaveText('받는 중…');
  await page.waitForTimeout(500);
  await expect(page.locator('.inv-card', { hasText: PAD })).toBeVisible({ timeout: 15000 });
}
const card = (page) => page.locator('.inv-card', { hasText: PAD });
const qtyIn = (page, id) => page.evaluate(async (itemId) => {
  const store = await import('/js/local/store.js');
  return (await store.listInventory()).find((i) => i.id === itemId);
}, id);

test('[+] 가 실패하면 원래 수량으로 되돌린다 (보낸 만큼 빼지 않는다)', async ({ page, sheet }) => {
  await open(page, sheet);
  const id = await card(page).getAttribute('data-id');
  const before = Number(await card(page).locator('.inv-qty').textContent());
  // 저장소에서 그 품목을 몰래 지운다 → 저장이 실패한다
  await page.evaluate(async (itemId) => (await import('/js/local/idb.js')).remove('inventory', itemId), id);
  await card(page).locator('[data-act="inc"]').click();
  await expect(page.locator('#toasts .toast--err')).toBeVisible();
  await expect(card(page).locator('.inv-qty')).toHaveText(String(before));
});

test('[수정] — 최소 보유만 고치면 보유 수량은 보내지 않는다 (창을 연 사이 바뀐 수량을 덮지 않는다)', async ({ page, sheet }) => {
  await open(page, sheet);
  const id = await card(page).getAttribute('data-id');
  await card(page).locator('[data-act="select"]').click();
  await page.locator('#sheetBody [data-act="edit"]').click();
  await expect(page.locator('#invMin')).toBeVisible();
  const shown = Number(await page.locator('#invQty').inputValue());
  // 창을 연 사이 다른 곳에서 +5 (다른 화면 · 동기화)
  await page.evaluate(async (itemId) => (await import('/js/local/store.js')).updateInventoryItem(itemId, { delta: 5 }), id);
  await page.locator('#invMin').fill('9');
  await page.locator('#invForm button[type=submit]').click();
  await expect(page.locator('#toasts')).toContainText('저장했습니다');
  const after = await qtyIn(page, id);
  expect(after.minQuantity).toBe(9);
  expect(after.quantity).toBe(shown + 5);                       // 창에 적혀 있던 옛 값으로 덮이지 않았다
});

test('검색 — 글자를 칠 때마다 목록만 바뀌고 검색칸 · 커서는 그대로', async ({ page, sheet }) => {
  await open(page, sheet);
  const box = page.locator('#invQ');
  await box.click();
  await page.evaluate(() => { document.getElementById('invQ').dataset.mark = 'same'; });
  await page.keyboard.type('가스');
  await expect(page.locator('.inv-card')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const el = document.getElementById('invQ');
    return el.dataset.mark === 'same' && document.activeElement === el && el.selectionStart === el.value.length;
  })).toBe(true);
});

test('칩 · 보충 필요 띠를 눌러도 화면 전체를 다시 그리지 않는다 (목록만)', async ({ page, sheet }) => {
  await open(page, sheet);
  await page.evaluate(() => {
    document.getElementById('invQ').dataset.mark = 'same';
    document.querySelector('.inv-head').dataset.mark = 'same';
  });
  const all = await page.locator('.inv-card').count();
  await page.locator('.inv-alert').click();                      // 부족만
  await expect(page.locator('.inv-card')).not.toHaveCount(all);
  await page.locator('.inv-alert').click();                      // 다시 전체
  await expect(page.locator('.inv-card')).toHaveCount(all);
  expect(await page.evaluate(() => document.getElementById('invQ').dataset.mark === 'same'
    && document.querySelector('.inv-head').dataset.mark === 'same')).toBe(true);
});
