// 남이 올린 새 내용이 있나 · 내가 올린 것이 올라갔나 — 조용히 알린다.
//
// 자동 새로고침을 걷어낸 뒤(v3.22) 두 가지가 보이지 않게 됐다.
//  ① 내가 바꾼 것이 시트에 올라갔다는 확인 — 칩이 '올리는 중' 동안만 보이고 사라진다
//  ② 다른 사람이 올린 새 내용이 있다는 사실
//
// 여기서 하는 일.
//  · 5분마다 시트에 **"마지막으로 바뀐 시각" 한 줄만** 물어본다. 자료는 받지 않고
//    화면도 바꾸지 않는다. 내가 아는 시각과 다르면 [새로고침] 버튼에 점을 켠다.
//  · 내 것이 올라가면 "시트에 올렸습니다 · 재고 2건" 을 한 번 띄우고, 그때의 시트
//    시각을 '아는 것' 으로 삼는다 — 그래서 내 변경은 "새 내용" 으로 뜨지 않는다.
//  · [새로고침] 을 눌러 받으면 점이 꺼진다.
//
// 화면은 **사람이 누를 때만** 바뀐다는 원칙(6번 피드백)은 그대로다.
import * as store from './local/store.js';
import * as sync from './sync.js';
import { toast } from './ui.js';

const KNOWN_KEY = 'sheetChangedKnown';     // 내가 마지막으로 본 시트의 바뀐 시각
const GAP_MS = 5 * 60 * 1000;

let hasNew = false;
let busy = false;

export const hasNewContent = () => hasNew;

/** 대기열 종류 → 사람이 읽는 이름. 올렸다는 알림에 쓴다. */
const LABEL = {
  quantity: '재고', 'quantity-delete': '재고', 'invsheet-push': '재고',
  'guidesheet-push': '가이드', 'fieldsheet-push': '리포트 항목',
  'drivesheet-push': '운행일지', 'drivesheet-options': '운행일지',
  'report-status': '이력 상태', sheet: '리포트',
};

/** { 재고: 2, 운행일지: 1 } → '재고 2건 · 운행일지 1건' */
export function describeSent(byType) {
  const counts = {};
  for (const [type, n] of Object.entries(byType || {})) {
    const label = LABEL[type] || '기록';
    counts[label] = (counts[label] || 0) + n;
  }
  return Object.entries(counts).map(([label, n]) => `${label} ${n}건`).join(' · ');
}

async function fetchStamp() {
  const { callAppsScript } = await import('./sheets.js');
  const result = await callAppsScript({ changed: true }, 15000);
  return String((result && result.changedAt) || '');
}

/**
 * 시트의 바뀐 시각을 물어 점을 켜거나 끈다.
 *  absorb=true 면 지금 시각을 '아는 것' 으로 삼는다 (받기를 마쳤을 때).
 *  keepNew=true 면 이미 점이 켜져 있으면 건드리지 않는다 (내 올리기 뒤 — 남의 변경을
 *  내 것으로 착각해 점을 꺼 버리지 않게).
 */
export async function checkChanges({ absorb = false, keepNew = false } = {}) {
  if (busy || !sync.isOnline()) return hasNew;
  if (!(await store.sheetInventoryOn())) return hasNew;
  if (keepNew && hasNew) return hasNew;
  busy = true;
  try {
    const stamp = await fetchStamp();
    if (!stamp) return hasNew;                       // 예전 Apps Script — 모른 채로 둔다
    const known = (await store.getMeta(KNOWN_KEY, '')) || '';
    if (absorb || !known) {
      await store.setMeta(KNOWN_KEY, stamp);
      hasNew = false;
    } else {
      hasNew = stamp !== known;
    }
    paintUpdateButton();
  } catch {
    // 못 닿으면 다음 번에 다시 묻는다 — 점은 있던 대로 둔다.
  } finally {
    busy = false;
  }
  return hasNew;
}

/** 받기를 마쳤다 — 지금 시트가 곧 내가 아는 것이다. */
export const markSynced = () => checkChanges({ absorb: true });

/** [새로고침] 버튼의 글자와 점. 받는 중(disabled)이면 건드리지 않는다. */
export function paintUpdateButton() {
  const btn = document.getElementById('btn-update');
  if (!btn || btn.disabled) return;
  btn.classList.toggle('has-new', hasNew);
  btn.textContent = hasNew ? '새 내용 · 새로고침' : '새로고침';
  btn.title = hasNew
    ? '다른 사람이 올린 새 내용이 있습니다 — 눌러서 받으세요'
    : '다른 사람이 바꾼 내용을 지금 받아옵니다 (올리기는 자동)';
}

/**
 * 부팅 때 한 번.
 *  · 지금 시트 시각을 '아는 것' 으로 (부팅 때 최신본을 함께 받아 오므로)
 *  · 5분마다, 앱으로 돌아올 때, 인터넷이 돌아올 때 물어본다
 *  · 자동 올리기가 끝나면 "올렸습니다" 를 띄우고 시각을 갱신한다
 */
export function initChangeWatch() {
  checkChanges({ absorb: true });
  setInterval(() => checkChanges(), GAP_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkChanges();
  });
  sync.onNetChange(({ online, work }) => {
    if (!online) return;
    if (work && work.flushed > 0) {
      const what = describeSent(work.sentByType);
      toast(`시트에 올렸습니다${what ? ` · ${what}` : ''}`, 'ok');
      checkChanges({ absorb: true, keepNew: true });
    } else if (!work) {
      checkChanges();                                // 인터넷이 돌아왔다
    }
  });
}
