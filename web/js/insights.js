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

/**
 * 최근 n 달의 이력 — **받아 둔 사본만** 읽는다 (시트에 묻지 않는다).
 *
 * 새 리포트 · 가이드처럼 '지난번' 을 곁들여 보여 주는 화면이 쓴다. 여기서 시트를 부르면
 * 그 달 사본이 '방금 받음' 으로 바뀌어, 리포트를 올린 직후 이력 화면이 새 줄을 받지 않고
 * 넘어간다 (이력은 1분 안에 받은 사본은 다시 받지 않는다).
 */
export async function cachedEntries(n = 3) {
  const store = await import('./local/store.js');
  const entries = [];
  for (const m of recentMonths(n)) {
    const cached = await store.getMeta(`sheetReports:${m}`, null);
    entries.push(...((cached && cached.entries) || []));
  }
  return entries;
}

/** 매장 이름 비교용 (띄어쓰기 · 대소문자 무시) */
export const storeKey = (name) => String(name || '').replace(/\s+/g, '').toLowerCase();

// ─────────────────────────────────────────────── 지난번 (v3.35 — 같은 로봇의 지난 기록)
//
// 현장에서 "이 로봇 지난번에 무슨 일이 있었나" 를 이력 · 가이드 · 새 리포트가 함께 쓴다.
// 같은 로봇은 **시리얼**로 가린다. 매장 이름만으로는 로봇이 여러 대라 섞인다.

/** 리포트의 로봇 시리얼 */
export const serialOf = (entry) => valueOf(entry, '시리얼');
const serialKey = (s) => String(s || '').toUpperCase().replace(/[\s_-]+/g, '');

/**
 * 같은 로봇의 지난 기록 — 최근 것 먼저. 자기 자신(exceptKey)은 뺀다.
 * 시리얼을 모르면 빈 목록이다 (매장 전체를 보여 주면 다른 로봇 일이 섞인다).
 */
export function robotPast(entries, serial, exceptKey = '') {
  const want = serialKey(serial);
  if (want.length < 3) return [];
  return (entries || [])
    .filter((e) => e.key !== exceptKey && serialKey(serialOf(e)) === want)
    .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));
}

/**
 * 이 기록이 같은 로봇 · 같은 오류 코드로 **몇 번째**인가 (이 기록 포함, 그 전까지).
 * 오류 코드가 코드 모양이 아니거나 시리얼이 없으면 0.
 */
export function repeatCount(entries, entry) {
  if (!entry || !isCodeShaped(entry.code)) return 0;
  const code = normCode(entry.code);
  const at = String(entry.createdAt || entry.date || '');
  const same = robotPast(entries, serialOf(entry), entry.key)
    .filter((e) => normCode(e.code) === code && String(e.createdAt || e.date || '') <= at);
  return same.length ? same.length + 1 : 0;
}

/** 지난 기록 한 줄 — 무엇이 문제였고 무엇을 했나 */
export function pastStory(entry) {
  return {
    date: String(entry.date || entry.createdAt || '').slice(5, 10),
    code: isCodeShaped(entry.code) ? entry.code : '',
    symptom: valueOf(entry, '증상') || entry.summary || '',
    action: valueOf(entry, '조치'),
    result: valueOf(entry, '처리 결과'),
    status: entry.status || '',
  };
}

