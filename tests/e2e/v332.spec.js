// v3.32 — 고르기 창 편집 · 재고 분류 순서(v3.37 부터 [순서 바꾸기]) · 가이드 요약 줄 없음 · [패치 내용]
const { test, expect, openApp } = require('./fixtures.js');
const { seed, GUIDES } = require('./seed.js');

const rowsOf = async (sheet, name) => ((await sheet.dump())[name] || []).slice(2);

test('[이슈 유형 고르기] 창의 [편집] — 대분류 만들기 · 항목 넣기 · 이름 바꾸기 · 삭제', async ({ page, sheet }) => {
  await openApp(page, '#/report/new');
  await page.locator('#workHelper [data-act="open-work"]').click();
  const box = page.locator('#modalRoot .wk');
  await box.locator('[data-act="wk-edit"]').click();
  await box.locator('[data-act="wk-newcat"][data-kind="로봇 이슈"]').click();
  await box.locator('[data-edit-input="newcat:로봇 이슈"]').fill('청소');
  await box.locator('[data-act="wk-save"]').click();
  await expect(box.locator('[data-act="wk-cat"][data-cat="청소"]')).toHaveClass(/is-on/);       // 만든 대분류가 골라진다
  await box.locator('#wkNew').fill('패널 청소');
  await box.locator('[data-act="wk-add"]').click();
  await expect(box.locator('.wk-item', { hasText: '패널 청소' })).toBeVisible();              // 편집 중엔 창이 그대로
  await box.locator('.wk-itemwrap', { hasText: '패널 청소' }).locator('[data-act="wk-ren"]').click();
  await box.locator('[data-edit-input^="item:"]').fill('패널 세척');
  await box.locator('[data-act="wk-save"]').click();
  await expect(box.locator('.wk-item', { hasText: '패널 세척' })).toBeVisible();
  await expect(box.locator('.wk-item', { hasText: '별칭 패널 청소' })).toBeVisible();          // 옛 이름은 별칭으로
  // 항목이 있는 대분류는 못 지운다
  await box.locator('.wk-catwrap', { hasText: '청소' }).locator('[data-act="wk-del"]').click();
  await box.locator('[data-act="wk-del-yes"]').click();
  await expect(box.locator('[data-act="wk-cat"][data-cat="청소"]')).toBeVisible();
  // 항목을 지우고 나면 대분류도 지울 수 있다
  await box.locator('.wk-itemwrap', { hasText: '패널 세척' }).locator('[data-act="wk-del"]').click();
  await box.locator('[data-act="wk-del-yes"]').click();
  await expect(box.locator('.wk-item', { hasText: '패널 세척' })).toHaveCount(0);
  await box.locator('.wk-catwrap', { hasText: '청소' }).locator('[data-act="wk-del"]').click();
  await box.locator('[data-act="wk-del-yes"]').click();
  await expect(box.locator('[data-act="wk-cat"][data-cat="청소"]')).toHaveCount(0);
  // 팀 목록(시트)에도 반영 — 청소 대분류 · 패널 항목 없음
  await expect.poll(async () => (await rowsOf(sheet, '이슈 유형 목록')).map((r) => r[1]).join(','), { timeout: 15000 })
    .toContain('유지 보수');
  expect((await rowsOf(sheet, '이슈 유형 목록')).some((r) => r[1] === '청소' || /패널/.test(r[2]))).toBe(false);
});

test('차량 재고 [순서 바꾸기] — 분류를 ▼ 로 내리고 [완료] 하면 시트 줄 순서도 바뀐다', async ({ page, sheet }) => {
  // v3.37 — [분류 순서] 창은 [순서 바꾸기] 모드로 합쳤다
  await seed(sheet);                                       // 소모품(2) · 케이블(1)
  await openApp(page, '#/inventory');
  await expect(page.locator('.inv-pick').first()).toBeVisible({ timeout: 15000 });
  await page.locator('[data-act="order-start"]').click();
  const cats = page.locator('.ord-row--cat .ord-name');
  await expect(cats.first()).toContainText('소모품');
  await page.locator('.ord-row--cat', { hasText: '소모품' }).locator('[data-dir="1"]').click();
  await expect(cats.first()).toContainText('케이블');
  await page.locator('[data-act="order-done"]').click();
  await expect(page.locator('.grp-row .grp-name').first()).toHaveText('케이블');
  await expect.poll(async () => (await rowsOf(sheet, '차량재고'))[0][0], { timeout: 15000 }).toBe('C to C 2m');
});

test('가이드 제목 아래 요약 줄이 없다 (상세 · 목록)', async ({ page, sheet }) => {
  await seed(sheet);
  await openApp(page, '#/guides');
  await page.waitForTimeout(1500);
  const g = GUIDES[2];                                     // 'OTA 설정 방법' · 요약 '펌웨어 수동 갱신'
  await openApp(page, `#/guides/${g.id}`);
  await expect(page.locator('#view')).toContainText('OTA 설정 방법');
  await expect(page.locator('#view')).not.toContainText(g.summary);
  await openApp(page, '#/guides/m/_none/SOFTWARE_CMD');
  await expect(page.locator('#view')).toContainText('OTA 설정 방법');
  await expect(page.locator('#view')).not.toContainText(g.summary);
});

test('[패치 내용] — 새로고침 옆, 안 본 새 버전이면 점 · 열면 날짜별 바뀐 점', async ({ page }) => {
  await openApp(page, '#/');
  const btn = page.locator('#btn-patch');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveClass(/has-new/);
  await btn.click();
  const notes = page.locator('#modalRoot .patch-notes');
  await expect(notes.locator('.patch-note').first()).toHaveClass(/is-current/);
  const version = await page.evaluate(async () => (await import('/js/version.js')).APP_VERSION);
  await expect(notes.locator('.patch-note').first()).toContainText(`v${version}`);         // 맨 위가 지금 버전
  await expect(notes).toContainText('이슈 유형');                                           // 지난 버전도 아래에 남는다
  await expect(notes).toContainText('10월 23일');
  await page.locator('#modalRoot [data-act="close"]').click();
  await expect(btn).not.toHaveClass(/has-new/);
  await page.reload();
  await expect(page.locator('#btn-patch')).not.toHaveClass(/has-new/);
});
