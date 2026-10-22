// 첨부 조각 올리기 — LTE 가 끊겨도 받은 조각 다음부터 이어 올린다.
const { test, expect, openApp } = require('./fixtures.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

const MB = 1024 * 1024;

async function fillReport(page, video) {
  await openApp(page, '#/report/new');
  await field(page, '리포트 번호').selectOption('P260912-01');
  await field(page, '로봇 시리얼').fill('SN-UP-1');
  await field(page, '로봇 모델').selectOption('Gen.1(D1)');
  await field(page, '증상 요약').fill('영상 첨부 검사');
  await field(page, '조치 내용').fill('조각 올리기 조치');
  await field(page, '처리 결과').selectOption('완료');
  // 사람이 하듯 [앨범 · 파일] 타일을 눌러 고른다 (타일을 눌러야 받는 쪽이 연결된다)
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#reportForm button', { hasText: '앨범' }).first().click();
  await (await chooser).setFiles({ name: '현장영상.mp4', mimeType: 'video/mp4', buffer: video });
  await expect(page.locator('#reportForm .media-tile').first()).toBeVisible();
}

test('큰 영상은 조각으로 올라가고, 한 조각이 끊겨도 다시 해서 끝난다', async ({ page, sheet }) => {
  const video = Buffer.alloc(Math.round(3.5 * MB), 7);            // 1.5MB 조각 3개
  const chunks = [];
  let dropped = false;
  await page.route('**/127.0.0.1:8791/exec', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.media === 'chunk') {
      chunks.push(body.index);
      if (body.index === 1 && !dropped) { dropped = true; return route.abort('connectionreset'); }   // 한 번 끊긴다
    }
    return route.continue();
  });
  await fillReport(page, video);
  await page.locator('#reportForm button[type=submit]').click();
  await expect.poll(async () => {
    const dump = await sheet.dump();
    const name = Object.keys(dump).find((n) => /^\d{4}-\d{2}$/.test(n));
    return name ? dump[name].flat().join(' ') : '';
  }, { timeout: 30000 }).toContain('조각 올리기 조치');
  const dump = await sheet.dump();
  const name = Object.keys(dump).find((n) => /^\d{4}-\d{2}$/.test(n));
  expect(dump[name].flat().join(' ')).toMatch(/drive\.google\.com\/file\/d\//);   // 칸에는 드라이브 주소
  expect(chunks.filter((i) => i === 1).length).toBe(2);                           // 끊긴 조각만 다시
  expect(chunks.filter((i) => i === 0).length).toBe(1);
});

test('올리다 아예 끊기면 기기에 남았다가, 다음에 남은 조각만 보낸다', async ({ page, sheet }) => {
  const video = Buffer.alloc(Math.round(3.5 * MB), 9);
  const sent = [];
  let blocked = true;
  await page.route('**/127.0.0.1:8791/exec', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.media === 'chunk') {
      if (blocked && body.index === 2) return route.abort('connectionreset');     // 세 번째 조각에서 계속 끊김
      sent.push(body.index);
    }
    return route.continue();
  });
  await fillReport(page, video);
  await page.locator('#reportForm button[type=submit]').click();
  // 다시 해 보다(1 · 3 · 6초) 결국 실패 — '실패' 로 멈추지 않고 기기 대기열에 남는다
  await expect(page.locator('#view')).toContainText('업로드 대기', { timeout: 30000 });
  expect(sent).toEqual([0, 1]);
  blocked = false;
  await page.evaluate(async () => {
    const sync = await import('/js/sync.js');
    await sync.flushOutbox();
  });
  await expect.poll(async () => {
    const dump = await sheet.dump();
    const name = Object.keys(dump).find((n) => /^\d{4}-\d{2}$/.test(n));
    return name ? dump[name].flat().join(' ') : '';
  }, { timeout: 30000 }).toContain('조각 올리기 조치');
  expect(sent).toEqual([0, 1, 2]);                // 0 · 1 은 다시 보내지 않았다
});
