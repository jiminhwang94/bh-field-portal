/**
 * google-apps-script.gs 를 **실제로 실행해서** 검사한다.
 *
 * 이 파일은 구글 서버에서만 도는 코드라 여기서 돌려 볼 수 없었고, 그래서
 * 지금까지는 "같은 낱말을 쓰는지"만 확인했다(tests/test_report_history.py).
 * 그 사이 실제 버그가 두 번 통과했다.
 *
 *   - 헤더는 7칸인데 데이터는 6칸을 써서 setValues 가 예외를 던졌다.
 *     그 직전에 clearContents() 가 이미 실행돼 **탭이 비워진 채로 남았다.**
 *     가이드를 하나 고치면 그 분류 탭이 통째로 사라졌다.
 *   - ID 칸이 비어 있어 앱이 매번 "새 가이드"로 보고 복사본을 쌓았다.
 *     [업데이트] 를 누를 때마다 같은 가이드가 하나씩 늘었다.
 *
 * 가짜 SpreadsheetApp 을 만들어 실제 코드를 그대로 돌린다.
 * 실행: node tests/test_apps_script.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function check(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

// ─────────────────────────────────────────────── 가짜 스프레드시트

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  setValues(values) {
    if (values.length !== this.rows) {
      throw new Error(`행 수가 맞지 않습니다: ${values.length} vs ${this.rows}`);
    }
    values.forEach((line, r) => {
      // 구글이 실제로 던지는 오류를 그대로 흉내낸다.
      if (line.length !== this.cols) {
        throw new Error(
          'The number of columns in the data does not match the number of '
          + `columns in the range. (${line.length} vs ${this.cols})`);
      }
      line.forEach((v, c) => this.sheet._set(this.row + r, this.col + c, v));
    });
    return this;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r += 1) {
      const line = [];
      for (let c = 0; c < this.cols; c += 1) {
        line.push(this.sheet._get(this.row + r, this.col + c));
      }
      out.push(line);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map((line) => line.map((v) => String(v ?? '')));
  }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  getValue() { return this.sheet._get(this.row, this.col); }
  /**
   * 실제 Apps Script 의 Range 에 있는 메서드다. 가짜에 없으면 이것을 쓰는
   * 코드가 "is not a function" 으로 조용히 터지고, 응답은 ok:false 로만
   * 돌아와 **탭에 옛 줄이 그대로 남는다.** 실제로 그렇게 잡혔다.
   */
  clearContent() {
    for (let r = this.row; r < this.row + this.rows; r += 1) {
      for (let c = this.col; c < this.col + this.cols; c += 1) {
        this.sheet.cells.delete(`${r},${c}`);
      }
    }
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setVerticalAlignment() { return this; }
  setWrap() { return this; }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.cells = new Map(); }
  _key(r, c) { return `${r},${c}`; }
  _set(r, c, v) {
    if (v === '' || v === null || v === undefined) this.cells.delete(this._key(r, c));
    else this.cells.set(this._key(r, c), v);
  }
  _get(r, c) { const v = this.cells.get(this._key(r, c)); return v === undefined ? '' : v; }
  getName() { return this.name; }
  getRange(row, col, rows = 1, cols = 1) {
    return new FakeRange(this, row, col, rows, cols);
  }
  clearContents() { this.cells.clear(); return this; }
  getLastRow() {
    let max = 0;
    for (const k of this.cells.keys()) max = Math.max(max, Number(k.split(',')[0]));
    return max;
  }
  getLastColumn() {
    let max = 0;
    for (const k of this.cells.keys()) max = Math.max(max, Number(k.split(',')[1]));
    return max;
  }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  getColumnWidth() { return 100; }
  setRowHeight() { return this; }
  hideColumns() { return this; }
  insertImage() { throw new Error('테스트에서는 이미지 삽입을 쓰지 않습니다.'); }
  deleteRow(row) {
    const next = new Map();
    for (const [k, v] of this.cells) {
      const [r, c] = k.split(',').map(Number);
      if (r === row) continue;
      next.set(`${r > row ? r - 1 : r},${c}`, v);
    }
    this.cells = next;
    return this;
  }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; }
  getName() { return '테스트 시트'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/test/edit'; }
  getId() { return 'testid'; }
  getSheets() { return this.sheets; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.push(s); return s; }
  setActiveSheet() { return this; }
  moveActiveSheet() { return this; }
}


