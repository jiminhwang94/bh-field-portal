// 이어 보기 — 리포트↔가이드 · 매장별 이력 · 통계 · 사용 부품 → 재고 · 고대비
const { test, expect, openApp, pick } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

const H = ['작성일시', '작성자', '리포트 번호', '매장명', '로봇 시리얼', '로봇 모델', '사용 부품', '오류 코드',
  '증상 요약', '조치 내용', '처리 결과', '현장 사진', '상태'];

async function seedMore(sheet) {
  await seed(sheet);
  await sheet.call({ sheetName: '2026-10', headers: H, row: ['2026-10-20 15:00', '검사봇', 'P261020-05', '옥동식 서초점',
    'SN-0001', 'Gen.1(D1)', '그리퍼 실리콘 패드 ×2', 'E-101', '로더 과전류 재발', '벨트 재조정', '모니터링', '', '모니터링'] });
}

async function warm(page) {
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
}

test('이력의 오류 코드에서 그 가이드로 · 가이드에서는 그 오류로 쓴 리포트로', async ({ page, sheet }) => {
  await seedMore(sheet);
  await warm(page);
  await page.locator('.hist-row', { hasText: '로더 과전류 재발' }).click();
  const link = page.locator('#modalRoot .hd-guide', { hasText: 'E-101 로더 모터 과전류' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/#\/guides\/a1b2c3d4e5f60001(\?|$)/);   // 이력의 매장 · 로봇이 붙어 온다 (v3.35)
  await expect(page.locator('#gdReports')).toContainText('이 오류로 쓴 리포트');
  await expect(page.locator('#gdReports .gd-report')).toContainText('옥동식 서초점');
});

test('매장 이름을 누르면 그 매장의 방문 기록 · 로봇 · 끝나지 않은 건', async ({ page, sheet }) => {
  await seedMore(sheet);
  await warm(page);
  await page.locator('.hist-row', { hasText: '로더 과전류 재발' }).click();
  await page.locator('#modalRoot .hd-title--link').click();
  await expect(page).toHaveURL(/#\/store\?name=/);
  await expect(page.locator('.store-visit')).toHaveCount(2);
  await expect(page.locator('.store-sum')).toContainText('SN-0001');
  await expect(page.locator('.store-sum')).toContainText('E-101');
});

test('통계 — 상태별 · 로봇 모델별 · 많이 쓴 부품 · 기간 바꾸기', async ({ page, sheet }) => {
  await seedMore(sheet);
  await warm(page);
  await openApp(page, '#/stats');
  await expect(page.locator('.sx-big__n')).toContainText('4');
  await expect(page.locator('.sx-grid')).toContainText('Gen.1(D1)');
  await expect(page.locator('.sx-grid')).toContainText('그리퍼 실리콘 패드');
  await page.locator('.seg__btn', { hasText: '이번 달' }).click();
  await expect(page).toHaveURL(/#\/stats\?m=1$/);
});

test('작성 화면: 오류 코드를 적으면 가이드가 · 고른 부품은 올릴 때 내 차량 재고에서 빠진다', async ({ page, sheet }) => {
  await seedMore(sheet);
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/inventory');                     // 차량 재고를 받아 둔다
  await expect(page.locator('.inv-pick').first()).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => localStorage.setItem('bh_my_vehicle', '스타리아 4373'));
  await openApp(page, '#/report/new');
  const field = (label) => page.locator('#reportForm .field', { has: page.locator('label', { hasText: label }) })
    .locator('input, select, textarea').first();
  await field('오류 코드').fill('e101');
  await expect(page.locator('#codeHelper .guide-hint')).toContainText('E-101 로더 모터 과전류');
  await page.locator('#codeHelper .guide-hint').click();
  await expect(page.locator('#modalRoot')).toContainText('전원을 내리고 커넥터 CN3 를 확인한다');
  await page.locator('#modalRoot [data-act="close"]').click();

  // B안 — [부품 추가] 창에서 분류 탭 · −/+
  await page.locator('#partsHelper [data-act="open-parts"]').click();
  const sheetBox = page.locator('#partsSheet');
  await sheetBox.locator('[data-act="part-cat"]', { hasText: '소모품' }).click();
  const plus = sheetBox.locator('[data-act="part-inc"][data-part="그리퍼 실리콘 패드"]');
  await plus.click(); await plus.click(); await plus.click();          // 실수로 한 번 더
  await sheetBox.locator('[data-act="part-dec"][data-part="그리퍼 실리콘 패드"]').click();   // − 로 고친다
  await sheetBox.locator('[data-act="part-inc"][data-part="가스게이지"]').click();
  await page.locator('#modalRoot [data-act="close"]').last().click();
  await expect(page.locator('#partsHelper .part-pill')).toHaveCount(2);
  await expect(page.locator('#partsHelper')).toContainText('그리퍼 실리콘 패드 ×2');
  // 칸의 ✕ 로 뺀다
  await page.locator('#partsHelper [data-act="part-remove"][data-part="가스게이지"]').click();
  await expect(page.locator('#partsHelper .part-pill')).toHaveCount(1);
  await expect(field('사용 부품')).toHaveValue('그리퍼 실리콘 패드 ×2');
  await pick(page, '고객사 리포트', 'P260912-01');
  await field('로봇 시리얼').fill('SN-PART');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await field('증상 요약').fill('패드 마모');
  await field('조치 내용').fill('패드 교체');
  await pick(page, '처리 결과', '완료');
  await page.locator('#reportForm button[type=submit]').click();
  // 스타리아 4373 의 패드 5 → 3 (시트 '차량재고' 탭)
  await expect.poll(async () => {
    const rows = (await sheet.dump())['차량재고'] || [];
    const head = rows[1] || [];
    const col = head.indexOf('스타리아 4373');
    const line = rows.find((r) => r[0] === '그리퍼 실리콘 패드') || [];
    return line[col];
  }, { timeout: 20000 }).toBe(3);
});

test('[부품 추가] 창 — 고른 분류만 탭으로 보인다 (다시 열어도 유지)', async ({ page, sheet }) => {
  await seedMore(sheet);
  await openApp(page, '#/inventory');
  await expect(page.locator('.inv-pick').first()).toBeVisible({ timeout: 15000 });
  await openApp(page, '#/report/new');
  await page.locator('#partsHelper [data-act="open-parts"]').click();
  const sheetBox = page.locator('#partsSheet');
  await expect(sheetBox.locator('[data-act="part-cat"]')).toHaveCount(2);      // 고르기 전에는 전부 (소모품 · 케이블)
  await sheetBox.locator('[data-act="cats-pick"]').click();
  await sheetBox.locator('[data-act="toggle-cat"][data-cat="소모품"]').check();
  await sheetBox.locator('[data-act="cats-done"]').click();
  await expect(sheetBox.locator('[data-act="part-cat"]')).toHaveCount(1);
  await expect(sheetBox.locator('[data-act="part-cat"]')).toHaveText(/소모품/);
  await expect(sheetBox).not.toContainText('C to C 2m');                    // 케이블 품목은 안 보인다
  await page.reload();
  await openApp(page, '#/report/new');
  await page.locator('#partsHelper [data-act="open-parts"]').click();
  await expect(page.locator('#partsSheet [data-act="part-cat"]')).toHaveCount(1);
});

test('고대비 보기 — 설정에서 켜면 다시 열어도 유지된다', async ({ page }) => {
  await openApp(page, '#/settings');
  await page.locator('[data-act="toggle-contrast"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  const muted = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-muted').trim());
  expect(muted.toLowerCase()).toBe('#1f242b');
});
