// 현장 리포트 작성 (동적 폼) · 이력 · 상세 / 구글 시트 업로드
import { api } from '../api.js';
import {
  $, h, confirmDialog, copyText, loading, openSheet, toast,
} from '../ui.js';
import { reportToText, shareReport } from '../share.js';
import { explain as explainError, thumbUrl } from '../reportsheet.js';

const DRAFT_KEY = 'bh_report_draft';

// ------------------------------------------------------------ 작성 화면
export async function reportFormView(view) {
  loading(view);
  const [{ items: fields }, settings] = await Promise.all([
    api.listFields(), api.getSettings(),
  ]);

  // { fieldId: { value: string, media: [{id,filename,url,mime,originalName}] } }
  let values = {};
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (saved && saved.values) values = saved.values;
  } catch { /* 무시 */ }
  fields.forEach((f) => {
    if (!values[f.id]) values[f.id] = { value: '', media: [] };
    if (!Array.isArray(values[f.id].media)) values[f.id].media = [];
  });

  const hasDraft = fields.some((f) => values[f.id].value || values[f.id].media.length);
  const sheetsReady = !!settings.sheetsReady;
  let reportId = null;   // 저장 후 재업로드 대상

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ values, savedAt: new Date().toISOString() }));
  }

  function mediaTile(fieldId, media, idx) {
    const isVideo = (media.mime || '').startsWith('video/');
    return `
      <div class="media-tile">
        ${isVideo
          ? `<video src="${h(media.url)}" muted playsinline></video>`
          : `<img src="${h(media.url)}" alt="${h(media.originalName || '첨부')}" loading="lazy" />`}
        <button class="media-tile__del" data-act="del-media" data-field="${fieldId}" data-idx="${idx}" type="button" aria-label="첨부 삭제">✕</button>
        <div class="media-tile__name">${h(media.originalName || media.filename)}</div>
      </div>`;
  }

  function fieldHtml(field) {
    const state = values[field.id];
    const label = `<label>${h(field.fieldLabel)}${field.isRequired ? '<span class="req">*</span>' : ''}</label>`;

    if (field.fieldType === 'MEDIA') {
      return `
        <div class="field" data-field-id="${field.id}">
          ${label}
          <div class="row">
            <button class="btn btn--ghost" data-act="capture" data-field="${field.id}" type="button">📷 촬영</button>
            <button class="btn btn--ghost" data-act="pick" data-field="${field.id}" type="button">🖼 앨범/파일 선택</button>
            <span class="badge">${state.media.length}개 첨부</span>
          </div>
          ${state.media.length ? `<div class="media-grid">${state.media.map((m, i) => mediaTile(field.id, m, i)).join('')}</div>` : ''}
          <span class="hint">사진·영상은 <strong>구글 드라이브에 저장</strong>되고 시트에는 링크가 들어갑니다.
            이력 화면에서 미리보기로 볼 수 있습니다. (한 개 20MB, 리포트당 25MB 까지)</span>
        </div>`;
    }
    if (field.fieldType === 'TEXTAREA') {
      return `<div class="field">${label}
        <textarea class="textarea" data-input="${field.id}" placeholder="자세히 기록">${h(state.value)}</textarea></div>`;
    }
    if (field.fieldType === 'DROPDOWN') {
      const opts = (field.options || '').split(',').map((o) => o.trim()).filter(Boolean);
      return `<div class="field">${label}
        <select class="select" data-input="${field.id}">
          <option value="">선택하세요</option>
          ${opts.map((o) => `<option value="${h(o)}" ${state.value === o ? 'selected' : ''}>${h(o)}</option>`).join('')}
        </select></div>`;
    }
    const type = field.fieldType === 'NUMBER' ? 'number' : 'text';
    return `<div class="field">${label}
      <input class="input" type="${type}" ${type === 'number' ? 'inputmode="decimal"' : ''}
             data-input="${field.id}" value="${h(state.value)}" /></div>`;
  }

  function render() {
    view.innerHTML = `
      <div id="pageRoot">
        <div class="page-head">
          <h1>📝 새 현장 리포트</h1>
          <p>입력 항목은 [🧩 항목 설정]에서 언제든 바꿀 수 있습니다.
            작성 중 내용은 자동 임시보관됩니다.</p>
        </div>

        ${hasDraft ? `
          <div class="panel" style="border-color:var(--warn)">
            <div class="row row--between">
              <div><strong>작성 중이던 내용을 복구했습니다.</strong>
                <div class="muted" style="font-size:.9rem">새로 시작하려면 초기화하세요.</div></div>
              <button class="btn btn--ghost btn--sm" data-act="clear-draft" type="button">초기화</button>
            </div>
          </div>` : ''}

        <form id="reportForm" autocomplete="off">
          <div class="panel">
            ${fields.length ? fields.map(fieldHtml).join('')
              : '<div class="empty">입력 항목이 없습니다. <a class="link" href="#/fields">🧩 항목 설정</a>에서 먼저 항목을 만드세요.</div>'}
          </div>
          ${fields.length ? `
            <div class="form-actions">
              <button class="btn btn--ghost" data-act="save-draft" type="button">💾 저장만</button>
              <button class="btn btn--primary" type="submit">📊 구글 시트로 업로드</button>
            </div>
            <p class="muted" style="margin:12px 0 0;font-size:.9rem;line-height:1.6">
              ${sheetsReady
                ? '업로드하면 공유 스프레드시트의 <strong>이번 달 시트</strong>에 한 줄로 기록됩니다.'
                : '<span style="color:var(--danger);font-weight:700">구글 시트 연결이 아직 설정되지 않았습니다. ⚙️ 설정에서 먼저 연결하세요.</span>'}
            </p>` : ''}
        </form>

        <input type="file" id="mediaCapture" accept="image/*" capture="environment" style="display:none" />
        <input type="file" id="mediaPick" accept="image/*,video/*,application/pdf" multiple style="display:none" />
      </div>`;

    const root = $('#pageRoot');
    root.addEventListener('click', onClick);
    root.addEventListener('input', (ev) => {
      const id = ev.target.dataset.input;
      if (!id) return;
      values[id].value = ev.target.value;
      saveDraft();
    });
    root.addEventListener('change', (ev) => {
      const id = ev.target.dataset.input;
      if (!id) return;
      values[id].value = ev.target.value;
      saveDraft();
    });
    $('#reportForm').addEventListener('submit', submit);
  }

  function collectPayload() {
    return fields.map((field) => ({
      fieldId: field.id,
      label: field.fieldLabel,
      type: field.fieldType,
      value: values[field.id].value,
      media: values[field.id].media,
    }));
  }

  function missingRequired() {
    return fields.filter((f) => {
      if (!f.isRequired) return false;
      return f.fieldType === 'MEDIA'
        ? values[f.id].media.length === 0
        : !String(values[f.id].value || '').trim();
    });
  }

  /**
   * 태블릿 사진은 3~5MB 나 되므로, 올리기 전에 가로/세로 최대 1600px 로 줄인다.
   * 화면 확인과 시트 삽입에는 충분하고 업로드가 훨씬 빨라진다.
   */
  async function shrinkImage(file) {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    try {
      // 구형 태블릿에서 사진이 눕지 않도록 EXIF 방향을 반영한다
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const max = 1600;
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 1.2 * 1024 * 1024) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close && bitmap.close();
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob || blob.size >= file.size) return file;
      const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg' });
    } catch {
      return file;      // 변환 실패 시 원본 그대로
    }
  }

  async function uploadFiles(fieldId, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    toast(`${files.length}개 파일 업로드 중…`);
    for (const original of files) {
      try {
        const file = await shrinkImage(original);
        const media = await api.uploadMedia(file);
        values[fieldId].media.push({
          id: media.id, filename: media.filename, url: media.url,
          mime: media.mime, originalName: media.originalName,
        });
      } catch (err) {
        toast(`${original.name}: ${err.message}`, 'err');
      }
    }
    saveDraft();
    render();
    toast('업로드를 완료했습니다.', 'ok');
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'capture' || act === 'pick') {
      const input = $(act === 'capture' ? '#mediaCapture' : '#mediaPick');
      input.value = '';
      input.onchange = () => uploadFiles(btn.dataset.field, input.files);
      input.click();
      return;
    }
    if (act === 'del-media') {
      values[btn.dataset.field].media.splice(Number(btn.dataset.idx), 1);
      saveDraft();
      render();
      return;
    }
    if (act === 'clear-draft') {
      const ok = await confirmDialog('작성 내용 초기화', '입력한 모든 내용과 첨부를 비웁니다.', '초기화', true);
      if (!ok) return;
      localStorage.removeItem(DRAFT_KEY);
      location.reload();
      return;
    }
    if (act === 'save-draft') {
      btn.disabled = true;
      const saved = await persist({ requireComplete: false });
      if (saved) {
        toast('저장했습니다. [🗂 리포트]에서 다시 열 수 있습니다.', 'ok');
      }
      btn.disabled = false;
      return;
    }

  }

  /**
   * 리포트를 서버에 저장한다. 반환: 저장된 리포트 객체 · 실패는 null
   */
  async function persist({ requireComplete }) {
    if (requireComplete) {
      const missing = missingRequired();
      if (missing.length) {
        toast(`필수 항목을 입력하세요: ${missing.map((f) => f.fieldLabel).join(', ')}`, 'err');
        return null;
      }
    }
    const payload = { values: collectPayload(), draft: !requireComplete };
    try {
      const saved = reportId
        ? await api.updateReport(reportId, payload)
        : await api.createReport(payload);
      reportId = saved.id;
      return saved;
    } catch (err) {
      toast(err.message, 'err');
      return null;
    }
  }

  async function submit(ev) {
    ev.preventDefault();
    const submitBtn = $('#reportForm button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중…';
    const saved = await persist({ requireComplete: true });
    if (!saved) {
      submitBtn.disabled = false;
      submitBtn.textContent = '📊 구글 시트로 업로드';
      return;
    }
    submitBtn.textContent = '구글 시트에 올리는 중…';
    try {
      const result = await api.uploadReportToSheet(saved.id);
      localStorage.removeItem(DRAFT_KEY);
      if (result.queued) {
        // 오프라인 — 기기에 저장해 두었다가 연결되면 자동으로 올린다.
        toast('⏳ 기기에 저장했습니다. 인터넷에 연결되면 자동으로 시트에 올립니다.', 'ok');
      } else {
        toast(`구글 시트 [${result.sheetName}] ${result.row}행에 기록했습니다.`
          + (result.media ? ` (첨부 ${result.media}개 드라이브 저장)` : ''), 'ok');
        (result.mediaSkipped || []).forEach((s) =>
          toast(`첨부 제외: ${s.filename} (${s.reason})`, 'err'));
      }
      location.hash = `#/reports/${saved.id}`;
    } catch (err) {
      toast(err.message, 'err');
      toast('리포트는 저장되었습니다. [🗂 리포트]에서 다시 업로드할 수 있습니다.');
      location.hash = `#/reports/${saved.id}`;
    }
    submitBtn.disabled = false;
    submitBtn.textContent = '📊 구글 시트로 업로드';
  }

  render();
}

