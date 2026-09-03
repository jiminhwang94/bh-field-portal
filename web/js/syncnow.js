// [⬆ 업데이트] — 밀린 것을 구글 시트에 올리고, 최신 시트 내용을 받아온다.
//
// 팀이 함께 보는 원본은 **구글 시트 하나**다. 가이드·재고·리포트 이력이
// 전부 거기 있고, 인터넷만 되면 어느 와이파이에서도 된다.
// (예전에는 사무실 서버에도 따로 올렸는데, 시트로 이미 다 올라가고 있어
//  하는 일이 없으면서 서버 주소를 안 넣은 기기에서는 실패만 했다. 뺐다.)
//
// 누르면 순서대로:
//   1. 오프라인에서 쌓인 것을 전부 올린다 (리포트 · 재고 수량 · 이력 상태 · 가이드)
//   2. 시트에서 재고 · 가이드 · 리포트 이력을 다시 받아온다
//
// 그래서 현장에서 오프라인으로 일하다 인터넷이 되는 곳에서 한 번 누르면
// 올릴 것은 올라가고 받을 것은 받아진다.
import * as sync from './sync.js';
import * as store from './local/store.js';
import { confirmDialog, promptDialog, toast } from './ui.js';

const NAME_KEY = 'bh_device_name';
const LAST_SYNC_KEY = 'lastSyncAt';
const CHECK_INTERVAL_MS = 60 * 1000;

let state = {
  pending: 0,          // 올릴 대기 건수 (outbox)
  dirty: false,        // 서버에 아직 안 올린 가이드·항목 변경
  offline: false,
  lastSyncAt: '',
  published: { revision: 0, at: '', by: '' },
  summary: {},
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
  // 올릴 것은 전부 대기열에 들어 있다. 예전에는 여기에 'dirty' 표시를
  // 하나 더 얹었는데, 가이드를 고치면 대기열에도 들어가고 dirty 도 서면서
  // **같은 변경을 두 번 셌다.** 그게 정체 모를 "올릴 내용 1건" 이었다.
  state.pending = await store.outboxCount();
  state.dirty = false;
  state.offline = !sync.isOnline();
  state.lastSyncAt = (await store.getMeta(LAST_SYNC_KEY, '')) || '';
  paintNow();
}

function paintNow() {
  const chip = document.getElementById('sync-chip');
  const text = document.getElementById('sync-text');
  const btn = document.getElementById('btn-update');
  const waiting = state.pending;

  if (chip) {
    chip.classList.toggle('is-offline', state.offline);
    chip.classList.toggle('is-dirty', !state.offline && waiting > 0);
  }
  if (btn) btn.classList.toggle('is-dirty', !state.offline && waiting > 0);

  if (!text) return;
  if (state.offline) {
    text.textContent = waiting
      ? `오프라인 · 올릴 것 ${waiting}건` : '오프라인';
  } else if (waiting) {
    text.textContent = `올릴 내용 ${waiting}건`;
  } else {
    text.textContent = state.lastSyncAt
      ? `시트와 같은 내용 · ${state.lastSyncAt.slice(5, 16).replace('T', ' ')}`
      : '시트와 같은 내용';
  }
}

// ------------------------------------------------------------------ 실행

/**
 * 지금 시트와 맞춘다. 반환: 무엇을 했는지 요약.
 * 어느 한 단계가 실패해도 나머지는 계속한다 — 부분 성공이 아무것도 안 한 것보다 낫다.
 */
