// 통계 (v3.34) — A안 '한 장 요약' + C안 '하나씩 깊게'(자세히).
//
// 품질팀 · 개발팀에 넘길 근거. 기기에 받아 둔 이력으로 계산한다 (없는 달만 시트에서 받는다).
//  - 요약: 큰 숫자(리포트 건수 · 지난 기간과 비교) + 처리 상태 막대 하나 + 카드 몇 장
//  - 자세히: 왼쪽에서 항목을 고르면 오른쪽에 그 항목 하나만 크게 (전체 순위 · 비율 · 달마다)
//  - 카드는 [카드 편집] 에서 빼고 · 순서를 바꾸고 · 추가하고 · 새로 만든다 (리포트 칸 하나를 골라 센다)
//    카드 구성은 기기마다 둔다 (meta 'statsCards')
// 주소: #/stats?m=3                  요약 (m = 최근 몇 달: 1 · 3 · 6 · 12)
//       #/stats?m=3&v=detail&k=issue  자세히 (k = 카드)
import { h, loading, openSheet, closeModal, toast } from '../ui.js';
import { loadEntries, recentMonths, valueOf, parseParts, openDays, tally, findWork, isCodeShaped, issuesOf,
  splitIssues } from '../insights.js';
import { api } from '../api.js';
import { TRACK, trackOf } from './report-common.js';

const PERIODS = [1, 3, 6, 12];
const CARDS_KEY = 'statsCards';

/** 기본으로 있는 카드. kind: rank = 많은 순 · month = 달마다 · open = 안 끝난 건 */
const BUILTIN = {
  issue: { title: '이슈 유형', kind: 'rank' },
  month: { title: '달마다 건수', kind: 'month' },
  model: { title: '로봇 모델', kind: 'rank' },
  parts: { title: '많이 쓴 부품', kind: 'rank', unit: '개' },
  store: { title: '방문이 많은 매장', kind: 'rank', unit: '번' },
  code: { title: '오류 코드', kind: 'rank' },
  open: { title: '오래 끝나지 않은 건', kind: 'open' },
};
/** 처음 보는 카드 — '너무 많다' 해서 넷만 (v3.34). 나머지는 [카드 추가] 에서 */
const DEFAULT_CARDS = ['issue', 'month', 'model', 'parts'].map((id) => ({ id }));

const monthOf = (e) => String(e.sheetName || e.date || '').slice(0, 7);
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

async function loadCards() {
  const store = await import('../local/store.js');
  const saved = await store.getMeta(CARDS_KEY, null);
  return Array.isArray(saved) ? saved.filter((c) => c && (BUILTIN[c.id] || c.field)) : DEFAULT_CARDS.slice();
}
async function saveCards(cards) {
  const store = await import('../local/store.js');
  await store.setMeta(CARDS_KEY, cards);
}

const cardTitle = (c) => (BUILTIN[c.id] ? BUILTIN[c.id].title : c.title || c.field);
const cardKind = (c) => (BUILTIN[c.id] ? BUILTIN[c.id].kind : 'rank');
const cardUnit = (c) => (BUILTIN[c.id] && BUILTIN[c.id].unit) || '건';

/**
 * 카드 하나가 셀 것 — rank 카드는 [이름, 수] 를 많은 순으로.
 * 만든 카드(field)는 그 리포트 칸의 글자를 센다 (여러 줄이면 줄마다).
 * @returns {[string, number][]}
 */
function rowsOf(card, entries, work) {
  if (card.field) {
    return tally(entries.flatMap((e) => {
      const hit = (e.values || []).find((v) => v.label === card.field);
      return hit ? splitIssues(hit.value) : [];
    }));
  }
  if (card.id === 'issue') {
    return tally(entries.flatMap((e) => issuesOf(e).map((t) => {
      const it = findWork(t, work);
      return it ? it.name : t.split('›').pop().trim();
    })));
  }
  if (card.id === 'model') return tally(entries.map((e) => valueOf(e, '모델') || '(모델 없음)'));
  if (card.id === 'store') return tally(entries.map((e) => e.store).filter(Boolean));
  if (card.id === 'code') return tally(entries.map((e) => e.code).filter(isCodeShaped));
  if (card.id === 'parts') {
    const parts = new Map();
    for (const e of entries) for (const p of parseParts(valueOf(e, '사용 부품'))) parts.set(p.name, (parts.get(p.name) || 0) + p.n);
    return [...parts].sort((a, b) => b[1] - a[1]);
  }
  return [];
}

