// 연결 상태 표시 — 화면 위쪽 띠와 대기 작업 안내를 담당한다.
import * as sync from './sync.js';
import * as store from './local/store.js';
import { toast } from './ui.js';

/**
 * 상단 오프라인 띠와 동기화 칩을 현재 상태에 맞춘다.
 * 띠는 index.html 에 미리 있고 여기서 보이고/숨긴다.
 */
async function paint() {
  const banner = document.getElementById('offline-banner');
  const count = document.getElementById('queue-count');
  const pending = await store.outboxCount();
  const online = sync.isOnline();
  // 인터넷이 되면 띠를 띄우지 않는다. 예전에는 '사무실 서버' 에 못 닿을 때도
  // 빨간 띠를 띄웠는데, 그 서버는 이제 쓰지 않으므로 태블릿에서 늘 떠 있었다.
  if (count) count.textContent = String(pending);
  if (banner) {
    banner.hidden = online;
    if (!online) {
      banner.textContent = pending
        ? `📴 오프라인 — 기기에 저장하며 계속 사용할 수 있습니다 · 대기 중 ${pending}건`
        : '📴 오프라인 — 기기에 저장하며 계속 사용할 수 있습니다';
    }
  }
  // 상단바 칩은 syncnow.js 가 그린다 (같은 사실을 두 곳에 적지 않는다).
  const syncnow = await import('./syncnow.js');
  syncnow.paint();
}

/** 처음 실행 준비 — 붙박이 항목을 넣고, 시트가 있으면 최신 자료를 받는다. */
export async function ensureFirstData() {
  // 리포트 항목은 앱에 붙박이로 들어 있다. 새로 설치한 기기도 곧바로
  // 같은 항목으로 시작한다 — 예전에는 서버에서 받아와야 해서, APK 를 새로
  // 깔면 항목이 하나도 없었다.
  const added = await store.ensureDefaultFields();
  if (added) {
    toast(`리포트 항목 ${added}개를 준비했습니다.`, 'ok');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  // 가이드·재고는 구글 시트가 원본이다. 시트가 연결돼 있으면 조용히 받아온다.
  if (!sync.isOnline()) return;
  try {
    if (!(await store.sheetInventoryOn())) return;
    const [invsheet, guidesheet, fieldsheet] = await Promise.all([
      import('./invsheet.js'), import('./guidesheet.js'), import('./fieldsheet.js'),
    ]);
    // 항목을 가장 먼저 — 팀이 쓰는 항목이 이 기기의 붙박이 항목보다 우선한다.
    await fieldsheet.pullFields().catch(() => {});
    await invsheet.pullInventory().catch(() => {});
    await guidesheet.pullGuides().catch(() => {});
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch {
    // 시트에 못 닿아도 앱은 기기 안 자료로 그대로 동작한다.
  }
}

export function initNetStatus() {
  paint();
  sync.onNetChange(({ work }) => {
    paint();
    if (work && work.flushed) {
      toast(`대기 중이던 작업 ${work.flushed}건을 처리했습니다.`, 'ok');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    if (work && work.pulled) {
      toast('다른 사용자가 업데이트한 최신 내용을 받았습니다.', 'ok');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  });
  // 화면을 다시 켰을 때도 밀린 일이 있으면 처리한다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.runPendingWork().then(paint);
  });
  sync.runPendingWork().then(paint);
  setInterval(paint, 5000);
}
