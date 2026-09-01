// 연결 상태 표시 — 화면 위쪽 띠와 대기 작업 안내를 담당한다.
import * as sync from './sync.js';
import * as store from './local/store.js';
import { closeModal, openSheet, toast } from './ui.js';

/**
 * 상단 오프라인 띠와 동기화 칩을 현재 상태에 맞춘다.
 * 띠는 index.html 에 미리 있고 여기서 보이고/숨긴다.
 */
async function paint() {
  const banner = document.getElementById('offline-banner');
  const count = document.getElementById('queue-count');
  const pending = await store.outboxCount();
  const online = sync.isOnline();
  const stuck = online && sync.serverUnreachable() && pending > 0;

  if (count) count.textContent = String(pending);
  if (banner) {
    banner.hidden = online && !stuck;
    if (!online) {
      banner.textContent = pending
        ? `📴 오프라인 — 기기에 저장하며 계속 사용할 수 있습니다 · 대기 중 ${pending}건`
        : '📴 오프라인 — 기기에 저장하며 계속 사용할 수 있습니다';
    } else if (stuck) {
      banner.textContent =
        `⏳ 대기 ${pending}건 — 사무실 서버에 닿으면 자동으로 반영됩니다`;
    }
  }
  // 상단바 칩은 syncnow.js 가 그린다 (같은 사실을 두 곳에 적지 않는다).
  const syncnow = await import('./syncnow.js');
  syncnow.paint();
}

/** 처음 실행이면 서버에서 자료를 한 번 받아온다. */
export async function ensureFirstData() {
  if (await store.isEmpty()) {
    // APK 첫 실행: 서버 주소를 아직 모르면 바로 안내한다.
    if (!sync.isOnline() || !(await sync.serverBase())) { showEmptyGuide(); return; }
    try {
      await sync.pull();
    } catch {
      showEmptyGuide();
      return;
    }
  }
  // 이전 버전(v2)에서 서버에 남아 있던 리포트를 기기로 옮긴다 (1회).
  sync.importLegacy().then((added) => {
    if (added) toast(`이전에 작성한 리포트 ${added}건을 기기로 가져왔습니다.`, 'ok');
  }).catch(() => { /* 다음 실행에서 다시 시도 */ });
}

function showEmptyGuide() {
  const body = openSheet('처음 실행 — 자료 받기', `
    <p class="muted" style="margin:0 0 14px;line-height:1.7">
      이 기기에 아직 가이드·재고 자료가 없습니다.
      <strong>사무실 Wi-Fi 에 연결된 상태에서 한 번만</strong> 자료를 받으면,
      그다음부터는 인터넷 없이도 모든 기능을 쓸 수 있습니다.
    </p>
    <div class="sub-card">
      <p class="muted" style="margin:0;font-size:.9rem;line-height:1.6">
        APK 로 설치한 경우 <strong>⚙️ 설정 → 사무실 서버 주소</strong>를 먼저 등록해 주세요.
      </p>
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" type="button" data-act="close">나중에</button>
      <button class="btn btn--primary" type="button" data-act="pull-now">📥 지금 받기</button>
    </div>`);

  body.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act="pull-now"]');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '받는 중…';
    try {
      const result = await sync.pull();
      toast(`자료를 받았습니다. (버전 ${result.revision})`, 'ok');
      closeModal();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.textContent = '📥 지금 받기';
    }
  });
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
