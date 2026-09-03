// 앱 설치(PWA) — 설정 화면의 [앱 설치] 버튼과 첫 방문 배너
import { $, h, closeModal, openSheet, toast } from './ui.js';

const DISMISS_KEY = 'bh_install_banner_off';

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Chrome 계열이 제공하는 설치 프롬프트 이벤트 (index.html 에서 미리 보관) */
function deferred() {
  return window.__bhInstallPrompt || null;
}

export function canInstallDirectly() {
  return !!deferred() && !isStandalone();
}

/** 실제 설치를 실행한다. 프롬프트를 쓸 수 없으면 기기별 안내를 띄운다. */
export async function installApp() {
  const prompt = deferred();
  if (prompt) {
    try {
      prompt.prompt();
      const choice = await prompt.userChoice;
      window.__bhInstallPrompt = null;
      if (choice && choice.outcome === 'accepted') {
        toast('앱이 설치되었습니다. 홈 화면 아이콘으로 실행하세요.', 'ok');
        return true;
      }
      toast('설치를 취소했습니다.');
      return false;
    } catch {
      window.__bhInstallPrompt = null;
    }
  }
  showManualGuide();
  return false;
}

export function showManualGuide() {
  const ios = isIOS();
  const body = openSheet('앱 설치하기', `
    ${ios ? `
      <p class="muted" style="margin:0 0 14px;line-height:1.7">
        iPhone·iPad 는 브라우저가 설치 버튼을 제공하지 않습니다.
        <strong>Safari</strong> 에서 아래 3단계로 설치하세요.
      </p>
      <ol style="line-height:2;padding-left:22px;margin:0">
        <li>이 화면을 <strong>Safari</strong> 로 엽니다. (Chrome 은 설치가 안 됩니다)</li>
        <li>하단(또는 상단)의 <strong>공유 ⬆</strong>버튼을 누릅니다.</li>
        <li><strong>[홈 화면에 추가]</strong> → <strong>[추가]</strong></li>
      </ol>`
    : `
      <p class="muted" style="margin:0 0 14px;line-height:1.7">
        이 브라우저에서는 설치 버튼이 아직 준비되지 않았습니다.
        아래 방법으로 설치하거나, 페이지를 새로고침한 뒤 다시 시도해 보세요.
      </p>
      <ol style="line-height:2;padding-left:22px;margin:0">
        <li><strong>Chrome</strong> 으로 이 주소를 엽니다.</li>
        <li>주소창 오른쪽의 <strong>설치 아이콘</strong>,
            또는 <strong>⋮ → 앱 설치 / 홈 화면에 추가</strong> 를 선택합니다.</li>
        <li>설치 후 홈 화면 아이콘으로 실행하면 전체화면 앱으로 동작합니다.</li>
      </ol>`}

    <div class="sub-card" style="margin-top:16px">
      <strong>Play 스토어에서 찾지 마세요</strong>
      <p class="muted" style="margin:6px 0 0;font-size:.9rem;line-height:1.6">
        이 앱은 스토어에 등록된 앱이 아니라, 브라우저에서 주소로 접속해 설치하는 방식입니다.
        스토어에서 비슷한 이름의 앱을 설치하면 전혀 다른 앱이며,
        "Google Play AR 서비스 필요" 같은 오류는 이 앱과 무관합니다.
      </p>
    </div>

    <div class="form-actions">
      <button class="btn btn--primary" type="button" data-act="close">확인</button>
    </div>`);
  return body;
}

/** 설치 가능하고 아직 설치하지 않았다면 첫 화면에 한 번 안내 배너를 띄운다. */
export function initInstallBanner() {
  if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

  const show = () => {
    if (document.getElementById('installBanner')) return;
    if (localStorage.getItem(DISMISS_KEY) || isStandalone()) return;
    const banner = document.createElement('div');
    banner.id = 'installBanner';
    banner.className = 'update-banner';
    banner.innerHTML = `
      <span>이 앱을 태블릿에 설치해 전체화면으로 쓸 수 있습니다.</span>
      <button class="btn btn--sm btn--primary" id="installNowBtn" type="button">앱 설치</button>
      <button class="btn btn--sm btn--ghost" id="installLaterBtn" type="button">닫기</button>`;
    document.body.appendChild(banner);
    $('#installNowBtn').addEventListener('click', async () => {
      banner.remove();
      await installApp();
    });
    $('#installLaterBtn').addEventListener('click', () => {
      localStorage.setItem(DISMISS_KEY, '1');
      banner.remove();
    });
  };

  if (canInstallDirectly() || isIOS()) {
    setTimeout(show, 1200);
  } else {
    // 프롬프트 이벤트가 늦게 도착하는 경우 대비
    window.addEventListener('bh-install-available', () => setTimeout(show, 300),
      { once: true });
  }

  window.addEventListener('appinstalled', () => {
    localStorage.setItem(DISMISS_KEY, '1');
    const banner = document.getElementById('installBanner');
    if (banner) banner.remove();
    toast('앱 설치가 완료되었습니다.', 'ok');
  });
}

export function installStateLabel() {
  if (isStandalone()) return { text: '앱으로 실행 중', ok: true };
  if (canInstallDirectly()) return { text: '설치 가능', ok: false };
  return { text: isIOS() ? 'Safari 공유 → 홈 화면에 추가' : '브라우저로 실행 중', ok: false };
}

export { h, closeModal };
