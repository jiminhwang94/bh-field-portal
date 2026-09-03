// 공통 UI 헬퍼 (이스케이프, 토스트, 모달, 클립보드)

export function h(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function toast(message, type = '') {
  const root = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast${type ? ' toast--' + type : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, type === 'err' ? 4600 : 2600);
}

export function closeModal() {
  $('#modalRoot').innerHTML = '';
}

/** 확인 다이얼로그. Promise<boolean> */
export function confirmDialog(title, message, okLabel = '확인', danger = false) {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    root.innerHTML = `
      <div class="modal" data-close="1">
        <div class="modal__box" role="dialog" aria-modal="true">
          <h2 class="modal__title">${h(title)}</h2>
          <p class="modal__msg">${h(message)}</p>
          <div class="form-actions">
            <button class="btn btn--ghost" data-act="cancel" type="button">취소</button>
            <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok" type="button">${h(okLabel)}</button>
          </div>
        </div>
      </div>`;
    const done = (value) => { closeModal(); resolve(value); };
    // 리스너는 매번 새로 만들어지는 .modal 에 연결한다(#modalRoot 에 누적 방지).
    root.querySelector('.modal').addEventListener('click', (ev) => {
      if (ev.target.dataset.close) done(false);
      const act = ev.target.dataset.act;
      if (act === 'cancel') done(false);
      if (act === 'ok') done(true);
    });
  });
}

/** 입력 프롬프트. Promise<string|null> */
export function promptDialog(title, { label = '', value = '', placeholder = '', okLabel = '저장' } = {}) {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    root.innerHTML = `
      <div class="modal" data-close="1">
        <form class="modal__box" role="dialog" aria-modal="true">
          <h2 class="modal__title">${h(title)}</h2>
          <div class="field">
            ${label ? `<label>${h(label)}</label>` : ''}
            <input class="input" id="promptInput" value="${h(value)}" placeholder="${h(placeholder)}" />
          </div>
          <div class="form-actions">
            <button class="btn btn--ghost" data-act="cancel" type="button">취소</button>
            <button class="btn btn--primary" type="submit">${h(okLabel)}</button>
          </div>
        </form>
      </div>`;
    const input = $('#promptInput');
    input.focus();
    input.select();
    const done = (v) => { closeModal(); resolve(v); };
    root.querySelector('.modal').addEventListener('click', (ev) => {
      if (ev.target.dataset.close || ev.target.dataset.act === 'cancel') done(null);
    });
    root.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      done(input.value.trim());
    });
  });
}

