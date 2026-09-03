// [새로고침] — 다른 사람이 바꾼 내용을 구글 시트에서 받아온다.
//
// **올리기는 자동이다.** 재고 수량 · 리포트 · 가이드 · 항목 설정 변경은 인터넷이
// 되는 순간 곧바로 시트로 올라간다 (오프라인이면 대기열에 쌓였다가 연결되면 올라간다).
// 그래서 이 버튼이 하는 일은 하나 — **지금 시트에서 최신 내용을 받아오는 것.**
// 받기도 앱으로 돌아올 때와 5분마다 조용히 자동으로 돌지만, "지금 당장" 보고 싶을 때
// 누른다.
//
// 예전 이름은 [⬆ 업데이트] 였다. 올리기와 받기를 다 하는 것처럼 읽혔는데 올리기는
// 이미 자동이어서, 눌러 봐야 하는 일이 없는 것처럼 느껴졌다. 뜻을 실제 하는 일에 맞췄다.
//
// 상단 칩의 숫자는 **오프라인이거나 올리기가 실패했을 때만** 보인다.
// 정상일 때 숫자가 보이면 무언가 잘못됐다는 뜻이 되어 신호가 분명하다.
import * as sync from './sync.js';
import * as store from './local/store.js';
import { confirmDialog, promptDialog, toast } from './ui.js';

const NAME_KEY = 'bh_device_name';
const LAST_SYNC_KEY = 'lastSyncAt';

let state = {
  pending: 0,          // 올릴 대기 건수 (outbox)
  failed: '',          // 마지막 자동 올리기가 실패했으면 그 이유
  offline: false,
  lastSyncAt: '',
};

export const getSyncState = () => ({ ...state });

export function deviceName() {
  return localStorage.getItem(NAME_KEY) || '';
}

export function setDeviceName(name) {
  localStorage.setItem(NAME_KEY, (name || '').trim());
}

/** 이름이 없으면 한 번만 묻고, 이후에는 저장된 이름을 계속 쓴다. */
export async function ensureDeviceName() {
  let name = deviceName();
  if (name) return name;
  name = await promptDialog('내 이름 / 기기 이름', {
    label: '한 번만 등록하면 계속 사용됩니다. 리포트에 작성자로 들어갑니다.',
    placeholder: '예) 황지민', okLabel: '저장',
  });
  if (!name) return '';
  setDeviceName(name);
  return name;
}

// ---------------------------------------------------------------- 상태 표시

// 여러 곳(주기 확인·화면 복귀·네트워크 변화·설정 화면)에서 동시에 부른다.
// 이미 물어보는 중이면 그 답을 같이 쓴다 — 같은 질문을 두 번 하지 않는다.
let inFlight = null;

export function refreshState() {
  if (!inFlight) inFlight = doRefreshState().finally(() => { inFlight = null; });
  return inFlight;
}

async function doRefreshState() {
  try {
    await paint();
    return state;
  } catch {
    return state;
  }
}

/**
 * 상단바의 동기화 칩과 [⬆ 업데이트] 버튼을 현재 상태에 맞춘다.
 * 서버를 부르지 않고 기기 안 값만 읽으므로 아무 때나 불러도 된다.
 */
export async function paint() {
  // 올릴 것은 전부 대기열 하나에 들어 있다 (두 번 세지 않는다).
  state.pending = await store.outboxCount();
  // 올릴 것이 없으면 실패도 없는 것이다 — 지난 실패 표시가 남아 있어도 무시한다.
  state.failed = state.pending ? ((await store.getMeta('flushFailed', '')) || '') : '';
  state.offline = !sync.isOnline();
  state.lastSyncAt = (await store.getMeta(LAST_SYNC_KEY, '')) || '';
  paintNow();
}

function paintNow() {
  const chip = document.getElementById('sync-chip');
  const text = document.getElementById('sync-text');
  const waiting = state.pending;

  // 숫자는 오프라인이거나 올리기가 실패했을 때만 보인다.
  // 온라인이고 대기 중이면 곧 자동으로 올라가므로 '올리는 중' 으로만 표시한다.
  const failed = !state.offline && !!state.failed;
  if (chip) {
    chip.classList.toggle('is-offline', state.offline);
    chip.classList.toggle('is-failed', failed);
    chip.classList.toggle('is-dirty', !state.offline && !failed && waiting > 0);
    chip.title = failed ? `올리지 못했습니다: ${state.failed}` : '아직 올리지 않은 내용 보기';
  }

  if (!text) return;
  if (state.offline) {
    text.textContent = waiting ? `오프라인 · 올릴 것 ${waiting}건` : '오프라인';
  } else if (failed) {
    text.textContent = `올리지 못한 것 ${waiting}건`;
  } else if (waiting) {
    text.textContent = `올리는 중 ${waiting}건`;
  } else {
    text.textContent = state.lastSyncAt
      ? `시트와 같은 내용 · ${state.lastSyncAt.slice(5, 16).replace('T', ' ')}`
      : '시트와 같은 내용';
  }
}

// ------------------------------------------------------------------ 실행

/**
 * 시트에서 최신 내용을 받아온다. 밀린 것이 있으면 먼저 올린다.
 * 어느 한 단계가 실패해도 나머지는 계속한다 — 부분 성공이 아무것도 안 한 것보다 낫다.
 *
 * quiet=true 면 자동 실행이다 — 토스트를 띄우지 않고, 사용자가 무언가 적는 중이면
 * 화면을 다시 그리지 않는다.
 */
