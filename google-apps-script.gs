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
  var out = handleRequest(e);
  var asked = {};
  try {
    asked = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
  } catch (err) { asked = {}; }
  // 첨부 조각 · 마무리는 가볍게 끝낸다 — 기기 기록 · 탭 순서는 리포트 줄을 올릴 때 한다.
  // (예전에는 사진 조각마다 탭 순서를 맞추느라 재고 탭까지 읽었다: 요청마다 1~2초)
  if (asked.media === 'chunk' || asked.media === 'finish') return out;
  try {
    if (asked.device && !asked.changed) touchDevice(SpreadsheetApp.getActiveSpreadsheet(), asked);
  } catch (err) { /* 기기 기록 실패는 응답과 상관없다 */ }
  // 탭 순서 고정 — 요청을 처리한 뒤 매번 맞춘다. 사람이 손으로 옮겨 놓아도
  // 다음 기록 때 제자리로 돌아온다. 5분마다 오는 가벼운 물음(changed)은 건너뛴다.
  try {
    if (!asked.changed) arrangeTabs(SpreadsheetApp.getActiveSpreadsheet());
  } catch (err) { /* 순서 맞추기가 실패해도 응답은 그대로 간다 */ }
  return out;
}

function handleRequest(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 시트가 마지막으로 바뀐 시각 — 태블릿이 5분마다 이것만 물어본다.
    // 자료를 받는 것이 아니라 "달라진 게 있나" 만 보는 것이라 아주 가볍다.
    if (body.changed) {
      return handleChanged(ss, body);
    }

    // 휴지통 — 지운 가이드 · 리포트 목록과 되살리기
    if (body.trash) {
      return handleTrash(ss, body);
    }

    // 기기에서 모은 오류
    if (body.errors === 'push') {
      return handleErrors(ss, body);
    }

    // 이슈 유형 목록 — 리포트의 '이슈 유형' 을 고르는 팀 공용 목록 (구분 › 대분류 › 세부 항목)
    if (body.work) {
      return handleWork(ss, body);
    }

    // 큰 첨부를 조각으로 — 끊겨도 이어 올린다 (리포트의 media 배열과 다른 '글자' 값)
    if (body.media === 'chunk' || body.media === 'finish') {
      return handleMediaUpload(ss, body);
    }

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

    // 차량 운행 일지 — 차량마다 탭 하나 (법인 차량 운행 일지 서식)
    if (body.driving) {
      return handleDriving(ss, body);
    }

    // 첨부 파일 종류 확인 (사진 / 영상)
    if (body.drive === 'info') {
      return handleDriveInfo(body);
    }

    // 첨부 파일의 **내용**을 직접 내려준다 (공개가 막혀 있어도 보이게)
    if (body.drive === 'bytes') {
      return handleDriveBytes(body);
    }

    // 이미 올라간 첨부를 다시 공개로 만든다 (예전에 올린 사진 되살리기)
    if (body.drive === 'repair') {
      return handleDriveRepair(ss, body);
    }

    // 앱 버전 — 빌드 자동화가 적고(publish), 태블릿이 읽는다(latest)
    if (body.release === 'publish') {
      return handleReleasePublish(ss, body);
    }
    if (body.release === 'latest') {
      return handleReleaseLatest(ss, body);
    }
    // 사람에게 보내 주는 **바뀌지 않는** 설치 주소를 갱신한다
    if (body.release === 'install') {
      return handleReleaseInstall(ss, body);
    }

    var sheetName = String(body.sheetName || '').trim();
    var headers = body.headers || [];
    var row = body.row || [];
    if (!sheetName) return json({ ok: false, error: 'sheetName 이 없습니다.' });
    if (!row.length) return json({ ok: false, error: 'row 가 비어 있습니다.' });

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);            // 동시에 여러 명이 올려도 줄이 섞이지 않게
    try {
      // 한 달은 **표 하나**다 (2행에 항목 줄 하나). 항목이 달라져도 표를
      // 가르지 않고, 항목 **이름**으로 열을 맞춰 적는다. 새 항목은 그 자리에
      // 열을 끼워 넣고, 없어진 항목의 열은 옛 기록 보존을 위해 남긴다.
      var picked = openMonthSheet(ss, sheetName);
      var sheet = picked.sheet;
      var created = picked.created;

      // 예전 판이 갈라 놓은 항목 묶음들이 있으면 먼저 표 하나로 합친다.
      if (!created) consolidateIfSplit(sheet);

      // 쌓을 자리와 열 배치. map[i] = 앱의 i번째 칸이 갈 시트 열(1-based).
      var placed = placeForRow(sheet, headers, created);
      var target = placed.target;

      // 앱이 보낸 값을 시트 열 배치에 맞춰 다시 늘어놓는다.
      var aligned = [];
      for (var fill = 0; fill < placed.width; fill++) aligned.push('');
      for (var ri = 0; ri < row.length; ri++) {
        var toCol = placed.map[ri] || 0;
        if (toCol >= 1) aligned[toCol - 1] = row[ri];
      }

      // 사진·영상은 드라이브 폴더에 저장하고, 칸에는 링크만 넣는다.
      // (시트에 박아 넣으면 영상이 안 되고 앱이 되읽을 수도 없다)
      // 첨부의 열 번호도 앱 기준이므로 시트 열로 옮긴다.
      var saved = saveMediaToDrive(ss, body.media || []);
      var mediaCols = {};              // 시트 열 → 주소 목록
      for (var col in saved.byColumn) {
        var mc = placed.map[Number(col) - 1] || Number(col);
        mediaCols[mc] = saved.byColumn[col];
        aligned[mc - 1] = saved.byColumn[col].join('\n');
      }

      sheet.getRange(target, 1, 1, aligned.length).setValues([aligned]);
      sheet.getRange(target, 1, 1, aligned.length)
        .setVerticalAlignment('top')
        .setWrap(true);

      // 첨부 칸은 **눌러서 열 수 있는 링크**로 다시 적는다.
      // 글자로만 넣으면 시트에서 검은 글씨로 보이고 눌러도 안 열린다.
      for (var linkCol in mediaCols) {
        writeLinkCell(sheet, target, Number(linkCol), mediaCols[linkCol]);
      }

      // 예전 앱(빌드 9 이하)이 보낸 사진은 지금까지처럼 칸에 그림으로 삽입한다.
      var legacyImages = body.images || [];
      for (var li = 0; li < legacyImages.length; li++) {
        var lc = Number(legacyImages[li].column) || 1;
        legacyImages[li].column = placed.map[lc - 1] || lc;
      }
      var inserted = insertImages(sheet, legacyImages, target);
      // 조각으로 미리 올린 첨부는 주소로 온다 — 그 칸도 파란 링크로 살린다
      relinkDriveCells(sheet, target, aligned);

      SpreadsheetApp.flush();
      logChange(ss, body, '리포트 추가', sheetName + ' ' + target + '행', reportSummary(headers, row));
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
        // 0 보다 크면 링크 공개가 막혀 있다는 뜻 — 앱이 바이트를 직접 받아 그린다.
        mediaPrivate: saved.privateCount || 0,
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

/** 그 달 탭을 열고, 없으면 만든다. 반환: { sheet, created } */
function openMonthSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) return { sheet: sheet, created: false };
  sheet = ss.insertSheet(name, 0);    // 리포트는 매달 생기니 맨 앞 — 최근 달이 첫 탭
  return { sheet: sheet, created: true };
}

// ═══════════════════════════════════════════════════════════════════
// 탭 순서 — 사람이 정한 자리를 스크립트가 지킨다
//
//   [리포트 월 탭 — 최근 달이 앞]  2026-09 · 2026-08 · …
//   [가이드]                         오류 코드 가이드 · 하드웨어 교체 SOP · SW·명령어
//   차량재고
//   [운행일지 — 새 해가 앞, 차량은 재고 탭의 차량 순서]
//   운행일지 항목 · 리포트 항목 · 앱 설치 링크 · 앱 버전
//   [그 밖의 탭 — 있던 순서 그대로 맨 뒤]
//
// 새 탭이 생기면(insertSheet 는 활성 탭 뒤에 끼운다) 앞쪽에 끼어들어 순서가
// 흐트러졻다. 그래서 요청을 처리한 뒤 매번 여기서 한 번 맞춘다. 제자리에 있는
// 탭은 건드리지 않으므로 평소에는 아무 일도 하지 않는다.
// ═══════════════════════════════════════════════════════════════════
var TAB_ORDER_TAIL = ['운행일지 항목', '리포트 항목', '이슈 유형 목록', '앱 설치 링크', '앱 버전',
                      '기기', '변경기록', '오류기록', '휴지통'];

function arrangeTabs(ss) {
  var sheets = ss.getSheets();
  var byName = {};
  var names = [];
  for (var i = 0; i < sheets.length; i++) {
    byName[sheets[i].getName()] = sheets[i];
    names.push(sheets[i].getName());
  }
  var has = function (n) { return Object.prototype.hasOwnProperty.call(byName, n); };

  // 1) 리포트 월 탭 — 최근 달이 앞
  var months = names.filter(function (n) { return /^\d{4}-\d{2}$/.test(n); }).sort().reverse();

  // 2) 가이드 — 정해진 차례
  var guides = [GUIDE_SHEETS.ERROR_CODE, GUIDE_SHEETS.HARDWARE_SOP, GUIDE_SHEETS.SOFTWARE_CMD,
                GUIDE_MODEL_SHEET].filter(has);

  // 3) 운행일지 — 새 해가 앞, 같은 해는 재고 탭의 차량 순서(없으면 이름순)
  var vehicleOrder = [];
  try {
    if (has(INV_SHEET_NAME)) vehicleOrder = readInventory(byName[INV_SHEET_NAME]).vehicles || [];
  } catch (err) { vehicleOrder = []; }
  var rank = function (v) { var k = vehicleOrder.indexOf(v); return k < 0 ? 9999 : k; };
  var driving = names.filter(function (n) {
    return n !== DRIVING_OPTION_SHEET && drivingTabOf(n) !== null;
  }).sort(function (a, b) {
    var ta = drivingTabOf(a), tb = drivingTabOf(b);
    if (ta.year !== tb.year) return tb.year.localeCompare(ta.year);          // 새 해가 앞
    var ra = rank(ta.vehicle), rb = rank(tb.vehicle);
    if (ra !== rb) return ra - rb;
    return ta.vehicle.localeCompare(tb.vehicle, 'ko');
  });

  var desired = months.concat(guides);
  if (has(INV_SHEET_NAME)) desired.push(INV_SHEET_NAME);
  desired = desired.concat(driving).concat(TAB_ORDER_TAIL.filter(has));
  // 4) 모르는 탭은 있던 순서 그대로 맨 뒤
  for (var j = 0; j < names.length; j++) {
    if (desired.indexOf(names[j]) < 0) desired.push(names[j]);
  }

  // 제자리가 아닌 것만 옮긴다
  var moved = 0;
  for (var k = 0; k < desired.length; k++) {
    var now = ss.getSheets();
    if (now[k] && now[k].getName() === desired[k]) continue;
    ss.setActiveSheet(byName[desired[k]]);
    ss.moveActiveSheet(k + 1);
    moved++;
  }
  return moved;
}

/**
 * 항목 줄인가?
 *
 * 항목 줄의 첫 칸은 언제나 '작성일시' 라는 **글자**다. 자료 줄의 첫 칸은
 * 실제 시각(2026-09-03 16:57)이므로 둘은 헷갈리지 않는다.
 * 이 한 가지 규칙으로 한 탭 안의 항목 묶음을 모두 알아낼 수 있다.
 */
function isHeaderRow(cells) {
  return String((cells || [])[0] || '').trim() === REPORT_FIRST_HEADER;
}

/** 탭 전체를 읽어 항목 묶음의 경계를 찾는다. 반환: [{ row, headers }] */
function headerBlocks(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var out = [];
  if (lastRow < 1) return out;
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  for (var r = 0; r < values.length; r++) {
    if (!isHeaderRow(values[r])) continue;
    var head = values[r].slice();
    while (head.length && String(head[head.length - 1]).trim() === '') head.pop();
    for (var i = 0; i < head.length; i++) head[i] = String(head[i] || '').trim();
    out.push({ row: r + 1, headers: head });
  }
  return out;
}

/** 맨 아래 항목 묶음. 없으면 { row: 0, headers: [] } */
function lastHeaderBlock(sheet) {
  var blocks = headerBlocks(sheet);
  return blocks.length ? blocks[blocks.length - 1] : { row: 0, headers: [] };
}

/** 이 자료 줄을 지배하는 항목 묶음 (그 줄 위의 가장 가까운 항목 줄) */
function blockForRow(sheet, rowIndex) {
  var blocks = headerBlocks(sheet);
  var found = null;
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].row < rowIndex) found = blocks[i];
  }
  return found;
}

/**
 * 이 리포트를 적을 줄 번호를 정한다.
 *
 * 맨 아래 항목 묶음과 지금 항목이 같으면 그 아래에 이어 붙인다.
 * 다르면 **새 항목 줄을 넣고** 그 아래에 적는다 — 탭은 그대로 하나다.
 */
function placeForRow(sheet, headers, created) {
  if (created) {
    writeHeaders(sheet, headers, REPORT_HEADER_ROW);   // 1행은 비우고 2행에 항목명
    return { target: REPORT_DATA_ROW,
             map: identityMap(headers.length), width: headers.length };
  }
  var block = lastHeaderBlock(sheet);
  var lastRow = sheet.getLastRow();

  if (!block.row) {                    // 항목 줄이 아예 없다 (사람이 만든 빈 탭)
    var at = Math.max(lastRow + 1, REPORT_HEADER_ROW);
    writeHeaders(sheet, headers, at);
    return { target: at + 1,
             map: identityMap(headers.length), width: headers.length };
  }
  if (!headers.length) {               // 항목을 안 보낸 옛 요청 — 자리 그대로 적는다
    var plainWidth = Math.max(block.headers.length, 1);
    return { target: Math.max(lastRow + 1, block.row + 1),
             map: identityMap(plainWidth), width: plainWidth };
  }

  // 항목 이름으로 열을 맞춘다. 새 항목은 직전 항목의 오른쪽에 열을 끼워 넣는다.
  var sheetHead = block.headers.slice();
  var map = [];
  var prevIdx = -1;                    // 직전 항목이 자리한 열 (0-based)
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    var idx = sheetHead.indexOf(name);
    if (idx < 0 && name) {
      idx = prevIdx + 1;
      if (prevIdx < 0) sheet.insertColumnBefore(1);
      else sheet.insertColumnAfter(prevIdx + 1);
      sheetHead.splice(idx, 0, name);
      var cell = sheet.getRange(block.row, idx + 1);
      cell.setValue(name);
      cell.setFontWeight('bold');
      cell.setBackground('#eef1f5');
      if (sheet.getColumnWidth(idx + 1) < 140) sheet.setColumnWidth(idx + 1, 140);
    }
    map.push(idx >= 0 ? idx + 1 : 0);
    if (idx >= 0) prevIdx = idx;
  }
  return { target: Math.max(sheet.getLastRow() + 1, block.row + 1),
           map: map, width: sheetHead.length };
}

/** i번째 값이 i번째 열로 가는 그대로 배치 */
function identityMap(count) {
  var map = [];
  for (var i = 0; i < count; i++) map.push(i + 1);
  return map;
}

/**
 * 항목 묶음이 여러 개로 갈라진 탭을 **표 하나**로 합친다.
 *
 * v3.25 이전에는 항목이 바뀔 때마다 탭 아래에 새 항목 줄을 만들어,
 * 항목 추가·순서 변경만 해도 한 탭에 표가 여러 개 생겼다. 이 함수가
 * 리포트를 올릴 때 한 번 정리해 준다 (묶음이 하나면 아무것도 안 한다).
 *
 * 열 배치는 맨 아래(최신) 묶음의 순서를 따르고, 옛 묶음에만 있던 항목은
 * 그 뒤에 덧붙인다. '상태'는 항상 맨 뒤. 자료 줄은 각자의 항목 이름으로
 * 새 배치에 옮겨 담으므로 값이 어긋나지 않고, 드라이브 링크도 다시 살린다.
 */
