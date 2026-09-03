/**
 * 로봇 현장 대응 포털 → 구글 스프레드시트 기록 스크립트
 *
 * ▣ 설치 방법 (2분, 스프레드시트 편집 권한만 있으면 됨)
 *  1. 대상 스프레드시트를 연다
 *     https://docs.google.com/spreadsheets/d/1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4/edit
 *  2. 상단 메뉴 [확장 프로그램] → [Apps Script]
 *  3. 기본 코드(Code.gs)를 모두 지우고 이 파일 내용을 붙여넣기 → 저장(💾)
 *  4. 우측 상단 [배포] → [새 배포] → 유형 선택 ⚙️ → [웹 앱]
 *       - 설명        : 현장 리포트 수집
 *       - 실행 사용자 : 나
 *       - 액세스 권한 : 모든 사용자          ← 반드시 이걸로
 *  5. [배포] → 권한 승인(본인 구글 계정) → 표시되는 **웹 앱 URL 복사**
 *       (https://script.google.com/macros/s/.../exec 형태)
 *  6. 앱의 [⚙️ 설정 → 구글 시트 연결] 에 그 URL 을 붙여넣고 저장 → [연결 테스트]
 *
 * ▣ 기록 방식
 *  - 월마다 새 시트를 만든다 (시트 이름 = YYYY-MM, 예: 2026-08)
 *  - 1행 : 비워 둠
 *  - 2행 : 항목명(헤더)
 *  - 3행부터 : 리포트 내용이 한 줄씩 쌓임
 *  - 현장 사진은 링크가 아니라 **이미지 자체**를 해당 칸에 삽입한다
 */

