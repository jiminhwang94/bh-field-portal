// 설정 → 작업 목록 — 구분 › 대분류 › 세부 작업을 정리하는 화면. 주소 #/work
//
// 현장에서는 고르기만 한다(없으면 '새 항목' 으로 적는다). 여기서는 정리한다:
//  - 합치기 후보 — 비슷한 이름끼리 (팔 교체 ↔ 로더 교체). 합치면 앞의 것은 별칭으로 남아
//    예전 리포트도 통계 · 검색에서 하나로 센다 (시트에 적힌 글자는 그대로)
//  - 항목마다 이름 바꾸기 · 별칭 · 가이드 잇기 · 옮기기 · 합치기 · 확인(새 항목 표시 끄기) · 삭제
//  - 대분류 추가 · 이름 바꾸기 · 삭제(항목이 없을 때)
//  - 지난 리포트에서 가져오기 — '작업' · 옛 '오류 코드' 칸에 적힌 분류 글자를 '미분류' 로
import { api } from '../api.js';
import { $, closeModal, confirmDialog, h, loading, openSheet, promptDialog, toast } from '../ui.js';
import { findWork, isCodeShaped, loadEntries, matchWork, valueOf, workPath, workUsage } from '../insights.js';

const KINDS = ['로봇 이슈', '로봇 외 이슈'];
const squash = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');

/** 글자 두 개가 얼마나 다른가 (고치기 · 넣기 · 빼기 횟수) */
function distance(a, b) {
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/** 합치기 후보 — 같은 구분 안에서 이름이 겹치거나 한두 글자만 다른 짝 */
function mergeCandidates(list, usage) {
  const out = [];
  const items = list.items;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]; const b = items[j];
      if (a.kind !== b.kind) continue;
      const x = squash(a.name); const y = squash(b.name);
      const close = x.includes(y) || y.includes(x)
        || (Math.min(x.length, y.length) >= 3 && distance(x, y) <= 1)
        || (a.cat === b.cat && x.length >= 3 && y.length >= 3 && x.slice(-2) === y.slice(-2) && distance(x, y) <= 2);
      if (!close) continue;
      // 새 항목 → 기존, 덜 쓴 것 → 많이 쓴 것 쪽으로
      const ua = usage.get(a.id) || 0; const ub = usage.get(b.id) || 0;
      const into = (a.isNew && !b.isNew) || (a.isNew === b.isNew && ua < ub) ? b : a;
      out.push({ from: into === a ? b : a, into });
    }
  }
  return out.slice(0, 12);
}

