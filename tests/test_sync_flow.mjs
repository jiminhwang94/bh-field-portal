/**
 * 올리기·받기를 **실제 앱 코드로** 돌려 본다 — 지운 것이 되살아나지 않는가.
 *
 * "[새로고침] 을 누르면 지운 것이 다시 생긴다" 는 문제가 여러 갈래에서 나왔다.
 *   - 올리기가 실패하거나 받기와 겹치면, 받기가 옛 시트로 기기를 덮어 지운 품목이
 *     되살아났고, 다음 올리기가 그것을 다시 시트로 올렸다.
 *   - 시트에서 처음 받은 가이드에 기기가 새 ID 를 붙여, 그 기기에서 지워도 시트
 *     줄이 남았다.
 *   - 구조 변경을 올릴 때 안 건드린 줄까지 기기 값으로 덮어, 남이 바꾼 수량이
 *     옛 값으로 돌아갔다.
 *
 * 기기 안 저장소(IndexedDB)와 시트(Apps Script)만 가짜로 바꾸고 나머지는 그대로
 * 쓴다. 기기 두 대(A·B)가 같은 시트를 쓴다.
 * 실행: node tests/test_sync_flow.mjs
 */
import { registerHooks } from 'node:module';

const failures = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

// ─────────────────────────────────────────── 가짜 기기 저장소 · 시트 연결

const FAKE_IDB = `
const KEYS = { guides: 'id', vehicles: 'name', inventory: 'id', quantities: 'key',
  fields: 'id', driving: 'id', reports: 'id', media: 'filename', outbox: 'id', meta: 'key' };
const dbs = new Map();
let seq = 1;
const st = (name) => {
  const dev = globalThis.__device;
  if (!dbs.has(dev)) dbs.set(dev, {});
  const db = dbs.get(dev);
  return db[name] || (db[name] = new Map());
};
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
export const STORES = KEYS;
export const openDb = async () => null;
export const run = () => { throw new Error('테스트에서는 쓰지 않습니다'); };
export async function get(s, k) { return clone(st(s).get(k)); }
export async function getAll(s, index = null, query = null) {
  const rows = [...st(s).values()].map(clone);
  return index ? rows.filter((r) => r[index] === query) : rows;
}
export async function put(s, v) {
  v = clone(v);
  if (s === 'outbox' && v.id == null) v.id = seq++;
  st(s).set(v[KEYS[s]], v);
  return v[KEYS[s]];
}
export async function putAll(s, vs) { for (const v of vs) await put(s, v); }
export async function remove(s, k) { st(s).delete(k); }
export async function clear(...ss) { for (const s of ss) st(s).clear(); }
export async function replaceStores(payload) {
  for (const [s, rows] of Object.entries(payload)) { st(s).clear(); for (const r of rows) await put(s, r); }
}
export async function count(s) { return st(s).size; }
`;

const FAKE_SHEETS = `
export const STATUS_HEADER = '상태';
export const STATUS_VALUES = ['조치 완료', '모니터링', '조치 진행 중', '교체 예정'];
export const DEFAULT_STATUS = '조치 진행 중';
export const callAppsScript = (payload) => globalThis.__server(payload);
export const uploadReport = (report) => globalThis.__server({ upload: report });
`;

registerHooks({
  load(url, context, next) {
    if (url.endsWith('/web/js/local/idb.js')) return { format: 'module', source: FAKE_IDB, shortCircuit: true };
    if (url.endsWith('/web/js/sheets.js')) return { format: 'module', source: FAKE_SHEETS, shortCircuit: true };
    return next(url, context);
  },
});

// 브라우저가 주는 것 중 앱이 쓰는 최소한
const storages = new Map();
globalThis.localStorage = {
  getItem: (k) => (storages.get(globalThis.__device) || new Map()).get(k) ?? null,
  setItem: (k, v) => {
    if (!storages.has(globalThis.__device)) storages.set(globalThis.__device, new Map());
    storages.get(globalThis.__device).set(k, String(v));
  },
  removeItem: (k) => (storages.get(globalThis.__device) || new Map()).delete(k),
};
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

// ─────────────────────────────────────────── 가짜 시트 (Apps Script 와 같은 규칙)

const sheet = { inv: null, guides: [], fields: [], uploads: [] };
let failNext = 0;            // 다음 N 번 부르기를 실패시킨다 (현장 LTE 끊김)
let calls = 0;
const later = () => new Promise((r) => setTimeout(r, 5));

