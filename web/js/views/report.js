// 현장 리포트 작성 (동적 폼) · 이력 · 상세 / 구글 시트 업로드
import { api } from '../api.js';
import {
  $, closeModal, confirmDialog, copyText, h, hydrateMedia, loading, openSheet,
  toast, when,
} from '../ui.js';
import { reportToText, shareReport } from '../share.js';
import {
  describeFiles, explain as explainError, findVisits, previewUrl, thumbUrl,
} from '../reportsheet.js';

// 임시보관 칸은 **둘로 나뉘어 있다.**
//   새 리포트 → NEW_DRAFT_KEY  (시트 줄 번호를 절대 갖지 않는다)
//   리포트 수정 → EDIT_DRAFT_KEY (어느 줄을 고치는 중인지 함께 담는다)
// 한 칸을 같이 쓰면, 한 번 수정한 뒤로는 [새 리포트] 를 눌러도 그 수정 내용이
// 되살아나 수정 화면이 열린다. 실제로 그런 일이 있었다.
const NEW_DRAFT_KEY = 'bh_report_draft';
const EDIT_DRAFT_KEY = 'bh_report_edit_draft';
const SEED_KEY = 'bh_report_seed';   // 이력에서 [이어서 작성] 로 넘겨받는 값

/** 이력의 한 건을 새 리포트의 출발점으로 넘긴다. */
export function seedFromEntry(entry, { edit = false } = {}) {
  sessionStorage.setItem(SEED_KEY, JSON.stringify({
    store: entry.store || '', code: entry.code || '',
    serial: (entry.values.find((v) => v.label.includes('시리얼')) || {}).value || '',
    // 고치기로 들어왔으면 어느 줄을 고쳐 쓸지 함께 넘긴다.
    // 이게 없으면 저장할 때 같은 방문이 두 줄이 된다.
    sheetLink: edit ? { sheetName: entry.sheetName, row: entry.row } : null,
    values: edit ? entry.values : null,
    // 이미 올라가 있는 사진·영상. 이걸 안 넘기면 저장할 때 시트의 링크가
    // 빈 칸으로 덮여 **드라이브에는 있는데 리포트에서는 사라진다.**
    links: edit ? entry.links.map((l) => ({ label: l.label, url: l.url, id: l.id }))
                : null,
  }));
}

/** 저장된 임시보관을 읽는다. 깨져 있으면 없는 것으로 친다. */
function readDraft(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || null; }
  catch { return null; }
}