/** 임의 내용 모달. 반환된 box 엘리먼트에 이벤트를 연결해서 사용. */
export function openSheet(title, innerHtml) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="modal" data-close="1">
      <div class="modal__box" role="dialog" aria-modal="true">
        <div class="row row--between" style="margin-bottom:12px">
          <h2 class="modal__title" style="margin:0">${h(title)}</h2>
          <button class="btn btn--icon btn--ghost" data-act="close" type="button" aria-label="닫기">✕</button>
        </div>
        <div id="sheetBody">${innerHtml}</div>
      </div>
    </div>`;
  root.querySelector('.modal').addEventListener('click', (ev) => {
    if (ev.target.dataset.close || ev.target.dataset.act === 'close') closeModal();
  });
  return $('#sheetBody');
}

/** HTTP(비보안 컨텍스트)에서도 동작하는 클립보드 복사 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 폴백으로 진행 */ }
  // HTTP 접속(iPad Safari 등)에서는 clipboard API 를 쓸 수 없으므로
  // contenteditable + execCommand 방식으로 복사한다.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.contentEditable = 'true';
    ta.readOnly = false;
    // font-size 16px 미만이면 iOS 에서 화면이 확대된다.
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;' +
      'opacity:0;font-size:16px;border:0;padding:0;';
    document.body.appendChild(ta);

    const scrollY = window.scrollY;
    const range = document.createRange();
    range.selectNodeContents(ta);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    ta.focus();
    ta.setSelectionRange(0, text.length);

    const ok = document.execCommand('copy');
    selection.removeAllRanges();
    ta.remove();
    window.scrollTo(0, scrollY);
    return ok;
  } catch {
    return false;
  }
}

export function loading(target, message = '불러오는 중…') {
  target.innerHTML = `<div class="skeleton">${h(message)}</div>`;
}

export function errorView(target, message) {
  target.innerHTML = `
    <div class="empty">
      <p style="font-weight:700;color:var(--danger)">${h(message)}</p>
      <button class="btn btn--ghost" onclick="location.reload()" type="button">다시 시도</button>
    </div>`;
}

export const CATEGORY = {
  ERROR_CODE: { emoji: '🔴', label: '오류 코드 가이드', desc: '정량 측정 수치와 단계별 진단 절차' },
  HARDWARE_SOP: { emoji: '🔧', label: '하드웨어 교체 SOP', desc: '공구 준비 · 분해/조립 순서 · 토크값' },
  SOFTWARE_CMD: { emoji: '💻', label: 'SW & 명령어', desc: '펌웨어 · 캘리브레이션 명령어 원클릭 복사' },
};

export const FIELD_TYPE_LABEL = {
  TEXT: '한 줄 텍스트',
  TEXTAREA: '여러 줄 텍스트',
  NUMBER: '숫자',
  DROPDOWN: '드롭다운 선택',
  MEDIA: '사진 / 영상',
};

/**
 * 사람이 읽을 시각. `2026-09-02T14:03:50` 같은 기계용 문자열을
 * 디자인이 쓰는 `09-02 14:03` 으로 줄인다.
 *
 * 화면에 ISO 시각이 그대로 나오면 눈에 거슬리고 줄을 밀어낸다.
 * 올해가 아니면 연도를 남긴다 — 지난해 기록을 이번 주로 착각하면 곤란하다.
 */
export function when(value, { time = true } = {}) {
  const text = String(value || '');
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return text;
  const [, year, month, day, hh, mm] = m;
  const date = String(new Date().getFullYear()) === year
    ? `${month}-${day}` : `${year.slice(2)}-${month}-${day}`;
  return (time && hh) ? `${date} ${hh}:${mm}` : date;
}

// ------------------------------------------------------- 기기 안 사진 보여주기

/**
 * 기기에 저장한 사진을 화면에 띄운다.
 *
 * 사진 파일은 **기기 안(IndexedDB)** 에 있는데, 저장할 때 받아 두는 주소는
 * `/media/<파일명>` 이라는 **서버 경로**다. 브라우저로 접속했을 때는 서버가
 * 그 경로로 파일을 내주니 우연히 보였지만, APK 로 설치한 앱은 화면 파일이
 * 기기 안에 있어 그 경로에 아무것도 없다 — 그래서 **액박**이 떴다.
 *
 * 그러니 기기 안 파일을 직접 꺼내 보여 준다. 기기에 없으면(다른 사람이 올린
 * 사진) 그때만 서버 경로로 되돌아간다.
 *
 * 쓰는 법: `<img data-media="/media/xxx.jpg" />` 로 그린 뒤 hydrateMedia(root).
 */
export async function hydrateMedia(root = document) {
  // 사진(img) · 영상(video) · "열어 보기" 링크(a) 를 한꺼번에 채운다.
  const nodes = root.querySelectorAll(
    'img[data-media]:not([data-media-done]),'
    + 'video[data-media]:not([data-media-done]),'
    + 'a[data-media]:not([data-media-done])');
  if (!nodes.length) return;
  const [store, sync] = await Promise.all([
    import('./local/store.js'), import('./sync.js'),
  ]);
  const base = await sync.serverBase();
  for (const el of nodes) {
    el.setAttribute('data-media-done', '1');
    const raw = el.dataset.media || '';
    const filename = raw.split('/').pop();
    let url = '';
    try {
      const blob = await store.getMediaBlob(filename);
      if (blob) url = URL.createObjectURL(blob);
    } catch { /* 아래에서 서버 경로로 시도한다 */ }
    // 기기에 없다 — 웹으로 접속했으면 그 주소에서 받아 본다.
    if (!url && base) url = base + raw;

    if (!url) { el.replaceWith(brokenNote()); continue; }
    if (el.tagName === 'A') el.href = url;
    else el.src = url;
  }
}

function brokenNote() {
  const el = document.createElement('div');
  el.className = 'media-missing';
  el.textContent = '사진을 찾을 수 없습니다 (이 기기에 없음)';
  return el;
}
