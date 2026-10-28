// v3.40 — 가이드: 로봇마다 항목 만들기 · 이름 바꾸기 · 지우기 / 단계마다 사진 · 영상 여러 개 (영상은 단계마다 합쳐 1분)
const { test, expect, openApp } = require('./fixtures.js');

const tabText = async (sheet, name) => ((await sheet.dump())[name] || []).flat().join(' ');
const jpg = (n) => ({ name: `사진${n}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, n, 0, 0]) });
const mp4 = (n) => ({ name: `영상${n}.mp4`, mimeType: 'video/mp4', buffer: Buffer.alloc(2048, n) });

test('로봇마다 항목 — 만들기 · 그 항목으로 가이드 작성 · 가이드가 있으면 못 지움 · 이름 바꾸기', async ({ page, sheet }) => {
  await openApp(page, '#/guides/m/Gen.1');
  await expect(page.locator('.guide-cat[data-item]')).toHaveCount(3);                 // 기본 셋
  await page.locator('[data-act="cat-edit"]').click();
  await page.locator('[data-act="cat-add"]').click();
  await page.locator('#catName').fill('배터리');
  await page.locator('#modalRoot [data-form="HARDWARE_SOP"]').click();
  await page.locator('#modalRoot [data-make]').click();
  const battery = page.locator('.guide-cat[data-item^="c-"]', { hasText: '배터리' });
  await expect(battery).toHaveClass(/is-on/);                                         // 만든 항목이 골라진다
  await expect.poll(() => tabText(sheet, '가이드 항목'), { timeout: 15000 }).toContain('배터리');
  expect(await tabText(sheet, '가이드 항목')).toContain('교체 절차형');

  await page.locator('#gNew').click();
  await expect(page).toHaveURL(/#\/guides\/new\/HARDWARE_SOP\?model=Gen\.1&cat=c-/);
  await expect(page.locator('[data-pick="type"] .is-on')).toHaveText('배터리');
  await page.locator('#gTitle').fill('배터리 팩 교체');
  await page.locator('textarea[name=stepText]').first().fill('커버를 연다');
  await page.locator('#guideForm button[type=submit]').click();
  await expect(page).toHaveURL(/#\/guides\/[0-9a-f]{6,}$/);
  await expect(page.locator('.gd-crumb')).toContainText('배터리');                       // 위치에 항목 이름
  await expect.poll(() => tabText(sheet, '하드웨어 교체 SOP'), { timeout: 15000 }).toContain('배터리 팩 교체');

  await openApp(page, '#/guides/m/Gen.1');
  await expect(page.locator('.guide-cat.is-on')).toContainText('배터리');              // 고른 항목을 기억한다
  await expect(page.locator('#gList')).toContainText('배터리 팩 교체');
  await page.locator('[data-act="cat-edit"]').click();
  const batteryId = await page.locator('.guide-cat', { hasText: '배터리' }).getAttribute('data-item');
  await page.locator(`[data-act="cat-del"][data-id="${batteryId}"]`).click();
  await page.locator('#modalRoot [data-act="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('지울 수 없습니다');
  await expect(page.locator('.guide-cat', { hasText: '배터리' })).toBeVisible();

  await page.locator(`[data-act="cat-ren"][data-id="${batteryId}"]`).click();
  await page.locator('#promptInput').fill('배터리 · 충전');
  await page.locator('#modalRoot button[type=submit]').click();
  await expect(page.locator('.guide-cat', { hasText: '배터리 · 충전' })).toBeVisible();
  await expect.poll(() => tabText(sheet, '가이드 항목'), { timeout: 15000 }).toContain('배터리 · 충전');
  // 다른 로봇은 기본 셋 그대로 (항목은 로봇마다)
  await openApp(page, '#/guides/m/Gen.2');
  await expect(page.locator('.guide-cat[data-item]')).toHaveCount(3);
});

test('단계 사진 · 영상 여러 개 — 앨범에서 한꺼번에 · 영상은 단계마다 합쳐 1분 · ✕ 로 빼기 · 시트에 여러 줄', async ({ page, sheet }) => {
  await openApp(page, '#/guides/new/HARDWARE_SOP?model=Gen.1');
  await page.locator('#gTitle').fill('사진 여러 장 가이드');
  await page.locator('textarea[name=stepText]').first().fill('부품을 확인한다');
  const pickFiles = async (files) => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-act="step-pick"]').first().click();
    await (await chooser).setFiles(files);
  };
  await pickFiles([jpg(1), jpg(2)]);
  await expect(page.locator('.gm-tile')).toHaveCount(2);
  await pickFiles([mp4(1)]);                                    // 길이를 못 읽는 영상 = 1분으로 센다
  await expect(page.locator('.gm-tile')).toHaveCount(3);
  await pickFiles([mp4(2)]);                                    // 합치면 1분을 넘는다 → 붙지 않는다
  await expect(page.locator('#toasts')).toContainText('1분까지');
  await expect(page.locator('.gm-tile')).toHaveCount(3);
  await page.locator('.gm-tile__del').first().click();          // 첫 사진을 뺀다
  await expect(page.locator('.gm-tile')).toHaveCount(2);
  await page.locator('#guideForm button[type=submit]').click();
  await expect(page).toHaveURL(/#\/guides\/[0-9a-f]{6,}$/);
  await expect(page.locator('.gs-gallery--many > *')).toHaveCount(2);                   // 상세에서 둘 다
  await expect.poll(async () => {
    const rows = (await sheet.dump())['하드웨어 교체 SOP'] || [];
    const head = rows.find((r) => r.includes('단계 사진')) || [];
    const line = rows.find((r) => r.join(' ').includes('사진 여러 장 가이드')) || [];
    return String(line[head.indexOf('단계 사진')] || '').split('\n').filter((x) => x.startsWith('1. ')).length;
  }, { timeout: 15000 }).toBe(2);
});