// ------------------------------------------------------------ 이력 목록
const STATUS = {
  DRAFT: ['badge', '저장됨 (업로드 안 함)'],
  QUEUED: ['badge badge--warn', '⏳ 업로드 대기 (연결되면 자동)'],
  UPLOADED: ['badge badge--ok', '구글 시트 업로드 완료'],
  FAILED: ['badge badge--danger', '업로드 실패'],
};

/** 추적 상태 4종 — 시트 '상태' 열의 값과 1:1 로 맞춘다. */
const TRACK = [
  { value: '조치 완료',    short: '조치 완료', cls: 'done' },
  { value: '모니터링',     short: '모니터링',  cls: 'watch' },
  { value: '조치 진행 중', short: '진행 중',   cls: 'doing' },
  { value: '교체 예정',    short: '교체 예정', cls: 'swap' },
];
const trackOf = (value) => TRACK.find((t) => t.value === value) || TRACK[2];

/** 연도는 위 월 선택기에 이미 있으므로 줄에는 월-일만 보여 준다. */
const shortDate = (value) => {
  const text = String(value || '');
  return text.length >= 10 ? text.slice(5) : (text || '-');
};

/**
 * 이력 화면 — 구글 시트의 월별 탭이 원본이다.
 *
 * 위쪽 네 칸이 상태별 건수이자 필터다. 이번 달에 아직 안 끝난 건이 몇 개인지
 * 세지 않아도 보이는 것이 이 화면의 목적이다.
 */