function consolidateIfSplit(sheet) {
  var blocks = headerBlocks(sheet);
  if (blocks.length <= 1) return false;

  var union = [];
  var hasStatus = false;
  for (var b = blocks.length - 1; b >= 0; b--) {
    var hs = blocks[b].headers;
    for (var i = 0; i < hs.length; i++) {
      var name = String(hs[i] || '').trim();
      if (!name) continue;
      if (name === STATUS_HEADER) { hasStatus = true; continue; }
      if (union.indexOf(name) < 0) union.push(name);
    }
  }
  if (hasStatus) union.push(STATUS_HEADER);
  if (!union.length) return false;

  // 자료 줄을 각자의 항목 이름으로 새 배치에 옮겨 담는다
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var current = null;
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var cells = values[r];
    if (isHeaderRow(cells)) {
      current = [];
      for (var h = 0; h < cells.length; h++) current.push(String(cells[h] || '').trim());
      continue;
    }
    if (!current) continue;            // 항목 줄보다 위의 줄은 무시
    var empty = true;
    for (var e = 0; e < cells.length; e++) {
      if (String(cells[e] || '').trim()) { empty = false; break; }
    }
    if (empty) continue;               // 묶음 사이 여백 줄
    var line = [];
    for (var f = 0; f < union.length; f++) line.push('');
    for (var c = 0; c < current.length && c < cells.length; c++) {
      if (!current[c]) continue;
      var to = union.indexOf(current[c]);
      if (to >= 0) line[to] = cells[c];
    }
    out.push(line);
  }

  sheet.clearContents();
  writeHeaders(sheet, union, REPORT_HEADER_ROW);
  if (out.length) {
    var range = sheet.getRange(REPORT_DATA_ROW, 1, out.length, union.length);
    range.setValues(out);
    range.setVerticalAlignment('top');
    range.setWrap(true);
    for (var r2 = 0; r2 < out.length; r2++) {
      relinkDriveCells(sheet, REPORT_DATA_ROW + r2, out[r2]);
    }
  }
  return true;
}

/** 드라이브 주소가 든 칸들을 다시 **누를 수 있는 링크**로 만든다. */
function relinkDriveCells(sheet, rowIndex, line) {
  for (var c = 0; c < line.length; c++) {
    var text = String(line[c] || '');
    if (text.indexOf('drive.google.com') < 0) continue;
    var parts = text.split(NEWLINE);
    var urls = [];
    for (var p = 0; p < parts.length; p++) {
      var one = parts[p].trim();
      if (one.indexOf('http') === 0) urls.push(one);
    }
    if (urls.length) writeLinkCell(sheet, rowIndex, c + 1, urls);
  }
}


/** 시트의 열 수가 모자라면 늘린다 (기본 26열을 넘는 항목 구성 대비). */
function ensureColumns(sheet, count) {
  var max = sheet.getMaxColumns();
  if (max < count) sheet.insertColumnsAfter(max, count - max);
}

function writeHeaders(sheet, headers, atRow) {
  if (!headers || !headers.length) return;
  ensureColumns(sheet, headers.length);
  var row = Math.floor(atRow || REPORT_HEADER_ROW);
  var range = sheet.getRange(row, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold');
  range.setBackground('#eef1f5');
  if (row === REPORT_HEADER_ROW) sheet.setFrozenRows(REPORT_HEADER_ROW);
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
var INV_FIXED = 2;                 // 고정 열(옛 배치): 부품명 · 최소보유
var INV_CATEGORY_HEADER = '분류';

/**
 * 탭의 열 배치를 머리줄로 알아본다.
 *   새 배치: 부품명 · 분류 · 최소보유 · 차량…
 *   옛 배치: 부품명 · 최소보유 · 차량…          (v3.26 이전이 만든 탭)
 * 둘 다 읽는다 — 배치는 새 앱이 처음 올릴 때 새것으로 바뀐다.
 */
function invLayout(header) {
  var hasCat = String((header || [])[1] || '').trim() === INV_CATEGORY_HEADER;
  return { hasCat: hasCat, fixed: hasCat ? 3 : INV_FIXED, catCol: hasCat ? 1 : -1, minCol: hasCat ? 2 : 1 };
}

function handleInventory(ss, body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ss.getSheetByName(INV_SHEET_NAME);

    if (body.inventory === 'push') {
      if (!sheet) sheet = ss.insertSheet(INV_SHEET_NAME);
      var invBefore = readInventory(sheet);
      writeInventory(sheet, body.vehicles || [], body.items || []);
      SpreadsheetApp.flush();
      var invAfter = readInventory(sheet);
      var invLine = inventoryDiff(invBefore, invAfter);
      if (invLine) logChange(ss, body, '재고 구성', '차량재고', invLine);
      return json(invAfter);
    }

    if (body.inventory === 'qty') {
      if (!sheet) sheet = ss.insertSheet(INV_SHEET_NAME);
      var qtyLines = applyQuantityOps(sheet, body.ops || []);
      SpreadsheetApp.flush();
      if (qtyLines.length) logChange(ss, body, '재고 수량', qtyLines.length + '건', qtyLines.join(' / '));
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

  // 예전 앱(분류를 모르는 3.26 이하)이 올리면 **있던 분류와 줄 순서를 지킨다.**
  // 그대로 덮어쓰면 새 앱에서 정해 둔 분류·순서가 한 번에 지워진다.
  var legacyClient = true;
  for (var l = 0; l < items.length; l++) {
    if (items[l] && Object.prototype.hasOwnProperty.call(items[l], 'category')) { legacyClient = false; break; }
  }
  var existing = readInventory(sheet);
  var keepCat = {};
  var keepOrder = [];
  for (var e = 0; e < (existing.items || []).length; e++) {
    var ex = existing.items[e];
    if (keepOrder.indexOf(ex.partName) < 0) keepOrder.push(ex.partName);
    if (ex.category && !keepCat[ex.partName]) keepCat[ex.partName] = ex.category;
  }

  var parts = [];                    // 부품명 등장 순서 = 시트 줄 순서 = 앱 순서
  var catByPart = {};
  var minByPart = {};                // 부품별 최소보유 (차량별 값 중 최댓값)
  var qty = {};                      // '<차량>+<부품>' → 수량
  for (var j = 0; j < items.length; j++) {
    var item = items[j] || {};
    var vehicle = String(item.vehicleName || '').trim();
    var part = String(item.partName || '').trim();
    if (!vehicle || !part) continue;
    if (names.indexOf(vehicle) < 0) names.push(vehicle);
    if (parts.indexOf(part) < 0) parts.push(part);
    var cat = legacyClient ? (keepCat[part] || '') : String(item.category || '').trim();
    if (cat && !catByPart[part]) catByPart[part] = cat;
    var minq = Math.max(0, Math.floor(Number(item.minQuantity) || 0));
    if (!(part in minByPart) || minq > minByPart[part]) minByPart[part] = minq;
    qty[vehicle + '\u0000' + part] = Math.max(0, Math.floor(Number(item.quantity) || 0));
  }
  if (legacyClient && keepOrder.length) {
    // 있던 줄 순서 먼저, 새 부품은 뒤에
    parts.sort(function (a, b) {
      var ka = keepOrder.indexOf(a), kb = keepOrder.indexOf(b);
      if (ka < 0) ka = 1e9; if (kb < 0) kb = 1e9;
      return ka - kb;
    });
  }

  sheet.clearContents();
  var header = ['부품명', INV_CATEGORY_HEADER, '최소보유'].concat(names);
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
      var row = [parts[p], catByPart[parts[p]] || '', minByPart[parts[p]] || 0];
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
  var layout = invLayout(header);
  var columns = [];                  // [{name, index(0-based)}]
  var vehicles = [];
  for (var c = layout.fixed; c < header.length; c++) {
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
      var category = layout.hasCat ? String(data[r][layout.catCol] || '').trim() : '';
      var minq = Math.max(0, Math.floor(Number(data[r][layout.minCol]) || 0));
      for (var i = 0; i < columns.length; i++) {
        // 품목은 모든 차량 공용 — 빈 칸은 수량 0 으로 읽는다.
        var cell = data[r][columns[i].index];
        var qtyValue = (cell === '' || cell === null || cell === undefined)
          ? 0 : Math.max(0, Math.floor(Number(cell) || 0));
        items.push({
          vehicleName: columns[i].name,
          partName: part,
          category: category,
          quantity: qtyValue,
          minQuantity: minq,
        });
      }
    }
  }
  return { ok: true, exists: true, vehicles: vehicles, items: items };
}

/**
 * [-]/[+] 수량 변경을 해당 칸에 바로 기록한다.
 *
 * 시트에 없는 차량·품목이면 **건너뛴다.** 다른 기기에서 지웠거나(또는 시트에서
 * 이름을 바꿨거나) 한 것이다. 예전에는 줄·열을 새로 만들어서, 지운 품목이
 * 늦게 올라온 [+] 한 번에 되살아났다. 새 품목·차량은 push 로만 생긴다.
 */
function applyQuantityOps(sheet, ops) {
  var lines = [];
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (err) { cache = null; }
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i] || {};
    if (op.type === 'quantity-delete') continue;   // 품목 삭제는 push 가 처리한다
    var vehicle = String(op.vehicleName || '').trim();
    var part = String(op.partName || '').trim();
    if (!vehicle || !part) continue;

    var lastCol = Math.max(sheet.getLastColumn(), INV_FIXED);
    var header = sheet.getRange(INV_HEADER_ROW, 1, 1, lastCol).getValues()[0];
    var layout = invLayout(header);
    var col = -1;
    for (var c = layout.fixed; c < header.length; c++) {
      if (String(header[c] || '').trim() === vehicle) { col = c + 1; break; }
    }
    if (col < 0) continue;           // 지워진 차량

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
    if (row < 0) continue;           // 지워진 품목

    var target = Math.max(0, Math.floor(Number(op.quantity) || 0));
    var current = Math.max(0, Math.floor(Number(sheet.getRange(row, col).getValue()) || 0));
    var next = target;
    // 바꾸기 전 값(before)과 작업 번호(opId)가 오면 **바뀐 만큼만** 더한다.
    // 그 사이 다른 기기가 같은 칸을 바꿨어도 그 변경을 덮어쓰지 않고 합친다.
    // 같은 작업을 다시 보내면(응답을 못 받아 재시도) 이미 적용한 만큼은 빼고 더한다.
    var base = op.before;
    if (op.opId && typeof base === 'number' && base >= 0) {
      var key = 'qty:' + String(op.opId);
      var applied = cache ? cache.get(key) : null;
      var from = applied !== null && applied !== undefined && applied !== '' ? Number(applied) : base;
      next = Math.max(0, current + (target - from));
      if (cache) cache.put(key, String(target), 21600);
    }
    if (next !== current) {
      sheet.getRange(row, col).setValue(next);
      lines.push(part + ' · ' + vehicle + ' ' + current + '→' + next);
    }
  }
  return lines;
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
/** 단계 사진 — `1. <주소>` 꼴로 단계 번호와 함께 적는다 (번호가 곧 몇 번째 단계인지) */
var GUIDE_PHOTO_HEADER = '단계 사진';
/**
 * 로봇 분류 (Gen.1 · Gen.2 · Zephyr …) — 같은 오류 코드라도 로봇마다 절차가 다르다.
 * 맨 앞 열에 둔다. 읽을 때는 **열 이름으로** 찾으므로, 이 열이 없던 예전 탭도
 * 그대로 읽힌다 (그때는 로봇이 비어 있는 것으로 본다).
 */
var GUIDE_ROBOT_HEADER = '로봇';
var GUIDE_HEADER = [GUIDE_ROBOT_HEADER, '코드/제목', '요약', '필요 공구', '명령어', '단계', '수정일',
                    GUIDE_PHOTO_HEADER, GUIDE_ID_HEADER];
var GUIDE_WIDTHS = [110, 160, 260, 160, 300, 420, 130, 260, 200];
/** 로봇 분류 목록 — 가이드가 하나도 없는 로봇도 팀 전체에 보이도록 따로 둔다. */
var GUIDE_MODEL_SHEET = '가이드 로봇';
var GUIDE_MODEL_HEADER = ['로봇 분류 (앱에서 추가·이름 바꾸기·삭제)'];

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
    // count 는 **실제로 적은 줄 수** 다 (같은 이름은 합쳐지므로 보낸 수와 다를 수 있다)
    var written = writeFieldSheet(ss, body.items || []);
    logChange(ss, body, '리포트 항목', FIELD_SHEET, '항목 ' + written + '개로 다시 씀');
    return json({ ok: true, count: written });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 같은 이름의 항목을 하나로 합친다 — **중복이 시트에 들어오는 마지막 문턱.**
 *
 * 항목을 알아보는 기준은 ID 가 아니라 **이름**이다. 기기마다 같은 항목에
 * 다른 ID 를 들고 있을 수 있고, 그러면 서로 "시트에 없는 항목" 으로 보여
 * 같은 이름이 두 줄로 쌓인다 ([로봇 모델] 이 선택지만 다른 두 줄이 됐다).
 *
 * 자리는 **처음 나온 곳**, 내용은 **나중 것** 을 쓴다 — 나중에 온 것이
 * 방금 고친 쪽이라 선택지가 최신이다.
 */
function dedupeFieldsByLabel(items) {
  var order = [];
  var byKey = {};
  for (var i = 0; i < items.length; i++) {
    var key = String((items[i] && items[i].fieldLabel) || '').replace(/\s/g, '');
    if (!key) continue;
    if (!Object.prototype.hasOwnProperty.call(byKey, key)) order.push(key);
    byKey[key] = items[i];
  }
  var out = [];
  for (var k = 0; k < order.length; k++) out.push(byKey[order[k]]);
  return out;
}

function writeFieldSheet(ss, items) {
  items = dedupeFieldsByLabel(items || []);
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
  return rows.length;
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
  // 이미 중복이 쌓여 있는 탭도 읽을 때 하나로 보여 준다 — 기기가 중복을
  // 받아 가면 그 기기가 다시 올릴 때 중복이 되살아난다.
  var merged = dedupeFieldsByLabel(out);
  for (var m = 0; m < merged.length; m++) merged[m].displayOrder = m + 1;
  return merged;
}

// ═══════════════════════════════════════════════════════════════════
// 차량 운행 일지 — 국세청 '법인 차량 운행 일지' 서식
//
// 차량마다 · 해마다 탭이 하나씩 생긴다: [운행일지 2026 스타리아 1호차]
// 그 탭을 그대로 인쇄해 제출할 수 있게 서식의 항목 번호(①~⑩)를 그대로 쓴다.
//
//   1행  제목
//   2행  법인명 · 사업자등록번호
//   3행  ①차종 · ②자동차등록번호 · 사업연도
//   4행  운행 건수 · 주행거리 합계
//   5행  머리줄 (③~⑩ + 기록 ID)
//   6행~ 운행 기록
//
// **자료는 늘 6행부터**다. 위 다섯 줄의 모양이 바뀌어도 읽는 자리는 그대로다.
//
// 부서 · 출발/도착지 선택지는 팀 공통이라 [운행일지 항목] 탭 하나에 둔다.
// ═══════════════════════════════════════════════════════════════════
var DRIVING_PREFIX = '운행일지 ';
var DRIVING_OPTION_SHEET = '운행일지 항목';
var DRIVING_FIRST_ROW = 6;
var DRIVING_HEADER = [
  '③사용일자', '요일', '④부서', '성명',
  '⑤주행 전 계기판의 거리(㎞)', '⑥주행 후 계기판의 거리(㎞)', '⑦주행거리(㎞)',
  '⑧출발지', '⑨도착지', '⑩비고', '기록 ID',
];
var DRIVING_WIDTHS = [110, 60, 110, 100, 150, 150, 120, 150, 150, 200, 190];
var COMPANY_NAME = '비욘드허니컴';
var COMPANY_BIZ_NO = '697-86-01767';

/**
 * 탭 이름 — '운행일지 2026 스타리아 1호차'.
 *
 * **해마다 새 탭**이다. 법인 차량 운행 일지는 사업연도 단위로 내는 서류이고,
 * 한 탭에 몇 해가 섞이면 연말에 그 해 것만 골라내야 한다. 해가 바뀌면 다음
 * 기록부터 새 탭에 쌓이고, 지난해 탭은 그대로 남아 그냥 인쇄하면 된다.
 */
function drivingSheetName(vehicleName, year) {
  var clean = String(vehicleName || '').replace(/[\[\]\*\/\\\?:]/g, ' ');
  clean = clean.replace(/\s+/g, ' ').trim();
  return (DRIVING_PREFIX + year + ' ' + clean).slice(0, 95);
}

/**
 * 탭 이름에서 연도와 차량 이름을 되찾는다. 운행일지 탭이 아니면 null.
 * 연도 없이 만들어진 옛 탭('운행일지 스타리아 1호차')도 읽는다.
 */
function drivingTabOf(sheetName) {
  var name = String(sheetName || '');
  if (name.indexOf(DRIVING_PREFIX) !== 0) return null;
  var rest = name.slice(DRIVING_PREFIX.length).trim();
  var m = /^(\d{4})\s+(.+)$/.exec(rest);
  if (m) return { year: m[1], vehicle: m[2].trim() };
  return { year: '', vehicle: rest };        // 연도를 붙이기 전에 만든 탭
}

/** 'YYYY-MM-DD' → 'YYYY'. 날짜가 아니면 올해. */
function drivingYearOf(date) {
  var text = String(date || '');
  return /^\d{4}/.test(text) ? text.slice(0, 4)
    : String(new Date().getFullYear());
}

function handleDriving(ss, body) {
  if (body.driving === 'pull') return handleDrivingPull(ss, body);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (body.driving === 'push') return handleDrivingPush(ss, body);
    if (body.driving === 'options') {
      writeDrivingOptions(ss, body.depts || [], body.places || []);
      return json({ ok: true, depts: (body.depts || []).length,
                    places: (body.places || []).length });
    }
    return json({ ok: false, error: '알 수 없는 요청입니다.' });
  } finally {
    lock.releaseLock();
  }
}

