// [⬆ 업데이트] — 밀린 것을 구글 시트에 올리고, 최신 시트 내용을 받아온다.
//
// v3.2 에서 뜻이 바뀌었다.
//   예전: 내 화면 내용을 사무실 서버의 '공개본' 으로 만든다 (팀 공유의 중심이 서버였다)
//   지금: 팀 공유의 중심은 **구글 시트**다. 서버는 가이드 보관소로만 남는다.
//         그래서 이 버튼은 "지금 시트와 맞추기" 한 가지 일을 한다.
//
// 누르면 순서대로:
//   1. 오프라인에서 쌓인 것을 전부 올린다 (리포트 → 시트, 재고 수량, 이력 상태, 가이드 탭)
//   2. 내가 고친 가이드·항목 설정을 서버에 반영한다
//   3. 서버에서 남이 바꾼 가이드를 받아온다
//   4. 시트에서 재고와 리포트 이력을 다시 받아온다
//
// 그래서 현장에서 오프라인으로 일하다 인터넷이 되는 곳에서 한 번 누르면
// 올릴 것은 올라가고 받을 것은 받아진다.
import { api } from './api.js';
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

export async function refreshState() {
  try {
    // 서버 상태는 있으면 얹고, 없으면(오프라인) 기기 정보로만 표시한다.
    try {
      const info = await api.state();
      state.published = info.published || state.published;
      state.summary = info.summary || {};
      if (!deviceName() && info.deviceName) setDeviceName(info.deviceName);
    } catch { /* 오프라인 — 기기 정보만으로 충분하다 */ }
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
  state.pending = await store.outboxCount();
  state.dirty = await store.isDirty();
  state.offline = !sync.isOnline();
  state.lastSyncAt = (await store.getMeta(LAST_SYNC_KEY, '')) || '';
  paintNow();
}

function paintNow() {
  const chip = document.getElementById('sync-chip');
  const text = document.getElementById('sync-text');
  const btn = document.getElementById('btn-update');
  const waiting = state.pending + (state.dirty ? 1 : 0);

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
  const dirty = await store.isDirty();
  let name = deviceName();
  if (dirty && !name) {
    name = await ensureDeviceName();
    if (!name) return null;
  }

  if (btn) { btn.disabled = true; btn.textContent = '맞추는 중…'; }
  const done = { uploaded: 0, published: false, pulled: false, sheet: false };
  const problems = [];

  // 1. 밀린 것 올리기 (리포트·재고 수량·이력 상태·가이드 탭)
  try {
    const result = await sync.flushOutbox();
    done.uploaded = result.sent || 0;
  } catch (err) {
    problems.push(`대기분 전송: ${err.message}`);
  }

  // 2·3. 가이드·항목 설정을 서버와 맞춘다
  try {
    if (await store.isDirty()) {
      await api.publish(name || '이름 없음');
      done.published = true;
    } else {
      done.pulled = await sync.autoPullIfClean();
    }
  } catch (err) {
    problems.push(`가이드 동기화: ${err.message}`);
  }

  // 4. 시트에서 최신 자료 받기 (재고 + 리포트 이력)
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

  await store.setMeta(LAST_SYNC_KEY, store.now());
  await refreshState();
  if (btn) { btn.disabled = false; btn.textContent = '⬆ 업데이트'; }

  // 화면이 새 자료를 반영하도록 다시 그린다.
  window.dispatchEvent(new HashChangeEvent('hashchange'));

  const parts = [];
  if (done.uploaded) parts.push(`${done.uploaded}건 올림`);
  if (done.published) parts.push('가이드 반영');
  if (done.sheet) parts.push('시트 받음');
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

/** 내 변경을 버리고 서버의 최신 가이드를 받는다 (설정 화면에서 쓴다). */
export async function runTakeLatest(quiet = false) {
  if (!quiet || await store.isDirty()) {
    const ok = await confirmDialog(
      '최신 내용 받기',
      '아직 올리지 않은 내 가이드·항목 변경을 버리고, 서버의 최신 내용을 받아옵니다.\n'
      + '되돌릴 수 없습니다.',
      '내 변경 버리고 받기', true);
    if (!ok) return;
  }
  try {
    await api.takeLatest();
    toast('최신 내용을 받았습니다.', 'ok');
    await refreshState();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (err) {
    toast(err.message, 'err');
  }
}

/** 설정 화면에 보여 줄 한 줄 요약 */
export function syncSummaryText() {
  const waiting = state.pending + (state.dirty ? 1 : 0);
  if (state.offline) return `오프라인입니다. 올릴 것 ${waiting}건이 기다리고 있습니다.`;
  if (waiting) return `아직 올리지 않은 내용이 ${waiting}건 있습니다. [⬆ 업데이트] 를 누르세요.`;
  return state.lastSyncAt
    ? `시트와 같은 내용입니다. 마지막 맞춤 ${state.lastSyncAt.replace('T', ' ')}`
    : '아직 한 번도 맞추지 않았습니다.';
}

export function initSyncButton() {
  const btn = document.getElementById('btn-update');
  if (btn) btn.addEventListener('click', () => runSync(btn));
  refreshState();
  setInterval(refreshState, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshState();
  });
  sync.onNetChange(() => refreshState());
}
