// [이슈 유형 고르기] 창 (B안) — 왼쪽 구분 · 대분류, 오른쪽 세부 항목 · 검색 · 새로 적기.
//
// 리포트 작성 화면이 연다. 목록은 기기에 있다 (오프라인 OK).
// 여러 개 고를 수 있다 (v3.34) — 누를 때마다 고르고/빼고, [선택] 을 누르면
// onPick(['로봇 이슈 › 하드웨어 교체 › 로더 교체', …], 항목들) 을 부르고 창을 닫는다.
//
// [편집] 을 켜면 이 창 안에서 바로 만들고 · 고치고 · 지운다 (v3.32) — 대분류도 세부 항목도.
// 고친 것은 팀 전체 목록(시트 '이슈 유형 목록')에 올라간다. 정리(합치기 · 별칭 · 가이드 잇기)는
// 설정 → 이슈 유형 정리에서.
//
// 검색칸은 한 번 만들고 다시 만들지 않는다 — 다시 만들면 한글 조합이 끊긴다.
import { api } from './api.js';
import { $, closeModal, h, openSheet, toast } from './ui.js';
import { findWorks, matchWork, workPath, workUsage } from './insights.js';

const KINDS = ['로봇 이슈', '로봇 외 이슈'];
const squash = (t) => String(t || '').replace(/\s/g, '');

/**
 * @param {{ value?: string, robotModel?: string, onPick: (paths: string[], items: any[]) => void }} opts
 */
