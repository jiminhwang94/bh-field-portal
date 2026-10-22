// 해시 라우터 + 메인 화면
import { api } from './api.js';
import { $, h, closeModal, errorView, loading, toast } from './ui.js';
import {
  guideAssignView, guideListView, guideHubView, guideModelView,
  modelHref, robotColor,
  row as guideRow,
} from './views/guides.js';
import { guideDetailView, guideEditView } from './views/guide-page.js';
import { inventoryView } from './views/inventory.js';
import { drivingView } from './views/driving.js';
import { fieldsView } from './views/fields.js';
import { reportFormView } from './views/report.js';
import { reportListView, reportDetailView } from './views/history.js';
import { storeHistoryView } from './views/store.js';
import { statsView } from './views/stats.js';
import { settingsView } from './views/settings.js';
import { initSyncButton } from './syncnow.js';
import { initInstallBanner } from './install.js';
import { initNetStatus, ensureFirstData, catchUpFromSheet } from './net.js';
import { initUpdateBanner, initVersionGate } from './update.js';
import { initErrorLog } from './errlog.js';
import { paintTestBanner } from './mode.js';

const view = $('#view');
const HEX = '[0-9a-f]{6,}';

/** @type {Array<[RegExp, (match: RegExpExecArray, query: URLSearchParams) => any]>} */
const routes = [
  [/^\/?$/, mainView],
  [/^\/search$/, searchView],
  [/^\/store$/, (m, q) => storeHistoryView(view, q.get('name'))],   // 매장별 이력
  [/^\/stats$/, (m, q) => statsView(view, q)],                      // 통계
  [/^\/guides$/, () => guideHubView(view)],        // 가이드 탭 — 로봇 고르기
  [/^\/guides\/assign$/, () => guideAssignView(view)],  // 로봇 한 번에 지정
  // 로봇 하나 — 종류(오류 코드 · 하드웨어 · SW) 셋과 그 목록
  [/^\/guides\/m\/([^/]+)(?:\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD))?$/,
    (m) => guideModelView(view, decodeURIComponent(m[1]), m[2] || null)],
  [/^\/guides\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/, (m) => guideListView(view, m[1])],
  [/^\/guides\/new\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/,
    (m, q) => guideEditView(view, null, m[1], q.get('model'))],
  [/^\/guides\/new$/, (m, q) => guideEditView(view, null, null, q.get('model'))],   // 종류는 폼 안에서 고른다
  [new RegExp(`^/guides/edit/(${HEX})$`), (m) => guideEditView(view, m[1])],
  [new RegExp(`^/guides/(${HEX})$`), (m) => guideDetailView(view, m[1])],
  [/^\/inventory$/, () => inventoryView(view)],
  [/^\/driving$/, () => drivingView(view)],
  [/^\/fields$/, () => fieldsView(view)],
  // 같은 화면이지만 하는 일이 다르다 — 주소가 새 리포트인지 수정인지를 정한다.
  [/^\/report\/(new|edit)$/, () => reportFormView(view)],
  [/^\/reports$/, (m, q) => reportListView(view, q)],   // ?q= 검색어 · ?open= 바로 열 건
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
    path === '/' || path.startsWith('/search') ? 'home'
    : path.startsWith('/guides') ? 'guides'
    : path.startsWith('/inventory') ? 'inventory'
    : path.startsWith('/driving') ? 'driving'
    : path.startsWith('/report/new') ? 'new'
    : path.startsWith('/reports') ? 'reports'
    : path.startsWith('/settings') || path.startsWith('/fields') ? 'settings'
    : '';
  document.querySelectorAll('.tab').forEach((/** @type {HTMLElement} */ el) => {
    if (el.dataset.tab === active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

/**
 * 상단바 오른쪽 — 새 리포트 화면에서는 [새로고침] 자리에 [구글 시트로 업로드] 가 온다.
 *
 * 업로드 버튼이 폼 맨 아래에만 있어 항목이 많으면 스크롤해 내려가야 보였다.
 * 그 화면에서 새로고침은 쓸 일이 거의 없으므로 자리를 내준다. 글자는 폼의
 * 실제 버튼에서 가져온다 (새 리포트 '구글 시트로 업로드' · 수정 '시트에 저장').
 */
function paintTopAction(path) {
  const onReport = path.startsWith('/report/');
  const action = $('#btn-topaction');
  const refresh = $('#btn-update');
  if (action) action.hidden = !onReport;
  if (refresh) refresh.hidden = onReport;
}

/**
 * 폼이 그려진 뒤 상단바 버튼을 폼의 버튼과 맞춘다 — 글자와 **눌림 여부**까지.
 *
 * 올리는 동안은 폼 쪽에서 둘 다 잠그는데, 화면을 떠났다 돌아왔을 때
 * 상단바 버튼만 잠긴 채로 남으면 다시는 못 누른다. 새 폼이 그려질 때마다
 * 폼 버튼 상태를 그대로 따라가게 해 그런 상태가 남지 않게 한다.
 */
function syncTopActionLabel() {
  const action = $('#btn-topaction');
  const submit = /** @type {HTMLButtonElement} */ (document.querySelector('#reportForm button[type=submit]'));
  if (action && submit) {
    action.textContent = submit.textContent.trim();
    action.disabled = submit.disabled;
  }
}

async function render() {
  const { path, query } = parseHash();
  closeModal();   // 화면을 이동하면 열려 있던 모달/시트를 닫는다
  $('#backBtn').hidden = (path === '/' || path === '');
  paintTabs(path);
  paintTopAction(path);
  paintNavBadge();
  view.scrollTop = 0;
  for (const [pattern, handler] of routes) {
    const match = pattern.exec(path);
    if (match) {
      try {
        await handler(match, query);
        syncTopActionLabel();
      } catch (err) {
        console.error(err);
        errorView(view, err.message || '알 수 없는 오류가 발생했습니다.');
      }
      return;
    }
  }
  view.innerHTML = `<div class="empty">존재하지 않는 화면입니다.<br /><a class="link" href="#/">메인으로 돌아가기</a></div>`;
}

// ------------------------------------------------------------- 홈 (D2 대시보드 타일형)
//
// 빈칸이 생기지 않는 격자. 현장에서 하는 일의 차례대로:
//   ┌ 새 리포트 쓰기 (두 칸) ─────────┬ 보충 필요 ┐
//   ├ 리포트 이력 (두 칸)            ├ 가이드    ┤  ← 로봇 칸이 세로로 늘어나 끝까지 채운다
//   └ 상태별 건수 · 검색 · 최근 기록 카드 ┴ 검색     ┘
async function mainView() {
  loading(view);
  const guides = (await api.listGuides()).items;          // 전부 기기에 있다 (오프라인 OK)
  const models = await api.listGuideModels();
  const drafts = (await api.listReports()).items.filter((r) => r.status !== 'UPLOADED');
  const month = await monthEntries();
  const stock = await lowStock();
  const attn = await api.attention();
  const overdue = (month ? month.entries : []).filter((e) => e.status !== '조치 완료' && openDays(e) >= OVERDUE_DAYS);
  const alerts = [];
  if (attn.pending && (attn.failed || attn.oldestMin >= 30)) {
    alerts.push({ tone: 'bad', href: '#/settings', text: `올리지 못한 것 ${attn.pending}건`,
                  sub: attn.failed ? '올리기가 실패했습니다 — 눌러서 확인' : `가장 오래된 것 ${agoText(attn.oldestMin)}` });
  }
  if (attn.conflicts) {
    alerts.push({ tone: 'warn', href: '#/settings', text: `남이 먼저 고친 가이드 ${attn.conflicts}건`,
                  sub: '내 것 · 남의 것 중 고르세요' });
  }
  if (overdue.length) {
    alerts.push({ tone: 'warn', href: '#/reports?old=1', text: `${OVERDUE_DAYS}일 넘게 끝나지 않은 리포트 ${overdue.length}건`,
                  sub: overdue.slice(0, 3).map((e) => e.store).filter(Boolean).join(' · ') });
  }

  const robots = [...models];
  for (const g of guides) {
    const k = (g.robotModel || '').trim();
    if (k && !robots.includes(k)) robots.push(k);
  }
  const unassigned = guides.filter((g) => !(g.robotModel || '').trim()).length;
  const catCount = (list, t) => list.filter((g) => g.categoryType === t).length;

  const entries = month ? month.entries : [];
  const tally = ['조치 진행 중', '교체 예정', '모니터링', '조치 완료'].map((s) => ({
    s, n: entries.filter((e) => e.status === s).length,
  }));

  view.innerHTML = `
    <div class="home2${alerts.length ? ' home2--alert' : ''}">
      ${alerts.length ? `
        <div class="h2-alerts" role="status">
          ${alerts.map((a) => `
            <a class="h2-alert" data-tone="${a.tone}" href="${a.href}">
              <b>${h(a.text)}</b>${a.sub ? `<span>${h(a.sub)}</span>` : ''}<span class="h2-alert__go" aria-hidden="true">›</span>
            </a>`).join('')}
        </div>` : ''}
      <a class="h2-new" href="#/report/new">
        <span class="h2-new__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h8l4 4v16H6z"/><path d="M12 11v6M9 14h6"/></svg>
        </span>
        <span class="h2-new__text">
          <span class="h2-new__title">새 리포트 쓰기</span>
          <span class="h2-new__sub">${drafts.length
            ? `올리지 않은 리포트 <b class="tnum">${drafts.length}</b>건이 있습니다`
            : '리포트 번호를 고르면 매장명이 채워집니다'}</span>
        </span>
        <span class="h2-new__go" aria-hidden="true">›</span>
      </a>

      <a class="h2-stock${stock.low ? '' : ' is-ok'}" href="#/inventory">
        <span class="h2-stock__label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6h11v10H2zM13 9h5l3 3.5V16h-8z"/></svg>
          ${stock.low ? '보충 필요' : '재고 충분'}
        </span>
        <span class="h2-stock__foot">
          <b class="h2-stock__n tnum">${stock.low}</b>
          <span>${stock.low ? `차량 ${stock.vehicles}대 · 재고 ›` : '재고 ›'}</span>
        </span>
      </a>

      <section class="h2-card h2-hist" aria-labelledby="homeHistTitle">
        <div class="h2-card__head">
          <h2 id="homeHistTitle">리포트 이력</h2>
          ${month ? tally.map((t) => `
            <span class="h2-tally" data-track="${TRACK_CLS[t.s]}"><span class="h2-tally__dot"></span>${h(SHORT_STATUS[t.s])} <b class="tnum">${t.n}</b></span>`).join('') : ''}
          <span class="spacer"></span>
          <a class="h2-more" href="#/stats">통계 ›</a>
          <a class="h2-more" href="#/reports">전체 ›</a>
        </div>
        <form class="home-search" id="histSearch" role="search">
          <input class="input" id="histSearchQ" type="search" autocomplete="off" enterkeyhint="search"
                 aria-label="이력 검색" placeholder="식당명 · 날짜로 이력 찾기" />
          <button class="btn btn-dark" type="submit">찾기</button>
        </form>
        <div class="h2-hist__grid">
          ${entries.length ? entries.slice(0, 6).map((e) => `
            <a class="h2-rcard" data-track="${TRACK_CLS[e.status] || 'doing'}" href="#/reports?open=${encodeURIComponent(e.key)}">
              <span class="h2-rcard__top">
                <span class="h2-rcard__date tnum">${h((e.date || '').slice(5) || '-')}</span>
                <span class="h2-rcard__status">${statusIcon(TRACK_CLS[e.status] || 'doing')}${h(SHORT_STATUS[e.status] || e.status)}</span>
              </span>
              <span class="h2-rcard__store">${h(e.store || '(식당명 없음)')}</span>
              ${e.summary ? `<span class="h2-rcard__sub">${h(e.summary)}</span>` : ''}
            </a>`).join('')
            : `<div class="empty">아직 받아 둔 이력이 없습니다.<br /><a class="link" href="#/reports">리포트 이력</a>을 한 번 열면 여기에 보입니다.</div>`}
        </div>
      </section>

      <section class="h2-card h2-guides" aria-labelledby="homeGuideTitle">
        <div class="h2-card__head">
          <h2 id="homeGuideTitle">가이드</h2>
          <span class="spacer"></span>
          <a class="h2-more" href="#/guides">전체 ›</a>
        </div>
        ${robots.map((m) => {
          const list = guides.filter((g) => (g.robotModel || '').trim() === m);
          return `
            <a class="h2-robot" href="${modelHref(m)}" style="--robot:${robotColor(m, models)}">
              <span class="h2-robot__badge">${h(robotShort(m))}</span>
              <span class="h2-robot__text">
                <span class="h2-robot__name">${h(m)}</span>
                <span class="h2-robot__meta">오류 ${catCount(list, 'ERROR_CODE')} · 하드웨어 ${catCount(list, 'HARDWARE_SOP')} · SW ${catCount(list, 'SOFTWARE_CMD')}</span>
              </span>
              <span class="h2-robot__go" aria-hidden="true">›</span>
            </a>`;
        }).join('')}
        ${unassigned ? `
          <a class="h2-robot h2-robot--none" href="#/guides/assign">
            <span class="h2-robot__badge">?</span>
            <span class="h2-robot__text">
              <span class="h2-robot__name">로봇 미지정</span>
              <span class="h2-robot__meta"><span class="tnum">${unassigned}</span>건 · 한 번에 지정하기</span>
            </span>
            <span class="h2-robot__go" aria-hidden="true">›</span>
          </a>` : ''}
        <form id="guideSearch" role="search">
          <input class="input" id="guideSearchQ" type="search" autocomplete="off" enterkeyhint="search"
                 aria-label="가이드 검색" placeholder="오류 코드 검색 (E-101)" />
        </form>
      </section>
    </div>`;

  $('#histSearch').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('#histSearchQ').value.trim();
    location.hash = q ? `#/reports?q=${encodeURIComponent(q)}` : '#/reports';
  });
  $('#guideSearch').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('#guideSearchQ').value.trim();
    if (!q) { toast('검색어를 입력하세요.'); return; }
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
}

/** 끝나지 않은 채 이만큼 지나면 홈 · 이력에서 눈에 띄게 알린다. */
const OVERDUE_DAYS = 7;
/** 작성한 날부터 며칠째인가 (작성일 = 1일째) */
function openDays(entry) {
  const at = new Date(String(entry.createdAt || entry.date || '').replace(' ', 'T'));
  if (Number.isNaN(at.getTime())) return 0;
  return Math.floor((Date.now() - at.getTime()) / 86400000) + 1;
}
const agoText = (min) => (min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 전` : `${Math.floor(min / 1440)}일 전`);

/** 이력 화면의 상태 이름 → 색 이름표 (같은 뜻에 같은 색). */
const TRACK_CLS = { '조치 진행 중': 'doing', '교체 예정': 'swap', '모니터링': 'watch', '조치 완료': 'done' };
const SHORT_STATUS = { '조치 진행 중': '진행 중', '교체 예정': '교체 예정', '모니터링': '모니터링', '조치 완료': '완료' };
/** 상태마다 모양이 다른 아이콘 — 색을 못 가려도 모양으로 읽힌다. */
const STATUS_ICON = {
  doing: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  watch: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  done: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12.5l2.5 2.5L16 9.5',
};
const statusIcon = (cls) => `<svg class="st-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${STATUS_ICON[cls]}"/></svg>`;
/** 로봇 글자 배지 — Gen.1 → G1, Zephyr → Z */
const robotShort = (name) => {
  const m = String(name).match(/^([A-Za-z])[A-Za-z]*[.\s-]*(\d+)/);
  return m ? `${m[1].toUpperCase()}${m[2]}` : String(name).trim().slice(0, 1).toUpperCase();
};

/** 보충이 필요한 품목 수와 그 차량 수 — 모든 차량. */
async function lowStock() {
  try {
    const store = await import('./local/store.js');
    const low = (await store.listInventory()).filter((i) => i.minQuantity > 0 && i.quantity < i.minQuantity);
    return { low: low.length, vehicles: new Set(low.map((i) => i.vehicleName)).size };
  } catch {
    return { low: 0, vehicles: 0 };
  }
}

/**
 * 이번 달 이력 — 기기에 받아 둔 사본만 본다. 홈을 열 때마다 시트를 부르면 느리고,
 * 오프라인에서는 아예 안 된다. 사본이 없으면 null.
 */
async function monthEntries() {
  try {
    const store = await import('./local/store.js');
    const d = new Date();
    const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const cached = await store.getMeta(`sheetReports:${name}`, null);
    if (!cached || !(cached.entries || []).length) return null;
    const entries = [...cached.entries].sort((a, b) =>
      String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));
    return { name, entries };
  } catch {
    return null;
  }
}

/** 왼쪽 메뉴 [차량 재고] 옆 숫자 — 보충이 필요한 품목 수 (모든 차량). */
async function paintNavBadge() {
  const badge = document.getElementById('invBadge');
  if (!badge) return;
  try {
    const store = await import('./local/store.js');
    const low = (await store.listInventory())
      .filter((i) => i.minQuantity > 0 && i.quantity < i.minQuantity).length;
    badge.textContent = low;
    badge.hidden = !low;
    badge.setAttribute('aria-label', `보충 필요 ${low}건`);
  } catch {
    badge.hidden = true;
  }
}

// ------------------------------------------------------------- 검색 결과
async function searchView(_match, query) {
  const q = query.get('q') || '';
  loading(view);
  const items = (await api.listGuides(null, q)).items;
  view.innerHTML = `
    <div class="page-head">
      <a class="crumb" href="#/guides">가이드</a>
      <h1 class="page-head__title">검색 결과</h1>
      <span class="page-head__meta">"${h(q)}" · <span class="tnum">${items.length}</span>건 — 모든 로봇의 코드 · 요약 · 공구 · 단계 · 명령어</span>
    </div>
    <form class="search-row" id="searchForm" role="search">
      <input class="input" id="searchInput" type="search" value="${h(q)}"
             enterkeyhint="search" aria-label="가이드 검색" />
      <button class="btn btn-primary" type="submit">재검색</button>
    </form>
    ${items.length ? `<div class="rows">${items.map((g) => guideRow(g, true)).join('')}</div>`
      : '<div class="empty">일치하는 가이드가 없습니다.</div>'}`;
  $('#searchForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const next = $('#searchInput').value.trim();
    location.hash = next ? `#/search?q=${encodeURIComponent(next)}` : '#/guides';
  });
}

