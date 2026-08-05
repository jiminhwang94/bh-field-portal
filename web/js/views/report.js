// 현장 리포트 작성 (동적 폼) · 이력 · 상세 / 구글 시트 업로드
import { api } from '../api.js';
import {
  $, h, confirmDialog, copyText, loading, toast,
} from '../ui.js';
import { reportToText, shareReport } from '../share.js';

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
          <span class="hint">촬영한 사진은 구글 시트의 해당 칸에 <strong>이미지로 바로 삽입</strong>됩니다. (영상은 링크로 기록)</span>
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
      toast(`구글 시트 [${result.sheetName}] ${result.row}행에 기록했습니다.`
        + (result.images ? ` (사진 ${result.images}장 삽입)` : ''), 'ok');
      (result.imagesSkipped || []).forEach((s) =>
        toast(`사진 제외: ${s.filename} (${s.reason})`, 'err'));
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
  UPLOADED: ['badge badge--ok', '구글 시트 업로드 완료'],
  FAILED: ['badge badge--danger', '업로드 실패'],
};

export async function reportListView(view) {
  loading(view);
  const { items } = await api.listReports();
  view.innerHTML = `
    <div class="page-head">
      <h1>🗂 현장 리포트 이력</h1>
      <p>총 ${items.length}건 · 업로드 실패한 리포트는 상세에서 다시 업로드할 수 있습니다.</p>
      <p class="muted" style="font-size:.9rem">리포트는 내 기기에만 저장되며, 구글 시트로 업로드해 공유합니다.</p>
    </div>
    <div class="list">
      ${items.length ? items.map((r) => {
        const [cls, label] = STATUS[r.status] || STATUS.DRAFT;
        return `
          <a class="item" href="#/reports/${r.id}">
            <div class="item__body">
              <div class="item__title">${h(r.title)}</div>
              <div class="item__sub">${h(r.createdAt)}${r.errorMessage ? ` · ${h(r.errorMessage.slice(0, 60))}` : ''}</div>
            </div>
            <span class="${cls}">${label}</span>
            <span class="item__chevron">›</span>
          </a>`;
      }).join('') : '<div class="empty">작성된 리포트가 없습니다.</div>'}
    </div>`;
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
        toast(`구글 시트 [${result.sheetName}] ${result.row}행에 기록했습니다.`
          + (result.images ? ` (사진 ${result.images}장 삽입)` : ''), 'ok');
        (result.imagesSkipped || []).forEach((s) =>
          toast(`사진 제외: ${s.filename} (${s.reason})`, 'err'));
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
