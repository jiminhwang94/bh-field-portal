// 이슈 유형 목록 (v3.31 '작업' → v3.32 '이슈 유형') — 구분 › 대분류 › 세부 항목. 고르기 · 새로 적기 · 검색(별칭 · 초성) · 합치기 · 가이드 잇기.
const { test, expect, openApp } = require('./fixtures.js');
const { seed, NOW, GUIDES } = require('./seed.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: new RegExp(`^${label}`) }),
}).locator('input, select, textarea').first();

const rowsOf = async (sheet, name) => ((await sheet.dump())[name] || []).slice(2);

async function seedWork(sheet) {
  await sheet.call({ work: 'push', ops: [
    { op: 'cat-add', kind: '로봇 이슈', name: '하드웨어 교체' },
    { op: 'cat-add', kind: '로봇 이슈', name: '유지 보수' },
    { op: 'cat-add', kind: '로봇 외 이슈', name: '네트워크 · 와이파이' },
    { op: 'item-upsert', item: { id: 'wk-loader', kind: '로봇 이슈', cat: '하드웨어 교체', name: '로더 교체',
      aliases: ['팔 교체'], guides: [GUIDES[0].id] } },
    { op: 'item-upsert', item: { id: 'wk-wifi', kind: '로봇 외 이슈', cat: '네트워크 · 와이파이', name: '와이파이 재연결' } },
  ] });
}

test('[이슈 유형 고르기] 창 — 대분류를 고르고 목록에 없는 항목을 새로 적으면 리포트에 경로로 올라간다', async ({ page, sheet }) => {
  await openApp(page, '#/report/new');
  await page.locator('#workHelper [data-act="open-work"]').click();
  const box = page.locator('#modalRoot .wk');
  await expect(box.locator('.wk-kind')).toHaveText(['로봇 이슈', '로봇 외 이슈']);     // 기본 대분류가 깔린다
  await box.locator('[data-act="wk-cat"][data-cat="하드웨어 교체"]').click();
  await box.locator('#wkNew').fill('로더 교체');
  await box.locator('[data-act="wk-add"]').click();
  await expect(page.locator('#workHelper .work-pill')).toContainText('로봇 이슈 › 하드웨어 교체 › 로더 교체');
  await expect(field(page, '이슈 유형')).toHaveValue('로봇 이슈 › 하드웨어 교체 › 로더 교체');

  await field(page, '리포트 번호').selectOption('P260912-01');
  await field(page, '로봇 시리얼').fill('SN-WORK');
  await field(page, '로봇 모델').selectOption('Gen.1(D1)');
  await field(page, '증상 요약').fill('로더 소음');
  await field(page, '조치 내용').fill('로더 교체함');
  await field(page, '처리 결과').selectOption('완료');
  await page.locator('#reportForm button[type=submit]').click();
  await expect.poll(async () => {
    const dump = await sheet.dump();
    const name = Object.keys(dump).find((n) => /^\d{4}-\d{2}$/.test(n));
    return name ? dump[name].flat().join(' ') : '';
  }, { timeout: 15000 }).toContain('로봇 이슈 › 하드웨어 교체 › 로더 교체');
  // 새로 적은 것은 팀 공용 목록에 '새 항목' 으로
  await expect.poll(async () => (await rowsOf(sheet, '이슈 유형 목록')).find((r) => r[2] === '로더 교체'), { timeout: 15000 })
    .toBeTruthy();
  const row = (await rowsOf(sheet, '이슈 유형 목록')).find((r) => r[2] === '로더 교체');
  expect(row[5]).toBe('새 항목');
});

