// v3.43 — 한 번 본 가이드 사진은 기기에 담아 두고 다음부터 거기서 꺼낸다 (1GB · 오래 안 본 것부터 지움)
const { test, expect, openApp } = require('./fixtures.js');

const DRIVE_ID = '1TestDrivePhotoId0000000001';
const VIDEO_ID = '1TestDriveVideoId0000000001';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const GUIDE = {
  id: 'a1b2c3d4e5f6f343', categoryType: 'HARDWARE_SOP', robotModel: 'Gen.1', codeOrTitle: '사진 담기 검사',
  steps: [
    { instruction: '커넥터를 뺀다', expectedMetric: '', imageUrl: `https://drive.google.com/file/d/${DRIVE_ID}/view` },
    { instruction: '영상을 본다', expectedMetric: '', imageUrl: `https://drive.google.com/file/d/${VIDEO_ID}/view#video` },
  ],
  updatedAt: '2026-10-20T10:00:00',
};

const usage = (page) => page.evaluate(async () => (await import('/js/drivemedia.js')).photoUsage());
const photo = (page) => page.locator('img[data-media*="drive.google.com"]').first();

test('가이드 사진 — 처음엔 받아서 담고, 다음부터는 기기에서 · 넘치면 오래된 것부터 · 오프라인 안내', async ({ page, sheet }) => {
  let hits = 0;
  await page.route(/lh3\.googleusercontent\.com/, (route) => {
    hits += 1;
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG,
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  // 영상 재생기는 빈 쪽으로 (밖으로 나가지 않게). 옛 미리보기 주소(drive.google.com/thumbnail)는 세어 둔다.
  let oldThumb = 0;
  await page.route(/drive\.google\.com/, (route) => {
    if (route.request().url().includes('/thumbnail')) oldThumb += 1;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>재생기</title>' });
  });
  await sheet.call({ guides: 'push', items: [GUIDE] });
  await page.addInitScript(() => localStorage.setItem('bh_guide_view', 'list'));

  await openApp(page, '#/guides');
  await expect.poll(async () => page.evaluate(async () => {
    const { api } = await import('/js/api.js');
    return (await api.listGuides()).items.length;
  }), { timeout: 15000 }).toBeGreaterThan(0);

  await openApp(page, `#/guides/${GUIDE.id}`);
  await expect(photo(page)).toHaveAttribute('src', new RegExp(`lh3\\.googleusercontent\\.com/d/${DRIVE_ID}=w800`));
  await expect.poll(async () => (await usage(page)).count, { timeout: 10000 }).toBe(1);   // 화면 크기 그대로 담겼다
  expect(hits).toBe(1);

  await page.reload();                                                          // 다시 열면 기기에서 꺼낸다
  await expect(photo(page)).toHaveAttribute('src', /^blob:/);
  expect(hits).toBe(1);
  expect(oldThumb).toBe(0);

  // 설정 — 담아 둔 크기가 보이고 비울 수 있다
  await openApp(page, '#/settings');
  await expect(page.locator('#photoUsage')).toContainText('담아 둔 사진 1장');
  await expect(page.locator('#photoUsage')).toContainText('/ 1GB');

  // 상한을 넘으면 가장 오래 안 본 것부터 지운다
  const removed = await page.evaluate(async () => (await import('/js/drivemedia.js')).trimPhotos(1));
  expect(removed).toBe(1);
  expect((await usage(page)).count).toBe(0);

  // 오프라인 — 담지 않은 사진 · 영상 자리에 까닭을 적는다 (깨진 그림 · 빈 재생기 대신)
  await page.unroute(/lh3\.googleusercontent\.com/);
  await page.route(/lh3\.googleusercontent\.com/, (route) => route.abort('internetdisconnected'));
  await page.context().setOffline(true);
  await page.evaluate((id) => { location.hash = `#/guides/${id}`; }, GUIDE.id);
  await page.evaluate(() => { location.hash = '#/guides'; });
  await page.evaluate((id) => { location.hash = `#/guides/${id}`; }, GUIDE.id);
  await expect(page.locator('.media-missing', { hasText: '영상은 인터넷이 연결되면' })).toBeVisible();
  await expect(page.locator('.media-missing', { hasText: '이 사진은 아직 이 기기에 없어요' })).toBeVisible({ timeout: 15000 });
  await page.context().setOffline(false);
});

// v3.43.1 — 내용이 긴 창(패치 내용 · 운행일지 항목 관리)에서 제목 줄이 눌려 ✕ 버튼 위 테두리가 잘렸다
async function closeFits(page) {
  return page.evaluate(() => {
    const box = document.querySelector('#modalRoot .modal__box').getBoundingClientRect();
    const btn = document.querySelector('#modalRoot .modal__box [data-act="close"]');
    const b = btn.getBoundingClientRect();
    const row = btn.parentElement.getBoundingClientRect();
    return {
      inside: b.top >= box.top && b.right <= box.right && b.left >= box.left,
      rowHolds: row.height >= b.height - 0.5 && b.top >= row.top - 0.5,
    };
  });
}

test('긴 창의 ✕ 버튼이 상자 안에 다 보인다 — 패치 내용 · 운행일지 항목 관리', async ({ page, sheet }) => {
  const { seed } = require('./seed.js');
  await seed(sheet);
  await openApp(page, '#/');
  await page.locator('#btn-patch').click();
  await expect(page.locator('#modalRoot .modal__title')).toHaveText('패치 내용');
  expect(await closeFits(page)).toEqual({ inside: true, rowHolds: true });
  await page.locator('#modalRoot [data-act="close"]').click();

  await openApp(page, '#/driving');
  await page.locator('[data-act="manage-options"]').click({ timeout: 15000 });
  await expect(page.locator('#modalRoot .modal__title')).toHaveText('운행일지 항목 관리');
  expect(await closeFits(page)).toEqual({ inside: true, rowHolds: true });
});
