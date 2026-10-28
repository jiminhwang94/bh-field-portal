// 가이드 상세(한눈에 · 단계 체크) · 작성/수정. 목록 쪽은 views/guides.js
import { api } from '../api.js';
import {
  $, $$, h, closeModal, confirmDialog, copyText, hydrateMedia, loading,
  openSheet, promptDialog, toast, when,
} from '../ui.js';

import {
  CAT_SHORT, DONE_KEY, NONE_LABEL, guideCatOf, guideMediaEnabled, isStepVideo, isVideoFile, modelHref, modelKey, modelLabel,
  row, splitTitle, stepMediaHtml, uploadGuidePhoto,
} from './guides.js';

/** 단계의 사진 · 영상 목록 (v3.40) — 예전 단계는 imageUrl 하나 */
const mediaOf = (s) => (s && Array.isArray(s.media) && s.media.length ? s.media
  : (s && s.imageUrl ? [{ url: s.imageUrl, sec: null }] : []));
/** 한 단계 영상은 모두 합쳐 1분까지 (v3.40) — 길이를 모르는 예전 영상은 1분으로 센다 */
const STEP_VIDEO_LIMIT = 60;
const videoTotal = (list) => list.filter((m) => isStepVideo(m.url))
  .reduce((n, m) => n + (m.sec || STEP_VIDEO_LIMIT), 0);
/** 영상 파일의 길이(초) — 못 읽으면 null */
function videoSeconds(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (sec) => { URL.revokeObjectURL(url); resolve(sec); };
    v.preload = 'metadata';
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? Math.round(v.duration) : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}
/** 단계 사진 · 영상 모음 — 하나면 크게, 여럿이면 나란히 */
const stepGalleryHtml = (s, cls, alt) => {
  const list = mediaOf(s);
  if (!list.length) return '';
  return `<div class="gs-gallery${list.length > 1 ? ' gs-gallery--many' : ''}">${list
    .map((m, j) => stepMediaHtml(m.url, cls, `${alt}${list.length > 1 ? ` ${j + 1}` : ''}`)).join('')}</div>`;
};

