// 리포트 — 쓰고 올리면 시트에 한 줄 · 이력에서 상태를 바꾸면 시트 칸이 바뀐다.
const { test, expect, openApp, pick } = require('./fixtures.js');

/** 이름표(label) 글자로 칸을 찾는다 — 항목 ID 는 기기마다 달라서 쓰지 않는다. */
const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

/** 시트 dump 에서 이 달 탭의 줄들 */
function monthRows(dump) {
  const name = Object.keys(dump).find((n) => /^\d{4}-\d{2}$/.test(n));
  return name ? dump[name] : [];
}

async function writeReport(page, { number = 'P260912-01', symptom = '바퀴 소음', action = '베어링 교체' } = {}) {
  await openApp(page, '#/report/new');
  await pick(page, '고객사 리포트', number);
  await expect(field(page, '매장명')).not.toHaveValue('');
  await field(page, '로봇 시리얼').fill('SN-E2E-001');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await field(page, '증상 요약').fill(symptom);
  await field(page, '조치 내용').fill(action);
  await pick(page, '처리 결과', '완료');
  await page.locator('#reportForm button[type=submit]').click();
}

test('새 리포트를 올리면 가짜 시트의 이 달 탭에 한 줄이 생긴다', async ({ page, sheet }) => {
  await writeReport(page);
  await expect.poll(async () => monthRows(await sheet.dump()).flat().join(' '), { timeout: 15000 })
    .toContain('베어링 교체');
  const rows = monthRows(await sheet.dump());
  const text = rows.flat().join(' ');
  expect(text).toContain('홍기와');          // 리포트 번호를 고르면 매장명이 채워진다
  expect(text).toContain('SN-E2E-001');
});

test('이력에서 상태를 바꾸면 시트의 상태 칸이 바뀐다', async ({ page, sheet }) => {
  await writeReport(page, { symptom: '상태 검사용', action: '상태 검사 조치' });
  await expect.poll(async () => monthRows(await sheet.dump()).flat().join(' '), { timeout: 15000 })
    .toContain('상태 검사 조치');

  await openApp(page, '#/reports');
  await page.locator('.hist-row', { hasText: '홍기와' }).first().click();
  await page.locator('.status-seg__btn', { hasText: '모니터링' }).click();
  await expect(page.locator('.status-seg__btn.is-on')).toContainText('모니터링');

  await expect.poll(async () => {
    const rows = monthRows(await sheet.dump());
    const head = rows.find((r) => r.includes('상태')) || [];
    const col = head.indexOf('상태');
    const line = rows.find((r) => r.join(' ').includes('상태 검사 조치')) || [];
    return line[col];
  }, { timeout: 15000 }).toBe('모니터링');
});

test('이력 상세에는 [수정] · [삭제] 만 · 같은 매장 새 리포트는 매장별 이력에서 지난 값으로', async ({ page, sheet }) => {
  await writeReport(page, { symptom: '새 방문 검사', action: '새 방문 검사 조치' });
  await expect.poll(async () => monthRows(await sheet.dump()).flat().join(' '), { timeout: 15000 })
    .toContain('새 방문 검사 조치');
  await openApp(page, '#/reports');
  await page.locator('.hist-row', { hasText: '홍기와' }).first().click();
  await expect(page.locator('#modalRoot [data-act="reuse"]')).toHaveCount(0);
  await expect(page.locator('#modalRoot [data-act="edit"]')).toBeVisible();
  await page.locator('#modalRoot .hd-title--link').click();
  await page.locator('[data-act="new-here"]').click();
  await expect(page).toHaveURL(/#\/report\/new$/);
  await expect(field(page, '매장명')).toHaveValue('홍기와');
});
