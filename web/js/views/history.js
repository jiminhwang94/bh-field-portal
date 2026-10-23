// 리포트 이력 — 목록 · 표 상세 · 상태 바꾸기 · 사진 보기 / 기기 안 리포트 상세. 작성은 views/report.js
import { api } from '../api.js';
import { MEDIA_FILE_LIMIT, MEDIA_TOTAL_LIMIT, MEDIA_FILE_LIMIT_TEXT, MEDIA_TOTAL_LIMIT_TEXT } from '../sheets.js';
import {
  $, closeModal, confirmDialog, copyText, h, hydrateMedia, loading, openSheet,
  toast, when,
} from '../ui.js';
import { reportToText, shareReport } from '../share.js';
import {
  cachedRequestNumbers, describeFiles, explain as explainError, findVisits,
  previewUrl, pullRequestNumbers, thumbUrl,
} from '../reportsheet.js';

import { ICON, seedFromEntry, TRACK, trackOf, warnPrivateVideo } from './report-common.js';
import { guidesForCode, findWork, isCodeShaped, sameRobot, valueOf } from '../insights.js';

/** 상세에서 오류 코드 → 가이드를 잇는 데 쓴다 (기기 안 가이드, 화면을 열 때 한 번 받는다) */
let knownGuides = [];
const loadGuides = () => api.listGuides().then((r) => { knownGuides = r.items || []; }).catch(() => {});
/** 작업 목록 — 리포트의 작업 → 이어 둔 가이드 (v3.31) */
let knownWork = { cats: [], items: [] };
const loadWork = () => api.workList().then((l) => { knownWork = l; }).catch(() => {});

/** 이 리포트의 작업 — '작업' 칸, 없으면 예전 '오류 코드' 칸에 적힌 분류 글자 */
const workOf = (entry) => valueOf(entry, '작업') || (entry.code && !isCodeShaped(entry.code) ? entry.code : '');

// ------------------------------------------------------------ 이력 목록
const STATUS = {
  DRAFT: ['badge', '저장됨 (업로드 안 함)'],
  QUEUED: ['badge badge--warn', '업로드 대기 (연결되면 자동)'],
  UPLOADED: ['badge badge--ok', '구글 시트 업로드 완료'],
  FAILED: ['badge badge--danger', '업로드 실패'],
};

/** 상태마다 모양이 다른 아이콘 — 색을 못 가려도 모양으로 읽힌다 (홈과 같은 그림). */
const STATUS_ICON = {
  doing: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  watch: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  done: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12.5l2.5 2.5L16 9.5',
  all: 'M4 6h16M4 12h16M4 18h16',
};
const stIcon = (cls) => `<svg class="st-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${STATUS_ICON[cls]}"/></svg>`;

/** 끝나지 않은 채 이만큼 지나면 '늦음' 으로 눈에 띄게 (홈과 같은 기준) */
const OVERDUE_DAYS = 7;
function openDays(entry) {
  const at = new Date(String(entry.createdAt || entry.date || '').replace(' ', 'T'));
  if (Number.isNaN(at.getTime())) return 0;
  return Math.floor((Date.now() - at.getTime()) / 86400000) + 1;
}

/** 끝나지 않은 건이 며칠째인가 — '오늘' · 'N일째'. 끝난 건은 빈 글자. */
function ageText(entry) {
  if (entry.status === '조치 완료') return '';
  const at = new Date(String(entry.createdAt || entry.date || '').replace(' ', 'T'));
  if (Number.isNaN(at.getTime())) return '';
  const days = Math.floor((Date.now() - at.getTime()) / 86400000);
  return days <= 0 ? '오늘' : `${days + 1}일째`;
}

/**
 * 드라이브 썸네일이 막힌 사진을 되살린다.
 *
 * `drive.google.com/thumbnail` 은 파일이 공개돼 있을 때만 그림을 준다.
 * 공유 드라이브는 조직 정책으로 링크 공개가 막힐 수 있어서, 그런 현장에서는
 * 사진이 전부 액박이 됐다. 그때는 Apps Script 로 바이트를 직접 받아 끼운다.
 * 한 번 받은 것은 기기에 남아 다음부터는 즉시 뜬다.
 */
function reviveBrokenThumbs(root) {
  const shots = [...root.querySelectorAll('img[data-drive]')]
    .filter((el) => !el.dataset.driveDone);
  if (!shots.length) return;
  import('../drivemedia.js').then(({ reviveImage }) => {
    for (const el of shots) {
      el.dataset.driveDone = '1';
      const size = el.dataset.driveSize === 'full' ? 'full' : 'thumb';
      const tryRevive = () => reviveImage(el, el.dataset.drive, size);
      // 이미 실패했으면 지금, 아직 받는 중이면 실패할 때.
      if (el.complete && !el.naturalWidth) tryRevive();
      else el.addEventListener('error', tryRevive, { once: true });
    }
  }).catch(() => { /* 못 불러와도 [드라이브에서 열기] 는 그대로 쓸 수 있다 */ });
}

