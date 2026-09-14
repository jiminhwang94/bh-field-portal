// 차량 운행 일지 — 국세청 '법인 차량 운행 일지' 서식을 그대로 옮긴 화면.
//
// 서식의 항목 번호를 화면에도 그대로 둔다. 연말에 시트 탭을 인쇄해 제출할 때
// 세무 담당자가 서식과 한 칸씩 맞춰 볼 수 있어야 하기 때문이다.
//
// 현장에서 손이 덜 가게 한 것 네 가지.
//  · ③사용일자는 **오늘**이 미리 들어간다 (그날 적는 것이 거의 전부다)
//  · ⑤주행 전은 **지난번 ⑥주행 후**가 미리 들어간다 (계기판은 이어진다)
//  · ⑦주행거리는 ⑥−⑤ 로 **저절로** 채워진다
//  · 숫자는 치는 대로 천 단위에 쉼표가 붙는다
import { api } from '../api.js';
import { $, h, closeModal, confirmDialog, loading, openSheet, toast } from '../ui.js';
import * as store from '../local/store.js';
import { deviceName } from '../syncnow.js';

const VEHICLE_KEY = 'bh_driving_vehicle';

/** 법인 정보 — 서식 머리에 들어간다 (양식에 적힌 값 그대로). */
const COMPANY = { name: '비욘드허니컴', bizNo: '697-86-01767' };