// ------------------------------------------------------------------ 부팅
$('#backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.hash = '#/';
});

// 상단바의 [구글 시트로 업로드] — 폼 아래 버튼을 대신 눌러 준다.
// 저장 규칙(필수 칸·첨부 한도)은 폼 쪽 한 곳에만 있어야 어긋나지 않는다.
$('#btn-topaction').addEventListener('click', () => {
  const submit = /** @type {HTMLButtonElement} */ (document.querySelector('#reportForm button[type=submit]'));
  if (!submit) return;
  if (submit.disabled) { toast('저장 중입니다. 잠시만 기다려 주세요.'); return; }
  submit.click();
});

window.addEventListener('hashchange', render);
// 재고 화면에서 수량을 바꾸면 왼쪽 메뉴의 [보충 필요] 숫자도 맞춘다.
window.addEventListener('bh-inventory-changed', paintNavBadge);

// 화면을 **먼저** 띄운다. 시트에서 받아오는 일은 뒤에서 한다.
// 예전에는 시트 왕복 세 번이 끝나기를 기다렸다가 그려서, 앱을 열거나
// 웹 페이지를 새로고침하면 3~8초 동안 빈 화면이었다.
(async () => {
  const added = await ensureFirstData();   // 기기 안에서 끝나는 준비 (수십 ms)
  render();
  if (added) render();                     // 붙박이 항목이 방금 들어왔으면 한 번 더
  catchUpFromSheet();                      // 시트 최신본은 뒤에서 조용히
  // 시트 연결 — 주소가 비어 있으면 공용 주소를 적어 넣고, 처음이면 확인해 알린다.
  import('./connect.js').then((c) => c.ensureSheetConnection()).catch(() => {});
  // 남이 올린 새 내용이 있으면 [새로고침] 에 점 · 내 것이 올라가면 한 줄 알림.
  // 화면은 건드리지 않는다 — 받는 시점은 사람이 정한다.
  import('./changes.js').then((c) => c.initChangeWatch()).catch(() => {});
})();
initErrorLog();                // 화면 오류를 모았다가 시트 '오류기록' 으로
paintTestBanner();             // 테스트 모드면 맨 위 노란 띠
initVersionGate();             // 시트가 요구하는 최소 버전보다 낮으면 화면을 덮는다
registerServiceWorker();       // 오프라인에서 앱이 열리도록
initUpdateBanner();            // 새 버전 안내 띠 (지난번 받아 둔 정보로 먼저 그린다)
initNetStatus();               //  오프라인 표시 + 대기 작업 자동 처리
initSyncButton();
initInstallBanner();


/** 앱 화면 파일을 기기에 담아 두어 인터넷 없이도 앱이 열리게 한다. */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // http:// 로 접속하면 브라우저가 서비스워커를 막는다(localhost 는 예외).
  if (!window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch { /* 등록 실패해도 데이터는 기기에 있으므로 앱은 동작한다 */ }
}
