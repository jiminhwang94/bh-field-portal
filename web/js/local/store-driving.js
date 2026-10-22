// 기기 저장소 — 차량 운행 일지 · 부서/장소 선택지 · 차량 정보.
// (store.js 가 전부 다시 내보낸다 — 밖에서는 store.js 만 부른다)
import * as idb from './idb.js';
import { testMode } from '../mode.js';
import { byText, enqueue, getMeta, newId, now, setMeta, sheetInventoryOn } from './store-core.js';

// ═══════════════════════════════════════════════════════════════════
// 차량 운행 일지 — 법인 차량 운행 일지(국세청 서식)의 항목을 그대로 쓴다.
//
//   ③사용일자 · ④사용자(부서 · 성명) · ⑤주행 전 계기판 거리 ·
//   ⑥주행 후 계기판 거리 · ⑦주행거리 · ⑧출발지 · ⑨도착지 · ⑩비고
//
// 차량마다 한 장씩이다. 시트에서도 차량마다 탭이 하나씩 생겨, 그 탭을 그대로
// 인쇄해 제출할 수 있다.
//
// ⑦주행거리는 **적지 않는다** — ⑥에서 ⑤를 뺀 값이다. 사람이 따로 적으면
// 계기판 숫자와 어긋난 장부가 남는다.
// ═══════════════════════════════════════════════════════════════════

/** 부서 · 장소 선택지. 팀 공통이라 시트에 함께 둔다. */
const DRIVING_OPTIONS_KEY = 'drivingOptions';
/** 차량마다의 ①차종 · ②자동차등록번호 (서식 머리에 들어간다). */
const VEHICLE_INFO_KEY = 'vehicleInfo';

const DEFAULT_DEPTS = ['BS', '연구소', '경영지원'];

/** 오늘 날짜를 'YYYY-MM-DD' 로. 기기의 시간대를 그대로 쓴다. */
export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → '월'. 서식의 (요일) 칸이다. */
export function weekdayOf(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').trim());
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return WEEKDAYS[d.getDay()] || '';
}

/**
 * 계기판 숫자로 쓸 수 있는 값인가. **빈 칸은 아니다.**
 *
 * 빈 칸을 그냥 Number() 에 넣으면 0 이 된다. 그러면 "넣어 주세요" 가 뜨지 않고
 * 0㎞ 짜리 기록이 조용히 저장됐다 — 브라우저에서 실제로 그렇게 잡혔다.
 */
