// 연결 상태 표시 — 화면 위쪽 띠와 대기 작업 안내를 담당한다.
import * as sync from './sync.js';
import * as store from './local/store.js';
import { closeModal, openSheet, toast } from './ui.js';

const BAR_ID = 'netBar';

function bar() {
  let el = document.getElementById(BAR_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = BAR_ID;
    el.className = 'netbar';
    document.body.prepend(el);
  }
  return el;
}

async function paint() {
  const el = bar();
  const pending = await store.outboxCount();
  const online = sync.isOnline();

  if (online && !pending) {
    el.className = 'netbar';           // 평소에는 숨긴다
    el.innerHTML = '';
    document.body.classList.remove('has-netbar');
    return;
  }
  document.body.classList.add('has-netbar');

  // 인터넷 자체가 없는 경우
  if (!online) {
    el.className = 'netbar netbar--offline is-on';
    el.innerHTML = '📴 오프라인 — 기기에 저장하며 계속 사용할 수 있습니다.'
      + (pending ? ` <strong>연결되면 처리할 작업 ${pending}건</strong>` : '');
    return;
  }
  // 인터넷은 되지만 사무실 서버에 못 닿는 경우 (현장 LTE 등)
  if (sync.serverUnreachable()) {
    el.className = 'netbar netbar--offline is-on';
    el.innerHTML = `⏳ 처리 대기 ${pending}건 — `
      + '<strong>사무실 서버에 연결되면 자동으로 반영</strong>됩니다.';
    return;
  }
  el.className = 'netbar netbar--pending is-on';
  el.innerHTML = `⏳ 대기 중인 작업 ${pending}건을 처리하고 있습니다…`;
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
