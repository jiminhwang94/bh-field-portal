// 구글 시트 연결 — **사람이 할 일이 없게.**
//
// 팀 공용 웹 앱 주소는 앱에 붙박이로 들어 있다(store.TEAM_WEBAPP_URL). 그런데
// 설정 화면에 주소 칸·저장·연결 테스트가 늘 보여서 "내가 뭘 해야 하나" 로
// 읽혔다. 이 파일이 하는 일 두 가지.
//
//  1. 처음 켤 때 주소가 비어 있으면 **공용 주소를 설정에 적어 넣는다.**
//     (기본값으로만 두면 설정 화면에 빈 칸으로 보인다 — 새 태블릿에서 그랬다)
//  2. 인터넷이 되면 한 번 연결을 확인하고 "구글 시트에 연결됐습니다" 를 띄운다.
//     실패하면 그 이유를 적어 두고, 설정 화면이 그때만 주소 칸을 보여 준다.
import * as store from './local/store.js';
import * as sync from './sync.js';
import { toast } from './ui.js';

const VERIFIED_KEY = 'sheetVerifiedAt';
const ERROR_KEY = 'sheetConnectError';

/** 마지막 확인 결과. { verifiedAt, error } — 둘 다 비어 있으면 아직 확인 전. */
export async function connectionState() {
  return {
    verifiedAt: (await store.getMeta(VERIFIED_KEY, '')) || '',
    error: (await store.getMeta(ERROR_KEY, '')) || '',
  };
}

/** 주소가 비어 있으면 공용 주소를 적어 넣는다. 사람이 다른 주소를 넣은 기기는 그대로. */
export async function registerDefaultUrl() {
  const stored = (await store.getMeta('settings', {})) || {};
  if (String(stored.sheetsWebappUrl || '').trim()) return false;
  await store.saveSettings({ sheetsWebappUrl: store.TEAM_WEBAPP_URL });
  return true;
}

/**
 * 부팅 때 한 번. 아직 확인한 적이 없으면 연결을 확인하고 결과를 남긴다.
 * force 면 이미 확인했어도 다시 한다 (설정의 [다시 확인]).
 */
export async function ensureSheetConnection({ force = false } = {}) {
  await registerDefaultUrl();
  if (!sync.isOnline()) return null;
  const state = await connectionState();
  if (!force && state.verifiedAt && !state.error) return state;

  try {
    const { testConnection } = await import('./sheets.js');
    const result = await testConnection();
    await store.setMeta(VERIFIED_KEY, store.now());
    await store.setMeta(ERROR_KEY, '');
    toast(`구글 시트에 연결됐습니다${result.spreadsheetName ? ` · ${result.spreadsheetName}` : ''}`, 'ok');
    return { verifiedAt: store.now(), error: '', name: result.spreadsheetName || '' };
  } catch (err) {
    await store.setMeta(ERROR_KEY, err.message || '연결에 실패했습니다.');
    return { verifiedAt: state.verifiedAt, error: err.message || '연결에 실패했습니다.' };
  }
}