/** 품목은 차량 공용 — 빈 칸은 0 으로 읽힌다 (readInventory 와 같다). */
function readInv() {
  if (!sheet.inv) return { ok: true, exists: false, vehicles: [], items: [] };
  const items = [];
  for (const p of sheet.inv.parts) {
    for (const v of sheet.inv.vehicles) {
      items.push({ vehicleName: v, partName: p.name, category: p.category,
                   quantity: p.qty[v] || 0, minQuantity: p.min });
    }
  }
  return { ok: true, exists: true, vehicles: [...sheet.inv.vehicles], items };
}

function writeInv(vehicles, items) {
  const parts = [];
  for (const i of items) {
    let p = parts.find((x) => x.name === i.partName);
    if (!p) parts.push(p = { name: i.partName, category: i.category || '', min: i.minQuantity || 0, qty: {} });
    p.qty[i.vehicleName] = i.quantity || 0;
  }
  const vs = [...vehicles];
  for (const i of items) if (!vs.includes(i.vehicleName)) vs.push(i.vehicleName);
  sheet.inv = { vehicles: vs, parts };
}

globalThis.__server = async (body) => {
  calls += 1;
  await later();
  if (failNext > 0) { failNext -= 1; throw new Error('네트워크 끊김'); }
  const out = structuredClone(await serve(body));
  await later();
  return out;
};

async function serve(body) {
  if (body.inventory === 'pull') return readInv();
  if (body.inventory === 'push') { writeInv(body.vehicles, body.items); return readInv(); }
  if (body.inventory === 'qty') {
    for (const op of body.ops) {
      if (op.type === 'quantity-delete') continue;
      // 시트에 없는 품목·차량은 다른 기기가 지운 것이다 — 되살리지 않는다.
      const p = sheet.inv && sheet.inv.parts.find((x) => x.name === op.partName);
      if (!p || !sheet.inv.vehicles.includes(op.vehicleName)) continue;
      p.qty[op.vehicleName] = op.quantity;
    }
    return readInv();
  }
  if (body.guides === 'pull') return { ok: true, items: sheet.guides };
  if (body.guides === 'push') {
    sheet.guides = body.items.map((g) => ({ ...g, id: g.id || '' }));
    return { ok: true };
  }
  if (body.fields === 'pull') return { ok: true, items: sheet.fields };
  if (body.fields === 'push') { sheet.fields = body.items; return { ok: true }; }
  if (body.upload) { sheet.uploads.push(body.upload.id); return { ok: true }; }
  throw new Error(`가짜 시트가 모르는 요청: ${JSON.stringify(body).slice(0, 80)}`);
}

// ─────────────────────────────────────────────────────────── 앱 코드

const WEB = new URL('../web/js/', import.meta.url);
const store = await import(new URL('local/store.js', WEB));
const sync = await import(new URL('sync.js', WEB));
const invsheet = await import(new URL('invsheet.js', WEB));
const guidesheet = await import(new URL('guidesheet.js', WEB));

// 장면마다 새 기기를 쓴다 (앞 장면의 기기 안 자료가 섞이지 않게).
let round = 0;
const on = (dev) => { globalThis.__device = `${dev}${round}`; };
const parts = async () => [...new Set((await store.listInventory()).map((i) => i.partName))].sort();
const sheetParts = () => (sheet.inv ? sheet.inv.parts.map((p) => p.name).sort() : []);
const qtyOf = async (v, p) => {
  const row = (await store.listInventory(v)).find((i) => i.partName === p);
  return row ? row.quantity : null;
};
const itemId = async (v, p) => (await store.listInventory(v)).find((i) => i.partName === p).id;
const flush = () => sync.flushOutbox();

/** 기기 A 에서 차량 2대 · 부품 2개를 만들어 올리고, B 가 받는다. */
async function freshTeam() {
  round += 1;
  sheet.inv = null; sheet.guides = []; failNext = 0;
  on('A');
  await store.addVehicle('1호차');
  await store.addVehicle('2호차');
  await store.addInventoryItem('1호차', '배터리', 3, 1);
  await store.addInventoryItem('1호차', '바퀴', 2, 0);
  await flush();
  on('B');
  await invsheet.pullInventory();
  on('A');
}

