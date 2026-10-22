/**
 * 가짜 Apps Script 실행 환경 — google-apps-script.gs 를 **그대로** 돌린다.
 *
 * 두 곳에서 쓴다.
 *   - tests/test_apps_script.mjs : 시트 코드 단위 검사
 *   - tools/fake_sheet_server.mjs : 개발·E2E 용 가짜 시트 서버 (팀 시트에 안 닿는다)
 *
 * createFakeGas() 를 부를 때마다 빈 스프레드시트 하나가 새로 생긴다.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createFakeGas() {
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
    /**
     * 서식 있는 값 — 주소를 **누를 수 있는 링크**로 넣을 때 쓴다.
     * 가짜에 없으면 writeLinkCell 이 조용히 catch 로 떨어져, 칸이 검은
     * 글씨로 남는데도 검사는 통과해 버린다.
     */
    setRichTextValue(value) {
      this.sheet._set(this.row, this.col, value.getText());
      this.sheet.links.set(`${this.row},${this.col}`, value.getLinks());
      return this;
    }
    setFontWeight() { return this; }
    setFontSize() { return this; }
    setBackground() { return this; }
    setVerticalAlignment() { return this; }
    setWrap() { return this; }
    setNumberFormat() { return this; }
  }

  class FakeSheet {
    constructor(name, sheetId = 0) {
      this.name = name;
      this.sheetId = sheetId;
      this.cells = new Map();
      this.links = new Map();     // '행,열' → [{ start, end, url }]
    }
    getSheetId() { return this.sheetId; }
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
    getMaxColumns() { return Math.max(this.getLastColumn(), 26); }
    insertColumnsAfter() { return this; }     // 가짜 그리드는 폭 제한이 없다
    /**
     * 열 끼워 넣기 — 새 리포트 항목이 제자리에 열을 만들 때 쓴다.
     * at번째 열 자리에 빈 열이 생기고, at 이상이던 열은 오른쪽으로 한 칸 민다.
     * 가짜에 없으면 이걸 쓰는 코드가 "is not a function" 으로 터진다.
     */
    insertColumnBefore(at) {
      const shift = (map) => {
        const next = new Map();
        for (const [k, v] of map) {
          const [r, c] = k.split(',').map(Number);
          next.set(`${r},${c >= at ? c + 1 : c}`, v);
        }
        return next;
      };
      this.cells = shift(this.cells);
      this.links = shift(this.links);
      return this;
    }
    insertColumnAfter(pos) { return this.insertColumnBefore(pos + 1); }
  }

  class FakeSpreadsheet {
    constructor() { this.sheets = []; this.active = null; }
    getName() { return '테스트 시트'; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/test/edit'; }
    getId() { return 'testid'; }
    getSheets() { return [...this.sheets]; }
    getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
    /**
     * 진짜처럼 자리를 흉내 낸다 — index 가 없으면 **활성 탭 바로 뒤**에 끼운다.
     * 예전 가짜는 늘 맨 뒤에 붙여서, 새 탭이 앞쪽에 끼어드는 실제 현상을 못 잡았다.
     */
    insertSheet(name, index) {
      const s = new FakeSheet(name);
      let at = this.sheets.length;
      if (typeof index === 'number') at = Math.max(0, Math.min(index, this.sheets.length));
      else if (this.active) at = this.sheets.indexOf(this.active) + 1;
      this.sheets.splice(at, 0, s);
      this.active = s;
      return s;
    }
    setActiveSheet(sheet) { this.active = sheet; return this; }
    moveActiveSheet(pos) {
      const i = this.sheets.indexOf(this.active);
      if (i < 0) return this;
      this.sheets.splice(i, 1);
      this.sheets.splice(Math.max(0, pos - 1), 0, this.active);
      return this;
    }
    /** 검사용 — 사람이 손으로 탭을 옮긴 것처럼 순서를 뒤섭는다 */
    _shuffle(names) { this.sheets = names.map((n) => this.getSheetByName(n)).filter(Boolean); }
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
      /** 실제 Folder 에 있는 훑기 메서드 — 사진 공개 복구가 이걸 쓴다. */
      getFolders() {
        const list = [...folder.folders.values()];
        let at = 0;
        return { hasNext: () => at < list.length, next: () => list[at++] };
      },
      getFiles() {
        const list = [...folder.files];
        let at = 0;
        return { hasNext: () => at < list.length, next: () => list[at++] };
      },
      createFile(blob) {
        const file = {
          // 진짜 드라이브 id 처럼 공백·슬래시 없는 문자열이어야 한다.
          // 경로를 그대로 넣으면 주소에 공백이 섞여, 주소를 공백 기준으로
          // 자르는 코드가 통과해 버린다 (실제로 그렇게 못 잡았다).
          id: `f${allFiles.size}${path.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 33),
          name: blob.name, mime: blob.mime, path,
          getUrl() { return `https://drive.google.com/file/d/${file.id}/view`; },
          getId: () => file.id,
          getName: () => file.name,
          getMimeType: () => blob.mime,
          // 공유 드라이브에서는 이 호출이 조직 정책으로 **막힌다.**
          // 예전 코드는 실패를 조용히 삼켜서 사진이 비공개로 남았고,
          // 팀 전체가 액박을 봤다. 그 상황을 그대로 만들어 둔다.
          setSharing() {
            if (SHARED_DRIVE_BLOCKS_LINK_SHARING) {
              throw new Error('Access denied: cannot change sharing setting');
            }
            file.access = 'anyone';
            return file;
          },
          getSharingAccess: () => file.access || 'private',
          getSize: () => (blob._bytes && blob._bytes.length) || 1024,
          getBlob: () => blob,
          getThumbnail: () => ({
            _bytes: [1, 2, 3, 4], mime: 'image/png', name: `${blob.name}.thumb.png`,
            getBytes: () => [1, 2, 3, 4],
            getContentType: () => 'image/png',
          }),
          getParents: () => ({ hasNext: () => false }),
          // 설치용 APK 는 같은 파일의 **내용만** 갈아 끼운다. 그 길에 쓰인다.
          setName(value) { file.name = value; blob.name = value; return file; },
          isTrashed: () => Boolean(file.trashed),
          setTrashed(value) { file.trashed = value; return file; },
        };
        folder.files.push(file);
        allFiles.set(file.id, file);
        return file;
      },
    };
    return folder;
  }

  const allFiles = new Map();

  // 스프레드시트 파일 자체 — "마지막으로 바뀐 시각" 을 묻는 갈래가 이것을 본다.
  // 검사에서 시각을 바꿔 가며 앱이 '새 내용' 을 알아보는지 확인한다.
  let spreadsheetUpdatedAt = new Date(2026, 8, 14, 9, 0, 0);
  allFiles.set('testid', { getId: () => 'testid', getName: () => '테스트 시트',
                           getLastUpdated: () => spreadsheetUpdatedAt });

  // 검사마다 켜고 끈다. true = 공유 드라이브가 링크 공개를 막는 현장.
  let SHARED_DRIVE_BLOCKS_LINK_SHARING = false;

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

  // ─────────────────────────────────────────────── 가짜 Blob · 내려받기 · 속성
  //
  // APK 를 드라이브의 고정 파일에 갈아 끼우는 길에 필요한 것들.
  // 진짜 Blob 은 setName · setContentType 이 **자기를 돌려준다.** 가짜에 없으면
  // `resp.getBlob().setName(...)` 이 undefined 가 되어 뒤가 조용히 무너진다.

  function makeBlob(bytes, mime, name) {
    const blob = {
      _bytes: bytes, mime, name,
      getBytes: () => blob._bytes,
      getContentType: () => blob.mime,
      getName: () => blob.name,
      setName(value) { blob.name = value; return blob; },
      setContentType(value) { blob.mime = value; return blob; },
    };
    return blob;
  }

  /** 검사에서 바꿔 끼운다 — { code, bytes } */
  let fetchAnswer = { code: 200, bytes: null };
  const fetchCalls = [];

  const fakeUrlFetch = {
    fetch(url, opts) {
      fetchCalls.push({ url, opts });
      const bytes = fetchAnswer.bytes || new Array(3_000_000).fill(7);
      return {
        getResponseCode: () => fetchAnswer.code,
        getBlob: () => makeBlob(bytes, 'application/octet-stream', 'download'),
        getContentText: () => 'text',
      };
    },
  };

  const scriptProps = new Map();
  const fakeProperties = {
    getScriptProperties: () => ({
      getProperty: (k) => (scriptProps.has(k) ? scriptProps.get(k) : null),
      setProperty(k, v) { scriptProps.set(k, String(v)); return this; },
      deleteProperty(k) { scriptProps.delete(k); return this; },
    }),
  };

  /**
   * 고급 드라이브 서비스 — **Files 만** 둔다.
   *
   * 파일 ID 를 그대로 두고 내용만 바꾸는 길(Files.update)은 이것 말고 방법이 없다.
   * Permissions 는 일부러 비워 둔다: 사진 공개는 setSharing 쪽 검사가 이미
   * 공유 드라이브 정책까지 흉내 내고 있어, 여기서 켜면 그 검사가 무력해진다.
   */
  let driveUpdateFails = false;
  const driveUpdates = [];
  const fakeAdvancedDrive = {
    Files: {
      update(resource, fileId, blob) {
        if (driveUpdateFails) throw new Error('Access denied: cannot update file');
        const file = allFiles.get(fileId);
        if (!file) throw new Error('없는 파일입니다: ' + fileId);
        file._blob = blob;
        driveUpdates.push({ fileId, bytes: (blob.getBytes() || []).length });
        return { id: fileId };
      },
    },
  };

  // ─────────────────────────────────────────────── 실제 .gs 를 불러온다

  const source = readFileSync(join(ROOT, 'google-apps-script.gs'), 'utf8');
  const ss = new FakeSpreadsheet();

  // 소비자 앱 스프레드시트 — 리포트 번호 목록은 여기서 읽어 간다.
  // gid 로 탭을 찾으므로 이름은 일부러 다르게 둔다.
  const CONSUMER_ID = '1ZUsgwFVX1O97778MKoedU2f-UsnShRcrI85o5WNICwo';
  const consumerSS = new FakeSpreadsheet();
  {
    const tab = new FakeSheet('아무 이름', 1882930844);
    // '콘솔상태' 는 일부러 띄어쓰기 없이 둔다 — 낱말로 찾는지 함께 본다.
    const rows = [
      ['접수시각', '리포트번호', '매장명', '작성 내용', '선택한 문제', '문제ID',
       '조치결과', '콘솔상태'],
      ['2026. 9. 12', 'P260912-01', '홍기와', '', '바퀴에서 소리가 나요', 'wheel', '필드팀 요청', '대기'],
      ['2026. 9. 13', 'P260913-01', '옥동식', '', '와이파이가 끊겨요', 'net', '현장 해결', '대기'],
      ['2026. 9. 14', 'P260914-01', '테스트', '', '멈춰 있어요', 'stall', '필드팀 요청', '대기'],
      ['2026. 9. 15', '', '빈번호', '', '번호가 없는 줄', 'x', '필드팀 요청', '대기'],
      // 아직 안 끝난 건 — '진행 중' 처럼 띄어 써도 걸려야 한다
      ['2026. 9. 15', 'P260915-07', '진행중곳', '', '손보는 중', 'wip', '필드팀 요청', '진행 중'],
      // 필드팀 요청이지만 콘솔에서 끝난 건 — 목록에 들어오면 안 된다
      ['2026. 9. 15', 'P260915-09', '처리된곳', '', '이미 처리됨', 'done', '필드팀 요청', '조치 완료'],
    ];
    rows.forEach((line, r) => line.forEach((v, c) => tab._set(r + 1, c + 1, v)));
    consumerSS.sheets.push(tab);
  }

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: (id) => {
        if (id === CONSUMER_ID) return consumerSS;
        throw new Error(`열 수 없는 문서: ${id}`);
      },
      flush: () => {},
      MimeType: { JSON: 'application/json' },
      /** 주소를 파란 링크로 넣을 때 쓰는 값 만들기 (실제 API 와 같은 모양) */
      newRichTextValue: () => {
        let text = '';
        const links = [];
        const builder = {
          setText(value) { text = String(value); return builder; },
          setLinkUrl(start, end, url) { links.push({ start, end, url }); return builder; },
          build: () => ({ getText: () => text, getLinks: () => links }),
        };
        return builder;
      },
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    ContentService: {
      createTextOutput: (text) => ({ _text: text, setMimeType() { return this; } }),
      MimeType: { JSON: 'application/json' },
    },
    DriveApp: makeDrive(),
    UrlFetchApp: fakeUrlFetch,
    PropertiesService: fakeProperties,
    Drive: fakeAdvancedDrive,
    Utilities: {
      base64Decode: (text) => ({ _b64: text, length: String(text).length }),
      newBlob: (bytes, mime, name) => makeBlob(bytes, mime, name),
      base64Encode: (bytes) => `b64(${(bytes && bytes.length) || 0})`,
      /**
       * 무늬(pattern)를 실제로 따른다.
       * 예전 가짜는 무엇을 물어도 '2099-01-01 09:00' 을 돌려줬다. 그래서 날짜만
       * 쓰는 코드(운행일지)가 시간까지 붙은 글자를 받아도 검사가 통과해 버렸다.
       */
      formatDate: (d, tz, pattern) => {
        const date = d instanceof Date ? d : new Date(2099, 0, 1, 9, 0);
        const pad = (n) => String(n).padStart(2, '0');
        return String(pattern || 'yyyy-MM-dd HH:mm')
          .replace('yyyy', date.getFullYear())
          .replace('MM', pad(date.getMonth() + 1))
          .replace('dd', pad(date.getDate()))
          .replace('HH', pad(date.getHours()))
          .replace('mm', pad(date.getMinutes()));
      },
    },
  };

  // json() 이 돌려주는 값을 그대로 읽을 수 있게 감싼다
  const wrapper = `
    ${source}
    return { doPost: doPost, readGuideSheet: readGuideSheet,
             GUIDE_HEADER: GUIDE_HEADER, GUIDE_SHEETS: GUIDE_SHEETS,
             RELEASE_HEADER: RELEASE_HEADER, compareVersions: compareVersions,
             readInventory: readInventory,
             isReleasePublic: isReleasePublic };
  `;
  const factory = new Function(...Object.keys(sandbox), wrapper);
  const gs = factory(...Object.values(sandbox));

  function call(body) {
    const res = gs.doPost({ postData: { contents: JSON.stringify(body) } });
    return JSON.parse(res._text);
  }

  return {
    gs, ss, consumerSS, call, findPath, allFiles, fetchCalls, driveUpdates, scriptProps,
    FakeSheet, FakeSpreadsheet,
    get driveTree() { return driveTree; },
    set blockSharing(v) { SHARED_DRIVE_BLOCKS_LINK_SHARING = v; },
    set fetchAnswer(v) { fetchAnswer = v; },
    set driveUpdateFails(v) { driveUpdateFails = v; },
    get updatedAt() { return spreadsheetUpdatedAt; },
    set updatedAt(v) { spreadsheetUpdatedAt = v; },
  };
}
