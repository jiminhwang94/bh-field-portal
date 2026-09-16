// 리포트 입력 항목 설정 — 여기서 만든 항목이 리포트 폼의 칸이 된다.
//
// 항목을 **더하고 지우는 것은 팀 공통**이다 (시트로 오간다).
// 항목 **순서는 이 기기에만** 남는다 — 사람마다 손에 익은 순서가 다르고,
// 예전에는 남이 옮기면 내가 맞춰 둔 양식이 날아갔다. store.reorderFields 참고.
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
      <div class="row" data-id="${field.id}">
        <button class="drag-handle" type="button" data-drag="1"
                aria-label="${h(field.fieldLabel)} 순서 옮기기 (잡고 끌기)">≡</button>
        <span class="row__code tnum">${index + 1}</span>
        <span class="row__main">
          <span class="row__title">
            ${h(field.fieldLabel)}${field.isRequired ? '<span class="req">*</span>' : ''}
          </span>
          <span class="row__meta">${h(sub)}</span>
        </span>
        <span class="order-btns">
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
            <h1 class="page-head__title">리포트 항목 설정</h1>
          </div>
          <span class="page-head__meta">
            항목 <span class="tnum">${fields.length}</span>개 ·
            필수 <span class="tnum">${fields.filter((f) => f.isRequired).length}</span>개
          </span>
          <span class="page-head__spacer"></span>
          <button class="btn btn-primary" data-act="add" type="button">＋ 항목 추가</button>
        </div>

        <div class="rows" id="fieldRows">
          ${fields.length ? fields.map(fieldRow).join('')
            : '<div class="empty">입력 항목이 없습니다. [＋ 항목 추가]로 리포트 폼을 구성하세요.</div>'}
        </div>

        <div class="panel" style="margin-top:16px">
          <h2 class="panel__title">미리보기</h2>
          ${fields.length ? fields.map(previewHtml).join('')
            : '<p class="muted">항목을 추가하면 실제 입력 폼 형태로 미리 보입니다.</p>'}
        </div>

      </div>`;

    $('#pageRoot').addEventListener('click', onClick);
    bindDrag($('#fieldRows'));
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

  /**
   * 손잡이(≡)를 잡고 끌어 순서를 바꾼다.
   *
   * 예전에는 ↑↓ 버튼뿐이어서 새 항목(맨 아래에 생긴다)을 위로 올리려면 항목 수만큼
   * 눌러야 했다. 손잡이만 잡히게 한 이유 — 줄 어디서나 끌리면 목록을 넘기려던
   * 손가락이 항목을 옮겨 버린다. 손잡이 밖은 그냥 스크롤이다.
   *
   * 끄는 동안은 화면(DOM)만 옮기고, 놓았을 때 한 번 저장한다.
   */
  function bindDrag(list) {
    if (!list) return;
    let dragging = null;     // 끌리는 줄
    let pointerId = null;

    const rowsOf = () => Array.from(list.querySelectorAll('.row[data-id]'));
    const clearMarks = () => rowsOf().forEach((r) => r.classList.remove('is-drop-before', 'is-drop-after'));

    list.addEventListener('pointerdown', (ev) => {
      const handle = ev.target.closest('[data-drag]');
      if (!handle) return;
      dragging = handle.closest('.row');
      pointerId = ev.pointerId;
      dragging.classList.add('is-dragging');
      handle.setPointerCapture(pointerId);
      ev.preventDefault();
    });

    list.addEventListener('pointermove', (ev) => {
      if (!dragging || ev.pointerId !== pointerId) return;
      const others = rowsOf().filter((r) => r !== dragging);
      clearMarks();
      // 손가락 위치보다 아래에 있는 첫 줄 앞에 넣는다. 없으면 맨 뒤.
      const next = others.find((r) => {
        const box = r.getBoundingClientRect();
        return ev.clientY < box.top + box.height / 2;
      });
      if (next) { next.classList.add('is-drop-before'); list.insertBefore(dragging, next); }
      else { const last = others[others.length - 1]; if (last) { last.classList.add('is-drop-after'); list.appendChild(dragging); } }
    });

    const finish = async (ev) => {
      if (!dragging || ev.pointerId !== pointerId) return;
      dragging.classList.remove('is-dragging');
      clearMarks();
      const order = rowsOf().map((r) => r.dataset.id);
      dragging = null; pointerId = null;
      const before = fields.map((f) => f.id).join('|');
      if (order.join('|') === before) return;          // 제자리에 놓았다
      fields = order.map((id) => fields.find((f) => f.id === id)).filter(Boolean);
      render();
      try {
        await api.reorderFields(order);
        toast('순서를 바꿨습니다 — 이 기기에만 적용됩니다.', 'ok');
      } catch (err) { toast(err.message, 'err'); await reload(); }
    };
    list.addEventListener('pointerup', finish);
    list.addEventListener('pointercancel', finish);
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'add') { openEditor(null); return; }
    if (act === 'edit') { openEditor(fields.find((f) => f.id === btn.dataset.id)); return; }


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