// ------------------------------------------------------------ 작성 화면
//
// 같은 화면이 두 가지 일을 한다. 무엇을 하는지는 **주소가 정한다.**
//   #/report/new  → 언제나 빈 새 리포트 (수정 내용이 새어 들어오지 않는다)
//   #/report/edit → 이력에서 [수정] 으로 들어온 경우에만
export async function reportFormView(view) {
  loading(view);
  const editMode = location.hash.replace(/^#/, '').split('?')[0] === '/report/edit';
  const draftKey = editMode ? EDIT_DRAFT_KEY : NEW_DRAFT_KEY;
  const [{ items: fields }, settings] = await Promise.all([
    api.listFields(), api.getSettings(),
  ]);

  // { fieldId: { value: string, media: [{id,filename,url,mime,originalName}] } }
  let values = {};
  const savedDraft = readDraft(draftKey);
  if (savedDraft && savedDraft.values) values = savedDraft.values;
  fields.forEach((f) => {
    if (!values[f.id]) values[f.id] = { value: '', media: [] };
    if (!Array.isArray(values[f.id].media)) values[f.id].media = [];
    // kept = 이미 시트/드라이브에 올라가 있는 첨부 (수정으로 들어왔을 때)
    if (!Array.isArray(values[f.id].kept)) values[f.id].kept = [];
  });

  // 이력에서 [이어서 작성] 으로 왔으면 아는 값을 미리 채운다.
  let seeded = null;
  try {
    seeded = JSON.parse(sessionStorage.getItem(SEED_KEY) || 'null');
  } catch { /* 무시 */ }
  // 고치는 중인 줄. **수정 화면일 때만** 존재한다.
  // 넘겨받은 값이 우선이고, 없으면 폼을 벗어났다 돌아온 경우라 임시보관에서 되살린다.
  const editingLink = editMode
    ? ((seeded && seeded.sheetLink) || (savedDraft && savedDraft.sheetLink) || null)
    : null;

  // 다른 줄을 고치러 들어왔는데 예전 수정 내용이 남아 있으면 버린다.
  if (editMode && seeded && seeded.sheetLink && savedDraft && savedDraft.sheetLink
      && (savedDraft.sheetLink.row !== seeded.sheetLink.row
          || savedDraft.sheetLink.sheetName !== seeded.sheetLink.sheetName)) {
    values = {};
    fields.forEach((f) => { values[f.id] = { value: '', media: [], kept: [] }; });
  }

  // 주소로는 수정인데 고칠 줄을 모른다 — 이력을 거치지 않고 직접 들어온 경우.
  if (editMode && !editingLink) {
    localStorage.removeItem(EDIT_DRAFT_KEY);
    location.replace('#/reports');
    return;
  }

  if (seeded) {
    sessionStorage.removeItem(SEED_KEY);
    if (seeded.values) {
      // 고치기 — 시트에 있던 값을 항목 이름으로 맞춰 전부 채운다.
      const byLabel = new Map(seeded.values.map((v) => [v.label, v.value]));
      for (const f of fields) {
        const found = byLabel.get(f.fieldLabel);
        if (found !== undefined) values[f.id].value = found;
      }
      // 이미 올라가 있는 첨부는 그대로 들고 간다 (지우지 않는 한 유지).
      for (const link of seeded.links || []) {
        const field = fields.find((f) => f.fieldLabel === link.label)
          || fields.find((f) => f.fieldType === 'MEDIA');
        if (field) values[field.id].kept.push(link);
      }
    } else {
      // 이어서 작성 — 아는 것만 채운다.
      for (const f of fields) {
        const label = f.fieldLabel;
        if (seeded.store && (label.includes('식당') || label.includes('매장'))) {
          values[f.id].value = seeded.store;
        } else if (seeded.serial && label.includes('시리얼')) {
          values[f.id].value = seeded.serial;
        } else if (seeded.code && label.includes('오류 코드')) {
          values[f.id].value = seeded.code;
        }
      }
    }
    saveDraft();
  }

  // 지난 방문을 찾을 기준이 되는 항목 (식당명)
  const storeField = fields.find(
    (f) => f.fieldLabel.includes('식당') || f.fieldLabel.includes('매장'));

  const hasDraft = fields.some(
    (f) => values[f.id].value || values[f.id].media.length || values[f.id].kept.length);
  const sheetsReady = !!settings.sheetsReady;
  let reportId = null;   // 저장 후 재업로드 대상

  function saveDraft() {
    // 수정 대상(어느 줄을 고쳐 쓰는지)도 함께 담는다. 이게 빠지면 폼을 벗어났다
    // 돌아왔을 때 새 줄로 저장돼 같은 방문이 두 개가 된다.
    localStorage.setItem(draftKey, JSON.stringify({
      values, sheetLink: editingLink, savedAt: new Date().toISOString(),
    }));
  }

  function mediaTile(fieldId, media, idx) {
    const isVideo = (media.mime || '').startsWith('video/');
    return `
      <div class="media-tile">
        ${isVideo
          ? `<video data-media="${h(media.url)}" muted playsinline></video>`
          : `<img data-media="${h(media.url)}" alt="${h(media.originalName || '첨부')}" loading="lazy" />`}
        <button class="media-tile__del" data-act="del-media" data-field="${fieldId}" data-idx="${idx}" type="button" aria-label="첨부 삭제">✕</button>
        <div class="media-tile__name">${h(media.originalName || media.filename)}</div>
      </div>`;
  }

  /** 이미 드라이브에 있는 첨부 — 새로 올리지 않고 링크만 유지한다. */
  function keptTile(fieldId, link, idx) {
    return `
      <a class="media-tile" href="${h(link.url)}" target="_blank" rel="noopener">
        ${link.id
          ? `<img src="${h(thumbUrl(link.id, 300))}" alt="${h(link.label)}"
                  loading="lazy" onerror="this.classList.add('is-broken')" />`
          : ''}
        <span class="media-tile__none">올라간 첨부</span>
        <button class="media-tile__del" data-act="del-kept" data-field="${fieldId}"
                data-idx="${idx}" type="button" aria-label="첨부 빼기">✕</button>
        <span class="media-tile__name">${h(link.label || '이미 올림')}</span>
      </a>`;
  }

  function fieldHtml(field) {
    const state = values[field.id];
    const label = `<label>${h(field.fieldLabel)}${field.isRequired ? '<span class="req">*</span>' : ''}</label>`;

    if (field.fieldType === 'MEDIA') {
      return `
        <div class="field field--wide" data-field-id="${field.id}">
          ${label}
          <div class="row">
            <button class="btn btn--ghost" data-act="capture" data-field="${field.id}" type="button">촬영</button>
            <button class="btn btn--ghost" data-act="pick" data-field="${field.id}" type="button">앨범 · 파일</button>
            <span class="badge">${state.kept.length + state.media.length}개 첨부</span>
          </div>
          ${state.kept.length || state.media.length ? `
            <div class="media-grid">
              ${state.kept.map((l, i) => keptTile(field.id, l, i)).join('')}
              ${state.media.map((m, i) => mediaTile(field.id, m, i)).join('')}
            </div>` : ''}
          ${state.kept.length ? `<span class="hint">
            이미 올라가 있는 첨부 ${state.kept.length}개는 그대로 유지됩니다.
            빼려면 ✕ 를 누르세요.</span>` : ''}
          <span class="hint">사진·영상은 <strong>구글 드라이브에 저장</strong>되고 시트에는 링크가 들어갑니다.
            이력 화면에서 미리보기로 볼 수 있습니다. (한 개 20MB, 리포트당 25MB 까지)</span>
        </div>`;
    }
    if (field.fieldType === 'TEXTAREA') {
      // 여러 줄 항목은 두 칸을 다 쓴다 (디자인의 .field--wide)
      return `<div class="field field--wide">${label}
        <textarea class="input textarea" data-input="${field.id}" placeholder="자세히 기록">${h(state.value)}</textarea></div>`;
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
          <h1 class="page-head__title">${editingLink ? '리포트 수정' : '새 현장 리포트'}</h1>
          <span class="page-head__meta">${editingLink
            ? `${h(editingLink.sheetName)} 시트 <span class="tnum">${editingLink.row}</span>행을 고쳐 씁니다 — 새 줄이 생기지 않습니다`
            : '입력 즉시 기기에 임시보관 — 새로고침해도 복구됩니다'}</span>
          <span class="page-head__spacer"></span>
          <a class="btn btn-secondary" href="#/fields">항목 설정</a>
        </div>

        ${hasDraft ? `
          <div class="panel panel--warn">
            <div class="row row--between">
              <div><strong>작성 중이던 내용을 복구했습니다.</strong>
                <div class="muted" style="font-size:.9rem">새로 시작하려면 초기화하세요.</div></div>
              <button class="btn btn--ghost btn--sm" data-act="clear-draft" type="button">초기화</button>
            </div>
          </div>` : ''}

        <div id="pastVisits"></div>

        <form id="reportForm" autocomplete="off">
          ${fields.length ? `
            <div class="form-grid">${fields.map(fieldHtml).join('')}</div>

            <div class="form-actions">
              <span class="page-head__meta" style="margin-right:auto">
                ${sheetsReady
                  ? '올리면 공유 스프레드시트의 이번 달 시트에 한 줄로 기록됩니다'
                  : '<span style="color:var(--color-danger);font-weight:600">구글 시트 연결이 아직 없습니다 — 설정에서 먼저 연결하세요</span>'}
              </span>
              <button class="btn btn-secondary" data-act="save-draft" type="button">임시보관</button>
              <button class="btn btn-primary" type="submit">${editingLink ? '시트에 저장' : '구글 시트로 업로드'}</button>
            </div>`
            : '<div class="empty">입력 항목이 없습니다. <a class="link" href="#/fields">항목 설정</a>에서 먼저 항목을 만드세요.</div>'}
        </form>

        <input type="file" id="mediaCapture" accept="image/*" capture="environment" style="display:none" />
        <input type="file" id="mediaPick" accept="image/*,video/*,application/pdf" multiple style="display:none" />
      </div>`;

    const root = $('#pageRoot');
    root.addEventListener('click', onClick);
    hydrateMedia(view);        // 첨부 미리보기는 기기 안 파일에서 꺼낸다
    root.addEventListener('input', (ev) => {
      const id = ev.target.dataset.input;
      if (!id) return;
      values[id].value = ev.target.value;
      saveDraft();
      if (storeField && id === storeField.id) {
        clearTimeout(visitTimer);
        visitTimer = setTimeout(paintPastVisits, 350);
      }
    });
    root.addEventListener('change', (ev) => {
      const id = ev.target.dataset.input;
      if (!id) return;
      values[id].value = ev.target.value;
      saveDraft();
    });
    $('#reportForm').addEventListener('submit', submit);
    paintPastVisits();
  }

  /**
   * 같은 식당의 지난 방문을 보여 준다.
   *
   * 이 부분만 갈아 끼운다 — 입력 칸을 다시 만들면 한글 조합이 깨진다.
   * (이력 검색창에서 겪은 것과 같은 문제)
   */
  let visitTimer = null;
  async function paintPastVisits() {
    const box = $('#pastVisits');
    if (!box || !storeField) return;
    const name = values[storeField.id].value;
    const visits = await findVisits(name, 3);
    if (!visits.length) { box.innerHTML = ''; return; }

    box.innerHTML = `
      <div class="panel">
        <h2 class="panel__title">${h(name)} · 지난 방문 ${visits.length}건</h2>
        <div class="list">
          ${visits.map((v) => {
            const t = trackOf(v.status);
            const attach = v.links.length
              ? ` · 첨부 <span class="tnum">${v.links.length}</span>` : '';
            return `
              <button class="item" data-act="visit" data-key="${h(v.key)}" type="button"
                      style="width:100%;text-align:left;background:none;border:0;font:inherit;color:inherit">
                <span class="item__body">
                  <span class="item__title">${h(v.date)} · ${h(v.code || '코드 없음')}</span>
                  <span class="item__sub">${h(v.summary || '-')}${attach}</span>
                </span>
                <span class="pill pill--${t.cls}">${h(v.status)}</span>
              </button>`;
          }).join('')}
        </div>
        <p class="hint" style="margin:10px 0 0">
          눌러서 그때 무엇을 했는지 볼 수 있습니다. 기기에 받아 둔 이력에서 찾으므로 오프라인에서도 됩니다.
        </p>
      </div>`;
    box.querySelectorAll('[data-act="visit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = visits.find((v) => v.key === btn.dataset.key);
        if (found) showSheetEntry(found);
      });
    });
  }

  function collectPayload() {
    return fields.map((field) => ({
      fieldId: field.id,
      label: field.fieldLabel,
      type: field.fieldType,
      value: values[field.id].value,
      media: values[field.id].media,
      kept: values[field.id].kept,
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
    if (act === 'del-kept') {
      ev.preventDefault();          // <a> 안의 버튼이라 링크 이동을 막는다
      values[btn.dataset.field].kept.splice(Number(btn.dataset.idx), 1);
      saveDraft();
      render();
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
      localStorage.removeItem(draftKey);
      location.reload();
      return;
    }
    if (act === 'save-draft') {
      btn.disabled = true;
      const saved = await persist({ requireComplete: false });
      if (saved) {
        toast('저장했습니다. [ 리포트]에서 다시 열 수 있습니다.', 'ok');
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
    const payload = { values: collectPayload(), draft: !requireComplete,
                      sheetLink: editingLink };
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
      submitBtn.textContent = '구글 시트로 업로드';
      return;
    }
    submitBtn.textContent = '구글 시트에 올리는 중…';
    try {
      const result = await api.uploadReportToSheet(saved.id);
      localStorage.removeItem(draftKey);
      if (result.queued) {
        // 오프라인 — 기기에 저장해 두었다가 연결되면 자동으로 올린다.
        toast('기기에 저장했습니다. 인터넷에 연결되면 자동으로 시트에 올립니다.', 'ok');
      } else {
        toast(`구글 시트 [${result.sheetName}] ${result.row}행에 기록했습니다.`
          + (result.media ? ` (첨부 ${result.media}개 공유 드라이브 저장)` : ''), 'ok');
        if (result.media && result.mediaShared === false) {
          toast('공유 드라이브에 닿지 못해 개인 드라이브에 저장했습니다. '
                + '설정에서 공유 드라이브 권한을 확인해 주세요.', 'err');
        }
        (result.mediaSkipped || []).forEach((s) =>
          toast(`첨부 제외: ${s.filename} (${s.reason})`, 'err'));
      }
      location.hash = `#/reports/${saved.id}`;
    } catch (err) {
      toast(err.message, 'err');
      toast('리포트는 저장되었습니다. [ 리포트]에서 다시 업로드할 수 있습니다.');
      location.hash = `#/reports/${saved.id}`;
    }
    submitBtn.disabled = false;
    submitBtn.textContent = '구글 시트로 업로드';
  }

  render();
}

// ------------------------------------------------------------ 이력 목록
const STATUS = {
  DRAFT: ['badge', '저장됨 (업로드 안 함)'],
  QUEUED: ['badge badge--warn', '업로드 대기 (연결되면 자동)'],
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
 * 시트 한 줄의 전체 내용 + 첨부를 모달로 보여 준다.
 * 이력 화면과 새 리포트의 [지난 방문] 이 같은 모달을 쓴다.
 */
export function showSheetEntry(entry) {
  const t = trackOf(entry.status);
  const body = `
    <div class="hist-detail">
      <div class="row" style="gap:8px">
        <span class="pill pill--${t.cls}">${h(entry.status)}</span>
        <span class="badge">${h(when(entry.createdAt || entry.date))}</span>
        ${entry.author ? `<span class="badge">${h(entry.author)}</span>` : ''}
      </div>
      <div class="hist-actions">
        <button class="btn btn--ghost btn--sm" data-act="edit" type="button">수정</button>
        <button class="btn btn--ghost btn--sm" data-act="reuse" type="button">이어서 작성</button>
        <button class="btn btn--danger btn--sm" data-act="delete" type="button">삭제</button>
      </div>
      ${entry.links.length ? `
        <div class="media-grid" id="entryMedia">
          ${entry.links.map((l, i) => `
            <button class="media-tile" data-act="view" data-idx="${i}" type="button"
                    style="padding:0;cursor:zoom-in">
              ${l.id
                ? `<img src="${h(thumbUrl(l.id, 300))}" alt="${h(l.label)}" loading="lazy"
                        data-drive="${h(l.id)}"
                        onerror="this.classList.add('is-broken')" />`
                : ''}
              <span class="media-tile__none">열어 보기</span>
              <span class="media-tile__name">${h(l.label)}</span>
            </button>`).join('')}
        </div>` : ''}
      ${entry.values.map((v) => `
        <div class="field">
          <label>${h(v.label)}</label>
          <div class="sub-card" style="white-space:pre-wrap">${h(v.value)}</div>
        </div>`).join('')}
    </div>`;

  const box = openSheet(entry.store || '리포트', body);

  // 어느 것이 영상인지 알아 와서 ▶ 를 붙인다. 모르면 사진으로 둔다.
  markVideos(entry.links, box);
  // 드라이브 썸네일이 막힌 파일은 바이트를 직접 받아 그린다.
  reviveBrokenThumbs(box);
  box.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'reuse') {
      // 새 방문 — 아는 값만 채우고 시트에는 새 줄로 들어간다.
      localStorage.removeItem(NEW_DRAFT_KEY);
      seedFromEntry(entry);
      closeModal();
      location.hash = '#/report/new';
      toast('지난 기록을 바탕으로 새 리포트를 엽니다.', 'ok');
    }
    if (btn.dataset.act === 'edit') {
      // 같은 방문을 고침 — 시트의 그 줄을 다시 쓴다.
      seedFromEntry(entry, { edit: true });
      closeModal();
      location.hash = '#/report/edit';
      toast('이 리포트를 고칩니다. 저장하면 같은 줄이 바뀝니다.', 'ok');
    }
    if (btn.dataset.act === 'delete') {
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
    if (btn.dataset.act === 'view') {
      openViewer(entry.links, Number(btn.dataset.idx));
    }
  });
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
    const btn = ev.target.closest('[data-act]');
    if (!btn) {
      if (ev.target === root || ev.target.classList.contains('viewer__stage')) close();
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
 * 위쪽 네 칸이 상태별 건수이자 필터다. 이번 달에 아직 안 끝난 건이 몇 개인지
 * 세지 않아도 보이는 것이 이 화면의 목적이다.
 */
export async function reportListView(view) {
  loading(view);

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
          <span class="page-head__meta">구글 시트의 팀 전체 기록 · <span id="histMeta"></span></span>
          <span class="page-head__spacer"></span>
          <select class="select" id="histMonth" aria-label="월 선택"></select>
        </div>
        <div id="histTop"></div>
        <div class="toolbar">
          <input class="input" id="histQ" type="search"
                 placeholder="식당명 · 날짜 (미트로, 08-22)" aria-label="이력 검색" />
          <button class="btn btn-secondary" data-act="refresh" type="button">시트에서 받기</button>
        </div>
        <div id="histBody" style="display:flex;flex-direction:column;gap:var(--space-3);flex:1;min-height:0"></div>

        <div class="page-head">
          <span class="page-head__meta">상태 변경은 시트에 즉시 기록 · 오프라인이면 대기 후 자동 전송</span>
          <span class="page-head__spacer"></span>
          <span class="tag tag-neutral" id="histSync"></span>
        </div>
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
          ? '오프라인입니다. 연결되면 시트에 반영합니다.'
          : `상태를 '${next}' 로 바꿨습니다.`, 'ok');
      } catch (err) {
        entry.status = before;             // 실패하면 되돌린다
        paint();
        toast(err.message, 'err');
      }
    }
  }

  renderShell();
  paint();
  // 받아 둔 것이 있으면 그것으로 **먼저 보여 준다.** 시트에 다시 물어보는 데는
  // 몇 초가 걸리는데, 그 동안 빈 화면을 보고 기다릴 이유가 없다.
  await load({ refresh: false });
  paintMonths();
  paint();

  // 그런 다음 조용히 최신본을 받아 온다. 화면 전환을 여기서 붙잡지 않는다.
  const openedAt = month;
  (async () => {
    try { await load({ refresh: true }); } catch { return; }
    // 그 사이 다른 화면으로 넘어갔거나 다른 달을 골랐으면 손대지 않는다.
    if (!view.querySelector('#histQ') || month !== openedAt) return;
    paintMonths();
    paint();
  })();
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
          <a class="back" href="#/reports">← 리포트 이력</a>
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
