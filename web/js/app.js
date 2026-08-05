// 해시 라우터 + 메인 화면
import { api } from './api.js';
import { $, h, CATEGORY, closeModal, errorView, loading, toast } from './ui.js';
import { guideListView, guideDetailView, guideEditView } from './views/guides.js';
import { inventoryView } from './views/inventory.js';
import { fieldsView } from './views/fields.js';
import { reportFormView, reportListView, reportDetailView } from './views/report.js';
import { settingsView } from './views/settings.js';
import { initUpdateWatcher } from './update.js';
import { initPublish } from './publish.js';
import { initInstallBanner } from './install.js';

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

async function render() {
  const { path, query } = parseHash();
  closeModal();   // 화면을 이동하면 열려 있던 모달/시트를 닫는다
  $('#backBtn').classList.toggle('is-visible', path !== '/' && path !== '');
  // 리포트 작성 화면에서는 하단 고정 버튼이 중복이므로 숨긴다.
  document.body.classList.toggle('hide-bottombar', path === '/report/new');
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
  const { items } = await api.listGuides();
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
  const { items } = await api.listGuides(null, q);
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
render();
// 예전 버전에서 등록된 오프라인 저장(서비스 워커)이 남아 있으면 정리한다.
cleanupLegacyServiceWorker();
initPublish();
initUpdateWatcher();
initInstallBanner();

async function cleanupLegacyServiceWorker() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('bh-')).map((k) => caches.delete(k)));
    }
    ['bh_outbox', 'bh_sync_rev', 'bh_sync_hash', 'bh_sync_hub_id',
     'bh_install_banner_off'].forEach((key) => localStorage.removeItem(key));
  } catch { /* 무시 */ }
}