export async function openWorkPicker({ value = '', robotModel = '', onPick }) {
  let list = await api.workList();
  if (!list.cats.length) list = await api.ensureDefaultWork();
  const usage = await workUsage(list, 3).catch(() => ({ all: new Map(), byModel: new Map() }));
  const modelUse = usage.byModel.get(robotModel) || new Map();
  /** @type {string[]} */
  let chosen = findWorks(value, list).map((it) => it.id);      // 고른 차례대로
  const first = list.items.find((it) => it.id === chosen[0]);
  let kind = first ? first.kind : list.cats[0].kind;
  let cat = first ? first.cat : list.cats[0].name;
  let query = '';
  let editing = false;
  let editKey = '';          // 고치는 중인 것 — 'item:<id>' · 'cat:<구분>|<대분류>' · 'newcat:<구분>'
  let confirmKey = '';       // 지우기 확인 중인 것

  openSheet('이슈 유형 고르기', `
    <div class="wk">
      <nav class="wk-side" id="wkSide" aria-label="구분 · 대분류"></nav>
      <div class="wk-main">
        <div class="wk-tools">
          <input class="input" id="wkQ" type="search" autocomplete="off" enterkeyhint="search"
                 placeholder="검색 — 로더 · 팔 · ㄹㄷ" aria-label="이슈 유형 검색" />
          <button class="btn btn-secondary" id="wkEdit" data-act="wk-edit" type="button" aria-pressed="false">편집</button>
        </div>
        <div class="wk-list" id="wkList"></div>
        <div class="wk-new">
          <input class="input" id="wkNew" autocomplete="off" placeholder="목록에 없으면 새로 적기" aria-label="새 이슈 유형 이름" />
          <button class="btn btn-secondary" data-act="wk-add" type="button">추가</button>
        </div>
        <p class="hint" id="wkWhere"></p>
        <div class="wk-done">
          <div class="wk-chosen" id="wkChosen" aria-live="polite"></div>
          <button class="btn btn-primary" data-act="wk-done" type="button">선택</button>
        </div>
      </div>
    </div>`);

  const score = (it) => (modelUse.get(it.id) || 0) * 1000 + (usage.all.get(it.id) || 0);
  const inlineEdit = (key, val, label) => `
    <span class="wk-inline">
      <input class="input" data-edit-input="${h(key)}" value="${h(val)}" aria-label="${h(label)}" autocomplete="off" />
      <button class="btn btn-primary btn--sm" data-act="wk-save" data-key="${h(key)}" type="button">저장</button>
      <button class="btn btn--ghost btn--sm" data-act="wk-cancel" type="button">취소</button>
    </span>`;
  const confirmDel = (key, what) => `
    <span class="wk-inline wk-inline--del">
      <span>'${h(what)}' 삭제할까요?</span>
      <button class="btn btn--danger btn--sm" data-act="wk-del-yes" data-key="${h(key)}" type="button">삭제</button>
      <button class="btn btn--ghost btn--sm" data-act="wk-cancel" type="button">취소</button>
    </span>`;

  function paintSide() {
    $('#wkSide').innerHTML = KINDS.map((k) => `
      <p class="wk-kind">${h(k)}</p>
      ${list.cats.filter((c) => c.kind === k).map((c) => {
        const n = list.items.filter((it) => it.kind === k && it.cat === c.name).length;
        const on = !query && k === kind && c.name === cat;
        const key = `cat:${k}|${c.name}`;
        if (editing && editKey === key) return inlineEdit(key, c.name, '대분류 이름');
        if (editing && confirmKey === key) return confirmDel(key, c.name);
        return `<span class="wk-catwrap">
          <button class="wk-cat${on ? ' is-on' : ''}" data-act="wk-cat" data-kind="${h(k)}" data-cat="${h(c.name)}"
                  type="button" aria-pressed="${on}">${h(c.name)} <small class="tnum">${n}</small></button>
          ${editing ? `<button class="wk-ico" data-act="wk-ren" data-key="${h(key)}" type="button" aria-label="${h(c.name)} 이름 바꾸기">✎</button>
            <button class="wk-ico" data-act="wk-del" data-key="${h(key)}" type="button" aria-label="${h(c.name)} 삭제">🗑</button>` : ''}
        </span>`;
      }).join('')}
      ${editing ? (editKey === `newcat:${k}` ? inlineEdit(`newcat:${k}`, '', '새 대분류 이름')
        : `<button class="wk-addcat" data-act="wk-newcat" data-kind="${h(k)}" type="button">＋ 대분류</button>`) : ''}`).join('');
  }
  function paintList() {
    const items = query
      ? list.items.filter((it) => matchWork(query, it))
      : list.items.filter((it) => it.kind === kind && it.cat === cat);
    items.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, 'ko'));
    $('#wkList').innerHTML = items.length ? items.map((it) => {
      const key = `item:${it.id}`;
      if (editing && editKey === key) return `<div class="wk-item wk-item--edit">${inlineEdit(key, it.name, '세부 항목 이름')}</div>`;
      if (editing && confirmKey === key) return `<div class="wk-item wk-item--edit">${confirmDel(key, it.name)}</div>`;
      const n = usage.all.get(it.id) || 0;
      const on = chosen.includes(it.id);
      return `
        <div class="wk-itemwrap">
          <button class="wk-item${on ? ' is-on' : ''}" data-act="wk-pick" data-id="${h(it.id)}" type="button"
                  aria-pressed="${on}">
            <span class="wk-item__name">${h(it.name)}${it.isNew ? ' <em class="wk-new-badge">새 항목</em>' : ''}</span>
            <span class="wk-item__sub">${[query ? `${it.kind} › ${it.cat}` : '',
              it.aliases.length ? `별칭 ${it.aliases.join(', ')}` : ''].filter(Boolean).map(h).join(' · ')}</span>
            ${n ? `<span class="wk-item__n tnum">${n}회</span>` : ''}
          </button>
          ${editing ? `<button class="wk-ico" data-act="wk-ren" data-key="${h(key)}" type="button" aria-label="${h(it.name)} 이름 바꾸기">✎</button>
            <button class="wk-ico" data-act="wk-del" data-key="${h(key)}" type="button" aria-label="${h(it.name)} 삭제">🗑</button>` : ''}
        </div>`;
    }).join('') : `<p class="muted wk-empty">${query ? `'${h(query)}' 에 맞는 이슈 유형이 없습니다.` : '아직 항목이 없습니다.'}
      아래에 새로 적어 넣으세요.</p>`;
    $('#wkWhere').textContent = editing
      ? '편집 중 — ✎ 이름 바꾸기 · 🗑 삭제. 고친 것은 팀 전체 목록에 올라갑니다'
      : `여러 개 고를 수 있습니다 · 새로 적으면 '${kind} › ${cat}' 에 들어갑니다`;
  }
  function paintChosen() {
    chosen = chosen.filter((id) => list.items.some((it) => it.id === id));      // 지운 항목은 뺀다
    const items = chosen.map((id) => list.items.find((it) => it.id === id));
    $('#wkChosen').innerHTML = items.length
      ? `<span class="wk-chosen__n tnum">${items.length}개</span>${items.map((it) => `
          <span class="wk-chip">${h(it.name)}<button class="part-pill__x" data-act="wk-unpick" data-id="${h(it.id)}"
            type="button" aria-label="${h(it.name)} 빼기">✕</button></span>`).join('')}`
      : '<span class="muted">고른 것이 없습니다</span>';
  }
  const paint = () => { paintSide(); paintList(); paintChosen(); };
  paint();
  const focusEdit = () => {
    const inp = /** @type {HTMLInputElement | null} */ (document.querySelector('#modalRoot [data-edit-input]'));
    if (inp) { inp.focus(); inp.select(); }
  };

  async function save(key, val) {
    const name = String(val || '').trim();
    if (!name) { toast('이름을 적어 주세요.', 'err'); return; }
    if (key.startsWith('item:')) {
      const it = list.items.find((x) => x.id === key.slice(5));
      if (it && squash(it.name) !== squash(name)) {
        // 옛 이름은 별칭으로 남긴다 — 예전 리포트가 계속 이 항목으로 셈된다
        list = await api.workOps([{ op: 'item-upsert', item: { ...it, name, aliases: [...it.aliases, it.name] } }]);
        toast(`'${name}' 으로 바꿨습니다.`, 'ok');
      }
    } else if (key.startsWith('cat:')) {
      const [k, from] = key.slice(4).split('|');
      if (from !== name) {
        if (list.cats.some((c) => c.kind === k && c.name === name)) { toast('같은 이름의 대분류가 있습니다.', 'err'); return; }
        list = await api.workOps([{ op: 'cat-rename', kind: k, from, to: name }]);
        if (kind === k && cat === from) cat = name;
        toast('대분류 이름을 바꿨습니다.', 'ok');
      }
    } else if (key.startsWith('newcat:')) {
      const k = key.slice(7);
      if (list.cats.some((c) => c.kind === k && c.name === name)) { toast('같은 이름의 대분류가 있습니다.', 'err'); return; }
      list = await api.workOps([{ op: 'cat-add', kind: k, name }]);
      kind = k; cat = name;
      toast(`대분류 '${name}' 을(를) 만들었습니다.`, 'ok');
    }
    editKey = '';
    paint();
  }

  async function remove(key) {
    if (key.startsWith('item:')) {
      const it = list.items.find((x) => x.id === key.slice(5));
      list = await api.workOps([{ op: 'item-delete', id: key.slice(5) }]);
      toast(`'${it ? it.name : ''}' 을(를) 지웠습니다. 이미 쓴 리포트의 글자는 그대로 남습니다.`, 'ok');
    } else if (key.startsWith('cat:')) {
      const [k, name] = key.slice(4).split('|');
      if (list.items.some((it) => it.kind === k && it.cat === name)) {
        toast('안에 세부 항목이 있어 지울 수 없습니다. 항목을 먼저 지우거나 옮기세요.', 'err');
        confirmKey = '';
        paint();
        return;
      }
      list = await api.workOps([{ op: 'cat-delete', kind: k, name }]);
      if (kind === k && cat === name) { kind = list.cats[0].kind; cat = list.cats[0].name; }
      toast(`대분류 '${name}' 을(를) 지웠습니다.`, 'ok');
    }
    confirmKey = '';
    paint();
  }

  const box = document.querySelector('#modalRoot .wk');
  box.addEventListener('click', async (ev) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-act]'));
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'wk-edit') {
      editing = !editing;
      editKey = ''; confirmKey = '';
      btn.setAttribute('aria-pressed', String(editing));
      btn.classList.toggle('btn-dark', editing);
      btn.textContent = editing ? '편집 끝' : '편집';
      paint();
    }
    if (act === 'wk-cat') {
      kind = btn.dataset.kind;
      cat = btn.dataset.cat;
      query = '';
      /** @type {HTMLInputElement} */ ($('#wkQ')).value = '';
      paint();
    }
    if (act === 'wk-ren') { editKey = btn.dataset.key; confirmKey = ''; paint(); focusEdit(); }
    if (act === 'wk-newcat') { editKey = `newcat:${btn.dataset.kind}`; confirmKey = ''; paint(); focusEdit(); }
    if (act === 'wk-del') { confirmKey = btn.dataset.key; editKey = ''; paint(); }
    if (act === 'wk-cancel') { editKey = ''; confirmKey = ''; paint(); }
    if (act === 'wk-save') {
      const inp = /** @type {HTMLInputElement} */ (box.querySelector(`[data-edit-input="${CSS.escape(btn.dataset.key)}"]`));
      await save(btn.dataset.key, inp ? inp.value : '');
    }
    if (act === 'wk-del-yes') await remove(btn.dataset.key);
    if (act === 'wk-pick') {
      if (editing) return;                        // 편집 중에는 고르지 않는다
      const id = btn.dataset.id;
      chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
      paintList(); paintChosen();
    }
    if (act === 'wk-unpick') { chosen = chosen.filter((x) => x !== btn.dataset.id); paintList(); paintChosen(); }
    if (act === 'wk-done') {
      const items = chosen.map((id) => list.items.find((it) => it.id === id)).filter(Boolean);
      closeModal();
      onPick(items.map(workPath), items);
    }
    if (act === 'wk-add') {
      const name = /** @type {HTMLInputElement} */ ($('#wkNew')).value.trim();
      if (!name) { toast('이슈 유형 이름을 적어 주세요.', 'err'); return; }
      const dup = list.items.find((it) => it.kind === kind && it.cat === cat && squash(it.name) === squash(name));
      const it = dup || await api.addWorkItem(kind, cat, name);
      list = await api.workList();
      /** @type {HTMLInputElement} */ ($('#wkNew')).value = '';
      // 편집 중에는 목록에만 넣는다. 아니면 넣고 고른다 — 창은 열어 둔다 (더 고를 수 있게)
      if (!editing && !chosen.includes(it.id)) chosen = [...chosen, it.id];
      if (!dup) toast(editing ? `'${name}' 을(를) 넣었습니다.` : `'${name}' 을(를) 새 항목으로 넣고 골랐습니다.`, 'ok');
      paint();
    }
  });
  // 고치는 칸에서 Enter = 저장
  box.addEventListener('keydown', (/** @type {any} */ ev) => {
    const inp = /** @type {HTMLInputElement} */ (ev.target);
    if (ev.key === 'Enter' && inp.dataset && inp.dataset.editInput && !ev.isComposing) {
      ev.preventDefault();
      save(inp.dataset.editInput, inp.value);
    }
  });
  const q = /** @type {HTMLInputElement} */ ($('#wkQ'));
  const onType = () => { query = q.value.trim(); paint(); };
  q.addEventListener('input', onType);
  q.addEventListener('compositionend', onType);
}