// ---------------------------------------------------------------- 상세 — 한 단계씩 · 한눈에
//
// 기본은 **한 단계씩** (v3.35 A안): 사진 · 설명 · 공구가 화면 가득, 다음은 오른쪽 아래 큰 버튼 하나.
// 작은 체크 칸을 맞힐 필요 없이 [다 했어요 · 다음] 으로 넘어간다. [한눈에 보기] 를 누르면 예전처럼
// 단계 전체 · 진행률 · 준비 공구 · 명령어를 한 화면에 (줄 전체가 버튼, 누르면 완료 체크).
//
// 이력에서 들어오면 주소에 매장 · 시리얼이 붙어 온다 (?store=&serial=&model=). 그러면
//  · 오른쪽에 '이 로봇 지난번' (같은 로봇의 지난 기록 · 같은 코드 반복 경고)
//  · [리포트 쓰기] 에 매장 · 시리얼 · 오류 코드 · 마친 단계가 채워져 넘어간다
const GUIDE_VIEW_KEY = 'bh_guide_view';
export async function guideDetailView(view, guideId, query = null) {
  loading(view);
  const guide = await api.getGuide(guideId);
  if (!guide) throw new Error('가이드를 찾을 수 없습니다.');
  const tools = (guide.requiredTools || '').split(',').map((t) => t.trim()).filter(Boolean);
  const key = modelKey(guide);
  const { code, title } = splitTitle(guide);
  // 로봇별 항목 이름 (v3.40)
  const catName = ((await api.listGuideCats(key)).find((c) => c.id === guideCatOf(guide)) || {}).name
    || CAT_SHORT[guide.categoryType] || '';
  const ctx = {
    store: (query && query.get('store')) || '',
    serial: (query && query.get('serial')) || '',
    model: (query && query.get('model')) || '',
  };
  let done = new Set();
  try {
    done = new Set(JSON.parse(localStorage.getItem(DONE_KEY(guideId)) || '[]'));
  } catch { /* 무시 */ }
  const total = guide.steps.length;
  // 단계를 다 마친 채 남은 기록(예전 버전 · [완료] 전에 나간 경우)은 새로 시작한다 — 다음 현장에서는 처음부터다
  if (total && guide.steps.every((_, i) => done.has(String(i)))) {
    done = new Set();
    try { localStorage.removeItem(DONE_KEY(guideId)); } catch { /* 이번만 */ }
  }
  let viewMode = 'step';
  try { if (localStorage.getItem(GUIDE_VIEW_KEY) === 'list') viewMode = 'list'; } catch { /* 기본 */ }
  /** 지금 단계 — 아직 안 한 첫 단계 (다 했으면 마지막) */
  let at = Math.max(0, guide.steps.findIndex((_, i) => !done.has(String(i))));
  let pastHtml = '';

  const saveDone = () => localStorage.setItem(DONE_KEY(guideId), JSON.stringify([...done]));

  /** 오른쪽 칸 — 준비 공구 · 명령어 · 지난번 · 이 오류로 쓴 리포트 */
  const sideHtml = () => `
    ${pastHtml ? `<div id="gdPast">${pastHtml}</div>` : '<div id="gdPast"></div>'}
    <section class="gd-box">
      <h2 class="gd-box__title">준비 공구 · 부품</h2>
      ${tools.length ? `<div class="tag-list">${tools.map((t) => `<span class="chip">${h(t)}</span>`).join('')}</div>`
        : '<p class="hint">적힌 공구가 없습니다.</p>'}
    </section>
    ${guide.commands.length ? `
      <section class="gd-box">
        <h2 class="gd-box__title">명령어 — 누르면 복사</h2>
        ${guide.commands.map((c, i) => `
          <div class="cmd">
            ${c.label ? `<div class="cmd__label">${h(c.label)}</div>` : ''}
            <div class="cmd__row">
              <pre class="cmd__code" id="cmd-${i}">${h(c.cmd)}</pre>
              <button class="btn btn--primary" data-act="copy" data-target="cmd-${i}" type="button">복사</button>
            </div>
            ${c.desc ? `<p class="cmd__desc">${h(c.desc)}</p>` : ''}
          </div>`).join('')}
        ${guide.commands.length > 1 ? '<button class="btn btn-secondary btn--sm" data-act="copy-all" type="button">전체 복사</button>' : ''}
      </section>` : ''}
    <section class="gd-box" id="gdReports" hidden></section>
    <p class="gd-meta">${h(when(guide.updatedAt))} 수정</p>`;

  /** 한 단계 — 사진 · 설명 · 공구를 크게 */
  function stepCardHtml() {
    const s = guide.steps[at];
    const metric = (s.expectedMetric || '').split(',').map((t) => t.trim()).filter(Boolean);
    return `
      <article class="gs-card${done.has(String(at)) ? ' is-done' : ''}">
        ${mediaOf(s).length ? `<div class="gs-media">${stepGalleryHtml(s, 'gs-img step__img', `단계 ${at + 1} 참고 자료`)}</div>` : ''}
        <div class="gs-text">
          <span class="gs-no tnum">${at + 1} / ${total}${done.has(String(at)) ? ' · 했음' : ''}</span>
          <p class="gs-instr">${h(s.instruction).replace(/\n/g, '<br />')}</p>
          ${metric.length ? `<div class="tag-list">${metric.map((t) => `<span class="tag tag-accent">${h(t)}</span>`).join('')}</div>` : ''}
        </div>
      </article>`;
  }

  /** 오른쪽 단계 목록 — 누르면 그 단계로 */
  const stepListHtml = () => `
    <ol class="gs-list" aria-label="단계">
      ${guide.steps.map((s, i) => `
        <li><button class="gs-item${done.has(String(i)) ? ' is-done' : ''}${i === at ? ' is-cur' : ''}" data-act="go-step"
                    data-idx="${i}" type="button"${i === at ? ' aria-current="step"' : ''}>
          <span class="gs-item__n tnum">${done.has(String(i)) ? '✓' : i + 1}</span>
          <span class="gs-item__t">${h(String(s.instruction || '').split('\n')[0])}</span>
        </button></li>`).join('')}
    </ol>`;

  function render() {
    const stepView = viewMode === 'step' && total > 0;
    const last = at >= total - 1;
    view.innerHTML = `
      <div id="pageRoot" class="gd${stepView ? ' gd--step' : ''}">
        <header class="gd-head">
          <nav class="gd-crumb" aria-label="위치">
            <a href="#/guides">가이드</a><span aria-hidden="true">›</span>
            <a href="${modelHref(key)}">${h(modelLabel(key))}</a><span aria-hidden="true">›</span>
            <a href="${modelHref(key, guideCatOf(guide))}">${h(catName)}</a>
          </nav>
          <div class="gd-title">
            ${code ? `<span class="gd-code tnum">${h(code)}</span>` : ''}
            <h1 class="page-head__title">${h(title)}</h1>
          </div>
          ${ctx.store || ctx.serial ? `<p class="gd-ctx">${h([ctx.store, ctx.serial].filter(Boolean).join(' · '))}에서 보는 중</p>` : ''}
          <div class="gd-actions">
            ${total ? `<button class="btn btn-secondary" data-act="view-mode" type="button">${stepView ? '한눈에 보기' : '한 단계씩 보기'}</button>` : ''}
            <span class="spacer"></span>
            <!-- 고치기 · 지우기는 현장에서 드물다 — [⋯] 안으로 (v3.35). 주 동작은 아래 [다 했어요] 하나 -->
            <button class="btn btn-secondary btn--icon gd-more" data-act="more" type="button" aria-label="가이드 수정 · 삭제">⋯</button>
            <button class="btn ${stepView ? 'btn-secondary' : 'btn-primary'}" data-act="write-report" type="button">이 작업으로 리포트 쓰기</button>
          </div>
        </header>

        <div class="gd-body">
          <section class="gd-main" aria-label="단계">
            ${!total ? '<div class="empty">등록된 단계가 없습니다. [수정]에서 단계를 추가하세요.</div>'
              : stepView ? stepCardHtml() : `
              <div class="gd-progress">
                <span class="gd-progress__text"><b class="tnum" id="gdDone">${done.size}</b> / <span class="tnum">${total}</span> 단계 완료</span>
                <span class="gd-progress__bar"><i id="gdBar" style="width:${Math.round(done.size / total * 100)}%"></i></span>
                <button class="btn btn-secondary btn--sm" data-act="reset-check" type="button">처음부터</button>
              </div>
              <div class="steps gd-steps">${guide.steps.map((s, i) => stepHtml(s, i, done)).join('')}</div>`}
          </section>

          <aside class="gd-side">
            ${stepView ? stepListHtml() : ''}
            ${sideHtml()}
          </aside>
        </div>
        ${stepView ? `
          <div class="gs-bar">
            <button class="btn btn-secondary" data-act="prev-step" type="button"${at === 0 ? ' disabled' : ''}>‹ 이전 단계</button>
            <span class="gs-bar__count tnum">${done.size} / ${total} 단계 했음</span>
            <button class="btn btn-primary gs-bar__next" data-act="done-next" type="button">${
              last ? '완료' : '다음 ›'}</button>
          </div>` : ''}
      </div>`;
    $('#pageRoot').addEventListener('click', onClick);   // 그릴 때마다 새 칸이라 한 번씩만 붙는다
    // 단계 사진은 기기 안에 있다 — 그린 뒤에 채워 넣는다.
    hydrateMedia(view);
    paintGuideReports(guide).catch(() => {});      // 이 오류로 쓴 리포트 (기기 사본에서)
  }

  /** 이 로봇 지난번 — 받아 둔 3달 이력에서 (시리얼을 알 때만) */
  async function loadPast() {
    if (!ctx.serial) return;
    const { cachedEntries, robotPast, normCode } = await import('../insights.js');
    const { pastMemoHtml } = await import('./report-common.js');
    const entries = await cachedEntries(3);
    const past = robotPast(entries, ctx.serial);
    const same = code ? past.filter((e) => normCode(e.code) === normCode(code)).length : 0;
    pastHtml = pastMemoHtml(past, { code, nth: same ? same + 1 : 0 });
    const box = document.getElementById('gdPast');
    if (box) box.innerHTML = pastHtml;
  }

  /** 마친 단계로 리포트를 시작한다 — 조치 칸에 단계를 차례대로, 오류 코드 · 매장 · 시리얼까지 */
  function writeReport() {
    const finished = guide.steps.map((s, i) => ({ s, i })).filter(({ i }) => done.has(String(i)));
    const lines = finished.map(({ s, i }) => `${i + 1}) ${String(s.instruction || '').split('\n')[0]}`);
    sessionStorage.setItem('bh_report_seed', JSON.stringify({
      store: ctx.store, serial: ctx.serial, model: ctx.model,
      code: guide.categoryType === 'ERROR_CODE' ? code : '',
      action: lines.length ? [`가이드 ${guide.codeOrTitle}`, ...lines].join('\n') : '',
    }));
    location.hash = '#/report/new';
  }

  render();
  loadPast().catch(() => {});

  const paintProgress = () => {
    const n = $('#gdDone');
    const bar = $('#gdBar');
    if (n) n.textContent = done.size;
    if (bar) bar.style.width = `${total ? Math.round(done.size / total * 100) : 0}%`;
  };

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'view-mode') {
      viewMode = viewMode === 'step' ? 'list' : 'step';
      try { localStorage.setItem(GUIDE_VIEW_KEY, viewMode); } catch { /* 이번만 */ }
      render();
    }
    if (act === 'go-step') { at = Number(btn.dataset.idx); render(); }
    if (act === 'prev-step') { at = Math.max(0, at - 1); render(); }
    if (act === 'done-next') {
      done.add(String(at));
      saveDone();
      // 마지막 단계의 [완료] — 그 로봇의 가이드 목록으로 돌아간다 (리포트는 위 [이 작업으로 리포트 쓰기])
      if (at >= total - 1) {
        // 진행 기록을 지운다 — 다음에 이 가이드를 열면 1단계부터 (v3.35)
        try { localStorage.removeItem(DONE_KEY(guideId)); } catch { /* 이번만 */ }
        toast('가이드를 마쳤습니다.', 'ok');
        location.hash = modelHref(key);
        return;
      }
      at += 1;
      render();
      window.scrollTo(0, 0);
    }
    if (act === 'write-report') writeReport();
    if (act === 'more') {
      const box = openSheet('가이드 관리', `
        <div class="sheet-actions gd-more-menu">
          <a class="btn btn-secondary btn--block" href="#/guides/edit/${guide.id}">수정</a>
          <button class="btn btn--danger btn--block" data-act="delete" type="button">삭제</button>
        </div>`);
      box.addEventListener('click', onClick);
    }
    if (act === 'copy' || act === 'copy-all') {
      const text = act === 'copy'
        ? $('#' + btn.dataset.target).textContent
        : guide.commands.map((c) => c.cmd).join('\n');
      const ok = await copyText(text);
      toast(ok ? '클립보드에 복사했습니다.' : '복사에 실패했습니다. 길게 눌러 직접 복사하세요.',
        ok ? 'ok' : 'err');
    }
    if (act === 'toggle-step') {
      // 사진을 눌렀으면 단계 완료 체크가 아니라 사진을 크게 본다.
      // 영상(재생기·video)은 눌러도 크게 하지 않는다 — 그 누름은 재생 버튼이다.
      if (ev.target.classList.contains('step__img')) {
        if (ev.target.tagName === 'IMG') ev.target.classList.toggle('is-zoomed');
        return;
      }
      const el = btn.closest('.step');
      const idx = el.dataset.idx;
      if (done.has(idx)) { done.delete(idx); } else { done.add(idx); }
      el.classList.toggle('is-done', done.has(idx));
      el.setAttribute('aria-pressed', String(done.has(idx)));
      saveDone();
      paintProgress();
    }
    if (act === 'reset-check') {
      done.clear();
      localStorage.removeItem(DONE_KEY(guideId));
      $$('.step').forEach((el) => {
        el.classList.remove('is-done');
        el.setAttribute('aria-pressed', 'false');
      });
      paintProgress();
      toast('체크를 초기화했습니다.');
    }
    if (act === 'delete') {
      const ok = await confirmDialog('가이드 삭제',
        `"${guide.codeOrTitle}" 가이드와 모든 단계를 삭제합니다. 되돌릴 수 없습니다.`,
        '삭제', true);
      if (!ok) return;
      await api.deleteGuide(guide.id);
      toast('삭제했습니다.', 'ok');
      location.hash = modelHref(key, guideCatOf(guide));
    }
  }
}