export const runSync = (...a) => runRefresh(...a);
export async function runRefresh(btn, { quiet = false } = {}) {
  if (!sync.isOnline()) {
    if (!quiet) toast('오프라인입니다. 인터넷이 되는 곳에서 다시 눌러 주세요.', 'err');
    return null;
  }
  if (quiet && !safeToRepaint()) return null;

  const before = await store.outboxCount();
  let name = deviceName();
  if (before && !name && !quiet) {
    name = await ensureDeviceName();
    if (!name) return null;
  }

  if (btn) { btn.disabled = true; btn.textContent = '받는 중…'; }
  const done = { uploaded: 0, sheet: false, guides: 0, guidesRemoved: 0, fields: 0 };
  const problems = [];

  // 1. 밀린 것이 있으면 먼저 올린다 (오프라인에서 쌓인 것 · 실패했던 것)
  try {
    const result = await sync.flushOutbox();
    done.uploaded = result.sent || 0;
    for (const f of result.failed || []) problems.push(f);
  } catch (err) {
    problems.push(`대기분 전송: ${err.message}`);
  }

  // 2. 시트에서 받기 — 항목 · 재고 · 가이드 · 리포트 이력
  const onSheet = await store.sheetInventoryOn();
  if (onSheet) {
    try {
      const fieldsheet = await import('./fieldsheet.js');
      const got = await fieldsheet.pullFields();
      done.fields = (got.changed || 0) + (got.added || 0) + (got.removed || 0);
    } catch (err) { problems.push(`항목 설정 받기: ${err.message}`); }

    try {
      const invsheet = await import('./invsheet.js');
      await invsheet.pullInventory();
      await dropReportCache();
      done.sheet = true;
    } catch (err) { problems.push(`시트 받기: ${err.message}`); }

    try {
      const guidesheet = await import('./guidesheet.js');
      const got = await guidesheet.pullGuides();
      done.guides = (got.changed || 0) + (got.added || 0);
      done.guidesRemoved = got.removed || 0;
    } catch (err) { problems.push(`가이드 받기: ${err.message}`); }
  }

  await store.setMeta('dirty', false);   // 예전 버전이 남긴 표시를 지운다
  await store.setMeta(LAST_SYNC_KEY, store.now());
  await refreshState();
  if (btn) { btn.disabled = false; btn.textContent = '새로고침'; }

  // 화면이 새 자료를 반영하도록 다시 그린다 (적는 중이면 건드리지 않는다).
  if (!quiet || safeToRepaint()) window.dispatchEvent(new HashChangeEvent('hashchange'));

  if (quiet) return { ...done, problems, before };
  const parts = [];
  if (done.uploaded) parts.push(`${done.uploaded}건 올림`);
  if (done.fields) parts.push(`리포트 항목 ${done.fields}건`);
  if (done.guides) parts.push(`가이드 ${done.guides}건`);
  if (done.guidesRemoved) parts.push(`중복 가이드 ${done.guidesRemoved}건 정리`);
  if (problems.length) {
    toast(`일부 실패 — ${problems[0]}`, 'err');
  } else if (!onSheet) {
    toast('구글 시트가 연결되어 있지 않습니다. 설정에서 먼저 연결하세요.', 'err');
  } else {
    toast(parts.length ? `새로고침했습니다 (${parts.join(' · ')})` : '이미 최신입니다.', 'ok');
  }
  return { ...done, problems, before };
}

/** 사용자가 무언가 적는 중이거나 창을 열어 둔 상태면 화면을 건드리지 않는다. */
function safeToRepaint() {
  if (document.getElementById('modalRoot').innerHTML) return false;
  const hash = location.hash;
  if (hash.startsWith('#/report/') || hash.startsWith('#/guides/new')
      || hash.startsWith('#/guides/edit')) return false;
  const active = document.activeElement;
  return !(active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
}

/** 이력 화면이 시트에서 다시 받아오도록 기기 사본을 비운다. */
async function dropReportCache() {
  const idb = await import('./local/idb.js');
  for (const row of await idb.getAll('meta')) {
    if (String(row.key || '').startsWith('sheetReports:')) {
      await idb.remove('meta', row.key);
    }
  }
}

/** 설정 화면에 보여 줄 한 줄 요약 */
export function syncSummaryText() {
  const waiting = state.pending;
  if (state.offline) return `오프라인입니다. 올릴 것 ${waiting}건은 연결되면 자동으로 올라갑니다.`;
  if (state.failed) return `올리지 못한 것이 ${waiting}건 있습니다 — ${state.failed}`;
  if (waiting) return `${waiting}건을 올리는 중입니다.`;
  return state.lastSyncAt
    ? `시트와 같은 내용입니다. 마지막 새로고침 ${state.lastSyncAt.replace('T', ' ')}`
    : '아직 한 번도 새로고침하지 않았습니다.';
}

const AUTO_REFRESH_MS = 5 * 60 * 1000;

export function initSyncButton() {
  const btn = document.getElementById('btn-update');
  if (btn) btn.addEventListener('click', () => runRefresh(btn));

  // 상단바의 칩을 누르면 무엇이 밀려 있는지 보여 준다.
  const chip = document.getElementById('sync-chip');
  if (chip) {
    chip.addEventListener('click', async () => {
      const pending = await import('./pending.js');
      pending.openPendingList();
    });
  }

  refreshState();
  setInterval(refreshState, 60 * 1000);
  sync.onNetChange(() => refreshState());

  // 받기는 조용히 자동으로도 돈다 — 앱으로 돌아올 때, 그리고 5분마다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshState();
      runRefresh(null, { quiet: true });
    }
  });
  setInterval(() => runRefresh(null, { quiet: true }), AUTO_REFRESH_MS);
}
