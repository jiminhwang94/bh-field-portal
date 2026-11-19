// 동작 시험 보강 ⑪ 내 이름 등록 · ⑫ 상태 바꾸기 대기열
const { test, expect, openApp } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

test('내 이름 — 빈 칸이면 알려 주고 · [등록] 과 엔터로 등록된다', async ({ page }) => {
  await openApp(page, '#/settings');
  const box = page.locator('#sDevice');
  await box.fill('');
  await page.locator('[data-act="save-name"]').click();
  await expect(page.locator('#toasts .toast--err')).toContainText('이름');
  expect(await page.evaluate(() => localStorage.getItem('bh_device_name'))).toBe('검사봇');   // 지우지 않았다
  await box.fill('김현장');
  await page.locator('[data-act="save-name"]').click();
  await expect(page.locator('#nameHint')).toContainText('김현장');
  expect(await page.evaluate(() => localStorage.getItem('bh_device_name'))).toBe('김현장');
  await box.fill('박엔터');
  await box.press('Enter');
  await expect(page.locator('#nameHint')).toContainText('박엔터');
  expect(await page.evaluate(() => localStorage.getItem('bh_device_name'))).toBe('박엔터');
});

test('새 리포트의 첫 상태는 [처리 결과] 에서 정한다', async ({ page }) => {
  await openApp(page, '#/');
  const got = await page.evaluate(async () => {
    const { seedStatus } = await import('/js/sheets.js');
    const of = (v) => seedStatus([{ label: '처리 결과', value: v }]);
    return [of('완료'), of('부품 대기'), of('모니터링'), of('재방문 필요'), of(''), seedStatus([])];
  });
  expect(got).toEqual(['조치 완료', '교체 예정', '모니터링', '조치 진행 중', '조치 진행 중', '조치 진행 중']);
});

test('오프라인 상태 바꾸기 — 쌓였다가 같은 줄은 마지막 것만 · 되돌리면 맨 처음 상태로', async ({ page, sheet }) => {
  await page.clock.setFixedTime(NOW);
  await seed(sheet);
  await openApp(page, '#/reports');
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => Promise.all(['/js/reportsheet.js', '/js/pending.js', '/js/syncnow.js', '/js/sync.js'].map((m) => import(m))));
  await page.context().setOffline(true);
  const out = await page.evaluate(async () => {
    const idb = await import('/js/local/idb.js');
    const store = await import('/js/local/store.js');
    const rs = await import('/js/reportsheet.js');
    await idb.clear('outbox');
    const month = await store.getMeta('sheetReports:2026-10', null);
    const entry = month.entries.find((e) => e.store === '옥동식 서초점');
    const first = entry.status;
    const a = await rs.setStatus('2026-10', entry.row, '교체 예정');
    await rs.setStatus('2026-10', entry.row, '모니터링');
    await rs.setStatus('2026-10', entry.row, '조치 완료');
    await store.compactOutbox();
    const ops = (await store.outbox()).filter((o) => o.type === 'report-status');
    return { queued: a.queued, first, row: entry.row, ops: ops.map((o) => ({ status: o.status, before: o.before })) };
  });
  expect(out.queued).toBe(true);
  expect(out.ops).toEqual([{ status: '조치 완료', before: out.first }]);      // 마지막 것만 · 되돌릴 값은 맨 처음
  // [올릴 내용] 에서 되돌리면 맨 처음 상태로
  await page.evaluate(async () => (await import('/js/pending.js')).openPendingList());
  const row = page.locator('#pendingRows .row').first();
  await row.locator('[data-act="undo-ask"]').click();
  await row.locator('[data-act="undo-yes"]').click();
  const now = await page.evaluate(async (r) => {
    const month = await (await import('/js/local/store.js')).getMeta('sheetReports:2026-10', null);
    return month.entries.find((e) => e.row === r).status;
  }, out.row);
  expect(now).toBe(out.first);
});