/** 1234567 → '1,234,567'. 숫자가 아닌 글자는 버린다. */
export function comma(value) {
  const digits = String(value === null || value === undefined ? '' : value)
    .replace(/[^0-9]/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** '1,234' → 1234. 빈 칸이면 null. */
export function unComma(value) {
  const digits = String(value === null || value === undefined ? '' : value)
    .replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

/**
 * 치는 대로 쉼표를 붙인다.
 *
 * 값을 다시 넣으면 커서가 맨 뒤로 튄다 — 가운데 한 자를 고치던 사람은 그때부터
 * 엉뚱한 자리에 숫자를 친다. 그래서 **커서 앞의 숫자 개수**를 세어 두었다가
 * 쉼표를 붙인 뒤 같은 숫자 개수 자리로 커서를 되돌린다.
 */
export function formatOdoInput(input) {
  const before = input.value.slice(0, input.selectionStart || 0);
  const digitsBefore = before.replace(/[^0-9]/g, '').length;
  const next = comma(input.value);
  input.value = next;
  let seen = 0;
  let at = next.length;
  for (let i = 0; i < next.length; i += 1) {
    if (/[0-9]/.test(next[i])) seen += 1;
    if (seen === digitsBefore) { at = i + 1; break; }
  }
  if (digitsBefore === 0) at = 0;
  try { input.setSelectionRange(at, at); } catch { /* 일부 기기는 막는다 */ }
}

export async function drivingView(view) {
  loading(view);

  let vehicles = (await api.listVehicles()).items;
  let current = localStorage.getItem(VEHICLE_KEY);
  if (!vehicles.some((v) => v.name === current)) {
    current = vehicles.length ? vehicles[0].name : null;
  }
  let rows = [];
  let options = { depts: [], places: [] };
  let info = { model: '', plate: '' };
  let lastOdo = null;
  let month = '';                 // '' = 전체, 'YYYY-MM' = 그 달만
  const sheetMode = await store.sheetInventoryOn();

  async function reload() {
    vehicles = (await api.listVehicles()).items;
    if (!vehicles.some((v) => v.name === current)) {
      current = vehicles.length ? vehicles[0].name : null;
    }
    if (current) localStorage.setItem(VEHICLE_KEY, current);
    else localStorage.removeItem(VEHICLE_KEY);
    const data = await api.listDriving(current);
    rows = data.items;
    options = data.options;
    info = data.info;
    lastOdo = data.lastOdometer;
    render();
  }

  const months = () => [...new Set(rows.map((r) => String(r.date || '').slice(0, 7)))]
    .filter(Boolean).sort().reverse();

  const visibleRows = () => (month ? rows.filter((r) => String(r.date).startsWith(month)) : rows);

  const km = (n) => `${comma(n)} ㎞`;

  function logRow(r) {
    return `
      <tr data-id="${h(r.id)}">
        <td data-label="③사용일자">${h(r.date)}${r.weekday ? ` <span class="muted">(${h(r.weekday)})</span>` : ''}</td>
        <td data-label="부서">${h(r.dept) || '<span class="muted">-</span>'}</td>
        <td data-label="성명">${h(r.driverName) || '<span class="muted">-</span>'}</td>
        <td class="tnum" style="text-align:right" data-label="⑤주행 전">${comma(r.odoBefore)}</td>
        <td class="tnum" style="text-align:right" data-label="⑥주행 후">${comma(r.odoAfter)}</td>
        <td class="tnum" style="text-align:right" data-label="⑦주행거리"><strong>${comma(r.distance)}</strong></td>
        <td data-label="⑧출발지">${h(r.fromPlace) || '<span class="muted">-</span>'}</td>
        <td data-label="⑨도착지">${h(r.toPlace) || '<span class="muted">-</span>'}</td>
        <td data-label="⑩비고">${h(r.note) || '<span class="muted">-</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-secondary" data-act="edit" data-id="${h(r.id)}" type="button">수정</button>
          <button class="btn btn-secondary" data-act="del" data-id="${h(r.id)}" type="button">삭제</button>
        </td>
      </tr>`;
  }

  function bodyHtml() {
    const list = visibleRows();
    if (!list.length) {
      return `<div class="empty">${month
        ? `${h(month)} 에 적힌 운행 기록이 없습니다.`
        : '운행 기록이 없습니다. [＋ 운행 기록]으로 오늘 운행을 적으세요.'}</div>`;
    }
    return `
      <table class="table table--touch">
        <thead>
          <tr>
            <th>③사용일자 (요일)</th>
            <th>④부서</th>
            <th>성명</th>
            <th style="text-align:right">⑤주행 전(㎞)</th>
            <th style="text-align:right">⑥주행 후(㎞)</th>
            <th style="text-align:right">⑦주행거리(㎞)</th>
            <th>⑧출발지</th>
            <th>⑨도착지</th>
            <th>⑩비고</th>
            <th style="text-align:right">기록</th>
          </tr>
        </thead>
        <tbody>${list.map(logRow).join('')}</tbody>
      </table>`;
  }

  function render() {
    const list = visibleRows();
    const total = list.reduce((sum, r) => sum + (Number(r.distance) || 0), 0);

    view.innerHTML = `
      <div id="pageRoot">
        <div class="page-head">
          <h1 class="page-head__title">차량 운행 일지</h1>
          <span class="page-head__spacer"></span>
          ${current ? `
            ${sheetMode ? `
              <button class="btn btn-secondary" data-act="sheet-refresh" type="button">시트에서 받기</button>` : ''}
            <button class="btn btn-secondary" data-act="manage-options" type="button">항목 관리</button>
            <button class="btn btn-primary" data-act="add" type="button">＋ 운행 기록</button>` : ''}
        </div>

        <div class="veh-tabs">
          ${vehicles.map((v) => `
            <button class="veh-tab ${v.name === current ? 'is-active' : ''}" data-act="vehicle"
                    data-name="${h(v.name)}" type="button">${h(v.name)}</button>`).join('')}
          <button class="veh-tab veh-tab--manage" data-act="go-vehicles"
                  type="button">＋ 차량</button>
        </div>

        ${current ? `
          <div class="panel" style="margin-bottom:var(--space-3)">
            <div class="row row--between" style="align-items:flex-start">
              <div>
                <h2 class="panel__title" style="margin:0 0 6px">${h(current)}</h2>
                <p class="muted" style="margin:0;line-height:1.7">
                  ①차종 <strong>${h(info.model) || '<span class="muted">미등록</span>'}</strong> ·
                  ②자동차등록번호 <strong>${h(info.plate) || '<span class="muted">미등록</span>'}</strong><br />
                  법인명 ${h(COMPANY.name)} · 사업자등록번호 ${h(COMPANY.bizNo)}
                </p>
              </div>
              <button class="btn btn-secondary" data-act="edit-vehicle" type="button">차량 정보 수정</button>
            </div>
          </div>

          <div class="toolbar" style="margin-bottom:var(--space-3)">
            <label class="muted" for="drvMonth" style="font-size:.9rem">월</label>
            <select class="select" id="drvMonth" style="max-width:200px">
              <option value="">전체</option>
              ${months().map((m) => `
                <option value="${h(m)}" ${m === month ? 'selected' : ''}>${h(m)}</option>`).join('')}
            </select>
            <span class="page-head__spacer"></span>
            <span class="tag tag-neutral">기록 ${list.length}건 · 합계 ${km(total)}</span>
          </div>

          <div class="scroll" id="drvBody">${bodyHtml()}</div>`
        : `<div class="empty">
             등록된 차량이 없습니다.<br />
             <button class="btn btn-primary" data-act="go-vehicles" type="button"
                     style="margin-top:14px">＋ 차량 추가하기</button>
           </div>`}
      </div>`;

    $('#pageRoot').addEventListener('click', onClick);
    const picker = $('#drvMonth');
    if (picker) {
      picker.addEventListener('change', () => { month = picker.value; render(); });
    }
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'vehicle') {
      current = btn.dataset.name;
      month = '';
      await reload();
      return;
    }
    // 차량은 재고 화면에서 만들고 지운다 — 한 곳에서만 관리한다.
    if (act === 'go-vehicles') { location.hash = '#/inventory'; return; }
    if (act === 'add') { openEditor(null); return; }
    if (act === 'edit') { openEditor(rows.find((r) => r.id === id)); return; }
    if (act === 'manage-options') { openOptionManager(); return; }
    if (act === 'edit-vehicle') { openVehicleInfo(); return; }

    if (act === 'sheet-refresh') {
      btn.disabled = true;
      btn.textContent = '받는 중…';
      try {
        await api.pullDriving(current);
        await reload();
        toast('시트에서 운행 일지를 받았습니다.', 'ok');
      } catch (err) {
        toast(err.message, 'err');
        render();
      }
      return;
    }

    if (act === 'del') {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      const ok = await confirmDialog('운행 기록 삭제',
        `${row.date} · ${row.fromPlace || '-'} → ${row.toPlace || '-'} (${comma(row.distance)}㎞) 기록을 지웁니다.`,
        '삭제', true);
      if (!ok) return;
      try {
        await api.deleteDriving(id);
        toast('지웠습니다.', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'err'); }
    }
  }

  // ------------------------------------------------------ 운행 기록 쓰기

  /**
   * 출발지 · 도착지.
   *
   * 아래 태그를 누르면 바로 들어가므로 **고르는 목록(datalist)은 두지 않는다.**
   * 같은 것을 두 가지 방법으로 고르게 하면 칸을 눌렀을 때 목록이 덮어써서
   * 아래 태그가 가린다. 없는 곳은 그냥 칸에 치면 된다.
   */
  function placeField(which, label, value) {
    return `
      <div class="field">
        <label>${label}</label>
        <input class="input" id="${which}" value="${h(value)}"
               placeholder="아래에서 누르거나 직접 적으세요" autocomplete="off" />
        ${options.places.length ? `
          <div class="tag-list" style="margin-top:8px">
            ${options.places.map((p) => `
              <button class="tag tag-neutral" data-place="${which}" data-name="${h(p)}"
                      type="button">${h(p)}</button>`).join('')}
          </div>` : ''}
      </div>`;
  }

  function openEditor(row) {
    const isNew = !row;
    // ③사용일자 — 오늘. 지난 날짜를 적어야 하면 칸에서 바꾸면 된다.
    const date = row ? row.date : store.today();
    const before = row ? row.odoBefore : (lastOdo === null ? '' : lastOdo);
    // 부서는 사람마다 거의 늘 같다 — 지난번에 고른 것을 미리 골라 둔다.
    const lastDept = (rows.find((r) => r.dept) || {}).dept || '';
    const dept = row ? row.dept : lastDept;
    const body = openSheet(isNew ? '운행 기록 추가' : '운행 기록 수정', `
      <form id="drvForm">
        <div class="grid-2">
          <div class="field">
            <label>③사용일자<span class="req">*</span>
              <strong id="drvWeekday">(${h(store.weekdayOf(date))})</strong></label>
            <input class="input" id="drvDate" type="date" value="${h(date)}" />
          </div>
          <div class="field">
            <label>④부서</label>
            <select class="select" id="drvDept">
              <option value="">선택 안 함</option>
              ${options.depts.map((d) => `
                <option value="${h(d)}" ${dept === d ? 'selected' : ''}>${h(d)}</option>`).join('')}
              ${dept && !options.depts.includes(dept)
                ? `<option value="${h(dept)}" selected>${h(dept)}</option>` : ''}
            </select>
          </div>
        </div>

        <div class="field">
          <label>성명</label>
          <input class="input" id="drvName" value="${h(row ? row.driverName : (deviceName() || ''))}"
                 placeholder="예) 홍길동" />
        </div>

        <div class="grid-2">
          <div class="field">
            <label>⑤주행 전 계기판의 거리(㎞)<span class="req">*</span></label>
            <input class="input tnum" id="drvBefore" inputmode="numeric" autocomplete="off"
                   value="${comma(before)}" placeholder="15,000" />
          </div>
          <div class="field">
            <label>⑥주행 후 계기판의 거리(㎞)<span class="req">*</span></label>
            <input class="input tnum" id="drvAfter" inputmode="numeric" autocomplete="off"
                   value="${comma(row ? row.odoAfter : '')}" placeholder="15,300" />
          </div>
        </div>

        <div class="field">
          <label>⑦주행거리(㎞)</label>
          <input class="input tnum" id="drvDistance" value="${comma(row ? row.distance : '')}"
                 readonly aria-readonly="true" />
        </div>

        <div class="grid-2">
          ${placeField('drvFrom', '⑧출발지', row ? row.fromPlace : '')}
          ${placeField('drvTo', '⑨도착지', row ? row.toPlace : '')}
        </div>

        <div class="field">
          <label>⑩비고</label>
          <input class="input" id="drvNote" value="${h(row ? row.note : '')}" placeholder="예) 고객사 방문" />
        </div>

        <div class="row" style="margin-top:6px">
          <button class="btn btn-primary" type="submit">${isNew ? '기록 추가' : '수정 저장'}</button>
          <button class="btn btn-secondary" data-act="close" type="button">취소</button>
        </div>
      </form>`);

    const dateBox = $('#drvDate', body);
    const beforeBox = $('#drvBefore', body);
    const afterBox = $('#drvAfter', body);
    const distBox = $('#drvDistance', body);

    /** ⑦ = ⑥ − ⑤. 아직 덜 적었거나 거꾸로면 비워 둔다(틀린 값을 보이지 않는다). */
    const paintDistance = () => {
      const a = unComma(beforeBox.value);
      const b = unComma(afterBox.value);
      distBox.value = (a === null || b === null || b < a) ? '' : comma(b - a);
    };

    for (const box of [beforeBox, afterBox]) {
      box.addEventListener('input', () => { formatOdoInput(box); paintDistance(); });
    }
    dateBox.addEventListener('change', () => {
      $('#drvWeekday', body).textContent = `(${store.weekdayOf(dateBox.value)})`;
    });

    // 자주 가는 곳 태그 — 누르면 칸에 넣는다
    body.addEventListener('click', (ev) => {
      const tag = ev.target.closest('[data-place]');
      if (!tag) return;
      const field = $(`#${tag.dataset.place}`, body);
      if (field) { field.value = tag.dataset.name; field.focus(); }
    });

    $('#drvForm', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const payload = {
        vehicleName: current,
        date: dateBox.value,
        dept: $('#drvDept', body).value,
        driverName: $('#drvName', body).value,
        odoBefore: unComma(beforeBox.value),
        odoAfter: unComma(afterBox.value),
        fromPlace: $('#drvFrom', body).value,
        toPlace: $('#drvTo', body).value,
        note: $('#drvNote', body).value,
      };
      try {
        await api.saveDriving(payload, row ? row.id : null);
        closeModal();
        toast(isNew ? '운행 기록을 추가했습니다.' : '고쳤습니다.', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  // -------------------------------------------------------- 항목 관리

  function optionListHtml(kind, title, list, hint) {
    return `
      <div class="panel" style="margin-bottom:14px">
        <h2 class="panel__title">${title}</h2>
        <div class="rows">
          ${list.length ? list.map((name, i) => `
            <div class="row">
              <span class="row__code tnum">${i + 1}</span>
              <span class="row__main"><span class="row__title">${h(name)}</span></span>
              <span class="order-btns">
                <button class="btn btn-secondary" data-oact="edit" data-kind="${kind}"
                        data-name="${h(name)}" type="button">수정</button>
                <button class="btn btn-secondary" data-oact="del" data-kind="${kind}"
                        data-name="${h(name)}" type="button">삭제</button>
              </span>
            </div>`).join('')
            : '<div class="empty">아직 없습니다. 아래에서 추가하세요.</div>'}
        </div>
        <form class="toolbar" data-add="${kind}" style="margin-top:12px">
          <input class="input" data-new="${kind}" style="flex:1" placeholder="${hint}" />
          <button class="btn btn-primary" type="submit">추가</button>
        </form>
      </div>`;
  }

  function optionManagerHtml() {
    return `
      ${optionListHtml('depts', '④부서', options.depts, '예) BS')}
      ${optionListHtml('places', '⑧출발지 · ⑨도착지', options.places, '예) 언주사무실')}
      `;
  }

  function openOptionManager() {
    const body = openSheet('운행일지 항목 관리', optionManagerHtml());

    /**
     * 목록을 다시 그린다.
     *
     * 확인 창·이름 고치기 창은 **같은 자리(#modalRoot)** 를 쓴다. 그래서 한 번
     * 뜨고 나면 관리 창이 통째로 사라진다 — 그대로 두면 한 개 지울 때마다
     * 창이 닫혀 다시 열어야 했다. 사라졌으면 여기서 다시 연다.
     */
    const repaint = () => {
      const box = document.getElementById('sheetBody');
      if (box) box.innerHTML = optionManagerHtml();
      else openOptionManager();
    };
    const save = async (next) => {
      options = await api.saveDrivingOptions(next);
      repaint();
    };

    body.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-oact]');
      if (!btn) return;
      const kind = btn.dataset.kind;
      const name = btn.dataset.name;
      const list = options[kind] || [];

      if (btn.dataset.oact === 'del') {
        const ok = await confirmDialog('항목 삭제',
          `"${name}" 을(를) 목록에서 지웁니다. 이미 적어 둔 운행 기록은 그대로 남습니다.`,
          '삭제', true);
        if (!ok) return;
        await save({ ...options, [kind]: list.filter((x) => x !== name) });
        toast('지웠습니다.', 'ok');
        return;
      }
      if (btn.dataset.oact === 'edit') {
        const { promptDialog } = await import('../ui.js');
        const next = await promptDialog('항목 수정', { label: '이름', value: name });
        const clean = (next || '').trim();
        if (!clean || clean === name) return;
        await save({ ...options,
          [kind]: list.map((x) => (x === name ? clean : x)) });
        toast('고쳤습니다.', 'ok');
      }
    });

    body.addEventListener('submit', async (ev) => {
      const form = ev.target.closest('[data-add]');
      if (!form) return;
      ev.preventDefault();
      const kind = form.dataset.add;
      const box = form.querySelector(`[data-new="${kind}"]`);
      const name = box.value.trim();
      if (!name) { toast('이름을 적어 주세요.', 'err'); box.focus(); return; }
      if ((options[kind] || []).includes(name)) {
        toast('이미 있는 항목입니다.', 'err');
        return;
      }
      await save({ ...options, [kind]: [...(options[kind] || []), name] });
      toast(`'${name}' 을(를) 추가했습니다.`, 'ok');
    });
  }

  // ------------------------------------------------- ①차종 ②자동차등록번호

  function openVehicleInfo() {
    const body = openSheet(`${current} 차량 정보`, `
      <form id="vinfoForm">
        <div class="field">
          <label>①차종</label>
          <input class="input" id="vinfoModel" value="${h(info.model)}" placeholder="예) 현대 스타리아 3밴" />
        </div>
        <div class="field">
          <label>②자동차등록번호</label>
          <input class="input" id="vinfoPlate" value="${h(info.plate)}" placeholder="예) 845누5868" />
        </div>
        <div class="row" style="margin-top:6px">
          <button class="btn btn-primary" type="submit">저장</button>
          <button class="btn btn-secondary" data-act="close" type="button">취소</button>
        </div>
      </form>`);

    $('#vinfoForm', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api.saveVehicleInfo(current, {
          model: $('#vinfoModel', body).value,
          plate: $('#vinfoPlate', body).value,
        });
        closeModal();
        toast('차량 정보를 저장했습니다.', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  await reload();

  // 받아오는 일은 **사람이 누를 때만** 한다 ([시트에서 받기]).
  // 뒤에서 받아 와 다시 그리면, 기록을 적던 중에 창이 통째로 새로 그려진다.
}