/** 이슈 유형 카드의 한 줄 — 로봇 이슈 39 · 로봇 외 이슈 9 */
function issueKinds(entries, work) {
  return tally(entries.flatMap((e) => issuesOf(e).map((t) => {
    const it = findWork(t, work);
    return it ? it.kind : (t.includes('로봇 외') ? '로봇 외 이슈' : '로봇 이슈');
  })));
}

/** 이름을 누르면 갈 곳 — 매장 · 오류 코드만 */
function linkOf(card, name) {
  if (card.id === 'store') return `#/store?name=${encodeURIComponent(name)}`;
  if (card.id === 'code') return `#/search?q=${encodeURIComponent(name)}`;
  return '';
}

/** 가로 막대 — 요약은 5줄, 자세히는 15줄 + '그 밖 N개' */
function barsHtml(card, rows, { max = 5, share = false } = {}) {
  if (!rows.length) return '<p class="muted">자료가 없습니다.</p>';
  const total = rows.reduce((s, r) => s + r[1], 0);
  const top = rows.slice(0, max);
  const rest = rows.slice(max);
  const big = top[0][1] || 1;
  const line = (name, n, cls = '') => {
    const href = linkOf(card, name);
    const label = href ? `<a href="${href}">${h(name)}</a>` : h(name);
    return `<li class="sx-bar${cls}"><span class="sx-bar__name">${label}</span>
      <span class="sx-bar__track"><span class="sx-bar__fill" style="width:${Math.max(3, Math.round((n / big) * 100))}%"></span></span>
      <span class="sx-bar__n tnum"><b>${n}</b>${share ? ` · ${pct(n, total)}%` : ''}</span></li>`;
  };
  const restN = rest.reduce((s, r) => s + r[1], 0);
  return `<ol class="sx-bars">${top.map(([name, n]) => line(name, n)).join('')}
    ${rest.length ? line(`그 밖 ${rest.length}개`, restN, ' sx-bar--rest') : ''}</ol>`;
}

/** 달마다 건수 — 세로 막대 */
function monthsHtml(entries, months, { tall = false } = {}) {
  const per = months.slice().reverse().map((mm) => [mm, entries.filter((e) => monthOf(e) === mm).length]);
  const max = Math.max(1, ...per.map(([, n]) => n));
  return `<div class="sx-cols${tall ? ' sx-cols--tall' : ''}" role="img"
      aria-label="달마다 리포트 건수 — ${per.map(([mm, n]) => `${Number(mm.slice(5))}월 ${n}건`).join(', ')}">
    ${per.map(([mm, n], i) => `<div class="sx-cols__col${i === per.length - 1 ? ' is-now' : ''}">
      <b class="tnum">${n}</b><span class="sx-cols__bar" style="height:${Math.max(2, Math.round((n / max) * 100))}%"></span>
      <span class="sx-cols__label tnum">${Number(mm.slice(5))}월</span></div>`).join('')}
  </div>`;
}

/** 오래 끝나지 않은 건 */
function openHtml(open, max) {
  if (!open.length) return '<p class="muted">모두 끝났습니다.</p>';
  return `<ol class="sx-open">${open.slice(0, max).map((e) => `
    <li><a href="#/reports?open=${encodeURIComponent(e.key)}">${h(e.store || '(매장 없음)')}</a>
      <span class="sx-open__st" data-track="${trackOf(e.status).cls}">${h(trackOf(e.status).short)}</span>
      <b class="tnum">${openDays(e)}일째</b></li>`).join('')}</ol>`;
}

