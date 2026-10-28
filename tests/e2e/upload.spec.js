// 첨부 조각 올리기 — LTE 가 끊겨도 받은 조각 다음부터 이어 올린다.
const { test, expect, openApp, pick } = require('./fixtures.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

const MB = 1024 * 1024;

async function fillReport(page, video) {
  await openApp(page, '#/report/new');
  await pick(page, '고객사 리포트', 'P260912-01');
  await field(page, '로봇 시리얼').fill('SN-UP-1');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await field(page, '증상 요약').fill('영상 첨부 검사');
  await field(page, '조치 내용').fill('조각 올리기 조치');
  await pick(page, '처리 결과', '완료');
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
  expect([...sent].sort()).toEqual([0, 1]);         // 3개씩 동시에 — 차례는 섞일 수 있다
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
  expect([...sent].sort()).toEqual([0, 1, 2]);    // 0 · 1 은 다시 보내지 않았다
});

// ── 빨리 올리기 (v3.33) ──────────────────────────────────────────────────────

const rowText = async (sheet) => {
  const dump = await sheet.dump();
  const name = Object.keys(dump).find((n) => /^\d{4}-\d{2}$/.test(n));
  return name ? dump[name].flat().join(' ') : '';
};

test('붙이는 순간 뒤에서 조각을 미리 보내고, [업로드] 때는 마무리만 한다', async ({ page, sheet }) => {
  const video = Buffer.alloc(Math.round(3.5 * MB), 5);            // 조각 3개
  const chunks = [];
  const finishes = [];
  let submitted = false;
  await page.route('**/127.0.0.1:8791/exec', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.media === 'chunk') chunks.push({ index: body.index, submitted });
    if (body.media === 'finish') finishes.push(body);
    return route.continue();
  });
  await fillReport(page, video);
  await expect.poll(() => chunks.length, { timeout: 15000 }).toBe(3);            // 쓰는 동안 다 보냈다
  submitted = true;
  await page.locator('#reportForm button[type=submit]').click();
  await expect.poll(() => rowText(sheet), { timeout: 30000 }).toContain('조각 올리기 조치');
  expect(chunks.filter((c) => c.submitted)).toEqual([]);                        // [업로드] 뒤엔 조각을 다시 안 보낸다
  expect(chunks.map((c) => c.index).sort()).toEqual([0, 1, 2]);
  expect(finishes.length).toBe(1);
  expect(finishes[0].data).toBeUndefined();                                      // 마무리에는 파일이 실리지 않는다
});

// ── 조각 id (v3.36.1) ────────────────────────────────────────────────────────

test('마무리에 조각 id 를 함께 보내고, 시트가 빠진 조각을 말하면 그것만 다시 보내 저절로 끝낸다', async ({ page, sheet }) => {
  // 실제로 난 일: 1분 영상을 보내자마자 마무리 → 드라이브 검색이 늦어 '빠진 조각: 0,1,…,13'
  const video = Buffer.alloc(Math.round(3.5 * MB), 4);            // 조각 3개
  const chunks = [];
  const finishes = [];
  await page.route('**/127.0.0.1:8791/exec', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.media === 'chunk') chunks.push(body.index);
    if (body.media === 'finish') {
      finishes.push(body);
      if (finishes.length === 1) {                                 // 첫 마무리는 시트가 1번 조각을 못 찾았다
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: false, missing: [1], error: '빠진 조각이 있습니다: 1' }) });
      }
    }
    return route.continue();
  });
  await fillReport(page, video);
  await page.locator('#reportForm button[type=submit]').click();
  await expect.poll(() => rowText(sheet), { timeout: 30000 }).toContain('조각 올리기 조치');
  expect(finishes.length).toBe(2);
  expect(finishes[0].parts).toHaveLength(3);
  expect(finishes[0].parts.every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
  expect(chunks.filter((i) => i === 1).length).toBe(2);           // 빠졌다는 조각만 다시
  expect(chunks.filter((i) => i === 0).length).toBe(1);
  await expect(page.locator('body')).not.toContainText('빠진 조각');
});

test('작은 파일은 조각 없이 마무리 요청 한 번으로 올라간다 (미리 올리기를 못 했을 때)', async ({ page, sheet }) => {
  const small = Buffer.alloc(300 * 1024, 3);                      // 조각 하나짜리
  const calls = [];
  let offline = true;
  await page.route('**/127.0.0.1:8791/exec', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.media === 'chunk' || body.media === 'finish') calls.push({ media: body.media, data: Boolean(body.data) });
    if (offline && body.media === 'chunk') return route.abort('internetdisconnected');   // 쓰는 동안엔 끊겨 있었다
    return route.continue();
  });
  await fillReport(page, small);
  await expect.poll(() => calls.length, { timeout: 15000 }).toBeGreaterThan(0);
  offline = false;
  calls.length = 0;
  await page.locator('#reportForm button[type=submit]').click();
  await expect.poll(() => rowText(sheet), { timeout: 30000 }).toContain('조각 올리기 조치');
  expect(calls).toEqual([{ media: 'finish', data: true }]);
  expect(await rowText(sheet)).toMatch(/drive\.google\.com\/file\/d\//);
});