// ─────────────────────────────────────────────── 가짜 드라이브
//
// 공유 드라이브에 사진/동영상 → 매장 → 날짜 폴더가 실제로 만들어지는지 본다.

const SHARED_DRIVE_ROOT = '0AKL9kurLTHqNUk9PVA';
let driveTree = null;

function makeFolder(name, path) {
  const folder = {
    name, path, folders: new Map(), files: [],
    getName: () => name,
    getFoldersByName(child) {
      const found = folder.folders.get(child);
      let handed = false;
      return { hasNext: () => !!found && !handed,
               next: () => { handed = true; return found; } };
    },
    createFolder(child) {
      const made = makeFolder(child, `${path}/${child}`);
      folder.folders.set(child, made);
      return made;
    },
    createFile(blob) {
      const file = {
        id: `f${folder.files.length}-${path}`,
        name: blob.name, mime: blob.mime, path,
        getUrl() { return `https://drive.google.com/file/d/${file.id}/view`; },
        getName: () => blob.name,
        getMimeType: () => blob.mime,
        setSharing() { return file; },
        getParents: () => ({ hasNext: () => false }),
      };
      folder.files.push(file);
      allFiles.set(file.id, file);
      return file;
    },
  };
  return folder;
}

const allFiles = new Map();

function makeDrive() {
  driveTree = makeFolder('공유 드라이브', '');
  return {
    getStorageLimit: () => 15 * 1024 ** 3,
    getStorageUsed: () => 1 * 1024 ** 3,
    getRootFolder: () => makeFolder('내 드라이브', '내드라이브'),
    getFolderById: (id) => {
      if (id === SHARED_DRIVE_ROOT) return driveTree;
      throw new Error('없는 폴더입니다: ' + id);
    },
    getFileById: (id) => {
      if (allFiles.has(id)) return allFiles.get(id);
      throw new Error('없는 파일입니다: ' + id);
    },
    Access: { ANYONE_WITH_LINK: 'anyone' },
    Permission: { VIEW: 'view' },
  };
}

/** 폴더 트리에서 경로로 찾는다 (없으면 null) */
function findPath(...names) {
  let node = driveTree;
  for (const name of names) {
    const next = node.folders.get(name);
    if (!next) return null;
    node = next;
  }
  return node;
}

// ─────────────────────────────────────────────── 실제 .gs 를 불러온다

const source = readFileSync(join(ROOT, 'google-apps-script.gs'), 'utf8');
const ss = new FakeSpreadsheet();

const sandbox = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ss,
    flush: () => {},
    MimeType: { JSON: 'application/json' },
  },
  LockService: {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
  },
  ContentService: {
    createTextOutput: (text) => ({ _text: text, setMimeType() { return this; } }),
    MimeType: { JSON: 'application/json' },
  },
  DriveApp: makeDrive(),
  Utilities: {
    base64Decode: (text) => ({ _b64: text }),
    newBlob: (bytes, mime, name) => ({ _bytes: bytes, mime, name }),
  },
};

// json() 이 돌려주는 값을 그대로 읽을 수 있게 감싼다
const wrapper = `
  ${source}
  return { doPost: doPost, readGuideSheet: readGuideSheet,
           GUIDE_HEADER: GUIDE_HEADER, GUIDE_SHEETS: GUIDE_SHEETS };
`;
const factory = new Function(...Object.keys(sandbox), wrapper);
const gs = factory(...Object.values(sandbox));

function call(body) {
  const res = gs.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(res._text);
}

console.log('='.repeat(62));
console.log('Apps Script 실제 실행 검사');
console.log('='.repeat(62));

// ─────────────────────────────────────────────── 가이드 왕복

