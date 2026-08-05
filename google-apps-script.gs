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

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 브라우저로 URL 을 직접 열었을 때 상태 확인용 */
function doGet() {
  return json({ ok: true, message: '현장 리포트 수집 스크립트가 동작 중입니다.' });
}
