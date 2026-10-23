// 테스트 모드 — 팀 시트 대신 **연습용 시트**에 적는다.
//
// 켜면 두 가지가 바뀐다.
//   1. 기기 안 저장소(IndexedDB)를 따로 쓴다 — 'bh-field-portal-test'.
//      연습으로 만든 리포트 · 가이드가 진짜 자료와 섞이지 않는다.
//   2. 시트 주소를 테스트 주소로 **강제**한다. 팀 주소로는 절대 보내지 않는다.
//      (테스트 주소가 비어 있으면 아무 데도 보내지 않는다 — 기기 안에서만)
//
// 저장소가 바뀌므로 켜고 끈 뒤에는 앱을 다시 연다(location.reload).
// localStorage 에 두는 이유: IndexedDB 를 열기 **전에** 어느 저장소를 열지 알아야 한다.

const KEY = 'bh_test_mode';

/** @returns {{ on: true, url: string, spreadsheetUrl?: string } | null} */
export function testMode() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    return value && value.on ? { on: true, url: String(value.url || '').trim(),
      spreadsheetUrl: String(value.spreadsheetUrl || '').trim() } : null;
  } catch {
    return null;
  }
}

/** 켜기 — url 은 가짜 시트 서버(http://127.0.0.1:8790/exec) 또는 테스트용 Apps Script 주소 */
export function enableTestMode(url, spreadsheetUrl = '') {
  localStorage.setItem(KEY, JSON.stringify({ on: true, url: String(url || '').trim(), spreadsheetUrl }));
}

export function disableTestMode() {
  localStorage.removeItem(KEY);
}

/** 화면 맨 위 노란 띠 — 테스트 모드인 것을 잊지 않게 늘 보인다. */
export function paintTestBanner() {
  const tm = testMode();
  document.documentElement.toggleAttribute('data-test-mode', Boolean(tm));
  let bar = /** @type {HTMLAnchorElement | null} */ (document.getElementById('test-banner'));
  if (!tm) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = /** @type {HTMLAnchorElement} */ (document.createElement('a'));
    bar.id = 'test-banner';
    bar.className = 'test-banner';
    bar.href = '#/settings';
    document.body.prepend(bar);
  }
  bar.textContent = tm.url
    ? '테스트 모드 — 팀 시트가 아닌 연습용 시트에 적습니다 · 설정에서 끄기'
    : '테스트 모드 — 시트 주소가 없어 기기 안에만 저장합니다 · 설정에서 끄기';
}
