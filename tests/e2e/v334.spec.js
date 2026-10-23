// v3.34 — 통계: A안 한 장 요약 · C안 자세히 · 카드 편집(빼기 · 순서 · 추가 · 만들기)
const { test, expect, openApp } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

const H = ['작성일시', '작성자', '리포트 번호', '매장명', '로봇 시리얼', '로봇 모델', '이슈 유형',
  '증상 요약', '조치 내용', '처리 결과', '상태'];
const LOADER = '로봇 이슈 › 하드웨어 교체 › 로더 교체';
const WIFI = '로봇 외 이슈 › 네트워크 › 와이파이 재연결';

async function seedStats(sheet) {
  await seed(sheet);                                           // 10월 3건
  const nl = String.fromCharCode(10);
  await sheet.call({ sheetName: '2026-10', headers: H, row: ['2026-10-20 10:00', '검사봇', 'P4', '통계점', 'S4', 'Gen.1(D1)',
    LOADER + nl + WIFI, '로더 · 와이파이', '교체 · 재연결', '완료', '조치 완료'] });          // 두 개 고른 리포트
  await sheet.call({ sheetName: '2026-10', headers: H, row: ['2026-10-18 10:00', '검사봇', 'P5', '통계점', 'S5', 'Gen.1(D1)',
    LOADER, '로더', '교체', '완료', '조치 완료'] });
  await sheet.call({ sheetName: '2026-09', headers: H, row: ['2026-09-10 10:00', '검사봇', 'P6', '지난점', 'S6', 'Gen.1(D1)',
    WIFI, '와이파이', '재연결', '완료', '조치 완료'] });
}

async function warm(page) {
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
}

test('요약 — 큰 숫자 · 지난 기간과 비교 · 처리 상태 막대 · 기본 카드 넷 · 여러 이슈 유형은 하나씩 센다', async ({ page, sheet }) => {
  await seedStats(sheet);
  await warm(page);
  await openApp(page, '#/stats?m=1');
  await expect(page.locator('.sx-big__n')).toContainText('5');                       // 10월 5건
  await expect(page.locator('.sx-big__delta')).toContainText('지난달보다 4건 많음');     // 9월 1건
  await expect(page.locator('.sx-status__legend')).toContainText('조치 완료');
  await expect(page.locator('.sx-grid .sx-card__title')).toHaveText(['이슈 유형', '달마다 건수', '로봇 모델', '많이 쓴 부품']);
  const issue = page.locator('.sx-card[data-card="issue"]');
  await expect(issue.locator('.sx-bar', { hasText: '로더 교체' }).locator('.sx-bar__n')).toContainText('2');
  await expect(issue.locator('.sx-bar', { hasText: '와이파이 재연결' }).locator('.sx-bar__n')).toContainText('1');
});

test('카드 편집 — 빼기 · 순서 바꾸기 · 있는 카드 넣기 · 리포트 칸으로 새로 만들기 · 다시 열어도 그대로', async ({ page, sheet }) => {
  await seedStats(sheet);
  await warm(page);
  await openApp(page, '#/stats?m=1');
  await page.locator('[data-act="sx-edit"]').click();
  await page.locator('.sx-card[data-card="parts"] [data-act="sx-remove"]').click();
  await page.locator('.sx-card[data-card="model"] [data-act="sx-move"][data-dir="-1"]').click();
  await expect(page.locator('.sx-grid .sx-card__title')).toHaveText(['이슈 유형', '로봇 모델', '달마다 건수']);
  await page.locator('[data-act="sx-add"]').click();
  await page.locator('#modalRoot [data-add="store"]').click();
  await expect(page.locator('.sx-card[data-card="store"]')).toContainText('통계점');
  await page.locator('[data-act="sx-add"]').click();
  await page.locator('#modalRoot #sxField').selectOption('처리 결과');
  await page.locator('#modalRoot #sxTitle').fill('처리 결과 비율');
  await page.locator('#modalRoot [data-view="share"]').click();
  await page.locator('#modalRoot [data-make]').click();
  const made = page.locator('.sx-card', { hasText: '처리 결과 비율' });
  await expect(made.locator('.sx-legend')).toContainText('완료');
  await page.locator('[data-act="sx-edit"]').click();                                   // 편집 끝
  await page.reload();
  await expect(page.locator('.sx-grid .sx-card__title'))
    .toHaveText(['이슈 유형', '로봇 모델', '달마다 건수', '방문이 많은 매장', '처리 결과 비율']);
});

test('자세히 — 카드의 [자세히 ›] 로 그 항목이 골라진 채 · 왼쪽에서 바꾸기 · 비율 · 달마다 표', async ({ page, sheet }) => {
  await seedStats(sheet);
  await warm(page);
  await openApp(page, '#/stats?m=3');
  await page.locator('.sx-card[data-card="issue"] .sx-card__more').click();
  await expect(page).toHaveURL(/v=detail&k=issue/);
  await expect(page.locator('.sx-rail__item.is-on')).toContainText('이슈 유형');
  const focus = page.locator('.sx-focus');
  await expect(focus.locator('.sx-bar', { hasText: '로더 교체' }).locator('.sx-bar__n')).toContainText('2 · 50%');
  await expect(focus.locator('.sx-table')).toContainText('9월');
  await expect(focus.locator('.sx-table tbody tr', { hasText: '와이파이 재연결' })).toContainText('1');
  await page.locator('.sx-rail__item', { hasText: '로봇 모델' }).click();
  await expect(page.locator('.sx-focus .sx-card__title')).toHaveText('로봇 모델');
  await page.locator('.sx-head .seg__btn', { hasText: '요약' }).click();
  await expect(page.locator('.sx-big__n')).toBeVisible();
});
