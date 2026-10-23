// 통계 — 로봇별 · 오류 코드별 · 매장별 · 많이 쓴 부품 · 달마다 건수.
//
// 품질팀 · 개발팀에 넘길 근거. 기기에 받아 둔 이력으로 계산한다 (없는 달만 시트에서 받는다).
// 주소: #/stats?m=3   (m = 최근 몇 달: 1 · 3 · 6 · 12)
import { $, h, loading } from '../ui.js';
import { loadEntries, valueOf, parseParts, openDays, tally, findWork, isCodeShaped } from '../insights.js';
import { api } from '../api.js';
import { TRACK, trackOf } from './report-common.js';

const PERIODS = [1, 3, 6, 12];

/** 가로 막대 목록 — 숫자 · 이름 · 막대 (차트 라이브러리 없이) */
function bars(rows, { max = 10, href = null } = {}) {
  if (!rows.length) return '<p class="muted">자료가 없습니다.</p>';
  const top = rows.slice(0, max);
  const big = top[0][1] || 1;
  return `<ol class="bars">
    ${top.map(([name, n]) => {
      const label = href ? `<a href="${href(name)}">${h(name)}</a>` : h(name);
      return `<li class="bars__row"><span class="bars__name">${label}</span>
        <span class="bars__track"><span class="bars__fill" style="width:${Math.max(4, Math.round((n / big) * 100))}%"></span></span>
        <b class="bars__n tnum">${n}</b></li>`;
    }).join('')}
  </ol>`;
}

export async function statsView(view, params) {
  loading(view);
  const m = PERIODS.includes(Number(params && params.get('m'))) ? Number(params.get('m')) : 3;
  const { entries, months, missing } = await loadEntries(m);

  const byStatus = Object.fromEntries(TRACK.map((t) => [t.value, 0]));
  for (const e of entries) if (byStatus[e.status] !== undefined) byStatus[e.status] += 1;
  const open = entries.filter((e) => e.status !== '조치 완료');
  const avgOpen = open.length ? Math.round(open.reduce((s, e) => s + openDays(e), 0) / open.length) : 0;
  const models = tally(entries.map((e) => valueOf(e, '모델') || '(모델 없음)'));
  // 작업 — 별칭 · 합친 이름도 같은 항목으로 센다. 예전 '오류 코드' 칸의 분류 글자도 작업으로 본다
  const work = await api.workList().catch(() => ({ cats: [], items: [] }));
  const workText = (e) => valueOf(e, '작업') || (e.code && !isCodeShaped(e.code) ? e.code : '');
  const works = tally(entries.map((e) => {
    const t = workText(e);
    const it = findWork(t, work);
    return it ? it.name : t.split('›').pop().trim();
  }).filter(Boolean));
  const kinds = tally(entries.map((e) => {
    const it = findWork(workText(e), work);
    return it ? it.kind : (workText(e).includes('로봇 외') ? '로봇 외 이슈' : '');
  }).filter(Boolean));
  const codes = tally(entries.map((e) => e.code).filter(isCodeShaped));
  const stores = tally(entries.map((e) => e.store).filter(Boolean));
  const parts = new Map();
  for (const e of entries) for (const p of parseParts(valueOf(e, '사용 부품'))) parts.set(p.name, (parts.get(p.name) || 0) + p.n);
  /** @type {[string, number][]} */
  const partRows = [...parts].sort((a, b) => b[1] - a[1]);
  /** @type {[string, number][]} */
  const perMonth = months.slice().reverse().map((mm) => [mm, entries.filter((e) => String(e.sheetName || e.date || '').startsWith(mm)).length]);
  const monthMax = Math.max(1, ...perMonth.map(([, n]) => n));

  view.innerHTML = `
    <div id="pageRoot" class="page-stack">
      <div class="page-head">
        <h1 class="page-head__title">통계</h1>
        <span class="page-head__meta">리포트 <span class="tnum">${entries.length}</span>건</span>
        <span class="page-head__spacer"></span>
        <div class="seg" role="group" aria-label="기간">
          ${PERIODS.map((p) => `<a class="seg__btn${p === m ? ' is-on' : ''}" href="#/stats?m=${p}"
            ${p === m ? 'aria-current="page"' : ''}>${p === 1 ? '이번 달' : `최근 ${p}달`}</a>`).join('')}
        </div>
      </div>
      ${missing.length ? `<div class="hist-note">연결이 안 돼 ${h(missing.join(', '))} 은(는) 빠졌습니다.</div>` : ''}

      <div class="stat-tiles">
        ${TRACK.map((t) => `
          <a class="stat-tile" data-track="${t.cls}" href="#/reports">
            <span>${h(t.short)}</span><b class="tnum">${byStatus[t.value]}</b>
          </a>`).join('')}
        <div class="stat-tile" data-track="all"><span>끝나지 않은 건 평균</span><b class="tnum">${avgOpen}</b><small>일째</small></div>
      </div>

      <div class="stats-grid">
        <section class="panel"><h2 class="panel__title">달마다 건수</h2>
          <div class="cols" role="img" aria-label="달마다 리포트 건수">
            ${perMonth.map(([mm, n]) => `<div class="cols__col"><b class="tnum">${n}</b>
              <span class="cols__bar" style="height:${Math.round((n / monthMax) * 100)}%"></span>
              <span class="cols__label tnum">${h(mm.slice(2))}</span></div>`).join('')}
          </div>
        </section>
        <section class="panel"><h2 class="panel__title">로봇 모델별</h2>${bars(models)}</section>
        <section class="panel"><h2 class="panel__title">자주 한 작업 ${kinds.length
            ? `<span class="muted">${kinds.map(([k, n]) => `${h(k)} ${n}`).join(' · ')}</span>` : ''}</h2>
          ${bars(works)}</section>
        <section class="panel"><h2 class="panel__title">자주 난 오류 코드</h2>
          ${bars(codes, { href: (c) => `#/search?q=${encodeURIComponent(c)}` })}</section>
        <section class="panel"><h2 class="panel__title">많이 쓴 부품</h2>${bars(partRows)}</section>
        <section class="panel"><h2 class="panel__title">방문이 많은 매장</h2>
          ${bars(stores, { href: (s) => `#/store?name=${encodeURIComponent(s)}` })}</section>
        <section class="panel"><h2 class="panel__title">오래 끝나지 않은 건</h2>
          ${open.length ? `<ol class="bars">${open.slice().sort((a, b) => openDays(b) - openDays(a)).slice(0, 8).map((e) => `
            <li class="bars__row"><span class="bars__name"><a href="#/reports?open=${encodeURIComponent(e.key)}">${h(e.store || '(매장 없음)')}</a>
              <small class="muted"> ${h(trackOf(e.status).short)}</small></span>
              <b class="bars__n tnum">${openDays(e)}일째</b></li>`).join('')}</ol>` : '<p class="muted">모두 끝났습니다.</p>'}</section>
      </div>
    </div>`;
  void $;
}