/**
 * 시트 한 줄의 상세 — 현장에서 다시 볼 때 중요한 차례대로.
 *   로봇(모델 · 시리얼 · 오류 코드) → 증상 → 조치(+처리 결과) → 사진 · 영상
 *   → 그 밖의 항목(접힘) → 상태(맨 아래, 누르면 시트에 바로 기록) → 수정 · 이어서 · 삭제
 * 이력 화면 오른쪽 패널과 [지난 방문] 창이 같은 모양을 쓴다.
 */
const has = (label, ...words) => words.some((w) => String(label || '').includes(w));
/** 안 끝난 것을 앞에 — 이력의 상태 칩과 같은 차례. */
const STATUS_ORDER = ['조치 진행 중', '교체 예정', '모니터링', '조치 완료'];

function entryParts(entry) {
  const robot = [];
  const symptom = [];
  const action = [];
  const result = [];
  const rest = [];
  for (const v of entry.values || []) {
    if (String(v.label || '').replace(/\s/g, '') === '작업') continue;   // 증상 줄 위에 따로 (작업 한 줄)
    if (has(v.label, '로봇', '시리얼') || has(v.label, '오류 코드')) robot.push(v);
    else if (has(v.label, '증상')) symptom.push(v);
    else if (has(v.label, '처리 결과', '결과')) result.push(v);
    else if (has(v.label, '조치')) action.push(v);
    else if (has(v.label, '식당', '매장')) continue;        // 제목에 이미 있다
    else rest.push(v);
  }
  return { robot, symptom, action, result, rest };
}

function entryDetailHtml(entry) {
  const p = entryParts(entry);
  const t = trackOf(entry.status);
  const ICON = {
    robot: 'M6 8h12v10H6zM9 8V5h6v3M9 12h.01M15 12h.01M10 15h4',
    symptom: 'M12 8v5M12 16.5v.01M12 3 2 20h20z',
    action: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z',
    media: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  };
  const label = (sec, text) => `
    <span class="hd2-label"><span class="hd2-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[sec]}"/></svg></span>${text}</span>`;
  const text = (list, empty) => (list.length
    ? list.map((v) => `<p class="hd-text">${h(v.value)}</p>`).join('')
    : `<p class="hd-text hd-text--empty">${empty}</p>`);
  const age = ageText(entry);
  return `
    <div class="hd2">
      <div class="hd2-head">
        <span class="hd2-head__text">
          <span class="hd-meta">${h([entry.sheetName, when(entry.createdAt || entry.date), entry.author]
            .filter((v) => v && v !== '-').join(' · '))}</span>
          ${entry.store
            ? `<a class="hd-title hd-title--link" href="#/store?name=${encodeURIComponent(entry.store)}"
                  title="이 매장의 지난 기록">${h(entry.store)} <span aria-hidden="true">›</span></a>`
            : '<h2 class="hd-title">(식당명 없음)</h2>'}
        </span>
        <span class="hd2-badge" data-track="${t.cls}">${stIcon(t.cls)}${h(entry.status)}${age ? ` · ${age}` : ''}</span>
      </div>

      <div class="hd2-row" data-sec="robot">
        ${label('robot', '로봇')}
        <div class="hd2-body">
          ${p.robot.length ? `<div class="hd-facts">
            ${p.robot.map((v) => `<span class="hd-fact"><span class="hd-fact__k">${h(v.label)}</span><b class="hd-fact__v">${h(v.value)}</b></span>`).join('')}
          </div>` : '<p class="hd-text hd-text--empty">적힌 로봇 정보가 없습니다.</p>'}
        </div>
      </div>
      <div class="hd2-row" data-sec="symptom">
        ${label('symptom', '증상')}
        <div class="hd2-body">${workOf(entry) ? `<span class="hd-work"><b>작업</b> ${h(workOf(entry))}</span>` : ''}${text(p.symptom, '적힌 증상이 없습니다.')}${guideLinksHtml(entry)}</div>
      </div>
      <div class="hd2-row" data-sec="action">
        ${label('action', '조치')}
        <div class="hd2-body">
          ${text(p.action, '적힌 조치가 없습니다.')}
          ${p.result.map((v) => `<span class="hd-result">${h(v.label)} · <b>${h(v.value)}</b></span>`).join('')}
        </div>
      </div>
      <div class="hd2-row" data-sec="media">
        ${label('media', `사진·영상<span class="tnum">${entry.links.length}</span>`)}
        <div class="hd2-body">
          ${entry.links.length ? `
            <div class="media-grid hd-media">
              ${entry.links.map((l, i) => `
                <button class="media-tile" data-act="view" data-idx="${i}" type="button"
                        style="padding:0;cursor:zoom-in" aria-label="${h(l.label)} 크게 보기">
                  ${l.id
                    ? `<img src="${h(thumbUrl(l.id, 400))}" alt="${h(l.label)}" loading="lazy"
                            data-drive="${h(l.id)}"
                            onerror="this.classList.add('is-broken')" />`
                    : ''}
                  <span class="media-tile__none">열어 보기</span>
                  <span class="media-tile__name">${h(l.label)}</span>
                </button>`).join('')}
            </div>` : '<p class="hd-text hd-text--empty">첨부가 없습니다.</p>'}
        </div>
      </div>

      ${p.rest.length ? `
        <details class="hd-more">
          <summary>그 밖의 항목&nbsp;<span class="tnum">${p.rest.length}</span></summary>
          <div class="hd-facts">
            ${p.rest.map((v) => `<span class="hd-fact"><span class="hd-fact__k">${h(v.label)}</span><b class="hd-fact__v">${h(v.value)}</b></span>`).join('')}
          </div>
        </details>` : ''}

      <section class="hd-status">
        <h3 class="hd-sec__title">상태 <span class="hd-status__note">누르면 시트에 바로 기록</span></h3>
        <div class="status-seg" role="group" aria-label="상태">
          ${STATUS_ORDER.map(trackOf).map((s) => `
            <button class="status-seg__btn${s.value === entry.status ? ' is-on' : ''}" data-act="set-status"
                    data-value="${h(s.value)}" data-track="${s.cls}" type="button"
                    aria-pressed="${s.value === entry.status}">${stIcon(s.cls)}${h(s.short)}</button>`).join('')}
        </div>
      </section>

      <div class="hist-actions">
        <button class="btn btn-secondary" data-act="edit" type="button">수정</button>
        <button class="btn btn--danger" data-act="delete" type="button">삭제</button>
      </div>
    </div>`;
}

