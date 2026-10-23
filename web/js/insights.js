// 이력 · 가이드 · 재고를 서로 잇는 도우미 — 매장별 이력 · 통계 · 리포트↔가이드 · 사용 부품.
//
// 전부 **기기에 받아 둔 사본**으로 계산한다 (오프라인에서도 된다). 없는 달은 시트에서
// 한 번 받아 오고, 그 뒤로는 사본을 쓴다.
import { api } from './api.js';

/** 오류 코드 비교용 — 'E-101' · 'e101' · 'E 101' 을 같은 것으로 본다 */
export const normCode = (value) => String(value || '').toUpperCase().replace(/[\s_-]+/g, '').trim();

/** 오류 코드 가이드의 맨 앞 낱말이 코드다 ('E-101 로더 모터 과전류' → 'E-101') */
export const guideCode = (g) => String((g && g.codeOrTitle) || '').trim().split(/\s+/)[0] || '';

/** 리포트의 오류 코드에 맞는 가이드 (여러 개일 수 있다 — 로봇마다) */
export function guidesForCode(code, guides) {
  const want = normCode(code);
  if (want.length < 2) return [];
  return (guides || []).filter((g) => g.categoryType === 'ERROR_CODE' && normCode(guideCode(g)) === want);
}

/** 리포트 값 중 이름표에 낱말이 든 칸 ('로봇 모델' · '사용 부품' …) */
export function valueOf(entry, needle) {
  const hit = ((entry && entry.values) || []).find((v) => String(v.label || '').includes(needle));
  return hit ? String(hit.value || '').trim() : '';
}

/**
 * '사용 부품' 칸을 부품 목록으로 — '진공 패드 ×2, 가스게이지' · '패드 x2' · '패드 2개' 모두 읽는다.
 * @returns {{ name: string, n: number }[]}
 */
export function parseParts(text) {
  const out = new Map();
  for (const raw of String(text || '').split(/[,\n·/]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^(.*?)\s*(?:[×xX*]\s*(\d+)|(\d+)\s*개)\s*$/);
    const name = (m ? m[1] : t).trim();
    const n = m ? Number(m[2] || m[3]) || 1 : 1;
    if (name) out.set(name, (out.get(name) || 0) + n);
  }
  return [...out].map(([name, n]) => ({ name, n }));
}

/** 부품 목록을 '사용 부품' 칸 글자로 (parseParts 의 반대) */
export const partsText = (list) => list.map((p) => (p.n > 1 ? `${p.name} ×${p.n}` : p.name)).join(', ');

/** 작성한 날부터 며칠째 (작성일 = 1일째) */
export function openDays(entry) {
  const at = new Date(String(entry.createdAt || entry.date || '').replace(' ', 'T'));
  if (Number.isNaN(at.getTime())) return 0;
  return Math.floor((Date.now() - at.getTime()) / 86400000) + 1;
}

const monthName = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** 최근 n 달의 이름 (이번 달부터 거꾸로) */
export function recentMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i += 1) {
    out.push(monthName(d));
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/**
 * 최근 n 달의 이력을 모은다. 받아 둔 사본을 먼저 쓰고, 없는 달만 시트에서 받는다.
 * 시트에 그 달 탭이 없으면 빈 달로 친다.
 * @returns {Promise<{ entries: any[], months: string[], missing: string[] }>}
 */
export async function loadEntries(n = 3) {
  const all = (await api.sheetMonths(false).catch(() => [])) || [];
  const months = recentMonths(n).filter((m) => !all.length || all.includes(m) || m === recentMonths(1)[0]);
  const entries = [];
  const missing = [];
  for (const m of months) {
    try {
      const data = await api.sheetReports(m, false);
      if (data && data.error && !(data.entries || []).length) missing.push(m);
      entries.push(...((data && data.entries) || []));
    } catch {
      missing.push(m);
    }
  }
  entries.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { entries, months, missing };
}

/** 매장 이름 비교용 (띄어쓰기 · 대소문자 무시) */
export const storeKey = (name) => String(name || '').replace(/\s+/g, '').toLowerCase();

/** 개수 세기 → 많은 차례 [이름, 수] */
export function tally(items) {
  const m = new Map();
  for (const k of items) if (k) m.set(k, (m.get(k) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ko'));
}

// ─────────────────────────────────────────────── 작업 목록 (v3.31)

/** 오류 코드처럼 생겼나 — E-101 · W204 · ERR12. '유지 보수' 같은 분류 글자는 아니다 */
export const isCodeShaped = (v) => /^[A-Za-z]{1,4}[-\s]?\d{1,5}[A-Za-z]?$/.test(String(v || '').trim());

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
/** 초성만 — '로더 교체' → 'ㄹㄷ ㄱㅊ' (초성으로도 찾게) */
export function choseong(text) {
  return [...String(text || '')].map((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }).join('');
}
const squash = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');
const onlyCho = (t) => /^[ㄱ-ㅎ]+$/.test(squash(t));

/** 리포트 칸에 들어가는 글자 — '로봇 이슈 › 하드웨어 교체 › 로더 교체' */
export const workPath = (it) => `${it.kind} › ${it.cat} › ${it.name}`;

/** 리포트 칸의 글자로 목록의 항목을 찾는다 — 경로 · 이름 · 별칭 어느 것이든 (띄어쓰기 무시) */
export function findWork(text, list) {
  const raw = String(text || '').trim();
  if (!raw || !list) return null;
  const last = squash(raw.split('›').pop());
  return (list.items || []).find((it) => squash(it.name) === last || (it.aliases || []).some((a) => squash(a) === last))
    || null;
}

/** 검색어에 맞나 — 이름 · 별칭 · 대분류, 초성만 쳐도 */
export function matchWork(q, it) {
  const want = squash(q);
  if (!want) return true;
  const hay = [it.name, ...(it.aliases || []), it.cat];
  if (onlyCho(want)) return hay.some((h) => squash(choseong(h)).includes(want));
  return hay.some((h) => squash(h).includes(want));
}

/** 리포트의 로봇 모델 'Gen.1(D1)' 과 가이드의 로봇 'Gen.1' 이 같은 줄기인가 */
export const sameRobot = (reportModel, guideModel) => {
  const a = squash(reportModel).replace(/[^a-z0-9가-힣]/g, '');
  const b = squash(guideModel).replace(/[^a-z0-9가-힣]/g, '');
  return Boolean(a && b) && (a.startsWith(b) || b.startsWith(a));
};

/**
 * 기기에 받아 둔 최근 이력에서 작업마다 몇 번 쓰였나 (시트에 묻지 않는다 — 빠르다).
 * 예전 리포트의 '오류 코드' 칸에 분류 글자가 적힌 것도 센다.
 * @returns {Promise<{ all: Map<string, number>, byModel: Map<string, Map<string, number>> }>}
 */
export async function workUsage(list, months = 3) {
  const store = await import('./local/store.js');
  const all = new Map();
  const byModel = new Map();
  for (const m of recentMonths(months)) {
    const cached = await store.getMeta(`sheetReports:${m}`, null);
    for (const e of (cached && cached.entries) || []) {
      const text = valueOf(e, '작업') || (isCodeShaped(e.code) ? '' : e.code);
      const it = findWork(text, list);
      if (!it) continue;
      all.set(it.id, (all.get(it.id) || 0) + 1);
      const model = valueOf(e, '모델');
      if (!byModel.has(model)) byModel.set(model, new Map());
      const mm = byModel.get(model);
      mm.set(it.id, (mm.get(it.id) || 0) + 1);
    }
  }
  return { all, byModel };
}