function handleDrivingPull(ss, body) {
  var want = String(body.vehicleName || '').trim();
  var wantYear = String(body.year || '').trim();
  var sheets = ss.getSheets();
  var rows = [];
  var info = {};
  for (var i = 0; i < sheets.length; i++) {
    var tab = drivingTabOf(sheets[i].getName());
    if (!tab) continue;
    if (want && tab.vehicle !== want) continue;
    if (wantYear && tab.year && tab.year !== wantYear) continue;
    // 차종·등록번호는 해마다 같다. 가장 최근 해의 것을 쓴다.
    var head = readDrivingHead(sheets[i]);
    if (!info[tab.vehicle] || head.model || head.plate) info[tab.vehicle] = head;
    var list = readDrivingSheet(sheets[i]);
    for (var j = 0; j < list.length; j++) {
      list[j].vehicleName = tab.vehicle;
      rows.push(list[j]);
    }
  }
  return json({ ok: true, rows: rows, info: info, options: readDrivingOptions(ss) });
}

function handleDrivingPush(ss, body) {
  var vehicle = String(body.vehicleName || '').trim();
  if (!vehicle) return json({ ok: false, error: '차량 이름이 없습니다.' });
  var rows = body.rows || [];
  var info = body.info || {};

  // 해마다 탭이 다르므로 **연도로 먼저 나눈다.**
  var byYear = {};
  for (var i = 0; i < rows.length; i++) {
    var year = drivingYearOf(rows[i].date);
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(rows[i]);
  }
  // 기록이 하나도 없으면 올해 탭만 비운다 (마지막 줄을 지운 경우).
  if (!rows.length) byYear[String(new Date().getFullYear())] = [];

  // 이미 있는 그 차량의 탭도 함께 손본다. 줄을 지난해로 옮겼거나 모두 지웠으면
  // 그 해 탭에 옛 줄이 남아 있기 때문이다.
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var tab = drivingTabOf(sheets[s].getName());
    if (tab && tab.year && tab.vehicle === vehicle && !byYear[tab.year]) {
      byYear[tab.year] = [];
    }
  }

  var written = [];
  var total = 0;
  for (var y in byYear) {
    var name = drivingSheetName(vehicle, y);
    var sheet = ss.getSheetByName(name);
    // 줄이 없는 해의 탭은 **없으면 만들지 않는다** (빈 탭이 늘어난다).
    if (!sheet) {
      if (!byYear[y].length) continue;
      sheet = ss.insertSheet(name);
    }
    writeDrivingYear(sheet, vehicle, info, byYear[y], y);
    written.push(name);
    total += byYear[y].length;
  }
  logChange(ss, body, '운행일지', vehicle, '기록 ' + total + '줄 · ' + written.join(', '));
  return json({ ok: true, sheetName: written[0] || '', sheets: written, count: total });
}

/** 한 해치 탭 하나를 통째로 다시 쓴다. */
function writeDrivingYear(sheet, vehicle, info, rows, year) {
  writeDrivingHead(sheet, vehicle, info, rows, year);

  var values = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var before = Number(r.odoBefore) || 0;
    var after = Number(r.odoAfter) || 0;
    values.push([
      String(r.date || ''),
      String(r.weekday || ''),
      String(r.dept || ''),
      String(r.driverName || ''),
      before,
      after,
      // ⑦ 은 앱이 보낸 값을 믿지 않고 **여기서 다시 뺀다.**
      // 시트만 보는 사람에게도 ⑤⑥⑦ 이 어긋나 보이면 안 된다.
      after >= before ? after - before : (Number(r.distance) || 0),
      String(r.fromPlace || ''),
      String(r.toPlace || ''),
      String(r.note || ''),
      String(r.id || ''),
    ]);
  }

  // 값을 먼저 만들고 **그 다음에** 옛 줄을 지운다 (리포트 항목 탭과 같은 이유).
  var last = sheet.getLastRow();
  if (last >= DRIVING_FIRST_ROW) {
    sheet.getRange(DRIVING_FIRST_ROW, 1, last - DRIVING_FIRST_ROW + 1,
                   DRIVING_HEADER.length).clearContent();
  }
  if (values.length) {
    sheet.getRange(DRIVING_FIRST_ROW, 1, values.length, DRIVING_HEADER.length)
      .setValues(values);
    sheet.getRange(DRIVING_FIRST_ROW, 5, values.length, 3).setNumberFormat('#,##0');
  }
}

/** 서식의 머리 다섯 줄. 매번 다시 쓴다 — 사람이 지워도 되살아난다. */
function writeDrivingHead(sheet, vehicle, info, rows, year) {
  var total = 0;
  for (var i = 0; i < (rows || []).length; i++) {
    var b = Number(rows[i].odoBefore) || 0;
    var a = Number(rows[i].odoAfter) || 0;
    total += a >= b ? a - b : (Number(rows[i].distance) || 0);
  }

  sheet.getRange(1, 1).setValue('법 인 차 량 운 행 일 지');
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(15);
  sheet.getRange(2, 1, 1, 5).setValues([['법인명', COMPANY_NAME, '',
                                         '사업자등록번호', COMPANY_BIZ_NO]]);
  sheet.getRange(3, 1, 1, 8).setValues([[
    '①차종', String(info.model || ''), '',
    '②자동차등록번호', String(info.plate || ''), '',
    '사업연도', year + '-01-01 ~ ' + year + '-12-31']]);
  sheet.getRange(4, 1, 1, 7).setValues([[
    '운행 건수', (rows || []).length, '', '', '', '⑦주행거리 합계(㎞)', total]]);
  sheet.getRange(4, 7).setNumberFormat('#,##0');

  var head = sheet.getRange(5, 1, 1, DRIVING_HEADER.length);
  head.setValues([DRIVING_HEADER]);
  head.setFontWeight('bold').setBackground('#f0f2f6').setWrap(true);
  sheet.setFrozenRows(5);
  for (var c = 0; c < DRIVING_WIDTHS.length; c++) {
    sheet.setColumnWidth(c + 1, DRIVING_WIDTHS[c]);
  }
}

function readDrivingHead(sheet) {
  var values = sheet.getRange(3, 1, 1, 5).getValues()[0];
  return { model: String(values[1] || '').trim(), plate: String(values[4] || '').trim() };
}

function readDrivingSheet(sheet) {
  var last = sheet.getLastRow();
  if (last < DRIVING_FIRST_ROW) return [];
  var values = sheet.getRange(DRIVING_FIRST_ROW, 1,
                              last - DRIVING_FIRST_ROW + 1, DRIVING_HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var date = drivingDateText(r[0]);
    if (!date) continue;                       // 빈 줄은 건너뛴다
    var before = Number(r[4]) || 0;
    var after = Number(r[5]) || 0;
    out.push({
      id: String(r[10] || '').trim(),
      date: date,
      weekday: String(r[1] || '').trim(),
      dept: String(r[2] || '').trim(),
      driverName: String(r[3] || '').trim(),
      odoBefore: before,
      odoAfter: after,
      distance: after >= before ? after - before : (Number(r[6]) || 0),
      fromPlace: String(r[7] || '').trim(),
      toPlace: String(r[8] || '').trim(),
      note: String(r[9] || '').trim(),
    });
  }
  return out;
}

/**
 * 사용일자 칸을 'YYYY-MM-DD' 로.
 *
 * 시트는 '2026-09-14' 를 날짜로 바꿔 담는다. 그대로 String() 하면
 * 'Mon Sep 14 2026 …' 같은 글자가 되어 앱이 못 읽는다.
 */