var IMAGE_HEIGHT = 110;      // 시트에 표시할 사진 높이(px)
var IMAGE_GAP = 8;

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 연결 테스트
    if (body.ping) {
      var names = ss.getSheets().map(function (s) { return s.getName(); });
      return json({
        ok: true,
        spreadsheetName: ss.getName(),
        spreadsheetUrl: ss.getUrl(),
        sheets: names,
        drive: driveSpace()
      });
    }

    // 남은 용량만 따로 (설정 화면·업로드 전 확인용)
    if (body.drive === 'space') {
      return json({ ok: true, drive: driveSpace() });
    }

    // 차량 재고 동기화 — '차량재고' 탭을 팀 공유 저장소로 쓴다.
    if (body.inventory) {
      return handleInventory(ss, body);
    }

    // 가이드 열람용 탭 — 앱의 가이드 3종을 카테고리별 탭으로 내보낸다 (읽기 전용).
    if (body.guides) {
      return handleGuides(ss, body);
    }

    // 리포트 항목 설정 — 팀 전체가 같은 항목을 쓰도록 시트에 둔다.
    if (body.fields) {
      return handleFields(ss, body);
    }

    // 리포트 이력 — 월별 탭을 앱으로 읽어 오고, 상태 칸을 고쳐 쓴다.
    if (body.reports) {
      return handleReports(ss, body);
    }

    // 첨부 파일 종류 확인 (사진 / 영상)
    if (body.drive === 'info') {
      return handleDriveInfo(body);
    }

    var sheetName = String(body.sheetName || '').trim();
    var headers = body.headers || [];
    var row = body.row || [];
    if (!sheetName) return json({ ok: false, error: 'sheetName 이 없습니다.' });
    if (!row.length) return json({ ok: false, error: 'row 가 비어 있습니다.' });

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);            // 동시에 여러 명이 올려도 줄이 섞이지 않게
    try {
      // 이미 있는 탭의 **헤더는 절대 고쳐 쓰지 않는다.**
      //
      // 예전에는 항목 설정이 바뀌면 2행 헤더를 최신으로 덮어썼다. 그러면
      // 그 아래 이미 쌓여 있던 줄들은 **옛 항목 순서로 적힌 채** 새 헤더를
      // 뒤집어써서, 열 이름과 값이 통째로 어긋났다. 실제로 그런 일이 있었다.
      //
      // 항목이 달라졌으면 그 달의 **다음 탭**(2026-09 (2) …)에 새로 시작한다.
      // 옛 탭은 옛 항목 그대로 남아 계속 읽을 수 있다.
      var sheet = pickReportSheet(ss, sheetName, headers);
      var created = sheet.created;
      sheetName = sheet.name;
      sheet = sheet.sheet;

      // 3행부터 채운다 (2행 헤더 아래)
      var lastRow = sheet.getLastRow();
      var target = lastRow < 2 ? 3 : lastRow + 1;
      if (target < 3) target = 3;

      // 사진·영상은 드라이브 폴더에 저장하고, 칸에는 링크만 넣는다.
      // (시트에 박아 넣으면 영상이 안 되고 앱이 되읽을 수도 없다)
      var saved = saveMediaToDrive(ss, body.media || []);
      for (var col in saved.byColumn) {
        row[Number(col) - 1] = saved.byColumn[col].join('\n');
      }

      sheet.getRange(target, 1, 1, row.length).setValues([row]);
      sheet.getRange(target, 1, 1, row.length)
        .setVerticalAlignment('top')
        .setWrap(true);

      // 예전 앱(빌드 9 이하)이 보낸 사진은 지금까지처럼 칸에 그림으로 삽입한다.
      var inserted = insertImages(sheet, body.images || [], target);

      SpreadsheetApp.flush();
      return json({
        ok: true,
        sheetName: sheetName,
        row: target,
        created: created,
        images: inserted,
        media: saved.count,
        mediaSkipped: saved.skipped,
        // false 면 공유 드라이브에 못 닿아 개인 드라이브로 갔다는 뜻이다.
        mediaShared: saved.shared !== false,
        spreadsheetUrl: ss.getUrl()
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/**
 * 전송받은 사진(base64)을 시트에 이미지로 넣는다.
 * 같은 칸에 여러 장이면 가로로 나란히 배치한다.
 */
function insertImages(sheet, images, rowIndex) {
  if (!images.length) return 0;

  var offsets = {};      // 열별 가로 위치
  var count = 0;

  for (var i = 0; i < images.length; i++) {
    var image = images[i];
    try {
      var bytes = Utilities.base64Decode(image.data);
      var blob = Utilities.newBlob(bytes, image.mimeType || 'image/jpeg',
                                   image.filename || ('photo' + i + '.jpg'));
      var column = image.column || 1;
      var offsetX = offsets[column] || 5;

      var picture = sheet.insertImage(blob, column, rowIndex, offsetX, 5);
      // 비율을 유지하며 높이를 맞춘다
      var ratio = picture.getWidth() / picture.getHeight();
      var width = Math.round(IMAGE_HEIGHT * ratio);
      picture.setHeight(IMAGE_HEIGHT);
      picture.setWidth(width);

      offsets[column] = offsetX + width + IMAGE_GAP;
      if (sheet.getColumnWidth(column) < offsets[column] + 10) {
        sheet.setColumnWidth(column, offsets[column] + 10);
      }
      count++;
    } catch (err) {
      // 한 장이 실패해도 나머지는 계속 삽입
    }
  }

  if (count) {
    sheet.setRowHeight(rowIndex, IMAGE_HEIGHT + 12);
  }
  return count;
}

/**
 * 이 리포트를 어느 탭에 적을지 고른다.
 *
 *  - 그 달 탭이 없으면 만든다
 *  - 있고 **항목이 같으면** 그 탭에 이어 붙인다
 *  - 있는데 **항목이 다르면** `2026-09 (2)`, `(3)` … 순으로 옮겨 간다
 *    (같은 항목을 쓰는 탭이 이미 있으면 거기에 이어 붙인다)
 *
 * 반환: { sheet, name, created }
 */
function pickReportSheet(ss, baseName, headers) {
  var want = headerKey(headers);
  for (var n = 1; n <= 50; n++) {
    var name = (n === 1) ? baseName : (baseName + ' (' + n + ')');
    var sheet = ss.getSheetByName(name);

    if (!sheet) {                       // 빈자리 — 여기에 새로 만든다
      sheet = ss.insertSheet(name);
      writeHeaders(sheet, headers);     // 1행은 비우고 2행에 항목명
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(1);            // 최근 것이 앞에 오도록
      return { sheet: sheet, name: name, created: true };
    }

    var have = headerKey(readHeaderRow(sheet));
    // 헤더가 아직 비어 있으면(사람이 손으로 만든 탭) 지금 것으로 채운다.
    if (!have) {
      writeHeaders(sheet, headers);
      return { sheet: sheet, name: name, created: false };
    }
    if (!want || have === want) {
      return { sheet: sheet, name: name, created: false };
    }
    // 항목이 다르다 — 다음 번호를 본다
  }
  throw new Error('같은 달에 탭이 너무 많습니다. 시트를 정리해 주세요.');
}

/** 2행(항목명)을 읽는다. 없으면 빈 배열. */
function readHeaderRow(sheet) {
  var lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() < 2 || lastCol < 1) return [];
  var values = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  while (values.length && String(values[values.length - 1]).trim() === '') values.pop();
  return values;
}

/** 항목 목록을 비교하기 좋은 한 줄로 만든다. 빈 목록은 빈 문자열. */
function headerKey(headers) {
  if (!headers || !headers.length) return '';
  var parts = [];
  for (var i = 0; i < headers.length; i++) {
    parts.push(String(headers[i]).trim());
  }
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts.join('');
}

function writeHeaders(sheet, headers) {
  if (!headers || !headers.length) return;
  var range = sheet.getRange(2, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold');
  range.setBackground('#eef1f5');
  sheet.setFrozenRows(2);
  for (var i = 1; i <= headers.length; i++) {
    var width = sheet.getColumnWidth(i);
    if (width < 140) sheet.setColumnWidth(i, 140);
  }
}

/* ============================================================ 차량 재고
 *
 * '차량재고' 탭 하나를 팀 공유 저장소로 쓴다.
 *  - 1행 : 비워 둠 (리포트 시트와 동일한 규칙)
 *  - 2행 : 부품명 | 최소보유 | <차량 이름들...>
 *  - 3행부터 : 부품 한 줄씩. 품목은 모든 차량 공용이고 수량만 차량별이다.
 *    (수량 칸이 비어 있으면 0 으로 처리한다)
 *
 * 시트에서 직접 고쳐도 된다 — 차량 이름(열 제목)·품목·수량·최소보유 전부.
 * 앱이 재고 화면을 열 때 이 탭 내용을 받아 간다.
 *
 * 앱이 보내는 요청 (doPost body):
 *  { inventory: 'pull' }                              → 현재 상태 반환
 *  { inventory: 'push', vehicles: [...], items: [...] } → 탭 전체를 앱 내용으로 교체
 *  { inventory: 'qty',  ops: [{vehicleName, partName, quantity}, ...] }
 *                                                     → 수량 칸만 갱신 (즉시 공유)
 */
var INV_SHEET_NAME = '차량재고';
var INV_HEADER_ROW = 2;
var INV_DATA_ROW = 3;
var INV_FIXED = 2;                 // 고정 열: 부품명 · 최소보유

function handleInventory(ss, body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ss.getSheetByName(INV_SHEET_NAME);

    if (body.inventory === 'push') {
      if (!sheet) sheet = ss.insertSheet(INV_SHEET_NAME);
      writeInventory(sheet, body.vehicles || [], body.items || []);
      SpreadsheetApp.flush();
      return json(readInventory(sheet));
    }

    if (body.inventory === 'qty') {
      if (!sheet) sheet = ss.insertSheet(INV_SHEET_NAME);
      applyQuantityOps(sheet, body.ops || []);
      SpreadsheetApp.flush();
      return json(readInventory(sheet));
    }

    // pull
    if (!sheet) return json({ ok: true, exists: false, vehicles: [], items: [] });
    return json(readInventory(sheet));
  } finally {
    lock.releaseLock();
  }
}

/** 탭 전체를 앱이 보낸 상태로 교체한다. */
function writeInventory(sheet, vehicles, items) {
  var names = [];
  for (var i = 0; i < vehicles.length; i++) {
    var v = String(vehicles[i] || '').trim();
    if (v && names.indexOf(v) < 0) names.push(v);
  }

  var parts = [];                    // 부품명 등장 순서 유지
  var minByPart = {};                // 부품별 최소보유 (차량별 값 중 최댓값)
  var qty = {};                      // '<차량>+<부품>' → 수량
  for (var j = 0; j < items.length; j++) {
    var item = items[j] || {};
    var vehicle = String(item.vehicleName || '').trim();
    var part = String(item.partName || '').trim();
    if (!vehicle || !part) continue;
    if (names.indexOf(vehicle) < 0) names.push(vehicle);
    if (parts.indexOf(part) < 0) parts.push(part);
    var minq = Math.max(0, Math.floor(Number(item.minQuantity) || 0));
    if (!(part in minByPart) || minq > minByPart[part]) minByPart[part] = minq;
    qty[vehicle + '\u0000' + part] = Math.max(0, Math.floor(Number(item.quantity) || 0));
  }

  sheet.clearContents();
  var header = ['부품명', '최소보유'].concat(names);
  var range = sheet.getRange(INV_HEADER_ROW, 1, 1, header.length);
  range.setValues([header]);
  range.setFontWeight('bold');
  range.setBackground('#eef1f5');
  sheet.setFrozenRows(INV_HEADER_ROW);
  for (var c = 1; c <= header.length; c++) {
    if (sheet.getColumnWidth(c) < 120) sheet.setColumnWidth(c, 120);
  }

  if (parts.length) {
    var rows = [];
    for (var p = 0; p < parts.length; p++) {
      var row = [parts[p], minByPart[parts[p]] || 0];
      for (var n = 0; n < names.length; n++) {
        var key = names[n] + '\u0000' + parts[p];
        row.push(key in qty ? qty[key] : 0);
      }
      rows.push(row);
    }
    sheet.getRange(INV_DATA_ROW, 1, rows.length, header.length).setValues(rows);
  }
}

/** 탭 내용을 앱이 이해하는 구조로 읽는다. */
function readInventory(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < INV_HEADER_ROW || lastCol < 1) {
    return { ok: true, exists: true, vehicles: [], items: [] };
  }

  var header = sheet.getRange(INV_HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var columns = [];                  // [{name, index(0-based)}]
  var vehicles = [];
  for (var c = INV_FIXED; c < header.length; c++) {
    var name = String(header[c] || '').trim();
    if (!name) continue;
    columns.push({ name: name, index: c });
    vehicles.push(name);
  }

  var items = [];
  if (lastRow >= INV_DATA_ROW) {
    var data = sheet.getRange(INV_DATA_ROW, 1,
                              lastRow - INV_DATA_ROW + 1, lastCol).getValues();
    for (var r = 0; r < data.length; r++) {
      var part = String(data[r][0] || '').trim();
      if (!part) continue;
      var minq = Math.max(0, Math.floor(Number(data[r][1]) || 0));
      for (var i = 0; i < columns.length; i++) {
        // 품목은 모든 차량 공용 — 빈 칸은 수량 0 으로 읽는다.
        var cell = data[r][columns[i].index];
        var qtyValue = (cell === '' || cell === null || cell === undefined)
          ? 0 : Math.max(0, Math.floor(Number(cell) || 0));
        items.push({
          vehicleName: columns[i].name,
          partName: part,
          quantity: qtyValue,
          minQuantity: minq,
        });
      }
    }
  }
  return { ok: true, exists: true, vehicles: vehicles, items: items };
}

/** [-]/[+] 수량 변경을 해당 칸에 바로 기록한다. */
function applyQuantityOps(sheet, ops) {
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i] || {};
    if (op.type === 'quantity-delete') continue;   // 품목 삭제는 push 가 처리한다
    var vehicle = String(op.vehicleName || '').trim();
    var part = String(op.partName || '').trim();
    if (!vehicle || !part) continue;

    var lastCol = Math.max(sheet.getLastColumn(), INV_FIXED);
    var header = sheet.getRange(INV_HEADER_ROW, 1, 1, lastCol).getValues()[0];
    var col = -1;
    for (var c = INV_FIXED; c < header.length; c++) {
      if (String(header[c] || '').trim() === vehicle) { col = c + 1; break; }
    }
    if (col < 0) {                   // 시트에 없는 차량이면 열을 추가한다
      col = lastCol + 1;
      var head = sheet.getRange(INV_HEADER_ROW, col);
      head.setValue(vehicle);
      head.setFontWeight('bold');
      head.setBackground('#eef1f5');
    }

    var lastRow = sheet.getLastRow();
    var row = -1;
    if (lastRow >= INV_DATA_ROW) {
      var partsCol = sheet.getRange(INV_DATA_ROW, 1,
                                    lastRow - INV_DATA_ROW + 1, 1).getValues();
      for (var r = 0; r < partsCol.length; r++) {
        if (String(partsCol[r][0] || '').trim() === part) {
          row = INV_DATA_ROW + r;
          break;
        }
      }
    }
    if (row < 0) {                   // 시트에 없는 품목이면 줄을 추가한다
      row = Math.max(lastRow + 1, INV_DATA_ROW);
      sheet.getRange(row, 1).setValue(part);
      sheet.getRange(row, 2).setValue(0);
    }

    sheet.getRange(row, col).setValue(Math.max(0, Math.floor(Number(op.quantity) || 0)));
  }
}

