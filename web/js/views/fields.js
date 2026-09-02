// 리포트 입력 항목 설정 — 여기서 만든 항목이 리포트 폼과 구글 시트 열 순서를 결정한다.
import { api } from '../api.js';
import {
  $, h, FIELD_TYPE_LABEL, closeModal, confirmDialog, loading, openSheet, toast,
} from '../ui.js';

export async function fieldsView(view) {
  loading(view);
  let fields = (await api.listFields()).items;

  /** 항목 한 줄. 디자인의 `.row` + `.order-btns` 구조. */
  function fieldRow(field, index) {
    const sub = [
      FIELD_TYPE_LABEL[field.fieldType] || field.fieldType,
      `시트 ${index + 3}번째 열`,
      field.fieldType === 'DROPDOWN' && field.options ? field.options : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="row">
        <span class="row__code tnum">${index + 1}</span>
        <span class="row__main">
          <span class="row__title">
            ${h(field.fieldLabel)}${field.isRequired ? '<span class="req">*</span>' : ''}
          </span>
          <span class="row__meta">${h(sub)}</span>
        </span>
        <span class="order-btns">
          <button class="btn btn-secondary" data-act="up" data-idx="${index}" type="button"
                  ${index === 0 ? 'disabled' : ''} aria-label="${h(field.fieldLabel)} 위로">↑</button>
          <button class="btn btn-secondary" data-act="down" data-idx="${index}" type="button"
                  ${index === fields.length - 1 ? 'disabled' : ''} aria-label="${h(field.fieldLabel)} 아래로">↓</button>
          <button class="btn btn-secondary" data-act="edit" data-id="${field.id}" type="button">수정</button>
          <button class="btn btn-secondary" data-act="del" data-id="${field.id}" type="button">삭제</button>
        </span>
      </div>`;
  }

  function render() {
    view.innerHTML = `
      <div id="pageRoot">
        <div class="page-head">
          <div>
            <a class="back" href="#/settings">← 설정</a>
            <h1 class="page-head__title">리포트 항목 설정</h1>
          </div>
          <span class="page-head__meta">
            항목 <span class="tnum">${fields.length}</span>개 ·
            필수 <span class="tnum">${fields.filter((f) => f.isRequired).length}</span>개 ·
            구글 시트의 열 순서도 이 순서를 따릅니다
          </span>
          <span class="page-head__spacer"></span>
          <button class="btn btn-primary" data-act="add" type="button">＋ 항목 추가</button>
        </div>

        <div class="rows">
          ${fields.length ? fields.map(fieldRow).join('')
            : '<div class="empty">입력 항목이 없습니다. [＋ 항목 추가]로 리포트 폼을 구성하세요.</div>'}
        </div>

        <div class="panel" style="margin-top:16px">
          <h2 class="panel__title">미리보기</h2>
          ${fields.length ? fields.map(previewHtml).join('')
            : '<p class="muted">항목을 추가하면 실제 입력 폼 형태로 미리 보입니다.</p>'}
        </div>

        <p class="muted" style="font-size:.9rem;line-height:1.6">
          ※ 항목을 바꾸면 <strong>내 화면에만</strong> 반영됩니다.
          상단 <strong>[⬆️ 업데이트]</strong> 를 눌러야 모든 사용자에게 적용됩니다.
        </p>
      </div>`;

    $('#pageRoot').addEventListener('click', onClick);
  }

  function previewHtml(field) {
    const label = `<label>${h(field.fieldLabel)}${field.isRequired ? '<span class="req">*</span>' : ''}</label>`;
    if (field.fieldType === 'TEXTAREA') {
      return `<div class="field">${label}<textarea class="textarea" disabled placeholder="여러 줄 입력"></textarea></div>`;
    }
    if (field.fieldType === 'DROPDOWN') {
      const opts = (field.options || '').split(',').map((o) => o.trim()).filter(Boolean);
      return `<div class="field">${label}<select class="select" disabled>${opts.map((o) => `<option>${h(o)}</option>`).join('')}</select></div>`;
    }
    if (field.fieldType === 'MEDIA') {
      return `<div class="field">${label}<div class="upload-zone">사진 · 영상 촬영/선택</div></div>`;
    }
    const type = field.fieldType === 'NUMBER' ? 'number' : 'text';
    return `<div class="field">${label}<input class="input" type="${type}" disabled placeholder="${field.fieldType === 'NUMBER' ? '숫자 입력' : '한 줄 입력'}" /></div>`;
  }

  async function reload() {
    fields = (await api.listFields()).items;
    render();
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'add') { openEditor(null); return; }
    if (act === 'edit') { openEditor(fields.find((f) => f.id === btn.dataset.id)); return; }

    if (act === 'up' || act === 'down') {
      const idx = Number(btn.dataset.idx);
      const swap = act === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= fields.length) return;
      [fields[idx], fields[swap]] = [fields[swap], fields[idx]];
      render();
      try {
        await api.reorderFields(fields.map((f) => f.id));
      } catch (err) { toast(err.message, 'err'); await reload(); }
      return;
    }

    if (act === 'del') {
      const field = fields.find((f) => f.id === btn.dataset.id);
      const ok = await confirmDialog('입력 항목 삭제',
        `"${field.fieldLabel}" 항목을 삭제합니다.\n이미 저장된 리포트의 내용은 그대로 보존됩니다.`,
        '삭제', true);
      if (!ok) return;
      try {
        await api.deleteField(field.id);
        toast('삭제했습니다.', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'err'); }
    }
  }

  function openEditor(field) {
    const type = field ? field.fieldType : 'TEXT';
    const body = openSheet(field ? '입력 항목 수정' : '입력 항목 추가', `
      <form id="fieldForm" autocomplete="off">
        <div class="field">
          <label>항목명<span class="req">*</span></label>
          <input class="input" id="fLabel" value="${h(field ? field.fieldLabel : '')}"
                 placeholder="예) 모터 캘리브레이션 전압값" />
          <span class="hint">구글 시트 2행에 이 이름이 그대로 들어갑니다.</span>
        </div>
        <div class="grid-2">
          <div class="field">
            <label>항목 종류<span class="req">*</span></label>
            <select class="select" id="fType">
              ${Object.entries(FIELD_TYPE_LABEL).map(([value, label]) =>
                `<option value="${value}" ${type === value ? 'selected' : ''}>${h(label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="check"><input type="checkbox" id="fRequired" ${field && field.isRequired ? 'checked' : ''} /> 필수 입력 항목</label>
          </div>
        </div>
        <div class="field" id="optionsWrap" style="display:${type === 'DROPDOWN' ? 'block' : 'none'}">
          <label>드롭다운 선택지<span class="req">*</span></label>
          <input class="input" id="fOptions" value="${h(field ? field.options || '' : '')}"
                 placeholder="쉼표로 구분 · 예) 완료,재방문 필요,부품 대기" />
        </div>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-act="close">취소</button>
          <button class="btn btn--primary" type="submit">저장</button>
        </div>
      </form>`);

    const typeSelect = $('#fType', body);
    typeSelect.addEventListener('change', () => {
      $('#optionsWrap', body).style.display = typeSelect.value === 'DROPDOWN' ? 'block' : 'none';
    });
    $('#fLabel', body).focus();

    $('#fieldForm', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const payload = {
        fieldLabel: $('#fLabel', body).value.trim(),
        fieldType: typeSelect.value,
        options: $('#fOptions', body).value.trim(),
        isRequired: $('#fRequired', body).checked,
      };
      if (!payload.fieldLabel) { toast('항목명을 입력하세요.', 'err'); return; }
      if (payload.fieldType === 'DROPDOWN' && !payload.options) {
        toast('드롭다운 선택지를 입력하세요.', 'err'); return;
      }
      try {
        if (field) await api.updateField(field.id, payload);
        else await api.createField(payload);
        closeModal();
        toast('저장했습니다.', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  render();
}
