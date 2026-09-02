// 가이드 목록 / 상세 / 편집 (오류코드 · HW SOP · SW 명령어)
import { api } from '../api.js';
import {
  $, $$, h, CATEGORY, confirmDialog, copyText, loading, toast, when,
} from '../ui.js';

const DONE_KEY = (id) => `bh_steps_done_${id}`;

// ---------------------------------------------------------------- 목록
export async function guideListView(view, categoryType) {
  const meta = CATEGORY[categoryType];
  loading(view);
  // 가이드는 전부 기기에 있으므로 오프라인에서도 그대로 열린다.
  const items = (await api.listGuides(categoryType)).items;

  view.innerHTML = `
    <div class="page-head">
      <div>
        <a class="back" href="#/">← 홈</a>
        <h1 class="page-head__title">${h(meta.label)}</h1>
      </div>
      <span class="page-head__meta">${h(meta.desc)} · 총 <span class="tnum">${items.length}</span>건</span>
      <span class="page-head__spacer"></span>
      <a class="btn btn-primary" href="#/guides/new/${categoryType}">＋ 가이드 작성</a>
    </div>
    <div class="toolbar">
      <input class="input" id="filterInput" type="search"
             placeholder="코드 · 증상 검색" autocomplete="off" />
    </div>
    <div class="rows" id="guideList">
      ${items.length ? items.map((g) => row(g, categoryType)).join('')
        : '<div class="empty">등록된 가이드가 없습니다. [＋ 새 가이드]로 추가하세요.</div>'}
    </div>`;

  $('#filterInput').addEventListener('input', (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    const filtered = items.filter((g) =>
      `${g.codeOrTitle} ${g.summary} ${g.requiredTools}`.toLowerCase().includes(q));
    $('#guideList').innerHTML = filtered.length
      ? filtered.map((g) => row(g, categoryType)).join('')
      : '<div class="empty">필터 결과가 없습니다.</div>';
  });
}

/**
 * 가이드 한 줄. 디자인의 `.row` 구조 — 코드 · (제목+요약) · 열기.
 * 배지를 여러 개 늘어놓는 대신 요약 줄에 숫자를 모아 적는다.
 */
function row(guide, categoryType) {
  const tools = (guide.requiredTools || '').split(',').map((t) => t.trim()).filter(Boolean);
  const bits = [
    `${guide.stepCount || 0}단계`,
    tools.length ? `공구 ${tools.length}` : '',
    (guide.commands && guide.commands.length) ? `명령어 ${guide.commands.length}` : '',
    guide.updatedAt ? when(guide.updatedAt, { time: false }) : '',
  ].filter(Boolean);
  // 오류 코드는 코드를 왼쪽 칸에, 나머지는 종류 약칭을 둔다.
  const code = categoryType === 'ERROR_CODE'
    ? guide.codeOrTitle.split(' ')[0]
    : (SHORT[categoryType] || '');
  const title = categoryType === 'ERROR_CODE'
    ? guide.codeOrTitle.split(' ').slice(1).join(' ') || guide.codeOrTitle
    : guide.codeOrTitle;
  return `
    <a class="row" href="#/guides/${guide.id}">
      <span class="row__code tnum">${h(code)}</span>
      <span class="row__main">
        <span class="row__title">${h(title)}</span>
        <span class="row__meta">${h(guide.summary || '요약 없음')}</span>
        <span class="row__meta">${h(bits.join(' · '))}</span>
      </span>
      <span class="row__meta">열기 →</span>
    </a>`;
}

const SHORT = { ERROR_CODE: '', HARDWARE_SOP: 'SOP', SOFTWARE_CMD: 'CMD' };

