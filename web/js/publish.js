// [업데이트] — 내가 만든/수정한 내용을 모든 사용자에게 적용
//
// 이 앱에서 가이드·차량·재고·항목을 바꾸면 **나에게만** 반영된다.
// [업데이트] 를 눌러야 모든 사용자가 보는 내용이 된다.
// 다른 사람이 업데이트하면, 내 변경이 없는 한 자동으로 최신 내용을 받는다.
import { api } from './api.js';
import { $, h, confirmDialog, promptDialog, toast } from './ui.js';

const NAME_KEY = 'bh_device_name';
const CHECK_INTERVAL_MS = 60 * 1000;

let state = {
  published: { revision: 0, at: '', by: '' },
  myRevision: 0, hasLocalChanges: false, behind: false, summary: {},
};

export function getPublishState() {
  return { ...state };
}

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
    label: '한 번만 등록하면 계속 사용됩니다. 누가 업데이트했는지 표시됩니다.',
    placeholder: '예) 황지민', okLabel: '저장',
  });
  if (!name) return '';
  setDeviceName(name);
  return name;
}

export async function refreshState() {
  try {
    const info = await api.state();
    state = info;
    if (!deviceName() && info.deviceName) setDeviceName(info.deviceName);
    if (info.autoUpdated) {
      toast('다른 사용자가 업데이트한 최신 내용을 받았습니다.', 'ok');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    paintButton();
    return info;
  } catch {
    return null;
  }
}

function paintButton() {
  const btn = document.getElementById('publishBtn');
  if (!btn) return;
  const pending = !!state.hasLocalChanges;
  btn.classList.toggle('chip--pending', pending);
  const label = btn.querySelector('.chip__label');
  if (label) label.textContent = pending ? '업데이트 ●' : '업데이트';
  btn.title = pending
    ? '아직 모든 사용자에게 적용되지 않은 변경이 있습니다. 눌러서 적용하세요.'
    : `모든 사용자와 같은 내용입니다. (최근 업데이트 ${state.published.by || '-'} · ${state.published.at || '-'})`;
}

/** 내 변경 내용을 모든 사용자에게 적용 */
export async function runPublish(btn) {
  await refreshState();
  if (!state.hasLocalChanges) {
    toast('적용할 변경 내용이 없습니다. 이미 모든 사용자와 같은 내용입니다.');
    return;
  }
  const name = await ensureDeviceName();
  if (!name) return;

  const s = state.summary || {};
  const warning = state.behind
    ? '\n\n⚠️ 내가 최신 내용을 받기 전에 다른 사람이 먼저 업데이트했습니다.\n'
      + `(다른 사람 업데이트: ${state.published.by || '-'} · ${state.published.at || '-'})\n`
      + '지금 적용하면 내 화면의 내용이 최종본이 되어 그 변경이 덮어씌워질 수 있습니다.'
    : '';
  const ok = await confirmDialog(
    '모든 사용자에게 적용',
    `지금 내 화면의 내용을 모든 사용자가 보는 내용으로 만듭니다.\n\n`
    + `가이드 ${s.guides || 0}건 · 차량 ${s.vehicles || 0} · 재고 ${s.inventoryItems || 0}종 · 리포트 항목 ${s.fields || 0}`
    + warning,
    '적용하기', !!state.behind);
  if (!ok) return;

  if (btn) btn.disabled = true;
  toast('적용하는 중…');
  try {
    const result = await api.publish(name);
    toast(`모든 사용자에게 적용했습니다. (버전 ${result.revision})`, 'ok');
    await refreshState();
  } catch (err) {
    toast(err.message, 'err');
  }
  if (btn) btn.disabled = false;
}

/** 내 변경을 버리고 모든 사용자의 최신 내용을 받는다 */
export async function runTakeLatest() {
  const ok = await confirmDialog(
    '최신 내용 받기',
    '아직 적용하지 않은 내 변경 내용을 버리고, 모든 사용자가 보는 최신 내용을 받아옵니다.\n'
    + '되돌릴 수 없습니다.',
    '내 변경 버리고 받기', true);
  if (!ok) return;
  try {
    await api.takeLatest();
    toast('최신 내용을 받았습니다.', 'ok');
    await refreshState();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (err) {
    toast(err.message, 'err');
  }
}

export function publishSummaryText() {
  const p = state.published || {};
  if (state.hasLocalChanges) {
    return state.behind
      ? `내 변경이 있고, 다른 사람이 먼저 업데이트했습니다. (현재 공개 버전 ${p.revision})`
      : '아직 모든 사용자에게 적용하지 않은 내 변경이 있습니다.';
  }
  if (!p.revision) return '아직 아무도 업데이트하지 않았습니다.';
  return `모든 사용자와 같은 내용입니다. 공개 버전 ${p.revision} · ${p.by || '-'} · ${p.at || '-'}`;
}

export function initPublish() {
  const btn = document.getElementById('publishBtn');
  if (btn) btn.addEventListener('click', () => runPublish(btn));
  refreshState();
  setInterval(refreshState, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshState();
  });
}
