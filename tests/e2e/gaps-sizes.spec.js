// 동작 시험 보강 ⑯ 장갑 낀 손 크기 — 본문 글자 · 버튼 · 입력칸 · 고르기 · 첨부 타일 · 사진 ✕ 의 최소 크기
//
// 화면 비교(styles.spec · style-diff)는 '바뀌었나' 를 본다. 이것은 '현장에서 누를 수 있나' 를 본다 —
// CSS 를 정리하다 크기가 줄어도 비교 기준을 새로 뜨면 그냥 지나간다. 최소값은 여기서 지킨다.
const { test, expect, openApp } = require('./fixtures.js');
const { seed, NOW } = require('./seed.js');

const SCREENS = ['#/', '#/report/new?fresh=1', '#/reports', '#/inventory', '#/guides', '#/driving', '#/settings'];

for (const [w, h, minBtn] of [[1180, 820, 56], [375, 812, 48]]) {
  test(`${w}px — 본문 17px · 버튼 ${minBtn}px · 입력칸 52px 이상 (작은 버튼 표시가 없는 것)`, async ({ page, sheet }) => {
    test.setTimeout(90000);
    await page.clock.setFixedTime(NOW);
    await seed(sheet);
    await page.setViewportSize({ width: w, height: h });
    const small = [];
    for (const hash of SCREENS) {
      await openApp(page, hash);
      await page.waitForTimeout(700);
      const got = await page.evaluate((min) => {
        const out = [];
        const body = parseFloat(getComputedStyle(document.body).fontSize);
        if (body < 17) out.push(`본문 ${body}px`);
        for (const el of document.querySelectorAll('#view .btn, .topbar .btn, #view .input, #view .select')) {
          if (!el.offsetParent || el.closest('.toast, .rf-more__menu, .update-banner')) continue;
          if (el.matches('.btn--sm, .btn-sm, .link-btn')) continue;
          const r = el.getBoundingClientRect();
          const need = el.matches('.input, .select') ? 52 : min;
          if (r.height + 0.5 < need) out.push(`${el.className.split(' ').slice(0, 2).join('.')} "${(el.textContent || el.placeholder || '').trim().slice(0, 12)}" ${Math.round(r.height)}px`);
        }
        return out;
      }, minBtn);
      for (const g of got) small.push(`${hash} ${g}`);
    }
    expect(small).toEqual([]);
  });
}

test('새 리포트 — 고르기 버튼 56px · 첨부 타일 76px · 사진 ✕ 44px 이상', async ({ page }) => {
  await openApp(page, '#/report/new?fresh=1');
  const photo = page.locator('#reportForm .field', { has: page.locator('label', { hasText: '현장 사진' }) });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), photo.locator('[data-act="pick"]').click()]);
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  await expect(page.locator('.media-tile')).toHaveCount(1, { timeout: 10000 });
  const size = await page.evaluate(() => {
    const min = (sel) => Math.min(...[...document.querySelectorAll(sel)].filter((e) => e.offsetParent)
      .map((e) => Math.min(e.getBoundingClientRect().height, e.getBoundingClientRect().width)));
    return { choice: min('.choice-btn'), pick: min('.media-pick__tile'), tile: min('.media-tile'), del: min('.media-tile__del') };
  });
  expect(size.choice).toBeGreaterThanOrEqual(56);
  expect(size.pick).toBeGreaterThanOrEqual(76);
  expect(size.tile).toBeGreaterThanOrEqual(76);
  expect(size.del).toBeGreaterThanOrEqual(44);
});
