// v3.36.2 — 이력 [새로고침] · 재고 분류 머리줄
const { test, expect, openApp } = require('./fixtures.js');

const H = ['작성일시', '작성자', '리포트 번호', '매장명', '로봇 시리얼', '로봇 모델', '증상 요약', '조치 내용', '처리 결과', '현장 사진', '상태'];
const report = (when, store) => [when, '검사봇', 'P1', store, 'SN-1', 'Gen.1(D1)', '증상', '조치', '완료', '', '조치 완료'];
const tag = (body) => (body.reports ? `reports:${body.reports}` : Object.keys(body).filter((k) => !['device', 'app'].includes(k))[0]);

test('막 설치한 태블릿 — 시트 답을 기다리는 동안 이력이 "없습니다" 가 아니라 "받는 중"', async ({ page, sheet }) => {
  await sheet.call({ sheetName: '2026-10', headers: H, row: report('2026-10-21 09:10', '느린점') });
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/127.0.0.1:8791/exec', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.reports === 'pull') await gate;                       // 실제 시트처럼 한참 걸린다
    return route.continue();
  });
  await openApp(page, '#/reports');
  await expect(page.locator('#view')).toContainText('시트에서 이력을 받는 중');
  await expect(page.locator('#view')).not.toContainText('이 달에 기록된 리포트가 없습니다');
  release();
  await expect(page.locator('#view')).toContainText('느린점');
});

test('위 [새로고침] — 재고 받기가 실패해도 이력을 새로 받고, 달 목록도 다시 받는다', async ({ page, sheet }) => {
  await sheet.call({ sheetName: '2026-10', headers: H, row: report('2026-10-21 09:10', '먼저점') });
  const calls = [];
  let inventoryDown = false;
  await page.route('**/127.0.0.1:8791/exec', async (route) => {
    const body = route.request().postDataJSON() || {};
    calls.push(tag(body));
    if (inventoryDown && body.inventory) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '재고 탭 오류' }) });
    }
    return route.continue();
  });
  await openApp(page, '#/reports');
  await expect(page.locator('#view')).toContainText('먼저점');
  await sheet.call({ sheetName: '2026-10', headers: H, row: report('2026-10-22 09:10', '다른기기점') });   // 다른 태블릿이 올렸다
  inventoryDown = true;
  calls.length = 0;
  await page.locator('#btn-update').click();
  await expect(page.locator('#view')).toContainText('다른기기점', { timeout: 15000 });
  expect(calls).toContain('reports:months');
});

const INV = (() => {
  const cats = { '소모품': ['그리퍼 실리콘 패드', '가스게이지', '케이블 타이'], '페리페럴': ['LiDAR 센서', '카메라 모듈', '스피커', '터치 패널'], '케이블': ['C to C 2m', 'LAN 5m'] };
  const items = [];
  for (const [category, names] of Object.entries(cats)) {
    for (const partName of names) items.push({ vehicleName: '스타리아 5868', partName, category, quantity: 2, minQuantity: 1 });
  }
  return { vehicles: ['스타리아 5868'], items };
})();

test('재고 — 분류 머리줄을 누르면 접히지 않고 그 분류 부품만 보인다 · 다시 누르면 전체', async ({ page, sheet }) => {
  await sheet.call({ inventory: 'push', ...INV });
  await openApp(page, '#/inventory');
  await page.locator('#btn-update').click();
  await expect(page.locator('tr.inv-item')).toHaveCount(9);
  await page.locator('.grp-toggle', { hasText: '페리페럴' }).click();
  await expect(page.locator('tr.inv-item')).toHaveCount(4);
  await expect(page.locator('tr.inv-item', { hasText: 'LiDAR 센서' })).toBeVisible();
  await expect(page.locator('#invChips .inv-chip.is-on')).toContainText('페리페럴');
  await expect(page.locator('.grp-toggle', { hasText: '페리페럴' })).toContainText('전체 보기');
  await page.locator('.grp-toggle', { hasText: '페리페럴' }).click();
  await expect(page.locator('tr.inv-item')).toHaveCount(9);
});

test('재고 — 예전 버전이 접어 둔 분류가 있어도 부품이 다 보인다', async ({ page, sheet }) => {
  await sheet.call({ inventory: 'push', ...INV });
  await page.addInitScript(() => localStorage.setItem('bh_inv_collapsed', JSON.stringify(['페리페럴', '소모품'])));
  await openApp(page, '#/inventory');
  await page.locator('#btn-update').click();
  await expect(page.locator('tr.inv-item')).toHaveCount(9);
});
