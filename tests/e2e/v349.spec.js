// v3.49 — 시트에는 적혔는데 태블릿이 답을 못 받아도 리포트가 두 줄이 되지 않는다
const { test, expect, openApp, pick, SHEET } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

const rowsWith = async (sheet, text) => Object.values(await sheet.dump())
  .reduce((n, rows) => n + (rows || []).filter((r) => r.join(' ').includes(text)).length, 0);

test('답을 못 받고 다시 보내도 한 줄 (같은 리포트를 두 번 쓰지 않는다)', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/');
  // 리포트 줄 요청은 시트까지 가서 적힌다. 그런데 답이 오는 길에 끊긴다 (처음 한 번만).
  let cut = 0;
  await page.route(`${SHEET}/exec`, async (route) => {
    const text = route.request().postData() || '';
    if (text.includes('끊김점 조치') && !/"media":"(chunk|finish)"/.test(text) && cut === 0) {
      cut += 1;
      await route.fetch();                       // 시트에는 도착한다
      return route.abort('connectionreset');     // 태블릿은 답을 못 받는다
    }
    return route.continue();
  });

  // 칸은 온라인에서 채우고 올리기 직전에만 끊는다 — 켜자마자 끊으면 리포트 항목을 받기 전이라
  // 빠른 CI 에서는 입력칸이 안 생겼다 (기기에 저장 → 대기열 → 다시 연결해 올리기는 그대로)
  await openApp(page, '#/report/new?fresh=1');
  await expect(field(page, '매장명')).toBeVisible({ timeout: 15000 });
  await field(page, '매장명').fill('끊김점');
  await field(page, '로봇 시리얼').fill('SN-CUT-1');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await field(page, '증상 요약').fill('끊김점 증상');
  await field(page, '조치 내용').fill('끊김점 조치');
  await pick(page, '처리 결과', '완료');
  await page.context().setOffline(true);
  await page.locator('#reportForm button[type=submit]').click();
  await expect(page).toHaveURL(/#\/reports\/[0-9a-z]+$/);
  await page.context().setOffline(false);

  const flush = () => page.evaluate(async () => (await import('/js/sync.js')).flushOutbox({ force: true }));
  await flush();
  expect(cut).toBe(1);
  await expect.poll(() => rowsWith(sheet, '끊김점 조치')).toBe(1);             // 첫 번째 요청은 적혔다
  await flush();                                                               // 태블릿은 실패로 알고 다시 보낸다
  await expect.poll(async () => page.evaluate(async () => {
    const store = await import('/js/local/store.js');
    return (await store.outbox()).filter((op) => op.type === 'sheet').length;
  })).toBe(0);                                                                 // 이번엔 성공으로 받는다
  expect(await rowsWith(sheet, '끊김점 조치')).toBe(1);                         // 그래도 시트에는 한 줄
});

test('재고 — 관리 버튼은 [관리 ⋯] 안 · 차량 탭마다 보충 숫자 (메뉴 합계와 맞다)', async ({ page, sheet }) => {
  await seed(sheet);
  await openApp(page, '#/inventory');
  await expect(page.locator('.inv-card, .inv-item').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-act="sheet-refresh"]')).toHaveCount(0);            // 위 [새로고침] 하나로
  await expect(page.locator('[data-act="add-item"]')).toBeHidden();
  await page.locator('.more-menu > summary').click();
  await expect(page.locator('[data-act="add-item"]')).toBeVisible();
  await page.mouse.click(5, 400);                                                      // 바깥을 누르면 닫힌다
  await expect(page.locator('[data-act="add-item"]')).toBeHidden();
  const lows = await page.locator('.inv-vehicles .veh-tab__low:visible').allTextContents();
  const sum = lows.reduce((n, t) => n + Number(t), 0);
  await expect(page.locator('#invBadge')).toHaveText(String(sum));                    // 왼쪽 메뉴 숫자 = 차량 탭 합
  await expect(page.locator('.inv-alert')).toContainText('이 차량 보충 필요');
});

test('빈 화면에 다음 할 일 · 가이드 0건 항목은 [＋ 작성]', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);                                                  // 예시 리포트는 2026-10
  await seed(sheet);
  await openApp(page, '#/reports');
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#histQ').fill('없는매장이름zz');
  await expect(page.locator('[data-act="filter-clear"]')).toBeVisible();
  await page.locator('[data-act="filter-clear"]').click();
  await expect(page.locator('.hist-row').first()).toBeVisible();
  await expect(page.locator('#histQ')).toHaveValue('');
  await openApp(page, '#/guides');
  const empty = page.locator('.rcat--empty').first();
  await expect(empty).toContainText('＋ 작성');
  await expect(empty).toHaveAttribute('href', /#\/guides\/new\//);
});