export async function workView(view) {
  loading(view);
  let list = await api.workList();
  if (!list.cats.length) list = await api.ensureDefaultWork();
  const guides = (await api.listGuides()).items;
  let usage = (await workUsage(list, 12).catch(() => ({ all: new Map() }))).all;
  let query = '';
  let onlyNew = false;

  const guideName = (id) => {
    const g = guides.find((x) => x.id === id);
    return g ? `${g.robotModel ? `${g.robotModel} · ` : ''}${g.codeOrTitle}` : '(지운 가이드)';
  };

  view.innerHTML = `
    <div id="pageRoot" class="page-stack">
      <div class="page-head">
        <h1 class="page-head__title">작업 목록</h1>
        <span class="page-head__meta" id="wkMeta"></span>
        <span class="page-head__spacer"></span>
        <button class="btn btn-secondary" data-act="import" type="button">지난 리포트에서 가져오기</button>
      </div>
      <div class="hist-filter">
        <input class="input" id="wkFind" type="search" placeholder="찾기 — 이름 · 별칭 · 초성" aria-label="작업 찾기" />
        <button class="btn btn-secondary" data-act="only-new" type="button" aria-pressed="false">새 항목만</button>
      </div>
      <div id="wkBody"></div>
    </div>`;

  function paint() {
    const news = list.items.filter((i) => i.isNew).length;
    $('#wkMeta').textContent = `세부 작업 ${list.items.length}개${news ? ` · 새 항목 ${news}개` : ''}`;
    const cands = mergeCandidates(list, usage);
    const show = (it) => (!onlyNew || it.isNew) && matchWork(query, it);
    $('#wkBody').innerHTML = `
      ${cands.length && !query ? `
        <section class="panel panel--check">
          <h2 class="panel__title">합치기 후보 <span class="muted">비슷한 이름 — 합치면 앞의 것은 별칭으로 남습니다</span></h2>
          ${cands.map((c) => `
            <div class="wk-cand">
              <span><b>${h(c.from.name)}</b>${c.from.isNew ? ' <em class="wk-new-badge">새 항목</em>' : ''}
                <span class="muted">→</span> <b>${h(c.into.name)}</b> <span class="muted">${h(c.into.cat)}</span></span>
              <button class="btn btn-dark btn--sm" data-act="merge-pair" data-from="${h(c.from.id)}" data-into="${h(c.into.id)}" type="button">합치기</button>
            </div>`).join('')}
        </section>` : ''}
      ${KINDS.map((k) => `
        <section class="panel wk-tree">
          <div class="row row--between">
            <h2 class="panel__title" style="margin:0">${h(k)}</h2>
            <button class="btn btn-secondary btn--sm" data-act="cat-add" data-kind="${h(k)}" type="button">＋ 대분류</button>
          </div>
          ${list.cats.filter((c) => c.kind === k).map((c) => {
            const items = list.items.filter((it) => it.kind === k && it.cat === c.name && show(it));
            const all = list.items.filter((it) => it.kind === k && it.cat === c.name).length;
            if ((query || onlyNew) && !items.length) return '';
            return `
              <div class="wk-catrow">
                <b>${h(c.name)}</b> <span class="muted tnum">${all}개</span>
                <span class="page-head__spacer"></span>
                <button class="btn btn--ghost btn--sm" data-act="item-add" data-kind="${h(k)}" data-cat="${h(c.name)}" type="button">＋ 항목</button>
                <button class="btn btn--ghost btn--sm" data-act="cat-rename" data-kind="${h(k)}" data-cat="${h(c.name)}" type="button">이름</button>
                ${all ? '' : `<button class="btn btn--ghost btn--sm" data-act="cat-delete" data-kind="${h(k)}" data-cat="${h(c.name)}" type="button">삭제</button>`}
              </div>
              ${items.map((it) => `
                <button class="wk-row" data-act="item-menu" data-id="${h(it.id)}" type="button">
                  <span class="wk-row__name">${h(it.name)}${it.isNew ? ' <em class="wk-new-badge">새 항목</em>' : ''}</span>
                  <span class="wk-row__sub">${[
                    it.aliases.length ? `별칭 ${it.aliases.join(', ')}` : '',
                    it.guides.length ? `가이드 ${it.guides.map(guideName).join(', ')}` : '',
                  ].filter(Boolean).map(h).join(' · ')}</span>
                  <span class="wk-row__n tnum">${usage.get(it.id) || 0}회</span>
                </button>`).join('')}`;
          }).join('')}
        </section>`).join('')}`;
  }

  async function apply(ops, msg) {
    list = await api.workOps(ops);
    if (msg) toast(msg, 'ok');
    paint();
  }
  const byId = (id) => list.items.find((x) => x.id === id);

  /** 항목 하나 — 고칠 거리를 창으로 */
  function itemMenu(it) {
    openSheet(it.name, `<div id="wkMenu" class="wk-menu"></div>`);
    const body = $('#wkMenu');
    const home = () => {
      body.innerHTML = `
        <p class="muted">${h(workPath(it))}</p>
        <div class="wk-menu__btns">
          <button class="btn btn-secondary" data-m="rename" type="button">이름 바꾸기</button>
          <button class="btn btn-secondary" data-m="aliases" type="button">별칭 고치기</button>
          <button class="btn btn-secondary" data-m="guides" type="button">가이드 잇기 (${it.guides.length})</button>
          <button class="btn btn-secondary" data-m="move" type="button">다른 대분류로 옮기기</button>
          <button class="btn btn-secondary" data-m="merge" type="button">다른 항목에 합치기</button>
          ${it.isNew ? '<button class="btn btn-secondary" data-m="ok" type="button">확인 — 새 항목 표시 끄기</button>' : ''}
          <button class="btn btn--danger" data-m="delete" type="button">삭제</button>
        </div>`;
    };
    home();
    body.addEventListener('click', async (ev) => {
      const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-m]'));
      if (!b) return;
      const m = b.dataset.m;
      const save = async (patch, msg) => {
        it = { ...it, ...patch };
        closeModal();
        await apply([{ op: 'item-upsert', item: it }], msg);
      };
      if (m === 'rename') {
        closeModal();
        const name = await promptDialog('이름 바꾸기', { label: '세부 작업', value: it.name });
        if (name && name.trim() && name.trim() !== it.name) {
          // 옛 이름은 별칭으로 남긴다 — 예전 리포트가 계속 이 항목으로 셈된다
          await apply([{ op: 'item-upsert', item: { ...it, name: name.trim(), aliases: [...it.aliases, it.name] } }],
            `'${name.trim()}' 으로 바꿨습니다. 옛 이름은 별칭으로 남깁니다.`);
        }
      }
      if (m === 'aliases') {
        closeModal();
        const text = await promptDialog('별칭 고치기', { label: '쉼표로 나눠 적기', value: it.aliases.join(', '),
                                                     placeholder: '팔 교체, 암 교체' });
        if (text !== null) {
          await apply([{ op: 'item-upsert', item: { ...it, aliases: text.split(',').map((x) => x.trim()).filter(Boolean) } }],
            '별칭을 고쳤습니다.');
        }
      }
      if (m === 'ok') await save({ isNew: false }, '확인했습니다.');
      if (m === 'delete') {
        closeModal();
        if (await confirmDialog('삭제', `'${it.name}' 을(를) 목록에서 지웁니다. 이미 쓴 리포트의 글자는 그대로 남습니다.`, '삭제', true)) {
          await apply([{ op: 'item-delete', id: it.id }], '지웠습니다.');
        }
      }
      if (m === 'guides') {
        const errs = guides;
        body.innerHTML = `
          <p class="muted">리포트에서 이 작업을 고르면, 그 로봇의 가이드로 바로 갑니다.</p>
          <div class="wk-pick">
            ${errs.map((g) => `<label class="ps-check"><input type="checkbox" value="${h(g.id)}" ${it.guides.includes(g.id) ? 'checked' : ''} />
              ${h(g.robotModel || '로봇 미지정')} · ${h(g.codeOrTitle)}</label>`).join('') || '<p class="muted">가이드가 없습니다.</p>'}
          </div>
          <button class="btn btn-primary btn--block" data-m="guides-save" type="button">저장</button>`;
      }
      if (m === 'guides-save') {
        const ids = [...body.querySelectorAll('input[type=checkbox]')]
          .filter((x) => /** @type {HTMLInputElement} */ (x).checked).map((x) => /** @type {HTMLInputElement} */ (x).value);
        await save({ guides: ids }, `가이드 ${ids.length}개를 이었습니다.`);
      }
      if (m === 'move') {
        body.innerHTML = KINDS.map((k) => `<p class="wk-kind">${h(k)}</p>
          ${list.cats.filter((c) => c.kind === k).map((c) => `<button class="wk-cat${k === it.kind && c.name === it.cat ? ' is-on' : ''}"
            data-m="move-to" data-kind="${h(k)}" data-cat="${h(c.name)}" type="button">${h(c.name)}</button>`).join('')}`).join('');
      }
      if (m === 'move-to') await save({ kind: b.dataset.kind, cat: b.dataset.cat }, `'${b.dataset.cat}' 로 옮겼습니다.`);
      if (m === 'merge') {
        const others = list.items.filter((x) => x.id !== it.id && x.kind === it.kind);
        body.innerHTML = `<p class="muted">'${h(it.name)}' 을(를) 어느 항목에 합칠까요? 합치면 별칭으로 남습니다.</p>
          <div class="wk-pick">${others.map((x) => `<button class="wk-item" data-m="merge-into" data-id="${h(x.id)}" type="button">
            <span class="wk-item__name">${h(x.name)}</span><span class="wk-item__sub">${h(x.cat)}</span></button>`).join('')}</div>`;
      }
      if (m === 'merge-into') {
        closeModal();
        list = await api.mergeWorkItems(it.id, b.dataset.id);
        toast(`'${it.name}' 을(를) 합쳤습니다.`, 'ok');
        paint();
      }
    });
  }

  $('#pageRoot').addEventListener('click', async (ev) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-act]'));
    if (!btn) return;
    const act = btn.dataset.act;
    const kind = btn.dataset.kind;
    const cat = btn.dataset.cat;
    if (act === 'item-menu') { const it = byId(btn.dataset.id); if (it) itemMenu(it); }
    if (act === 'merge-pair') {
      const from = byId(btn.dataset.from);
      list = await api.mergeWorkItems(btn.dataset.from, btn.dataset.into);
      toast(`'${from ? from.name : ''}' 을(를) 합쳤습니다.`, 'ok');
      paint();
    }
    if (act === 'only-new') {
      onlyNew = !onlyNew;
      btn.setAttribute('aria-pressed', String(onlyNew));
      btn.classList.toggle('btn-dark', onlyNew);
      paint();
    }
    if (act === 'cat-add') {
      const name = await promptDialog(`${kind} — 대분류 추가`, { label: '대분류', placeholder: '예) 청소 · 세척' });
      if (name && name.trim()) await apply([{ op: 'cat-add', kind, name: name.trim() }], '대분류를 만들었습니다.');
    }
    if (act === 'cat-rename') {
      const name = await promptDialog('대분류 이름 바꾸기', { label: '대분류', value: cat });
      if (name && name.trim() && name.trim() !== cat) {
        await apply([{ op: 'cat-rename', kind, from: cat, to: name.trim() }], '이름을 바꿨습니다.');
      }
    }
    if (act === 'cat-delete') {
      if (await confirmDialog('대분류 삭제', `'${cat}' 을(를) 지웁니다.`, '삭제', true)) {
        await apply([{ op: 'cat-delete', kind, name: cat }], '지웠습니다.');
      }
    }
    if (act === 'item-add') {
      const name = await promptDialog(`${cat} — 항목 추가`, { label: '세부 작업', placeholder: '예) 로더 교체' });
      if (name && name.trim()) {
        await api.addWorkItem(kind, cat, name.trim()).then(async () => {
          // 여기서 만든 것은 정리된 것 — 새 항목 표시를 끈다
          const made = (await api.workList()).items.find((x) => x.kind === kind && x.cat === cat && x.name === name.trim());
          if (made) await apply([{ op: 'item-upsert', item: { ...made, isNew: false } }], '추가했습니다.');
        });
      }
    }
    if (act === 'import') {
      btn.setAttribute('disabled', '');
      try {
        const { entries } = await loadEntries(12);
        const names = new Set();
        for (const e of entries) {
          const text = valueOf(e, '작업') || (isCodeShaped(e.code) ? '' : e.code);
          if (text && !findWork(text, list)) names.add(text.split('›').pop().trim());
        }
        if (!names.size) { toast('새로 가져올 것이 없습니다. (지난 리포트의 작업이 모두 목록에 있습니다)', 'ok'); return; }
        /** @type {any[]} */
        const ops = [{ op: 'cat-add', kind: KINDS[0], name: '미분류' }];
        const { newId } = await import('../local/store.js');
        for (const name of names) {
          ops.push({ op: 'item-upsert', item: { id: newId(), kind: KINDS[0], cat: '미분류', name, aliases: [], guides: [], isNew: true } });
        }
        await apply(ops, `지난 리포트에서 ${names.size}개를 '미분류' 에 가져왔습니다. 옮기고 합쳐 정리하세요.`);
        usage = (await workUsage(list, 12).catch(() => ({ all: new Map() }))).all;
        paint();
      } finally {
        btn.removeAttribute('disabled');
      }
    }
  });
  const find = /** @type {HTMLInputElement} */ ($('#wkFind'));
  const onType = () => { query = find.value.trim(); paint(); };
  find.addEventListener('input', onType);
  find.addEventListener('compositionend', onType);
  paint();
}
