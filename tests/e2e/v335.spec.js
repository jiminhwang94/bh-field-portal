// v3.35 현장 우선 (A안) — 세 개의 문 · 단계식 리포트 · 이어 쓰기 · 이력 카드 · 지난번 · 한 단계씩 가이드.
const { test, expect, openApp, pick } = require('./fixtures.js');
const { seed, NOW, GUIDES } = require('./seed.js');

const field = (page, label) => page.locator('#reportForm .field', {
  has: page.locator('label', { hasText: label }),
}).locator('input, select, textarea').first();

/** 단계식으로 연다 (검사 준비물은 기본으로 [한 번에 보기] 를 켠다) */
async function stepMode(page) {
  await page.addInitScript(() => localStorage.setItem('bh_report_mode', 'step'));
}

function monthRows(dump) {
  const name = Object.keys(dump).find((n) => /^\d{4}-\d{2}$/.test(n));
  return name ? dump[name] : [];
}

/** 같은 로봇(SN-0009) 에서 E-101 이 두 번 난 이력 */
async function seedRepeat(sheet) {
  const headers = ['작성일시', '작성자', '리포트 번호', '매장명', '로봇 시리얼', '로봇 모델', '오류 코드',
    '증상 요약', '조치 내용', '처리 결과', '현장 사진', '상태'];
  await sheet.call({ sheetName: '2026-10', headers,
    row: ['2026-10-03 10:00', '검사봇', 'P261003-01', '옥동식 서초점', 'SN-0009', 'Gen.1(D1)', 'E-101',
      '로더가 멈춤', '벨트 장력 조정', '완료', '', '조치 완료'] });
  await sheet.call({ sheetName: '2026-10', headers,
    row: ['2026-10-21 10:00', '검사봇', 'P261021-09', '옥동식 서초점', 'SN-0009', 'Gen.1(D1)', 'E-101',
      '로더가 또 멈춤', '커넥터 재체결', '모니터링', '', '조치 진행 중'] });
}