const guides = [
  { id: 'g-aaa', categoryType: 'ERROR_CODE', codeOrTitle: 'E-101 로더 과전류',
    summary: '로더 축 과전류', requiredTools: '테스터',
    commands: [{ label: '상태 확인', cmd: 'bhctl status', desc: '먼저 확인' }],
    steps: [{ instruction: '커넥터를 확인한다', expectedMetric: '2.5V 이하' },
            { instruction: '벨트 장력을 재조정한다', expectedMetric: '' }],
    updatedAt: '2026-09-02T10:00:00' },
  { id: 'g-bbb', categoryType: 'HARDWARE_SOP', codeOrTitle: '그리퍼 패드 교체',
    summary: '패드 교체 절차', requiredTools: '육각 렌치',
    commands: [], steps: [{ instruction: '전원을 내린다', expectedMetric: '' }],
    updatedAt: '2026-09-02T10:05:00' },
];

let result = call({ guides: 'push', items: guides });
check('가이드를 시트에 쓸 수 있다 (칸 수가 맞는다)', result.ok === true,
      result.ok ? `${JSON.stringify(result.counts)}` : result.error);

const errSheet = ss.getSheetByName(gs.GUIDE_SHEETS.ERROR_CODE);
check('오류 코드 탭이 만들어졌다', !!errSheet);
check('탭이 비어 있지 않다 (쓰기 실패로 지워지지 않았다)',
      errSheet && errSheet.getLastRow() >= 3,
      errSheet ? `마지막 줄 ${errSheet.getLastRow()}` : '');

const header = errSheet.getRange(2, 1, 1, gs.GUIDE_HEADER.length).getValues()[0];
check('헤더에 ID 열이 있다', header.includes('ID(고치지 마세요)'), header.join(' · '));

const idCol = header.indexOf('ID(고치지 마세요)') + 1;
check('데이터 줄에 ID 가 실제로 적혀 있다',
      errSheet.getRange(3, idCol).getValue() === 'g-aaa',
      `읽은 값: "${errSheet.getRange(3, idCol).getValue()}"`);

// 되읽기
result = call({ guides: 'pull' });
check('가이드를 되읽을 수 있다', result.ok === true);
check('되읽은 건수가 같다', result.items.length === guides.length,
      `${result.items.length} / ${guides.length}`);

const back = result.items.find((g) => g.id === 'g-aaa');
check('되읽은 가이드의 ID 가 보존된다', !!back, back ? back.id : '못 찾음');
if (back) {
  check('제목이 보존된다', back.codeOrTitle === 'E-101 로더 과전류', back.codeOrTitle);
  check('명령어가 보존된다',
        back.commands.length === 1 && back.commands[0].cmd === 'bhctl status',
        JSON.stringify(back.commands));
  check('명령어 이름·설명이 보존된다',
        back.commands[0].label === '상태 확인' && back.commands[0].desc === '먼저 확인',
        JSON.stringify(back.commands[0]));
  check('단계가 보존된다 (번호는 떼고)',
        back.steps.length === 2 && back.steps[0].instruction === '커넥터를 확인한다',
        JSON.stringify(back.steps.map((s) => s.instruction)));
  check('기준값이 보존된다', back.steps[0].expectedMetric === '2.5V 이하',
        String(back.steps[0].expectedMetric));
}

// 한 건만 고쳐서 다시 올려도 나머지가 남아 있어야 한다
const edited = JSON.parse(JSON.stringify(guides));
edited[0].summary = '고친 요약';
result = call({ guides: 'push', items: edited });
check('가이드를 고쳐 다시 올릴 수 있다', result.ok === true, result.error || '');
result = call({ guides: 'pull' });
check('고친 뒤에도 가이드가 사라지지 않는다', result.items.length === guides.length,
      `${result.items.length}건 남음`);
check('고친 내용이 반영된다',
      (result.items.find((g) => g.id === 'g-aaa') || {}).summary === '고친 요약');

// 두 번 왕복해도 늘어나지 않는다 (중복 방지)
call({ guides: 'push', items: edited });
const twice = call({ guides: 'pull' });
check('여러 번 왕복해도 건수가 늘지 않는다', twice.items.length === guides.length,
      `${twice.items.length}건`);

