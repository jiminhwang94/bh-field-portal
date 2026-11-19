// 동작 시험 보강 ⑭ 위 [시트에 올리기] 와 폼 아래 버튼 — 함께 잠기고 · 같은 글자 · 함께 풀린다
const { test, expect, openApp, pick, SHEET } = require('./fixtures.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

test('올리는 동안 두 버튼이 함께 잠기고 같은 글자 · 실패하면 함께 풀린다 (두 번 눌러 두 줄이 되지 않게)', async ({ page }) => {
  let release;
  const hold = new Promise((r) => { release = r; });
  await page.route(`${SHEET}/exec`, async (route) => {
    const body = route.request().postData() || '';
    if (/"sheetName"/.test(body) && !/"media":"(chunk|finish)"/.test(body) && /잠금점/.test(body)) {
      await hold;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '시험용 거절' }) });
    }
    return route.continue();
  });
  await openApp(page, '#/report/new?fresh=1');
  await field(page, '매장명').fill('잠금점');
  await field(page, '로봇 시리얼').fill('SN-L-1');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await field(page, '증상 요약').fill('잠금 증상');
  await field(page, '조치 내용').fill('잠금 조치');
  await pick(page, '처리 결과', '완료');
  const top = page.locator('#btn-topaction');
  const bottom = page.locator('#reportForm button[type=submit]');
  await expect(top).toBeVisible();
  const idle = await bottom.textContent();
  await top.click();
  await expect(top).toBeDisabled();
  await expect(bottom).toBeDisabled();
  expect(await top.textContent()).toBe(await bottom.textContent());
  expect(await top.textContent()).not.toBe(idle);
  release();
  await expect(page.locator('#toasts .toast--err')).toContainText('시험용 거절');
  // 실패하면 리포트 상세로 옮긴다 (거기서 다시 올린다) — 새 리포트를 다시 열면 위 버튼이 잠겨 있지 않다
  await expect(page).toHaveURL(/#\/reports\/[0-9a-z]+$/);
  await openApp(page, '#/report/new?fresh=1');
  await expect(top).toBeVisible();
  await expect(top).toBeEnabled();
  await expect(bottom).toBeEnabled();
  expect(await top.textContent()).toBe(idle);
});
