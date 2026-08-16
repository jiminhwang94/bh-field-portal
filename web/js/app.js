// 해시 라우터 + 메인 화면
import { api, setUnauthorizedHandler } from './api.js';
import { $, h, CATEGORY, closeModal, errorView, loading, openSheet, toast } from './ui.js';
import { guideListView, guideDetailView, guideEditView } from './views/guides.js';
import { inventoryView } from './views/inventory.js';
import { fieldsView } from './views/fields.js';
import { reportFormView, reportListView, reportDetailView } from './views/report.js';
import { settingsView } from './views/settings.js';
import { initUpdateWatcher } from './update.js';
import { initPublish } from './publish.js';
import { initInstallBanner } from './install.js';
import { ensureAccess, handleUnauthorized } from './auth.js';
import { initNetStatus, ensureFirstData } from './net.js';

const view = $('#view');
const HEX = '[0-9a-f]{6,}';

const routes = [
  [/^\/?$/, mainView],
  [/^\/search$/, searchView],
  [/^\/guides\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/, (m) => guideListView(view, m[1])],
  [/^\/guides\/new\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/, (m) => guideEditView(view, null, m[1])],
  [new RegExp(`^/guides/edit/(${HEX})$`), (m) => guideEditView(view, m[1])],
  [new RegExp(`^/guides/(${HEX})$`), (m) => guideDetailView(view, m[1])],
  [/^\/inventory$/, () => inventoryView(view)],
  [/^\/fields$/, () => fieldsView(view)],
  [/^\/report\/new$/, () => reportFormView(view)],
  [/^\/reports$/, () => reportListView(view)],
  [new RegExp(`^/reports/(${HEX})$`), (m) => reportDetailView(view, m[1])],
  [/^\/settings$/, () => settingsView(view)],
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(queryString || '') };
}

function paintTabs(path) {
  const active =
    path === '/' || path.startsWith('/search') || path.startsWith('/guides') ? 'home'
    : path.startsWith('/inventory') ? 'inventory'
    : path.startsWith('/report/new') ? 'new'
    : path.startsWith('/reports') ? 'reports'
    : path.startsWith('/settings') || path.startsWith('/fields') ? 'settings'
    : '';
  document.querySelectorAll('.tabbar__item').forEach((el) => {
    el.classList.toggle('is-on', el.dataset.tab === active);
  });
}

async function render() {
  const { path, query } = parseHash();
  closeModal();   // 화면을 이동하면 열려 있던 모달/시트를 닫는다
  $('#backBtn').classList.toggle('is-visible', path !== '/' && path !== '');
  paintTabs(path);
  window.scrollTo({ top: 0 });
  for (const [pattern, handler] of routes) {
    const match = pattern.exec(path);
    if (match) {
      try {
        await handler(match, query);
      } catch (err) {
        console.error(err);
        errorView(view, err.message || '알 수 없는 오류가 발생했습니다.');
      }
      return;
    }
  }
  view.innerHTML = `<div class="empty">존재하지 않는 화면입니다.<br /><a class="link" href="#/">메인으로 돌아가기</a></div>`;
}

// ------------------------------------------------------------- 메인 화면
async function mainView() {
  loading(view);
  // 가이드는 전부 기기에 있으므로 오프라인에서도 그대로 보인다.
  const items = (await api.listGuides()).items;
  const counts = items.reduce((acc, g) => {
    acc[g.categoryType] = (acc[g.categoryType] || 0) + 1;
    return acc;
  }, {});
  const recent = [...items]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 4);

  view.innerHTML = `
    <form class="search" id="searchForm" role="search">
      <input id="searchInput" type="search" placeholder="오류 코드 · 부품명 · 명령어 통합 검색"
             autocomplete="off" enterkeyhint="search" />
      <button class="btn btn--primary" type="submit">검색</button>
    </form>

    <div class="cards">
      ${Object.entries(CATEGORY).map(([type, meta]) => `
        <a class="card cat-${type}" href="#/guides/${type}">
          <div class="card__emoji">${meta.emoji}</div>
          <div class="card__title">${h(meta.label)}</div>
          <div class="card__desc">${h(meta.desc)}</div>
          <div class="card__count">${counts[type] || 0}건 등록됨 →</div>
        </a>`).join('')}
    </div>

    <div class="panel" style="margin-top:20px">
      <h2 class="panel__title">최근 수정된 가이드</h2>
      ${recent.length ? `<div class="list">${recent.map(guideRow).join('')}</div>`
        : '<div class="empty">등록된 가이드가 없습니다. 카테고리에서 새 가이드를 추가하세요.</div>'}
    </div>`;

  $('#searchForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) { toast('검색어를 입력하세요.'); return; }
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
}

