// 차량 운행 일지 ↔ 구글 스프레드시트.
//
// 차량마다 탭이 하나씩 생긴다 — [운행일지 스타리아 1호차] 처럼.
// 그 탭은 국세청 '법인 차량 운행 일지' 서식 그대로라, 연말에 그 탭만 인쇄해
// 내면 된다. 그래서 차량별로 나눈다 (한 탭에 몰아 두면 차량마다 다시 갈라야 한다).
//
// 부서 · 출발/도착지 선택지는 **팀 공통**이라 [운행일지 항목] 탭 한 곳에 둔다.
import * as idb from './local/idb.js';
import * as store from './local/store.js';
import { callAppsScript } from './sheets.js';

export const isEnabled = () => store.sheetInventoryOn();

/**
 * 한 차량의 일지를 시트에 올린다.
 *
 * `changes` 가 있으면 시트 것과 합친다 — 내가 안 건드린 줄은 시트에 있는 그대로
 * 두고 내가 만든·고친·지운 줄만 얹는다. 없으면 마지막에 올린 사람의 기기 내용이
 * 다른 사람이 적은 운행 기록을 통째로 지운다.
 */
export async function pushDriving(vehicleName, changes = null) {
  const name = String(vehicleName || '').trim();
  if (!name) return null;
  const rows = await mergeWithSheet(name, await store.listDriving(name), changes);
  const info = await store.vehicleInfo(name);
  return callAppsScript({
    driving: 'push',
    vehicleName: name,
    info,
    rows: rows.map(rowOut),
  }, 60000);
}

const rowOut = (r) => ({
  id: r.id,
  date: r.date,
  weekday: r.weekday || '',
  dept: r.dept || '',
  driverName: r.driverName || '',
  odoBefore: r.odoBefore,
  odoAfter: r.odoAfter,
  distance: r.distance,
  fromPlace: r.fromPlace || '',
  toPlace: r.toPlace || '',
  note: r.note || '',
});

async function mergeWithSheet(vehicleName, local, changes) {
  if (!changes || !changes.length) return local;
  let sheet;
  try {
    const res = await callAppsScript({ driving: 'pull', vehicleName }, 60000);
    sheet = (res && res.rows) || [];
  } catch { return local; }
  if (!sheet.length) return local;

  const mine = new Map(local.map((r) => [r.id, r]));
  const touched = new Set(changes.map((c) => c.id));
  const out = [];
  const seen = new Set();
  for (const row of sheet) {
    if (row.id && seen.has(row.id)) continue;
    if (row.id) seen.add(row.id);
    if (row.id && touched.has(row.id)) {
      // 내가 건드린 줄 — 지웠으면 여기서 빠지고, 고쳤으면 내 것이 들어간다.
      if (mine.has(row.id)) out.push(mine.get(row.id));
      continue;
    }
    out.push(row.id && mine.has(row.id) ? mine.get(row.id) : row);
  }
  for (const r of local) {
    if (touched.has(r.id) && !seen.has(r.id)) out.push(r);
  }
  return out;
}

/** 부서 · 장소 선택지를 시트에 올린다. */
export async function pushOptions(options) {
  const value = options || await store.drivingOptions();
  return callAppsScript({
    driving: 'options',
    depts: value.depts || [],
    places: value.places || [],
  }, 60000);
}

/**
 * 시트의 일지를 기기에 반영한다.
 *
 * 안전 규칙은 리포트 항목과 같다.
 *  1. 아직 못 올린 내 변경이 있으면 **받지 않는다** — 덮으면 방금 적은 것이 사라진다.
 *  2. 시트가 비어 있으면 **아무것도 지우지 않는다** — 아직 아무도 안 올렸다는 뜻이지
 *     일지를 전부 지우라는 뜻이 아니다.
 *
 * 반환: { changed, added, removed }
 */
export async function pullDriving(vehicleName = null) {
  const queued = (await store.outbox()).some(
    (op) => op.type === 'drivesheet-push' || op.type === 'drivesheet-options');
  if (queued) return { changed: 0, added: 0, removed: 0, skipped: 'pending' };

  const body = { driving: 'pull' };
  if (vehicleName) body.vehicleName = vehicleName;
  const result = await callAppsScript(body, 60000);

  let changed = 0;
  let added = 0;
  let removed = 0;

  // 선택지 — 시트가 원본이다. 비어 있으면 손대지 않는다.
  const opts = result.options || {};
  if ((opts.depts || []).length || (opts.places || []).length) {
    const mine = await store.drivingOptions();
    const same = (a, b) => (a || []).join('|') === (b || []).join('|');
    if (!same(mine.depts, opts.depts) || !same(mine.places, opts.places)) {
      await store.setMeta('drivingOptions',
        { depts: opts.depts || [], places: opts.places || [] });
      changed += 1;
    }
  }

  // 차량 머리(①차종 ②등록번호)
  const infos = result.info || {};
  if (Object.keys(infos).length) {
    const all = await store.vehicleInfoAll();
    let touched = false;
    for (const [name, info] of Object.entries(infos)) {
      const before = all[name] || {};
      if ((before.model || '') !== (info.model || '')
          || (before.plate || '') !== (info.plate || '')) {
        all[name] = { model: info.model || '', plate: info.plate || '' };
        touched = true;
      }
    }
    if (touched) { await store.setMeta('vehicleInfo', all); changed += 1; }
  }

  const rows = result.rows || [];
  // 받은 범위 안에서만 견준다. 한 차량만 받아 놓고 다른 차량 기록을
  // "시트에 없다" 며 지우면 안 된다.
  const scope = vehicleName ? [vehicleName] : [...new Set(rows.map((r) => r.vehicleName))];
  if (!rows.length && !vehicleName) return { changed, added, removed };

  const local = (await idb.getAll('driving'))
    .filter((r) => scope.includes(r.vehicleName));
  const byId = new Map(local.map((r) => [r.id, r]));
  const seen = new Set();
  const stamp = store.now();

  for (const row of rows) {
    const id = String(row.id || '').trim();
    const found = id ? byId.get(id) : null;
    const next = {
      id: found ? found.id : (id || store.newId()),
      vehicleName: row.vehicleName || vehicleName,
      date: row.date,
      weekday: row.weekday || store.weekdayOf(row.date),
      dept: row.dept || '',
      driverName: row.driverName || '',
      odoBefore: Number(row.odoBefore) || 0,
      odoAfter: Number(row.odoAfter) || 0,
      distance: Number(row.distance) || 0,
      fromPlace: row.fromPlace || '',
      toPlace: row.toPlace || '',
      note: row.note || '',
      createdAt: found ? found.createdAt : stamp,
      updatedAt: stamp,
    };
    seen.add(next.id);
    if (!found) { await idb.put('driving', next); added += 1; continue; }
    const same = ['date', 'dept', 'driverName', 'odoBefore', 'odoAfter',
                  'distance', 'fromPlace', 'toPlace', 'note']
      .every((k) => String(found[k] || '') === String(next[k] || ''));
    if (!same) { await idb.put('driving', next); changed += 1; }
  }

  for (const r of local) {
    if (!seen.has(r.id)) { await idb.remove('driving', r.id); removed += 1; }
  }
  return { changed, added, removed };
}
