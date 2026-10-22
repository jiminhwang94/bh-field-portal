/**
 * 가짜 시트 서버 — 팀 구글 시트 대신 쓰는 **연습용 시트**.
 *
 * google-apps-script.gs 를 이 PC 에서 그대로 돌린다 (tests/fake_gas.mjs 의 가짜
 * SpreadsheetApp · DriveApp). 앱의 설정 → [테스트 모드] 에 이 주소를 넣으면
 * 저장 · 삭제 · 상태 바꾸기를 마음껏 눌러 봐도 팀 시트에는 아무것도 적히지 않는다.
 *
 * 실행:
 *   node tools/fake_sheet_server.mjs                 → http://127.0.0.1:8790/exec
 *   node tools/fake_sheet_server.mjs --port 8791
 *   node tools/fake_sheet_server.mjs --data fake-sheet.json   (끄고 켜도 내용 유지)
 *
 * 검사용 주소 (E2E 가 쓴다):
 *   POST /__reset   빈 시트로 되돌린다
 *   GET  /__dump    탭마다 칸 내용을 JSON 으로 (검사에서 "시트에 실제로 적혔나" 확인)
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createFakeGas } from '../tests/fake_gas.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(opt('port', process.env.FAKE_SHEET_PORT || 8790));
const DATA = opt('data', '');

let env = createFakeGas();

/** 탭 내용 → 글자 (바뀌었는지 보는 데 쓴다) */
function snapshot() {
  return JSON.stringify(env.ss.getSheets().map((s) => [s.getName(), [...s.cells.entries()]]));
}

function dump() {
  const out = {};
  for (const s of env.ss.getSheets()) {
    const rows = [];
    const last = s.getLastRow();
    const width = s.getLastColumn();
    for (let r = 1; r <= last; r += 1) {
      const line = [];
      for (let c = 1; c <= width; c += 1) line.push(s._get(r, c));
      rows.push(line);
    }
    out[s.getName()] = rows;
  }
  return out;
}

function save() {
  if (!DATA) return;
  const sheets = env.ss.getSheets().map((s) => ({
    name: s.getName(), id: s.getSheetId(), cells: [...s.cells.entries()], links: [...s.links.entries()],
  }));
  writeFileSync(DATA, JSON.stringify({ sheets, props: [...env.scriptProps.entries()] }));
}

function load() {
  if (!DATA || !existsSync(DATA)) return;
  const saved = JSON.parse(readFileSync(DATA, 'utf8'));
  for (const t of saved.sheets || []) {
    const sheet = new env.FakeSheet(t.name, t.id || 0);
    sheet.cells = new Map(t.cells);
    sheet.links = new Map(t.links || []);
    env.ss.sheets.push(sheet);
  }
  for (const [k, v] of saved.props || []) env.scriptProps.set(k, v);
}

load();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, ...CORS });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') { send(res, 204, ''); return; }
  const path = new URL(req.url, 'http://x').pathname;

  if (req.method === 'GET' && path === '/__dump') { send(res, 200, dump()); return; }
  if (req.method === 'GET') {
    send(res, 200, JSON.parse(env.gs.doGet ? env.gs.doGet()._text : '{"ok":true}'));
    return;
  }
  if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST 만 받습니다' }); return; }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (path === '/__reset') {
      env = createFakeGas();
      save();
      send(res, 200, { ok: true });
      return;
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      send(res, 200, { ok: false, error: '요청이 JSON 이 아닙니다' });
      return;
    }
    const before = snapshot();
    let out;
    try {
      out = env.call(body);
    } catch (err) {
      out = { ok: false, error: String(err && err.stack ? err.stack : err) };
    }
    // 진짜 시트처럼 "마지막으로 바뀐 시각" 이 움직여야 앱의 5분 확인이 새 내용을 본다.
    if (snapshot() !== before) {
      env.updatedAt = new Date();
      save();
    }
    const kind = Object.keys(body).filter((k) => typeof body[k] === 'string' || body[k] === true)
      .map((k) => `${k}=${body[k] === true ? '' : String(body[k]).slice(0, 20)}`).join(' ');
    console.log(`${new Date().toISOString().slice(11, 19)}  ${out && out.ok ? 'ok ' : 'ERR'}  ${kind}`
      + (out && !out.ok ? `  — ${String(out.error).split('\n')[0]}` : ''));
    send(res, 200, out);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`가짜 시트 서버: http://127.0.0.1:${PORT}/exec${DATA ? `  (저장: ${DATA})` : '  (끄면 내용이 사라집니다)'}`);
  console.log('앱 설정 → [테스트 모드] 에 위 주소를 넣으세요. 팀 시트에는 아무것도 적히지 않습니다.');
});