function stepHtml(step, idx, done) {
  const isDone = done.has(String(idx));
  // 줄 전체가 버튼이다 — 장갑 낀 손으로 작은 체크 칸만 겨냥하기 어렵다.
  return `
    <button class="step ${isDone ? 'is-done' : ''}" data-idx="${idx}"
            data-act="toggle-step" type="button" aria-pressed="${isDone}">
      <span class="step__no">${step.stepOrder || idx + 1}</span>
      <span class="step__body">
        <span class="step__text">${h(step.instruction).replace(/\n/g, '<br />')}</span>
        ${step.expectedMetric ? `
          <span class="step__meta tag-list">
            ${step.expectedMetric.split(',').map((t) => t.trim()).filter(Boolean)
              .map((t) => `<span class="tag tag-accent">${h(t)}</span>`).join('')}
          </span>` : ''}
        ${stepGalleryHtml(step, 'step__img', `단계 ${idx + 1} 참고 자료`)}
      </span>
      <span class="step__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.5 12.5 9.5 17.5 19.5 7" />
        </svg>
      </span>
    </button>`;
}

// ---------------------------------------------------------------- 편집
export async function guideEditView(view, guideId, categoryType, presetModel = null, presetCat = null) {
  const models = await api.listGuideModels();
  let state;
  /** 고른 로봇의 항목 (v3.40) — 로봇을 바꾸면 다시 받는다 */
  let robotCats = [];
  if (guideId) {
    loading(view);
    const guide = await api.getGuide(guideId);
    state = {
      id: guide.id,
      categoryType: guide.categoryType,
      category: guideCatOf(guide),
      robotModel: guide.robotModel || '',
      codeOrTitle: guide.codeOrTitle,
      summary: guide.summary,
      requiredTools: guide.requiredTools,
      commands: guide.commands.length ? guide.commands : [],
      steps: guide.steps.map((s) => ({
        instruction: s.instruction,
        expectedMetric: s.expectedMetric || '',
        imageUrl: s.imageUrl || '',
        media: mediaOf(s).map((m) => ({ ...m })),
      })),
    };
  } else {
    state = {
      id: null,
      categoryType: categoryType || 'ERROR_CODE',
      category: presetCat || categoryType || 'ERROR_CODE',
      robotModel: presetModel || '',
      codeOrTitle: '',
      summary: '',
      requiredTools: '',
      commands: [],
      steps: [{ instruction: '', expectedMetric: '', imageUrl: '', media: [] }],
    };
  }

  /** 로봇의 항목을 받아 지금 항목을 맞춘다 — 없는 항목이면 같은 형식의 첫 항목, 그것도 없으면 첫 항목 */
  async function loadRobotCats() {
    robotCats = await api.listGuideCats(state.robotModel || '_none');
    if (!robotCats.some((c) => c.id === state.category)) {
      const pick = robotCats.find((c) => c.form === state.categoryType) || robotCats[0];
      if (guideId && state.category && !robotCats.some((c) => c.id === state.category)) {
        // 고치는 가이드의 항목이 이 로봇에 없으면 잃지 않게 그대로 보여 준다
        robotCats = [...robotCats, { id: state.category, name: CAT_SHORT[state.category] || '목록에 없는 항목',
                                     form: state.categoryType }];
      } else if (pick) {
        state.category = pick.id;
        state.categoryType = pick.form;
      }
    }
  }
  await loadRobotCats();

  let cmdOpen = false;     // 명령어 칸 펼침 — 처음엔 접어 둔다 (추가를 누르면 펼친다)

  /** 쉼표로 적은 공구 목록을 배열로. 빈 항목·중복은 버린다. */
  function splitTools(text) {
    const out = [];
    for (const raw of String(text || '').split(',')) {
      const t = raw.trim();
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }

  /**
   * 단계마다 고를 수 있는 공구 칩.
   *
   * 고르는 값은 위 [준비 공구 · 부품] 에 적은 것에서만 나온다. 예전에는 이 자리가
   * '기준 수치' 자유 입력이었는데, 현장에서 그 단계에 무엇을 들고 가야 하는지가
   * 더 자주 필요했다. 저장은 예전 칸(expectedMetric)에 쉼표로 이어 담는다 —
   * 시트 열을 새로 만들지 않아도 되고, 예전 기록도 그대로 읽힌다.
   */
  function toolChips(step, idx) {
    const options = splitTools(state.requiredTools);
    if (!options.length) {
      return '<span class="hint">위 [준비 공구 · 부품] 에 먼저 적으면 여기서 고를 수 있습니다.</span>';
    }
    const chosen = splitTools(step.expectedMetric);
    return options.map((tool) => `
      <button type="button" class="filter-toggle${chosen.includes(tool) ? ' is-on' : ''}"
              data-act="toggle-tool" data-idx="${idx}" data-tool="${h(tool)}"
              aria-pressed="${chosen.includes(tool)}">${h(tool)}</button>`).join('');
  }

  /** 준비 공구에서 빠진 것은 단계 선택에서도 뺀다. */
  function pruneStepTools() {
    const options = splitTools(state.requiredTools);
    for (const step of state.steps) {
      const kept = splitTools(step.expectedMetric).filter((t) => options.includes(t));
      step.expectedMetric = kept.join(', ');
    }
  }

  /** 단계마다의 칩 영역만 다시 그린다. 숨은 칸도 함께 맞춘다. */
  function paintToolChips() {
    state.steps.forEach((step, i) => {
      const box = document.querySelector(`[data-tool-pick="${i}"]`);
      if (box) box.innerHTML = toolChips(step, i);
      const row = document.querySelector(`[data-step-row][data-idx="${i}"]`);
      const hidden = /** @type {HTMLInputElement | null} */ (row && row.querySelector('[name=stepMetric]'));
      if (hidden) hidden.value = step.expectedMetric || '';
    });
  }

  function collect() {
    const form = $('#guideForm');
    if (!form) return;
    state.categoryType = $('#gCategory').value;
    state.category = $('#gCat').value;
    state.robotModel = $('#gModel').value;
    state.codeOrTitle = $('#gTitle').value;
    // 요약 칸은 없앴다. 예전 가이드가 갖고 있던 요약은 그대로 두고 저장한다
    // (시트의 '요약' 열도 그대로다 — 지우면 옛 기록이 사라진다).
    state.requiredTools = $('#gTools').value;
    state.commands = $$('[data-cmd-row]').map((rowEl) => ({
      label: $('[name=cmdLabel]', rowEl).value,
      cmd: $('[name=cmdText]', rowEl).value,
      desc: $('[name=cmdDesc]', rowEl).value,
    }));
    // 사진 · 영상은 화면 칸이 아니라 state 에 있다 (v3.40 여러 장) — 차례는 화면 차례와 같다
    state.steps = $$('[data-step-row]').map((rowEl, i) => {
      const media = (state.steps[i] && state.steps[i].media) || [];
      return {
        instruction: $('[name=stepText]', rowEl).value,
        expectedMetric: $('[name=stepMetric]', rowEl).value,
        media,
        imageUrl: media.length ? media[0].url : '',
      };
    });
  }

  function render() {
    view.innerHTML = `
      <div class="page-head">
        <h1 class="page-head__title">${guideId ? '가이드 수정' : '새 가이드 작성'}</h1>
      </div>
      <form id="guideForm" autocomplete="off">
        <div class="panel">
          <div class="field">
            <label>로봇</label>
            <input type="hidden" id="gModel" value="${h(state.robotModel)}" />
            <div class="type-pick" data-pick="model">
              ${[...models, ...(state.robotModel && !models.includes(state.robotModel) ? [state.robotModel] : []), '']
                .map((m) => `
                <button class="btn btn-secondary${state.robotModel === m ? ' is-on' : ''}"
                        data-act="pick-model" data-model="${h(m)}" type="button"
                        aria-pressed="${state.robotModel === m}">${h(m || NONE_LABEL)}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <label>항목<span class="req">*</span></label>
            <!-- 고른 로봇의 항목 (v3.40) — 로봇마다 [항목 편집] 에서 만들고 · 바꾸고 · 지운다.
                 작은 선택칸 대신 손가락 크기의 버튼 — 첫 칸에서 헤매지 않게. -->
            <input type="hidden" id="gCategory" value="${h(state.categoryType)}" />
            <input type="hidden" id="gCat" value="${h(state.category)}" />
            <div class="type-pick" data-pick="type">
              ${robotCats.map((c) => `
                <button class="btn btn-secondary${state.category === c.id ? ' is-on' : ''}"
                        data-act="pick-type" data-type="${h(c.form)}" data-cat="${h(c.id)}" type="button"
                        aria-pressed="${state.category === c.id}">${h(c.name)}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <label>오류 코드 / 제목<span class="req">*</span></label>
            <input class="input" id="gTitle" value="${h(state.codeOrTitle)}"
                   placeholder="예) E-101 로더 모터 과전류" />
          </div>
          <div class="field">
            <label>준비 공구 · 부품</label>
            <input class="input" id="gTools" value="${h(state.requiredTools)}"
                   placeholder="쉼표로 구분 · 예) 멀티미터, 육각 렌치 3mm" />
          </div>
        </div>

        <div class="panel">
          <div class="row row--between" style="margin-bottom:12px">
            <h2 class="panel__title" style="margin:0">단계 (${state.steps.length})</h2>
            <button class="btn btn--ghost btn--sm" data-act="add-step" type="button">＋ 단계 추가</button>
          </div>
          <div class="stack">
            ${state.steps.map((s, i) => `
              <div class="sub-card" data-step-row data-idx="${i}">
                <div class="row row--between" style="margin-bottom:8px">
                  <strong>STEP ${i + 1}</strong>
                  <div class="row" style="gap:6px">
                    <button class="btn btn--ghost btn--sm" data-act="up" data-idx="${i}" type="button" ${i === 0 ? 'disabled' : ''} aria-label="위로">↑</button>
                    <button class="btn btn--ghost btn--sm" data-act="down" data-idx="${i}" type="button" ${i === state.steps.length - 1 ? 'disabled' : ''} aria-label="아래로">↓</button>
                    <button class="btn btn--danger btn--sm" data-act="del-step" data-idx="${i}" type="button">삭제</button>
                  </div>
                </div>
                <div class="field"><label>작업 내용<span class="req">*</span></label>
                  <textarea class="textarea" name="stepText" placeholder="예) 모터 커넥터 CN3 양단 전압을 측정한다.">${h(s.instruction)}</textarea></div>
                <div class="field">
                  <label>필요 공구 · 부품</label>
                  <input type="hidden" name="stepMetric" value="${h(s.expectedMetric)}" />
                  <div class="tag-list" data-tool-pick="${i}">${toolChips(s, i)}</div>
                </div>
                <div class="field" style="margin-bottom:0">
                  <label>참고 사진 · 영상 <span class="tnum">${mediaOf(s).length}</span>개</label>
                  ${mediaOf(s).length ? `<div class="gm-grid">${mediaOf(s).map((m, j) => `
                    <div class="gm-tile">
                      ${stepMediaHtml(m.url, 'step__img step__img--edit', `참고 자료 ${j + 1}`)}
                      ${isStepVideo(m.url) ? `<span class="gm-tile__len tnum">${m.sec ? `${m.sec}초` : '영상'}</span>` : ''}
                      <button class="gm-tile__del" data-act="del-media" data-idx="${i}" data-m="${j}" type="button"
                              aria-label="참고 자료 ${j + 1} 빼기">✕</button>
                    </div>`).join('')}</div>` : ''}
                  <div class="row" style="margin-top:8px">
                    <button class="btn btn--ghost btn--sm" data-act="step-capture" data-idx="${i}" type="button">사진 촬영</button>
                    <button class="btn btn--ghost btn--sm" data-act="step-record" data-idx="${i}" type="button">영상 촬영</button>
                    <button class="btn btn--ghost btn--sm" data-act="step-pick" data-idx="${i}" type="button">앨범 · 파일</button>
                  </div>
                  <span class="hint">여러 장 붙일 수 있습니다 · 영상은 이 단계에 모두 합쳐 1분까지
                    (지금 <span class="tnum">${videoTotal(mediaOf(s))}</span>초)</span>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <!-- 명령어는 접었다 폈다 (v3.35) — 대부분의 가이드는 명령어가 없거나 적은데 자리를 많이 차지했다 -->
        <details class="panel panel--fold cmd-fold" id="cmdFold"${cmdOpen ? ' open' : ''}>
          <summary><span class="panel__title">명령어 <span class="tnum">${state.commands.length}</span>개</span>
            <span class="cmd-fold__hint">${cmdOpen ? '접기' : '펼쳐서 보기 · 추가'}</span></summary>
          <div class="row row--between" style="margin:14px 0 12px">
            <span class="hint">복사해서 쓰는 명령어 — 없으면 비워 두세요</span>
            <button class="btn btn--ghost btn--sm" data-act="add-cmd" type="button">＋ 명령어 추가</button>
          </div>
          <div class="stack">
            ${state.commands.map((c, i) => `
              <div class="sub-card" data-cmd-row data-idx="${i}">
                <div class="row row--between" style="margin-bottom:8px">
                  <strong>#${i + 1}</strong>
                  <button class="btn btn--danger btn--sm" data-act="del-cmd" data-idx="${i}" type="button">삭제</button>
                </div>
                <div class="field"><label>설명 라벨</label>
                  <input class="input" name="cmdLabel" value="${h(c.label || '')}" placeholder="예) 현재 버전 확인" /></div>
                <div class="field"><label>명령어</label>
                  <input class="input mono" name="cmdText" value="${h(c.cmd || '')}" placeholder="bhctl version" /></div>
                <div class="field" style="margin-bottom:0"><label>주의사항</label>
                  <input class="input" name="cmdDesc" value="${h(c.desc || '')}" placeholder="예) 진행 중 전원 차단 금지" /></div>
              </div>`).join('') || '<div class="empty">등록된 명령어가 없습니다.</div>'}
          </div>
        </details>

        <div class="form-actions">
          <button class="btn btn--ghost" data-act="cancel" type="button">취소</button>
          <button class="btn btn--primary" type="submit">저장</button>
        </div>
      </form>
      <input type="file" id="stepCapture" accept="image/*" capture="environment" style="display:none" />
      <input type="file" id="stepRecord" accept="video/*" capture="environment" style="display:none" />
      <input type="file" id="stepPick" accept="image/*,video/*" multiple style="display:none" />`;

    // 리스너는 매 렌더마다 새로 생성되는 form 에만 연결해 중복 등록을 막는다.
    const form = $('#guideForm');
    form.addEventListener('submit', save);
    form.addEventListener('click', onClick);
    // 접고 편 것을 기억한다 — 단계를 더하거나 사진을 붙여 다시 그려도 그대로
    const fold = $('#cmdFold');
    if (fold) {
      fold.addEventListener('toggle', () => {
        cmdOpen = fold.open;
        const hint = fold.querySelector('.cmd-fold__hint');
        if (hint) hint.textContent = cmdOpen ? '접기' : '펼쳐서 보기 · 추가';
      });
    }

    // [준비 공구 · 부품] 을 고치면 단계의 고를 거리도 따라 바뀌어야 한다.
    // 글자를 칠 때마다 화면 전체를 다시 그리면 커서가 튀므로 칩만 다시 그린다.
    $('#gTools').addEventListener('input', () => {
      state.requiredTools = $('#gTools').value;
      pruneStepTools();
      paintToolChips();
    });

    hydrateMedia(view);
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const idx = Number(btn.dataset.idx);

    if (act === 'toggle-tool') {
      collect();
      const step = state.steps[idx];
      const tool = btn.dataset.tool;
      const chosen = splitTools(step.expectedMetric);
      step.expectedMetric = (chosen.includes(tool)
        ? chosen.filter((t) => t !== tool)
        : [...chosen, tool]).join(', ');
      paintToolChips();
      return;
    }

    if (act === 'add-cmd') { collect(); cmdOpen = true; state.commands.push({ label: '', cmd: '', desc: '' }); render(); }
    if (act === 'del-cmd') { collect(); state.commands.splice(idx, 1); render(); }
    if (act === 'add-step') { collect(); state.steps.push({ instruction: '', expectedMetric: '', imageUrl: '', media: [] }); render(); }
    if (act === 'del-step') {
      collect();
      state.steps.splice(idx, 1);
      if (!state.steps.length) state.steps.push({ instruction: '', expectedMetric: '', imageUrl: '', media: [] });
      render();
    }
    if (act === 'up' && idx > 0) {
      collect();
      [state.steps[idx - 1], state.steps[idx]] = [state.steps[idx], state.steps[idx - 1]];
      render();
    }
    if (act === 'down' && idx < state.steps.length - 1) {
      collect();
      [state.steps[idx + 1], state.steps[idx]] = [state.steps[idx], state.steps[idx + 1]];
      render();
    }
    if (act === 'pick-model') {
      $('#gModel').value = btn.dataset.model;
      collect();
      await loadRobotCats();          // 로봇마다 항목이 다르다 (v3.40)
      render();
      return;
    }
    if (act === 'pick-type') {
      $('#gCategory').value = btn.dataset.type;
      $('#gCat').value = btn.dataset.cat || btn.dataset.type;
      $$('[data-pick="type"] .btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      return;
    }
    if (act === 'del-media') {
      collect();
      state.steps[idx].media.splice(Number(btn.dataset.m), 1);
      render();
    }
    // 리포트와 같은 세 가지 — 찍기(사진) · 찍기(영상) · 앨범에서 고르기.
    // 촬영은 capture 가 붙은 칸을 써야 카메라가 바로 열린다.
    if (act === 'step-capture' || act === 'step-record' || act === 'step-pick') {
      const input = $({ 'step-capture': '#stepCapture', 'step-record': '#stepRecord',
                        'step-pick': '#stepPick' }[act]);
      const label = btn.textContent;
      input.value = '';
      input.onchange = async () => {
        // 여러 장 (v3.40) — 앨범에서 한꺼번에 골라도 하나씩 붙인다
        for (const file of Array.from(input.files || [])) await addStepFile(idx, file, btn, label);
      };
      input.click();
    }
    if (act === 'cancel') {
      const ok = await confirmDialog('편집 취소', '저장하지 않은 내용은 사라집니다.', '나가기', true);
      if (ok) history.length > 1 ? history.back() : (location.hash = '#/');
    }
  }

  /**
   * 단계에 사진 · 영상 하나를 붙인다 (v3.40 — 여러 장, 영상은 단계마다 모두 합쳐 1분).
   * 1) 기기에 먼저 담는다 — 오프라인에서도 바로 보인다.
   * 2) 시트가 연결돼 있으면 드라이브에도 올린다 — 그래야 **다른 사람도** 본다.
   *    제목이 없으면 폴더 이름을 정할 수 없으니 저장할 때 올린다.
   */
  async function addStepFile(idx, file, btn, label) {
    const video = isVideoFile(file);
    const kind = video ? '영상' : '사진';
    collect();
    const step = state.steps[idx];
    let sec = null;
    if (video) {
      sec = await videoSeconds(file);
      const have = videoTotal(step.media);
      const add = sec || STEP_VIDEO_LIMIT;
      if (have + add > STEP_VIDEO_LIMIT) {
        toast(`이 단계 영상은 모두 합쳐 1분까지입니다 — 지금 ${have}초, 새 영상 ${sec ? `${sec}초` : '길이 모름(1분으로 셈)'}. `
          + '짧게 다시 찍거나 다른 영상을 빼 주세요.', 'err');
        return;
      }
    }
    btn.disabled = true;
    btn.textContent = '올리는 중…';
    try {
      const media = await api.uploadMedia(file);
      const item = { url: media.url, sec };
      step.media.push(item);
      render();
      const title = (state.codeOrTitle || '').trim();
      if (title && await guideMediaEnabled()) {
        try {
          item.url = await uploadGuidePhoto(file, state.categoryType, title);
          collect();
          render();
          toast(`${kind}을 드라이브에 올렸습니다. 팀 전체가 볼 수 있습니다.`, 'ok');
        } catch (err) {
          toast(`${kind}은 이 기기에만 저장했습니다 — ${err.message}`, 'err');
        }
      } else {
        toast(title
          ? `${kind}을 첨부했습니다. (구글 시트 연결 시 팀에 공유됩니다)`
          : `${kind}을 첨부했습니다. 제목을 넣고 저장하면 팀에 공유됩니다.`, 'ok');
      }
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /**
   * 저장 직전에 기기 안에만 있는 단계 사진을 드라이브로 올린다.
   *
   * 사진을 붙일 때는 제목이 아직 없을 수 있고(새 가이드), 폴더 이름이 제목이라
   * 그때는 올릴 수가 없다. 제목이 확정되는 저장 시점에 한 번 더 챙긴다.
   */
  async function uploadPendingPhotos() {
    const title = (state.codeOrTitle || '').trim();
    if (!title || !(await guideMediaEnabled())) return;
    for (const step of state.steps) {
      for (const m of step.media || []) {
        const url = String(m.url || '');
        if (!url.startsWith('/media/')) continue;
        try {
          const blob = await (await import('../local/store.js'))
            .getMediaBlob(url.split('/').pop());
          if (!blob) continue;
          m.url = await uploadGuidePhoto(blob, state.categoryType, title);
        } catch { /* 못 올려도 기기에는 남는다 — 다음 저장에서 다시 시도한다 */ }
      }
      step.imageUrl = step.media && step.media.length ? step.media[0].url : '';
    }
  }

  async function save(ev) {
    ev.preventDefault();
    collect();
    await uploadPendingPhotos();
    if (!state.codeOrTitle.trim()) { toast('오류 코드 / 제목은 필수입니다.', 'err'); return; }
    const submitBtn = $('#guideForm button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중…';
    try {
      const payload = {
        categoryType: state.categoryType,
        category: state.category,
        robotModel: state.robotModel,
        codeOrTitle: state.codeOrTitle,
        summary: '',                    // 요약은 더 쓰지 않는다 (v3.32) — 고치면 시트의 요약 칸도 비운다
        requiredTools: state.requiredTools,
        commands: state.commands,
        steps: state.steps,
      };
      const saved = guideId
        ? await api.updateGuide(guideId, payload)
        : await api.createGuide(payload);
      toast('저장했습니다.', 'ok');
      location.hash = `#/guides/${saved.id}`;
    } catch (err) {
      toast(err.message, 'err');
      submitBtn.disabled = false;
      submitBtn.textContent = '저장';
    }
  }

  render();
}

/**
 * 이 오류 코드로 쓴 리포트 — 기기에 받아 둔 최근 3달 이력에서 찾는다.
 * 상세 화면 아래 칸(#gdReports)에 채운다. 없으면 칸을 숨긴다.
 */
export async function paintGuideReports(guide) {
  const box = document.getElementById('gdReports');
  if (!box || guide.categoryType !== 'ERROR_CODE') { if (box) box.hidden = true; return; }
  const { loadEntries, normCode, guideCode, openDays } = await import('../insights.js');
  const code = normCode(guideCode(guide));
  const { entries } = await loadEntries(3);
  const mine = entries.filter((e) => normCode(e.code) === code);
  if (!mine.length) { box.hidden = true; return; }
  const { trackOf } = await import('./report-common.js');
  box.hidden = false;
  box.innerHTML = `
    <h2 class="panel__title">이 오류로 쓴 리포트 <span class="tnum">${mine.length}</span>건 <span class="muted">최근 3달</span></h2>
    <div class="gd-reports">
      ${mine.slice(0, 8).map((e) => `
        <a class="gd-report" data-track="${trackOf(e.status).cls}" href="#/reports?open=${encodeURIComponent(e.key)}">
          <span class="gd-report__top"><b class="tnum">${h((e.date || '').slice(5))}</b>
            <span>${h(trackOf(e.status).short)}${e.status !== '조치 완료' ? ` · ${openDays(e)}일째` : ''}</span></span>
          <span class="gd-report__store">${h(e.store || '(매장 없음)')}</span>
        </a>`).join('')}
    </div>`;
}