/** 개수 세기 → 많은 차례 [이름, 수] */
export function tally(items) {
  const m = new Map();
  for (const k of items) if (k) m.set(k, (m.get(k) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ko'));
}

// ─────────────────────────────────────────────── 이슈 유형 (v3.31 '작업' → v3.32 '이슈 유형')

/** 리포트 칸 이름. v3.31 에는 '작업' 이었다 — 그 줄도 같은 칸으로 읽는다 */
export const ISSUE_LABEL = '이슈 유형';
export const isIssueLabel = (label) => ['이슈유형', '작업'].includes(String(label || '').replace(/\s/g, ''));
/** 리포트의 이슈 유형 — '이슈 유형' 칸, 예전 '작업' 칸, 그것도 없으면 옛 '오류 코드' 칸의 분류 글자 */
export function issueOf(entry) {
  const hit = ((entry && entry.values) || []).find((v) => isIssueLabel(v.label) && String(v.value || '').trim());
  if (hit) return String(hit.value).trim();
  return entry && entry.code && !isCodeShaped(entry.code) ? entry.code : '';
}

/**
 * 이슈 유형은 여러 개 고를 수 있다 (v3.34) — 칸에는 한 줄에 하나씩 들어간다.
 * '로봇 이슈 › 하드웨어 교체 › 로더 교체' 와 '로봇 외 이슈 › 네트워크 › 와이파이' 를 고르면 두 줄 → 두 개
 */
export const splitIssues = (text) => String(text || '').split(/[\r\n]+/).map((t) => t.trim()).filter(Boolean);
export const issuesOf = (entry) => splitIssues(issueOf(entry));
/** 칸의 글자에서 목록의 항목들을 찾는다 (못 찾은 것은 빠진다 · 같은 항목은 한 번) */
export function findWorks(text, list) {
  const seen = new Set();
  return splitIssues(text).map((t) => findWork(t, list)).filter((it) => it && !seen.has(it.id) && seen.add(it.id));
}

// ─── 3C — 증상 → 원인 → 조치 (v3.42) ─────────────────────────────────────
//
// 현장 정비 업계의 표준 양식(Complaint · Cause · Correction). 증상은 이슈 유형에서 고르고,
// 원인 · 조치는 그 이슈의 목록에서 고른다. 글로 쓰면 사람마다 말이 달라 셀 수가 없다.
//
// 시트 칸에는 증상마다 한 줄:  '로더 멈춤: 커넥터 재체결, 재부팅 — CN3 빠져 있었음'
//   (이름: 고른 것들 — 메모). 증상 줄이 아닌 줄은 '그 밖의 메모' 로 그대로 둔다.

/** 원인을 못 찾았을 때 — 억지로 고르게 하면 자료가 더러워진다 (업계도 '원인 미확인' 을 따로 센다) */
export const CAUSE_UNKNOWN = '원인 모름';

/** 이슈 유형 칸의 줄들을 세부 항목 이름만으로 — '로봇 이슈 › 하드웨어 › 로더 교체' → '로더 교체' */
export const issueNames = (text) => [...new Set(splitIssues(text).map((t) => t.split('›').pop().trim()).filter(Boolean))];

/**
 * 증상 요약 맞추기 — 앞서 자동으로 넣은 이름 줄(before)은 빼고, 지금 이름 줄(after)을 맨 위에.
 * 그 밖의 줄(사람이 쓴 글)은 그대로 아래에 둔다.
 */
export function mergeSymptom(current, before, after) {
  const mine = freeSymptom(current, before);
  return [...(after || []), ...(mine ? [mine] : [])].join('\n').replace(/\s+$/, '');
}

/** 증상 요약에서 이슈 이름 줄을 뺀 나머지 — 사람이 덧붙인 말 */
export function freeSymptom(current, names) {
  const auto = new Set((names || []).map((x) => x.trim()));
  const mine = String(current || '').replace(/\r/g, '').split('\n').filter((l) => !auto.has(l.trim()));
  while (mine.length && !mine[0].trim()) mine.shift();
  return mine.join('\n').replace(/\s+$/, '');
}

const MEMO_SEP = ' — ';

/**
 * 원인 · 조치 칸을 증상별로 읽는다. 이름이 맞는 줄만 증상 줄이고 나머지는 extra.
 * v3.41 의 '• 증상 → 조치' 줄도 읽는다 (화살표 뒤를 메모로).
 * @returns {{ rows: Record<string, { picks: string[], memo: string }>, extra: string }}
 */
export function parse3c(text, names) {
  /** @type {Record<string, { picks: string[], memo: string }>} */
  const rows = {};
  for (const n of names || []) rows[n] = { picks: [], memo: '' };
  const extra = [];
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { extra.push(raw); continue; }
    const old = line.match(/^•\s*(.+?)\s*→\s*(.*)$/);
    const name = (names || []).find((n) => line.startsWith(`${n}:`)) || (old && rows[old[1]] ? old[1] : '');
    if (!name) { extra.push(raw); continue; }
    if (old) { rows[name].memo = old[2].trim(); continue; }
    const body = line.slice(name.length + 1).trim();
    const at = body.indexOf(MEMO_SEP.trim());
    const pickText = at < 0 ? body : body.slice(0, at);
    rows[name].memo = at < 0 ? '' : body.slice(at + 1).trim();
    rows[name].picks = pickText.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return { rows, extra: extra.join('\n').trim() };
}

/** parse3c 의 반대 — 고른 것이나 메모가 있는 증상만 줄이 된다 */
export function build3c(rows, names, extra) {
  const lines = [];
  for (const n of names || []) {
    const r = (rows || {})[n];
    if (!r || (!r.picks.length && !r.memo)) continue;
    lines.push(`${n}: ${r.picks.join(', ')}${r.memo ? `${r.picks.length ? MEMO_SEP : '— '}${r.memo}` : ''}`);
  }
  if (String(extra || '').trim()) lines.push(String(extra).trim());
  return lines.join('\n');
}

/**
 * 같은 이슈로 지난번에 고르거나 적은 것 — 최근 것부터, 이슈 이름마다.
 * key 는 '원인' 또는 '조치' (리포트 칸 이름의 낱말).
 * @returns {Record<string, string[]>}
 */
export function pastPicks(entries, names, key, max = 4) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const n of names || []) out[n] = [];
  for (const e of entries || []) {
    const mine = issuesOf(e).map((t) => t.split('›').pop().trim());
    const hits = (names || []).filter((n) => mine.includes(n));
    if (!hits.length) continue;
    const { rows } = parse3c(valueOf(e, key), hits);
    for (const n of hits) {
      for (const p of rows[n].picks) if (p !== CAUSE_UNKNOWN && !out[n].includes(p) && out[n].length < max) out[n].push(p);
    }
  }
  return out;
}

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
      for (const it of findWorks(issueOf(e), list)) {        // 여러 개 고른 리포트는 하나씩 센다
        all.set(it.id, (all.get(it.id) || 0) + 1);
        const model = valueOf(e, '모델');
        if (!byModel.has(model)) byModel.set(model, new Map());
        const mm = byModel.get(model);
        mm.set(it.id, (mm.get(it.id) || 0) + 1);
      }
    }
  }
  return { all, byModel };
}