/**
 * 상세의 버튼들. onStatus 는 상태를 바꾼 뒤(성공·실패 모두) 화면을 다시 그리는 일.
 * box 는 다시 그려져도 그대로인 바깥 칸이어야 한다 (이벤트를 한 번만 단다).
 */
/**
 * @param {HTMLElement} box
 * @param {() => any} getEntry
 * @param {{ onStatus?: () => void, inModal?: boolean }} [opts]
 */
function bindEntry(box, getEntry, { onStatus, inModal = false } = {}) {
  box.addEventListener('click', async (ev) => {
    const btn = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-act]'));
    if (!btn) return;
    const entry = getEntry();
    if (!entry) return;
    const act = btn.dataset.act;
    if (act === 'set-status') {
      const before = entry.status;
      const next = btn.dataset.value;
      if (next === before) return;
      entry.status = next;                 // 화면은 곧바로 반응한다
      if (onStatus) onStatus();
      try {
        const result = await api.setReportStatus(entry.sheetName, entry.row, next);
        toast(result.queued
          ? '오프라인입니다. 연결되면 시트에 반영합니다.'
          : `상태를 '${next}' 로 바꿨습니다.`, 'ok');
      } catch (err) {
        entry.status = before;             // 실패하면 되돌린다
        if (onStatus) onStatus();
        toast(err.message, 'err');
      }
    }
    // [이어서 작성] 은 v3.30.1 에 뺐다 — 고치기는 [수정], 같은 매장 새 방문은
    // 매장별 이력의 [이 매장 새 리포트] 가 맡는다 (버튼이 둘이면 헷갈린다는 현장 의견).
    if (act === 'edit') {
      // 같은 방문을 고침 — 시트의 그 줄을 다시 쓴다.
      seedFromEntry(entry, { edit: true });
      if (inModal) closeModal();
      location.hash = '#/report/edit';
      toast('이 리포트를 고칩니다. 저장하면 같은 줄이 바뀝니다.', 'ok');
    }
    if (act === 'delete') {
      const ok = await confirmDialog(
        '구글 시트에서 삭제',
        [
          `${entry.store || '이 리포트'} · ${entry.date}`,
          '',
          '구글 시트에서 이 줄을 지웁니다. 팀 전체에서 사라집니다.',
          '되돌릴 수 없습니다.',
          '',
          '드라이브에 저장된 사진·영상은 지워지지 않습니다.',
        ].join(String.fromCharCode(10)),
        '시트에서 삭제', true);
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = '지우는 중…';
      try {
        await api.deleteSheetReport(entry.sheetName, entry.row);
        closeModal();
        toast('구글 시트에서 지웠습니다.', 'ok');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = '삭제';
      }
    }
    if (act === 'view') {
      openViewer(entry.links, Number(btn.dataset.idx));
    }
  });
}

/** 상세를 칸에 그린다 — 영상 표시 · 막힌 썸네일 되살리기까지. */
function paintEntry(box, entry) {
  box.innerHTML = entryDetailHtml(entry);
  markVideos(entry.links, box);
  reviveBrokenThumbs(box);
}

/**
 * 시트 한 줄의 상세를 창으로 보여 준다.
 * 좁은 화면의 이력과 새 리포트의 [지난 방문] 이 쓴다.
 */
