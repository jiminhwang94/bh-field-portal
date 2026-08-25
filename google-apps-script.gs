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
        sheets: names
      });
    }

    // 차량 재고 동기화 — '차량재고' 탭을 팀 공유 저장소로 쓴다.
    if (body.inventory) {
      return handleInventory(ss, body);
    }

    var sheetName = String(body.sheetName || '').trim();
    var headers = body.headers || [];
    var row = body.row || [];
    if (!sheetName) return json({ ok: false, error: 'sheetName 이 없습니다.' });
    if (!row.length) return json({ ok: false, error: 'row 가 비어 있습니다.' });

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);            // 동시에 여러 명이 올려도 줄이 섞이지 않게
    try {
      var sheet = ss.getSheetByName(sheetName);
      var created = false;

      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        created = true;
        // 1행은 공백으로 남기고 2행에 항목명
        writeHeaders(sheet, headers);
        // 새 시트는 최근 월이 앞에 오도록 맨 앞으로
        ss.setActiveSheet(sheet);
        ss.moveActiveSheet(1);
      } else if (headers.length) {
        // 항목 설정이 바뀐 경우 2행 헤더를 최신으로 유지
        writeHeaders(sheet, headers);
      }

      // 3행부터 채운다 (2행 헤더 아래)
      var lastRow = sheet.getLastRow();
      var target = lastRow < 2 ? 3 : lastRow + 1;
      if (target < 3) target = 3;

      sheet.getRange(target, 1, 1, row.length).setValues([row]);
      sheet.getRange(target, 1, 1, row.length)
        .setVerticalAlignment('top')
        .setWrap(true);

      // 사진을 해당 칸에 이미지로 삽입 (링크가 아니라 사진 자체)
      var inserted = insertImages(sheet, body.images || [], target);

      SpreadsheetApp.flush();
      return json({
        ok: true,
        sheetName: sheetName,
        row: target,
        created: created,
        images: inserted,
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
 *  - 3행부터 : 부품 한 줄씩. 수량 칸이 비어 있으면 그 차량에는 없는 품목이다.
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
  var qty = {};                      // '<차량> <부품>' → 수량
  for (var j = 0; j < items.length; j++) {
    var item = items[j] || {};
    var vehicle = String(item.vehicleName || '').trim();
    var part = String(item.partName || '').trim();
    if (!vehicle || !part) continue;
    if (names.indexOf(vehicle) < 0) names.push(vehicle);
    if (parts.indexOf(part) < 0) parts.push(part);
    var minq = Math.max(0, Math.floor(Number(item.minQuantity) || 0));
    if (!(part in minByPart) || minq > minByPart[part]) minByPart[part] = minq;
    qty[vehicle + ' ' + part] = Math.max(0, Math.floor(Number(item.quantity) || 0));
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
        var key = names[n] + ' ' + parts[p];
        row.push(key in qty ? qty[key] : '');
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
        var cell = data[r][columns[i].index];
        if (cell === '' || cell === null || cell === undefined) continue;
        items.push({
          vehicleName: columns[i].name,
          partName: part,
          quantity: Math.max(0, Math.floor(Number(cell) || 0)),
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

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 브라우저로 URL 을 직접 열었을 때 상태 확인용 */
function doGet() {
  return json({ ok: true, message: '현장 리포트 수집 스크립트가 동작 중입니다.' });
}
