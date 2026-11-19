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
      // 새 리포트는 기본이 단계식이다 (v3.35). 칸을 한꺼번에 채우는 예전 검사는 [한 번에 보기] 로 연다.
      // 단계식 검사(v335.spec.js)는 'step' 을 따로 넣는다.
      if (!localStorage.getItem('bh_report_mode')) localStorage.setItem('bh_report_mode', 'all');
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

/**
 * 큰 버튼으로 고르는 칸 (v3.35) — 고객사 리포트(접수 카드, v3.39 전에는 리포트 번호) · 로봇 모델 · 처리 결과.
 * 예전 셀렉트의 selectOption 자리에 쓴다.
 */
async function pick(page, label, value) {
  const box = page.locator('#reportForm .field', { has: page.locator('label', { hasText: label }) });
  await box.locator(`[data-value="${value}"]`).first().click();
}

/**
 * [새로고침] 을 누르고 **끝날 때까지** 기다린다.
 * 끝나면 화면을 한 번 새로 그린다 — 그 전에 거르기 · 입력을 하면 다시 그리면서 풀린다.
 * (CI 처럼 느린 곳에서 그 순서가 뒤집혀 시험이 흔들렸다)
 */
async function refreshAndWait(page) {
  await page.locator('#btn-update').click();
  await expect(page.locator('#btn-update')).toBeEnabled({ timeout: 20000 });
  await expect(page.locator('#btn-update')).not.toHaveText('받는 중…', { timeout: 20000 });
  await page.waitForTimeout(300);                 // 다시 그리기(hashchange)가 끝나게
}

module.exports = { test, expect, openApp, pick, refreshAndWait, SHEET };