export function showSheetEntry(entry) {
  const box = openSheet(entry.store || '리포트', '');
  paintEntry(box, entry);
  bindEntry(box, () => entry, { inModal: true, onStatus: () => paintEntry(box, entry) });
}


/** 첨부 중 영상인 것에 ▶ 표시를 붙인다 (알아 온 뒤 조용히 갱신). */
async function markVideos(links, root) {
  const ids = links.map((l) => l.id).filter(Boolean);
  if (!ids.length) return;
  let known;
  try { known = await describeFiles(ids); } catch { return; }
  links.forEach((l, i) => {
    const info = known[l.id];
    if (!info) return;
    l.isVideo = info.isVideo;
    if (info.name) l.name = info.name;
    if (!info.isVideo) return;
    const tile = root.querySelector(`[data-act="view"][data-idx="${i}"]`);
    if (tile && !tile.querySelector('.media-tile__play')) {
      const badge = document.createElement('span');
      badge.className = 'media-tile__play';
      badge.textContent = '▶';
      tile.appendChild(badge);
    }
  });
}

/**
 * 첨부 전체 화면 뷰어 — 좌우로 넘겨 본다.
 *
 * 드라이브를 새 창으로 여는 것보다 현장에서 빠르다.
 * 원본(드라이브)으로 나가는 길도 남겨 둔다.
 */
export function openViewer(links, start = 0) {
  let at = Math.max(0, Math.min(start, links.length - 1));

  const root = document.createElement('div');
  root.className = 'viewer';
  root.tabIndex = -1;
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';

  function close() {
    root.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }
  function go(step) {
    at = (at + step + links.length) % links.length;
    draw();
  }
  function onKey(ev) {
    if (ev.key === 'Escape') close();
    if (ev.key === 'ArrowLeft') go(-1);
    if (ev.key === 'ArrowRight') go(1);
  }

  function draw() {
    const l = links[at];
    root.innerHTML = `
      <div class="viewer__bar">
        <span class="viewer__label">${l.isVideo ? ' ' : ''}${h(l.name || l.label)}</span>
        <span class="viewer__count tnum">${at + 1} / ${links.length}</span>
        <span class="spacer"></span>
        <a class="btn btn--ghost btn--sm" href="${h(l.url)}" target="_blank"
           rel="noopener">드라이브에서 열기 ↗</a>
        <button class="btn btn--ghost btn--icon" data-act="close" type="button"
                aria-label="닫기">✕</button>
      </div>
      <div class="viewer__stage">
        ${links.length > 1 ? '<button class="viewer__nav viewer__nav--prev" data-act="prev" type="button" aria-label="이전">‹</button>' : ''}
        ${!l.id
          ? '<div class="viewer__fallback">미리보기를 만들 수 없는 형식입니다.</div>'
          : l.isVideo
            // 영상은 드라이브 재생기를 그대로 띄운다. 사진처럼 한 장면만
            // 보여 주면 현장에서 확인할 수가 없다.
            ? `<iframe class="viewer__frame" src="${h(previewUrl(l.id))}"
                       allow="autoplay; fullscreen" allowfullscreen
                       title="${h(l.label)}"></iframe>`
            : `<img class="viewer__img" src="${h(thumbUrl(l.id, 1600))}" alt="${h(l.label)}"
                    data-drive="${h(l.id)}" data-drive-size="full"
                    onerror="this.classList.add('is-broken')" />
               <div class="viewer__fallback">사진을 불러오고 있습니다…<br />
                 오래 걸리면 위의 [드라이브에서 열기] 로 원본을 볼 수 있습니다.</div>`}
        ${links.length > 1 ? '<button class="viewer__nav viewer__nav--next" data-act="next" type="button" aria-label="다음">›</button>' : ''}
      </div>`;
    reviveBrokenThumbs(root);
  }

  root.addEventListener('click', (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const btn = /** @type {HTMLElement | null} */ (target.closest('[data-act]'));
    if (!btn) {
      if (target === root || target.classList.contains('viewer__stage')) close();
      return;
    }
    if (btn.dataset.act === 'close') close();
    if (btn.dataset.act === 'prev') go(-1);
    if (btn.dataset.act === 'next') go(1);
  });
  document.addEventListener('keydown', onKey);
  draw();
  root.focus();
}



/** 연도는 위 월 선택기에 이미 있으므로 줄에는 월-일만 보여 준다. */
const shortDate = (value) => {
  const text = String(value || '');
  return text.length >= 10 ? text.slice(5) : (text || '-');
};

/**
 * 이력 화면 — 구글 시트의 월별 탭이 원본이다.
 *
 * 왼쪽은 목록, 오른쪽은 고른 건의 상세(로봇 · 증상 · 조치 · 사진). 위쪽 칩이 상태별
 * 건수이자 필터다. 좁은 화면에서는 줄을 누르면 상세를 창으로 띄운다.
 * 주소의 ?q= 는 검색어, ?open= 은 바로 열 건 (홈의 최근 기록에서 넘어온다).
 */