test('홈 — 새 리포트 · 이력 · 가이드 세 문이 중요한 차례대로, 운행일지 · 재고는 아래 작은 줄', async ({ page, sheet }) => {
  await seed(sheet);
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/');
  const doors = page.locator('.home3 > .door');
  await expect(doors).toHaveCount(3);
  await expect(doors.nth(0)).toHaveClass(/door--new/);
  await expect(doors.nth(1)).toHaveClass(/door--hist/);
  await expect(doors.nth(2)).toHaveClass(/door--guide/);
  await expect(page.locator('.home3__more .more-tile')).toHaveCount(3);
  // 새 리포트 문은 왼쪽 절반을 다 쓴다 (가장 크다)
  const big = await page.locator('.door--new').boundingBox();
  const hist = await page.locator('.door--hist').boundingBox();
  expect(big.height).toBeGreaterThan(hist.height * 1.8);
  await page.locator('.door--new .door__main').click();
  await expect(page).toHaveURL(/#\/report\/new$/);
});

test('새 리포트 단계식 — 접수 카드 → 로봇 → 문제 → 사진 → 조치 · 결과 → 확인 → 올리면 시트에 한 줄', async ({ page, sheet }) => {
  await stepMode(page);
  await openApp(page, '#/report/new');
  await expect(page.locator('.rf')).toHaveAttribute('data-mode', 'step');
  await expect(page.locator('.wz-ask h2')).toHaveText('어느 접수 건인가요?');
  // 다른 단계 칸은 보이지 않는다
  await expect(field(page, '로봇 시리얼')).toBeHidden();
  await pick(page, '리포트 번호', 'P260912-01');
  await expect(field(page, '매장명')).toHaveValue('홍기와');

  await page.locator('[data-act="step-next"]').click();
  await expect(page.locator('.wz-ask h2')).toHaveText('어느 로봇인가요?');
  await expect(page.locator('.wz-ctx')).toContainText('홍기와');           // 고른 것이 위에 남는다
  await field(page, '로봇 시리얼').fill('SN-STEP-1');
  await field(page, '로봇 시리얼').press('Enter');                      // 자판의 '다음' = 다음 단계
  await expect(page.locator('.wz-ask h2')).toHaveText('무엇이 문제인가요?');
  await page.locator('[data-act="step-prev"]').click();
  await pick(page, '로봇 모델', 'Gen.1(D1)');
  await page.locator('[data-act="step-next"]').click();

  await field(page, '증상 요약').fill('단계식 증상');
  await page.locator('[data-act="step-next"]').click();
  await expect(page.locator('.wz-ask h2')).toHaveText('현장 사진을 찍으세요');
  await expect(page.locator('#wzSaved')).toContainText('저절로 저장됨');   // 단계를 옮길 때마다 기기에 담는다
  await page.locator('[data-act="step-next"]').click();
  await field(page, '조치 내용').fill('단계식 조치');
  await pick(page, '처리 결과', '완료');
  await page.locator('[data-act="step-next"]').click();

  await expect(page.locator('.wz-ask h2')).toHaveText('확인하고 올리기');
  await expect(page.locator('.wz-check')).toContainText('SN-STEP-1');
  await expect(page.locator('.wz-check__sec.is-missing')).toHaveCount(0);
  await page.locator('#reportForm button[type=submit]').click();
  await expect.poll(async () => monthRows(await sheet.dump()).flat().join(' '), { timeout: 15000 })
    .toContain('단계식 조치');
});

test('빈 필수 칸으로 올리면 [확인] 단계에서 어느 단계가 비었는지 보인다', async ({ page }) => {
  await stepMode(page);
  await openApp(page, '#/report/new');
  await pick(page, '리포트 번호', 'P260912-01');
  await page.locator('#btn-topaction').click();                          // 위의 [구글 시트로 업로드]
  await expect(page.locator('.wz-ask h2')).toHaveText('확인하고 올리기');
  await expect(page.locator('.wz-check__sec.is-missing').first()).toContainText('로봇');
  await page.locator('.wz-check__sec.is-missing [data-act="step-go"]').first().click();
  await expect(page.locator('.wz-ask h2')).toHaveText('어느 로봇인가요?');
});

test('쓰다 둔 리포트는 홈의 [이어 쓰기] 로 그대로 다시 연다', async ({ page }) => {
  await stepMode(page);
  await openApp(page, '#/report/new');
  await pick(page, '리포트 번호', 'P260912-01');
  await page.locator('[data-act="step-next"]').click();
  await field(page, '로봇 시리얼').fill('SN-RESUME');
  await page.locator('[data-act="step-next"]').click();
  await expect(page.locator('#wzSaved')).toContainText('저절로 저장됨');
  await openApp(page, '#/');
  const resume = page.locator('.door__row--resume');
  await expect(resume).toContainText('홍기와');
  await resume.click();
  await expect(page).toHaveURL(/#\/report\/new\?draft=/);
  await page.locator('[data-act="step-go"][data-go="robot"]').first().click();
  await expect(field(page, '로봇 시리얼')).toHaveValue('SN-RESUME');
});

test('이력 카드 — 증상 · 조치가 보이고, 같은 로봇 같은 코드면 몇 번째인지 · 상세에 이 로봇 지난번', async ({ page, sheet }) => {
  await seedRepeat(sheet);
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');
  const card = page.locator('.hist-row', { hasText: '로더가 또 멈춤' });
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card.locator('.hist-row__story')).toContainText('커넥터 재체결');
  await expect(card.locator('.hist-row__repeat')).toHaveText('이 로봇에서 E-101 2번째');
  await card.click();
  const past = page.locator('#modalRoot .past');
  await expect(past).toContainText('이 로봇 지난번');
  await expect(past.locator('.past__warn')).toContainText('지난번 조치: 벨트 장력 조정');
});

test('가이드 — 한 단계씩 [다 했어요] 로 넘기고, 끝나면 마친 단계가 조치 칸에 들어간 리포트로', async ({ page, sheet }) => {
  await seed(sheet);
  await seedRepeat(sheet);
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');                                         // 이력을 받아 둔다
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
  await openApp(page, '#/guides');
  await openApp(page, `#/guides/${GUIDES[0].id}?store=${encodeURIComponent('옥동식 서초점')}&serial=SN-0009`);
  await expect(page.locator('.gs-no')).toHaveText('1 / 2');
  await expect(page.locator('.gs-instr')).toContainText('커넥터 CN3');
  await expect(page.locator('#gdPast .past__warn')).toContainText('3번째');  // 이번이 E-101 세 번째
  await page.locator('[data-act="done-next"]').click();
  await expect(page.locator('.gs-no')).toHaveText('2 / 2');
  await expect(page.locator('.gs-item.is-done')).toHaveCount(1);
  await expect(page.locator('[data-act="done-next"]')).toHaveText('완료');    // 마지막 단계는 [완료]
  await page.locator('[data-act="write-report"]').click();                 // 리포트는 위 버튼으로
  await expect(page).toHaveURL(/#\/report\/new$/);
  await expect(field(page, '매장명')).toHaveValue('옥동식 서초점');
  await expect(field(page, '로봇 시리얼')).toHaveValue('SN-0009');
  await expect(field(page, '오류 코드')).toHaveValue('E-101');
  await expect(field(page, '조치 내용')).toHaveValue(/커넥터 CN3/);       // 마친 단계만 들어간다
  // 마지막 단계에서 [완료] → 그 로봇의 가이드 목록으로 돌아간다
  await openApp(page, `#/guides/${GUIDES[0].id}`);
  await page.locator('[data-act="go-step"][data-idx="1"]').click();
  await page.locator('[data-act="done-next"]').click();
  await expect(page).toHaveURL(/#\/guides\/m\/Gen\.1$/);
  // 다시 열면 처음부터 — 마친 기록이 남지 않는다
  await openApp(page, `#/guides/${GUIDES[0].id}`);
  await expect(page.locator('.gs-no')).toHaveText('1 / 2');
  await expect(page.locator('.gs-item.is-done')).toHaveCount(0);
});

test('시트에서 한꺼번에 지운 가이드가 기기에 남으면 — 가이드 첫 화면에서 지우거나 다시 올린다', async ({ page, sheet }) => {
  // 로봇 미지정 가이드 8건이 시트에 있다
  const many = Array.from({ length: 8 }, (_, i) => ({
    id: `b1b2c3d4e5f6000${i}`, categoryType: 'ERROR_CODE', robotModel: '', codeOrTitle: `E-9${i}0 옛 가이드 ${i}`,
    summary: '', requiredTools: '', commands: [], steps: [{ instruction: '확인한다', expectedMetric: '' }],
    updatedAt: '2026-09-07T10:00:00' }));
  await sheet.call({ guides: 'push', items: many });
  await openApp(page, '#/guides');
  await expect(page.locator('.rband--none')).toContainText('8', { timeout: 15000 });
  // 누군가 시트에서 5건을 한꺼번에 지웠다 (절반 넘게 — 기기는 안전하게 바로 지우지 않는다)
  await sheet.call({ guides: 'push', items: many.slice(0, 3) });
  await openApp(page, '#/guides');
  await page.locator('#btn-update').click();                                // 받기
  await openApp(page, '#/guides');
  const band = page.locator('.gh-orphans');
  await expect(band).toContainText('시트에 없는 가이드 5건', { timeout: 15000 });
  await band.locator('[data-act="orphans-drop"]').click();
  await page.locator('#modalRoot [data-act="ok"]').click();
  await expect(page.locator('.gh-orphans')).toHaveCount(0);
  await expect(page.locator('.rband--none')).toContainText('3');            // 기기에서도 사라졌다
});

test('재고 — 줄에서 바로 +/− · 맨 위 보충 필요 띠를 누르면 부족한 것만', async ({ page, sheet }) => {
  await seed(sheet);
  await openApp(page, '#/inventory');
  const row = page.locator('.inv-card', { hasText: '그리퍼 실리콘 패드' });
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.inv-alert')).toContainText('보충 필요');
  await row.locator('.inv-step__btn--plus').click();                        // 창을 열지 않고 줄에서
  await expect(row.locator('.inv-qty')).toHaveText('2');
  await page.locator('.inv-alert').click();
  await expect(page.locator('.inv-card')).toHaveCount(1);
});

test('운행일지 — 맨 위 [오늘 운행 기록] · 기록은 카드로 (출발 → 도착 · 주행거리)', async ({ page, sheet }) => {
  await seed(sheet);                                                         // 차량은 재고에서 온다
  await openApp(page, '#/inventory');
  await expect(page.locator('.inv-card').first()).toBeVisible({ timeout: 15000 });
  await openApp(page, '#/driving');
  await expect(page.locator('.drv-hero')).toBeVisible();
  await page.locator('.drv-hero__add').click();
  await page.locator('#drvBefore').fill('1,000');
  await page.locator('#drvAfter').fill('1,042');
  await page.locator('#drvFrom').fill('언주사무실');
  await page.locator('#drvTo').fill('옥동식 서초점');
  await page.locator('#drvForm button[type=submit]').click();
  const card = page.locator('.drv-card').first();
  await expect(card.locator('.drv-card__route')).toContainText('언주사무실');
  await expect(card.locator('.drv-card__km b')).toHaveText('42');
  await expect(page.locator('.drv-hero__stats .is-done')).toContainText('1건');
});

test('이력 카드 아래 [가이드] · 가이드 첫 화면에 최근 이력의 코드', async ({ page, sheet }) => {
  await seed(sheet);
  await seedRepeat(sheet);
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');
  const card = page.locator('.hist-card', { hasText: '로더가 또 멈춤' });
  await expect(card.locator('.hist-card__guide')).toContainText('E-101', { timeout: 15000 });
  await openApp(page, '#/guides');
  await expect(page.locator('.gh-code').first()).toContainText('E-101');
  await page.locator('.gh-code').first().click();
  await expect(page.locator('.gs-no')).toHaveText('1 / 2');
});

test('오류 코드 가이드 제목 — 맨 앞이 코드 모양일 때만 파란 코드 칸으로 나눈다', async ({ page, sheet }) => {
  await sheet.call({ guides: 'push', items: [
    { id: 'c1c2c3d4e5f60001', categoryType: 'ERROR_CODE', robotModel: 'Gen.1', codeOrTitle: '[SocketManager] Client connection Failed.',
      summary: '', requiredTools: '', commands: [], steps: [{ instruction: '재연결한다', expectedMetric: '' }], updatedAt: '2026-10-26T10:00:00' },
    { id: 'c1c2c3d4e5f60002', categoryType: 'ERROR_CODE', robotModel: 'Gen.1', codeOrTitle: 'E-101 로더 모터 과전류',
      summary: '', requiredTools: '', commands: [], steps: [{ instruction: '확인한다', expectedMetric: '' }], updatedAt: '2026-10-26T10:00:00' },
  ] });
  await openApp(page, '#/guides/m/Gen.1/ERROR_CODE');
  const sock = page.locator('.guide-row', { hasText: 'SocketManager' });
  await expect(sock).toBeVisible({ timeout: 15000 });
  await expect(sock.locator('.row__code')).toHaveCount(0);
  await expect(sock.locator('.row__title')).toHaveText('[SocketManager] Client connection Failed.');
  await expect(page.locator('.guide-row', { hasText: '로더 모터' }).locator('.row__code')).toHaveText('E-101');
  await sock.click();
  await expect(page.locator('.gd-code')).toHaveCount(0);
  await expect(page.locator('.gd-title h1')).toHaveText('[SocketManager] Client connection Failed.');
});

test('가이드 편집 — 단계가 명령어보다 위 · 명령어는 접혀 있다가 펼친다', async ({ page }) => {
  await openApp(page, '#/guides/new');
  const panels = page.locator('#guideForm > .panel, #guideForm > details.panel');
  await expect(panels.nth(1)).toContainText('단계');
  await expect(panels.nth(2)).toHaveId('cmdFold');
  await expect(page.locator('#cmdFold')).not.toHaveAttribute('open', '');
  await page.locator('#cmdFold > summary').click();
  await page.locator('[data-act="add-cmd"]').click();
  await expect(page.locator('#cmdFold')).toHaveAttribute('open', '');      // 다시 그려도 펼친 채
  await expect(page.locator('[name=cmdText]')).toHaveCount(1);
});

test('가이드 단계에 여러 줄을 쓰면 시트를 다녀와도 한 단계로 남는다', async ({ page, sheet }) => {
  await openApp(page, '#/guides/new/HARDWARE_SOP');
  await page.locator('#gTitle').fill('여러 줄 단계 검사');
  await page.locator('textarea[name=stepText]').first().fill('덮개를 연다\n나사 4개를 푼다');
  await page.locator('#guideForm button[type=submit]').click();
  await expect(page).toHaveURL(/#\/guides\/[0-9a-f]{6,}$/);
  // 시트에 올라간 뒤 받아 와도
  await expect.poll(async () => JSON.stringify(await sheet.dump()), { timeout: 15000 }).toContain('여러 줄 단계 검사');
  await page.locator('#btn-update').click();
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator('.gs-no')).toHaveText('1 / 1');
  await expect(page.locator('.gs-instr')).toContainText('나사 4개를 푼다');
});