function drivingDateText(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  var text = String(value === undefined || value === null ? '' : value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

// ------------------------------------------------- 부서 · 장소 선택지

function readDrivingOptions(ss) {
  var sheet = ss.getSheetByName(DRIVING_OPTION_SHEET);
  var out = { depts: [], places: [] };
  if (!sheet || sheet.getLastRow() < 3) return out;
  var values = sheet.getRange(3, 1, sheet.getLastRow() - 2, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    var kind = String(values[i][0] || '').trim();
    var name = String(values[i][1] || '').trim();
    if (!name) continue;
    if (kind === '부서') out.depts.push(name);
    else if (kind === '장소') out.places.push(name);
  }
  return out;
}

function writeDrivingOptions(ss, depts, places) {
  var sheet = ss.getSheetByName(DRIVING_OPTION_SHEET);
  if (!sheet) sheet = ss.insertSheet(DRIVING_OPTION_SHEET);

  var head = sheet.getRange(2, 1, 1, 2);
  head.setValues([['구분', '이름']]);
  head.setFontWeight('bold').setBackground('#f0f2f6');
  sheet.setFrozenRows(2);
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 240);

  var rows = [];
  for (var i = 0; i < depts.length; i++) rows.push(['부서', String(depts[i] || '')]);
  for (var j = 0; j < places.length; j++) rows.push(['장소', String(places[j] || '')]);

  var last = sheet.getLastRow();
  if (last >= 3) sheet.getRange(3, 1, last - 2, 2).clearContent();
  if (rows.length) sheet.getRange(3, 1, rows.length, 2).setValues(rows);
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
    // models: 탭이 없으면 null — "아직 아무도 안 만들었다" 와 "비어 있다" 를 가른다.
    return json({ ok: true, items: out, models: readGuideModels(ss) });
  }
  // 가이드 단계 사진을 드라이브에 저장한다.
  //   { guides: 'media', categoryType, title, files: [{filename, mimeType, data}] }
  //   → { ok, links: ['https://drive...', ...] }
  if (body.guides === 'media') {
    return json(saveGuideMedia(ss, body));
  }

  if (body.guides !== 'push') return json({ ok: false, error: '알 수 없는 요청입니다.' });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var items = body.items || [];
    var counts = {};
    var diff = { added: [], changed: [], removed: [] };
    var modelsBefore = readGuideModels(ss);
    for (var type in GUIDE_SHEETS) {
      var list = [];
      for (var i = 0; i < items.length; i++) {
        if ((items[i] || {}).categoryType === type) list.push(items[i]);
      }
      list.sort(function (a, b) {
        return String(a.codeOrTitle || '').localeCompare(String(b.codeOrTitle || ''), 'ko');
      });
      var oldTab = ss.getSheetByName(GUIDE_SHEETS[type]);
      guideDiff(oldTab ? readGuideSheet(oldTab, type) : [], list, diff, function (gone) {
        putInTrash(ss, body, '가이드', GUIDE_SHEETS[type] + ' · ' + gone.codeOrTitle, gone);
      });
      writeGuideSheet(ss, GUIDE_SHEETS[type], list);
      counts[type] = list.length;
    }
    if (Object.prototype.toString.call(body.models) === '[object Array]') {
      writeGuideModels(ss, body.models);
      var after = readGuideModels(ss) || [];
      if ((modelsBefore || []).join('|') !== after.join('|')) {
        logChange(ss, body, '가이드 로봇', '로봇 분류', (modelsBefore || []).join(', ') + ' → ' + after.join(', '));
      }
    }
    SpreadsheetApp.flush();
    if (diff.added.length || diff.changed.length || diff.removed.length) {
      logChange(ss, body, '가이드', '추가 ' + diff.added.length + ' · 수정 ' + diff.changed.length
                + ' · 삭제 ' + diff.removed.length,
                [diff.added.length ? '추가: ' + diff.added.join(', ') : '',
                 diff.changed.length ? '수정: ' + diff.changed.join(', ') : '',
                 diff.removed.length ? '삭제(휴지통): ' + diff.removed.join(', ') : '']
                  .filter(function (x) { return x; }).join(' / '));
    }
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
  /** 열 이름으로 찾는다. 없으면 '로봇' 열이 생기기 전 배치의 자리를 쓴다. */
  var colOf = function (name, legacy) {
    for (var c = 0; c < header.length; c++) {
      if (String(header[c] || '').trim() === name) return c;
    }
    return legacy;
  };
  var idCol = colOf(GUIDE_ID_HEADER, -1);
  var robotCol = colOf(GUIDE_ROBOT_HEADER, -1);
  var titleCol = colOf('코드/제목', 0);
  var summaryCol = colOf('요약', 1);
  var toolsCol = colOf('필요 공구', 2);
  var cmdCol = colOf('명령어', 3);
  var stepCol = colOf('단계', 4);
  var updatedCol = colOf('수정일', 5);

  var data = sheet.getRange(3, 1, lastRow - 2, lastCol).getDisplayValues();
  var out = [];
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var title = String(row[titleCol] || '').trim();
    if (!title) continue;

    var commands = [];
    String(row[cmdCol] || '').split(NEWLINE).forEach(function (line) {
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

    // 단계 사진 — `1. <주소>` 꼴. 번호로 몇 번째 단계인지 알아낸다.
    var photoCol = -1;
    for (var pc = 0; pc < header.length; pc++) {
      if (String(header[pc] || '').trim() === GUIDE_PHOTO_HEADER) { photoCol = pc; break; }
    }
    var photos = {};
    if (photoCol >= 0) {
      String(row[photoCol] || '').split(NEWLINE).forEach(function (line) {
        var text = line.trim();
        if (!text) return;
        var m = text.match(/^(\d+)\.\s*(.+)$/);
        if (m) photos[Number(m[1])] = m[2].trim();
      });
    }

    // 단계 칸 읽기 — **다음 번호로 시작하는 줄**만 새 단계다 ('1. …' 다음은 '2. …').
    // 번호가 없거나 띄워 쓴 줄, 번호가 차례에 안 맞는 줄은 앞 단계에 이어 붙인다.
    // 예전에는 줄마다 새 단계로 읽어, 한 단계에 여러 줄을 쓰면 단계가 여러 개로 갈라졌다.
    var blocks = [];
    String(row[stepCol] || '').replace(/\r/g, '').split(NEWLINE).forEach(function (line) {
      var num = line.match(/^(\d+)\.\s*(.*)$/);
      if (num && Number(num[1]) === blocks.length + 1) { blocks.push([num[2]]); return; }
      if (!blocks.length) { if (line.trim()) blocks.push([line.trim()]); return; }
      blocks[blocks.length - 1].push(line.replace(/^ {1,3}/, ''));
    });
    var steps = [];
    blocks.forEach(function (block) {
      var text = block.join(NEWLINE).replace(/\s+$/, '');
      var metric = '';
      // 단계에 딸린 값. 예전에는 '기준 수치'였고 지금은 '필요 공구'다.
      // 옛 기록을 그대로 읽어야 하므로 두 이름을 모두 받는다. 여러 줄이면 맨 끝에 붙어 있다.
      var mark = text.lastIndexOf('  (공구: ');
      if (mark < 0) mark = text.lastIndexOf('  (기준: ');
      if (mark >= 0) {
        metric = text.slice(mark + 7).replace(/\)$/, '').trim();
        text = text.slice(0, mark);
      }
      text = text.trim();
      if (!text) return;
      steps.push({
        instruction: text,
        expectedMetric: metric || null,
        imageUrl: photos[steps.length + 1] || null
      });
    });

    out.push({
      id: idCol >= 0 ? String(row[idCol] || '').trim() : '',
      categoryType: categoryType,
      robotModel: robotCol >= 0 ? String(row[robotCol] || '').trim() : '',
      codeOrTitle: title,
      summary: String(row[summaryCol] || '').trim(),
      requiredTools: String(row[toolsCol] || '').trim(),
      commands: commands,
      steps: steps,
      updatedAt: String(row[updatedCol] || '').trim()
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
    var photos = [];
    var stepList = g.steps || [];
    for (var k = 0; k < stepList.length; k++) {
      var step = stepList[k] || {};
      // 한 단계 안의 여러 줄은 둘째 줄부터 앞을 띄워 적는다 — 번호 없이 띄운 줄은 앞 단계에 이어진다.
      // (예전에는 줄마다 새 단계로 읽혀, 여러 줄로 쓴 단계가 새로고침 뒤 여러 단계로 갈라졌다)
      var lines = String(step.instruction || '').replace(/\r/g, '').split(NEWLINE);
      var text = (k + 1) + '. ' + lines[0];
      for (var ln = 1; ln < lines.length; ln++) text += NEWLINE + '   ' + lines[ln];
      if (step.expectedMetric) text += '  (공구: ' + step.expectedMetric + ')';
      steps.push(text);
      // 드라이브에 올라간 사진만 적는다. 기기 안에만 있는 것(/media/...)은
      // 다른 사람이 열 수 없으므로 시트에 적어 봐야 소용이 없다.
      var url = String(step.imageUrl || '');
      if (url.indexOf('http') === 0) photos.push((k + 1) + '. ' + url);
    }
    // 칸 수는 GUIDE_HEADER 와 반드시 같아야 한다. 다르면 setValues 가 예외를 던지는데,
    // 그 직전에 clearContents() 가 이미 실행돼 탭이 비워진 채로 남는다.
    rows.push([
      g.robotModel || '',
      g.codeOrTitle || '', g.summary || '', g.requiredTools || '',
      commands.join(NEWLINE), steps.join(NEWLINE),
      String(g.updatedAt || '').replace('T', ' '),
      photos.join(NEWLINE),
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

/** 로봇 분류 목록. 탭이 없으면 null. */
function readGuideModels(ss) {
  var sheet = ss.getSheetByName(GUIDE_MODEL_SHEET);
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];
  var data = sheet.getRange(3, 1, lastRow - 2, 1).getDisplayValues();
  var out = [];
  for (var r = 0; r < data.length; r++) {
    var name = String(data[r][0] || '').trim();
    if (name && out.indexOf(name) < 0) out.push(name);
  }
  return out;
}

function writeGuideModels(ss, models) {
  var sheet = ss.getSheetByName(GUIDE_MODEL_SHEET);
  if (!sheet) sheet = ss.insertSheet(GUIDE_MODEL_SHEET);
  var names = [];
  for (var i = 0; i < models.length; i++) {
    var name = String(models[i] || '').trim();
    if (name && names.indexOf(name) < 0) names.push(name);
  }
  sheet.clearContents();
  var header = sheet.getRange(2, 1, 1, 1);
  header.setValues([GUIDE_MODEL_HEADER]);
  header.setFontWeight('bold');
  header.setBackground('#eef1f5');
  sheet.setColumnWidth(1, 320);
  if (!names.length) return;
  sheet.getRange(3, 1, names.length, 1).setValues(names.map(function (n) { return [n]; }));
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
  while (found.hasNext()) {
    var f = found.next();
    if (!f.isTrashed || !f.isTrashed()) return f;     // 휴지통에 든 폴더에는 넣지 않는다
  }
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

/** 가이드 이름표 — 폴더 이름으로도 쓴다 (시트 탭 이름과 같다). */
var GUIDE_FOLDER_ROOT = '가이드';

/**
 * 가이드 단계 사진이 들어갈 폴더.
 *   <공유 드라이브>/가이드/<분류>/<제목>/사진/
 *
 * 리포트 첨부(매장 → 날짜 → 사진)와 **같은 뿌리**를 쓰되 가지가 다르다.
 * 사람이 드라이브에서 직접 찾을 때 "무슨 가이드의 사진" 인지가 경로에 보인다.
 */
function guideMediaFolder(root, categoryType, title, mimeType) {
  var base = folderByName(root, GUIDE_FOLDER_ROOT);
  var label = GUIDE_SHEETS[categoryType] || '분류 미지정';
  var kind = folderByName(base, safeFolderName(label, '분류 미지정'));
  var one = folderByName(kind, safeFolderName(title, '제목 없음'));
  // 리포트 첨부와 같은 갈래 — 사람이 드라이브에서 찾을 때 같은 자리를 본다.
  var isVideo = String(mimeType || '').indexOf('video/') === 0;
  return folderByName(one, isVideo ? VIDEO_FOLDER_NAME : PHOTO_FOLDER_NAME);
}

/**
 * 가이드 단계 사진을 드라이브에 저장하고 주소를 돌려준다.
 *   { guides: 'media', categoryType, title, files: [{filename, mimeType, data}] }
 *   → { ok, links: [...], skipped: [...], shared }
 */
function saveGuideMedia(ss, body) {
  var files = body.files || [];
  if (!files.length) return { ok: true, links: [], skipped: [] };

  var space = driveSpace();
  var needed = 0;
  for (var n = 0; n < files.length; n++) {
    needed += Math.ceil((String((files[n] || {}).data || '').length * 3) / 4);
  }
  if (space.free !== null && needed > space.free) {
    return { ok: false, error: '구글 드라이브 용량이 부족합니다 (남은 공간 '
      + Math.round(space.free / 1048576) + 'MB, 필요 '
      + Math.round(needed / 1048576) + 'MB)' };
  }

  var root = mediaRoot(ss);
  var links = [];
  var skipped = [];
  var publicCount = 0;
  var privateCount = 0;
  for (var i = 0; i < files.length; i++) {
    var item = files[i] || {};
    try {
      var bytes = Utilities.base64Decode(item.data);
      var blob = Utilities.newBlob(bytes,
                                   item.mimeType || 'application/octet-stream',
                                   item.filename || ('사진' + (i + 1)));
      // 사진과 영상은 폴더를 나눈다 — 파일마다 정한다.
      var folder = guideMediaFolder(root.folder, body.categoryType, body.title,
                                    item.mimeType);
      var file = folder.createFile(blob);
      if (sharePublic(file)) publicCount++; else privateCount++;
      links.push(file.getUrl());
    } catch (err) {
      skipped.push({ filename: item.filename || '(이름 없음)',
                     reason: String(err).slice(0, 120) });
    }
  }
  return { ok: true, links: links, skipped: skipped, shared: root.shared,
           publicCount: publicCount, privateCount: privateCount };
}

/**
 * 파일을 **링크가 있는 누구나 볼 수 있게** 만든다. 성공하면 true.
 *
 * 왜 이게 중요한가 — 앱은 사진을 `drive.google.com/thumbnail?id=...` 로 그린다.
 * 이 주소는 파일이 공개돼 있을 때만 그림을 준다. 구글 로그인 쿠키는
 * 다른 사이트의 <img> 요청에는 붙지 않기 때문이다(SameSite). 그래서 파일이
 * 비공개면 **올린 본인 화면에서도** 액박이 뜬다.
 *
 * 예전에는 DriveApp.setSharing 한 번만 시도하고 실패를 조용히 삼켰다.
 * 공유 드라이브에서는 이 호출이 거의 항상 실패한다 — 그래서 팀 전체가
 * 사진을 못 봤다. 이제 고급 드라이브 서비스로 한 번 더 시도하고,
 * 그래도 안 되면 **실패했다고 알려 준다**(앱이 바이트를 직접 받아 그린다).
 */
function sharePublic(file) {
  var id = file.getId();
  // 1) 고급 드라이브 서비스 — 공유 드라이브를 제대로 다룬다.
  //    [서비스] 에서 'Drive API' 를 켜 두면 쓰인다. 없으면 조용히 넘어간다.
  try {
    if (typeof Drive !== 'undefined' && Drive.Permissions) {
      Drive.Permissions.create({ role: 'reader', type: 'anyone' }, id,
                               { supportsAllDrives: true });
      return true;
    }
  } catch (advErr) { /* 정책으로 막혔거나 서비스가 꺼져 있다 */ }

  // 2) 기본 DriveApp — 내 드라이브에서는 이것으로 충분하다.
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  } catch (basicErr) { /* 공유 드라이브 정책 — 아래에서 false 를 돌려준다 */ }

  return false;
}

/**
 * 시트 칸에 여러 줄의 주소를 **파란 링크로** 적는다.
 *
 * setValue 로 주소를 넣으면 시트가 글자로만 저장해서 검은색으로 보인다
 * (여러 줄이면 자동 링크도 안 걸린다). 서식 있는 값으로 넣어야 눌러서
 * 열 수 있는 링크가 된다.
 */
function writeLinkCell(sheet, rowIndex, column, urls) {
  var list = urls || [];
  if (!list.length) return;
  var text = list.join(NEWLINE);
  try {
    var builder = SpreadsheetApp.newRichTextValue().setText(text);
    var at = 0;
    for (var i = 0; i < list.length; i++) {
      var len = String(list[i]).length;
      builder.setLinkUrl(at, at + len, list[i]);
      at += len + 1;                       // 줄바꿈 한 글자
    }
    sheet.getRange(rowIndex, column).setRichTextValue(builder.build());
  } catch (err) {
    // 서식 있는 값이 안 되면 글자로라도 남긴다 — 주소는 잃지 않는다.
    sheet.getRange(rowIndex, column).setValue(text);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 앱 버전 — 태블릿이 "새 버전이 있나" 를 물어보는 곳
//
// 빌드 자동화(GitHub Actions)가 APK 를 Dropbox 에 올린 뒤 여기에 한 줄 적는다.
// 태블릿은 시트를 받아올 때 함께 물어보고, 지금 버전보다 높으면 [업데이트]
// 띠를 띄운다. 사람이 개입할 지점이 **이 탭**이다 — '공개' 칸을 N 으로 바꾸면
// 그 버전 안내가 멈추고, 줄을 지우면 없던 일이 된다.
// ═══════════════════════════════════════════════════════════════════
var RELEASE_SHEET = '앱 버전';
var RELEASE_HEADER = ['버전', '빌드', '배포일시', '다운로드 링크', '크기(MB)', '변경 요약', '공개'];

function releaseSheet(ss, create) {
  var sheet = ss.getSheetByName(RELEASE_SHEET);
  if (!sheet && create) {
    sheet = ss.insertSheet(RELEASE_SHEET);
    sheet.getRange(1, 1, 1, RELEASE_HEADER.length).setValues([RELEASE_HEADER]);
    sheet.getRange(1, 1, 1, RELEASE_HEADER.length).setFontWeight('bold').setBackground('#eef1f5');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** '3.16.0' 같은 버전을 숫자 배열로. 비교는 compareVersions 로 한다. */
function versionParts(v) {
  return String(v || '').trim().split('.').map(function (x) { return parseInt(x, 10) || 0; });
}
function compareVersions(a, b) {
  var pa = versionParts(a);
  var pb = versionParts(b);
  for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
    var d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** 시트가 날짜로 바꿔 둔 칸을 사람이 적은 모양(2026-09-07 16:51)으로 되돌린다. */
function cellText(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  }
  return String(value === undefined || value === null ? '' : value);
}

/** '공개' 칸. 비어 있으면 공개로 본다. N · 아니오 · X · FALSE 면 숨긴다. */
function isReleasePublic(value) {
  var t = String(value === undefined || value === null ? '' : value).trim().toUpperCase();
  if (!t) return true;
  return !(t === 'N' || t === 'NO' || t === '아니오' || t === 'X' || t === 'FALSE' || t === '비공개');
}

/**
 * 빌드 자동화가 부른다.
 *   { release: 'publish', version: '3.16.0', build: '29', url: 'https://...?dl=1',
 *     sizeMb: 4.8, notes: '동영상 첨부' }
 *   → { ok, row, version }
 */
function handleReleasePublish(ss, body) {
  var version = String(body.version || '').trim();
  var url = String(body.url || '').trim();
  if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
    return json({ ok: false, error: 'version 은 3.16.0 모양이어야 합니다: ' + version });
  }
  if (!/^https:\/\//.test(url)) {
    return json({ ok: false, error: 'url 은 https 로 시작해야 합니다.' });
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = releaseSheet(ss, true);
    var at = sheet.getLastRow() + 1;
    var when = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
    var row = [version, String(body.build || ''), when, url,
               body.sizeMb ? Math.round(Number(body.sizeMb) * 10) / 10 : '',
               String(body.notes || '').slice(0, 500), 'Y'];
    sheet.getRange(at, 1, 1, row.length).setValues([row]);
    writeLinkCell(sheet, at, 4, [url]);      // 눌러서 열 수 있는 링크로
    return json({ ok: true, row: at, version: version });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 태블릿이 부른다. '공개' 인 것 중 가장 높은 버전 하나.
 *   { release: 'latest' } → { ok, version, build, url, sizeMb, notes, publishedAt }
 * 탭이 없거나 비어 있으면 version 이 빈 문자열이다 — 오류가 아니다.
 */
function handleReleaseLatest(ss, body) {
  var link = installLinkRow(ss);
  var empty = { ok: true, version: '', build: '', url: '', sizeMb: 0, notes: '', publishedAt: '',
                installUrl: link.installUrl, downloadUrl: link.downloadUrl, minVersion: minAppVersion(ss) };
  var sheet = releaseSheet(ss, false);
  if (!sheet || sheet.getLastRow() < 2) return json(empty);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, RELEASE_HEADER.length).getValues();
  var best = null;
  rows.forEach(function (r) {
    var v = String(r[0] || '').trim();
    var url = String(r[3] || '').trim();
    if (!v || !url || !isReleasePublic(r[6])) return;
    if (!best || compareVersions(v, best.version) > 0) {
      best = { ok: true, version: v, build: String(r[1] || ''), publishedAt: cellText(r[2]),
               url: url, sizeMb: Number(r[4]) || 0, notes: String(r[5] || ''),
               installUrl: link.installUrl, downloadUrl: link.downloadUrl, minVersion: minAppVersion(ss) };
    }
  });
  return json(best || empty);
}

// ═══════════════════════════════════════════════════════════════════
// 앱 설치 링크 — 사람에게 보내 주는 **바뀌지 않는** 주소
//
// 왜 따로 두나 — 앱 안 [업데이트] 는 Dropbox 주소를 쓴다. 그 주소는 버전마다
// 파일 이름이 달라져서 매번 바뀐다. 사람에게 카톡으로 보내 주는 주소가 매번
// 바뀌면 예전에 보낸 주소를 받은 사람은 옛 버전을 받는다.
//
// 그래서 드라이브에 파일 **하나**를 두고 그 **내용만** 갈아 끼운다. 드라이브
// 파일은 내용을 바꿔도 ID 가 그대로라, 아래 주소가 영원히 같은 자리를 가리키며
// 언제 눌러도 그때의 최신 APK 를 준다.
//
//   https://drive.google.com/file/d/<파일ID>/view?usp=drive_link
//
// 어디에 있나 — <공유 드라이브>/앱 설치 파일/현장포털-설치.apk
// 주소는 시트 '앱 설치 링크' 탭에 적어 둔다 (사람이 눈으로 찾는 자리).
// ═══════════════════════════════════════════════════════════════════
var APK_FOLDER_NAME = '앱 설치 파일';
var APK_FILE_NAME = '현장포털-설치.apk';
var APK_MIME = 'application/vnd.android.package-archive';
var APK_ID_PROP = 'APK_FILE_ID';
var INSTALL_SHEET = '앱 설치 링크';
var INSTALL_HEADER = ['설치 링크 (사람에게 보내는 주소)', '바로 내려받기',
                      '드라이브 파일 ID', '마지막 갱신', '버전'];

function driveViewUrl(id) {
  return 'https://drive.google.com/file/d/' + id + '/view?usp=drive_link';
}
/**
 * 누르면 **바로** 파일이 떨어지는 주소.
 *
 * drive.google.com/uc?export=download 는 APK 를 줄 때 "바이러스 검사를 할 수
 * 없습니다" 안내 화면을 한 번 끼운다 (사람이 한 번 더 눌러야 한다).
 * 그 화면의 [다운로드] 가 실제로 부르는 주소가 이것이다 — 로그인도 필요 없다.
 */
function driveDownloadUrl(id) {
  return 'https://drive.usercontent.google.com/download?id=' + id
       + '&export=download&confirm=t';
}

/** 파일 ID 를 스크립트 속성에도 남긴다 — 시트 탭을 지워도 링크가 안 바뀐다. */
function savedApkId() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(APK_ID_PROP) || '').trim();
  } catch (err) {
    return '';
  }
}
function rememberApkId(id) {
  try {
    PropertiesService.getScriptProperties().setProperty(APK_ID_PROP, String(id));
  } catch (err) { /* 속성을 못 써도 시트에 적어 두므로 잃지 않는다 */ }
}

function installSheet(ss, create) {
  var sheet = ss.getSheetByName(INSTALL_SHEET);
  if (!sheet && create) {
    sheet = ss.insertSheet(INSTALL_SHEET);
    sheet.getRange(1, 1, 1, INSTALL_HEADER.length).setValues([INSTALL_HEADER]);
    sheet.getRange(1, 1, 1, INSTALL_HEADER.length).setFontWeight('bold').setBackground('#eef1f5');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 지금 쓰이는 설치 주소. 아직 만든 적이 없으면 빈 문자열이다 (오류가 아니다). */
function installLinkRow(ss) {
  var out = { installUrl: '', downloadUrl: '', fileId: '' };
  var sheet = installSheet(ss, false);
  var id = '';
  if (sheet && sheet.getLastRow() >= 2) {
    var r = sheet.getRange(2, 1, 1, INSTALL_HEADER.length).getValues()[0];
    id = String(r[2] || '').trim();
    out.installUrl = String(r[0] || '').trim();
    out.downloadUrl = String(r[1] || '').trim();
  }
  if (!id) id = savedApkId();
  out.fileId = id;
  if (id && !out.installUrl) out.installUrl = driveViewUrl(id);
  if (id && !out.downloadUrl) out.downloadUrl = driveDownloadUrl(id);
  return out;
}

/** <공유 드라이브>/앱 설치 파일/ */
function apkFolder(ss) {
  return folderByName(mediaRoot(ss).folder, APK_FOLDER_NAME);
}

/**
 * 갈아 끼울 파일을 찾는다.
 *  1) 기억해 둔 ID  2) 시트에 적힌 ID  3) 폴더에서 같은 이름
 * 셋 다 없으면 null — 그러면 새로 만든다(그때 한 번 주소가 정해진다).
 */
function findApkFile(ss) {
  var known = installLinkRow(ss).fileId;
  if (known) {
    try {
      var file = DriveApp.getFileById(known);
      if (!file.isTrashed || !file.isTrashed()) return file;
    } catch (err) { /* 지워졌다 — 아래에서 다시 찾는다 */ }
  }
  try {
    var it = apkFolder(ss).getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getName() === APK_FILE_NAME) return f;
    }
  } catch (err) { /* 폴더에 못 닿았다 */ }
  return null;
}

/**
 * 파일 **ID 를 그대로 둔 채** 내용만 바꾼다.
 * 고급 드라이브 서비스만 할 수 있다 (DriveApp 에는 방법이 없다).
 */
function replaceApkBytes(file, blob) {
  try {
    if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.update) {
      Drive.Files.update({ name: APK_FILE_NAME }, file.getId(), blob,
                         { supportsAllDrives: true });
      return true;
    }
  } catch (err) { /* 아래에서 false — 부르는 쪽이 새로 만든다 */ }
  return false;
}

/**
 * 빌드 자동화가 부른다. Dropbox 에 올려 둔 APK 를 드라이브의 고정 파일에 옮긴다.
 *   { release: 'install', version: '3.20.0', build: '42',
 *     url: 'https://...dl=1' }   또는   { data: '<base64>' }
 *   → { ok, installUrl, downloadUrl, fileId, replaced, created, linkChanged,
 *       shared, sizeMb }
 *
 * replaced=true 면 주소가 그대로다. false 면 파일을 새로 만든 것이라
 * **주소가 바뀌었다** — 예전에 보낸 주소는 옛 APK 를 준다.
 */
function handleReleaseInstall(ss, body) {
  var version = String(body.version || '').trim();
  var blob;
  if (body.data) {
    blob = Utilities.newBlob(Utilities.base64Decode(String(body.data)), APK_MIME, APK_FILE_NAME);
  } else {
    var url = String(body.url || '').trim();
    if (!/^https:\/\//.test(url)) {
      return json({ ok: false, error: 'url 은 https 로 시작해야 합니다 (또는 data 로 보내세요).' });
    }
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    var code = resp.getResponseCode();
    if (code !== 200) {
      return json({ ok: false, error: 'APK 를 받아오지 못했습니다 (' + code + ') — ' + url });
    }
    blob = resp.getBlob().setName(APK_FILE_NAME);
  }
  try { blob.setContentType(APK_MIME); } catch (err) { /* 형이 없어도 올라간다 */ }

  var bytes = 0;
  try { bytes = (blob.getBytes() || []).length; } catch (err) { bytes = 0; }
  if (bytes && bytes < 100000) {
    // dl=1 이 아니라 미리보기 HTML 을 받아 온 적이 있다. 그러면 몇 KB 짜리
    // 파일이 APK 인 척 올라가고, 받은 사람은 설치 실패만 본다.
    return json({ ok: false,
                  error: 'APK 가 너무 작습니다 (' + bytes + '바이트). 주소가 파일이 아니라 '
                       + '미리보기 페이지를 가리키는지 확인하세요 (Dropbox 는 dl=1).' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var file = findApkFile(ss);
    var hadFile = Boolean(file);
    var replaced = false;
    if (file) replaced = replaceApkBytes(file, blob);
    if (!replaced) {
      // 처음이거나 갈아 끼우지 못했다 — 새 파일을 만든다(주소가 새로 정해진다).
      if (file && !replaced) { try { file.setTrashed(true); } catch (err2) { /* 남겨 둔다 */ } }
      file = apkFolder(ss).createFile(blob);
      try { file.setName(APK_FILE_NAME); } catch (err3) { /* 이름은 blob 것으로 */ }
    }
    var id = file.getId();
    var shared = sharePublic(file);
    rememberApkId(id);

    var sheet = installSheet(ss, true);
    var when = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
    var row = [driveViewUrl(id), driveDownloadUrl(id), id, when, version];
    sheet.getRange(2, 1, 1, row.length).setValues([row]);
    writeLinkCell(sheet, 2, 1, [row[0]]);      // 눌러서 열 수 있는 파란 링크로
    writeLinkCell(sheet, 2, 2, [row[1]]);

    return json({ ok: true, fileId: id, installUrl: driveViewUrl(id),
                  downloadUrl: driveDownloadUrl(id), replaced: replaced,
                  // created  = 이번에 처음 만들었다 (주소가 지금 정해졌다)
                  // linkChanged = 있던 파일을 못 고쳐서 새로 만들었다
                  //               → 예전에 보낸 주소는 **옛 APK** 를 준다
                  created: !hadFile, linkChanged: hadFile && !replaced,
                  shared: shared, version: version,
                  sizeMb: bytes ? Math.round(bytes / 104857.6) / 10 : 0 });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 스프레드시트 파일이 마지막으로 바뀐 시각 (ISO).
 *
 * 앱이 올린 것도, 사람이 시트에서 직접 고친 것도 모두 잡힌다 — 드라이브의
 * 파일 수정 시각이기 때문이다. 드라이브에 닿지 못하면 빈 문자열을 준다.
 * 앱은 빈 값을 "모른다" 로 보고 아무 표시도 하지 않는다.
 */
function handleChanged(ss, body) {
  var stamp = '';
  try {
    stamp = DriveApp.getFileById(ss.getId()).getLastUpdated().toISOString();
  } catch (err) { /* 드라이브 권한이 없거나 잠시 안 닿음 */ }
  // 하루 한 번 백업 · 기기 기록 — 5분마다 오는 이 물음에 얹는다 (트리거가 필요 없다)
  backupIfDue(ss);
  touchDevice(ss, body || {}, { pending: body && body.pending });
  return json({ ok: true, changedAt: stamp, minVersion: minAppVersion(ss) });
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
  var out = { byColumn: {}, count: 0, skipped: [], publicCount: 0, privateCount: 0 };
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
      // 공개로 만들지 못하면 앱이 바이트를 직접 받아 그린다. 그래서 결과를 센다.
      if (sharePublic(file)) out.publicCount++; else out.privateCount++;

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
/** 항목 줄의 첫 칸 — 자료 줄과 구분하는 기준이다 (앱의 META_HEADERS[0] 과 같아야 한다) */
var REPORT_FIRST_HEADER = '작성일시';
var REPORT_HEADER_ROW = 2;
var REPORT_DATA_ROW = 3;
// 월 탭 이름. 항목이 바뀌어 갈라진 탭도 같은 달로 본다 — `2026-09`, `2026-09 (2)`
// 새로 만들 때는 `2026-09` 하나만 쓴다. 예전 판이 만든 `2026-09 (2)` 탭도
// 목록에는 계속 보여 준다 — 이미 쌓인 리포트를 못 보게 하면 안 된다.
var MONTH_TAB = /^\d{4}-\d{2}( \(\d+\))?$/;

/* ── 리포트 번호 목록 (소비자 앱 시트) ─────────────────────────────────
 *
 * 매장이 소비자 앱으로 접수한 리포트는 **다른 스프레드시트**(비욘드허니컴
 * 소비자용)의 [리포트] 탭에 쌓인다. 그중 **아직 끝나지 않은 필드팀 방문
 * 대상**만 고를 수 있어야 한다. 두 칸을 함께 본다:
 *   조치결과  '필드팀 요청'        — 필드팀이 가야 하는 건
 *   콘솔 상태 '대기' 또는 '진행중' — 아직 끝나지 않은 건
 * 둘 다 맞아야 목록에 넣는다. 콘솔에서 끝난 건이 목록에 남아 있으면
 * 같은 접수로 현장 리포트가 두 번 써진다.
 *
 *  { reports: 'numbers' } → [{ number, store, problem, receivedAt }] 최근 것부터
 */
var CONSUMER_SS_ID = '1ZUsgwFVX1O97778MKoedU2f-UsnShRcrI85o5WNICwo';
var CONSUMER_REPORT_GID = 1882930844;     // [리포트] 탭 — 이름이 바뀌어도 gid 는 그대로
var CONSUMER_REQUEST_MARK = '필드팀';     // '조치결과' 칸에 이 말이 들어 있으면 필드팀 요청 건
// '콘솔 상태' 칸에 이 말들 중 하나가 들어 있으면 아직 안 끝난 건.
// '진행' 만 본다 — '진행중' / '진행 중' 어느 쪽으로 적혀도 걸리게.
var CONSUMER_OPEN_MARKS = ['대기', '진행'];

/** 콘솔에서 아직 끝나지 않은 건인가 ('대기' · '진행중') */
function isConsoleOpen(value) {
  var text = String(value || '').replace(/\s/g, '');
  for (var i = 0; i < CONSUMER_OPEN_MARKS.length; i++) {
    if (text.indexOf(CONSUMER_OPEN_MARKS[i]) >= 0) return true;
  }
  return false;
}

/**
 * '콘솔 상태' 열 찾기.
 * 띄어쓰기('콘솔상태' / '콘솔 상태')가 언제든 달라질 수 있어 **낱말로** 찾는다.
 * 못 찾으면 -1 — 부르는 쪽이 조건을 슬그머니 빼지 않고 오류로 알린다.
 */
function findConsoleStatusColumn(head) {
  for (var i = 0; i < head.length; i++) {
    var name = String(head[i] || '').replace(/\s/g, '');
    if (name.indexOf('콘솔') >= 0 && name.indexOf('상태') >= 0) return i;
  }
  return -1;
}

function handleReportNumbers() {
  var sheet = null;
  try {
    var css = SpreadsheetApp.openById(CONSUMER_SS_ID);
    var all = css.getSheets();
    for (var i = 0; i < all.length; i++) {
      if (all[i].getSheetId() === CONSUMER_REPORT_GID) { sheet = all[i]; break; }
    }
  } catch (err) {
    return json({ ok: false, error: '소비자 리포트 시트를 열 수 없습니다: ' + err });
  }
  if (!sheet) return json({ ok: false, error: '소비자 시트에 [리포트] 탭이 없습니다.' });

  var last = sheet.getLastRow();
  if (last < 2) return json({ ok: true, items: [] });
  var values = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();

  // 열은 위치가 아니라 1행의 이름으로 찾는다 (열이 늘거나 옮겨져도 동작).
  var head = [];
  for (var c = 0; c < values[0].length; c++) head.push(String(values[0][c] || '').trim());
  var iNum = head.indexOf('리포트번호');
  var iStore = head.indexOf('매장명');
  var iProblem = head.indexOf('선택한 문제');
  var iResult = head.indexOf('조치결과');
  var iWhen = head.indexOf('접수시각');
  var iConsole = findConsoleStatusColumn(head);
  if (iNum < 0 || iResult < 0) {
    return json({ ok: false, error: '소비자 시트에서 리포트번호/조치결과 열을 찾지 못했습니다.' });
  }
  if (iConsole < 0) {
    return json({ ok: false,
                  error: "소비자 시트에서 '콘솔 상태' 열을 찾지 못했습니다." });
  }

  var items = [];
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iResult] || '').indexOf(CONSUMER_REQUEST_MARK) < 0) continue;
    if (!isConsoleOpen(values[r][iConsole])) continue;
    var number = String(values[r][iNum] || '').trim();
    if (!number) continue;
    var when = iWhen < 0 ? '' : values[r][iWhen];
    items.push({
      number: number,
      store: iStore < 0 ? '' : String(values[r][iStore] || '').trim(),
      problem: iProblem < 0 ? '' : String(values[r][iProblem] || '').trim(),
      receivedAt: when instanceof Date ? when.toISOString() : String(when || ''),
    });
  }
  items.reverse();                       // 최근 접수가 앞
  // statusHeader — 어느 열을 '콘솔 상태' 로 보았는지 (시트가 바뀌었을 때 확인용)
  return json({ ok: true, items: items.slice(0, 100), statusHeader: head[iConsole] });
}

function handleReports(ss, body) {
  if (body.reports === 'numbers') {
    return handleReportNumbers();
  }

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
      var rowIndex = resolveReportRow(target, Math.floor(Number(body.row) || 0), body.expect);
      if (rowIndex < REPORT_DATA_ROW) {
        return json({ ok: false, conflict: Boolean(body.expect), error: body.expect
          ? '그 리포트를 시트에서 찾지 못했습니다. 다른 기기에서 지웠거나 옮겼을 수 있습니다 — 이력을 새로고침해 주세요.'
          : '줄 번호가 올바르지 않습니다.' });
      }
      var line = body.row_values || [];
      if (!line.length) return json({ ok: false, error: 'row 가 비어 있습니다.' });

      // **항목 줄은 절대 고쳐 쓰지 않는다.** 그 줄이 속한 묶음의 항목 순서에
      // 맞춰 값을 다시 늘어놓는다. 앱의 항목 순서가 달라도 이름으로 맞춘다.
      var blockU = blockForRow(target, rowIndex);
      if (blockU && (body.headers || []).length) {
        var byName = {};
        for (var hi = 0; hi < body.headers.length; hi++) {
          byName[String(body.headers[hi] || '').trim()] = line[hi];
        }
        var mapped = [];
        for (var bi = 0; bi < blockU.headers.length; bi++) {
          var key = blockU.headers[bi];
          mapped.push(Object.prototype.hasOwnProperty.call(byName, key) ? byName[key] : '');
        }
        line = mapped;
      }

      // 첨부를 새로 올렸으면 드라이브에 저장하고 그 칸만 바꾼다.
      // 첨부의 열 번호는 앱의 항목 순서 기준이라, 그 줄의 항목 배치로 옮긴다.
      var savedU = saveMediaToDrive(ss, body.media || []);
      for (var colU in savedU.byColumn) {
        var idx = Number(colU) - 1;
        if (blockU && (body.headers || []).length) {
          var labelU = String(body.headers[idx] || '').trim();
          var toIdx = blockU.headers.indexOf(labelU);
          if (toIdx >= 0) idx = toIdx;
        }
        var had = String(line[idx] || '').trim();
        line[idx] = (had ? had + NEWLINE : '') + savedU.byColumn[colU].join(NEWLINE);
      }

      target.getRange(rowIndex, 1, 1, line.length).setValues([line]);
      target.getRange(rowIndex, 1, 1, line.length)
        .setVerticalAlignment('top').setWrap(true);
      // setValues 는 글자로만 적으므로, 첨부 칸을 다시 파란 링크로 살린다.
      relinkDriveCells(target, rowIndex, line);
      SpreadsheetApp.flush();
      logChange(ss, body, '리포트 수정', body.sheetName + ' ' + rowIndex + '행', reportSummary(body.headers || [], body.row_values || []));
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
      var rowD = resolveReportRow(sheetD, Math.floor(Number(body.row) || 0), body.expect);
      if (rowD < REPORT_DATA_ROW || rowD > sheetD.getLastRow()) {
        return json({ ok: false, conflict: Boolean(body.expect), error: body.expect
          ? '그 리포트를 시트에서 찾지 못했습니다. 이미 지워졌을 수 있습니다 — 이력을 새로고침해 주세요.'
          : '줄 번호가 올바르지 않습니다.' });
      }
      // 지우기 전에 통째로 휴지통에 — 설정 → 휴지통에서 되살린다
      var blockD = blockForRow(sheetD, rowD);
      var widthD = blockD ? blockD.headers.length : sheetD.getLastColumn();
      var valuesD = sheetD.getRange(rowD, 1, 1, Math.max(widthD, 1)).getDisplayValues()[0];
      var headersD = blockD ? blockD.headers : [];
      // 이 리포트의 사진 · 영상 — 휴지통 기록에 함께 적어 두었다가, 되살릴 때 같이 꺼낸다 (v3.38)
      var mediaD = reportMediaIds(valuesD);
      putInTrash(ss, body, '리포트', String(body.sheetName) + ' · ' + reportName(headersD, valuesD),
                 { sheetName: String(body.sheetName), headers: headersD, row: valuesD, media: mediaD });
      sheetD.deleteRow(rowD);
      SpreadsheetApp.flush();
      var movedD = setMediaTrashed(mediaD, true);
      logChange(ss, body, '리포트 삭제', body.sheetName + ' ' + rowD + '행',
                reportSummary(headersD, valuesD) + (mediaD.length ? ' · 사진 · 영상 ' + movedD.done + '개 드라이브 휴지통' : ''));
      return json({ ok: true, sheetName: body.sheetName, row: rowD,
                    mediaTrashed: movedD.done, mediaFailed: movedD.failed });
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
      var rowIndex = resolveReportRow(target, Math.floor(Number(body.row) || 0), body.expect);
      if (rowIndex < REPORT_DATA_ROW) {
        return json({ ok: false, conflict: Boolean(body.expect), error: body.expect
          ? '그 리포트를 시트에서 찾지 못했습니다. 다른 기기에서 지웠거나 옮겼을 수 있습니다 — 이력을 새로고침해 주세요.'
          : '줄 번호가 올바르지 않습니다.' });
      }
      var col = statusColumn(target, rowIndex, true);
      var wasStatus = String(target.getRange(rowIndex, col).getValue() || '');
      target.getRange(rowIndex, col).setValue(String(body.status || ''));
      SpreadsheetApp.flush();
      logChange(ss, body, '상태', body.sheetName + ' ' + rowIndex + '행 · ' + String((body.expect || {}).store || ''),
                (wasStatus || '(없음)') + ' → ' + String(body.status || ''));
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

/**
 * 첨부 파일의 **내용을 직접** 내려준다.
 *
 * 왜 필요한가 — 공유 드라이브는 조직 정책으로 '링크가 있는 누구나' 를 막을 수
 * 있다. 그러면 `drive.google.com/thumbnail?id=...` 이 그림을 주지 않아
 * 앱에서 액박이 뜬다. 이 웹 앱은 시트 주인 권한으로 돌아가므로 파일을 읽을 수
 * 있다. 그래서 여기서 바이트를 base64 로 실어 보내면 **누구 화면에서든** 보인다.
 *
 *   { drive: 'bytes', ids: ['...'], size: 'thumb' | 'full' }
 *   → { files: [{ id, name, mimeType, isVideo, data, bytes }] }
 *
 * 'thumb' 는 드라이브가 만들어 둔 작은 미리보기라 가볍고 빠르다(목록용).
 * 'full' 은 원본이다 — 너무 큰 파일은 미리보기로 대신한다.
 */
var BYTES_MAX = 12 * 1024 * 1024;      // 한 번에 실어 보낼 수 있는 한도

function handleDriveBytes(body) {
  var ids = body.ids || [];
  var want = String(body.size || 'thumb');
  var files = [];
  for (var i = 0; i < ids.length && i < 12; i++) {
    var id = String(ids[i] || '').trim();
    if (!id) continue;
    try {
      var file = DriveApp.getFileById(id);
      var mime = String(file.getMimeType() || '');
      var isVideo = mime.indexOf('video/') === 0;
      var blob = null;

      if (want === 'full' && !isVideo && file.getSize() <= BYTES_MAX) {
        blob = file.getBlob();
      }
      if (!blob) {
        // 작은 미리보기. 영상도 대표 장면이 나온다.
        try { blob = file.getThumbnail(); } catch (thumbErr) { blob = null; }
      }
      if (!blob && !isVideo && file.getSize() <= BYTES_MAX) {
        blob = file.getBlob();
      }
      if (!blob) {
        files.push({ id: id, name: file.getName(), mimeType: mime,
                     isVideo: isVideo, data: '', reason: '미리보기를 만들 수 없습니다.' });
        continue;
      }
      var bytes = blob.getBytes();
      files.push({
        id: id,
        name: file.getName(),
        mimeType: blob.getContentType() || mime,
        isVideo: isVideo,
        bytes: bytes.length,
        data: Utilities.base64Encode(bytes)
      });
    } catch (err) {
      files.push({ id: id, name: '', mimeType: '', isVideo: false, data: '',
                   reason: String(err).slice(0, 120) });
    }
  }
  return json({ ok: true, files: files });
}

/**
 * 이미 올라간 첨부를 다시 '링크가 있는 누구나' 로 만든다.
 *
 * 예전 버전은 공유 실패를 조용히 삼켰다. 그래서 그때 올린 사진들이 비공개로
 * 남아 있다. 설정 화면의 [사진 공개 복구] 가 이걸 부른다.
 *
 *   { drive: 'repair', limit: 300 }
 *   → { ok, checked, fixed, failed }
 */
function handleDriveRepair(ss, body) {
  var limit = Math.min(Number(body.limit) || 300, 600);
  var root = mediaRoot(ss);
  var checked = 0;
  var fixed = 0;
  var failed = 0;
  var stack = [root.folder];

  while (stack.length && checked < limit) {
    var folder = stack.pop();
    var subs = folder.getFolders();
    while (subs.hasNext()) stack.push(subs.next());
    var items = folder.getFiles();
    while (items.hasNext() && checked < limit) {
      var file = items.next();
      checked++;
      try {
        if (file.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK) continue;
      } catch (readErr) { /* 공유 드라이브는 못 읽을 수 있다 — 그냥 다시 시도한다 */ }
      if (sharePublic(file)) fixed++; else failed++;
    }
  }
  return json({ ok: true, checked: checked, fixed: fixed, failed: failed,
                shared: root.shared });
}

/** '상태' 열 번호를 찾는다. 없으면 create=true 일 때 헤더 맨 뒤에 만든다. */
/**
 * 그 줄의 '상태' 열 번호.
 *
 * 한 탭에 항목 묶음이 여러 개일 수 있어, **그 줄이 속한 묶음**에서 찾아야 한다.
 * 2행만 보면 항목이 바뀐 뒤의 줄에서 엉뚱한 칸에 상태가 적힌다.
 */
function statusColumn(sheet, rowIndex, create) {
  var block = blockForRow(sheet, rowIndex) || lastHeaderBlock(sheet);
  var header = (block && block.headers) || [];
  for (var c = 0; c < header.length; c++) {
    if (String(header[c] || '').trim() === STATUS_HEADER) return c + 1;
  }
  if (!create || !block || !block.row) return -1;
  var col = header.length + 1;
  var cell = sheet.getRange(block.row, col);
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

  // 한 탭에 항목 묶음이 여러 개일 수 있다. 줄마다 **자기 항목**을 함께 준다 —
  // 앱이 2행 항목만 믿으면 항목이 바뀐 뒤의 줄을 잘못 읽는다.
  var display = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var rows = [];
  var current = [];
  var lastHeaders = [];
  for (var r = 0; r < display.length; r++) {
    var cells = display[r];
    if (isHeaderRow(cells)) {
      current = cells.slice();
      while (current.length && String(current[current.length - 1]).trim() === '') current.pop();
      for (var i = 0; i < current.length; i++) current[i] = String(current[i] || '').trim();
      lastHeaders = current;
      continue;
    }
    var empty = true;
    for (var c = 0; c < cells.length; c++) {
      if (String(cells[c] || '').trim()) { empty = false; break; }
    }
    if (empty) continue;                       // 빈 줄(항목 묶음 사이 여백 포함)
    if (!current.length) continue;             // 항목 줄보다 위에 있는 줄은 무시
    rows.push({ row: r + 1, cells: cells, headers: current });
  }
  return { ok: true, exists: true, headers: lastHeaders, rows: rows };
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

/* ============================================================ 운영 — 백업 · 변경기록 · 휴지통 · 기기 · 오류
 *
 * v3.30. 누가 언제 무엇을 바꿨는지 알 수 있어야 하고, 실수로 지운 것은 되살릴 수
 * 있어야 한다. 예전에 가이드 3건이 사라졌는데 누가 언제 지웠는지 알 방법이 없었다.
 *
 *  - 매일 백업     : 하루 한 번 스프레드시트를 통째로 복사해 '시트 백업' 폴더에 둔다 (30일 보관)
 *  - 변경기록 탭   : 쓰기 요청마다 시각 · 기기 · 종류 · 대상 · 내용 한 줄
 *  - 휴지통 탭     : 지운 가이드 · 리포트를 통째로 보관 → 앱 설정에서 [되살리기]
 *  - 기기 탭       : 기기마다 앱 버전 · 마지막 연결 · 올리지 못한 건수. B1 에 최소 버전
 *  - 오류기록 탭   : 기기에서 난 오류를 모아 둔다
 *
 * 새 권한은 쓰지 않는다 (DriveApp · CacheService 는 이미 있는 권한 안이다) — 권한이 늘면
 * 배포한 사람이 다시 승인할 때까지 태블릿 전체가 시트에 못 닿는다.
 */
var LOG_SHEET = '변경기록';
var LOG_HEADER = ['시각', '기기 · 사람', '앱 버전', '종류', '대상', '내용'];
var LOG_WIDTHS = [140, 130, 80, 110, 220, 520];
var LOG_KEEP = 5000;                  // 이보다 많으면 오래된 줄부터 지운다
var TRASH_SHEET = '휴지통';
var TRASH_HEADER = ['지운 시각', '기기 · 사람', '종류', '이름', '되살림', '자료(고치지 마세요)'];
var TRASH_WIDTHS = [140, 130, 90, 300, 140, 80];
var DEVICE_SHEET = '기기';
var DEVICE_HEADER = ['기기 · 사람', '앱 버전', '마지막 연결', '올리지 못한 것', '마지막 오류'];
var DEVICE_WIDTHS = [160, 90, 150, 110, 420];
var ERROR_SHEET = '오류기록';
var ERROR_HEADER = ['시각', '기기 · 사람', '앱 버전', '화면', '내용', '자세히'];
var ERROR_WIDTHS = [140, 130, 80, 140, 360, 420];
var BACKUP_FOLDER_NAME = '시트 백업';
var BACKUP_KEEP_DAYS = 30;
var BACKUP_PROP = 'LAST_BACKUP_DAY';

function nowText() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
}

function opsSheet(ss, name, header, widths) {
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name);
  sheet.getRange(2, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#eef1f5');
  sheet.setFrozenRows(2);
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  return sheet;
}

/** 표 끝에 한 줄 (2행이 머리줄) */
function appendRow(sheet, values) {
  var at = Math.max(sheet.getLastRow(), 2) + 1;
  sheet.getRange(at, 1, 1, values.length).setValues([values]);
  return at;
}

function who(body) {
  return String((body && body.device) || '').trim() || '(이름 없는 기기)';
}

function clip(text, n) {
  text = String(text === undefined || text === null ? '' : text);
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

/** 변경기록 한 줄. 실패해도 본래 일은 막지 않는다. */
function logChange(ss, body, kind, target, detail) {
  try {
    var sheet = opsSheet(ss, LOG_SHEET, LOG_HEADER, LOG_WIDTHS);
    appendRow(sheet, [nowText(), who(body), String(body.app || ''), kind, clip(target, 200), clip(detail, 900)]);
    var extra = sheet.getLastRow() - 2 - LOG_KEEP;
    if (extra > 200) {                       // 한 번에 몰아서 지운다 (줄 지우기는 느리다)
      for (var i = 0; i < extra; i++) sheet.deleteRow(3);
    }
  } catch (err) { /* 기록 실패가 쓰기를 막으면 안 된다 */ }
}

/** 휴지통에 넣는다. data 는 되살릴 때 쓰는 원래 모습 (JSON) */
function putInTrash(ss, body, kind, name, data) {
  try {
    var sheet = opsSheet(ss, TRASH_SHEET, TRASH_HEADER, TRASH_WIDTHS);
    appendRow(sheet, [nowText(), who(body), kind, clip(name, 200), '', JSON.stringify(data)]);
  } catch (err) { /* 휴지통 실패가 지우기를 막지는 않는다 */ }
}

/**
 * 휴지통 — 목록 · 되살리기.
 *   { trash: 'list' }              → { items: [{ row, at, by, kind, name, restored }] }  (최근 것이 앞)
 *   { trash: 'restore', row }      → 그 줄을 원래 자리에 되돌리고 '되살림' 칸에 적는다
 */
function handleTrash(ss, body) {
  var sheet = ss.getSheetByName(TRASH_SHEET);
  if (body.trash === 'list') {
    if (!sheet || sheet.getLastRow() < 3) return json({ ok: true, items: [] });
    var n = sheet.getLastRow() - 2;
    var rows = sheet.getRange(3, 1, n, TRASH_HEADER.length).getValues();
    var items = [];
    for (var i = rows.length - 1; i >= 0 && items.length < 200; i--) {
      items.push({ row: i + 3, at: cellText(rows[i][0]), by: String(rows[i][1] || ''),
                   kind: String(rows[i][2] || ''), name: String(rows[i][3] || ''),
                   restored: String(rows[i][4] || '') });
    }
    return json({ ok: true, items: items });
  }
  if (body.trash !== 'restore') return json({ ok: false, error: '알 수 없는 요청입니다.' });
  if (!sheet) return json({ ok: false, error: '휴지통이 비어 있습니다.' });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var at = Math.floor(Number(body.row) || 0);
    if (at < 3 || at > sheet.getLastRow()) return json({ ok: false, error: '그 줄이 없습니다.' });
    var line = sheet.getRange(at, 1, 1, TRASH_HEADER.length).getValues()[0];
    if (String(line[4] || '')) return json({ ok: false, error: '이미 되살렸습니다.' });
    var data = JSON.parse(String(line[5] || '{}'));
    var kind = String(line[2] || '');
    var result;
    if (kind === '가이드') result = restoreGuide(ss, data);
    else if (kind === '리포트') result = restoreReport(ss, data);
    else return json({ ok: false, error: '되살릴 수 없는 종류입니다: ' + kind });
    sheet.getRange(at, 5).setValue(nowText() + ' · ' + who(body));
    logChange(ss, body, '되살림', kind + ' · ' + String(line[3] || ''), '휴지통 ' + at + '행에서');
    SpreadsheetApp.flush();
    return json({ ok: true, kind: kind, result: result });
  } finally {
    lock.releaseLock();
  }
}

function restoreGuide(ss, guide) {
  var tab = GUIDE_SHEETS[guide.categoryType];
  if (!tab) throw new Error('가이드 종류를 알 수 없습니다.');
  var sheet = ss.getSheetByName(tab);
  var list = sheet ? readGuideSheet(sheet, guide.categoryType) : [];
  var kept = [];
  for (var i = 0; i < list.length; i++) if (list[i].id !== guide.id) kept.push(list[i]);
  kept.push(guide);
  kept.sort(function (a, b) {
    return String(a.codeOrTitle || '').localeCompare(String(b.codeOrTitle || ''), 'ko');
  });
  writeGuideSheet(ss, tab, kept);
  return { id: guide.id };
}

function restoreReport(ss, data) {
  var picked = openMonthSheet(ss, data.sheetName);
  var sheet = picked.sheet;
  var placed = placeForRow(sheet, data.headers || [], picked.created);
  var aligned = [];
  for (var f = 0; f < placed.width; f++) aligned.push('');
  var row = data.row || [];
  for (var r = 0; r < row.length; r++) {
    var to = placed.map[r] || 0;
    if (to >= 1) aligned[to - 1] = row[r];
  }
  sheet.getRange(placed.target, 1, 1, aligned.length).setValues([aligned]);
  relinkDriveCells(sheet, placed.target, aligned);
  // 지울 때 드라이브 휴지통에 넣은 사진 · 영상을 꺼낸다 — 링크가 그대로 산다 (v3.38)
  var back = setMediaTrashed(data.media || [], false);
  return { sheetName: data.sheetName, row: placed.target, mediaRestored: back.done, mediaFailed: back.failed };
}

/* ── 리포트의 사진 · 영상 (v3.38) ──────────────────────────────────────
 *
 * 리포트를 지우면 그 줄에 걸린 첨부를 **드라이브 휴지통**으로 옮긴다 (드라이브에서 30일 동안 되살릴 수
 * 있다). 예전에는 줄만 지워서, 주인 없는 사진 · 영상이 공유 드라이브에 쌓였다.
 * 앱 휴지통에서 리포트를 되살리면 같은 파일을 휴지통에서 꺼낸다.
 *
 * 지키는 것: 사진 · 동영상 폴더에 든 파일만 옮긴다. 칸에 붙여 넣은 다른 문서 링크는 건드리지 않는다.
 * 매장 · 날짜 폴더는 다른 리포트와 같이 쓰므로 지우지 않는다.
 */
function reportMediaIds(line) {
  var ids = [];
  for (var c = 0; c < line.length; c++) {
    var text = String(line[c] || '');
    if (text.indexOf('drive.google.com') < 0) continue;
    var re = /\/file\/d\/([A-Za-z0-9_-]{10,})|[?&]id=([A-Za-z0-9_-]{10,})/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var id = m[1] || m[2];
      if (ids.indexOf(id) >= 0) continue;
      try {
        var file = DriveApp.getFileById(id);
        if (!file.isTrashed() && inMediaFolder(file)) ids.push(id);
      } catch (err) { /* 없는 파일 · 권한 없음 — 건드리지 않는다 */ }
    }
  }
  return ids;
}

function inMediaFolder(file) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    var name = parents.next().getName();
    if (name === PHOTO_FOLDER_NAME || name === VIDEO_FOLDER_NAME) return true;
  }
  return false;
}

/** 휴지통에 넣거나(true) 꺼낸다(false). 공유 드라이브에서 막히면 고급 드라이브 서비스로 한 번 더 */
function setMediaTrashed(ids, trashed) {
  var done = 0;
  var failed = 0;
  for (var i = 0; i < ids.length; i++) {
    try {
      DriveApp.getFileById(ids[i]).setTrashed(trashed);
      done++;
    } catch (err) {
      try {
        if (typeof Drive === 'undefined' || !Drive.Files) throw err;
        Drive.Files.update({ trashed: trashed }, ids[i], null, { supportsAllDrives: true });
        done++;
      } catch (err2) { failed++; }
    }
  }
  return { done: done, failed: failed };
}

/* ----------------------------------------------------------- 기기 · 최소 버전 */

/**
 * 기기 탭을 갱신한다 — 같은 기기는 한 줄. 5분마다 오는 물음까지 매번 적으면 느리므로
 * 같은 기기는 20분에 한 번만 적는다 (CacheService).
 */
function touchDevice(ss, body, extra) {
  var name = String((body && body.device) || '').trim();
  if (!name) return;
  try {
    var cache = CacheService.getScriptCache();
    var ckey = 'dev:' + name;
    var force = extra && (extra.error || extra.pending !== undefined && extra.pending > 0);
    if (!force && cache.get(ckey) === String(body.app || '')) return;
    var sheet = opsSheet(ss, DEVICE_SHEET, DEVICE_HEADER, DEVICE_WIDTHS);
    if (!String(sheet.getRange(1, 1).getValue() || '')) {
      sheet.getRange(1, 1).setValue('최소 버전 (이보다 낮으면 앱이 업데이트를 요구합니다) →');
    }
    var last = sheet.getLastRow();
    var at = -1;
    if (last >= 3) {
      var names = sheet.getRange(3, 1, last - 2, 1).getValues();
      for (var i = 0; i < names.length; i++) {
        if (String(names[i][0] || '').trim() === name) { at = i + 3; break; }
      }
    }
    if (at < 0) at = Math.max(last, 2) + 1;
    var line = sheet.getRange(at, 1, 1, DEVICE_HEADER.length).getValues()[0];
    line[0] = name;
    line[1] = String(body.app || line[1] || '');
    line[2] = nowText();
    if (extra && extra.pending !== undefined) line[3] = Number(extra.pending) || 0;
    if (extra && extra.error) line[4] = clip(extra.error, 300);
    sheet.getRange(at, 1, 1, DEVICE_HEADER.length).setValues([line]);
    cache.put(ckey, String(body.app || ''), 1200);
  } catch (err) { /* 기기 기록 실패는 무시 */ }
}

/** 기기 탭 B1 의 최소 버전 (없으면 '') */
function minAppVersion(ss) {
  try {
    var sheet = ss.getSheetByName(DEVICE_SHEET);
    return sheet ? cellText(sheet.getRange(1, 2).getValue()) : '';
  } catch (err) { return ''; }
}

/* ----------------------------------------------------------- 오류기록 */

/** { errors: 'push', items: [{ at, screen, message, detail }] } */
function handleErrors(ss, body) {
  var items = body.items || [];
  if (!items.length) return json({ ok: true, saved: 0 });
  var sheet = opsSheet(ss, ERROR_SHEET, ERROR_HEADER, ERROR_WIDTHS);
  var rows = [];
  for (var i = 0; i < items.length && i < 50; i++) {
    var e = items[i] || {};
    rows.push([clip(e.at || nowText(), 40), who(body), String(body.app || ''), clip(e.screen, 80),
               clip(e.message, 400), clip(e.detail, 1500)]);
  }
  var at = Math.max(sheet.getLastRow(), 2) + 1;
  sheet.getRange(at, 1, rows.length, ERROR_HEADER.length).setValues(rows);
  var extra = sheet.getLastRow() - 2 - 3000;
  for (var d = 0; d < extra; d++) sheet.deleteRow(3);
  touchDevice(ss, body, { error: rows[rows.length - 1][4] });
  return json({ ok: true, saved: rows.length });
}

/* ----------------------------------------------------------- 매일 백업 */

/**
 * 하루 한 번 스프레드시트를 통째로 복사한다. 5분마다 오는 물음(changed)이 부른다 —
 * 그래서 트리거를 따로 만들 필요가 없다 (만들려면 새 권한이 필요하다).
 * 편집기에서 dailyBackup 을 시간 트리거로 걸어 두어도 된다 (같은 날 두 번은 안 한다).
 */
function backupIfDue(ss) {
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(BACKUP_PROP) === today) return null;
  var lock = LockService.getScriptLock();
  if (lock.tryLock && !lock.tryLock(0)) return null;     // 다른 요청이 하는 중
  try {
    if (props.getProperty(BACKUP_PROP) === today) return null;
    var root = mediaRoot(ss);
    var folder = folderByName(root.folder, BACKUP_FOLDER_NAME);
    var copy = DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' 백업 ' + today, folder);
    props.setProperty(BACKUP_PROP, today);
    cleanupChunks(ss);
    // 30일 지난 백업은 휴지통으로 (드라이브 휴지통에서 30일 더 되살릴 수 있다)
    var cut = new Date(Date.now() - BACKUP_KEEP_DAYS * 86400000);
    var cutText = Utilities.formatDate(cut, 'Asia/Seoul', 'yyyy-MM-dd');
    var files = folder.getFiles();
    var trashed = 0;
    while (files.hasNext()) {
      var f = files.next();
      var m = String(f.getName()).match(/백업 (\d{4}-\d{2}-\d{2})$/);
      if (m && m[1] < cutText && !f.isTrashed()) { f.setTrashed(true); trashed++; }
    }
    return { name: copy.getName(), trashed: trashed };
  } catch (err) {
    return { error: String(err) };
  } finally {
    if (lock.releaseLock) lock.releaseLock();
  }
}

function dailyBackup() {
  return backupIfDue(SpreadsheetApp.getActiveSpreadsheet());
}

/* ----------------------------------------------------------- 리포트 줄 확인 */

/**
 * 줄 번호만 믿고 고치거나 지우면, 그 사이 다른 기기가 위쪽 줄을 지웠을 때
 * **엉뚱한 줄**이 바뀐다. 앱이 그 줄의 작성일시 · 매장명(expect)을 함께 보내면
 * 맞는지 보고, 다르면 같은 내용의 줄을 찾아 그 줄을 쓴다. 못 찾으면 멈춘다.
 * expect 가 없으면(옛 앱) 예전처럼 줄 번호를 믿는다.
 */
function resolveReportRow(sheet, rowIndex, expect) {
  if (!expect || !expect.createdAt) return rowIndex;
  var last = sheet.getLastRow();
  var width = sheet.getLastColumn();
  if (last < REPORT_DATA_ROW || width < 1) return -1;
  var display = sheet.getRange(1, 1, last, width).getDisplayValues();
  var want = String(expect.createdAt).trim();
  var wantStore = String(expect.store || '').trim();
  // 한 탭에 항목 묶음이 여럿일 수 있다 — 줄마다 자기 항목 줄로 열을 찾는다.
  var cAt = -1, cStore = -1, found = [];
  for (var r = 0; r < display.length; r++) {
    var cells = display[r];
    if (isHeaderRow(cells)) {
      cAt = -1; cStore = -1;
      for (var c = 0; c < cells.length; c++) {
        var name = String(cells[c] || '').trim();
        if (name === REPORT_FIRST_HEADER && cAt < 0) cAt = c;
        if ((name.indexOf('매장') >= 0 || name.indexOf('식당') >= 0) && cStore < 0) cStore = c;
      }
      continue;
    }
    if (cAt < 0 || String(cells[cAt] || '').trim() !== want) continue;
    if (wantStore && cStore >= 0 && String(cells[cStore] || '').trim() !== wantStore) continue;
    found.push(r + 1);
  }
  if (found.indexOf(rowIndex) >= 0) return rowIndex;   // 그 자리 그대로
  return found.length === 1 ? found[0] : -1;           // 옮겨졌으면 찾은 자리 · 애매하면 멈춘다
}


/* ----------------------------------------------------------- 기록용 요약 */

/** 리포트 한 줄 요약 — 매장 · 작성일시 · 증상 앞부분 */
function reportSummary(headers, row) {
  var pick = function (word) {
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').indexOf(word) >= 0) return String(row[i] || '').trim();
    }
    return '';
  };
  return [pick('매장') || pick('식당'), pick('작성일시'), clip(pick('증상'), 60)]
    .filter(function (x) { return x; }).join(' · ');
}

function reportName(headers, row) {
  var s = reportSummary(headers, row);
  return s || '(내용 없음)';
}

/** 가이드 탭 하나의 전후 비교 — 지운 것은 onRemoved 로 넘긴다 (휴지통) */
function guideDiff(before, after, diff, onRemoved) {
  var key = function (g) { return g.id || ('t:' + String(g.codeOrTitle || '').trim()); };
  var shape = function (g) {
    return JSON.stringify([g.robotModel || '', g.codeOrTitle || '', g.summary || '', g.requiredTools || '',
      (g.commands || []).map(function (c) { return [c.label || '', c.cmd || '', c.desc || '']; }),
      (g.steps || []).map(function (s) { return [s.instruction || '', s.expectedMetric || '']; })]);
  };
  var old = {};
  for (var i = 0; i < before.length; i++) old[key(before[i])] = before[i];
  var seen = {};
  for (var j = 0; j < after.length; j++) {
    var k = key(after[j]);
    seen[k] = true;
    if (!old[k]) diff.added.push(after[j].codeOrTitle);
    else if (shape(old[k]) !== shape(after[j])) diff.changed.push(after[j].codeOrTitle);
  }
  for (var o in old) {
    if (!seen[o]) {
      diff.removed.push(old[o].codeOrTitle);
      onRemoved(old[o]);
    }
  }
}

/** 재고 구성(차량 · 품목)의 전후 비교 한 줄 — 바뀐 게 없으면 '' */
function inventoryDiff(before, after) {
  var parts = function (inv) {
    var out = [];
    (inv.items || []).forEach(function (it) { if (out.indexOf(it.partName) < 0) out.push(it.partName); });
    return out;
  };
  var pb = parts(before), pa = parts(after);
  var vb = before.vehicles || [], va = after.vehicles || [];
  var bits = [];
  var plus = pa.filter(function (p) { return pb.indexOf(p) < 0; });
  var minus = pb.filter(function (p) { return pa.indexOf(p) < 0; });
  var vplus = va.filter(function (v) { return vb.indexOf(v) < 0; });
  var vminus = vb.filter(function (v) { return va.indexOf(v) < 0; });
  if (plus.length) bits.push('품목 추가: ' + plus.join(', '));
  if (minus.length) bits.push('품목 삭제: ' + minus.join(', '));
  if (vplus.length) bits.push('차량 추가: ' + vplus.join(', '));
  if (vminus.length) bits.push('차량 삭제: ' + vminus.join(', '));
  return bits.join(' / ');
}


/* ============================================================ 첨부 조각 올리기 (v3.30)
 *
 * 현장 LTE 에서 20MB 영상을 한 번에 보내다 끊기면 처음부터 다시 보내야 했다.
 * 이제 1.5MB 조각으로 나눠 보내고, 끊기면 **받은 조각 다음부터** 이어 보낸다.
 *   { media: 'chunk', uploadId, index, total, data(base64) }     → 조각 하나 보관
 *   { media: 'finish', uploadId, total, filename, mimeType, storeName, dateText }
 *     → 조각을 이어 붙여 드라이브(매장 → 날짜 → 사진/동영상)에 파일 하나로 만든다
 *   { media: 'finish', total: 1, data(base64), … }  → 조각 하나짜리 작은 파일은 한 번에 (v3.33)
 * 조각은 바이트 수가 3의 배수라 base64 글자를 그대로 이어 붙이면 원래 파일이 된다.
 * 폴더 위치는 6시간 기억한다(cachedFolder). 조각 요청은 탭 순서 맞추기를 건너뛴다(doPost).
 * 조각은 '업로드 조각' 폴더에 두었다가 다 붙이면 지운다. 버려진 조각은 이틀 뒤 지운다.
 */
var CHUNK_FOLDER_NAME = '업로드 조각 (자동 정리)';
var CHUNK_KEEP_MS = 2 * 86400000;

function chunkFolder(ss) {
  return cachedFolder('fold:chunk', function () { return folderByName(mediaRoot(ss).folder, CHUNK_FOLDER_NAME); });
}

/**
 * 폴더 id 를 6시간 기억한다 (v3.33). 이름으로 찾으면 뿌리 → 매장 → 날짜 → 사진 폴더를
 * 차례로 물어야 해서 사진마다 드라이브를 여러 번 불렀다. 기억한 폴더가 휴지통에 있으면 다시 찾는다.
 */
function cachedFolder(key, find) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (err) { cache = null; }
  var id = cache ? cache.get(key) : null;
  if (id) {
    try {
      var known = DriveApp.getFolderById(id);
      if (!known.isTrashed()) return known;
    } catch (err) { /* 지워졌거나 권한이 바뀌었다 — 다시 찾는다 */ }
  }
  var folder = find();
  try { if (cache) cache.put(key, folder.getId(), 21600); } catch (err) { /* 기억 못 해도 된다 */ }
  return folder;
}