// ---------------------------------------------------------------- 상세
export async function guideDetailView(view, guideId) {
  loading(view);
  const guide = await api.getGuide(guideId);
  if (!guide) throw new Error('가이드를 찾을 수 없습니다.');
  const meta = CATEGORY[guide.categoryType] || { emoji: '📄', label: '' };
  const tools = (guide.requiredTools || '').split(',').map((t) => t.trim()).filter(Boolean);
  let done = new Set();
  try {
    done = new Set(JSON.parse(localStorage.getItem(DONE_KEY(guideId)) || '[]'));
  } catch { /* 무시 */ }

  view.innerHTML = `
    <div id="pageRoot">
    <div class="page-head">
      <div>
        <a class="back" href="#/guides/${guide.categoryType}">← ${h(meta.label)}</a>
        <h1 class="page-head__title">${h(guide.codeOrTitle)}</h1>
      </div>
      <span class="page-head__spacer"></span>
      <a class="btn btn-secondary" href="#/guides/edit/${guide.id}">수정</a>
      <button class="btn btn-secondary" data-act="delete" type="button">삭제</button>
      <a class="btn btn-primary" href="#/report/new">리포트 작성</a>
    </div>

    ${guide.summary ? `<span class="page-head__meta">${h(guide.summary)}</span>` : ''}

    <div class="page-head">
      <span class="page-head__meta">${h(when(guide.updatedAt))} 수정</span>
      <span class="page-head__spacer"></span>
      ${guide.steps.length ? '<button class="btn btn-secondary" data-act="reset-check" type="button">체크 초기화</button>' : ''}
    </div>

    ${tools.length ? `
      <div class="panel">
        <h2 class="panel__title">준비 공구 · 부품</h2>
        <div class="tag-list">${tools.map((t) => `<span class="badge">${h(t)}</span>`).join('')}</div>
      </div>` : ''}

    ${guide.commands.length ? `
      <div class="panel">
        <h2 class="panel__title">명령어 — 탭하면 복사</h2>
        ${guide.commands.map((c, i) => `
          <div class="cmd">
            ${c.label ? `<div class="cmd__label">${h(c.label)}</div>` : ''}
            <div class="cmd__row">
              <pre class="cmd__code" id="cmd-${i}">${h(c.cmd)}</pre>
              <button class="btn btn--primary" data-act="copy" data-target="cmd-${i}" type="button">복사</button>
            </div>
            ${c.desc ? `<p class="cmd__desc">${h(c.desc)}</p>` : ''}
          </div>`).join('')}
        <button class="btn btn--ghost btn--sm" data-act="copy-all" type="button">전체 명령어 복사</button>
      </div>` : ''}

    <div class="panel">
      <h2 class="panel__title">단계 — 탭하면 완료 체크 (기기에 저장)</h2>
      ${guide.steps.length ? `<div class="steps">${guide.steps.map((s, i) => stepHtml(s, i, done)).join('')}</div>`
        : '<div class="empty">등록된 단계가 없습니다. [수정]에서 단계를 추가하세요.</div>'}
    </div>
    </div>`;

  $('#pageRoot').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'copy' || act === 'copy-all') {
      const text = act === 'copy'
        ? $('#' + btn.dataset.target).textContent
        : guide.commands.map((c) => c.cmd).join('\n');
      const ok = await copyText(text);
      toast(ok ? '클립보드에 복사했습니다.' : '복사에 실패했습니다. 길게 눌러 직접 복사하세요.',
        ok ? 'ok' : 'err');
    }
    if (act === 'toggle-step') {
      const el = btn.closest('.step');
      const idx = el.dataset.idx;
      if (done.has(idx)) { done.delete(idx); } else { done.add(idx); }
      el.classList.toggle('is-done', done.has(idx));
      el.setAttribute('aria-pressed', String(done.has(idx)));
      localStorage.setItem(DONE_KEY(guideId), JSON.stringify([...done]));
    }
    if (act === 'reset-check') {
      done.clear();
      localStorage.removeItem(DONE_KEY(guideId));
      $$('.step').forEach((el) => {
        el.classList.remove('is-done');
        el.setAttribute('aria-pressed', 'false');
      });
      toast('체크를 초기화했습니다.');
    }
    if (act === 'delete') {
      const ok = await confirmDialog('가이드 삭제',
        `"${guide.codeOrTitle}" 가이드와 모든 단계를 삭제합니다. 되돌릴 수 없습니다.`,
        '삭제', true);
      if (!ok) return;
      await api.deleteGuide(guide.id);
      toast('삭제했습니다.', 'ok');
      location.hash = `#/guides/${guide.categoryType}`;
    }
  });
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
          <span class="step__meta">
            <span class="badge badge--metric">기준값 ${h(step.expectedMetric)}</span>
          </span>` : ''}
        ${step.imageUrl ? `<img class="step__img" src="${h(step.imageUrl)}" alt="단계 ${idx + 1} 참고 이미지" loading="lazy" />` : ''}
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
export async function guideEditView(view, guideId, categoryType) {
  let state;
  if (guideId) {
    loading(view);
    const guide = await api.getGuide(guideId);
    state = {
      id: guide.id,
      categoryType: guide.categoryType,
      codeOrTitle: guide.codeOrTitle,
      summary: guide.summary,
      requiredTools: guide.requiredTools,
      commands: guide.commands.length ? guide.commands : [],
      steps: guide.steps.map((s) => ({
        instruction: s.instruction,
        expectedMetric: s.expectedMetric || '',
        imageUrl: s.imageUrl || '',
      })),
    };
  } else {
    state = {
      id: null,
      categoryType: categoryType || 'ERROR_CODE',
      codeOrTitle: '',
      summary: '',
      requiredTools: '',
      commands: [],
      steps: [{ instruction: '', expectedMetric: '', imageUrl: '' }],
    };
  }

  function collect() {
    const form = $('#guideForm');
    if (!form) return;
    state.categoryType = $('#gCategory').value;
    state.codeOrTitle = $('#gTitle').value;
    state.summary = $('#gSummary').value;
    state.requiredTools = $('#gTools').value;
    state.commands = $$('[data-cmd-row]').map((rowEl) => ({
      label: $('[name=cmdLabel]', rowEl).value,
      cmd: $('[name=cmdText]', rowEl).value,
      desc: $('[name=cmdDesc]', rowEl).value,
    }));
    state.steps = $$('[data-step-row]').map((rowEl) => ({
      instruction: $('[name=stepText]', rowEl).value,
      expectedMetric: $('[name=stepMetric]', rowEl).value,
      imageUrl: $('[name=stepImage]', rowEl).value,
    }));
  }

  function render() {
    view.innerHTML = `
      <div class="page-head">
        <div>
          <a class="back" href="#/guides/${state.categoryType}">← 목록</a>
          <h1 class="page-head__title">${guideId ? '가이드 수정' : '새 가이드 작성'}</h1>
        </div>
        <span class="page-head__meta">저장 즉시 모든 기기에 공유됩니다</span>
      </div>
      <form id="guideForm" autocomplete="off">
        <div class="panel">
          <div class="grid-2">
            <div class="field">
              <label>카테고리<span class="req">*</span></label>
              <select class="select" id="gCategory">
                ${Object.entries(CATEGORY).map(([type, meta]) =>
                  `<option value="${type}" ${state.categoryType === type ? 'selected' : ''}>${meta.emoji} ${h(meta.label)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>오류 코드 / 제목<span class="req">*</span></label>
              <input class="input" id="gTitle" value="${h(state.codeOrTitle)}"
                     placeholder="예) E-101 로더 모터 과전류" />
            </div>
          </div>
          <div class="field">
            <label>요약</label>
            <input class="input" id="gSummary" value="${h(state.summary)}"
                   placeholder="한 줄로 증상/작업을 설명" />
          </div>
          <div class="field">
            <label>준비 공구 · 부품</label>
            <input class="input" id="gTools" value="${h(state.requiredTools)}"
                   placeholder="쉼표로 구분 · 예) 멀티미터, 육각 렌치 3mm" />
            <span class="hint">쉼표(,)로 구분하면 상세 화면에서 태그로 표시됩니다.</span>
          </div>
        </div>

        <div class="panel">
          <div class="row row--between" style="margin-bottom:12px">
            <h2 class="panel__title" style="margin:0">명령어 (${state.commands.length})</h2>
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
                <div class="field"><label>기준 수치 (정량 판정값)</label>
                  <input class="input mono" name="stepMetric" value="${h(s.expectedMetric)}" placeholder="예) DC 24V ±0.5V" /></div>
                <div class="field" style="margin-bottom:0">
                  <label>참고 사진</label>
                  <input type="hidden" name="stepImage" value="${h(s.imageUrl)}" />
                  ${s.imageUrl ? `<img class="step__img" src="${h(s.imageUrl)}" alt="참고 사진" style="max-height:200px" />` : ''}
                  <div class="row" style="margin-top:8px">
                    <button class="btn btn--ghost btn--sm" data-act="pick-image" data-idx="${i}" type="button">사진 첨부</button>
                    ${s.imageUrl ? `<button class="btn btn--danger btn--sm" data-act="clear-image" data-idx="${i}" type="button">사진 제거</button>` : ''}
                  </div>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn--ghost" data-act="cancel" type="button">취소</button>
          <button class="btn btn--primary" type="submit">저장</button>
        </div>
      </form>
      <input type="file" id="stepImageInput" accept="image/*" style="display:none" />`;

    // 리스너는 매 렌더마다 새로 생성되는 form 에만 연결해 중복 등록을 막는다.
    const form = $('#guideForm');
    form.addEventListener('submit', save);
    form.addEventListener('click', onClick);
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const idx = Number(btn.dataset.idx);

    if (act === 'add-cmd') { collect(); state.commands.push({ label: '', cmd: '', desc: '' }); render(); }
    if (act === 'del-cmd') { collect(); state.commands.splice(idx, 1); render(); }
    if (act === 'add-step') { collect(); state.steps.push({ instruction: '', expectedMetric: '', imageUrl: '' }); render(); }
    if (act === 'del-step') {
      collect();
      state.steps.splice(idx, 1);
      if (!state.steps.length) state.steps.push({ instruction: '', expectedMetric: '', imageUrl: '' });
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
    if (act === 'clear-image') { collect(); state.steps[idx].imageUrl = ''; render(); }
    if (act === 'pick-image') {
      const input = $('#stepImageInput');
      input.value = '';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        btn.disabled = true;
        btn.textContent = '업로드 중…';
        try {
          const media = await api.uploadMedia(file);
          collect();
          state.steps[idx].imageUrl = media.url;
          render();
          toast('사진을 첨부했습니다.', 'ok');
        } catch (err) {
          toast(err.message, 'err');
          btn.disabled = false;
          btn.textContent = '사진 첨부';
        }
      };
      input.click();
    }
    if (act === 'cancel') {
      const ok = await confirmDialog('편집 취소', '저장하지 않은 내용은 사라집니다.', '나가기', true);
      if (ok) history.length > 1 ? history.back() : (location.hash = '#/');
    }
  }

  async function save(ev) {
    ev.preventDefault();
    collect();
    if (!state.codeOrTitle.trim()) { toast('오류 코드 / 제목은 필수입니다.', 'err'); return; }
    const submitBtn = $('#guideForm button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중…';
    try {
      const payload = {
        categoryType: state.categoryType,
        codeOrTitle: state.codeOrTitle,
        summary: state.summary,
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