/* ============================================================ 가이드 열람용 탭
 *
 * 앱의 가이드 3종을 카테고리별 탭으로 통째로 다시 쓴다 (앱 → 시트 단방향).
 * 시트에서 직접 고쳐도 앱에는 반영되지 않는다 — 가이드 편집은 앱에서 한다.
 *  - 1행 : 비워 둠 / 2행 : 헤더 / 3행부터 : 가이드 한 줄씩
 *  - 명령어·단계는 한 칸에 줄바꿈으로 나열한다
 */
var GUIDE_SHEETS = {
  ERROR_CODE: '오류 코드 가이드',
  HARDWARE_SOP: '하드웨어 교체 SOP',
  SOFTWARE_CMD: 'SW·명령어',
};
/** 줄바꿈 한 글자. 시트 칸 안에서 명령어·단계를 나누는 기준이다. */
var NEWLINE = String.fromCharCode(10);

var GUIDE_ID_HEADER = 'ID(고치지 마세요)';
var GUIDE_HEADER = ['코드/제목', '요약', '필요 공구', '명령어', '단계', '수정일',
                    GUIDE_ID_HEADER];
var GUIDE_WIDTHS = [160, 260, 160, 300, 420, 130, 200];

/* ── 리포트 항목 설정 탭 ──────────────────────────────────────────────
 *
 * 리포트 입력 항목은 **팀 전체가 같아야** 한다. 사람마다 다르면 같은 달
 * 시트가 사람 수만큼 갈라진다. 그래서 가이드처럼 시트에 두고 주고받는다.
 *
 *  - 1행 : 비워 둠 / 2행 : 헤더 / 3행부터 : 항목 한 줄씩
 *  - 맨 뒤 ID 열로 같은 항목을 알아본다 (고치지 말 것)
 */