/** 조각 마무리가 넣을 매장 → 날짜 → 사진/동영상 폴더 (기억해 둔다) */
function cachedMediaTarget(ss, mimeType, storeName, dateText) {
  var isVideo = String(mimeType || '').indexOf('video/') === 0;
  var key = 'fold:' + safeFolderName(storeName, '매장 미지정') + '|' + safeFolderName(dateText, '날짜 미지정')
    + '|' + (isVideo ? 'v' : 'p');
  return cachedFolder(key.slice(0, 240), function () {
    return mediaTargetFolder(mediaRoot(ss).folder, mimeType, storeName, dateText);
  });
}

function safeUploadId(value) {
  var id = String(value || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) throw new Error('uploadId 가 없습니다.');
  return id.slice(0, 64);
}

function trashByName(folder, name) {
  var it = folder.getFilesByName(name);
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) f.setTrashed(true);
  }
}

/*
 * 조각 파일 id 를 기억한다 (v3.36.1).
 *
 * 마무리는 조각을 이름으로 찾았다(getFilesByName). 그런데 드라이브의 이름 찾기는 **검색**이라
 * 방금 만든 파일이 몇십 초 동안 안 잡힌다. 1분 영상(조각 14개)을 다 보내자마자 마무리하면
 * 조각이 다 있는데도 '빠진 조각: 0,1,…,13' 이 났고, 시간이 지나 세 번째에야 붙었다.
 * id 로 여는 것(getFileById)은 바로 된다. 그래서 조각을 만들 때 id 를 적어 두고
 * (캐시 6시간 + 앱에도 돌려준다) 마무리는 id 로 연다. 이름 찾기는 둘 다 없을 때만.
 */