// ─────────────────────────────────────────────── 리포트 이력

const HEADERS = ['작성일시', '작성자', '방문 식당명', '오류 코드', '현장 사진', '상태'];
result = call({
  sheetName: '2026-09', headers: HEADERS,
  row: ['2026-09-02 10:00', '황지민', '미트로 강남점', 'E-101', '', '조치 진행 중'],
});
check('리포트를 기록할 수 있다', result.ok === true, result.error || `${result.row}행`);
const firstRow = result.row;

result = call({ reports: 'pull', sheetName: '2026-09' });
check('리포트를 되읽을 수 있다', result.ok === true && result.rows.length === 1,
      `${(result.rows || []).length}건`);

result = call({ reports: 'status', sheetName: '2026-09', row: firstRow,
                status: '조치 완료' });
check('상태를 고칠 수 있다', result.ok === true, result.error || '');
result = call({ reports: 'pull', sheetName: '2026-09' });
const statusIdx = result.headers.indexOf('상태');
check('고친 상태가 반영된다', result.rows[0].cells[statusIdx] === '조치 완료',
      result.rows[0].cells[statusIdx]);

// 이미 올린 줄을 고쳐 쓴다 (새 줄이 생기면 안 된다)
result = call({
  reports: 'update', sheetName: '2026-09', row: firstRow, headers: HEADERS,
  row_values: ['2026-09-02 10:00', '황지민', '미트로 강남점', 'E-204',
               '', '조치 완료'],
});
check('올린 리포트를 고쳐 쓸 수 있다', result.ok === true, result.error || '');
result = call({ reports: 'pull', sheetName: '2026-09' });
check('고쳐 써도 줄이 늘지 않는다', result.rows.length === 1,
      `${result.rows.length}건`);
check('고친 내용이 그 줄에 들어간다',
      result.rows[0].cells[HEADERS.indexOf('오류 코드')] === 'E-204',
      result.rows[0].cells[HEADERS.indexOf('오류 코드')]);
check('고쳐 쓴 뒤에도 상태가 남는다',
      result.rows[0].cells[HEADERS.indexOf('상태')] === '조치 완료');

// 두 줄일 때 가운데를 지워도 나머지가 남아야 한다
call({ sheetName: '2026-09', headers: HEADERS,
       row: ['2026-09-03 09:00', '황지민', '버거킹 판교점', 'E-330', '', '모니터링'] });
result = call({ reports: 'pull', sheetName: '2026-09' });
check('두 번째 리포트가 쌓인다', result.rows.length === 2, `${result.rows.length}건`);

const victim = result.rows[0].row;
result = call({ reports: 'delete', sheetName: '2026-09', row: victim });
check('올린 리포트를 지울 수 있다', result.ok === true, result.error || '');
result = call({ reports: 'pull', sheetName: '2026-09' });
check('지운 뒤 한 건만 남는다', result.rows.length === 1, `${result.rows.length}건`);
check('남은 것은 지우지 않은 쪽이다',
      result.rows[0].cells[HEADERS.indexOf('방문 식당명')] === '버거킹 판교점',
      result.rows[0].cells[HEADERS.indexOf('방문 식당명')]);
check('지운 뒤 줄 번호가 다시 매겨진다', result.rows[0].row === 3,
      `${result.rows[0].row}행`);

// 없는 줄을 지우려 하면 거절한다
result = call({ reports: 'delete', sheetName: '2026-09', row: 999 });
check('없는 줄 삭제는 거절한다', result.ok === false, result.error || '');

// ─────────────────────────────────────────────── 첨부 저장 위치

result = call({
  sheetName: '2026-09', headers: HEADERS,
  row: ['2026-09-05 09:00', '황지민', '옥동식 서초점', 'E-101', '', '조치 진행 중'],
  media: [
    { column: 5, filename: '현장.jpg', mimeType: 'image/jpeg',
      storeName: '옥동식 서초점', dateText: '2026-09-05', data: 'AAA' },
    { column: 5, filename: '증상.mp4', mimeType: 'video/mp4',
      storeName: '옥동식 서초점', dateText: '2026-09-05', data: 'BBB' },
  ],
});
check('첨부와 함께 리포트를 올릴 수 있다', result.ok === true, result.error || '');
check('공유 드라이브에 저장했다 (개인 드라이브가 아니다)', result.mediaShared === true,
      `mediaShared=${result.mediaShared}`);