var FIELD_SHEET = '리포트 항목';
var FIELD_ID_HEADER = 'ID(고치지 마세요)';
var FIELD_HEADER = ['항목명', '종류', '선택지', '필수', FIELD_ID_HEADER];
var FIELD_WIDTHS = [200, 140, 280, 70, 200];

function handleFields(ss, body) {
  if (body.fields === 'pull') {
    var sh = ss.getSheetByName(FIELD_SHEET);
    if (!sh) return json({ ok: true, items: [] });
    return json({ ok: true, items: readFieldSheet(sh) });
  }
  if (body.fields !== 'push') return json({ ok: false, error: '알 수 없는 요청입니다.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    writeFieldSheet(ss, body.items || []);
    return json({ ok: true, count: (body.items || []).length });
  } finally {
    lock.releaseLock();
  }
}

function writeFieldSheet(ss, items) {
  var sheet = ss.getSheetByName(FIELD_SHEET);
  if (!sheet) sheet = ss.insertSheet(FIELD_SHEET);

  var head = sheet.getRange(2, 1, 1, FIELD_HEADER.length);
  head.setValues([FIELD_HEADER]);
  head.setFontWeight('bold').setBackground('#f0f2f6');
  sheet.setFrozenRows(2);
  for (var c = 0; c < FIELD_WIDTHS.length; c++) {
    sheet.setColumnWidth(c + 1, FIELD_WIDTHS[c]);
  }

  var rows = [];
  for (var i = 0; i < items.length; i++) {
    var f = items[i];
    rows.push([
      String(f.fieldLabel || ''),
      String(f.fieldType || 'TEXT'),
      String(f.options || ''),
      f.isRequired ? 'Y' : '',
      String(f.id || ''),
    ]);
  }

  // 값을 먼저 만들고 **그 다음에** 옛 줄을 지운다. 순서가 반대면 쓰다가
  // 실패했을 때 탭이 빈 채로 남는다 (가이드 탭에서 실제로 그랬다).
  var last = sheet.getLastRow();
  if (last >= 3) sheet.getRange(3, 1, last - 2, FIELD_HEADER.length).clearContent();
  if (rows.length) {
    sheet.getRange(3, 1, rows.length, FIELD_HEADER.length).setValues(rows);
  }
}

function readFieldSheet(sheet) {
  var last = sheet.getLastRow();
  if (last < 3) return [];
  var values = sheet.getRange(3, 1, last - 2, FIELD_HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var label = String(r[0] || '').trim();
    if (!label) continue;                       // 빈 줄은 건너뛴다
    out.push({
      id: String(r[4] || '').trim(),
      fieldLabel: label,
      fieldType: String(r[1] || 'TEXT').trim() || 'TEXT',
      options: String(r[2] || '').trim(),
      isRequired: String(r[3] || '').trim().toUpperCase() === 'Y',
      displayOrder: i + 1,                      // 시트에 적힌 순서가 곧 열 순서
    });
  }
  return out;
}

function handleGuides(ss, body) {
  // 시트에서 고친 가이드를 앱으로 돌려준다 (v3.3 — 양방향)
  if (body.guides === 'pull') {
    var out = [];
    for (var t in GUIDE_SHEETS) {
      var sh = ss.getSheetByName(GUIDE_SHEETS[t]);
      if (!sh) continue;
      out = out.concat(readGuideSheet(sh, t));
    }
    return json({ ok: true, items: out });
  }
  if (body.guides !== 'push') return json({ ok: false, error: '알 수 없는 요청입니다.' });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var items = body.items || [];
    var counts = {};
    for (var type in GUIDE_SHEETS) {
      var list = [];
      for (var i = 0; i < items.length; i++) {
        if ((items[i] || {}).categoryType === type) list.push(items[i]);
      }
      list.sort(function (a, b) {
        return String(a.codeOrTitle || '').localeCompare(String(b.codeOrTitle || ''), 'ko');
      });
      writeGuideSheet(ss, GUIDE_SHEETS[type], list);
      counts[type] = list.length;
    }
    SpreadsheetApp.flush();
    return json({ ok: true, counts: counts });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 가이드 탭을 앱이 이해하는 구조로 읽는다 (시트 → 앱).
 *
 * 사람이 시트에서 고친 내용을 되받기 위한 것이다. 명령어·단계는 한 칸에
 * 줄바꿈으로 들어 있으므로 줄 단위로 되돌린다.
 *  - 단계  : "1. 내용  (기준: 값)" 형태를 되짚는다
 *  - 명령어: "이름: 명령  — 설명" 형태를 되짚는다
 * ID 열(맨 뒤, 숨김)로 같은 가이드를 알아본다. 비어 있으면 새 가이드로 본다.
 */
function readGuideSheet(sheet, categoryType) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol < 1) return [];

  var header = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  var idCol = -1;
  for (var c = 0; c < header.length; c++) {
    if (String(header[c] || '').trim() === GUIDE_ID_HEADER) { idCol = c; break; }
  }

  var data = sheet.getRange(3, 1, lastRow - 2, lastCol).getDisplayValues();
  var out = [];
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var title = String(row[0] || '').trim();
    if (!title) continue;

    var commands = [];
    String(row[3] || '').split(NEWLINE).forEach(function (line) {
      var text = line.trim();
      if (!text) return;
      var desc = '';
      var dash = text.indexOf('  — ');
      if (dash >= 0) { desc = text.slice(dash + 4).trim(); text = text.slice(0, dash); }
      var label = '';
      var colon = text.indexOf(': ');
      if (colon >= 0) { label = text.slice(0, colon).trim(); text = text.slice(colon + 2); }
      commands.push({ label: label, cmd: text.trim(), desc: desc });
    });

    var steps = [];
    String(row[4] || '').split(NEWLINE).forEach(function (line) {
      var text = line.trim();
      if (!text) return;
      text = text.replace(/^\d+\.\s*/, '');
      var metric = '';
      var mark = text.indexOf('  (기준: ');
      if (mark >= 0) {
        metric = text.slice(mark + 7).replace(/\)$/, '').trim();
        text = text.slice(0, mark);
      }
      steps.push({ instruction: text.trim(), expectedMetric: metric || null });
    });

    out.push({
      id: idCol >= 0 ? String(row[idCol] || '').trim() : '',
      categoryType: categoryType,
      codeOrTitle: title,
      summary: String(row[1] || '').trim(),
      requiredTools: String(row[2] || '').trim(),
      commands: commands,
      steps: steps,
      updatedAt: String(row[5] || '').trim()
    });
  }
  return out;
}