test('폰 — 차량 이름 · 상태 거르기가 꺾이지 않는다', async ({ page, sheet }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.setFixedTime(NOW);
  await seed(sheet);
  await openApp(page, '#/driving');
  const tab = page.locator('.veh-tab').first();
  await expect(tab).toBeVisible({ timeout: 15000 });
  const lineH = await tab.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 24);
  expect((await tab.evaluate((el) => el.querySelector('*') ? 0 : el.scrollHeight))).toBeLessThan(lineH * 2 + 40);
  expect(await tab.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap');
  await openApp(page, '#/reports');
  await expect(page.locator('.hist-tile').first()).toBeVisible({ timeout: 15000 });
  const tops = await page.locator('.hist-tile').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
  expect(tops.length).toBe(1);                                                         // 한 줄 (옆으로 민다)
});

test('올리기 실패 알림 — 버튼 이름이 깨지지 않는다 · [닫기] 전까지 남는다', async ({ page }) => {
  await openApp(page, '#/report/new?fresh=1');
  await page.route(`${SHEET}/exec`, (route) => {
    const text = route.request().postData() || '';
    if (/"sheetName"/.test(text) && !/"media":"(chunk|finish)"/.test(text)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '시험용 거절' }) });
    }
    return route.continue();
  });
  await field(page, '매장명').fill('실패점');
  await field(page, '로봇 시리얼').fill('SN-F-1');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await field(page, '증상 요약').fill('실패 증상');
  await field(page, '조치 내용').fill('실패 조치');
  await pick(page, '처리 결과', '완료');
  await page.locator('#reportForm button[type=submit]').click();
  const err = page.locator('#toasts .toast--err');
  await expect(err).toContainText('[시트에 올리기]');
  await expect(err).not.toContainText('[ 리포트]');
});

test('브라우저 — PC 폴더에 새 화면이 있으면 띠 · [다시 열기] 로 새 화면이 열린다 (APK 를 받지 않는다)', async ({ page }) => {
  // 폴더가 새 버전으로 바뀐 상황: version.js 가 99.0.0 이라고 답한다 (화면이 이미 불러온 것은 옛 버전)
  let newer = false;
  await page.route(/\/js\/version\.js\?v=\d+/, (route) => (newer
    ? route.fulfill({ status: 200, contentType: 'application/javascript', body: "export const APP_VERSION = '99.0.0';\n" })
    : route.continue()));
  await openApp(page, '#/');
  await expect(page.locator('#update-banner')).toBeHidden();
  newer = true;
  const popups = [];
  page.on('popup', (p) => popups.push(p));
  await page.locator('#btn-update').click();                                       // [새로고침] 이 폴더도 묻는다
  const banner = page.locator('#update-banner');
  await expect(banner).toBeVisible({ timeout: 15000 });
  await expect(banner).toContainText('v99.0.0');
  newer = false;                                                                   // 다시 열면 새 화면 (흉내)
  await Promise.all([page.waitForEvent('load'), banner.locator('[data-act="reload"]').click()]);
  expect(popups).toHaveLength(0);                                                  // 예전처럼 APK 를 새 탭으로 열지 않는다
  await expect(page.locator('#view')).not.toBeEmpty();
  await page.waitForTimeout(800);
  await expect(page.locator('#update-banner')).toBeHidden();
});

test('화면을 빠르게 연달아 옮겨도 마지막 주소의 화면이 남는다 (늦게 끝난 앞 화면이 덮지 않는다)', async ({ page, sheet }) => {
  const { seed: seedAll } = require('./seed.js');
  await seedAll(sheet);
  await openApp(page, '#/');
  // 이력 화면은 일부러 느리게 (시트 받기를 1.5초 늦춘다) — 그 사이 설정으로 옮긴다
  await page.route(`${SHEET}/exec`, async (route) => {
    if (/"reports":"(pull|months)"/.test(route.request().postData() || '')) await new Promise((r) => setTimeout(r, 1500));
    try { await route.continue(); } catch { /* 닫힘 */ }
  });
  await page.evaluate(async () => (await import('/js/local/idb.js')).clear('meta'));
  await page.evaluate(() => { location.hash = '#/reports'; });
  await page.waitForTimeout(100);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.locator('#sDevice')).toBeVisible();
  await page.waitForTimeout(2500);                                               // 느린 이력이 끝난 뒤에도
  await expect(page.locator('#sDevice')).toBeVisible();                          // 설정이 그대로 보인다
  await expect(page).toHaveURL(/#\/settings$/);
});
