// 가이드 · 재고 — 기기에서 고친 것이 시트에 그대로 적히는지, 지운 것이 되살아나지 않는지.
const { test, expect, openApp } = require('./fixtures.js');

const tabText = async (sheet, name) => ((await sheet.dump())[name] || []).flat().join(' ');

async function writeGuide(page, title) {
  await openApp(page, '#/guides/new/ERROR_CODE?model=Gen.1');
  await page.locator('#gTitle').fill(title);
  const step = page.locator('textarea[name=stepText]').first();
  if (!(await step.count())) await page.locator('[data-act="add-step"]').click();
  await page.locator('textarea[name=stepText]').first().fill('커넥터를 다시 꽂는다');
  await page.locator('#guideForm button[type=submit]').click();
  await expect(page).toHaveURL(/#\/guides\/[0-9a-f]{6,}$/);
}

test('가이드를 만들면 시트 탭에 적히고, 지우면 시트에서도 빠진다', async ({ page, sheet }) => {
  await writeGuide(page, 'E-777 검사용 오류');
  await expect.poll(() => tabText(sheet, '오류 코드 가이드'), { timeout: 15000 }).toContain('E-777 검사용 오류');
  expect(await tabText(sheet, '오류 코드 가이드')).toContain('Gen.1');   // 로봇 열

  await page.locator('[data-act="delete"]').first().click();
  await page.locator('#modalRoot [data-act="ok"]').click();
  await expect.poll(() => tabText(sheet, '오류 코드 가이드'), { timeout: 15000 }).not.toContain('E-777');

  // 새로고침해도 되살아나지 않는다 (예전 버그)
  await page.reload();
  await openApp(page, '#/guides/m/Gen.1/ERROR_CODE');
  await page.waitForTimeout(1500);
  await expect(page.locator('#view')).not.toContainText('E-777');
});

test('로봇이 없는 가이드를 한 번에 지정하면 시트의 로봇 열이 바뀐다', async ({ page, sheet }) => {
  await openApp(page, '#/guides/new/ERROR_CODE');
  await page.locator('#gTitle').fill('E-555 미지정 가이드');
  if (!(await page.locator('textarea[name=stepText]').count())) await page.locator('[data-act="add-step"]').click();
  await page.locator('textarea[name=stepText]').first().fill('점검');
  await page.locator('#guideForm button[type=submit]').click();
  await expect.poll(() => tabText(sheet, '오류 코드 가이드'), { timeout: 15000 }).toContain('E-555');

  await openApp(page, '#/guides/assign');
  await page.locator('.pick-row', { hasText: 'E-555' }).locator('.pick-row__box').check();
  await page.locator('.assign-bar__robot[data-model="Gen.2"]').click();
  await expect.poll(async () => {
    const rows = (await sheet.dump())['오류 코드 가이드'] || [];
    const line = rows.find((r) => r.join(' ').includes('E-555')) || [];
    return line[0];
  }, { timeout: 15000 }).toBe('Gen.2');
});

test('재고 [+] 를 누르면 시트의 수량 칸이 바뀐다', async ({ page, sheet }) => {
  await sheet.call({ inventory: 'push', vehicles: ['검사차'], items: [
    { vehicleName: '검사차', partName: '진공 패드', category: '소모품', quantity: 2, minQuantity: 3 },
  ] });
  await openApp(page, '#/inventory');
  await page.locator('.inv-pick', { hasText: '진공 패드' }).first().click();
  await page.locator('.inv-stepper__btn[data-act="inc"]').click();
  await expect.poll(async () => {
    const rows = (await sheet.dump())['차량재고'] || [];
    const line = rows.find((r) => r[0] === '진공 패드') || [];
    return line[3];
  }, { timeout: 15000 }).toBe(3);
});