console.log('\n[1] 올리기가 실패한 뒤 [새로고침] 해도 지운 품목이 되살아나지 않는다');
{
  await freshTeam();
  on('A');
  await store.deleteInventoryItem(await itemId('1호차', '배터리'));
  failNext = 1;                                   // 올리기 첫 부르기가 끊긴다
  const r = await flush();
  check('올리기 실패가 보고된다', r.failed.length === 1, r.failed.join(' / '));
  await invsheet.pullInventory();                 // [새로고침] 의 받기 단계
  check('받기 뒤에도 기기에서 지운 품목이 없다', !(await parts()).includes('배터리'),
        (await parts()).join(','));
  await flush();                                  // 다음 새로고침 · 연결 회복
  check('다시 올리면 시트에서도 빠진다', !sheetParts().includes('배터리'), sheetParts().join(','));
  check('대기열이 비었다', (await store.outboxCount()) === 0);
}

console.log('\n[2] 지운 직후 받기가 겹쳐도 지운 것이 되살아나지 않는다');
{
  await freshTeam();
  on('A');
  await store.deleteInventoryItem(await itemId('1호차', '바퀴'));
  await Promise.all([flush(), invsheet.pullInventory(), invsheet.pullInventory()]);
  check('기기에서 지운 품목이 없다', !(await parts()).includes('바퀴'), (await parts()).join(','));
  check('시트에서도 빠졌다', !sheetParts().includes('바퀴'), sheetParts().join(','));
  await invsheet.pullInventory();
  check('한 번 더 받아도 그대로다', !(await parts()).includes('바퀴'));
}

console.log('\n[3] 품목을 추가해 올려도 남이 바꾼 수량을 덮지 않는다');
{
  await freshTeam();
  on('B');
  await store.updateInventoryItem(await itemId('1호차', '배터리'), { quantity: 9 });
  await flush();
  check('B 의 수량이 시트에 올라갔다', sheet.inv.parts.find((p) => p.name === '배터리').qty['1호차'] === 9);
  on('A');                                       // A 는 아직 옛 값(3)을 들고 있다
  await store.addInventoryItem('1호차', '센서', 1, 0);
  await flush();
  check('A 가 구조를 올린 뒤에도 B 의 수량(9)이 남는다',
        sheet.inv.parts.find((p) => p.name === '배터리').qty['1호차'] === 9,
        String(sheet.inv.parts.find((p) => p.name === '배터리').qty['1호차']));
  check('A 가 만든 센서도 올라갔다', sheetParts().includes('센서'));
  check('A 기기에도 B 의 수량이 내려왔다', (await qtyOf('1호차', '배터리')) === 9);
}

console.log('\n[4] 다른 기기에서 지운 차량·품목을 내가 다시 올리지 않는다');
{
  await freshTeam();
  on('B');
  await store.deleteVehicle('2호차');
  await store.deleteInventoryItem(await itemId('1호차', '바퀴'));
  await flush();
  on('A');                                       // A 는 아직 2호차 · 바퀴를 들고 있다
  await store.addInventoryItem('1호차', '센서', 1, 0);
  await flush();
  check('지워진 2호차가 시트에 되살아나지 않는다', !sheet.inv.vehicles.includes('2호차'),
        sheet.inv.vehicles.join(','));
  check('지워진 바퀴가 시트에 되살아나지 않는다', !sheetParts().includes('바퀴'), sheetParts().join(','));
  check('A 기기에서도 빠졌다', !(await parts()).includes('바퀴')
        && !(await store.listVehicles()).includes('2호차'));
}

console.log('\n[5] 지워진 품목의 [+] 가 늦게 올라가도 품목이 되살아나지 않는다');
{
  await freshTeam();
  on('A');
  await store.updateInventoryItem(await itemId('1호차', '바퀴'), { delta: 1 });   // 아직 안 올림
  on('B');
  await store.deleteInventoryItem(await itemId('1호차', '바퀴'));
  await flush();
  on('A');
  await flush();
  check('시트에 바퀴가 다시 생기지 않는다', !sheetParts().includes('바퀴'), sheetParts().join(','));
  check('A 기기에서도 빠졌다', !(await parts()).includes('바퀴'), (await parts()).join(','));
}

console.log('\n[6] 시트를 못 읽으면 기기 내용을 통째로 올리지 않는다');
{
  await freshTeam();
  on('B');
  await store.deleteInventoryItem(await itemId('1호차', '바퀴'));
  await flush();
  on('A');
  await store.addInventoryItem('1호차', '센서', 1, 0);
  failNext = 1;                                  // 합치려고 시트를 읽는 순간 끊긴다
  await flush();
  check('끊긴 사이 지워진 바퀴가 시트에 되살아나지 않는다', !sheetParts().includes('바퀴'),
        sheetParts().join(','));
  check('내 변경은 대기열에 남아 있다', (await store.outboxCount()) > 0);
  await flush();
  check('다음 올리기에 센서가 올라간다', sheetParts().includes('센서') && !sheetParts().includes('바퀴'),
        sheetParts().join(','));
}