const odoNumber = (value) => {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/[^0-9.-]/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

const drivingOut = (r) => ({
  id: r.id,
  vehicleName: r.vehicleName,
  date: r.date,
  weekday: r.weekday || weekdayOf(r.date),
  dept: r.dept || '',
  driverName: r.driverName || '',
  odoBefore: r.odoBefore,
  odoAfter: r.odoAfter,
  distance: r.distance,
  fromPlace: r.fromPlace || '',
  toPlace: r.toPlace || '',
  note: r.note || '',
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

async function queueDriveSheetPushIfOn(vehicleName, changes = []) {
  if (await sheetInventoryOn()) {
    await enqueue({ type: 'drivesheet-push', vehicleName, changes });
  }
}

/** 한 차량의 운행 기록. 최근 것이 위로 온다. */
export async function listDriving(vehicleName = null) {
  const rows = await idb.getAll('driving');
  const picked = vehicleName
    ? rows.filter((r) => r.vehicleName === vehicleName)
    : rows;
  picked.sort((a, b) => byText(b.date, a.date)
    || byText(b.createdAt || '', a.createdAt || ''));
  return picked.map(drivingOut);
}

/**
 * 이 차량의 **마지막 주행 후 계기판 거리.**
 *
 * 다음 기록의 ⑤주행 전에 미리 채워 넣는다. 계기판 숫자는 이어져야 하는데,
 * 사람이 매번 차에 가서 보고 옮겨 적으면 한 자리씩 틀린 장부가 쌓인다.
 */
export async function lastOdometer(vehicleName) {
  const rows = (await idb.getAll('driving'))
    .filter((r) => r.vehicleName === vehicleName && odoNumber(r.odoAfter) !== null);
  if (!rows.length) return null;
  rows.sort((a, b) => byText(a.date, b.date)
    || byText(a.createdAt || '', b.createdAt || ''));
  return odoNumber(rows[rows.length - 1].odoAfter);
}

export async function saveDriving(payload, drivingId = null) {
  const vehicleName = (payload.vehicleName || '').trim();
  if (!vehicleName) throw new Error('차량을 먼저 고르세요.');
  const date = (payload.date || '').trim() || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('사용일자가 올바르지 않습니다.');

  const odoBefore = odoNumber(payload.odoBefore);
  const odoAfter = odoNumber(payload.odoAfter);
  if (odoBefore === null) throw new Error('주행 전 계기판 거리를 넣어 주세요.');
  if (odoAfter === null) throw new Error('주행 후 계기판 거리를 넣어 주세요.');
  if (odoAfter < odoBefore) {
    // 계기판은 뒤로 가지 않는다. 두 칸을 바꿔 넣은 경우가 대부분이다.
    throw new Error('주행 후 거리가 주행 전보다 작습니다. 두 칸이 바뀌지 않았는지 보세요.');
  }

  const existing = drivingId ? await idb.get('driving', drivingId) : null;
  if (drivingId && !existing) throw new Error('운행 기록을 찾을 수 없습니다.');
  const stamp = now();
  const row = {
    id: drivingId || newId(),
    vehicleName,
    date,
    weekday: weekdayOf(date),
    dept: (payload.dept || '').trim(),
    driverName: (payload.driverName || '').trim(),
    odoBefore,
    odoAfter,
    distance: odoAfter - odoBefore,      // ⑦ 은 늘 ⑥ − ⑤ 다
    fromPlace: (payload.fromPlace || '').trim(),
    toPlace: (payload.toPlace || '').trim(),
    note: (payload.note || '').trim(),
    createdAt: existing ? existing.createdAt : stamp,
    updatedAt: stamp,
  };
  await idb.put('driving', row);
  await queueDriveSheetPushIfOn(vehicleName,
    [{ kind: 'driving', id: row.id, before: existing || null }]);
  return drivingOut(row);
}

export async function deleteDriving(id) {
  const existing = await idb.get('driving', id);
  if (!existing) return false;
  await idb.remove('driving', id);
  await queueDriveSheetPushIfOn(existing.vehicleName,
    [{ kind: 'driving', id, before: existing }]);
  return true;
}

// ------------------------------------------------- 부서 · 장소 선택지

const cleanList = (list) => {
  const out = [];
  for (const raw of list || []) {
    const name = String(raw || '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
};

/** { depts, places } — 없으면 기본 부서만 들어 있다. */
export async function drivingOptions() {
  const saved = (await getMeta(DRIVING_OPTIONS_KEY, null)) || {};
  return {
    depts: cleanList(saved.depts || DEFAULT_DEPTS),
    places: cleanList(saved.places || []),
  };
}

export async function saveDrivingOptions(next) {
  const value = {
    depts: cleanList(next.depts),
    places: cleanList(next.places),
  };
  await setMeta(DRIVING_OPTIONS_KEY, value);
  if (await sheetInventoryOn()) {
    await enqueue({ type: 'drivesheet-options', ...value });
  }
  return value;
}

/**
 * 장소를 목록에 **슬그머니 넣는다.**
 *
 * 출발지·도착지는 직접 쳐 넣을 수도 있다. 그렇게 한 번 친 곳은 다음부터
 * 고를 수 있어야 한다 — 안 그러면 자주 가는 곳을 매번 다시 친다.
 */
export async function rememberPlaces(...names) {
  const options = await drivingOptions();
  const before = options.places.join('|');
  const places = cleanList([...options.places, ...names]);
  if (places.join('|') === before) return options;
  return saveDrivingOptions({ depts: options.depts, places });
}

// ------------------------------------------------- 차량 ①차종 ②등록번호

/** { '스타리아 1호차': { model, plate } } */
export async function vehicleInfoAll() {
  return (await getMeta(VEHICLE_INFO_KEY, {})) || {};
}

export async function vehicleInfo(name) {
  const all = await vehicleInfoAll();
  const found = all[name] || {};
  return { model: found.model || '', plate: found.plate || '' };
}

export async function saveVehicleInfo(name, info) {
  const all = await vehicleInfoAll();
  all[name] = {
    model: String(info.model || '').trim(),
    plate: String(info.plate || '').trim(),
  };
  await setMeta(VEHICLE_INFO_KEY, all);
  await queueDriveSheetPushIfOn(name, []);
  return all[name];
}
