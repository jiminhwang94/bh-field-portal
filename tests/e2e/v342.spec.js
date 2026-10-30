// v3.42 — 3C: 증상(이슈 유형을 증상 칸 안에서) → 원인 → 조치. 원인 · 조치는 그 이슈의 목록에서 고른다.
const { test, expect, openApp, pick } = require('./fixtures.js');
const { seed, GUIDES } = require('./seed.js');

const SHOTS = process.env.SHOTS || '';
const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: new RegExp(`^${label}`) }),
}).locator('input, select, textarea').first();
const box = (page, label) => page.locator('#reportForm .field', { has: page.locator('label', { hasText: new RegExp(`^${label}`) }) });
const rowsOf = async (sheet, name) => ((await sheet.dump())[name] || []).slice(2);
const cellOf = (rows, header, has) => {
  const head = rows.find((r) => r.includes(header)) || [];
  const line = rows.find((r) => r.join(' ').includes(has)) || [];
  return line[head.indexOf(header)];
};

async function seedWork(sheet) {
  await sheet.call({ work: 'push', ops: [
    { op: 'cat-add', kind: '로봇 이슈', name: '로더' },
    { op: 'cat-add', kind: '로봇 외 이슈', name: '네트워크 · 와이파이' },
    { op: 'item-upsert', item: { id: 'wk-stop', kind: '로봇 이슈', cat: '로더', name: '로더 멈춤', aliases: [],
      guides: [GUIDES[0].id], causes: ['커넥터 접촉 불량', '모터 과부하'], actions: ['커넥터 재체결', '로더 교체'] } },
    { op: 'item-upsert', item: { id: 'wk-wifi', kind: '로봇 외 이슈', cat: '네트워크 · 와이파이', name: 'Wi-Fi 연결 실패',
      aliases: [], guides: [], causes: ['공유기 꺼짐'], actions: ['공유기 재부팅'] } },
  ] });
}

async function chooseIssue(page, name) {
  await page.locator('#workHelper [data-act="open-work"]').click();
  const modal = page.locator('#modalRoot .wk');
  await modal.locator('#wkQ').fill(name);
  await modal.locator('.wk-item', { hasText: name }).first().click();
  await modal.locator('[data-act="wk-done"]').click();
}

const chip = (page, label, name, value) => box(page, label).locator('.c3-row', { hasText: name })
  .locator('.c3-chip', { hasText: value });