console.log('\n[7] 가이드 — 한 기기에서 지우면 다른 기기에서도 빠지고, 되살아나지 않는다');
{
  round += 1;
  sheet.guides = []; failNext = 0;
  on('A');
  const g = await store.saveGuide({ categoryType: 'ERROR_CODE', codeOrTitle: 'E-101', summary: '모터' });
  await store.saveGuide({ categoryType: 'ERROR_CODE', codeOrTitle: 'E-102', summary: '센서' });
  await store.saveGuide({ categoryType: 'ERROR_CODE', codeOrTitle: 'E-103', summary: '배터리' });
  await flush();
  on('B');
  await guidesheet.pullGuides();
  const onB = (await store.listGuides()).find((x) => x.codeOrTitle === 'E-101');
  check('B 가 받은 가이드는 시트와 같은 ID 를 쓴다', onB && onB.id === g.id);
  await store.deleteGuide(onB.id);
  await flush();
  check('B 에서 지우면 시트에서 빠진다', !sheet.guides.some((x) => x.codeOrTitle === 'E-101'));
  on('A');
  const got = await guidesheet.pullGuides();
  check('A 가 받으면 A 에서도 빠진다', !(await store.listGuides()).some((x) => x.codeOrTitle === 'E-101'),
        JSON.stringify(got));
  await store.saveGuide({ categoryType: 'ERROR_CODE', codeOrTitle: 'E-104', summary: '새것' });
  await flush();
  check('A 가 다른 가이드를 올려도 지운 것이 되살아나지 않는다',
        !sheet.guides.some((x) => x.codeOrTitle === 'E-101'));
}

console.log('\n[8] 가이드 — 예전 기기(다른 ID 로 들고 있음)에서 지워도 시트에서 빠진다');
{
  on('C');
  // 예전 버전은 시트에서 받은 가이드에 새 ID 를 붙였다 — 그 상태를 그대로 만든다.
  const row = sheet.guides.find((x) => x.codeOrTitle === 'E-102');
  const idb = { put: (await import(new URL('local/idb.js', WEB))).put };
  await idb.put('guides', { ...row, id: 'old-local-id', commands: [], steps: [],
                            createdAt: '2026-01-01T00:00:00' });
  await store.deleteGuide('old-local-id');
  await flush();
  check('시트 줄이 지워진다 (ID 가 달라도 제목으로 알아본다)',
        !sheet.guides.some((x) => x.codeOrTitle === 'E-102'),
        sheet.guides.map((x) => x.codeOrTitle).join(','));
}

console.log('\n[9] 가이드 — 남이 고친 가이드를 내 옛 모습으로 덮지 않는다');
{
  on('A');
  await guidesheet.pullGuides();
  on('B');
  await guidesheet.pullGuides();
  const g3 = (await store.listGuides()).find((x) => x.codeOrTitle === 'E-103');
  await store.saveGuide({ ...g3, summary: 'B 가 고침' }, g3.id);
  await flush();
  on('A');                                       // A 는 아직 옛 요약을 들고 있다
  await store.saveGuide({ categoryType: 'ERROR_CODE', codeOrTitle: 'E-105', summary: '또 새것' });
  await flush();
  const row = sheet.guides.find((x) => x.codeOrTitle === 'E-103');
  check('B 의 수정이 시트에 남는다', row && row.summary === 'B 가 고침', row && row.summary);
}

console.log('\n[10] 올리기를 동시에 여러 번 불러도 리포트는 한 번만 올라간다');
{
  on('A');
  sheet.uploads = [];
  const report = await store.saveReport({ values: [] });
  await store.enqueue({ type: 'sheet', reportId: report.id });
  await Promise.all([flush(), flush(), flush()]);
  check('리포트가 한 줄만 올라갔다', sheet.uploads.length === 1, `${sheet.uploads.length}줄`);
}

console.log('');
if (failures.length) {
  console.log(`❌ ${failures.length}건 실패`);
  process.exit(1);
}
console.log('✅ 전부 통과 — 지운 것은 지운 채로, 남이 바꾼 것은 바뀐 채로 남습니다.');