test('검색 — 별칭(팔)과 초성(ㄹㄷ)으로도 같은 항목을 찾는다 · 고르면 이어 둔 가이드가 뜬다', async ({ page, sheet }) => {
  await seed(sheet);
  await seedWork(sheet);
  await openApp(page, '#/');
  await page.waitForTimeout(1500);                       // 이슈 유형 목록 · 가이드를 받아 둔다
  await openApp(page, '#/report/new');
  await field(page, '로봇 모델').selectOption('Gen.1(D1)');
  await page.locator('#workHelper [data-act="open-work"]').click();
  const box = page.locator('#modalRoot .wk');
  await box.locator('#wkQ').fill('팔');
  await expect(box.locator('.wk-item')).toHaveCount(1);
  await expect(box.locator('.wk-item')).toContainText('로더 교체');
  await box.locator('#wkQ').fill('ㄹㄷ');
  await expect(box.locator('.wk-item', { hasText: '로더 교체' })).toBeVisible();
  await box.locator('.wk-item', { hasText: '로더 교체' }).click();
  await expect(page.locator('#workHelper .guide-hint')).toContainText('E-101 로더 모터 과전류');
});

test('이슈 유형 정리 — 비슷한 이름은 합치기 후보 · 합치면 별칭으로 남는다', async ({ page, sheet }) => {
  await seedWork(sheet);
  await sheet.call({ work: 'push', ops: [{ op: 'item-upsert', item: { id: 'wk-dup', kind: '로봇 이슈', cat: '하드웨어 교체',
    name: '로더교체', isNew: true } }] });
  await openApp(page, '#/');
  await page.waitForTimeout(1500);
  await openApp(page, '#/work');
  const cand = page.locator('.wk-cand', { hasText: '로더교체' });
  await expect(cand).toBeVisible();
  await cand.locator('[data-act="merge-pair"]').click();
  await expect.poll(async () => (await rowsOf(sheet, '이슈 유형 목록')).filter((r) => r[2]).map((r) => `${r[2]}|${r[3]}`).join(' / '),
    { timeout: 15000 }).toContain('로더 교체|팔 교체, 로더교체');
  expect((await rowsOf(sheet, '이슈 유형 목록')).some((r) => r[2] === '로더교체')).toBe(false);
});

test('이력 — 이슈 유형에 이어 둔 가이드로 · 분류 글자에는 [만들기] 없음 · 코드 모양일 때만 [만들기]', async ({ page, sheet }) => {
  await seed(sheet);
  await seedWork(sheet);
  const H = ['작성일시', '작성자', '리포트 번호', '매장명', '로봇 시리얼', '로봇 모델', '작업', '오류 코드',  // v3.31 '작업' 열도 읽는다
   '증상 요약', '조치 내용', '처리 결과', '상태'];
  await sheet.call({ sheetName: '2026-10', headers: H, row: ['2026-10-22 08:00', '검사봇', 'P1', '작업점', 'S1', 'Gen.1(D1)',
    '로봇 이슈 › 하드웨어 교체 › 로더 교체', '', '로더 소음', '교체', '완료', '조치 완료'] });
  await sheet.call({ sheetName: '2026-10', headers: H, row: ['2026-10-22 08:10', '검사봇', 'P2', '분류점', 'S2', 'Gen.1(D1)',
    '', '유지 보수', '정기 점검', '청소', '완료', '조치 완료'] });
  await sheet.call({ sheetName: '2026-10', headers: H, row: ['2026-10-22 08:20', '검사봇', 'P3', '코드점', 'S3', 'Gen.1(D1)',
    '', 'E-999', '처음 보는 오류', '재부팅', '모니터링', '모니터링'] });
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');
  await page.locator('.hist-row', { hasText: '작업점' }).click();
  await expect(page.locator('#histPanel .hd-work')).toContainText('로더 교체');
  await expect(page.locator('#histPanel .hd-guide')).toContainText('E-101 로더 모터 과전류');
  await page.locator('.hist-row', { hasText: '분류점' }).click();
  await expect(page.locator('#histPanel .hd-work')).toContainText('유지 보수');
  await expect(page.locator('#histPanel .hd-guide--none')).toHaveCount(0);           // '유지 보수 가이드 만들기' 없음
  await page.locator('.hist-row', { hasText: '코드점' }).click();
  await expect(page.locator('#histPanel .hd-guide--none')).toContainText('E-999');
});