var CHUNK_ID_TTL = 21600;
function chunkIdKey(id, index) { return 'chunk:' + id + '.' + index; }

function chunkCache() {
  try { return CacheService.getScriptCache(); } catch (err) { return null; }
}

/** id 로 조각을 연다 — 이름이 맞고 휴지통에 없어야 한다 (남의 파일을 읽지 않게) */
function chunkById(fileId, name) {
  if (!fileId) return null;
  try {
    var f = DriveApp.getFileById(String(fileId));
    return f.getName() === name && !f.isTrashed() ? f : null;
  } catch (err) {
    return null;
  }
}

function chunkByName(folder, name) {
  var it = folder.getFilesByName(name);
  var found = null;
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) found = f;
  }
  return found;
}

function handleMediaUpload(ss, body) {
  var id = safeUploadId(body.uploadId);
  var folder = chunkFolder(ss);
  var cache = chunkCache();
  if (body.media === 'chunk') {
    var index = Math.floor(Number(body.index));
    if (!(index >= 0)) return json({ ok: false, error: '조각 번호가 없습니다.' });
    var name = id + '.' + index;
    // 같은 조각을 다시 받으면 새것으로 — 앞의 것은 기억한 id 로 지운다 (이름 찾기는 방금 것을 못 본다)
    var prev = chunkById(cache ? cache.get(chunkIdKey(id, index)) : null, name);
    if (prev) prev.setTrashed(true); else trashByName(folder, name);
    var made = folder.createFile(name, String(body.data || ''), MimeType.PLAIN_TEXT);
    try { if (cache) cache.put(chunkIdKey(id, index), made.getId(), CHUNK_ID_TTL); } catch (err) { /* 앱이 id 를 들고 온다 */ }
    return json({ ok: true, index: index, fileId: made.getId() });
  }
  // finish
  var total = Math.floor(Number(body.total) || 0);
  if (total < 1) return json({ ok: false, error: '조각 수가 없습니다.' });
  var parts = [];
  var missing = [];
  var text = '';
  // 조각 하나짜리 작은 파일은 마무리 요청에 실려 온다 (v3.33) — 조각 폴더를 거치지 않는다
  var inline = total === 1 && body.data ? String(body.data) : '';
  if (!inline) {
    var sent = Array.isArray(body.parts) ? body.parts : [];      // 앱이 받아 둔 조각 id (v3.36.1)
    var keys = [];
    for (var k = 0; k < total; k++) keys.push(chunkIdKey(id, k));
    var known = {};
    try { known = (cache && cache.getAll(keys)) || {}; } catch (err) { known = {}; }
    for (var i = 0; i < total; i++) {
      var partName = id + '.' + i;
      parts[i] = chunkById(sent[i], partName) || chunkById(known[keys[i]], partName);
    }
    // 둘 다 모르는 조각만 이름으로 — 검색이 늦게 따라오니 조금 쉬었다 두 번 더 본다
    for (var round = 0; round < 3; round++) {
      missing = [];
      for (var j = 0; j < total; j++) {
        if (!parts[j]) parts[j] = chunkByName(folder, id + '.' + j);
        if (!parts[j]) missing.push(j);
      }
      if (!missing.length || round === 2) break;
      Utilities.sleep(3000);
    }
  }
  if (missing.length) return json({ ok: false, missing: missing, error: '빠진 조각이 있습니다: ' + missing.join(',') });
  text = inline;
  for (var p = 0; p < parts.length; p++) text += parts[p].getBlob().getDataAsString();
  var mime = String(body.mimeType || 'application/octet-stream');
  var blob = Utilities.newBlob(Utilities.base64Decode(text), mime, String(body.filename || '첨부'));
  var target = cachedMediaTarget(ss, mime, body.storeName, body.dateText);
  var file = target.createFile(blob);
  var shared = sharePublic(file);
  for (var t = 0; t < parts.length; t++) parts[t].setTrashed(true);
  try { if (cache && keys) cache.removeAll(keys); } catch (err) { /* 6시간 뒤 저절로 사라진다 */ }
  return json({ ok: true, url: file.getUrl(), id: file.getId(), public: shared });
}

