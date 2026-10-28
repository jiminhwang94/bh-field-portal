// v3.37 — 차량 재고: 카드 2칸 · 순서는 [순서 바꾸기] 모드에서만
const { test, expect, openApp } = require('./fixtures.js');

const rowsOf = async (sheet, name) => ((await sheet.dump())[name] || []).slice(2);
const CATS = {
  '소모품': ['그리퍼 실리콘 패드', '가스게이지', '케이블 타이', '절연 테이프'],
  '페리페럴': ['LiDAR 센서', '카메라 모듈', '스피커', '터치 패널', 'USB 허브', '비상정지 버튼'],
  '케이블': ['C to C 2m', 'LAN 5m', '전원 케이블'],
};
const INV = { vehicles: ['스타리아 5868'], items: [] };
for (const [category, names] of Object.entries(CATS)) {
  for (const partName of names) INV.items.push({ vehicleName: '스타리아 5868', partName, category, quantity: 2, minQuantity: 1 });
}

async function openInventory(page, sheet) {
  await sheet.call({ inventory: 'push', ...INV });
  await openApp(page, '#/inventory');
  await page.locator('#btn-update').click();
  await expect(page.locator('.inv-card')).toHaveCount(13);
  await expect(page.locator('#btn-update')).toBeEnabled();      // 받기가 끝나 목록을 다시 그린 뒤
}

const names = (page) => page.locator('.ord-row:not(.ord-row--cat) .ord-name').allTextContents();

test('가로 태블릿 — 카드가 2칸이고, 한 화면에 3줄보다 훨씬 많이 보인다', async ({ page, sheet }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openInventory(page, sheet);
  const [a, b] = await page.locator('.inv-card').evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect().top));
  expect(Math.abs(a - b)).toBeLessThan(2);                                   // 첫 두 장이 나란히
  const shown = await page.locator('.inv-card').evaluateAll((els) => els.filter((e) => {
    const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
  }).length);
  expect(shown).toBeGreaterThanOrEqual(8);                                   // 예전에는 3줄
  // 내려도 거르기 줄은 위에 붙어 있다
  await page.locator('#view').evaluate((v) => { v.scrollTop = 600; });
  const top = await page.locator('.inv-filter').evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThan(120);
});

test('평소 목록에는 끌기 손잡이가 없다 — 손으로 밀어도 순서가 안 바뀐다', async ({ page, sheet }) => {
  await openInventory(page, sheet);
  await expect(page.locator('[data-drag]')).toHaveCount(0);
  const first = await page.locator('.inv-card .inv-pick__name').first().textContent();
  const card = page.locator('.inv-card').first();
  // 받기 뒤 목록을 다시 그리는 사이에는 카드가 잠깐 없다 — 자리를 잡을 때까지 다시 잰다 (CI 에서만 났다)
  let box = null;
  await expect.poll(async () => (box = await card.boundingBox()) !== null).toBe(true);
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 400, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.inv-card .inv-pick__name').first()).toHaveText(first);
});

test('[순서 바꾸기] — 품목 ↑↓ · [취소] 는 버리고 [완료] 는 시트까지 저장', async ({ page, sheet }) => {
  await openInventory(page, sheet);
  await page.locator('[data-act="order-start"]').click();
  await expect(page.locator('.inv-filter')).toHaveCount(0);                  // 거르기 · 수량 버튼은 치운다
  await expect(page.locator('.inv-step')).toHaveCount(0);
  const row = (n) => page.locator('.ord-row', { hasText: n });
  await expect(row('그리퍼 실리콘 패드').locator('[data-dir="-1"]')).toBeDisabled();   // 분류 맨 위
  await row('가스게이지').locator('[data-dir="-1"]').click();
  expect((await names(page)).slice(0, 2)).toEqual(['가스게이지', '그리퍼 실리콘 패드']);
  await expect(row('가스게이지')).toHaveClass(/is-moved/);
  // 품목은 자기 분류 밖으로 못 나간다
  await expect(row('절연 테이프').locator('[data-dir="1"]')).toBeDisabled();
  await page.locator('[data-act="order-cancel"]').click();
  await expect(page.locator('.inv-card .inv-pick__name').first()).toHaveText('그리퍼 실리콘 패드');

  await page.locator('[data-act="order-start"]').click();
  await row('가스게이지').locator('[data-dir="-1"]').click();
  await page.locator('.ord-row--cat', { hasText: '케이블' }).locator('[data-dir="-1"]').click();
  await page.locator('[data-act="order-done"]').click();
  await expect(page.locator('.grp-row .grp-name')).toHaveText(['소모품', '케이블', '페리페럴']);
  await expect(page.locator('.inv-card .inv-pick__name').first()).toHaveText('가스게이지');
  await expect.poll(async () => (await rowsOf(sheet, '차량재고')).map((r) => r[0]).slice(0, 5).join(','), { timeout: 15000 })
    .toBe('가스게이지,그리퍼 실리콘 패드,케이블 타이,절연 테이프,C to C 2m');
});

test('카드에서 바로 +/− · 이름을 누르면 상세 창', async ({ page, sheet }) => {
  await openInventory(page, sheet);
  const card = page.locator('.inv-card', { hasText: 'LiDAR 센서' });
  await card.locator('.inv-step__btn--plus').click();
  await expect(card.locator('.inv-qty')).toHaveText('3');
  await card.locator('.inv-pick').click();
  await expect(page.locator('#modalRoot')).toContainText('숫자로 바로 입력');
});