function writeGuideSheet(ss, name, list) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clearContents();

  var header = sheet.getRange(2, 1, 1, GUIDE_HEADER.length);
  header.setValues([GUIDE_HEADER]);
  header.setFontWeight('bold');
  header.setBackground('#eef1f5');
  sheet.setFrozenRows(2);
  for (var c = 0; c < GUIDE_WIDTHS.length; c++) {
    sheet.setColumnWidth(c + 1, GUIDE_WIDTHS[c]);
  }
  if (!list.length) return;

  var rows = [];
  for (var i = 0; i < list.length; i++) {
    var g = list[i] || {};
    var commands = [];
    var cmdList = g.commands || [];
    for (var j = 0; j < cmdList.length; j++) {
      var cmd = cmdList[j] || {};
      var line = (cmd.label ? cmd.label + ': ' : '') + (cmd.cmd || '');
      if (cmd.desc) line += '  — ' + cmd.desc;
      if (line) commands.push(line);
    }
    var steps = [];
    var stepList = g.steps || [];
    for (var k = 0; k < stepList.length; k++) {
      var step = stepList[k] || {};
      var text = (k + 1) + '. ' + (step.instruction || '');
      if (step.expectedMetric) text += '  (기준: ' + step.expectedMetric + ')';
      steps.push(text);
    }
    // 칸 수는 GUIDE_HEADER 와 반드시 같아야 한다. 다르면 setValues 가 예외를 던지는데,
    // 그 직전에 clearContents() 가 이미 실행돼 탭이 비워진 채로 남는다.
    rows.push([
      g.codeOrTitle || '', g.summary || '', g.requiredTools || '',
      commands.join(NEWLINE), steps.join(NEWLINE),
      String(g.updatedAt || '').replace('T', ' '),
      g.id || '',
    ]);
  }
  var range = sheet.getRange(3, 1, rows.length, GUIDE_HEADER.length);
  range.setValues(rows);
  range.setVerticalAlignment('top');
  range.setWrap(true);
  // ID 열은 앱이 같은 가이드를 알아보는 용도라 사람에게는 감춘다.
  sheet.hideColumns(GUIDE_HEADER.length);
}