/** 버려진 조각 정리 — 매일 백업 때 함께. uploadId 앞부분이 만든 시각(36진수)이다. */
function cleanupChunks(ss) {
  try {
    var files = chunkFolder(ss).getFiles();
    var cut = Date.now() - CHUNK_KEEP_MS;
    while (files.hasNext()) {
      var f = files.next();
      var born = parseInt(String(f.getName()).split('-')[0], 36);
      if (born && born < cut && !f.isTrashed()) f.setTrashed(true);
    }
  } catch (err) { /* 정리 실패는 다음 날 다시 */ }
}

/* ============================================================ 작업 목록 (v3.31)
 *
 * 리포트의 '작업' 칸은 사람마다 다르게 적혔다 ("로더 교체" · "팔 교체"). 그래서 팀이 함께
 * 쓰는 목록에서 고른다.  구분(로봇 이슈 · 로봇 외 이슈) › 대분류 › 세부 작업.
 *
 *  - 탭 '작업 목록': 구분 | 대분류 | 세부 작업 | 별칭 | 가이드 ID | 상태 | ID
 *    대분류만 있는 줄(세부 작업 빈칸)은 '아직 항목이 없는 대분류' 를 지킨다.
 *  - 별칭: 합친 이름 · 다른 표현 (쉼표로). 검색과 통계가 같은 것으로 센다.
 *  - 상태: '새 항목' = 현장에서 새로 적은 것 (정리 대상)
 *
 * 올리기는 통째로 덮어쓰지 않고 **바뀐 것(ops)만** 적용한다 — 둘이 동시에 고쳐도 서로를 지우지 않는다.
 *   { work: 'pull' }  → { exists, cats: [{kind, name}], items: [{id, kind, cat, name, aliases, guides, isNew}] }
 *   { work: 'push', ops: [...] }
 *     {op:'cat-add', kind, name} · {op:'cat-rename', kind, from, to} · {op:'cat-delete', kind, name}
 *     {op:'item-upsert', item} · {op:'item-delete', id}
 */