/** 카드 하나의 몸통 — 요약 (detail=false) 과 자세히 (true) 가 같이 쓴다 */
function bodyOf(card, ctx, detail) {
  const kind = cardKind(card);
  if (kind === 'month') return monthsHtml(ctx.entries, ctx.months, { tall: detail });
  if (kind === 'open') return openHtml(ctx.open, detail ? 30 : 5);
  const rows = rowsOf(card, ctx.entries, ctx.work);
  if (card.view === 'share' && !detail) return shareHtml(rows);
  return barsHtml(card, rows, { max: detail ? 15 : 5, share: detail || card.view === 'share' });
}

/** 비율 — 한 줄 막대 + 범례 (만든 카드에서 '비율' 로 고르면) */
function shareHtml(rows) {
  if (!rows.length) return '<p class="muted">자료가 없습니다.</p>';
  const total = rows.reduce((s, r) => s + r[1], 0);
  const top = rows.slice(0, 4);
  const restN = total - top.reduce((s, r) => s + r[1], 0);
  const parts = [...top, ...(restN ? [['그 밖', restN]] : [])];
  return `<div class="sx-share" role="img" aria-label="${parts.map(([n, v]) => `${h(n)} ${pct(v, total)}%`).join(', ')}">
      ${parts.map(([, v], i) => `<span class="sx-share__seg" data-i="${i}" style="flex:${v}"></span>`).join('')}</div>
    <ul class="sx-legend">${parts.map(([n, v], i) => `<li><span class="sx-legend__dot" data-i="${i}"></span>${h(n)}
      <b class="tnum">${pct(v, total)}%</b></li>`).join('')}</ul>`;
}

/** 카드 위 작은 한 줄 */
function subOf(card, ctx) {
  if (card.id === 'issue') {
    const kinds = issueKinds(ctx.entries, ctx.work);
    return kinds.map(([k, n]) => `${k} ${n}`).join(' · ');
  }
  if (cardKind(card) === 'open') return ctx.open.length ? `${ctx.open.length}건` : '';
  if (cardKind(card) === 'month') return '';
  const rows = rowsOf(card, ctx.entries, ctx.work);
  return rows.length ? `${rows.length}가지` : '';
}

