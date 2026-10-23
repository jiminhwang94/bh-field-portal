// [작업 고르기] 창 (B안) — 왼쪽 구분 · 대분류, 오른쪽 세부 작업 · 검색 · 새로 적기.
//
// 리포트 작성 화면이 연다. 고르면 onPick('로봇 이슈 › 하드웨어 교체 › 로더 교체', 항목) 을
// 부르고 창을 닫는다. 목록은 기기에 있다 (오프라인 OK). 새로 적은 항목은 '새 항목' 으로
// 목록에 들어가 팀 전체에 올라간다 — 정리는 설정 → 작업 목록에서.
//
// 검색칸은 한 번 만들고 다시 만들지 않는다 — 다시 만들면 한글 조합이 끊긴다.
import { api } from './api.js';
import { $, closeModal, h, openSheet, toast } from './ui.js';
import { findWork, matchWork, workPath, workUsage } from './insights.js';

/**
 * @param {{ value?: string, robotModel?: string, onPick: (path: string, item: any) => void }} opts
 */
export async function openWorkPicker({ value = '', robotModel = '', onPick }) {
  let list = await api.workList();
  if (!list.cats.length) list = await api.ensureDefaultWork();
  const usage = await workUsage(list, 3).catch(() => ({ all: new Map(), byModel: new Map() }));
  const modelUse = usage.byModel.get(robotModel) || new Map();
  const current = findWork(value, list);
  let kind = current ? current.kind : list.cats[0].kind;
  let cat = current ? current.cat : list.cats[0].name;
  let query = '';

  openSheet('작업 고르기', `
    <div class="wk">
      <nav class="wk-side" id="wkSide" aria-label="구분 · 대분류"></nav>
      <div class="wk-main">
        <input class="input" id="wkQ" type="search" autocomplete="off" enterkeyhint="search"
               placeholder="검색 — 로더 · 팔 · ㄹㄷ" aria-label="작업 검색" />
        <div class="wk-list" id="wkList"></div>
        <div class="wk-new">
          <input class="input" id="wkNew" autocomplete="off" placeholder="목록에 없으면 새로 적기" aria-label="새 작업 이름" />
          <button class="btn btn-secondary" data-act="wk-add" type="button">추가</button>
        </div>
        <p class="hint" id="wkWhere"></p>
      </div>
    </div>`);

  const score = (it) => (modelUse.get(it.id) || 0) * 1000 + (usage.all.get(it.id) || 0);
  function paintSide() {
    $('#wkSide').innerHTML = ['로봇 이슈', '로봇 외 이슈'].map((k) => `
      <p class="wk-kind">${h(k)}</p>
      ${list.cats.filter((c) => c.kind === k).map((c) => {
        const n = list.items.filter((it) => it.kind === k && it.cat === c.name).length;
        const on = !query && k === kind && c.name === cat;
        return `<button class="wk-cat${on ? ' is-on' : ''}" data-act="wk-cat" data-kind="${h(k)}" data-cat="${h(c.name)}"
                  type="button" aria-pressed="${on}">${h(c.name)} <small class="tnum">${n}</small></button>`;
      }).join('')}`).join('');
  }
  function paintList() {
    const items = query
      ? list.items.filter((it) => matchWork(query, it))
      : list.items.filter((it) => it.kind === kind && it.cat === cat);
    items.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, 'ko'));
    $('#wkList').innerHTML = items.length ? items.map((it) => {
      const n = usage.all.get(it.id) || 0;
      const on = current && current.id === it.id;
      return `
        <button class="wk-item${on ? ' is-on' : ''}" data-act="wk-pick" data-id="${h(it.id)}" type="button">
          <span class="wk-item__name">${h(it.name)}${it.isNew ? ' <em class="wk-new-badge">새 항목</em>' : ''}</span>
          <span class="wk-item__sub">${[query ? `${it.kind} › ${it.cat}` : '',
            it.aliases.length ? `별칭 ${it.aliases.join(', ')}` : ''].filter(Boolean).map(h).join(' · ')}</span>
          ${n ? `<span class="wk-item__n tnum">${n}회</span>` : ''}
        </button>`;
    }).join('') : `<p class="muted wk-empty">${query ? `'${h(query)}' 에 맞는 작업이 없습니다.` : '아직 항목이 없습니다.'}
      아래에 새로 적어 넣으세요.</p>`;
    $('#wkWhere').textContent = `새로 적으면 '${kind} › ${cat}' 에 들어갑니다`;
  }
  paintSide();
  paintList();

  const box = document.querySelector('#modalRoot .wk');
  box.addEventListener('click', async (ev) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-act]'));
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'wk-cat') {
      kind = btn.dataset.kind;
      cat = btn.dataset.cat;
      query = '';
      /** @type {HTMLInputElement} */ ($('#wkQ')).value = '';
      paintSide();
      paintList();
    }
    if (act === 'wk-pick') {
      const it = list.items.find((x) => x.id === btn.dataset.id);
      if (!it) return;
      closeModal();
      onPick(workPath(it), it);
    }
    if (act === 'wk-add') {
      const name = /** @type {HTMLInputElement} */ ($('#wkNew')).value.trim();
      if (!name) { toast('작업 이름을 적어 주세요.', 'err'); return; }
      const dup = list.items.find((it) => it.kind === kind && it.cat === cat
        && it.name.replace(/\s/g, '') === name.replace(/\s/g, ''));
      const it = dup || await api.addWorkItem(kind, cat, name);
      closeModal();
      if (!dup) toast(`'${name}' 을(를) 작업 목록에 새 항목으로 넣었습니다.`, 'ok');
      onPick(workPath(it), it);
    }
  });
  const q = /** @type {HTMLInputElement} */ ($('#wkQ'));
  const onType = () => { query = q.value.trim(); paintSide(); paintList(); };
  q.addEventListener('input', onType);
  q.addEventListener('compositionend', onType);
}
