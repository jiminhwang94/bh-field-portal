// 접근 보호 — 팀 공용 PIN
// PIN 이 설정돼 있으면 첫 접속에 1회 입력하고, 이후에는 기기가 기억한다(쿠키).
import { api } from './api.js';
import { $, h } from './ui.js';

/** PIN 이 필요하면 잠금 화면을 띄우고, 통과할 때까지 기다린다. */
export async function ensureAccess() {
  let status;
  try {
    status = await api.authStatus();
  } catch {
    return true;        // 서버에 못 닿으면 잠금 화면 대신 평소 오류 흐름을 따른다
  }
  if (!status.required || status.authorized) return true;
  await showLock();
  return true;
}

function showLock() {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    root.innerHTML = `
      <div class="modal lock">
        <form class="modal__box lock__box" autocomplete="off">
          <div class="lock__logo">🤖</div>
          <h2 class="modal__title" style="text-align:center">로봇 현장 대응 포털</h2>
          <p class="muted" style="text-align:center;margin:0 0 20px;font-size:.93rem">
            팀 공용 접근 PIN 을 입력하세요.<br />
            이 기기에서는 한 번만 입력하면 됩니다.
          </p>
          <div class="field">
            <input class="input lock__pin" id="pinInput" type="password"
                   inputmode="numeric" autocomplete="one-time-code"
                   placeholder="• • • •" maxlength="12" />
            <span class="hint" id="pinHint">PIN 을 모르면 팀 담당자에게 문의하세요.</span>
          </div>
          <button class="btn btn--primary btn--xl" type="submit">확인</button>
        </form>
      </div>`;

    const input = $('#pinInput');
    const hint = $('#pinHint');
    input.focus();

    root.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pin = input.value.trim();
      if (!pin) return;
      const button = root.querySelector('button[type=submit]');
      button.disabled = true;
      button.textContent = '확인 중…';
      try {
        await api.authLogin(pin);
        root.innerHTML = '';
        resolve(true);
      } catch (err) {
        hint.textContent = err.message || 'PIN 이 맞지 않습니다.';
        hint.style.color = 'var(--danger)';
        input.value = '';
        input.focus();
        button.disabled = false;
        button.textContent = '확인';
      }
    });
  });
}

/** 401 이 돌아오면(PIN 이 새로 걸린 경우) 잠금 화면을 다시 띄운다. */
export function handleUnauthorized() {
  if (document.querySelector('.lock')) return;
  showLock().then(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
}

export { h };