var WORK_SHEET = '이슈 유형 목록';
var WORK_SHEET_OLD = '작업 목록';     // v3.31 이름 — 있으면 이름만 바꿔 쓴다
var WORK_HEADER = ['구분', '대분류', '세부 항목', '별칭 (쉼표로)', '가이드 ID', '상태', 'ID(고치지 마세요)'];
var WORK_WIDTHS = [110, 150, 220, 260, 200, 90, 160];
var WORK_KINDS = ['로봇 이슈', '로봇 외 이슈'];

function splitList(text) {
  var out = [];
  String(text || '').split(/[,\n]/).forEach(function (x) {
    var t = String(x).trim();
    if (t && out.indexOf(t) < 0) out.push(t);
  });
  return out;
}

function workSheet(ss) {
  var sheet = ss.getSheetByName(WORK_SHEET);
  if (!sheet) {
    var old = ss.getSheetByName(WORK_SHEET_OLD);
    if (old) { old.setName(WORK_SHEET); sheet = old; }
  }
  return sheet;
}

function readWork(ss) {
  var sheet = workSheet(ss);
  if (!sheet) return { exists: false, cats: [], items: [] };
  var last = sheet.getLastRow();
  var cats = [];
  var items = [];
  if (last < 3) return { exists: true, cats: cats, items: items };
  var rows = sheet.getRange(3, 1, last - 2, WORK_HEADER.length).getDisplayValues();
  var hasCat = function (kind, name) {
    for (var c = 0; c < cats.length; c++) if (cats[c].kind === kind && cats[c].name === name) return true;
    return false;
  };
  for (var r = 0; r < rows.length; r++) {
    var kind = String(rows[r][0] || '').trim();
    var cat = String(rows[r][1] || '').trim();
    var name = String(rows[r][2] || '').trim();
    if (!kind || !cat) continue;
    if (WORK_KINDS.indexOf(kind) < 0) kind = WORK_KINDS[0];
    if (!hasCat(kind, cat)) cats.push({ kind: kind, name: cat });
    if (!name) continue;
    items.push({
      id: String(rows[r][6] || '').trim() || ('w-' + r + '-' + name),
      kind: kind, cat: cat, name: name,
      aliases: splitList(rows[r][3]),
      guides: splitList(rows[r][4]),
      isNew: String(rows[r][5] || '').indexOf('새') >= 0
    });
  }
  return { exists: true, cats: cats, items: items };
}

function writeWork(ss, list) {
  workSheet(ss);
  var sheet = opsSheet(ss, WORK_SHEET, WORK_HEADER, WORK_WIDTHS);
  sheet.getRange(2, 1, 1, WORK_HEADER.length).setValues([WORK_HEADER]);
  var lines = [];
  for (var k = 0; k < WORK_KINDS.length; k++) {
    var kind = WORK_KINDS[k];
    for (var c = 0; c < list.cats.length; c++) {
      var cat = list.cats[c];
      if (cat.kind !== kind) continue;
      var mine = list.items.filter(function (it) { return it.kind === kind && it.cat === cat.name; });
      if (!mine.length) lines.push([kind, cat.name, '', '', '', '', '']);
      for (var i = 0; i < mine.length; i++) {
        var it = mine[i];
        lines.push([kind, cat.name, it.name, (it.aliases || []).join(', '), (it.guides || []).join(', '),
                    it.isNew ? '새 항목' : '', it.id]);
      }
    }
  }
  var last = sheet.getLastRow();
  if (last >= 3) sheet.getRange(3, 1, last - 2, WORK_HEADER.length).clearContent();
  if (lines.length) sheet.getRange(3, 1, lines.length, WORK_HEADER.length).setValues(lines);
}

function applyWorkOps(list, ops) {
  var findCat = function (kind, name) {
    for (var c = 0; c < list.cats.length; c++) if (list.cats[c].kind === kind && list.cats[c].name === name) return c;
    return -1;
  };
  var findItem = function (id) {
    for (var i = 0; i < list.items.length; i++) if (list.items[i].id === id) return i;
    return -1;
  };
  var done = [];
  for (var o = 0; o < ops.length; o++) {
    var op = ops[o] || {};
    var kind = WORK_KINDS.indexOf(op.kind) >= 0 ? op.kind : WORK_KINDS[0];
    if (op.op === 'cat-add') {
      var name = String(op.name || '').trim();
      if (name && findCat(kind, name) < 0) { list.cats.push({ kind: kind, name: name }); done.push('대분류 추가 ' + name); }
    } else if (op.op === 'cat-rename') {
      var from = String(op.from || '').trim();
      var to = String(op.to || '').trim();
      var at = findCat(kind, from);
      if (at >= 0 && to && findCat(kind, to) < 0) {
        list.cats[at].name = to;
        list.items.forEach(function (it) { if (it.kind === kind && it.cat === from) it.cat = to; });
        done.push('대분류 ' + from + ' → ' + to);
      }
    } else if (op.op === 'cat-delete') {
      var gone = findCat(kind, String(op.name || '').trim());
      var used = list.items.some(function (it) { return it.kind === kind && it.cat === op.name; });
      if (gone >= 0 && !used) { list.cats.splice(gone, 1); done.push('대분류 삭제 ' + op.name); }
    } else if (op.op === 'item-upsert') {
      var item = op.item || {};
      var id = String(item.id || '').trim();
      var nm = String(item.name || '').trim();
      var ct = String(item.cat || '').trim();
      if (!id || !nm || !ct) continue;
      var ik = WORK_KINDS.indexOf(item.kind) >= 0 ? item.kind : WORK_KINDS[0];
      if (findCat(ik, ct) < 0) list.cats.push({ kind: ik, name: ct });
      var row = { id: id, kind: ik, cat: ct, name: nm, aliases: splitList((item.aliases || []).join(',')),
                  guides: splitList((item.guides || []).join(',')), isNew: Boolean(item.isNew) };
      var was = findItem(id);
      if (was >= 0) list.items[was] = row; else list.items.push(row);
      done.push((was >= 0 ? '고침 ' : '추가 ') + ik + ' › ' + ct + ' › ' + nm);
    } else if (op.op === 'item-delete') {
      var del = findItem(String(op.id || ''));
      if (del >= 0) { done.push('삭제 ' + list.items[del].name); list.items.splice(del, 1); }
    }
  }
  return done;
}

function handleWork(ss, body) {
  if (body.work === 'pull') {
    var got = readWork(ss);
    got.ok = true;
    return json(got);
  }
  if (body.work !== 'push') return json({ ok: false, error: '알 수 없는 요청입니다.' });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var list = readWork(ss);
    var done = applyWorkOps(list, body.ops || []);
    writeWork(ss, list);
    SpreadsheetApp.flush();
    if (done.length) logChange(ss, body, '이슈 유형 목록', done.length + '건', done.join(' / '));
    var out = readWork(ss);
    out.ok = true;
    return json(out);
  } finally {
    lock.releaseLock();
  }
}