/* ============================================================ 첨부 파일(드라이브)
 *
 * 사진·영상을 스프레드시트 옆 폴더에 저장하고 칸에는 링크만 넣는다.
 * 시트에 그림으로 박아 넣던 방식은 영상을 못 넣고, 앱이 되읽을 수도 없었다.
 *
 * 링크는 '링크가 있는 사람은 보기' 로 열어 둔다. 앱이 썸네일을 표시하려면 필요하다.
 */
/* ── 첨부 저장 위치 ────────────────────────────────────────────────────
 *
 * 팀 공유 드라이브에 넣는다. 개인 드라이브에 두면 그 사람 계정 용량을 쓰고,
 * 퇴사하거나 계정이 바뀌면 사진이 통째로 사라진다.
 *
 * 저장 구조 — SHARED_DRIVE_ID 가 가리키는 폴더 **바로 아래**부터 시작한다.
 *
 *   <공유 드라이브 폴더>/
 *     옥동식 서초점/
 *       2026-09-02/
 *         사진/   현장.jpg
 *         동영상/ 증상.mp4
 *
 * 매장을 먼저 찾고 그 날 무엇이 있었는지 보는 순서라, 사람이 드라이브에서
 * 직접 뒤질 때 이 순서가 가장 빠르다.
 *
 * ▣ 공유 드라이브를 옮기면 아래 SHARED_DRIVE_ID 만 바꾸면 된다.
 *   주소창의 .../drive/folders/여기 부분이 그 값이다.
 */
var SHARED_DRIVE_ID = '0AKL9kurLTHqNUk9PVA';
var PHOTO_FOLDER_NAME = '사진';
var VIDEO_FOLDER_NAME = '동영상';

/** 공유 드라이브에 닿지 못했을 때만 쓰는 대비용 폴더 이름 */
var FALLBACK_FOLDER_NAME = '현장 리포트 첨부';

/** 이름이 같은 하위 폴더를 찾고, 없으면 만든다. */
function folderByName(parent, name) {
  var found = parent.getFoldersByName(name);
  if (found.hasNext()) return found.next();
  return parent.createFolder(name);
}

/**
 * 첨부가 들어갈 뿌리 폴더.
 *
 * 공유 드라이브에 닿지 못하면(권한 없음·ID 변경) 스프레드시트 옆에 만들어
 * **업로드가 실패하지는 않게** 한다. 어디에 저장됐는지는 응답으로 알려 준다.
 */
function mediaRoot(ss) {
  try {
    // 받은 주소가 가리키는 폴더를 **그대로** 뿌리로 쓴다.
    // 여기에 같은 이름의 폴더를 또 만들면 경로가 한 겹 깊어진다.
    return { folder: DriveApp.getFolderById(SHARED_DRIVE_ID), shared: true };
  } catch (err) {
    var parent;
    try {
      var parents = DriveApp.getFileById(ss.getId()).getParents();
      parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    } catch (err2) {
      parent = DriveApp.getRootFolder();
    }
    return { folder: folderByName(parent, FALLBACK_FOLDER_NAME), shared: false };
  }
}

