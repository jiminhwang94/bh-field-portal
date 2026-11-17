// v3.48 — 화면: 알림 · 단계 머리 · 빈 칸 · 사진 되돌리기 · 홈 숫자 · 햇빛 글자
const { test, expect, openApp, pick } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

const stepMode = (page) => page.addInitScript(() => localStorage.setItem('bh_report_mode', 'step'));

test('알림 — 아래 주 동작 바 위에 · 둘까지 · 오류는 [닫기] 전까지 · 켤 때 저절로 뜨는 알림 없음', async ({ page }) => {
  await openApp(page, '#/');
  await page.waitForTimeout(1500);
  await expect(page.locator('#toasts .toast')).toHaveCount(0);                // "항목 준비" · "시트 연결" 이 뜨지 않는다
  await page.evaluate(async () => {
    const { toast } = await import('/js/ui.js');
    toast('하나', 'ok'); toast('둘', 'ok'); toast('오류입니다', 'err');
  });
  await expect(page.locator('#toasts .toast')).toHaveCount(2);                // 셋 중 오래된 것은 빠진다
  const err = page.locator('#toasts .toast--err');
  await page.waitForTimeout(5000);
  await expect(err).toBeVisible();                                            // 예전에는 4.6초면 사라졌다
  const box = await err.boundingBox();
  const vh = page.viewportSize().height;
  expect(box.y).toBeGreaterThan(vh / 2);                                      // 화면 아래쪽 (제목을 가리지 않는다)
  await err.locator('.toast__close').click();
  await expect(err).toHaveCount(0);
});

test('단계로 쓸 때 — 위 [업로드] 없음 · [⋯] 안의 보기 바꾸기 · 작성일시는 [확인] 단계 · 자동 번호에 * 없음', async ({ page }) => {
  await stepMode(page);
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/report/new');
  await expect(page.locator('#btn-topaction')).toBeHidden();
  await expect(page.locator('[data-act="toggle-mode"]')).toBeHidden();         // [⋯] 안에 접혀 있다
  await page.locator('.rf-more > summary').click();
  await expect(page.locator('[data-act="toggle-mode"]')).toBeVisible();
  await page.locator('.rf-more > summary').click();
  await expect(page.locator('#rfWhen')).toBeHidden();                          // 1단계에서는 머리가 짧다
  await expect(page.locator('#reportForm .field--auto-no label .req')).toHaveCount(0);
  await page.locator('[data-act="step-go"][data-go="check"]').first().click();
  await expect(page.locator('#rfWhen')).toBeVisible();                         // [확인] 단계에서 날짜를 본다
});

test('폰 — 단계마다 질문 · 입력칸 · [다음] 이 첫 화면에 다 보인다 (아래 탭은 숨긴다)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stepMode(page);
  await openApp(page, '#/report/new');
  await expect(page.locator('.tabbar')).toBeHidden();
  for (let i = 0; i < 4; i += 1) {
    const next = page.locator('.wz-bar__next');
    await expect(next).toBeInViewport();
    const ask = page.locator('.wz-ask h2');
    await expect(ask).toBeInViewport();
    const firstInput = page.locator('#reportForm .field:visible').first();
    await expect(firstInput).toBeInViewport({ ratio: 0.3 });
    if (await next.getAttribute('type') === 'submit') break;
    await next.click();
  }
});

test('사진을 빼면 6초 동안 [되돌리기]', async ({ page }) => {
  await openApp(page, '#/report/new');
  const photo = page.locator('#reportForm .field', { has: page.locator('label', { hasText: '현장 사진' }) });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    photo.locator('[data-act="pick"]').click(),
  ]);
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  await expect(page.locator('.media-tile')).toHaveCount(1, { timeout: 10000 });
  await page.locator('.media-tile__del').click();
  await expect(page.locator('.media-tile')).toHaveCount(0);
  await page.locator('#toasts .toast--undo .toast__close').click();
  await expect(page.locator('.media-tile')).toHaveCount(1);
});

test('홈 — 이력을 받기 전엔 0 이 아니라 — · 받은 뒤엔 숫자와 기준 시각 · 접수 줄은 자리를 지킨다', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);
  await page.route('**/127.0.0.1:8791/exec', (route) => {
    const body = route.request().postData() || '';
    return /"reports":"(pull|months|numbers)"/.test(body) ? route.abort() : route.continue();
  });
  await openApp(page, '#/');
  await expect(page.locator('.door__counts [data-track="doing"] b')).toHaveText('—');
  await expect(page.locator('.door__asof')).toContainText('아직 받지 못했어요');
  await expect(page.locator('.door__row--quiet')).toContainText('접수 목록을 아직 받지 못했어요');
  await page.unroute('**/127.0.0.1:8791/exec');
  await seed(sheet);
  await openApp(page, '#/reports');
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
  await openApp(page, '#/');
  await expect(page.locator('.door__counts [data-track="doing"] b')).toHaveText(/^\d+$/);
  await expect(page.locator('.door__asof')).toContainText('기준');
});

test('햇빛 — 안내 글자 · 입력칸 테두리 · 작은 글자', async ({ page }) => {
  await openApp(page, '#/report/new');
  const got = await page.evaluate(() => {
    const input = document.querySelector('#reportForm input.input, #reportForm textarea');
    const ph = getComputedStyle(input, '::placeholder').color;
    const border = getComputedStyle(input).borderTopColor;
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
        const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (c) => (1.05) / (lum(c) + 0.05);                          // 흰 바탕과의 대비
    const small = [...document.querySelectorAll('body *')].filter((el) => el.offsetParent
      && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      && parseFloat(getComputedStyle(el).fontSize) < 14 && !el.closest('.tab__badge, .rail-badge, [class*="badge"]'));
    return { ph: ratio(ph), border: ratio(border), small: small.map((el) => el.className || el.tagName).slice(0, 5) };
  });
  expect(got.ph).toBeGreaterThan(4.5);
  expect(got.border).toBeGreaterThan(3);
  expect(got.small).toEqual([]);
});