const wideHist = () => window.matchMedia('(min-width: 1000px)').matches;

export async function reportListView(view, params = null) {
  loading(view);
  await Promise.all([loadGuides(), loadWork()]);

  const settings = await api.getSettings();
  if (!settings.sheetsReady) {
    view.innerHTML = `
      <div class="page-head"><h1 class="page-head__title">리포트 이력</h1></div>
      <div class="empty">
        구글 시트 연결이 아직 설정되지 않았습니다.<br />
        <a class="link" href="#/settings">설정</a> 에서 웹 앱 URL 을 먼저 등록하세요.
      </div>`;
    return;
  }

  let months = await api.sheetMonths(false);
  const thisMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  if (!months.length) months = [thisMonth];
  if (!months.includes(thisMonth)) months = [thisMonth, ...months];

  const openKey = params ? params.get('open') : null;
  let month = (openKey && months.includes(openKey.split('#')[0])) ? openKey.split('#')[0] : months[0];
  let data = { entries: [], fromCache: false, error: null };
  let filter = null;          // null = 전체
  let query = params ? (params.get('q') || '') : '';
  // 홈의 'N일 넘게 끝나지 않은 리포트' 에서 들어오면 그것만 본다
  let overdueOnly = Boolean(params && params.get('old'));
  let localItems = [];
  let selectedKey = openKey;

  async function load({ refresh = true } = {}) {
    data = await api.sheetReports(month, refresh);
    const local = await api.listReports();
    // 아직 시트에 올라가지 않은 건은 따로 위에 보여 준다.
    localItems = (local.items || []).filter((r) => r.status !== 'UPLOADED');
  }

  function visible() {
    const q = query.trim().toLowerCase();
    return (data.entries || []).filter((e) => {
      if (filter && e.status !== filter) return false;
      if (overdueOnly && (e.status === '조치 완료' || openDays(e) < OVERDUE_DAYS)) return false;
      if (!q) return true;
      return [e.store, e.date, e.createdAt, e.code, e.summary, e.author]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }

  function counts() {
    const out = {};
    TRACK.forEach((t) => { out[t.value] = 0; });
    (data.entries || []).forEach((e) => {
      if (out[e.status] !== undefined) out[e.status] += 1;
    });
    return out;
  }

  /** 상태 타일 — 전체 + 상태 넷. 상태마다 색이 다르고, 고르면 그 색으로 채운다. */
  function tilesHtml() {
    const c = counts();
    const order = STATUS_ORDER;
    const tile = (value, label, n, cls) => `
      <button class="hist-tile${filter === value ? ' is-on' : ''}" data-act="filter"
              data-value="${h(value || '')}" data-track="${cls}"
              type="button" aria-pressed="${filter === value}">
        <span class="hist-tile__label">${stIcon(cls)}${h(label)}</span>
        <b class="hist-tile__n tnum">${n}</b>
      </button>`;
    return `<div class="hist-chips hist-tiles" role="group" aria-label="상태로 거르기">
      ${tile(null, '전체', (data.entries || []).length, 'all')}
      ${order.map((v) => tile(v, trackOf(v).short, c[v], trackOf(v).cls)).join('')}
    </div>
    ${overdueOnly ? `<button class="hist-overdue-chip" data-act="overdue-off" type="button">
      ${OVERDUE_DAYS}일 넘게 끝나지 않은 것만 보는 중 · 모두 보기 ✕</button>` : ''}`;
  }

  function rowsHtml() {
    const list = visible();
    if (!list.length) {
      return `<div class="empty">${
        query || filter ? '조건에 맞는 리포트가 없습니다.' : '이 달에 기록된 리포트가 없습니다.'
      }</div>`;
    }
    return `<div class="hist-rows">
      ${list.map((e) => {
        const on = e.key === selectedKey;
        const detail = [e.code, e.summary].filter(Boolean).join(' · ');
        const t = trackOf(e.status);
        const age = ageText(e);
        const late = e.status !== '조치 완료' && openDays(e) >= OVERDUE_DAYS;
        return `
          <button class="hist-row${on ? ' is-on' : ''}${late ? ' is-overdue' : ''}" data-act="open" data-key="${h(e.key)}"
                  data-track="${t.cls}" type="button" aria-pressed="${on}">
            <span class="hist-row__top">
              <span class="hist-row__date tnum">${h(shortDate(e.date))}</span>
              <span class="hist-row__status">${stIcon(t.cls)}${h(t.short)}${age ? ` · ${age}` : ''}</span>
            </span>
            <span class="hist-row__store">${h(e.store || '(식당명 없음)')}</span>
            ${detail ? `<span class="hist-row__sub">${h(detail)}</span>` : ''}
          </button>`;
      }).join('')}
    </div>`;
  }

  function localHtml() {
    if (!localItems.length) return '';
    return `
      <div class="panel panel--warn">
        <strong>아직 시트에 올리지 않은 리포트 ${localItems.length}건</strong>
        <div class="list">
          ${localItems.map((r) => {
            const [cls, label] = STATUS[r.status] || STATUS.DRAFT;
            return `
              <a class="item" href="#/reports/${r.id}">
                <div class="item__body">
                  <div class="item__title">${h(r.title)}</div>
                  <div class="item__sub">${h(when(r.createdAt))}</div>
                </div>
                <span class="${cls}">${label}</span>
                <span class="item__chevron">›</span>
              </a>`;
          }).join('')}
        </div>
      </div>`;
  }

  function paintMeta() {
    const el = $('#histMeta');
    if (!el) return;
    const total = (data.entries || []).length;
    const shown = visible().length;
    el.textContent = (filter || query) ? `${shown} / ${total}건` : `${total}건`;

    const sync = $('#histSync');
    if (sync) {
      sync.textContent = data.fromCache
        ? '받아 둔 내용 표시 중' : `${new Date().toTimeString().slice(0, 5)} 수신`;
    }
  }

  /** 못 받아 왔으면 왜인지 화면에 적는다 — 그냥 비워 두면 원인을 알 수 없다. */
  function noticeHtml() {
    if (data.error && !data.entries.length) {
      return `<div class="hist-note hist-note--bad">시트에서 이력을 받지 못했습니다.
        <div style="margin-top:6px;white-space:pre-wrap;font-weight:400">${h(explainError(data.error))}</div>
      </div>`;
    }
    if (data.fromCache) {
      return '<div class="hist-note">연결이 안 돼 마지막으로 받아 둔 내용을 보여 줍니다.</div>';
    }
    return '';
  }

  const selected = () => (data.entries || []).find((e) => e.key === selectedKey) || null;

  function paintPanel() {
    const panel = $('#histPanel');
    if (!panel) return;
    const entry = selected();
    if (entry) paintEntry(panel, entry);
    else panel.innerHTML = '<div class="hist-panel__empty">왼쪽에서 리포트를 고르면<br />로봇 · 증상 · 조치 · 사진을 여기서 봅니다.</div>';
  }

  /**
   * 화면을 두 겹으로 나눈다.
   *  - 껍데기(renderShell): 검색창·월 선택기. **한 번만 만들고 다시 만들지 않는다.**
   *  - 알맹이(paint): 칩·목록·상세. 검색·필터 때마다 이 부분만 갈아 끼운다.
   *
   * 한 글자 칠 때마다 화면 전체를 다시 그리면 입력 칸이 새로 만들어져
   * 한글 조합이 끊긴다("옥동식" → "ㅇㅗㄱㄷㅗㅇㅅㅣㄱ"). 입력 칸을 그대로 두는 것이
   * 이 문제의 유일한 확실한 해결책이다.
   */
  function renderShell() {
    view.innerHTML = `
      <div id="pageRoot" class="page-stack">
        <div class="page-head">
          <h1 class="page-head__title">리포트 이력</h1>
          <span class="page-head__meta"><span id="histMeta"></span> · <span id="histSync"></span></span>
          <span class="page-head__spacer"></span>
          <select class="select" id="histMonth" aria-label="월 선택"></select>
          <a class="btn btn-secondary" href="#/stats">통계</a>
          <button class="btn btn-secondary" data-act="refresh" type="button">시트에서 받기</button>
        </div>
        <div class="hist-filter">
          <div id="histTop"></div>
          <input class="input hist-search" id="histQ" type="search"
                 placeholder="식당명 · 날짜 (미트로, 08-22)" aria-label="이력 검색" />
        </div>
        <div class="hist-split">
          <section class="hist-list scroll" id="histBody"></section>
          <aside class="hist-panel" id="histPanel" aria-label="고른 리포트"></aside>
        </div>
      </div>`;

    const root = $('#pageRoot');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    bindEntry($('#histPanel'), selected, { onStatus: () => paint() });

    const box = $('#histQ');
    box.value = query;
    box.addEventListener('input', () => { query = box.value; paint(); });
    // 조합이 끝나는 순간에도 한 번 더 맞춘다 (일부 기기는 input 이 늦게 온다).
    box.addEventListener('compositionend', () => { query = box.value; paint(); });

    paintMonths();
  }

  function paintMonths() {
    const sel = $('#histMonth');
    if (!sel) return;
    sel.innerHTML = months
      .map((m) => `<option value="${h(m)}">${h(m)}</option>`).join('');
    sel.value = month;
  }

  function paint() {
    const top = $('#histTop');
    const body = $('#histBody');
    if (!top || !body) return;
    // 넓은 화면은 처음부터 한 건을 열어 둔다 — 오른쪽이 비어 있을 이유가 없다.
    if (wideHist() && !selected()) selectedKey = (visible()[0] || {}).key || null;
    top.innerHTML = tilesHtml();
    body.innerHTML = noticeHtml() + localHtml() + rowsHtml();
    paintMeta();
    paintPanel();
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || btn.closest('#histPanel')) return;     // 상세 안의 버튼은 bindEntry 가 맡는다
    const act = btn.dataset.act;

    if (act === 'overdue-off') {
      overdueOnly = false;
      history.replaceState(null, '', '#/reports');
      paint();
      return;
    }
    if (act === 'filter') {
      const value = btn.dataset.value || null;
      filter = filter === value ? null : value;
      paint();
      return;
    }
    if (act === 'open') {
      selectedKey = btn.dataset.key;
      if (wideHist()) { paint(); return; }
      const entry = selected();
      if (entry) showSheetEntry(entry);
      return;
    }
    if (act === 'refresh') {
      btn.disabled = true;
      btn.textContent = '받는 중…';
      months = await api.sheetMonths(true);
      if (!months.includes(month)) months = [month, ...months];
      await load({ refresh: true });
      paintMonths();
      paint();
      btn.disabled = false;
      btn.textContent = '시트에서 받기';
      toast(data.fromCache ? '연결이 안 돼 기존 내용을 유지합니다.' : '시트에서 받았습니다.',
            data.fromCache ? 'err' : 'ok');
    }
  }

  async function onChange(ev) {
    const el = ev.target;
    if (el.id === 'histMonth') {
      month = el.value;
      filter = null;
      selectedKey = null;
      // 검색창을 살려 두기 위해 목록 자리에만 안내를 띄운다.
      const body = document.querySelector('#histBody');
      if (body) body.innerHTML = '<div class="skeleton">불러오는 중…</div>';
      await load({ refresh: true });
      paint();
    }
  }

  renderShell();
  paint();
  // 받아 둔 것이 있으면 그것으로 **먼저 보여 준다.** 시트에 다시 물어보는 데는
  // 몇 초가 걸리는데, 그 동안 빈 화면을 보고 기다릴 이유가 없다.
  await load({ refresh: false });
  paintMonths();
  paint();
  // 홈에서 한 건을 골라 왔으면 좁은 화면에서도 바로 연다.
  if (openKey && !wideHist() && selected()) showSheetEntry(selected());

  // 그런 다음 조용히 최신본을 받아 온다. 화면 전환을 여기서 붙잡지 않는다.
  //
  // 방금 받은 것은 다시 받지 않는다. 화면을 옮길 때마다 부르면 현장 LTE 에서
  // 왕복이 1~3초라, 들어간 화면이 잠시 뒤 한 번 더 그려져 덜컥거린다.
  const openedAt = month;
  const age = data.fetchedAt ? Date.now() - new Date(data.fetchedAt).getTime() : Infinity;
  if (age < 60000) return;

  const before = listSignature(data.entries);
  (async () => {
    try { await load({ refresh: true }); } catch { return; }
    // 그 사이 다른 화면으로 넘어갔거나 다른 달을 골랐으면 손대지 않는다.
    if (!view.querySelector('#histQ') || month !== openedAt) return;
    // 시트 내용이 그대로면 다시 그리지 않는다 — 괜히 화면이 깜빡인다.
    if (listSignature(data.entries) === before) return;
    paintMonths();
    paint();
  })();
}

/** 목록이 지난번과 같은지 비교할 때만 쓰는 짧은 요약. */
function listSignature(entries) {
  return (entries || [])
    .map((e) => [e.sheetName, e.row, e.status, e.store, e.createdAt,
                 (e.links || []).length].join('|'))
    .join(String.fromCharCode(10));
}

// ------------------------------------------------------------ 상세 화면
export async function reportDetailView(view, reportId) {
  loading(view);
  const [report, settings] = await Promise.all([
    api.getReport(reportId), api.getSettings(),
  ]);
  const sheetsReady = !!settings.sheetsReady;
  const [cls, label] = STATUS[report.status] || STATUS.DRAFT;

  view.innerHTML = `
    <div id="pageRoot">
      <div class="page-head">
        <div>
          <h1 class="page-head__title">${h(report.title)}</h1>
        </div>
        <span class="page-head__meta">
          <span class="${cls}">${label}</span> · ${h(when(report.createdAt))}
        </span>
        <span class="page-head__spacer"></span>
        ${report.sheetName ? `<p class="muted">구글 시트 <strong>${h(report.sheetName)}</strong> 시트 ${report.sheetRow || '-'}행
          ${settings.spreadsheetUrl ? `· <a class="link" href="${h(settings.spreadsheetUrl)}" target="_blank" rel="noopener">스프레드시트 열기 ↗</a>` : ''}</p>` : ''}
        ${report.errorMessage ? `<p style="color:var(--color-danger);white-space:pre-wrap">${h(report.errorMessage)}</p>` : ''}
      </div>

      <div class="row" style="margin-bottom:16px">
        <button class="btn btn--primary btn--sm" data-act="upload" type="button">
          ${report.status === 'UPLOADED' ? ' 구글 시트에 다시 업로드' : ' 구글 시트로 업로드'}
        </button>
        <button class="btn btn--ghost btn--sm" data-act="share" type="button">공유</button>
        <button class="btn btn--ghost btn--sm" data-act="copy" type="button">텍스트 복사</button>
        <div class="spacer"></div>
        <button class="btn btn--danger btn--sm" data-act="del" type="button">삭제</button>
      </div>

      <div class="panel">
        ${(report.payload || []).map((item) => `
          <div class="field">
            <label>${h(item.label)}</label>
            ${item.type === 'MEDIA'
              ? ((item.media || []).length
                ? `<div class="media-grid">${item.media.map((m) => `
                    <a class="media-tile" data-media="${h(m.url)}" href="#" target="_blank" rel="noopener">
                      ${(m.mime || '').startsWith('video/')
                        ? `<video data-media="${h(m.url)}" muted playsinline></video>`
                        : `<img data-media="${h(m.url)}" alt="${h(m.originalName || '')}" loading="lazy" />`}
                      <div class="media-tile__name">${h(m.originalName || m.filename)}</div>
                    </a>`).join('')}</div>`
                : '<p class="muted">첨부 없음</p>')
              : `<div class="sub-card" style="white-space:pre-wrap">${h(item.value || '-')}</div>`}
          </div>`).join('')}
      </div>
    </div>`;

  hydrateMedia(view);   // 첨부는 기기 안 파일에서 꺼낸다 (APK 에서 액박 방지)

  $('#pageRoot').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'upload') {
      if (report.status === 'UPLOADED') {
        const ok = await confirmDialog('다시 업로드',
          '이미 업로드된 리포트입니다. 구글 시트에 같은 내용이 한 줄 더 추가됩니다.',
          '업로드', false);
        if (!ok) return;
      }
      btn.disabled = true;
      btn.textContent = '업로드 중…';
      try {
        const result = await api.uploadReportToSheet(report.id);
        if (result.queued) {
          toast('⏳ 대기열에 넣었습니다. 인터넷에 연결되면 자동으로 올립니다.', 'ok');
        } else {
          toast(`구글 시트 [${result.sheetName}] ${result.row}행에 기록했습니다.`
            + (result.media ? ` (첨부 ${result.media}개 드라이브 저장)` : ''), 'ok');
          (result.mediaSkipped || []).forEach((s) =>
            toast(`첨부 제외: ${s.filename} (${s.reason})`, 'err'));
          warnPrivateVideo(result);
        }
        reportDetailView(view, report.id);
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = ' 구글 시트로 업로드';
      }
    }
    if (act === 'share') {
      await shareReport(report);
    }
    if (act === 'copy') {
      const ok = await copyText(reportToText(report));
      toast(ok ? '리포트 내용을 복사했습니다.' : '복사에 실패했습니다.', ok ? 'ok' : 'err');
    }
    if (act === 'del') {
      const ok = await confirmDialog('리포트 삭제',
        '이 리포트를 앱에서 삭제합니다. 이미 업로드된 구글 시트 내용은 남아 있습니다.',
        '삭제', true);
      if (!ok) return;
      await api.deleteReport(report.id);
      toast('삭제했습니다.', 'ok');
      location.hash = '#/reports';
    }
  });
}

