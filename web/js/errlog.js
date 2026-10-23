// 현장 오류 모으기 — 현장에서 난 오류를 시트 '오류기록' 탭으로 보낸다.
//
// 예전에는 업로드 실패나 화면 오류가 나도 현장 사람만 보고 끝났다. 개발 쪽은 "안 된다"
// 는 말만 듣고 무엇이 왜 안 됐는지 알 수 없었다.
//
//  - 화면 코드 오류(window.onerror · 처리 안 된 Promise)와 올리기 실패를 기기에 모아 둔다
//  - 시트에 닿을 때 한꺼번에 보낸다 (최대 50건씩). 보내면 기기에서 지운다
//  - 같은 오류가 잇달아 나면 한 번만 적는다 (1분 안 같은 글자)
import * as store from './local/store.js';

const KEY = 'errorLog';
const MAX = 80;
let lastText = '';
let lastAt = 0;

/** 오류 한 건을 기기에 적는다. 절대 던지지 않는다. */
export async function recordError(message, detail = '') {
  try {
    const text = String(message || '').slice(0, 400);
    if (!text) return;
    const now = Date.now();
    if (text === lastText && now - lastAt < 60_000) return;
    lastText = text;
    lastAt = now;
    const list = (await store.getMeta(KEY, [])) || [];
    list.push({
      at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      screen: location.hash || '#/',
      message: text,
      detail: String(detail || '').slice(0, 1500),
    });
    await store.setMeta(KEY, list.slice(-MAX));
  } catch { /* 기록하다 또 실패하면 그냥 둔다 */ }
}

export async function pendingErrors() {
  return ((await store.getMeta(KEY, [])) || []).length;
}

/** 모아 둔 오류를 시트로 보낸다 — 올리기 흐름 끝에서 부른다. */
export async function flushErrors() {
  const list = (await store.getMeta(KEY, [])) || [];
  if (!list.length) return 0;
  const batch = list.slice(0, 50);
  const { callAppsScript } = await import('./sheets.js');
  await callAppsScript({ errors: 'push', items: batch }, 30000);
  const rest = ((await store.getMeta(KEY, [])) || []).slice(batch.length);
  await store.setMeta(KEY, rest);
  return batch.length;
}

/** 화면 코드 오류를 잡는다 — 앱을 열 때 한 번 */
export function initErrorLog() {
  window.addEventListener('error', (ev) => {
    const where = ev.filename ? `${String(ev.filename).split('/').pop()}:${ev.lineno}:${ev.colno}` : '';
    recordError(ev.message || '알 수 없는 오류', [where, ev.error && ev.error.stack].filter(Boolean).join('\n'));
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    // 오프라인은 오류가 아니다 — 연결되면 알아서 올라간다.
    if (r && (r.name === 'OfflineError' || /오프라인/.test(String(r.message || '')))) return;
    recordError(r && r.message ? r.message : String(r), r && r.stack ? r.stack : '');
  });
}
