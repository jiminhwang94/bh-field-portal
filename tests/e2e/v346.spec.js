// v3.46 — 안정성: 대기열이 한 건 때문에 막히지 않는다 · 다시 시도 간격 · 못 보냄 · 올린 리포트 치우기 · 오프라인 이력
const { test, expect, openApp, pick, SHEET } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

async function writeReport(page, store) {
  await openApp(page, '#/report/new?fresh=1');
  await field(page, '매장명').fill(store);
  await field(page, '로봇 시리얼').fill('SN-Q-1');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await field(page, '증상 요약').fill(`${store} 증상`);
  await field(page, '조치 내용').fill(`${store} 조치`);
  await pick(page, '처리 결과', '완료');
  await page.locator('#reportForm button[type=submit]').click();
  await expect(page).toHaveURL(/#\/reports\/[0-9a-z]+$/);
}

const sheetHas = async (sheet, text) => Object.values(await sheet.dump())
  .some((rows) => (rows || []).some((r) => r.join(' ').includes(text)));

const outboxRows = (page) => page.evaluate(async () => {
  const store = await import('/js/local/store.js');
  const rows = (await store.outbox()).filter((op) => op.type === 'sheet');   // 리포트 올리기만
  const out = [];
  for (const op of rows) {
    const rep = op.reportId ? await store.getReport(op.reportId) : null;
    out.push({ title: rep ? rep.title : op.type, tries: op.tries || 0, stuck: Boolean(op.stuck),
               wait: op.nextTryAt ? op.nextTryAt - Date.now() : 0, lastError: op.lastError || '' });
  }
  return out;
});

test('대기열 — 한 건이 부딪혀도 뒤의 리포트는 올라가고, 부딪힌 것은 못 보냄 · 다른 실패는 1분 뒤 다시', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/');
  // 시트가 '충돌점' 은 다른 기기와 부딪혔다고, '오류점' 은 그냥 실패라고 답한다
  const hits = { 충돌점: 0, 오류점: 0 };
  await page.route(`${SHEET}/exec`, async (route) => {
    const text = route.request().postData() || '';
    for (const name of Object.keys(hits)) {
      if (text.includes(`${name} 조치`) && !/"media":"(chunk|finish)"/.test(text)) {
        hits[name] += 1;
        const body = name === '충돌점'
          ? { ok: false, conflict: true, error: '그 줄이 바뀌었습니다' }
          : { ok: false, error: '잠깐 막혔습니다' };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
    }
    return route.continue();
  });

  await page.context().setOffline(true);                                       // 셋 다 대기열에 쌓는다
  for (const name of ['충돌점', '오류점', '정상점']) await writeReport(page, name);
  await expect.poll(async () => (await outboxRows(page)).length).toBe(3);
  await page.context().setOffline(false);
  await page.evaluate(async () => (await import('/js/sync.js')).flushOutbox());

  await expect.poll(() => sheetHas(sheet, '정상점 조치'), { timeout: 15000 }).toBe(true);   // 뒤의 것이 막히지 않았다
  const rows = await outboxRows(page);
  const clash = rows.find((r) => r.title.includes('충돌점'));
  const flaky = rows.find((r) => r.title.includes('오류점'));
  expect(rows).toHaveLength(2);
  expect(clash.stuck).toBe(true);                                              // 다시 보내도 같다 — 못 보냄
  expect(flaky.stuck).toBe(false);
  expect(flaky.tries).toBe(1);
  expect(flaky.wait).toBeGreaterThan(50 * 1000);                               // 1분 뒤에 다시

  // 저절로 도는 올리기는 기다리는 것 · 못 보냄을 건드리지 않는다
  const before = { ...hits };
  await page.evaluate(async () => (await import('/js/sync.js')).flushOutbox());
  expect(hits).toEqual(before);

  // 상단 칩 — '올리는 중' 이 아니라 '못 보냄'
  await page.evaluate(async () => (await import('/js/syncnow.js')).paint());
  await expect(page.locator('#sync-text')).toHaveText('못 보냄 2건');

  // [올릴 내용] — 까닭과 [다시 시도]. 막힌 것이 풀리면 다시 시도로 보낸다
  await page.locator('#sync-chip').click();
  const clashRow = page.locator('#pendingRows .row', { hasText: '충돌점' });
  await expect(clashRow.locator('.pend-bad')).toContainText('다른 기기와 부딪혔습니다');
  await page.unroute(`${SHEET}/exec`);
  await clashRow.locator('[data-act="retry"]').click();
  await expect.poll(() => sheetHas(sheet, '충돌점 조치'), { timeout: 15000 }).toBe(true);
  await expect(page.locator('#pendingRows .row', { hasText: '충돌점' })).toHaveCount(0);
});

test('올린 지 14일 지난 리포트는 사진과 함께 기기에서 치운다 · 최근 것 · 대기 중인 것은 둔다', async ({ page }) => {
  await openApp(page, '#/');
  const left = await page.evaluate(async () => {
    const idb = await import('/js/local/idb.js');
    const store = await import('/js/local/store.js');
    const old = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 19);
    const media = (name) => ({ filename: name, blob: new Blob(['x']), mime: 'image/jpeg', size: 1, createdAt: old, localOnly: true });
    const report = (id, status, at, file) => ({ id, title: id, status, createdAt: at, updatedAt: at,
      payload: [{ fieldId: 'f', label: '현장 사진', type: 'MEDIA', value: '', media: [{ filename: `/media/${file}` }] }] });
    await idb.put('media', media('old.jpg'));
    await idb.put('media', media('new.jpg'));
    await idb.put('media', media('queued.jpg'));
    await idb.put('reports', report('old-up', 'UPLOADED', old, 'old.jpg'));
    await idb.put('reports', report('new-up', 'UPLOADED', store.now(), 'new.jpg'));
    await idb.put('reports', report('old-queued', 'UPLOADED', old, 'queued.jpg'));
    await store.enqueue({ type: 'sheet', reportId: 'old-queued' });            // 다시 올리는 중
    const removed = await store.pruneUploadedReports(14);
    return {
      removed,
      reports: (await idb.getAll('reports')).map((r) => r.id).sort(),
      media: (await idb.getAll('media')).map((m) => m.filename).sort(),
    };
  });
  expect(left.removed).toBe(1);
  expect(left.reports).toEqual(['new-up', 'old-queued']);
  expect(left.media).toEqual(['new.jpg', 'queued.jpg']);
});