function guideRow(guide) {
  const meta = CATEGORY[guide.categoryType] || { emoji: '📄', label: '' };
  return `
    <a class="item cat-${guide.categoryType}" href="#/guides/${guide.id}">
      <div style="font-size:1.4rem">${meta.emoji}</div>
      <div class="item__body">
        <div class="item__title">${h(guide.codeOrTitle)}</div>
        <div class="item__sub">${h(guide.summary || meta.label)}</div>
      </div>
      <span class="badge">${guide.stepCount || 0}단계</span>
      <span class="item__chevron">›</span>
    </a>`;
}

// ------------------------------------------------------------- 검색 결과
async function searchView(_match, query) {
  const q = query.get('q') || '';
  loading(view);
  const items = (await api.listGuides(null, q)).items;
  view.innerHTML = `
    <div class="page-head">
      <h1>검색 결과</h1>
      <p>"${h(q)}" · ${items.length}건 (코드 · 요약 · 공구 · 단계 · 명령어 전체 검색)</p>
    </div>
    <form class="search" id="searchForm">
      <input id="searchInput" type="search" value="${h(q)}" enterkeyhint="search" />
      <button class="btn btn--primary" type="submit">재검색</button>
    </form>
    ${items.length ? `<div class="list">${items.map(guideRow).join('')}</div>`
      : '<div class="empty">일치하는 가이드가 없습니다.</div>'}`;
  $('#searchForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const next = $('#searchInput').value.trim();
    location.hash = next ? `#/search?q=${encodeURIComponent(next)}` : '#/';
  });
}

// ------------------------------------------------------------------ 부팅
$('#backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.hash = '#/';
});

window.addEventListener('hashchange', render);
setUnauthorizedHandler(handleUnauthorized);

// PIN 이 설정돼 있으면 잠금 화면을 먼저 통과한 뒤 화면을 그린다.
(async () => {
  await ensureAccess();
  await ensureFirstData();     // 처음 실행이면 서버에서 자료를 한 번 받는다
  render();
})();
registerServiceWorker();       // 오프라인에서 앱이 열리도록
initNetStatus();               // 📴 오프라인 표시 + 대기 작업 자동 처리
initPublish();
initUpdateWatcher();
initInstallBanner();
showFirstRunGuide();

/** 처음 쓰는 사람에게 [업데이트] 개념을 1회만 설명한다. */
function showFirstRunGuide() {
  const KEY = 'bh_intro_done';
  if (localStorage.getItem(KEY)) return;
  setTimeout(() => {
    if (localStorage.getItem(KEY) || document.querySelector('.modal')) return;
    const body = openSheet('처음 오셨네요 👋', `
      <p class="muted" style="margin:0 0 14px;line-height:1.7">
        이 앱은 <strong>가이드·재고·항목</strong>을 팀이 함께 씁니다.
        딱 두 가지만 알면 됩니다.
      </p>
      <div class="sub-card" style="margin-bottom:10px">
        <strong>1️⃣ 내가 고친 내용은 처음엔 나만 보입니다</strong>
        <p class="muted" style="margin:6px 0 0;font-size:.9rem">
          가이드를 추가·수정·삭제하면 우선 내 화면에만 반영돼요. 마음껏 정리해도 괜찮습니다.
        </p>
      </div>
      <div class="sub-card" style="margin-bottom:10px;border-color:var(--pending)">
        <strong>2️⃣ 상단 [⬆️ 업데이트] 를 누르면 모두에게 적용됩니다</strong>
        <p class="muted" style="margin:6px 0 0;font-size:.9rem">
          올릴 내용이 있으면 버튼이 <span style="color:var(--pending);font-weight:800">노란색</span>으로
          바뀝니다. 다른 사람이 업데이트한 내용은 자동으로 받아옵니다.
        </p>
      </div>
      <div class="sub-card">
        <strong>💡 재고 수량은 예외 — 바로 공유됩니다</strong>
        <p class="muted" style="margin:6px 0 0;font-size:.9rem">
          부품을 쓰고 [−] 를 누르면 즉시 모두에게 반영돼요. (품목·차량 추가·삭제는 [업데이트] 대상)
        </p>
      </div>
      <div class="form-actions">
        <button class="btn btn--primary btn--xl" type="button" data-act="close">
          알겠습니다
        </button>
      </div>`);
    localStorage.setItem(KEY, '1');
    return body;
  }, 1500);
}

/** 앱 화면 파일을 기기에 담아 두어 인터넷 없이도 앱이 열리게 한다. */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // http:// 로 접속하면 브라우저가 서비스워커를 막는다(localhost 는 예외).
  if (!window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch { /* 등록 실패해도 데이터는 기기에 있으므로 앱은 동작한다 */ }
}
