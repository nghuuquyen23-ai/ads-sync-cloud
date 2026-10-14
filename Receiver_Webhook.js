// =====================================================================
// GOOGLE APPS SCRIPT: BỘ THU WEBHOOK ĐỒNG BỘ SIÊU TỐC
// - Tự động nhận dữ liệu từ GitHub Cloud gửi về (Hourly, FB Campaign, FB Country, Total Country)
// - Bảng Hourly: Tự động lưu lịch sử ROAS các turn trước (ROAS turn cũ -> Hour-1 -> Hour-2 ... Hour-7)
// - Định dạng chuẩn xác: Tiền tệ, Phần trăm (ROAS), Căn giữa, Cố định dòng tiêu đề
// =====================================================================

function doPost(e) {
  try {
    const contents = e.postData.contents;
    const data = JSON.parse(contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 0. Nếu là yêu cầu đọc danh sách mã từ sheet Validate
    if (data && (data.action === 'get_validate' || data.action === 'validate')) {
      const sheet = ss.getSheetByName('Validate') || ss.getSheetByName('validate') || ss.getSheetByName('VALIDATE');
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'Không tìm thấy sheet Validate trong bảng tính!'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        spreadsheetId: ss.getId(),
        sheetName: sheet.getName(),
        data: sheet.getDataRange().getValues()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1. Cập nhật bảng Hourly (Kèm cơ chế đẩy lịch sử ROAS theo turn)
    if (data.hourly && data.hourly.length > 0) {
      writeSheetHourly(ss, 'Hourly', data.hourly);
    }

    // 2. Cập nhật bảng FB Campaign
    if (data.fbCampaign && data.fbCampaign.length > 0) {
      writeSheetFBCampaign(ss, 'FB Campaign', data.fbCampaign);
    }

    // 3. Cập nhật bảng FB Country
    if (data.fbCountry && data.fbCountry.length > 0) {
      writeSheetFBCountry(ss, 'FB Country', data.fbCountry);
    }

    // 4. Cập nhật bảng Total Country
    if (data.totalCountry && data.totalCountry.length > 0) {
      writeSheetTotalCountry(ss, 'Total Country', data.totalCountry);
    }

    // 5. Cập nhật bảng Google Campaign
    if (data.googleCampaign && data.googleCampaign.length > 0) {
      writeSheetGoogleCampaign(ss, 'Google Campaign', data.googleCampaign);
    }

    // 6. Cập nhật bảng Google Country
    if (data.googleCountry && data.googleCountry.length > 0) {
      writeSheetGoogleCountry(ss, 'Google Country', data.googleCountry);
    }

    // 7. Cập nhật bảng Google Total Country
    if (data.googleTotalCountry && data.googleTotalCountry.length > 0) {
      writeSheetGoogleTotalCountry(ss, 'Google Total Country', data.googleTotalCountry);
    }

    // 8. Cập nhật bảng CutOff (Báo Cáo Tổng Hợp Theo App & Marketer)
    if ((data.cutoff && data.cutoff.length > 0) || (data.app && data.app.length > 0)) {
      writeSheetCutOff(ss, 'CutOff', data.cutoff || data.app);
    }

    // 9. Cập nhật bảng PhanQuyen (Row-Level Security cho Looker Studio)
    if (data.phanQuyen && data.phanQuyen.length > 0) {
      writeSheetPhanQuyen(ss, 'PhanQuyen', data.phanQuyen);
    } else {
      syncPhanQuyenFromValidate(ss);
    }

    // 10. Cập nhật bảng Tình trạng account
    if ((data.accountStatus && data.accountStatus.length > 0) || (data.tinhTrangAccount && data.tinhTrangAccount.length > 0)) {
      writeSheetAccountStatus(ss, 'Tình trạng account', data.accountStatus || data.tinhTrangAccount);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Đã cập nhật dữ liệu thành công!',
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==================== CÁC HÀM GHI DỮ LIỆU & ĐỊNH DẠNG ====================

function writeSheetHourly(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  // 1. ĐỌC DỮ LIỆU CŨ TRÊN SHEET ĐỂ LƯU LỊCH SỬ ROAS GIỜ TRƯỚC
  const historyMap = {};
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow > 1) {
    const oldHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const oldDateIdx = oldHeaders.indexOf('Date');
    const oldCidIdx = oldHeaders.indexOf('Campaign id');
    const oldNameIdx = oldHeaders.indexOf('Campaign name');
    const oldRoasIdx = oldHeaders.indexOf('ROAS');
    const oldH1Idx = oldHeaders.indexOf('Hour-1');

    if ((oldCidIdx !== -1 || oldNameIdx !== -1) && oldRoasIdx !== -1) {
      const oldData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

      for (let r = 0; r < oldData.length; r++) {
        const row = oldData[r];
        const dateKey = normalizeDateStr(row[oldDateIdx]);
        const cid = oldCidIdx !== -1 ? String(row[oldCidIdx]).trim() : '';
        const cname = oldNameIdx !== -1 ? String(row[oldNameIdx]).trim() : '';
        if (!cid && !cname) continue;

        const h1Idx = (oldH1Idx !== -1) ? oldH1Idx : (oldRoasIdx + 1);
        const histObj = {
          roas: parseRoas(row[oldRoasIdx]),
          h1: parseRoas(row[h1Idx]),
          h2: parseRoas(row[h1Idx + 1]),
          h3: parseRoas(row[h1Idx + 2]),
          h4: parseRoas(row[h1Idx + 3]),
          h5: parseRoas(row[h1Idx + 4]),
          h6: parseRoas(row[h1Idx + 5]),
          h7: parseRoas(row[h1Idx + 6])
        };

        if (dateKey) {
          if (cid) historyMap[`${dateKey}_${cid}`] = histObj;
          if (cname) historyMap[`${dateKey}_name_${cname}`] = histObj;
        }
      }
    }
  }

  // 2. DỊCH CHUYỂN CỘT: Hour-1 nhận ROAS của turn trước, Hour-2 nhận Hour-1,...
  if (rows && rows.length > 1) {
    const headers = rows[0];
    const dateIdx = headers.indexOf('Date');
    const cidIdx = headers.indexOf('Campaign id');
    const nameIdx = headers.indexOf('Campaign name');
    const h1Idx = headers.indexOf('Hour-1');

    if (dateIdx !== -1 && h1Idx !== -1) {
      const todayDateKey = normalizeDateStr(rows[1][dateIdx]); // Dòng đầu tiên luôn là ngày hôm nay

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowDateKey = normalizeDateStr(row[dateIdx]);
        const cid = cidIdx !== -1 ? String(row[cidIdx]).trim() : '';
        const cname = nameIdx !== -1 ? String(row[nameIdx]).trim() : '';
        const hist = (cid && historyMap[`${rowDateKey}_${cid}`]) || (cname && historyMap[`${rowDateKey}_name_${cname}`]);

        if (rowDateKey === todayDateKey) {
          // Ngày hôm nay: Đẩy ROAS cũ sang Hour-1, Hour-1 cũ sang Hour-2,...
          if (hist) {
            row[h1Idx]     = hist.roas; // ROAS của turn kéo trước đó
            row[h1Idx + 1] = hist.h1;   // Hour-1 cũ đẩy sang Hour-2
            row[h1Idx + 2] = hist.h2;   // Hour-2 cũ đẩy sang Hour-3
            row[h1Idx + 3] = hist.h3;   // Hour-3 cũ đẩy sang Hour-4
            row[h1Idx + 4] = hist.h4;   // Hour-4 cũ đẩy sang Hour-5
            row[h1Idx + 5] = hist.h5;   // Hour-5 cũ đẩy sang Hour-6
            row[h1Idx + 6] = hist.h6;   // Hour-6 cũ đẩy sang Hour-7 (vượt quá khung 7 tự động xoá bớt)
          }
        } else {
          // Các ngày trước đó: Giữ nguyên lịch sử của ngày đó
          if (hist) {
            row[h1Idx]     = hist.h1;
            row[h1Idx + 1] = hist.h2;
            row[h1Idx + 2] = hist.h3;
            row[h1Idx + 3] = hist.h4;
            row[h1Idx + 4] = hist.h5;
            row[h1Idx + 5] = hist.h6;
            row[h1Idx + 6] = hist.h7;
          }
        }
      }
    }
  }

  // 3. GHI DỮ LIỆU ĐÃ DỊCH CHUYỂN LÊN SHEET
  sheet.clear();
  const cidCol = (rows[0].indexOf('Campaign id') !== -1 ? rows[0].indexOf('Campaign id') : rows[0].indexOf('Campaign ID')) + 1;
  if (cidCol > 0) sheet.getRange(1, cidCol, rows.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  // Định dạng Header
  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#F4B400').setFontColor('#000000').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    const dataRows = rows.length - 1;
    const headers = rows[0];
    const dateIdx = headers.indexOf('Date') + 1;
    const maSpIdx = headers.indexOf('Mã SP') + 1;
    const emailIdx = headers.indexOf('Email') + 1;
    const cidIdx = headers.indexOf('Campaign id') + 1;
    const budgetIdx = headers.indexOf('Budget') + 1;
    const costIdx = headers.indexOf('Total Cost') + 1;
    const roasIdx = headers.indexOf('ROAS') + 1;

    if (dateIdx > 0) sheet.getRange(2, dateIdx, dataRows, 1).setNumberFormat('yyyy-MM-dd').setHorizontalAlignment('center');
    if (maSpIdx > 0) sheet.getRange(2, maSpIdx, dataRows, 1).setHorizontalAlignment('center');
    if (emailIdx > 0) sheet.getRange(2, emailIdx, dataRows, 1).setHorizontalAlignment('left');
    if (cidIdx > 0) sheet.getRange(2, cidIdx, dataRows, 1).setNumberFormat('@').setHorizontalAlignment('center');
    if (budgetIdx > 0) sheet.getRange(2, budgetIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (costIdx > 0) sheet.getRange(2, costIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (roasIdx > 0) {
      const roasCount = rows[0].length - roasIdx + 1;
      sheet.getRange(2, roasIdx, dataRows, roasCount).setNumberFormat('0.00%');
    }
  }
}

function writeSheetFBCampaign(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clear();
  const cidCol = (rows[0].indexOf('Campaign id') !== -1 ? rows[0].indexOf('Campaign id') : rows[0].indexOf('Campaign ID')) + 1;
  if (cidCol > 0) sheet.getRange(1, cidCol, rows.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#F4B400').setFontColor('#000000').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    const dataRows = rows.length - 1;
    const headers = rows[0];
    const dateIdx = headers.indexOf('Date') + 1;
    const maSpIdx = headers.indexOf('Mã SP') + 1;
    const emailIdx = headers.indexOf('Email') + 1;
    const cidIdx = headers.indexOf('Campaign id') + 1;
    const budgetIdx = headers.indexOf('Budget') + 1;
    const costIdx = headers.indexOf('Total Cost') + 1;
    const instIdx = headers.indexOf('Mobile App Install') + 1;
    const cpiIdx = headers.indexOf('CPI') + 1;
    const roasIdx = headers.indexOf('ROAS') + 1;
    const revIdx = headers.indexOf('Rev D0') + 1;
    const timeIdx = headers.indexOf('Time kéo') + 1;

    if (dateIdx > 0) sheet.getRange(2, dateIdx, dataRows, 1).setNumberFormat('yyyy-MM-dd').setHorizontalAlignment('center');
    if (maSpIdx > 0) sheet.getRange(2, maSpIdx, dataRows, 1).setHorizontalAlignment('center');
    if (emailIdx > 0) sheet.getRange(2, emailIdx, dataRows, 1).setHorizontalAlignment('left');
    if (cidIdx > 0) sheet.getRange(2, cidIdx, dataRows, 1).setNumberFormat('@').setHorizontalAlignment('center');
    if (budgetIdx > 0) sheet.getRange(2, budgetIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (costIdx > 0) sheet.getRange(2, costIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (instIdx > 0) sheet.getRange(2, instIdx, dataRows, 1).setNumberFormat('#,##0');
    if (cpiIdx > 0) sheet.getRange(2, cpiIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (roasIdx > 0) sheet.getRange(2, roasIdx, dataRows, 3).setNumberFormat('0.00%');
    if (revIdx > 0) sheet.getRange(2, revIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (timeIdx > 0) sheet.getRange(2, timeIdx, dataRows, 1).setHorizontalAlignment('center');
  }
}

function writeSheetFBCountry(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clear();
  const cidCol = (rows[0].indexOf('Campaign id') !== -1 ? rows[0].indexOf('Campaign id') : rows[0].indexOf('Campaign ID')) + 1;
  if (cidCol > 0) sheet.getRange(1, cidCol, rows.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#F4B400').setFontColor('#000000').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    const dataRows = rows.length - 1;
    const headers = rows[0];
    const dateIdx = headers.indexOf('Date') + 1;
    const maSpIdx = headers.indexOf('Mã SP') + 1;
    const emailIdx = headers.indexOf('Email') + 1;
    const cidIdx = headers.indexOf('Campaign id') + 1;
    const countryIdx = headers.indexOf('Country') + 1;
    const costIdx = headers.indexOf('Total Cost') + 1;
    const instIdx = headers.indexOf('Mobile App Install') + 1;
    const cpiIdx = headers.indexOf('CPI') + 1;
    const roasIdx = headers.indexOf('ROAS D0') + 1;
    const ltvIdx = headers.indexOf('LTV D0') + 1;

    if (dateIdx > 0) sheet.getRange(2, dateIdx, dataRows, 1).setNumberFormat('yyyy-MM-dd').setHorizontalAlignment('center');
    if (maSpIdx > 0) sheet.getRange(2, maSpIdx, dataRows, 1).setHorizontalAlignment('center');
    if (emailIdx > 0) sheet.getRange(2, emailIdx, dataRows, 1).setHorizontalAlignment('left');
    if (cidIdx > 0) sheet.getRange(2, cidIdx, dataRows, 1).setNumberFormat('@').setHorizontalAlignment('center');
    if (countryIdx > 0) sheet.getRange(2, countryIdx, dataRows, 1).setHorizontalAlignment('center');
    if (costIdx > 0) sheet.getRange(2, costIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (instIdx > 0) sheet.getRange(2, instIdx, dataRows, 1).setNumberFormat('#,##0');
    if (cpiIdx > 0) sheet.getRange(2, cpiIdx, dataRows, 1).setNumberFormat('0.00');
    if (roasIdx > 0) sheet.getRange(2, roasIdx, dataRows, 3).setNumberFormat('0.00%');
    if (ltvIdx > 0) sheet.getRange(2, ltvIdx, dataRows, 1).setNumberFormat('0.00');
  }
}

function writeSheetTotalCountry(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clear();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#F4B400').setFontColor('#000000').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    const dataRows = rows.length - 1;
    const headers = rows[0];
    const dateIdx = headers.indexOf('Date') + 1;
    const maSpIdx = headers.indexOf('Mã SP') + 1;
    const emailIdx = headers.indexOf('Email') + 1;
    const countryIdx = headers.indexOf('Country') + 1;
    const costIdx = headers.indexOf('Total Cost') + 1;
    const instIdx = headers.indexOf('Mobile App Install') + 1;
    const cpiIdx = headers.indexOf('CPI') + 1;
    const cpiPctIdx = headers.indexOf('% CPI') + 1;
    const cpiD1Idx = headers.indexOf('CPI D-1') + 1;
    const roasIdx = headers.indexOf('ROAS D0') + 1;
    const ltvIdx = headers.indexOf('LTV D0') + 1;
    const ltvPctIdx = headers.indexOf('% LTV') + 1;

    if (dateIdx > 0) sheet.getRange(2, dateIdx, dataRows, 1).setNumberFormat('yyyy-MM-dd').setHorizontalAlignment('center');
    if (maSpIdx > 0) sheet.getRange(2, maSpIdx, dataRows, 1).setHorizontalAlignment('center');
    if (emailIdx > 0) sheet.getRange(2, emailIdx, dataRows, 1).setHorizontalAlignment('left');
    if (countryIdx > 0) sheet.getRange(2, countryIdx, dataRows, 1).setHorizontalAlignment('center');
    if (costIdx > 0) sheet.getRange(2, costIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (instIdx > 0) sheet.getRange(2, instIdx, dataRows, 1).setNumberFormat('#,##0');
    if (cpiIdx > 0) sheet.getRange(2, cpiIdx, dataRows, 1).setNumberFormat('0.00');
    if (cpiPctIdx > 0) sheet.getRange(2, cpiPctIdx, dataRows, 1).setNumberFormat('0.00%');
    if (cpiD1Idx > 0) sheet.getRange(2, cpiD1Idx, dataRows, 2).setNumberFormat('0.00');
    if (roasIdx > 0) sheet.getRange(2, roasIdx, dataRows, 3).setNumberFormat('0.00%');
    if (ltvIdx > 0) sheet.getRange(2, ltvIdx, dataRows, 3).setNumberFormat('0.00');
    if (ltvPctIdx > 0) sheet.getRange(2, ltvPctIdx, dataRows, 1).setNumberFormat('0.00%');
  }
}

function writeSheetGoogleCampaign(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName) || ss.getSheetByName('GG') || ss.insertSheet(sheetName);
  sheet.clear();
  const cidCol = (rows[0].indexOf('Campaign ID') !== -1 ? rows[0].indexOf('Campaign ID') : rows[0].indexOf('Campaign id')) + 1;
  if (cidCol > 0) sheet.getRange(1, cidCol, rows.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  // Định dạng tiêu đề màu vàng cam (#F4B400) chuẩn theo ảnh giao diện
  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#F4B400').setFontColor('#000000').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    const dataRows = rows.length - 1;
    const headers = rows[0];
    const dateIdx = headers.indexOf('Date') + 1;
    const maSpIdx = headers.indexOf('Mã SP') + 1;
    const emailIdx = headers.indexOf('Email') + 1;
    const cidIdx = headers.indexOf('Campaign ID') + 1;
    const costIdx = headers.indexOf('Cost') + 1;
    const instIdx = headers.indexOf('FirstOpen') + 1;
    const cpuIdx = headers.indexOf('CPU (USD)') + 1;
    const roasIdx = headers.indexOf('ROAS') + 1;
    const timeIdx = headers.indexOf('Time kéo') + 1;

    if (dateIdx > 0) sheet.getRange(2, dateIdx, dataRows, 1).setNumberFormat('yyyy-MM-dd').setHorizontalAlignment('center');
    if (maSpIdx > 0) sheet.getRange(2, maSpIdx, dataRows, 1).setHorizontalAlignment('center');
    if (emailIdx > 0) sheet.getRange(2, emailIdx, dataRows, 1).setHorizontalAlignment('left');
    if (cidIdx > 0) sheet.getRange(2, cidIdx, dataRows, 1).setNumberFormat('@').setHorizontalAlignment('center');
    if (costIdx > 0) sheet.getRange(2, costIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (instIdx > 0) sheet.getRange(2, instIdx, dataRows, 1).setNumberFormat('#,##0');
    if (cpuIdx > 0) sheet.getRange(2, cpuIdx, dataRows, 1).setNumberFormat('0.00');
    if (roasIdx > 0) sheet.getRange(2, roasIdx, dataRows, 3).setNumberFormat('0.00%');
    if (timeIdx > 0) sheet.getRange(2, timeIdx, dataRows, 1).setHorizontalAlignment('center');
  }
}

function writeSheetGoogleCountry(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName) || ss.getSheetByName('Country GG') || ss.insertSheet(sheetName);
  sheet.clear();
  const cidCol = (rows[0].indexOf('Campaign ID') !== -1 ? rows[0].indexOf('Campaign ID') : rows[0].indexOf('Campaign id')) + 1;
  if (cidCol > 0) sheet.getRange(1, cidCol, rows.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  // Định dạng tiêu đề màu vàng cam (#F4B400) chuẩn theo ảnh giao diện
  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#F4B400').setFontColor('#000000').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    const dataRows = rows.length - 1;
    const headers = rows[0];
    const maSpIdx = headers.indexOf('Mã SP') + 1;
    const emailIdx = headers.indexOf('Email') + 1;
    const dateIdx = headers.indexOf('Date') + 1;
    const cidIdx = headers.indexOf('Campaign ID') + 1;
    const countryIdx = headers.indexOf('Country/Territory') + 1;
    const costIdx = headers.indexOf('COST (USD)') + 1;
    const roasIdx = headers.indexOf('ROAS D0') + 1;
    const instIdx = headers.indexOf('FirtOpen') + 1;
    const cpuIdx = headers.indexOf('CPU') + 1;
    const timeIdx = headers.indexOf('Time kéo') + 1;

    if (maSpIdx > 0) sheet.getRange(2, maSpIdx, dataRows, 1).setHorizontalAlignment('center');
    if (emailIdx > 0) sheet.getRange(2, emailIdx, dataRows, 1).setHorizontalAlignment('left');
    if (dateIdx > 0) sheet.getRange(2, dateIdx, dataRows, 1).setNumberFormat('yyyy-MM-dd').setHorizontalAlignment('center');
    if (cidIdx > 0) sheet.getRange(2, cidIdx, dataRows, 1).setNumberFormat('@').setHorizontalAlignment('center');
    if (countryIdx > 0) sheet.getRange(2, countryIdx, dataRows, 1).setHorizontalAlignment('center');
    if (costIdx > 0) sheet.getRange(2, costIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (roasIdx > 0) sheet.getRange(2, roasIdx, dataRows, 1).setNumberFormat('0.00%');
    if (instIdx > 0) sheet.getRange(2, instIdx, dataRows, 1).setNumberFormat('#,##0');
    if (cpuIdx > 0) sheet.getRange(2, cpuIdx, dataRows, 1).setNumberFormat('0.00');
    if (timeIdx > 0) sheet.getRange(2, timeIdx, dataRows, 1).setHorizontalAlignment('center');
  }
}

function writeSheetGoogleTotalCountry(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName) || ss.getSheetByName('Total Country GG') || ss.insertSheet(sheetName);
  sheet.clear();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  // Định dạng tiêu đề màu vàng cam (#F4B400) chuẩn theo ảnh giao diện
  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#F4B400').setFontColor('#000000').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    const dataRows = rows.length - 1;
    const headers = rows[0];
    const dateIdx = headers.indexOf('Date') + 1;
    const maSpIdx = headers.indexOf('Mã SP') + 1;
    const appIdx = headers.indexOf('APP ID') + 1;
    const emailIdx = headers.indexOf('Email') + 1;
    const countryIdx = headers.indexOf('Country') + 1;
    const costIdx = headers.indexOf('Total Cost') + 1;
    const instIdx = headers.indexOf('FistOpen') + 1;
    const cpuIdx = headers.indexOf('CPU') + 1;
    const roasIdx = headers.indexOf('ROAS D0') + 1;
    const timeIdx = headers.indexOf('Time kéo') + 1;

    if (dateIdx > 0) sheet.getRange(2, dateIdx, dataRows, 1).setNumberFormat('yyyy-MM-dd').setHorizontalAlignment('center');
    if (maSpIdx > 0) sheet.getRange(2, maSpIdx, dataRows, 1).setHorizontalAlignment('center');
    if (appIdx > 0) sheet.getRange(2, appIdx, dataRows, 1).setHorizontalAlignment('center');
    if (emailIdx > 0) sheet.getRange(2, emailIdx, dataRows, 1).setHorizontalAlignment('left');
    if (countryIdx > 0) sheet.getRange(2, countryIdx, dataRows, 1).setHorizontalAlignment('center');
    if (costIdx > 0) sheet.getRange(2, costIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (instIdx > 0) sheet.getRange(2, instIdx, dataRows, 1).setNumberFormat('#,##0');
    if (cpuIdx > 0) sheet.getRange(2, cpuIdx, dataRows, 1).setNumberFormat('0.000');
    if (roasIdx > 0) sheet.getRange(2, roasIdx, dataRows, 1).setNumberFormat('0.00%');
    if (timeIdx > 0) sheet.getRange(2, timeIdx, dataRows, 1).setHorizontalAlignment('center');
  }
}

function writeSheetCutOff(ss, sheetName, rows) {
  let sheet = ss.getSheetByName('CutOff') || ss.getSheetByName('Cut Off') || ss.getSheetByName(sheetName) || ss.insertSheet('CutOff');
  sheet.clear();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  // Định dạng tiêu đề màu vàng cam (#F4B400) chuẩn theo ảnh giao diện
  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#F4B400').setFontColor('#000000').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    const dataRows = rows.length - 1;
    const headers = rows[0];

    const dateIdx = headers.indexOf('Date') + 1;
    const marketerIdx = headers.indexOf('Marketer') + 1;
    const adminIdx = headers.indexOf('Admin') + 1;
    const leaderIdx = headers.indexOf('Team Leader') + 1;
    const empIdx = headers.indexOf('Employee') + 1;
    const emailIdx = headers.indexOf('Email') + 1;
    const maSpIdx = headers.indexOf('Mã SP') + 1;
    const appIdx = headers.indexOf('App') + 1;
    const roasIdx = headers.indexOf('ROAS D0') + 1;
    const costIdx = headers.indexOf('Total Cost') + 1;
    const instIdx = headers.indexOf('FistOpen') + 1;
    const revAdjIdx = headers.indexOf('Rev Cutoff adjust') + 1;
    const revIdx = headers.indexOf('Rev Cutoff Admob') + 1;
    const pl2Idx = headers.indexOf('PL2 Admob') + 1;
    const pl2PctIdx = headers.indexOf('%PL2 Admob') + 1;
    const costVndIdx = headers.indexOf('Cost (VND)') + 1;
    const pl2VndIdx = headers.indexOf('PL2 (VND)') + 1;
    const fbIdx = headers.indexOf('Facebook') + 1;
    const ggIdx = headers.indexOf('Google') + 1;
    const ttIdx = headers.indexOf('Tiktok') + 1;
    const minteIdx = headers.indexOf('Mintegral') + 1;
    const timeIdx = headers.indexOf('Time kéo') + 1;

    if (dateIdx > 0) sheet.getRange(2, dateIdx, dataRows, 1).setNumberFormat('yyyy-MM-dd').setHorizontalAlignment('center');
    if (marketerIdx > 0) sheet.getRange(2, marketerIdx, dataRows, 1).setHorizontalAlignment('center');
    if (adminIdx > 0) sheet.getRange(2, adminIdx, dataRows, 1).setHorizontalAlignment('center');
    if (leaderIdx > 0) sheet.getRange(2, leaderIdx, dataRows, 1).setHorizontalAlignment('center');
    if (empIdx > 0) sheet.getRange(2, empIdx, dataRows, 1).setHorizontalAlignment('center');
    if (emailIdx > 0) sheet.getRange(2, emailIdx, dataRows, 1).setHorizontalAlignment('left');
    if (maSpIdx > 0) sheet.getRange(2, maSpIdx, dataRows, 1).setHorizontalAlignment('center');
    if (appIdx > 0) sheet.getRange(2, appIdx, dataRows, 1).setHorizontalAlignment('left');
    if (roasIdx > 0) sheet.getRange(2, roasIdx, dataRows, 1).setNumberFormat('0.00%').setHorizontalAlignment('right');
    if (costIdx > 0) sheet.getRange(2, costIdx, dataRows, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
    if (instIdx > 0) sheet.getRange(2, instIdx, dataRows, 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    if (revAdjIdx > 0) sheet.getRange(2, revAdjIdx, dataRows, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
    if (revIdx > 0) sheet.getRange(2, revIdx, dataRows, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
    if (pl2Idx > 0) sheet.getRange(2, pl2Idx, dataRows, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
    if (pl2PctIdx > 0) sheet.getRange(2, pl2PctIdx, dataRows, 1).setNumberFormat('0.00%').setHorizontalAlignment('right');
    if (costVndIdx > 0) sheet.getRange(2, costVndIdx, dataRows, 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    if (pl2VndIdx > 0) sheet.getRange(2, pl2VndIdx, dataRows, 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    if (fbIdx > 0) sheet.getRange(2, fbIdx, dataRows, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
    if (ggIdx > 0) sheet.getRange(2, ggIdx, dataRows, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
    if (ttIdx > 0) sheet.getRange(2, ttIdx, dataRows, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
    if (minteIdx > 0) sheet.getRange(2, minteIdx, dataRows, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
    if (timeIdx > 0) sheet.getRange(2, timeIdx, dataRows, 1).setHorizontalAlignment('center');
  }
}

function writeSheetApp(ss, sheetName, rows) {
  writeSheetCutOff(ss, 'CutOff', rows);
}

function writeSheetPhanQuyen(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clearContents();
  if (!rows || rows.length === 0) return;

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#1A73E8').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    sheet.getRange(2, 1, rows.length - 1, 1).setHorizontalAlignment('center');
    sheet.getRange(2, 2, rows.length - 1, 1).setHorizontalAlignment('left');
  }
}

function writeSheetAccountStatus(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clear();
  if (!rows || rows.length === 0) return;

  const aidCol = rows[0].indexOf('Account ID') + 1;
  if (aidCol > 0) sheet.getRange(1, aidCol, rows.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  sheet.getRange(1, 1, 1, rows[0].length)
    .setBackground('#1877F2').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 1) {
    const dataRows = rows.length - 1;
    const headers = rows[0];
    const dateIdx = headers.indexOf('Date') + 1;
    const maSpIdx = headers.indexOf('Mã SP') + 1;
    const emailIdx = headers.indexOf('Email') + 1;
    const mktIdx = headers.indexOf('Marketer') + 1;
    const bmIdx = headers.indexOf('BM') + 1;
    const aidIdx = headers.indexOf('Account ID') + 1;
    const stIdx = headers.indexOf('Trạng thái') + 1;
    const reasonIdx = headers.indexOf('Lý do vi phạm') + 1;
    const spendIdx = headers.indexOf('Chi phí ngày (USD)') + 1;
    const mtdIdx = headers.indexOf('Tiêu trong tháng (USD)') + 1;
    const d60Idx = headers.indexOf('Tổng tiêu 60 ngày (USD)') + 1;
    const balIdx = headers.indexOf('Số dư nợ (USD)') + 1;
    const limitIdx = headers.indexOf('Hạn mức Limit (USD)') + 1;
    const remainIdx = headers.indexOf('Ngân sách còn lại (USD)') + 1;
    const currIdx = headers.indexOf('Tiền tệ') + 1;
    const createdIdx = headers.indexOf('Ngày tạo') + 1;
    const timeIdx = headers.indexOf('Time kéo') + 1;

    if (dateIdx > 0) sheet.getRange(2, dateIdx, dataRows, 1).setNumberFormat('yyyy-MM-dd').setHorizontalAlignment('center');
    if (maSpIdx > 0) sheet.getRange(2, maSpIdx, dataRows, 1).setHorizontalAlignment('center');
    if (emailIdx > 0) sheet.getRange(2, emailIdx, dataRows, 1).setHorizontalAlignment('left');
    if (mktIdx > 0) sheet.getRange(2, mktIdx, dataRows, 1).setHorizontalAlignment('center');
    if (bmIdx > 0) sheet.getRange(2, bmIdx, dataRows, 1).setHorizontalAlignment('center');
    if (aidIdx > 0) sheet.getRange(2, aidIdx, dataRows, 1).setNumberFormat('@').setHorizontalAlignment('center');
    if (stIdx > 0) sheet.getRange(2, stIdx, dataRows, 1).setHorizontalAlignment('center');
    if (reasonIdx > 0) sheet.getRange(2, reasonIdx, dataRows, 1).setHorizontalAlignment('left');

    if (spendIdx > 0) sheet.getRange(2, spendIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (mtdIdx > 0) sheet.getRange(2, mtdIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (d60Idx > 0) sheet.getRange(2, d60Idx, dataRows, 1).setNumberFormat('#,##0.00');
    if (balIdx > 0) sheet.getRange(2, balIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (limitIdx > 0) sheet.getRange(2, limitIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (remainIdx > 0) sheet.getRange(2, remainIdx, dataRows, 1).setNumberFormat('#,##0.00');
    if (createdIdx > 0) sheet.getRange(2, createdIdx, dataRows, 1).setHorizontalAlignment('center');
    if (timeIdx > 0) sheet.getRange(2, timeIdx, dataRows, 1).setHorizontalAlignment('center');
  }
}

function resolveMarketerEmailJS(mktNameRaw, khoRaw) {
  if (!mktNameRaw) return '';
  let s = String(mktNameRaw).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return '';
  if (s.includes('@')) return s.replace('hannhk@', 'hannk@');
  if (s === 'hannhk' || (s.startsWith('han') && !s.includes('nhan'))) s = 'hannk';
  const kho = String(khoRaw || '').trim().toUpperCase();
  if (s === 'ductq' && kho === 'AA') return 'ductq.f1@unisoftstudio.com';
  return s + '@unisoftstudio.com';
}

function ensureValidateEmailFormulas(vSheet) {
  try {
    if (!vSheet) return;
    const lastRow = vSheet.getLastRow();
    if (lastRow < 2) return;
    // Đặt ARRAYFORMULA tự động ở dòng 2 (E2, F2, G2) để khi đổi tên Marketer ở cột A thì cột Email bên phải đổi ngay lập tức
    const numRows = lastRow - 1;
    if (numRows > 1) {
      vSheet.getRange(3, 5, numRows - 1, 3).clearContent();
    }
    vSheet.getRange('E2').setFormula('=ARRAYFORMULA(IF(B2:B="","","ductq@unisoftstudio.com"))');
    vSheet.getRange('F2').setFormula('=ARRAYFORMULA(IF(B2:B="","","quyennh@unisoftstudio.com"))');
    vSheet.getRange('G2').setFormula('=ARRAYFORMULA(IF(A2:A="","",LOWER(REGEXREPLACE(TRIM(A2:A),"\\s+",""))&IF((LOWER(TRIM(A2:A))="ductq")*(UPPER(TRIM(D2:D))="AA"),".f1","")&"@unisoftstudio.com"))');
    SpreadsheetApp.flush();
  } catch (err) {
    Logger.log('⚠️ ensureValidateEmailFormulas error: ' + err.toString());
  }
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const name = sheet.getName().toLowerCase();
    if (name === 'validate') {
      ensureValidateEmailFormulas(sheet);
      syncPhanQuyenFromValidate(sheet.getParent());
    }
  } catch (err) {
    Logger.log('⚠️ onEdit error: ' + err.toString());
  }
}

function syncPhanQuyenFromValidate(ss) {
  try {
    const vSheet = ss.getSheetByName('Validate') || ss.getSheetByName('validate') || ss.getSheetByName('VALIDATE');
    if (!vSheet) return;
    ensureValidateEmailFormulas(vSheet);
    const vData = vSheet.getDataRange().getValues();
    if (vData.length <= 1) return;

    const headers = vData[0];
    let mktNameIdx = 0, spIdx = -1, khoIdx = -1, admIdx = -1, leadIdx = -1, mktMailIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i]).toLowerCase().trim();
      if (h.includes('mail') || h.includes('email')) {
        if (h.includes('admin')) admIdx = i;
        else if (h.includes('lead')) leadIdx = i;
        else if (h.includes('marketer') || h.includes('employ') || h.includes('pic')) mktMailIdx = i;
      } else {
        if (h.includes('mã') || h.includes('code') || (h.includes('sp') && !h.includes('tên') && !h.includes('name'))) spIdx = i;
        else if (h.includes('marketer') || h.includes('employ') || h.includes('pic')) mktNameIdx = i;
        else if (h.includes('kho') || h.includes('bm')) khoIdx = i;
      }
    }
    if (spIdx === -1) return;

    const pairs = [];
    const seen = {};
    const defaultAdmins = ['ductq@unisoftstudio.com', 'quyennh@unisoftstudio.com', 'sonnm@unisoftstudio.com', 'lienpt@unisoftstudio.com'];

    for (let r = 1; r < vData.length; r++) {
      const row = vData[r];
      let sp = String(row[spIdx]).trim();
      if (!sp) continue;
      const match = sp.match(/([A-Za-z]{1,4}\d{2,4})/);
      if (match) sp = match[1].toUpperCase();

      const mktName = mktNameIdx !== -1 ? String(row[mktNameIdx] || '').trim() : '';
      const khoVal = khoIdx !== -1 ? String(row[khoIdx] || '').trim() : '';

      const rawEmails = [];
      // 1. Ưu tiên tuyệt đối tạo Email từ cột Marketer (cột A)
      const primaryMktEmail = resolveMarketerEmailJS(mktName, khoVal);
      if (primaryMktEmail) {
        rawEmails.push(primaryMktEmail);
      } else if (mktMailIdx !== -1 && row[mktMailIdx]) {
        rawEmails.push(...String(row[mktMailIdx]).split(/[\s,;]+/));
      }

      if (admIdx !== -1 && row[admIdx]) rawEmails.push(...String(row[admIdx]).split(/[\s,;]+/));
      if (leadIdx !== -1 && row[leadIdx]) rawEmails.push(...String(row[leadIdx]).split(/[\s,;]+/));

      const emails = [];
      for (let em of rawEmails) {
        let eClean = String(em).trim().toLowerCase().replace('hannhk@', 'hannk@');
        if (eClean && !emails.includes(eClean)) emails.push(eClean);
      }

      for (let adm of defaultAdmins) {
        if (!emails.includes(adm)) emails.push(adm);
      }

      for (let e of emails) {
        if (e.includes('@')) {
          const key = sp + '_' + e;
          if (!seen[key]) {
            seen[key] = true;
            pairs.push([sp, e]);
          }
        }
      }
    }

    if (pairs.length > 0) {
      writeSheetPhanQuyen(ss, 'PhanQuyen', [['Mã SP', 'Email'], ...pairs]);
    }
  } catch (err) {
    Logger.log('⚠️ syncPhanQuyenFromValidate error: ' + err.toString());
  }
}

// ==================== HÀM BỔ TRỢ ====================

function parseRoas(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (!v) return 0;
  let str = String(v).trim();
  const isPercent = str.includes('%');
  str = str.replace('%', '').replace(',', '.').trim();
  const num = parseFloat(str);
  if (isNaN(num)) return 0;
  return isPercent ? (num / 100) : num;
}

function normalizeDateStr(d) {
  if (!d) return '';
  if (d instanceof Date) {
    return Utilities.formatDate(d, 'GMT+7', 'yyyy-MM-dd');
  }
  let str = String(d).trim();
  let parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    return Utilities.formatDate(new Date(parsed), 'GMT+7', 'yyyy-MM-dd');
  }
  return str;
}

// Xử lý GET: Kiểm tra hoạt động hoặc đọc sheet Validate
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action).toLowerCase() : '';

    if (action === 'validate' || action === 'get_validate') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName('Validate') || ss.getSheetByName('validate') || ss.getSheetByName('VALIDATE');
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'Không tìm thấy sheet Validate trong bảng tính!'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        spreadsheetId: ss.getId(),
        sheetName: sheet.getName(),
        data: sheet.getDataRange().getValues()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput("🚀 Web App Receiver đang hoạt động tốt!");
}

// ==================== BỘ ĐIỀU KHIỂN & KÍCH HOẠT CLOUD CHUẨN 100% ====================

// 1. Tạo Menu điều khiển ngay trên thanh menu Google Sheet
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Đồng Bộ Ads')
    .addItem('🚀 Kéo số ngay lập tức (Chạy ngầm Cloud)', 'triggerCloudSync')
    .addItem('⏰ Kích hoạt tự động kéo 19 khung giờ cố định (12 chẵn + 7 lẻ)', 'setupScheduleEvery2Hours')
    .addToUi();
}

// 2. Hàm ra lệnh cho GitHub Actions chạy kéo số trên Cloud
function triggerCloudSync() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || '';
  const url = 'https://api.github.com/repos/nghuuquyen23-ai/ads-sync-cloud/actions/workflows/sync_ads.yml/dispatches';
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Google-Apps-Script'
    },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code === 204 || code === 200) {
      Logger.log('🚀 Đã gửi lệnh kích hoạt GitHub Actions thành công!');
      try {
        SpreadsheetApp.getActiveSpreadsheet().toast('🚀 Đang kéo dữ liệu trên Cloud! Google Sheet sẽ tự cập nhật sau ~2 phút.', 'Đang xử lý', 6);
      } catch (e) {}
    } else {
      Logger.log('⚠️ GitHub trả về mã: ' + code + ' - ' + res.getContentText());
      try {
        SpreadsheetApp.getActiveSpreadsheet().toast('Lỗi kích hoạt: ' + res.getContentText(), 'Thất bại', 6);
      } catch (e) {}
    }
  } catch (err) {
    Logger.log('❌ Lỗi kết nối GitHub: ' + err.toString());
  }
}

// Danh sách 19 khung giờ cố định (+5 phút) trong ngày (12 khung chẵn + 7 khung bổ sung, Giờ Việt Nam GMT+7)
const FIXED_SLOTS_VN = [
  { h: 0,  m: 5  }, // 00:05 (Khung chẵn +5p)
  { h: 2,  m: 5  }, // 02:05 (Khung chẵn +5p)
  { h: 4,  m: 5  }, // 04:05 (Khung chẵn +5p)
  { h: 6,  m: 5  }, // 06:05 (Khung chẵn +5p)
  { h: 7,  m: 35 }, // 07:35 (Khung 07:30 +5p)
  { h: 8,  m: 5  }, // 08:05 (Khung chẵn +5p)
  { h: 9,  m: 5  }, // 09:05 (Khung 09:00 +5p)
  { h: 10, m: 5  }, // 10:05 (Khung chẵn +5p)
  { h: 11, m: 35 }, // 11:35 (Khung 11:30 +5p)
  { h: 12, m: 5  }, // 12:05 (Khung chẵn +5p)
  { h: 13, m: 35 }, // 13:35 (Khung 13:30 +5p)
  { h: 14, m: 5  }, // 14:05 (Khung chẵn +5p)
  { h: 16, m: 5  }, // 16:05 (Chung cả 2 lịch +5p)
  { h: 17, m: 45 }, // 17:45 (Khung 17:40 +5p)
  { h: 18, m: 5  }, // 18:05 (Khung chẵn +5p)
  { h: 20, m: 5  }, // 20:05 (Khung chẵn +5p)
  { h: 21, m: 5  }, // 21:05 (Khung 21:00 +5p)
  { h: 22, m: 5  }, // 22:05 (Khung chẵn +5p)
  { h: 23, m: 25 }  // 23:25 (Khung 23:20 +5p)
];

// 3. Cài đặt hẹn giờ chuẩn xác từng phút cho 19 khung giờ cố định (+5p)
function setupScheduleEvery2Hours() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    const fn = triggers[i].getHandlerFunction();
    if (fn === 'triggerCloudSync' || fn === 'triggerCloudSyncScheduled') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Tạo 1 Trigger vĩnh viễn kiểm tra mỗi phút 1 lần -> Đúng phút của 19 khung giờ là bắn lệnh ngay lập tức, không bao giờ bị trễ 15-20 phút như .at(Date)
  ScriptApp.newTrigger('triggerCloudSyncScheduled')
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log('✅ Đã thiết lập thành công Trigger kiểm tra mỗi phút cho 19 khung giờ cố định (+5p)!');
  try {
    SpreadsheetApp.getUi().alert('✅ Thành công! Đã bật chế độ canh giờ chuẩn từng phút (24/7) cho đủ 19 khung giờ (+5p):\n00:05, 02:05, 04:05, 06:05, 07:35, 08:05, 09:05, 10:05, 11:35, 12:05, 13:35, 14:05, 16:05, 17:45, 18:05, 20:05, 21:05, 22:05, 23:25.');
  } catch (e) {}
}

function triggerCloudSyncScheduled() {
  const now = new Date();
  const vnDateStr = Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd');
  const vnHour = parseInt(Utilities.formatDate(now, 'GMT+7', 'H'), 10);
  const vnMinute = parseInt(Utilities.formatDate(now, 'GMT+7', 'm'), 10);
  const nowTotalMin = vnHour * 60 + vnMinute;

  const props = PropertiesService.getScriptProperties();
  const lastTriggeredKey = props.getProperty('LAST_TRIGGERED_SLOT_KEY') || '';

  for (let i = 0; i < FIXED_SLOTS_VN.length; i++) {
    const slot = FIXED_SLOTS_VN[i];
    const slotTotalMin = slot.h * 60 + slot.m;
    // Nếu thời gian hiện tại nằm trong khoảng [khung giờ, khung giờ + 5 phút] và chưa kích hoạt khung này trong hôm nay
    if (nowTotalMin >= slotTotalMin && nowTotalMin <= slotTotalMin + 5) {
      const slotKey = vnDateStr + '_' + String(slot.h).padStart(2, '0') + ':' + String(slot.m).padStart(2, '0');
      if (lastTriggeredKey !== slotKey) {
        props.setProperty('LAST_TRIGGERED_SLOT_KEY', slotKey);
        Logger.log('⏰ Đúng khung giờ ' + slotKey + ' -> Kích hoạt kéo số GitHub Actions!');
        triggerCloudSync();
      }
      break;
    }
  }
}
