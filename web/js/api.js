// 앱 데이터 창구 — **기기 안 데이터베이스**를 먼저 본다.
//
// v3.0 부터 모든 조회/생성/수정/삭제는 기기에서 끝나므로 오프라인에서도 전부 동작한다.
// 서버가 필요한 일(업데이트 동기화 · 시트 업로드)만 sync.js / sheets.js 로 넘긴다.
import * as store from './local/store.js';
import * as sync from './sync.js';
import { uploadReport, testConnection, extractSpreadsheetId,
         spreadsheetUrl, callAppsScript } from './sheets.js';

// 버전은 version.js 한 곳에 있다 (python tools/release.py 로 올린다)
export { APP_VERSION } from './version.js';
import { APP_VERSION } from './version.js';

export const api = {
  /** 앱 버전 정보. 기기 안에 있는 값만 쓴다 — 물어볼 서버가 없다. */
  async version() {
    return {
      version: APP_VERSION,
      buildHash: (await store.getMeta('buildHash', '')) || '-',
      siteUrl: sync.isPackagedApp() ? '앱으로 설치됨' : location.origin,
    };
  },

  // ------------------------------------------------------------------ 가이드
  listGuides: async (type, q) => ({ items: await store.listGuides(type || null, q || null) }),
  getGuide: (id) => store.getGuide(id),
  createGuide: async (payload) => {
    const guide = await store.saveGuide(payload);
    flushSoon();
    return guide;
  },
  updateGuide: async (id, payload) => {
    const guide = await store.saveGuide(payload, id);
    flushSoon();
    return guide;
  },
  deleteGuide: async (id) => {
    const ok = await store.deleteGuide(id);
    flushSoon();
    return ok;
  },

  // ------------------------------------------------------- 가이드 로봇 분류
  listGuideModels: () => store.listGuideModels(),
  addGuideModel: async (name) => {
    const added = await store.addGuideModel(name);
    flushSoon();
    return added;
  },
  renameGuideModel: async (oldName, nextName) => {
    const renamed = await store.renameGuideModel(oldName, nextName);
    flushSoon();
    return renamed;
  },
  assignGuideModel: async (ids, model) => {
    const result = await store.assignGuideModel(ids, model);
    flushSoon();
    return result;
  },
  deleteGuideModel: async (name) => {
    const result = await store.deleteGuideModel(name);
    flushSoon();
    return result;
  },

  // ------------------------------------------------------------------ 차량
  listVehicles: async () => {
    const names = await store.listVehicles();
    const items = await store.listInventory();
    return {
      items: names.map((name) => ({
        name,
        itemCount: items.filter((i) => i.vehicleName === name).length,
      })),
    };
  },
  addVehicle: async (name) => {
    const vehicle = await store.addVehicle(name);
    flushSoon();
    return vehicle;
  },
  deleteVehicle: async (name) => {
    const result = await store.deleteVehicle(name);
    flushSoon();
    return result;
  },

  // ------------------------------------------------------------------ 재고
  listInventory: async (vehicle) => ({
    vehicles: await store.listVehicles(),
    items: await store.listInventory(vehicle || null),
  }),
  addInventory: async (payload) => {
    const item = await store.addInventoryItem(
      payload.vehicleName, payload.partName, payload.quantity, payload.minQuantity,
      payload.category || '');
    flushSoon();
    return item;
  },
  patchInventory: async (id, payload) => {
    const item = await store.updateInventoryItem(id, payload);
    flushSoon();
    return item;
  },
  /** 품목 순서 — 손잡이로 끌어 놓은 결과. 차량 공용. */
  reorderInventory: async (order) => {
    const next = await store.reorderParts(order);
    flushSoon();
    return next;
  },
  deleteInventory: async (id) => {
    const ok = await store.deleteInventoryItem(id);
    flushSoon();
    return ok;
  },

  // ------------------------------------------------------- 리포트 항목 설정
  listFields: async () => ({ items: await store.listFields() }),
  createField: (payload) => store.saveField(payload),
  updateField: (id, payload) => store.saveField(payload, id),
  deleteField: (id) => store.deleteField(id),
  reorderFields: async (ids) => ({ items: await store.reorderFields(ids) }),

  // ------------------------------------------------------- 차량 운행 일지
  listDriving: async (vehicle) => ({
    vehicles: await store.listVehicles(),
    items: await store.listDriving(vehicle || null),
    options: await store.drivingOptions(),
    info: await store.vehicleInfo(vehicle || ''),
    lastOdometer: vehicle ? await store.lastOdometer(vehicle) : null,
  }),
  saveDriving: async (payload, id = null) => {
    const row = await store.saveDriving(payload, id);
    // 직접 쳐 넣은 곳도 다음부터는 고를 수 있게 목록에 넣는다.
    await store.rememberPlaces(row.fromPlace, row.toPlace);
    flushSoon();
    return row;
  },
  deleteDriving: async (id) => {
    const ok = await store.deleteDriving(id);
    flushSoon();
    return ok;
  },
  saveDrivingOptions: async (next) => {
    const value = await store.saveDrivingOptions(next);
    flushSoon();
    return value;
  },
  saveVehicleInfo: async (name, info) => {
    const value = await store.saveVehicleInfo(name, info);
    flushSoon();
    return value;
  },
  pullDriving: async (vehicle) => {
    const drivesheet = await import('./drivesheet.js');
    return drivesheet.pullDriving(vehicle || null);
  },

  // ------------------------------------------------------------------ 리포트
  listReports: async () => ({ items: await store.listReports() }),

  // 이력 화면 — 구글 시트의 월별 탭이 원본이다.
  sheetMonths: async (refresh = false) => {
    const reportsheet = await import('./reportsheet.js');
    return reportsheet.listMonths({ refresh });
  },
  sheetReports: async (month, refresh = true) => {
    const reportsheet = await import('./reportsheet.js');
    return reportsheet.pullMonth(month, { refresh });
  },
  deleteSheetReport: async (sheetName, row) => {
    const reportsheet = await import('./reportsheet.js');
    return reportsheet.removeEntry(sheetName, row);
  },
  setReportStatus: async (sheetName, row, status) => {
    const reportsheet = await import('./reportsheet.js');
    return reportsheet.setStatus(sheetName, row, status);
  },

  // 휴지통 — 시트 '휴지통' 탭 (지운 가이드 · 리포트). 되살리면 원래 탭으로 돌아간다.
  listTrash: async () => (await callAppsScript({ trash: 'list' }, 30000)).items || [],
  restoreTrash: (row) => callAppsScript({ trash: 'restore', row }, 60000),

  // 충돌 — 내가 고치는 사이 남이 먼저 고친 가이드
  guideConflicts: async () => (await import('./guidesheet.js')).listConflicts(),
  async resolveGuideConflict(id, keepMine) {
    const r = await (await import('./guidesheet.js')).resolveConflict(id, keepMine);
    flushSoon();
    return r;
  },

  // 작업 목록 — 구분 › 대분류 › 세부 작업 (팀 공용, 시트 '작업 목록' 탭)
  workList: () => store.getWorkList(),
  ensureDefaultWork: async () => { const l = await store.ensureDefaultWork(); flushSoon(); return l; },
  async addWorkItem(kind, cat, name) { const it = await store.addWorkItem(kind, cat, name); flushSoon(); return it; },
  async workOps(ops) { const l = await store.workOps(ops); flushSoon(); return l; },
  async mergeWorkItems(sourceId, targetId) { const l = await store.mergeWorkItems(sourceId, targetId); flushSoon(); return l; },

  /** 확인할 것 — 홈 알림 · 설정 맨 위 칸이 쓴다 (기기 안에서만 센다, 빠르다). */
  async attention() {
    const ob = await store.outbox();
    const oldest = ob.reduce((m, o) => (o.queuedAt && (!m || o.queuedAt < m) ? o.queuedAt : m), '');
    const oldestMin = oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / 60000) : 0;
    const errlog = await import('./errlog.js');
    return {
      pending: ob.length,
      oldestMin,
      failed: (await store.getMeta('flushFailed', '')) || '',
      conflicts: ((await (await import('./guidesheet.js')).listConflicts()) || []).length,
      orphans: ((await (await import('./guidesheet.js')).listOrphans()) || []).length,
      errors: await errlog.pendingErrors(),
    };
  },
  sendErrorsNow: async () => (await import('./errlog.js')).flushErrors(),

  getReport: (id) => store.getReport(id),
  createReport: (payload) => store.saveReport(payload),
  updateReport: (id, payload) => store.saveReport(payload, id),
  deleteReport: (id) => store.deleteReport(id),

  /** 시트 업로드 — 오프라인이면 대기열에 넣고 온라인 복귀 시 자동 전송 */
  async uploadReportToSheet(id) {
    const report = await store.getReport(id);
    if (!report) throw new Error('리포트를 찾을 수 없습니다.');
    if (!sync.isOnline()) {
      await store.enqueue({ type: 'sheet', reportId: id });
      await store.markReport(id, { status: 'QUEUED', errorMessage: null });
      return { queued: true,
               message: '오프라인입니다. 인터넷에 연결되면 자동으로 시트에 올립니다.' };
    }
    try {
      return await uploadReport(report);
    } catch (err) {
      // 오프라인 · 연결 끊김은 기기에 두었다가 저절로 다시 올린다 (첨부는 받은 조각 다음부터).
      // 현장 LTE 는 '켜져 있는데 끊기는' 일이 잦다 — 예전에는 그때 '업로드 실패' 로 멈췄다.
      if (err.offline || err.network) {
        await store.enqueue({ type: 'sheet', reportId: id });
        await store.markReport(id, { status: 'QUEUED', errorMessage: null });
        return { queued: true,
                 message: err.offline ? err.message
                   : '연결이 불안정해 기기에 저장했습니다. 연결되면 받은 부분 다음부터 자동으로 이어 올립니다.' };
      }
      await store.markReport(id, { status: 'FAILED', errorMessage: err.message });
      throw err;
    }
  },

  // ------------------------------------------------------------------ 설정
  async getSettings() {
    const settings = await store.getSettings();
    return {
      sheets_webapp_url: settings.sheetsWebappUrl,
      sheets_spreadsheet_id: settings.sheetsSpreadsheetId,
      device_name: settings.deviceName,
      sheetsReady: Boolean((settings.sheetsWebappUrl || '').trim()),
      spreadsheetUrl: spreadsheetUrl(settings),
      pendingCount: await store.outboxCount(),
    };
  },

  async saveSettings(payload) {
    await store.saveSettings({
      sheetsWebappUrl: payload.sheets_webapp_url,
      sheetsSpreadsheetId: payload.sheets_spreadsheet_id === undefined
        ? undefined : extractSpreadsheetId(payload.sheets_spreadsheet_id),
      deviceName: payload.device_name,
    });
    return this.getSettings();
  },

  testSheets: () => testConnection(),

  /** 올릴 대기 건수 (홈 화면 요약용) */
  pendingCount: () => store.outboxCount(),

  // ------------------------------------------------------------------ 사진
  uploadMedia: (file) => store.saveMedia(file),
};

/** 재고 변경 등은 온라인이면 곧바로 서버에 반영한다(화면은 기다리지 않는다). */
let flushTimer = null;
function flushSoon() {
  if (!sync.isOnline()) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => sync.runPendingWork(), 400);
}