check('첨부 2개가 저장됐다', result.media === 2, String(result.media));

// 받은 폴더 바로 아래부터 시작한다 — 같은 이름 폴더를 또 만들면 안 된다.
check('받은 폴더 안에 같은 이름 폴더를 또 만들지 않는다',
      !findPath('필드팀 유지보수(이미지,동영상)'),
      [...driveTree.folders.keys()].join(' | '));
const photoDir = findPath('옥동식 서초점', '2026-09-05', '사진');
const videoDir = findPath('옥동식 서초점', '2026-09-05', '동영상');
check('매장 → 날짜 → 사진 순으로 폴더가 만들어진다', !!photoDir,
      photoDir ? photoDir.path : '없음');
check('매장 → 날짜 → 동영상 순으로 폴더가 만들어진다', !!videoDir,
      videoDir ? videoDir.path : '없음');
check('사진이 사진 폴더로 들어간다',
      !!photoDir && photoDir.files.length === 1
      && photoDir.files[0].name === '현장.jpg',
      photoDir ? photoDir.files.map((f) => f.name).join(',') : '');
check('영상이 동영상 폴더로 들어간다',
      !!videoDir && videoDir.files.length === 1
      && videoDir.files[0].name === '증상.mp4',
      videoDir ? videoDir.files.map((f) => f.name).join(',') : '');
check('사진과 영상이 섞이지 않는다',
      photoDir.files.every((f) => !f.mime.startsWith('video/'))
      && videoDir.files.every((f) => f.mime.startsWith('video/')));

// 같은 매장·같은 날 다시 올리면 폴더를 새로 만들지 않는다
call({
  sheetName: '2026-09', headers: HEADERS,
  row: ['2026-09-05 15:00', '황지민', '옥동식 서초점', 'E-204', '', '조치 완료'],
  media: [{ column: 5, filename: '추가.jpg', mimeType: 'image/jpeg',
            storeName: '옥동식 서초점', dateText: '2026-09-05', data: 'CCC' }],
});
check('같은 매장·같은 날은 폴더를 다시 만들지 않는다',
      findPath('옥동식 서초점').folders.size === 1
      && findPath('옥동식 서초점', '2026-09-05', '사진').files.length === 2,
      `날짜 폴더 ${findPath('옥동식 서초점').folders.size}개`);

// 폴더 이름에 못 쓰는 글자를 걸러낸다
call({
  sheetName: '2026-09', headers: HEADERS,
  row: ['2026-09-06 09:00', '황지민', 'A/B*점', '', '', '조치 완료'],
  media: [{ column: 5, filename: 'x.jpg', mimeType: 'image/jpeg',
            storeName: 'A/B*점', dateText: '2026-09-06', data: 'DDD' }],
});
check('폴더 이름에 못 쓰는 글자를 걸러낸다',
      [...driveTree.folders.keys()].some((n) => n === 'A B 점'),
      [...driveTree.folders.keys()].join(' | '));

// 첨부 종류 조회 — 영상인지 알 수 있어야 재생할 수 있다
const videoId = videoDir.files[0].id;
const photoId = photoDir.files[0].id;
result = call({ drive: 'info', ids: [videoId, photoId] });
check('첨부 종류를 알려 준다', result.ok === true);
check('영상을 영상으로 알려 준다',
      (result.files.find((f) => f.id === videoId) || {}).isVideo === true);
check('사진을 영상으로 잘못 보지 않는다',
      (result.files.find((f) => f.id === photoId) || {}).isVideo === false);

