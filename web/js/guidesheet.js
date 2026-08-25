// 가이드 3종 → 구글 스프레드시트 미러링 (열람용, 앱 → 시트 단방향).
//
// 시트가 연결돼 있으면 가이드를 저장/삭제할 때 카테고리별 탭
// (오류 코드 가이드 · 하드웨어 교체 SOP · SW·명령어)을 통째로 다시 쓴다.
// 시트에서 직접 고친 내용은 앱으로 돌아오지 않는다 — 가이드 편집은 앱에서.
import * as idb from './local/idb.js';
import * as store from './local/store.js';
import { callAppsScript } from './sheets.js';

export const isEnabled = () => store.sheetInventoryOn();

/** 기기의 모든 가이드를 시트 탭 3개로 내보낸다. */
export async function pushGuides() {
  const guides = await idb.getAll('guides');
  const items = guides.map((g) => ({
    categoryType: g.categoryType,
    codeOrTitle: g.codeOrTitle || '',
    summary: g.summary || '',
    requiredTools: g.requiredTools || '',
    commands: (g.commands || []).map((c) => ({
      label: c.label || '', cmd: c.cmd || '', desc: c.desc || '',
    })),
    steps: (g.steps || []).map((s) => ({
      instruction: s.instruction || '',
      expectedMetric: s.expectedMetric || '',
    })),
    updatedAt: g.updatedAt || '',
  }));
  return callAppsScript({ guides: 'push', items }, 60000);
}
