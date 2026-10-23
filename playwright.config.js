// 화면 검사(E2E) — 실제 브라우저로 앱을 눌러 본다.
//
// 두 서버를 함께 띄운다: 화면 서버(server.py)와 가짜 시트 서버(tools/fake_sheet_server.mjs).
// 앱은 테스트 모드로 열려 가짜 시트에만 적는다. 팀 시트 주소로 가는 요청은 막아 둔다
// (tests/e2e/fixtures.mjs). 그래서 저장 · 삭제 버튼을 마음껏 누른다.
//
// 실행: npx playwright test            (개발 PC 에서는 설치된 Edge 를 쓴다)
//       npx playwright test --headed   (눌리는 모습을 보면서)
// CommonJS 로 둔다 — Playwright 1.52 + Node 24 에서 ESM 설정 파일은 불러오다 멈춘다.
const { defineConfig } = require('@playwright/test');

const APP_PORT = 8788;
const SHEET_PORT = 8791;

module.exports = defineConfig({
  testDir: 'tests/e2e',
  testMatch: /\.spec\.js$/,
  fullyParallel: false,          // 가짜 시트 하나를 함께 쓰므로 차례로
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    // CI 는 받아 둔 크로미움, 개발 PC 는 이미 깔린 Edge (따로 받지 않는다)
    channel: process.env.CI ? undefined : 'msedge',
    serviceWorkers: 'block',     // 옛 화면 파일이 끼어들지 않게
    viewport: { width: 1180, height: 820 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'tablet', use: { viewport: { width: 1180, height: 820 } } },
    { name: 'phone', use: { viewport: { width: 375, height: 812 }, isMobile: false }, testMatch: /smoke.spec.js$/ },
  ],
  webServer: [
    {
      command: `python server.py --port ${APP_PORT} --host 127.0.0.1`,
      url: `http://127.0.0.1:${APP_PORT}/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `node tools/fake_sheet_server.mjs --port ${SHEET_PORT}`,
      url: `http://127.0.0.1:${SHEET_PORT}/__dump`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
