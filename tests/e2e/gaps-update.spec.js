// 동작 시험 보강 ⑩ 업데이트 띠 (APK) — 더 높을 때만 · [나중에] 는 그 버전만 · 4분 간격 · 설치 주소 유지 · bhupdate: 넘기기
const { test, expect, openApp, SHEET } = require('./fixtures.js');

// MainActivity 가 붙이는 표식 — 이것이 있으면 앱은 APK 안이라고 본다
test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Safari/537.36 FieldPortalAPK/77' });

async function fakeRelease(page) {
  const state = { version: '0.0.1', installUrl: 'https://drive.example/install', asked: 0 };
  await page.route(`${SHEET}/exec`, (route) => {
    const body = route.request().postData() || '';
    if (/"release":"latest"/.test(body)) {
      state.asked += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, version: state.version, build: '99', url: 'https://dl.example/app.apk', sizeMb: 7,
        notes: '시험', minVersion: '', ...(state.installUrl ? { installUrl: state.installUrl, downloadUrl: state.installUrl + '?dl' } : {}),
      }) });
    }
    return route.continue();
  });
  return state;
}
const check = (page, force) => page.evaluate(async (f) => (await import('/js/update.js')).checkForUpdate({ force: f }), force);

test('띠는 지금보다 높은 버전일 때만 · [나중에] 는 그 버전만 접는다', async ({ page }) => {
  const rel = await fakeRelease(page);
  await openApp(page, '#/');
  const banner = page.locator('#update-banner');
  await check(page, true);
  await expect(banner).toBeHidden();                               // 0.0.1 — 더 낮다
  rel.version = '99.0.0';
  await check(page, true);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('v99.0.0');
  await banner.locator('[data-act="later"]').click();
  await expect(banner).toBeHidden();
  await check(page, true);
  await expect(banner).toBeHidden();                               // 같은 버전은 계속 접혀 있다
  rel.version = '99.0.1';
  await check(page, true);
  await expect(banner).toBeVisible();                              // 다음 버전은 다시 보인다
});

test('4분 안에는 다시 묻지 않는다 (사람이 누른 새로고침은 예외) · 설치 주소가 안 와도 알던 주소를 지킨다', async ({ page }) => {
  const rel = await fakeRelease(page);
  await openApp(page, '#/');
  await check(page, true);
  const n = rel.asked;
  await check(page, false);
  await check(page, false);
  expect(rel.asked).toBe(n);                                       // 4분 규칙
  await check(page, true);
  expect(rel.asked).toBe(n + 1);
  rel.installUrl = '';                                             // 옛 서버 — 주소를 안 준다
  await check(page, true);
  const link = await page.evaluate(async () => (await import('/js/update.js')).getInstallLink());
  expect(link && link.installUrl).toBe('https://drive.example/install');
});

test('[업데이트] 는 APK 주소를 bhupdate: 로 안드로이드에 넘긴다', async ({ page }) => {
  const rel = await fakeRelease(page);
  rel.version = '99.0.0';
  await openApp(page, '#/');
  await check(page, true);
  const handed = page.waitForEvent('request', (r) => r.url().startsWith('bhupdate:'));
  await page.locator('#update-banner [data-act="update"]').click();
  const req = await handed;
  expect(decodeURIComponent(req.url().slice('bhupdate:'.length))).toBe('https://dl.example/app.apk');
});
