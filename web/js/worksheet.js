// 이슈 유형 목록 ↔ 구글 스프레드시트 '이슈 유형 목록' 탭 (v3.31 '작업 목록').
//
// 받기: 시트 목록을 기기에 (내가 아직 안 올린 변경은 그 위에 다시 얹는다).
// 올리기: sync.js 가 대기열의 ops 를 모아 { work: 'push', ops } 로 보낸다.
// 시트에 탭이 아직 없으면(팀에서 처음) 기기 목록 · 기본 대분류를 올려 탭을 만든다.
import * as store from './local/store.js';
import { callAppsScript } from './sheets.js';
import { sheetRead } from './sync.js';

export function pullWork() {
  return sheetRead(pullWorkNow);
}

async function pullWorkNow() {
  const result = await callAppsScript({ work: 'pull' }, 60000);
  if (!result.exists) {
    // 팀에서 처음 — 기본 대분류(또는 이 기기 목록)를 올린다. 올리기는 대기열이 한다.
    const list = await store.getWorkList();
    if (!list.cats.length) await store.ensureDefaultWork();
    else if (!(await store.pendingWorkOps()).length) {
      await store.workOps([
        ...list.cats.map((c) => ({ op: 'cat-add', kind: c.kind, name: c.name })),
        ...list.items.map((item) => ({ op: 'item-upsert', item })),
      ]);
    }
    return { changed: 0 };
  }
  const before = JSON.stringify(await store.getWorkList());
  const after = JSON.stringify(await store.setWorkFromSheet(result));
  return { changed: before === after ? 0 : 1 };
}

/** 대기열의 ops 를 한 번에 올린다 (sync.js 가 부른다). 시트가 돌려준 목록이 최종본이다. */
export async function pushWorkOps(ops) {
  return callAppsScript({ work: 'push', ops }, 60000);
}