export async function reportListView(view) {
  loading(view);

  const settings = await api.getSettings();
  if (!settings.sheetsReady) {
    view.innerHTML = `
      <div class="page-head"><h1>🗂 현장 리포트 이력</h1></div>
      <div class="empty">
        구글 시트 연결이 아직 설정되지 않았습니다.<br />
        <a class="link" href="#/settings">⚙️ 설정</a> 에서 웹 앱 URL 을 먼저 등록하세요.
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

  let month = months[0];
  let data = { entries: [], fromCache: false, error: null };
  let filter = null;          // null = 전체
  let query = '';
  let localItems = [];

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

  function tilesHtml() {
    const c = counts();
    return `<div class="stat-grid">
      ${TRACK.map((t) => `
        <button class="stat ${filter === t.value ? 'is-active' : ''}"
                data-act="filter" data-value="${h(t.value)}" type="button"
                aria-pressed="${filter === t.value}">
          <span class="stat__n tnum">${c[t.value]}</span>
          <span class="stat__label">${h(t.value)}</span>
        </button>`).join('')}
    </div>`;
  }

  function rowsHtml() {
    const list = visible();
    if (!list.length) {
      return `<div class="empty">${
        query || filter ? '조건에 맞는 리포트가 없습니다.' : '이 달에 기록된 리포트가 없습니다.'
      }</div>`;
    }
    return `<div class="scroll"><div class="rows">
      ${list.map((e) => {
        const attach = e.links.length
          ? ` · 첨부 <span class="tnum">${e.links.length}</span>` : '';
        const detail = [e.code, e.summary].filter(Boolean).join(' · ');
        return `
          <div class="row">
            <button class="row__code tnum" data-act="open" data-key="${h(e.key)}"
                    type="button" aria-label="상세 보기">${h(shortDate(e.date))}</button>
            <button class="row__main" data-act="open" data-key="${h(e.key)}" type="button">
              <span class="row__title">${h(e.store || '(식당명 없음)')}</span>
              <span class="row__meta">${h(e.author || '-')}${attach}${detail ? ` · ${h(detail)}` : ''}</span>
            </button>
            <select class="select status-select" data-act="status" data-key="${h(e.key)}"
                    aria-label="${h(e.store || '리포트')} 상태">
              ${TRACK.map((o) => `<option value="${h(o.value)}" ${o.value === e.status ? 'selected' : ''}>${h(o.value)}</option>`).join('')}
            </select>
          </div>`;
      }).join('')}
    </div></div>`;
  }

  function localHtml() {
    if (!localItems.length) return '';
    return `
      <div class="panel panel--warn">
        <div class="row row--between" style="margin-bottom:8px">
          <strong>아직 시트에 올리지 않은 리포트 ${localItems.length}건</strong>
        </div>
        <div class="list">
          ${localItems.map((r) => {
            const [cls, label] = STATUS[r.status] || STATUS.DRAFT;
            return `
              <a class="item" href="#/reports/${r.id}">
                <div class="item__body">
                  <div class="item__title">${h(r.title)}</div>
                  <div class="item__sub">${h(r.createdAt)}</div>
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
  }

  /** 못 받아 왔으면 왜인지 화면에 적는다 — 그냥 비워 두면 원인을 알 수 없다. */
  function noticeHtml() {
    if (data.error && !data.entries.length) {
      return `<div class="hist-note hist-note--bad">⚠️ 시트에서 이력을 받지 못했습니다.
        <div style="margin-top:6px;white-space:pre-wrap;font-weight:400">${h(explainError(data.error))}</div>
      </div>`;
    }
    if (data.fromCache) {
      return '<div class="hist-note">📴 연결이 안 돼 마지막으로 받아 둔 내용을 보여 줍니다.</div>';
    }
    return '';
  }

  /**
   * 화면을 두 겹으로 나눈다.
   *  - 껍데기(renderShell): 검색창·월 선택기. **한 번만 만들고 다시 만들지 않는다.**
   *  - 알맹이(paint): 타일·목록. 검색·필터 때마다 이 부분만 갈아 끼운다.
   *
   * 한 글자 칠 때마다 화면 전체를 다시 그리면 입력 칸이 새로 만들어져
   * 한글 조합이 끊긴다("옥동식" → "ㅇㅗㄱㄷㅗㅇㅅㅣㄱ"). 입력 칸을 그대로 두는 것이
   * 이 문제의 유일한 확실한 해결책이다.
   */
  function renderShell() {
    view.innerHTML = `
      <div id="pageRoot" style="display:flex;flex-direction:column;gap:var(--space-4);flex:1;min-height:0">
        <div class="page-head">
          <h1 class="page-head__title">리포트 이력</h1>
          <span class="page-head__meta" id="histMeta"></span>
          <span class="page-head__spacer"></span>
          <select class="select" id="histMonth" aria-label="월 선택"></select>
        </div>
        <div id="histTop"></div>
        <div class="toolbar">
          <input class="input" id="histQ" type="search"
                 placeholder="식당명 · 날짜 (미트로, 08-22)" aria-label="이력 검색" />
          <button class="btn btn-secondary" data-act="refresh" type="button">🔄 시트에서 받기</button>
        </div>
        <div id="histBody" style="display:flex;flex-direction:column;gap:var(--space-3);flex:1;min-height:0"></div>
      </div>`;

    const root = $('#pageRoot');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);

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
    top.innerHTML = tilesHtml();
    body.innerHTML = noticeHtml() + localHtml() + rowsHtml();
    paintMeta();
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'filter') {
      const value = btn.dataset.value;
      filter = filter === value ? null : value;
      paint();
      return;
    }
    if (act === 'clear') { filter = null; paint(); return; }
    if (act === 'open') {
      const entry = (data.entries || []).find((e) => e.key === btn.dataset.key);
      if (entry) showEntry(entry);
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
      toast(data.fromCache ? '연결이 안 돼 기존 내용을 유지합니다.' : '시트에서 받았습니다.',
            data.fromCache ? 'err' : 'ok');
    }
  }

  async function onChange(ev) {
    const el = ev.target;
    if (el.id === 'histMonth') {
      month = el.value;
      filter = null;
      // 검색창을 살려 두기 위해 목록 자리에만 안내를 띄운다.
      const body = document.querySelector('#histBody');
      if (body) body.innerHTML = '<div class="skeleton">불러오는 중…</div>';
      await load({ refresh: true });
      paint();
      return;
    }
    if (el.dataset.act === 'status') {
      const entry = (data.entries || []).find((e) => e.key === el.dataset.key);
      if (!entry) return;
      const before = entry.status;
      const next = el.value;
      entry.status = next;                 // 화면은 곧바로 반응한다
      paint();
      try {
        const result = await api.setReportStatus(entry.sheetName, entry.row, next);
        toast(result.queued
          ? '⏳ 오프라인입니다. 연결되면 시트에 반영합니다.'
          : `상태를 '${next}' 로 바꿨습니다.`, 'ok');
      } catch (err) {
        entry.status = before;             // 실패하면 되돌린다
        paint();
        toast(err.message, 'err');
      }
    }
  }

  /** 시트 한 줄의 전체 내용 + 첨부를 모달로 보여 준다. */
  function showEntry(entry) {
    const body = `
      <div class="hist-detail">
        <div class="row" style="gap:8px;margin-bottom:12px">
          <span class="pill pill--${trackOf(entry.status).cls}">${h(entry.status)}</span>
          <span class="badge">${h(entry.createdAt || entry.date)}</span>
          ${entry.author ? `<span class="badge">${h(entry.author)}</span>` : ''}
        </div>
        ${entry.links.length ? `
          <div class="media-grid">
            ${entry.links.map((l) => `
              <a class="media-tile" href="${h(l.url)}" target="_blank" rel="noopener">
                ${l.id
                  ? `<img src="${h(thumbUrl(l.id, 300))}" alt="${h(l.label)}" loading="lazy"
                          onerror="this.classList.add('is-broken')" />`
                  : ''}
                <div class="media-tile__none">📎 열어 보기</div>
                <div class="media-tile__name">${h(l.label)}</div>
              </a>`).join('')}
          </div>` : ''}
        ${entry.values.map((v) => `
          <div class="field">
            <label>${h(v.label)}</label>
            <div class="sub-card" style="white-space:pre-wrap">${h(v.value)}</div>
          </div>`).join('')}
      </div>`;
    openSheet(entry.store || '리포트', body);
  }

  renderShell();
  paint();
  await load({ refresh: true });
  paintMonths();
  paint();
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
        <div class="row" style="gap:8px">
          <span class="${cls}">${label}</span>
          <span class="badge">${h(report.createdAt)}</span>
        </div>
        <h1 style="margin-top:10px">${h(report.title)}</h1>
        ${report.sheetName ? `<p class="muted">구글 시트 <strong>${h(report.sheetName)}</strong> 시트 ${report.sheetRow || '-'}행
          ${settings.spreadsheetUrl ? `· <a class="link" href="${h(settings.spreadsheetUrl)}" target="_blank" rel="noopener">스프레드시트 열기 ↗</a>` : ''}</p>` : ''}
        ${report.errorMessage ? `<p style="color:var(--danger);white-space:pre-wrap">${h(report.errorMessage)}</p>` : ''}
      </div>

      <div class="row" style="margin-bottom:16px">
        <button class="btn btn--primary btn--sm" data-act="upload" type="button">
          ${report.status === 'UPLOADED' ? '🔁 구글 시트에 다시 업로드' : '📊 구글 시트로 업로드'}
        </button>
        <button class="btn btn--ghost btn--sm" data-act="share" type="button">📤 공유</button>
        <button class="btn btn--ghost btn--sm" data-act="copy" type="button">📋 텍스트 복사</button>
        <div class="spacer"></div>
        <button class="btn btn--danger btn--sm" data-act="del" type="button">🗑 삭제</button>
      </div>

      <div class="panel">
        ${(report.payload || []).map((item) => `
          <div class="field">
            <label>${h(item.label)}</label>
            ${item.type === 'MEDIA'
              ? ((item.media || []).length
                ? `<div class="media-grid">${item.media.map((m) => `
                    <a class="media-tile" href="${h(m.url)}" target="_blank" rel="noopener">
                      ${(m.mime || '').startsWith('video/')
                        ? `<video src="${h(m.url)}" muted playsinline></video>`
                        : `<img src="${h(m.url)}" alt="${h(m.originalName || '')}" loading="lazy" />`}
                      <div class="media-tile__name">${h(m.originalName || m.filename)}</div>
                    </a>`).join('')}</div>`
                : '<p class="muted">첨부 없음</p>')
              : `<div class="sub-card" style="white-space:pre-wrap">${h(item.value || '-')}</div>`}
          </div>`).join('')}
      </div>
    </div>`;

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
        }
        reportDetailView(view, report.id);
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = '📊 구글 시트로 업로드';
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
