// 동작 시험 보강 ⑨ 첨부 한도 — 고르는 순간 파일당 · 리포트 전체 한도 · 사진은 줄인 뒤 판단 · 비공개 동영상 경고
const { test, expect, openApp, SHEET } = require('./fixtures.js');

const MB = 1024 * 1024;
const photoField = (page) => page.locator('#reportForm .field', { has: page.locator('label', { hasText: '현장 사진' }) });

async function openForm(page) {
  // 미리 올리기(조각)는 이 시험과 상관없다 — 큰 파일을 실제로 보내지 않게 막는다
  await page.route(`${SHEET}/exec`, (route) => (/"media":"(chunk|finish)"/.test(route.request().postData() || '')
    ? route.abort() : route.continue()));
  await openApp(page, '#/report/new?fresh=1');
  await expect(photoField(page)).toBeVisible({ timeout: 15000 });
}

async function pick(page, files) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    photoField(page).locator('[data-act="pick"]').click(),
  ]);
  await chooser.setFiles(files);
}
const video = (name, mb) => ({ name, mimeType: 'video/mp4', buffer: Buffer.alloc(Math.round(mb * MB), 1) });

test('파일 하나가 25MB 를 넘으면 고르는 순간 알려 주고 붙이지 않는다', async ({ page }) => {
  await openForm(page);
  await pick(page, [video('긴영상.mp4', 26)]);
  await expect(page.locator('#toasts .toast--err')).toContainText('25MB');
  await expect(page.locator('.media-tile')).toHaveCount(0);
});

test('리포트 전체가 60MB 를 넘으면 그 파일은 붙이지 않는다 (앞의 것은 남는다)', async ({ page }) => {
  test.setTimeout(90000);
  await openForm(page);
  await pick(page, [video('a.mp4', 24), video('b.mp4', 24)]);
  await expect(page.locator('.media-tile')).toHaveCount(2, { timeout: 30000 });
  await pick(page, [video('c.mp4', 24)]);
  await expect(page.locator('#toasts .toast--err')).toContainText('60MB');
  await expect(page.locator('.media-tile')).toHaveCount(2);
});

test('사진은 줄인 뒤에 크기를 본다 — 원본이 25MB 를 넘어도 줄여서 붙는다', async ({ page }) => {
  test.setTimeout(90000);
  await openForm(page);
  const result = await page.evaluate(async () => {
    // 압축이 안 되는 잡음 PNG — 원본이 25MB 를 넘는다
    const c = document.createElement('canvas');
    c.width = 3400; c.height = 3400;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(3400, 3400);
    for (let i = 0; i < img.data.length; i += 65536) crypto.getRandomValues(img.data.subarray(i, i + 65536));
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;   // 불투명
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], '큰사진.png', { type: 'image/png' });
    const input = /** @type {HTMLInputElement} */ (document.getElementById('mediaPick'));
    const dt = new DataTransfer();
    dt.items.add(file);
    // [앨범 · 파일] 을 누른 것처럼 — 입력칸에 어느 칸 것인지 걸어 두고 고른다
    const btn = /** @type {HTMLElement} */ (document.querySelector('#reportForm .field [data-act="pick"]'));
    btn.click();
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    return { original: file.size };
  });
  expect(result.original).toBeGreaterThan(25 * MB);
  await expect(page.locator('.media-tile')).toHaveCount(1, { timeout: 30000 });
  const stored = await page.evaluate(async () => {
    const rows = await (await import('/js/local/idb.js')).getAll('media');
    const r = rows.find((x) => /큰사진/.test(x.originalName || ''));
    return r ? { size: r.size, mime: r.mime } : null;
  });
  expect(stored.mime).toBe('image/jpeg');
  expect(stored.size).toBeLessThan(25 * MB);
});

test('올린 동영상이 비공개로 남으면 알려 준다', async ({ page }) => {
  await openApp(page, '#/');
  await page.evaluate(async () => {
    const { warnPrivateVideo } = await import('/js/views/report-common.js');
    warnPrivateVideo({ mediaVideos: 0, mediaPrivate: 2 });          // 사진만 비공개 — 앱이 직접 받아 그린다
    warnPrivateVideo({ mediaVideos: 1, mediaPrivate: 0 });          // 동영상이 공개 — 괜찮다
  });
  await expect(page.locator('#toasts .toast--err')).toHaveCount(0);
  await page.evaluate(async () => (await import('/js/views/report-common.js')).warnPrivateVideo({ mediaVideos: 1, mediaPrivate: 1 }));
  await expect(page.locator('#toasts .toast--err')).toContainText('동영상');
});