test('증상 칸 안에서 이슈 유형을 고르고 → 증상마다 원인 · 조치를 고른다 → 시트에 증상별 한 줄씩', async ({ page, sheet }) => {
  await seed(sheet);
  await seedWork(sheet);
  await openApp(page, '#/');
  await page.waitForTimeout(1500);                                   // 이슈 유형 목록을 받아 둔다
  await openApp(page, '#/report/new');
  // 이슈 유형은 따로 칸이 없고 증상 칸 안에 있다
  await expect(box(page, '이슈 유형')).toBeHidden();
  await expect(box(page, '증상 요약').locator('#workHelper [data-act="open-work"]')).toBeVisible();
  // 이슈를 고르기 전에는 원인 · 조치가 여러 줄 칸
  await expect(box(page, '원인').locator('textarea')).toBeVisible();

  await chooseIssue(page, '로더 멈춤');
  await chooseIssue(page, 'Wi-Fi 연결 실패');
  await field(page, '증상 요약').fill('아침 영업 전부터');
  // 원인 — 증상마다 한 줄, 그 이슈의 목록 + [원인 모름] + [＋ 직접]
  await expect(box(page, '원인').locator('.c3-row')).toHaveCount(2);
  await expect(chip(page, '원인', '로더 멈춤', '원인 모름')).toBeVisible();
  await expect(chip(page, '원인', 'Wi-Fi 연결 실패', '모터 과부하')).toHaveCount(0);   // 다른 이슈의 원인은 안 나온다
  await chip(page, '원인', '로더 멈춤', '모터 과부하').click();
  await chip(page, '원인', '로더 멈춤', '커넥터 접촉 불량').click();                     // 원인은 하나 — 바꿔 고른다
  await expect(chip(page, '원인', '로더 멈춤', '모터 과부하')).not.toHaveClass(/is-on/);
  await chip(page, '원인', 'Wi-Fi 연결 실패', '원인 모름').click();
  // 조치 — 여러 개 · 메모
  await chip(page, '조치 내용', '로더 멈춤', '커넥터 재체결').click();
  await chip(page, '조치 내용', '로더 멈춤', '로더 교체').click();
  await box(page, '조치 내용').locator('.c3-row', { hasText: '로더 멈춤' }).locator('.c3-memo').fill('CN3 빠져 있었음');
  await chip(page, '조치 내용', 'Wi-Fi 연결 실패', '공유기 재부팅').click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3c-all.png`, fullPage: true });

  await pick(page, '고객사 리포트', 'P260912-01');
  await field(page, '로봇 시리얼').fill('SN-3C');
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await pick(page, '처리 결과', '완료');
  await page.locator('#reportForm button[type=submit]').click();
  const month = async () => (await sheet.dump())['2026-10'] || [];           // 머리줄까지 (rowsOf 는 위 두 줄을 뗀다)
  await expect.poll(async () => cellOf(await month(), '원인', 'SN-3C'), { timeout: 15000 })
    .toBe('로더 멈춤: 커넥터 접촉 불량\nWi-Fi 연결 실패: 원인 모름');
  const rows = await month();
  expect(cellOf(rows, '조치 내용', 'SN-3C')).toBe('로더 멈춤: 커넥터 재체결, 로더 교체 — CN3 빠져 있었음\nWi-Fi 연결 실패: 공유기 재부팅');
  expect(cellOf(rows, '증상 요약', 'SN-3C')).toBe('로더 멈춤\nWi-Fi 연결 실패\n아침 영업 전부터');
  expect(cellOf(rows, '이슈 유형', 'SN-3C')).toContain('로봇 이슈 › 로더 › 로더 멈춤');

  // 이력 상세 — 증상 · 원인 · 조치가 차례로
  await openApp(page, '#/reports');
  await page.locator('.hist-row', { hasText: '홍기와' }).first().click({ timeout: 15000 });
  const cause = page.locator('#modalRoot .hd2-row[data-sec="cause"]');
  await expect(cause).toContainText('로더 멈춤: 커넥터 접촉 불량');
});

test('목록에 없는 원인은 [＋ 직접] — 고른 것이 되고 팀 목록(시트)에도 더해진다', async ({ page, sheet }) => {
  await seed(sheet);
  await seedWork(sheet);
  await openApp(page, '#/');
  await page.waitForTimeout(1500);
  await openApp(page, '#/report/new');
  await chooseIssue(page, '로더 멈춤');
  await box(page, '원인').locator('.c3-row', { hasText: '로더 멈춤' }).locator('[data-act="c3-add"]').click();
  await page.locator('#modalRoot input').fill('와이어 걸림');
  await page.locator('#modalRoot [type="submit"]').click();
  await expect(chip(page, '원인', '로더 멈춤', '와이어 걸림')).toHaveClass(/is-on/);
  await expect.poll(async () => {
    const r = (await rowsOf(sheet, '이슈 유형 목록')).find((x) => x[2] === '로더 멈춤');
    return r ? r[7] : '';
  }, { timeout: 15000 }).toContain('와이어 걸림');
});

test('단계식 — 증상 → 사진 → 원인 → 조치 · 결과', async ({ page, sheet }) => {
  await seed(sheet);
  await seedWork(sheet);
  await page.addInitScript(() => localStorage.setItem('bh_report_mode', 'step'));
  await openApp(page, '#/');
  await page.waitForTimeout(1500);
  await openApp(page, '#/report/new');
  const steps = await page.locator('.wz-steps li').allTextContents();
  const order = ['증상', '사진', '원인', '조치'].map((s) => steps.findIndex((x) => x.includes(s)));
  expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
  await page.locator('.wz-steps [data-go="problem"]').click();
  await chooseIssue(page, '로더 멈춤');
  await page.locator('.wz-steps [data-go="cause"]').click();
  await expect(page.locator('.wz-ask h2')).toContainText('왜 그랬나요');
  await expect(chip(page, '원인', '로더 멈춤', '커넥터 접촉 불량')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3c-step-cause.png` });
  await page.locator('.wz-steps [data-go="fix"]').click();
  await expect(chip(page, '조치 내용', '로더 멈춤', '커넥터 재체결')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3c-step-fix.png` });
});

test('지난번에 고른 조치도 버튼으로 나온다 (팀 목록에 없어도)', async ({ page, sheet }) => {
  await seed(sheet);
  await seedWork(sheet);
  const H = ['작성일시', '작성자', '리포트 번호', '매장명', '로봇 시리얼', '로봇 모델', '이슈 유형', '증상 요약', '원인', '조치 내용', '처리 결과', '상태'];
  await sheet.call({ sheetName: '2026-10', headers: H, row: ['2026-10-20 09:00', '검사봇', 'P261020-01', '지난점', 'SN-OLD',
    'Gen.1(D1)', '로봇 이슈 › 로더 › 로더 멈춤', '로더 멈춤', '로더 멈춤: 모터 과부하', '로더 멈춤: 텐셔너 볼트 재체결', '완료', '조치 완료'] });
  await openApp(page, '#/reports');                                   // 이력을 받아 둔다
  await expect(page.locator('#view')).toContainText('지난점', { timeout: 15000 });
  await openApp(page, '#/report/new');
  await chooseIssue(page, '로더 멈춤');
  await expect(chip(page, '조치 내용', '로더 멈춤', '텐셔너 볼트 재체결')).toBeVisible();
});
