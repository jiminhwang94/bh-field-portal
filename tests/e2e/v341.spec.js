// v3.41 — 이슈 유형 → 증상 요약 → 조치 내용
const { test, expect, openApp } = require('./fixtures.js');
const { seed, GUIDES } = require('./seed.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: new RegExp(`^${label}`) }),
}).locator('input, select, textarea').first();

async function seedWork(sheet) {
  await sheet.call({ work: 'push', ops: [
    { op: 'cat-add', kind: '로봇 이슈', name: '하드웨어 교체' },
    { op: 'cat-add', kind: '로봇 외 이슈', name: '네트워크 · 와이파이' },
    { op: 'item-upsert', item: { id: 'wk-loader', kind: '로봇 이슈', cat: '하드웨어 교체', name: '로더 교체',
      aliases: [], guides: [GUIDES[0].id] } },
    { op: 'item-upsert', item: { id: 'wk-wifi', kind: '로봇 외 이슈', cat: '네트워크 · 와이파이', name: '와이파이 재연결' } },
  ] });
}

async function chooseIssue(page, name) {
  await page.locator('#workHelper [data-act="open-work"]').click();
  const box = page.locator('#modalRoot .wk');
  await box.locator('#wkQ').fill(name);
  await box.locator('.wk-item', { hasText: name }).first().click();
  await box.locator('[data-act="wk-done"]').click();
}

test('이슈 유형을 고르면 증상 요약 맨 위에 이름이 들어가고, 바꾸면 그 줄만 바뀐다 (직접 쓴 글은 그대로)', async ({ page, sheet }) => {
  await seed(sheet);
  await seedWork(sheet);
  await openApp(page, '#/');
  await page.waitForTimeout(1500);                                   // 이슈 유형 목록을 받아 둔다
  await openApp(page, '#/report/new');
  await chooseIssue(page, '로더 교체');
  await expect(field(page, '증상 요약')).toHaveValue('로더 교체');
  await field(page, '증상 요약').fill('로더 교체\n아침부터 멈춤');
  await chooseIssue(page, '와이파이 재연결');
  await expect(field(page, '증상 요약')).toHaveValue('로더 교체\n와이파이 재연결\n아침부터 멈춤');
  await page.locator('#workHelper .work-pill', { hasText: '로더 교체' }).locator('[data-act="work-clear"]').click();
  await expect(field(page, '증상 요약')).toHaveValue('와이파이 재연결\n아침부터 멈춤');

  // 조치 내용에 들어가면 증상마다 '• 증상 → ' 줄이 깔린다
  await field(page, '조치 내용').click();
  await expect(field(page, '조치 내용')).toHaveValue('• 와이파이 재연결 → ');
  await page.keyboard.press('End');
  await page.keyboard.type('공유기 재부팅');
  await expect(field(page, '조치 내용')).toHaveValue('• 와이파이 재연결 → 공유기 재부팅');
});

test('같은 이슈 유형의 지난번 조치를 누르면 그 증상 줄 화살표 뒤에 들어간다', async ({ page, sheet }) => {
  await seed(sheet);
  await seedWork(sheet);
  const H = ['작성일시', '작성자', '리포트 번호', '매장명', '로봇 시리얼', '로봇 모델', '이슈 유형', '증상 요약', '조치 내용', '처리 결과', '상태'];
  await sheet.call({ sheetName: '2026-10', headers: H, row: ['2026-10-20 09:00', '검사봇', 'P261020-01', '지난점', 'SN-OLD',
    'Gen.1(D1)', '로봇 이슈 › 하드웨어 교체 › 로더 교체', '로더 교체', '• 로더 교체 → 커넥터 CN3 재체결', '완료', '조치 완료'] });
  await openApp(page, '#/reports');                                   // 이력을 받아 둔다 (지난번은 받아 둔 사본으로)
  await expect(page.locator('#view')).toContainText('지난점', { timeout: 15000 });
  await openApp(page, '#/report/new');
  await chooseIssue(page, '로더 교체');
  const chip = page.locator('#actionHelper [data-act="use-action"]', { hasText: '커넥터 CN3 재체결' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(field(page, '조치 내용')).toHaveValue('• 로더 교체 → 커넥터 CN3 재체결');
});

test('처리 결과 [완료] 를 누르면 조치 내용에 증상 줄을 깐다 · 이미 쓴 조치는 지키며 빠진 증상만 더한다', async ({ page, sheet }) => {
  await seed(sheet);
  await seedWork(sheet);
  await openApp(page, '#/');
  await page.waitForTimeout(1500);
  await openApp(page, '#/report/new');
  await chooseIssue(page, '로더 교체');
  await field(page, '조치 내용').click();                            // 비어 있으면 증상 줄이 깔린다
  await page.keyboard.press('End');
  await page.keyboard.type('모터 교체');
  await chooseIssue(page, '와이파이 재연결');
  await page.locator('#reportForm [data-act="choose"][data-value="완료"]').click();
  await expect(field(page, '조치 내용')).toHaveValue('• 로더 교체 → 모터 교체\n• 와이파이 재연결 → ');

  // 깐 줄을 지우고 자유롭게 쓰면, 칸을 다시 눌러도 줄을 또 깔지 않는다
  await field(page, '조치 내용').fill('직접 쓴 조치');
  await field(page, '증상 요약').click();
  await field(page, '조치 내용').click();
  await expect(field(page, '조치 내용')).toHaveValue('직접 쓴 조치');
});