/** 폴더 이름으로 쓸 수 없는 글자를 바꾼다. */
function safeFolderName(value, fallback) {
  var text = String(value || '').trim().replace(/[\\/:*?"<>|]/g, ' ');
  text = text.replace(/\s+/g, ' ').slice(0, 80).trim();
  return text || fallback;
}

/** 매장 → 날짜 → 사진/동영상 순으로 내려가며 폴더를 만든다. */
function mediaTargetFolder(root, mimeType, storeName, dateText) {
  var store = folderByName(root, safeFolderName(storeName, '매장 미지정'));
  var day = folderByName(store, safeFolderName(dateText, '날짜 미지정'));
  var isVideo = String(mimeType || '').indexOf('video/') === 0;
  return folderByName(day, isVideo ? VIDEO_FOLDER_NAME : PHOTO_FOLDER_NAME);
}

/**
 * 앱이 보낸 첨부를 드라이브에 저장한다.
 *  media: [{ column, filename, mimeType, data(base64) }, ...]
 *  반환 : { byColumn: { '9': ['https://...', ...] }, count, skipped }
 */
function saveMediaToDrive(ss, media) {
  var out = { byColumn: {}, count: 0, skipped: [] };
  if (!media || !media.length) return out;

  // 용량이 모자라면 파일이 조용히 안 올라간다. 미리 재 보고 이유를 분명히 남긴다.
  var space = driveSpace();
  var needed = 0;
  for (var n = 0; n < media.length; n++) {
    needed += Math.ceil((String((media[n] || {}).data || '').length * 3) / 4);
  }
  if (space.free !== null && needed > space.free) {
    for (var k = 0; k < media.length; k++) {
      out.skipped.push({
        filename: (media[k] || {}).filename || '(이름 없음)',
        reason: '구글 드라이브 용량이 부족합니다 (남은 공간 '
          + Math.round(space.free / 1048576) + 'MB, 필요 '
          + Math.round(needed / 1048576) + 'MB)'
      });
    }
    return out;
  }

  var root = mediaRoot(ss);
  out.shared = root.shared;
  for (var i = 0; i < media.length; i++) {
    var item = media[i] || {};
    try {
      var bytes = Utilities.base64Decode(item.data);
      var blob = Utilities.newBlob(bytes,
                                   item.mimeType || 'application/octet-stream',
                                   item.filename || ('첨부' + (i + 1)));
      var folder = mediaTargetFolder(root.folder, item.mimeType,
                                     item.storeName, item.dateText);
      var file = folder.createFile(blob);
      // 공유 드라이브는 조직 정책상 링크 공개가 막혀 있을 수 있다.
      // 실패해도 팀원은 공유 드라이브 권한으로 볼 수 있으므로 그냥 넘어간다.
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) { /* 공유 드라이브 정책 — 무시 */ }

      var column = String(item.column || 1);
      if (!out.byColumn[column]) out.byColumn[column] = [];
      out.byColumn[column].push(file.getUrl());
      out.count++;
    } catch (err) {
      out.skipped.push({
        filename: item.filename || '(이름 없음)',
        reason: String(err).slice(0, 120)
      });
    }
  }
  return out;
}

/**
 * 구글 드라이브 남은 용량. 조회에 실패하면 free 를 null 로 돌려준다
 * (막지 않고 그냥 진행한다 — 확인이 안 된다고 업로드를 멈출 이유는 없다).
 */
function driveSpace() {
  try {
    var free = DriveApp.getStorageLimit() - DriveApp.getStorageUsed();
    return {
      limit: DriveApp.getStorageLimit(),
      used: DriveApp.getStorageUsed(),
      free: free
    };
  } catch (err) {
    return { limit: null, used: null, free: null };
  }
}

/* ============================================================ 리포트 이력
 *
 * 앱의 [🗂 이력] 화면이 월별 탭을 읽어 가고, 상태 칸을 고쳐 쓴다.
 *
 *  { reports: 'months' }                              → 월별 탭 이름 목록
 *  { reports: 'pull', sheetName: '2026-08' }          → 그 달의 헤더 + 줄 전체
 *  { reports: 'status', sheetName, row, status }      → 그 줄의 상태 칸만 고침
 *
 * '상태' 열은 앱이 리포트를 올릴 때 헤더 맨 뒤에 함께 만든다.
 * 시트에서 직접 고쳐도 되고, 앱이 다음에 읽어 갈 때 그대로 반영된다.
 */
var STATUS_HEADER = '상태';
var REPORT_HEADER_ROW = 2;
var REPORT_DATA_ROW = 3;
// 월 탭 이름. 항목이 바뀌어 갈라진 탭도 같은 달로 본다 — `2026-09`, `2026-09 (2)`
var MONTH_TAB = /^\d{4}-\d{2}( \(\d+\))?$/;

function handleReports(ss, body) {
  if (body.reports === 'months') {
    var names = [];
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++) {
      var name = all[i].getName();
      if (MONTH_TAB.test(name)) names.push(name);
    }
    names.sort();
    names.reverse();                 // 최근 달이 앞
    return json({ ok: true, months: names });
  }

  if (body.reports === 'pull') {
    var sheet = ss.getSheetByName(String(body.sheetName || '').trim());
    if (!sheet) return json({ ok: true, exists: false, headers: [], rows: [] });
    return json(readReportSheet(sheet));
  }

  // 이미 올린 줄을 고쳐 쓴다 (이력 → [이어서 작성] → 저장).
  // 새 줄을 만들면 같은 방문이 두 줄이 된다.
  if (body.reports === 'update') {
    var lockU = LockService.getScriptLock();
    lockU.waitLock(30000);
    try {
      var target = ss.getSheetByName(String(body.sheetName || '').trim());
      if (!target) return json({ ok: false, error: '그 달의 시트가 없습니다.' });
      var rowIndex = Math.floor(Number(body.row) || 0);
      if (rowIndex < REPORT_DATA_ROW) {
        return json({ ok: false, error: '줄 번호가 올바르지 않습니다.' });
      }
      var line = body.row_values || [];
      if (!line.length) return json({ ok: false, error: 'row 가 비어 있습니다.' });

      if ((body.headers || []).length) writeHeaders(target, body.headers);

      // 첨부를 새로 올렸으면 드라이브에 저장하고 그 칸만 바꾼다.
      var savedU = saveMediaToDrive(ss, body.media || []);
      for (var colU in savedU.byColumn) {
        var idx = Number(colU) - 1;
        var had = String(line[idx] || '').trim();
        line[idx] = (had ? had + NEWLINE : '') + savedU.byColumn[colU].join(NEWLINE);
      }

      target.getRange(rowIndex, 1, 1, line.length).setValues([line]);
      target.getRange(rowIndex, 1, 1, line.length)
        .setVerticalAlignment('top').setWrap(true);
      SpreadsheetApp.flush();
      return json({ ok: true, sheetName: body.sheetName, row: rowIndex,
                    media: savedU.count, mediaSkipped: savedU.skipped,
                    spreadsheetUrl: ss.getUrl() });
    } finally {
      lockU.releaseLock();
    }
  }

  // 올린 리포트를 지운다 (이력 화면의 [삭제]).
  if (body.reports === 'delete') {
    var lockD = LockService.getScriptLock();
    lockD.waitLock(30000);
    try {
      var sheetD = ss.getSheetByName(String(body.sheetName || '').trim());
      if (!sheetD) return json({ ok: false, error: '그 달의 시트가 없습니다.' });
      var rowD = Math.floor(Number(body.row) || 0);
      if (rowD < REPORT_DATA_ROW || rowD > sheetD.getLastRow()) {
        return json({ ok: false, error: '줄 번호가 올바르지 않습니다.' });
      }
      sheetD.deleteRow(rowD);
      SpreadsheetApp.flush();
      return json({ ok: true, sheetName: body.sheetName, row: rowD });
    } finally {
      lockD.releaseLock();
    }
  }

  if (body.reports === 'status') {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var target = ss.getSheetByName(String(body.sheetName || '').trim());
      if (!target) return json({ ok: false, error: '그 달의 시트가 없습니다.' });
      var rowIndex = Math.floor(Number(body.row) || 0);
      if (rowIndex < REPORT_DATA_ROW) {
        return json({ ok: false, error: '줄 번호가 올바르지 않습니다.' });
      }
      var col = statusColumn(target, true);
      target.getRange(rowIndex, col).setValue(String(body.status || ''));
      SpreadsheetApp.flush();
      return json({ ok: true, row: rowIndex, column: col,
                    status: String(body.status || '') });
    } finally {
      lock.releaseLock();
    }
  }

  return json({ ok: false, error: '알 수 없는 요청입니다.' });
}