export async function runSync(btn) {
  if (!sync.isOnline()) {
    toast('오프라인입니다. 인터넷이 되는 곳에서 다시 눌러 주세요.', 'err');
    return null;
  }

  const before = await store.outboxCount();
  let name = deviceName();
  if (before && !name) {
    name = await ensureDeviceName();
    if (!name) return null;
  }

  if (btn) { btn.disabled = true; btn.textContent = '맞추는 중…'; }
  const done = { uploaded: 0, sheet: false, guides: 0, guidesRemoved: 0, fields: 0 };
  const problems = [];

  // 1. 밀린 것 올리기 (리포트·재고 수량·이력 상태·가이드 탭)
  try {
    const result = await sync.flushOutbox();
    done.uploaded = result.sent || 0;
  } catch (err) {
    problems.push(`대기분 전송: ${err.message}`);
  }

  // 가이드·재고·리포트는 **모두 구글 시트가 원본**이다. 예전에는 여기서
  // 사무실 서버에도 따로 올렸는데, 시트로 이미 다 올라가고 있어 하는 일이
  // 없었다. 서버 주소를 안 넣은 태블릿에서는 그 단계가 매번 실패해
  // 빨간 알림만 띄웠다. 그래서 뺐다.

  // 4. 시트에서 최신 자료 받기 (재고 · 가이드 · 리포트 이력)
  try {
    if (await store.sheetInventoryOn()) {
      const invsheet = await import('./invsheet.js');
      await invsheet.pullInventory();
      await dropReportCache();       // 이력 화면이 새로 받아오게 한다
      done.sheet = true;
    }
  } catch (err) {
    problems.push(`시트 받기: ${err.message}`);
  }

  // 리포트 항목은 팀 공통 — 다른 사람이 바꾼 것을 받아 온다.
  try {
    if (await store.sheetInventoryOn()) {
      const fieldsheet = await import('./fieldsheet.js');
      const got = await fieldsheet.pullFields();
      done.fields = (got.changed || 0) + (got.added || 0) + (got.removed || 0);
    }
  } catch (err) {
    problems.push(`항목 설정 받기: ${err.message}`);
  }

  try {
    if (await store.sheetInventoryOn()) {
      const guidesheet = await import('./guidesheet.js');
      const got = await guidesheet.pullGuides();
      done.guides = (got.changed || 0) + (got.added || 0);
      done.guidesRemoved = got.removed || 0;
    }
  } catch (err) {
    problems.push(`가이드 받기: ${err.message}`);
  }

  await store.setMeta('dirty', false);   // 예전 버전이 남긴 표시를 지운다
  await store.setMeta(LAST_SYNC_KEY, store.now());
  await refreshState();
  if (btn) { btn.disabled = false; btn.textContent = '⬆ 업데이트'; }

  // 화면이 새 자료를 반영하도록 다시 그린다.
  window.dispatchEvent(new HashChangeEvent('hashchange'));

  const parts = [];
  if (done.uploaded) parts.push(`${done.uploaded}건 올림`);
  if (done.sheet) parts.push('시트 받음');
  if (done.fields) parts.push(`리포트 항목 ${done.fields}건 갱신`);
  if (done.guides) parts.push(`가이드 ${done.guides}건 갱신`);
  if (done.guidesRemoved) parts.push(`중복 가이드 ${done.guidesRemoved}건 정리`);
  if (problems.length) {
    toast(`일부 실패 — ${problems[0]}`, 'err');
  } else {
    toast(parts.length ? `맞췄습니다 (${parts.join(' · ')})`
                       : '이미 최신입니다. 올릴 것도 받을 것도 없습니다.', 'ok');
  }
  return { ...done, problems, before };
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
  if (state.offline) return `오프라인입니다. 올릴 것 ${waiting}건이 기다리고 있습니다.`;
  if (waiting) return `아직 올리지 않은 내용이 ${waiting}건 있습니다. [⬆ 업데이트] 를 누르세요.`;
  return state.lastSyncAt
    ? `시트와 같은 내용입니다. 마지막 맞춤 ${state.lastSyncAt.replace('T', ' ')}`
    : '아직 한 번도 맞추지 않았습니다.';
}

export function initSyncButton() {
  const btn = document.getElementById('btn-update');
  if (btn) btn.addEventListener('click', () => runSync(btn));

  // 상단바의 [올릴 내용 N건] 을 누르면 무엇이 밀려 있는지 보여 준다.
  const chip = document.getElementById('sync-chip');
  if (chip) {
    chip.addEventListener('click', async () => {
      const pending = await import('./pending.js');
      pending.openPendingList();
    });
  }
  refreshState();
  setInterval(refreshState, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshState();
  });
  sync.onNetChange(() => refreshState());
}
