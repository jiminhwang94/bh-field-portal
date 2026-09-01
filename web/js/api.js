// 앱 데이터 창구 — **기기 안 데이터베이스**를 먼저 본다.
//
// v3.0 부터 모든 조회/생성/수정/삭제는 기기에서 끝나므로 오프라인에서도 전부 동작한다.
// 서버가 필요한 일(업데이트 동기화 · 시트 업로드)만 sync.js / sheets.js 로 넘긴다.
import * as store from './local/store.js';
import * as sync from './sync.js';
import { uploadReport, testConnection, extractSpreadsheetId,
         spreadsheetUrl } from './sheets.js';

export const APP_VERSION = '3.2.0';

export const deviceId = sync.deviceId;

export const api = {
  deviceId: sync.deviceId,

  async version() {
    const local = {
      version: APP_VERSION,
      buildHash: (await store.getMeta('buildHash', '')) || 'local',
      siteUrl: '', detectedUrl: '',
    };
    try {
      const server = await sync.serverRequest('GET', '/api/version', undefined,
                                              { timeout: 5000 });
      await store.setMeta('buildHash', server.buildHash || '');
      return { ...server, version: APP_VERSION, serverVersion: server.version };
    } catch {
      return local;      // 오프라인 — 기기에 있는 정보로 표시
    }
  },

  // ------------------------------------------------- 업데이트(공개본 동기화)
  state: () => sync.state(),
  publish: (deviceName) => sync.push(deviceName),
  takeLatest: () => sync.pull(),

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
      payload.vehicleName, payload.partName, payload.quantity, payload.minQuantity);
    flushSoon();
    return item;
  },
  patchInventory: async (id, payload) => {
    const item = await store.updateInventoryItem(id, payload);
    flushSoon();
    return item;
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
  setReportStatus: async (sheetName, row, status) => {
    const reportsheet = await import('./reportsheet.js');
    return reportsheet.setStatus(sheetName, row, status);
  },

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
      if (err.offline) {
        await store.enqueue({ type: 'sheet', reportId: id });
        await store.markReport(id, { status: 'QUEUED', errorMessage: null });
        return { queued: true, message: err.message };
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
      site_url: settings.serverUrl,
      device_name: settings.deviceName,
      server_url: settings.serverUrl,
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
      serverUrl: payload.server_url !== undefined ? payload.server_url
        : payload.site_url,
      deviceName: payload.device_name,
    });
    // 시트 주소는 팀 공통이므로 온라인이면 서버에도 함께 저장한다.
    if (payload.sheets_webapp_url !== undefined && sync.isOnline()) {
      sync.serverRequest('PUT', '/api/settings', {
        sheets_webapp_url: payload.sheets_webapp_url,
        sheets_spreadsheet_id: payload.sheets_spreadsheet_id,
      }).catch(() => { /* 서버가 없어도 기기에는 저장됐다 */ });
    }
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