export async function statsView(view, params) {
  loading(view);
  const m = PERIODS.includes(Number(params && params.get('m'))) ? Number(params.get('m')) : 3;
  const detail = params && params.get('v') === 'detail';
  // 지난 기간과 비교하려고 두 배를 받는다 (12달은 비교하지 않는다 — 너무 많다)
  const span = m <= 6 ? m * 2 : m;
  const loaded = await loadEntries(span);
  const nowMonths = recentMonths(m);
  const entries = loaded.entries.filter((e) => nowMonths.includes(monthOf(e)));
  const before = m <= 6 ? loaded.entries.filter((e) => !nowMonths.includes(monthOf(e))) : null;
  const months = loaded.months.filter((mm) => nowMonths.includes(mm));
  const work = await api.workList().catch(() => ({ cats: [], items: [] }));
  const open = entries.filter((e) => e.status !== '조치 완료').sort((a, b) => openDays(b) - openDays(a));
  const ctx = { entries, months, work, open };
  let cards = await loadCards();
  let editing = false;

  const href = (o) => {
    const q = new URLSearchParams({ m: String(m) });
    if (o.v) q.set('v', o.v);
    if (o.k) q.set('k', o.k);
    return `#/stats?${q}`;
  };

  function headHtml() {
    return `
      <div class="page-head sx-head">
        <h1 class="page-head__title">통계</h1>
        <div class="seg" role="group" aria-label="보기">
          <a class="seg__btn${detail ? '' : ' is-on'}" href="${href({})}" ${detail ? '' : 'aria-current="page"'}>요약</a>
          <a class="seg__btn${detail ? ' is-on' : ''}" href="${href({ v: 'detail', k: params && params.get('k') })}"
             ${detail ? 'aria-current="page"' : ''}>자세히</a>
        </div>
        <span class="page-head__spacer"></span>
        <div class="seg" role="group" aria-label="기간">
          ${PERIODS.map((p) => `<a class="seg__btn${p === m ? ' is-on' : ''}"
            href="#/stats?m=${p}${detail ? `&v=detail${params.get('k') ? `&k=${encodeURIComponent(params.get('k'))}` : ''}` : ''}"
            ${p === m ? 'aria-current="page"' : ''}>${p === 1 ? '이번 달' : `최근 ${p}달`}</a>`).join('')}
        </div>
        ${detail ? '' : `<button class="btn btn-secondary${editing ? ' btn-dark' : ''}" data-act="sx-edit" type="button"
          aria-pressed="${editing}">${editing ? '편집 끝' : '카드 편집'}</button>`}
      </div>
      ${loaded.missing.length ? `<div class="hist-note">연결이 안 돼 ${h(loaded.missing.join(', '))} 은(는) 빠졌습니다.</div>` : ''}`;
  }

  /** 맨 위 — 큰 숫자 + 처리 상태 막대 (A안) */
  function heroHtml() {
    const n = entries.length;
    let delta = '';
    if (before) {
      const d = n - before.length;
      const what = m === 1 ? '지난달' : `지난 ${m}달`;
      delta = d === 0 ? `${what}과 같음`
        : `<span class="${d > 0 ? 'sx-up' : 'sx-down'}">${what}보다 ${Math.abs(d)}건 ${d > 0 ? '많음' : '적음'}</span>`;
    }
    /** @type {[{ value: string, short: string, cls: string }, number][]} */
    const by = TRACK.map((t) => [t, entries.filter((e) => e.status === t.value).length]);
    const avg = open.length ? Math.round(open.reduce((s, e) => s + openDays(e), 0) / open.length) : 0;
    return `
      <div class="sx-hero">
        <section class="sx-card sx-big">
          <span class="sx-card__label">리포트</span>
          <b class="sx-big__n tnum">${n}<small>건</small></b>
          ${delta ? `<span class="sx-big__delta">${delta}</span>` : ''}
        </section>
        <section class="sx-card sx-status">
          <span class="sx-card__label">처리 상태</span>
          <div class="sx-status__bar" role="img" aria-label="${by.map(([t, c]) => `${t.short} ${c}건`).join(', ')}">
            ${by.filter(([, c]) => c).map(([t, c]) => `<span data-track="${t.cls}" style="flex:${c}"></span>`).join('') || '<span class="sx-status__none"></span>'}
          </div>
          <ul class="sx-status__legend">
            ${by.map(([t, c]) => `<li><a href="#/reports"><span class="sx-dot" data-track="${t.cls}"></span>${h(t.short)}
              <b class="tnum">${c}</b></a></li>`).join('')}
          </ul>
          <span class="sx-status__avg">안 끝난 건 평균 <b class="tnum">${avg}일째</b></span>
        </section>
      </div>`;
  }

  function cardHtml(card, i) {
    const sub = subOf(card, ctx);
    const tools = editing ? `
      <span class="sx-card__tools">
        <button class="sx-ico" data-act="sx-move" data-i="${i}" data-dir="-1" type="button" aria-label="${h(cardTitle(card))} 앞으로"
          ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="sx-ico" data-act="sx-move" data-i="${i}" data-dir="1" type="button" aria-label="${h(cardTitle(card))} 뒤로"
          ${i === cards.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="sx-ico" data-act="sx-remove" data-i="${i}" type="button" aria-label="${h(cardTitle(card))} 빼기">✕</button>
      </span>`
      : `<a class="sx-card__more" href="${href({ v: 'detail', k: card.id })}">자세히 ›</a>`;
    return `
      <section class="sx-card" data-card="${h(card.id)}">
        <header class="sx-card__head">
          <h2 class="sx-card__title">${h(cardTitle(card))}</h2>
          <span class="page-head__spacer"></span>${tools}
        </header>
        ${sub ? `<p class="sx-card__sub sx-card__sub--line">${h(sub)}</p>` : ''}
        ${bodyOf(card, ctx, false)}
      </section>`;
  }

  function summaryHtml() {
    return `${heroHtml()}
      <div class="sx-grid">
        ${cards.map(cardHtml).join('')}
        ${editing || !cards.length ? `<button class="sx-add" data-act="sx-add" type="button">＋ 카드 추가 · 만들기</button>` : ''}
      </div>`;
  }

  /** 자세히 (C안) — 왼쪽 항목 · 오른쪽 하나만 크게 */
  function detailHtml() {
    const list = cards.length ? cards : DEFAULT_CARDS;
    const k = params.get('k');
    const card = list.find((c) => c.id === k) || list[0];
    const rows = cardKind(card) === 'rank' ? rowsOf(card, entries, work) : [];
    const total = rows.reduce((s, r) => s + r[1], 0);
    // 많은 것 다섯은 달마다 몇 번이었나
    /** @type {[string, number[]][]} */
    const monthly =rows.slice(0, 5).map(([name]) => [name, months.slice().reverse().map((mm) =>
      (rowsOf(card, entries.filter((e) => monthOf(e) === mm), work).find((r) => r[0] === name) || ['', 0])[1])]);
    return `
      <div class="sx-detail">
        <nav class="sx-rail" aria-label="항목">
          ${list.map((c) => {
            const on = c.id === card.id;
            // 왼쪽 목록은 짧게 — 몇 가지인지만
            const sub = cardKind(c) === 'rank' ? `${rowsOf(c, entries, work).length}가지` : subOf(c, ctx);
            return `<a class="sx-rail__item${on ? ' is-on' : ''}" href="${href({ v: 'detail', k: c.id })}"
              ${on ? 'aria-current="page"' : ''}><span>${h(cardTitle(c))}</span>${sub ? `<small>${h(sub)}</small>` : ''}</a>`;
          }).join('')}
          <a class="sx-rail__item sx-rail__item--edit" href="${href({})}">카드 편집은 요약에서 ›</a>
        </nav>
        <section class="sx-card sx-focus">
          <header class="sx-card__head">
            <h2 class="sx-card__title">${h(cardTitle(card))}</h2>
            <span class="sx-card__sub">${h(cardKind(card) === 'rank' ? `${rows.length}가지 · 모두 ${total}${cardUnit(card)}` : subOf(card, ctx))}</span>
          </header>
          ${card.id === 'issue' ? `<p class="sx-focus__kinds">${issueKinds(entries, work).map(([kk, n]) =>
            `<span>${h(kk)} <b class="tnum">${n}</b></span>`).join('')}</p>` : ''}
          ${bodyOf(card, ctx, true)}
          ${monthly.length && months.length > 1 ? `
            <h3 class="sx-focus__h">달마다</h3>
            <table class="sx-table">
              <thead><tr><th></th>${months.slice().reverse().map((mm) => `<th class="tnum">${Number(mm.slice(5))}월</th>`).join('')}</tr></thead>
              <tbody>${monthly.map(([name, per]) => `<tr><th>${h(name)}</th>${per.map((n) =>
                `<td class="tnum${n ? '' : ' is-zero'}">${n}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>` : ''}
        </section>
      </div>`;
  }

  // 바깥 틀은 한 번 — 다시 그릴 때는 안만 바꾼다 (누르기 받는 곳이 그대로 남는다)
  view.innerHTML = '<div id="pageRoot" class="page-stack"></div>';
  const root = /** @type {HTMLElement} */ (view.querySelector('#pageRoot'));
  function paint() {
    root.innerHTML = `${headHtml()}${detail ? detailHtml() : summaryHtml()}`;
  }
  paint();

  async function openAdd() {
    // 세어 볼 만한 칸만 — 사진 · 긴 글(증상 · 조치)은 빼고, 고르는 칸(처리 결과 같은)을 앞에
    const fields = (await (await import('../local/store.js')).listFields())
      .filter((f) => f.fieldType !== 'MEDIA' && f.fieldType !== 'TEXTAREA')
      .sort((a, b) => Number(b.fieldType === 'DROPDOWN') - Number(a.fieldType === 'DROPDOWN'));
    const shown = new Set(cards.map((c) => c.id));
    const left = Object.entries(BUILTIN).filter(([id]) => !shown.has(id));
    openSheet('카드 추가 · 만들기', `
      <div class="sx-addbox">
        <h3 class="sx-addbox__h">있는 카드</h3>
        ${left.length ? `<div class="sx-addbox__list">${left.map(([id, c]) =>
          `<button class="btn btn-secondary" data-add="${id}" type="button">＋ ${h(c.title)}</button>`).join('')}</div>`
          : '<p class="muted">있는 카드는 모두 나와 있습니다.</p>'}
        <h3 class="sx-addbox__h">새로 만들기</h3>
        <p class="hint">리포트 칸 하나를 골라, 어떤 글자가 몇 번 나왔는지 셉니다.</p>
        <label class="sx-addbox__row"><span>리포트 칸</span>
          <select class="select" id="sxField">${fields.map((f) =>
            `<option value="${h(f.fieldLabel)}">${h(f.fieldLabel)}</option>`).join('')}</select></label>
        <label class="sx-addbox__row"><span>카드 이름</span>
          <input class="input" id="sxTitle" autocomplete="off" placeholder="비워 두면 칸 이름" /></label>
        <div class="sx-addbox__row"><span>보기</span>
          <div class="seg" role="group" aria-label="보기">
            <button class="seg__btn is-on" data-view="rank" type="button" aria-pressed="true">많은 순 막대</button>
            <button class="seg__btn" data-view="share" type="button" aria-pressed="false">비율</button>
          </div></div>
        <button class="btn btn-primary" data-make type="button">만들기</button>
      </div>`);
    const box = document.querySelector('#modalRoot .sx-addbox');
    let viewKind = 'rank';
    box.addEventListener('click', async (ev) => {
      const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('button'));
      if (!btn) return;
      if (btn.dataset.add) {
        cards = [...cards, { id: btn.dataset.add }];
        await saveCards(cards);
        closeModal();
        toast(`'${BUILTIN[btn.dataset.add].title}' 카드를 넣었습니다.`, 'ok');
        paint();
      }
      if (btn.dataset.view) {
        viewKind = btn.dataset.view;
        box.querySelectorAll('[data-view]').forEach((b) => {
          b.classList.toggle('is-on', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
      }
      if (btn.hasAttribute('data-make')) {
        const field = /** @type {HTMLSelectElement} */ (box.querySelector('#sxField')).value;
        if (!field) { toast('리포트 칸을 골라 주세요.', 'err'); return; }
        const title = /** @type {HTMLInputElement} */ (box.querySelector('#sxTitle')).value.trim() || field;
        const { newId } = await import('../local/store.js');
        cards = [...cards, { id: `c-${newId()}`, field, title, view: viewKind }];
        await saveCards(cards);
        closeModal();
        toast(`'${title}' 카드를 만들었습니다.`, 'ok');
        paint();
      }
    });
  }

  root.addEventListener('click', async (ev) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-act]'));
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'sx-edit') { editing = !editing; paint(); }
    if (act === 'sx-add') openAdd();
    if (act === 'sx-move') {
      const i = Number(btn.dataset.i);
      const j = i + Number(btn.dataset.dir);
      if (j < 0 || j >= cards.length) return;
      cards = cards.slice();
      [cards[i], cards[j]] = [cards[j], cards[i]];
      await saveCards(cards);
      paint();
    }
    if (act === 'sx-remove') {
      const gone = cards[Number(btn.dataset.i)];
      cards = cards.filter((_, i) => i !== Number(btn.dataset.i));
      await saveCards(cards);
      toast(`'${cardTitle(gone)}' 카드를 뺐습니다. [＋ 카드 추가] 에서 다시 넣을 수 있습니다.`, 'ok');
      paint();
    }
  });
}
