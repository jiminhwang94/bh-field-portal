// 운영 — 변경기록 · 휴지통 되살리기 · 홈 알림 · 최소 버전. 가짜 시트에서 실제로 눌러 본다.
const { test, expect, openApp } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

const rowsOf = async (sheet, name) => ((await sheet.dump())[name] || []).slice(2);

test('쓰기마다 변경기록에 기기 이름이 남고, 기기 탭에 버전이 적힌다', async ({ page, sheet }) => {
  await openApp(page, '#/guides/new/ERROR_CODE?model=Gen.1');
  await page.locator('#gTitle').fill('E-321 기록 검사');
  if (!(await page.locator('textarea[name=stepText]').count())) await page.locator('[data-act="add-step"]').click();
  await page.locator('textarea[name=stepText]').first().fill('확인');
  await page.locator('#guideForm button[type=submit]').click();
  await expect.poll(async () => (await rowsOf(sheet, '변경기록')).map((r) => r.join(' ')).join('\n'), { timeout: 15000 })
    .toContain('E-321 기록 검사');
  const log = (await rowsOf(sheet, '변경기록')).find((r) => r.join(' ').includes('E-321'));
  expect(log[1]).toBe('검사봇');                       // 기기 · 사람
  const dev = (await rowsOf(sheet, '기기')).find((r) => r[0] === '검사봇');
  expect(dev && dev[1]).toMatch(/^\d+\.\d+\.\d+$/);    // 앱 버전
});

test('지운 가이드를 설정 → 휴지통에서 되살린다', async ({ page, sheet }) => {
  await openApp(page, '#/guides/new/HARDWARE_SOP?model=Gen.2');
  await page.locator('#gTitle').fill('되살릴 가이드');
  if (!(await page.locator('textarea[name=stepText]').count())) await page.locator('[data-act="add-step"]').click();
  await page.locator('textarea[name=stepText]').first().fill('하나');
  await page.locator('#guideForm button[type=submit]').click();
  await expect(page).toHaveURL(/#\/guides\/[0-9a-f]{6,}$/);
  // 시트에 올라간 뒤에 지운다 (올라가기 전에 지우면 시트에는 남을 것이 없다 — 그게 맞다)
  await expect.poll(async () => (await rowsOf(sheet, '하드웨어 교체 SOP')).map((r) => r.join(' ')).join('\n'), { timeout: 15000 })
    .toContain('되살릴 가이드');
  await page.locator('[data-act="more"]').click();                      // 수정 · 삭제는 [⋯] 안 (v3.35)
  await page.locator('#modalRoot [data-act="delete"]').click();
  await page.locator('#modalRoot [data-act="ok"]').click();
  await expect.poll(async () => (await rowsOf(sheet, '휴지통')).length, { timeout: 15000 }).toBe(1);

  await openApp(page, '#/settings');
  await page.locator('#trashPanel summary').click();
  const row = page.locator('.trash-row', { hasText: '되살릴 가이드' });
  await expect(row).toBeVisible();
  await row.locator('[data-act="trash-restore"]').click();
  await page.locator('#modalRoot [data-act="ok"]').click();
  await expect.poll(async () => (await rowsOf(sheet, '하드웨어 교체 SOP')).map((r) => r.join(' ')).join('\n'), { timeout: 15000 })
    .toContain('되살릴 가이드');
  await expect(page.locator('.trash-row', { hasText: '되살릴 가이드' })).toHaveClass(/is-done/);
});

test('7일 넘게 끝나지 않은 리포트가 홈에 뜨고, 누르면 그것만 본다', async ({ page, sheet }) => {
  await seed(sheet);
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');                       // 이력을 한 번 받아 둔다
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
  await openApp(page, '#/');
  const alert = page.locator('.h2-alert', { hasText: '7일 넘게' });
  await expect(alert).toContainText('1건');               // 10-15 교체 예정 (8일째)
  await alert.click();
  await expect(page.locator('.hist-row')).toHaveCount(1);
  await expect(page.locator('.hist-row')).toContainText('홍기와 본점');
  await page.locator('[data-act="overdue-off"]').click();
  await expect(page.locator('.hist-row')).toHaveCount(3);
});

test('시트가 더 높은 최소 버전을 요구하면 화면을 덮고 업데이트를 요구한다', async ({ page, sheet }) => {
  await sheet.call({ changed: true, device: '관리자' });   // 기기 탭을 만든다
  expect((await sheet.dump())['기기']).toBeTruthy();
  // 관리자가 기기 탭 B1 에 아주 높은 최소 버전을 적은 것처럼 — 시트 응답에 끼워 넣는다
  await page.route('**/127.0.0.1:8791/exec', async (route) => {
    const body = route.request().postDataJSON() || {};
    const res = await route.fetch();
    const json = await res.json();
    if (body.changed || body.release === 'latest') json.minVersion = '99.0.0';
    await route.fulfill({ response: res, json });
  });
  await openApp(page, '#/');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.goto('/#/settings');                         // 설정을 열면 새 버전을 바로 묻는다
  await expect(page.locator('#version-gate')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#version-gate')).toContainText('99.0.0');
});