/** 리포트의 오류 코드에 맞는 가이드로 가는 길 — 없으면 '만들기' */
/**
 * 이 리포트에서 가이드로 가는 길 (v3.31).
 *  - 작업 → 작업 목록에 이어 둔 가이드 (그 리포트의 로봇 모델 것 먼저)
 *  - 오류 코드가 **코드 모양**(E-101)이면 → 그 코드의 가이드. 없을 때만 '만들기'
 *  - '유지 보수' 같은 분류 글자에는 '만들기' 를 띄우지 않는다 (그런 코드의 가이드는 없다)
 */
function guideLinksHtml(entry) {
  const model = valueOf(entry, '모델');
  const found = [];
  const item = findWork(workOf(entry), knownWork);
  if (item) {
    const linked = knownGuides.filter((g) => item.guides.includes(g.id));
    const mine = linked.filter((g) => !g.robotModel || !model || sameRobot(model, g.robotModel));
    found.push(...(mine.length ? mine : linked));
  }
  let make = '';
  if (isCodeShaped(entry.code)) {
    const hits = guidesForCode(entry.code, knownGuides);
    found.push(...hits);
    if (!hits.length) {
      make = `<a class="hd-guide hd-guide--none" href="#/guides/new/ERROR_CODE">
        ${h(entry.code)} 가이드가 아직 없습니다 · 만들기 ›</a>`;
    }
  }
  const seen = new Set();
  return found.filter((g) => !seen.has(g.id) && seen.add(g.id)).map((g) => `<a class="hd-guide" href="#/guides/${h(g.id)}">
      <b>가이드</b> ${h(g.codeOrTitle)}${g.robotModel ? ` <small>${h(g.robotModel)}</small>` : ''} <span aria-hidden="true">›</span></a>`).join('') + make;
}