test('오프라인 이력 — [새로고침] 뒤에 끊겨도 받아 둔 이력을 그 시각과 함께 보여 준다 (0건이 아니다)', async ({ page, sheet }) => {
  await seed(sheet);
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
  const count = await page.locator('.hist-row').count();
  // 이력 받기가 실패하는 LTE — 예전에는 [새로고침] 이 받기도 전에 사본을 지워 "0건" 이 됐다
  await page.route(`${SHEET}/exec`, (route) => (
    (route.request().postData() || '').includes('"reports":"pull"') ? route.abort() : route.continue()));
  await page.locator('#btn-update').click();
  await expect(page.locator('#btn-update')).toHaveText('새로고침', { timeout: 15000 });
  await expect(page.locator('.hist-row')).toHaveCount(count, { timeout: 15000 });
  await expect(page.locator('.hist-note')).toContainText('받아 둔 내용');
  await expect(page.locator('.empty')).toHaveCount(0);
  await page.unroute(`${SHEET}/exec`);
  await page.context().setOffline(true);
  await page.evaluate(() => { location.hash = '#/'; });
  await page.evaluate(() => { location.hash = '#/reports'; });
  await expect(page.locator('.hist-row')).toHaveCount(count, { timeout: 15000 });
  await expect(page.locator('.hist-note')).toContainText('오프라인');
  await expect(page.locator('.empty')).toHaveCount(0);
  await page.context().setOffline(false);
});