// 수정할 때 기존 첨부를 지키고 새 것만 덧붙인다
const NL = String.fromCharCode(10);
const splitLines = (cell) => String(cell).split(NL).filter(Boolean);
const MEDIA_HEADERS = ['작성일시', '작성자', '방문 식당명', '현장 사진', '상태'];
result = call({
  sheetName: '2026-10', headers: MEDIA_HEADERS,
  row: ['2026-10-01 09:00', '황지민', '옥동식 서초점', '', '조치 진행 중'],
  media: [{ column: 4, filename: '첫사진.jpg', mimeType: 'image/jpeg',
            storeName: '옥동식 서초점', dateText: '2026-10-01', data: 'AAA' }],
});
const mediaRow = result.row;
result = call({ reports: 'pull', sheetName: '2026-10' });
const mediaCol = result.headers.indexOf('현장 사진');
const firstLinks = splitLines(result.rows[0].cells[mediaCol]);
check('첫 첨부가 칸에 적힌다', firstLinks.length === 1, `${firstLinks.length}개`);

// 앱은 기존 링크를 그대로 다시 적고, 새 것만 media 로 보낸다
const keptCell = firstLinks.join(NL);
result = call({
  reports: 'update', sheetName: '2026-10', row: mediaRow, headers: MEDIA_HEADERS,
  row_values: ['2026-10-01 09:00', '황지민', '옥동식 서초점', keptCell, '조치 완료'],
  media: [{ column: 4, filename: '추가영상.mp4', mimeType: 'video/mp4',
            storeName: '옥동식 서초점', dateText: '2026-10-01', data: 'BBB' }],
});
check('첨부를 더하며 수정할 수 있다', result.ok === true, result.error || '');
result = call({ reports: 'pull', sheetName: '2026-10' });
const afterLinks = splitLines(result.rows[0].cells[mediaCol]);
check('기존 첨부가 지워지지 않는다', afterLinks.includes(firstLinks[0]),
      `${afterLinks.length}개`);
check('새 첨부가 덧붙는다', afterLinks.length === 2, `${afterLinks.length}개`);
check('수정해도 줄이 늘지 않는다', result.rows.length === 1);

// 기존 첨부를 뺀 채로 저장하면 그것만 빠진다
result = call({
  reports: 'update', sheetName: '2026-10', row: mediaRow, headers: MEDIA_HEADERS,
  row_values: ['2026-10-01 09:00', '황지민', '옥동식 서초점', afterLinks[1], '조치 완료'],
});
result = call({ reports: 'pull', sheetName: '2026-10' });
const finalLinks = splitLines(result.rows[0].cells[mediaCol]);
check('뺀 첨부만 빠진다', finalLinks.length === 1 && finalLinks[0] === afterLinks[1],
      `${finalLinks.length}개`);

// ────────────────────────────────────────────────────────────────────
// 항목이 바뀌면 새 탭으로 — 옛 줄이 어긋나지 않아야 한다
//
// 예전에는 항목 설정이 바뀌면 그 달 탭의 2행 헤더를 최신으로 덮어썼다.
// 아래 줄들은 옛 항목 순서 그대로인데 머리만 바뀌니, 열 이름과 값이
// 통째로 어긋났다. 실제로 시트에서 그 일이 났다.
// ────────────────────────────────────────────────────────────────────
const H1 = ['작성일시', '작성자', '식당명', '오류 코드'];
const H2 = ['작성일시', '작성자', '식당명', '오류 코드', '조치 내용'];

call({ sheetName: '2099-01', headers: H1,
       row: ['2099-01-05 10:00', '김현장', '옥동식', 'E-1'] });
call({ sheetName: '2099-01', headers: H1,
       row: ['2099-01-06 10:00', '김현장', '미트로', 'E-2'] });

const tab1 = ss.getSheetByName('2099-01');
check('같은 항목이면 같은 탭에 이어 붙인다', tab1.getLastRow() === 4,
      `${tab1.getLastRow()}행`);

const headerBefore = tab1.getRange(2, 1, 1, H1.length).getValues()[0].join('|');

// 항목을 하나 더한 채로 올린다 → 새 탭으로 가야 한다
const moved = call({ sheetName: '2099-01', headers: H2,
                     row: ['2099-01-07 10:00', '김현장', '한솔', 'E-3', '패드 교체'] });

