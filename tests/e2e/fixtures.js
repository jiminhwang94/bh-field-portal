// 화면 검사 공용 준비물 — 테스트 모드로 연 앱 · 가짜 시트 읽기 · 팀 시트 차단.
const { test: base, expect } = require('@playwright/test');

const SHEET = 'http://127.0.0.1:8791';

const test = base.extend({
  /** 가짜 시트 — 검사마다 빈 시트에서 시작한다. */
  sheet: async ({ request }, use) => {
    await request.post(`${SHEET}/__reset`);
    await use({
      /** 탭 이름 → 줄 배열 */
      dump: async () => (await request.get(`${SHEET}/__dump`)).json(),
      call: async (body) => (await request.post(`${SHEET}/exec`, { data: body })).json(),
    });
  },
  page: async ({ page, sheet }, use) => {
    void sheet; // 시트를 먼저 비운다
    // 팀 시트(구글)로 가는 요청은 무조건 막는다 — 설정이 어떻게 꼬여도.
    const leaks = [];
    await page.route(/script\.google(usercontent)?\.com/, (route) => {
      leaks.push(route.request().url());
      return route.abort();
    });
    await page.addInitScript((url) => {
      localStorage.setItem('bh_test_mode', JSON.stringify({ on: true, url }));
      localStorage.setItem('bh_device_name', '검사봇');
    }, `${SHEET}/exec`);
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await use(page);
    expect(leaks, '팀 시트로 요청이 나가면 안 된다').toEqual([]);
    expect(errors, '화면 코드 오류가 없어야 한다').toEqual([]);
  },
});


/** 앱을 열고 첫 화면이 그려질 때까지 기다린다. */
async function openApp(page, hash = '#/') {
  await page.goto(`/${hash}`);
  await expect(page.locator('#view')).not.toBeEmpty();
}

module.exports = { test, expect, openApp, SHEET };
