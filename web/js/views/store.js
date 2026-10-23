// 매장별 이력 — 한 매장의 리포트 · 로봇 · 상태를 시간 차례로 (재방문 전에 보는 화면).
//
// 주소: #/store?name=옥동식 서초점
// 최근 12달을 기기 사본으로 모은다 (없는 달만 시트에서 받는다).
import { $, h, loading, when } from '../ui.js';
import { loadEntries, storeKey, valueOf, openDays, tally } from '../insights.js';
import { trackOf } from './report-common.js';

const MONTHS = 12;

export async function storeHistoryView(view, name) {
  loading(view);
  const target = String(name || '').trim();
  const { entries, missing } = await loadEntries(MONTHS);
  const mine = entries.filter((e) => storeKey(e.store) === storeKey(target));

  const open = mine.filter((e) => e.status !== '조치 완료');
  const robots = tally(mine.map((e) => valueOf(e, '시리얼')).filter(Boolean));
  const models = tally(mine.map((e) => valueOf(e, '모델')).filter(Boolean));
  const codes = tally(mine.map((e) => e.code).filter(Boolean));
  const last = mine[0];

  view.innerHTML = `
    <div id="pageRoot" class="page-stack">
      <div class="page-head">
        <h1 class="page-head__title">${h(target || '(매장 이름 없음)')}</h1>
        <span class="page-head__meta">최근 ${MONTHS}달 · <span class="tnum">${mine.length}</span>건</span>
        <span class="page-head__spacer"></span>
        <a class="btn btn-primary" href="#/report/new" data-act="new-here">＋ 이 매장 새 리포트</a>
      </div>
      ${missing.length ? `<div class="hist-note">연결이 안 돼 ${h(missing.join(', '))} 은(는) 빠졌습니다.</div>` : ''}
      ${mine.length ? `
        <div class="store-sum">
          <div class="store-sum__tile"><span>방문</span><b class="tnum">${mine.length}</b><small>회</small></div>
          <div class="store-sum__tile" data-track="${open.length ? 'doing' : 'done'}"><span>끝나지 않은 건</span><b class="tnum">${open.length}</b><small>건</small></div>
          <div class="store-sum__tile"><span>마지막 방문</span><b>${h(when(last.createdAt || last.date, { time: false }))}</b>
            <small>${h(trackOf(last.status).short)}</small></div>
          <div class="store-sum__tile store-sum__tile--wide"><span>로봇</span>
            <b class="store-sum__list">${robots.length ? robots.map(([s, n]) => `${h(s)}<small> ${n}회</small>`).join(' · ') : '—'}</b>
            ${models.length ? `<small>${models.map(([m]) => h(m)).join(' · ')}</small>` : ''}</div>
          ${codes.length ? `<div class="store-sum__tile store-sum__tile--wide"><span>자주 난 오류</span>
            <b class="store-sum__list">${codes.slice(0, 5).map(([c, n]) => `${h(c)}<small> ${n}회</small>`).join(' · ')}</b></div>` : ''}
        </div>
        <section class="panel">
          <h2 class="panel__title">방문 기록</h2>
          <ol class="store-timeline">
            ${mine.map((e) => {
              const t = trackOf(e.status);
              const late = e.status !== '조치 완료' && openDays(e) >= 7;
              return `
                <li class="store-visit" data-track="${t.cls}">
                  <a href="#/reports?open=${encodeURIComponent(e.key)}">
                    <span class="store-visit__top">
                      <b class="tnum">${h(e.date || '')}</b>
                      <span class="store-visit__status${late ? ' is-late' : ''}">${h(t.short)}${late ? ` · ${openDays(e)}일째` : ''}</span>
                    </span>
                    <span class="store-visit__what">${h([e.code, valueOf(e, '증상')].filter(Boolean).join(' · ') || '(증상 없음)')}</span>
                    ${valueOf(e, '조치') ? `<span class="store-visit__do">조치 · ${h(valueOf(e, '조치'))}</span>` : ''}
                    <span class="store-visit__meta">${h([valueOf(e, '시리얼'), valueOf(e, '사용 부품'), e.author].filter(Boolean).join(' · '))}</span>
                  </a>
                </li>`;
            }).join('')}
          </ol>
        </section>` : `
        <div class="empty">최근 ${MONTHS}달 동안 '${h(target)}' 의 리포트가 없습니다.<br />
          이력 화면에서 달을 한 번 열면 그 달 기록이 기기에 담깁니다.</div>`}
    </div>`;

  // [이 매장 새 리포트] — 지난 기록의 매장 · 시리얼 · 오류 코드를 채워 새 리포트를 연다
  $('#pageRoot').addEventListener('click', (ev) => {
    const a = /** @type {HTMLElement} */ (ev.target).closest('[data-act="new-here"]');
    if (!a || !last) return;
    ev.preventDefault();
    import('./report-common.js').then(({ seedFromEntry }) => {
      seedFromEntry(last);
      location.hash = '#/report/new';
    });
  });
}