check('항목이 바뀌면 옛 탭의 머리를 건드리지 않는다',
      tab1.getRange(2, 1, 1, H1.length).getValues()[0].join('|') === headerBefore,
      headerBefore);
check('옛 탭에 줄이 늘지 않는다', tab1.getLastRow() === 4, `${tab1.getLastRow()}행`);

const tab2 = ss.getSheetByName('2099-01 (2)');
check('항목이 바뀌면 새 탭을 만든다', !!tab2,
      ss.getSheets().map((x) => x.getName()).join(' | '));
check('새 탭이 응답에 실린다', moved.sheetName === '2099-01 (2)', String(moved.sheetName));
check('새 탭의 머리는 새 항목이다',
      tab2.getRange(2, 1, 1, H2.length).getValues()[0].join('|') === H2.join('|'));

// 다시 옛 항목으로 올리면 **옛 탭으로 되돌아간다**
call({ sheetName: '2099-01', headers: H1,
       row: ['2099-01-08 10:00', '김현장', '옥동식', 'E-4'] });
check('옛 항목은 옛 탭으로 되돌아간다', tab1.getLastRow() === 5, `${tab1.getLastRow()}행`);
check('그 사이 새 탭은 늘지 않는다', tab2.getLastRow() === 3, `${tab2.getLastRow()}행`);

// 이력 화면이 갈라진 탭도 월 목록에서 본다
const months = call({ reports: 'months' }).months || [];
check('월 목록에 갈라진 탭도 나온다',
      months.indexOf('2099-01') >= 0 && months.indexOf('2099-01 (2)') >= 0,
      months.join(' | '));

// ────────────────────────────────────────────────────────────────────
// 리포트 항목 설정도 시트로 주고받는다 (팀 공통)
// ────────────────────────────────────────────────────────────────────
const FIELDS = [
  { id: 'f1', fieldLabel: '방문 식당명', fieldType: 'TEXT', options: '', isRequired: true },
  { id: 'f2', fieldLabel: '오류 코드', fieldType: 'TEXT', options: '', isRequired: false },
  { id: 'f3', fieldLabel: '처리 결과', fieldType: 'DROPDOWN',
    options: '완료,모니터링', isRequired: true },
];
let fr = call({ fields: 'push', items: FIELDS });
check('항목 설정을 시트에 올린다', fr.ok === true && fr.count === 3, JSON.stringify(fr));

const fieldSheet = ss.getSheetByName('리포트 항목');
check('[리포트 항목] 탭이 생긴다', !!fieldSheet,
      ss.getSheets().map((x) => x.getName()).join(' | '));
check('머리는 2행에 있다',
      fieldSheet.getRange(2, 1, 1, 5).getValues()[0][0] === '항목명');

fr = call({ fields: 'pull' });
check('올린 그대로 다시 읽힌다', (fr.items || []).length === 3, JSON.stringify(fr.items));
check('종류·선택지·필수가 살아 있다',
      fr.items[2].fieldType === 'DROPDOWN'
      && fr.items[2].options === '완료,모니터링'
      && fr.items[2].isRequired === true
      && fr.items[1].isRequired === false,
      JSON.stringify(fr.items[2]));
check('시트에 적힌 순서가 곧 열 순서다',
      fr.items.map((f) => f.displayOrder).join(',') === '1,2,3');
check('ID 가 그대로 돌아온다', fr.items[0].id === 'f1', fr.items[0].id);

// 항목을 하나 빼고 다시 올리면 그 줄이 사라진다 (옛 줄이 남으면 안 된다)
const shrink = call({ fields: 'push', items: FIELDS.slice(0, 2) });
check('항목을 빼고 올려도 오류가 없다', shrink.ok === true, JSON.stringify(shrink));
fr = call({ fields: 'pull' });
check('뺀 항목은 시트에서도 빠진다', (fr.items || []).length === 2,
      (fr.items || []).map((f) => f.fieldLabel).join(' | '));

console.log('='.repeat(62));
if (failures.length) {
  console.log(`❌ 실패 ${failures.length}건: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('✅ 전부 통과 — Apps Script 가 실제로 동작합니다.');