/**
 * 첨부 파일의 종류를 알려 준다.
 *
 * 시트 칸에는 주소만 들어 있어서 사진인지 영상인지 알 수 없다.
 * 그걸 모르면 영상도 사진처럼 한 장면만 보여 주게 된다.
 *   { drive: 'info', ids: ['...', ...] }
 *   → { files: [{ id, name, mimeType, isVideo }] }
 */
function handleDriveInfo(body) {
  var ids = body.ids || [];
  var files = [];
  for (var i = 0; i < ids.length && i < 50; i++) {
    var id = String(ids[i] || '').trim();
    if (!id) continue;
    try {
      var file = DriveApp.getFileById(id);
      var mime = file.getMimeType();
      files.push({
        id: id,
        name: file.getName(),
        mimeType: mime,
        isVideo: String(mime).indexOf('video/') === 0
      });
    } catch (err) {
      files.push({ id: id, name: '', mimeType: '', isVideo: false });
    }
  }
  return json({ ok: true, files: files });
}

/** '상태' 열 번호를 찾는다. 없으면 create=true 일 때 헤더 맨 뒤에 만든다. */
function statusColumn(sheet, create) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(REPORT_HEADER_ROW, 1, 1, lastCol).getValues()[0];
  for (var c = 0; c < header.length; c++) {
    if (String(header[c] || '').trim() === STATUS_HEADER) return c + 1;
  }
  if (!create) return -1;
  var col = lastCol + 1;
  var cell = sheet.getRange(REPORT_HEADER_ROW, col);
  cell.setValue(STATUS_HEADER);
  cell.setFontWeight('bold');
  cell.setBackground('#eef1f5');
  if (sheet.getColumnWidth(col) < 140) sheet.setColumnWidth(col, 140);
  return col;
}

/** 월별 탭을 앱이 쓰기 좋은 모양으로 읽는다. */
function readReportSheet(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < REPORT_HEADER_ROW || lastCol < 1) {
    return { ok: true, exists: true, headers: [], rows: [] };
  }

  var headers = sheet.getRange(REPORT_HEADER_ROW, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    headers[i] = String(headers[i] || '').trim();
  }

  var rows = [];
  if (lastRow >= REPORT_DATA_ROW) {
    var data = sheet
      .getRange(REPORT_DATA_ROW, 1, lastRow - REPORT_DATA_ROW + 1, lastCol)
      .getDisplayValues();
    for (var r = 0; r < data.length; r++) {
      var cells = data[r];
      var empty = true;
      for (var c = 0; c < cells.length; c++) {
        if (String(cells[c] || '').trim()) { empty = false; break; }
      }
      if (empty) continue;                     // 사람이 지운 빈 줄은 건너뛴다
      rows.push({ row: REPORT_DATA_ROW + r, cells: cells });
    }
  }
  return { ok: true, exists: true, headers: headers, rows: rows };
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 브라우저로 URL 을 직접 열었을 때 상태 확인용 */
function doGet() {
  return json({ ok: true, message: '현장 리포트 수집 스크립트가 동작 중입니다.' });
}
