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
        ? `오프라인 — 기기에 저장하며 계속 사용할 수 있습니다 · 대기 중 ${pending}건`
        : '오프라인 — 기기에 저장하며 계속 사용할 수 있습니다';
    }
  }
  // 상단바 칩은 syncnow.js 가 그린다 (같은 사실을 두 곳에 적지 않는다).
  const syncnow = await import('./syncnow.js');
  syncnow.paint();
}

/**
 * 앱을 열 때 꼭 먼저 해야 하는 것만 한다 — 기기 안에서 끝나는 일이다.
 *
 * 시트에서 받아오는 일은 여기서 하지 않는다. 예전에는 이 함수가 끝날 때까지
 * 첫 화면을 그리지 않았고, 그 안에서 시트를 **세 번 차례로** 불렀다.
 * 왕복이 1.2초인 회선에서 3.7초, LTE(2.5초)에서는 7.5초 동안 빈 화면이었다.
 */
export async function ensureFirstData() {
  // 리포트 항목은 앱에 붙박이로 들어 있다. 새로 설치한 기기도 곧바로
  // 같은 항목으로 시작한다 — 예전에는 서버에서 받아와야 해서, APK 를 새로
  // 깔면 항목이 하나도 없었다.
  const added = await store.ensureDefaultFields();
  if (added) toast(`리포트 항목 ${added}개를 준비했습니다.`, 'ok');
  return added;
}

/**
 * 시트에서 최신 자료를 받아온다 — **화면을 그린 뒤 뒤에서** 부른다.
 *
 * 세 가지를 한꺼번에(동시에) 부른다. 차례로 부르면 왕복이 3배가 된다.
 * 그리고 **실제로 달라진 것이 있을 때만** 화면을 다시 그린다. 예전에는
 * 바뀐 게 없어도 무조건 다시 그려서, 화면에 들어간 지 1~2초 뒤 내용이
 * 한 번 덜컥 바뀌는 것처럼 보였다.
 */
export async function catchUpFromSheet() {
  if (!sync.isOnline()) return;
  try {
    if (!(await store.sheetInventoryOn())) return;
    const [invsheet, guidesheet, fieldsheet] = await Promise.all([
      import('./invsheet.js'), import('./guidesheet.js'), import('./fieldsheet.js'),
    ]);
    const [fields, inventory, guides] = await Promise.all([
      fieldsheet.pullFields().catch(() => null),
      invsheet.pullInventory().catch(() => null),
      guidesheet.pullGuides().catch(() => null),
    ]);
    if (changedSomething(fields) || changedSomething(inventory)
        || changedSomething(guides)) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  } catch {
    // 시트에 못 닿아도 앱은 기기 안 자료로 그대로 동작한다.
  }
}

/**
 * 받아온 결과가 화면을 다시 그릴 만한가.
 *
 * 받기 함수마다 알려 주는 모양이 다르다. `changed` 를 직접 알려 주는 것도
 * 있고(재고), 바뀐 건수를 세어 주는 것도 있다(항목·가이드).
 * 모르겠으면 **다시 그리지 않는다** — 괜한 깜빡임보다 조금 늦는 편이 낫다.
 */
function changedSomething(result) {
  if (!result) return false;
  if (typeof result.changed === 'boolean') return result.changed;
  return Boolean((result.changed || 0) + (result.added || 0) + (result.removed || 0));
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
