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

    // 0.1. Đồng bộ tự động Meta Tokens từ GitHub Cloud vào bộ nhớ bảo mật ScriptProperties
    if (data && data.action === 'sync_meta_tokens' && data.metaTokens) {
      PropertiesService.getScriptProperties().setProperty('META_TOKENS_JSON', JSON.stringify(data.metaTokens));
      return jsonResponse({ status: 'success', message: 'Đã lưu cấu hình Meta Tokens vào ScriptProperties!' });
    }

    // 0.2. API lấy dữ liệu cho Web Dashboard & Looker Studio Control Center (kèm phân quyền Email)
    if (data && data.action === 'get_dashboard_data') {
      return jsonResponse(getDashboardData(ss, data));
    }

    // 0.3. API Tắt / Bật Campaign trực tiếp lên Facebook Graph API
    if (data && data.action === 'toggle_campaign') {
      return jsonResponse(toggleMetaCampaign(ss, data));
    }

    // 0.4. API Tăng / Giảm / Chỉnh Budget Campaign trực tiếp lên Facebook Graph API
    if (data && data.action === 'update_budget') {
      return jsonResponse(updateMetaCampaignBudget(ss, data));
    }

    // 0.5. API Kích hoạt kéo số Cloud ngay lập tức từ giao diện Web
    if (data && data.action === 'trigger_cloud_sync') {
      triggerCloudSync();
      return jsonResponse({ status: 'success', message: 'Đã kích hoạt GitHub Actions kéo số Cloud!' });
    }

    // 0.6. API Lưu cấu hình Looker Studio Embed URL & Token
    if (data && data.action === 'save_dashboard_settings') {
      const props = PropertiesService.getScriptProperties();
      if (data.lookerEmbedUrl !== undefined) {
        props.setProperty('LOOKER_EMBED_URL', String(data.lookerEmbedUrl).trim());
      }
      if (data.customFbToken) {
        props.setProperty('CUSTOM_FB_TOKEN', String(data.customFbToken).trim());
      }
      return jsonResponse({ status: 'success', message: 'Đã lưu cấu hình Dashboard!' });
    }

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
  sheet.clear();
  if (!rows || rows.length === 0) return;
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
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

function syncPhanQuyenFromValidate(ss) {
  try {
    const vSheet = ss.getSheetByName('Validate') || ss.getSheetByName('validate') || ss.getSheetByName('VALIDATE');
    if (!vSheet) return;
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

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Xử lý GET: Kiểm tra hoạt động, đọc sheet Validate, hoặc hiển thị giao diện Bảng Điều Khiển Campaign & Looker
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action).toLowerCase() : '';
    const view = (e && e.parameter && e.parameter.view) ? String(e.parameter.view).toLowerCase() : '';

    if (action === 'validate' || action === 'get_validate') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName('Validate') || ss.getSheetByName('validate') || ss.getSheetByName('VALIDATE');
      if (!sheet) {
        return jsonResponse({
          status: 'error',
          message: 'Không tìm thấy sheet Validate trong bảng tính!'
        });
      }
      return jsonResponse({
        status: 'success',
        spreadsheetId: ss.getId(),
        sheetName: sheet.getName(),
        data: sheet.getDataRange().getValues()
      });
    }

    if (action === 'get_dashboard_data') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonResponse(getDashboardData(ss, e.parameter || {}));
    }

    if (action === 'ping') {
      return ContentService.createTextOutput("🚀 Web App Receiver đang hoạt động tốt!");
    }

    // Mặc định khi mở bằng trình duyệt hoặc nhúng vào Looker Studio: Hiển thị Web App Quản lý Campaign & Budget
    return renderDashboardHtmlOutput(e);
  } catch (err) {
    return jsonResponse({
      status: 'error',
      message: err.toString()
    });
  }
}

// Hỗ trợ gọi trực tiếp từ google.script.run trên giao diện HtmlService
function handleClientApiRequest(payloadJson) {
  try {
    const data = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (data.action === 'get_dashboard_data') return getDashboardData(ss, data);
    if (data.action === 'toggle_campaign') return toggleMetaCampaign(ss, data);
    if (data.action === 'update_budget') return updateMetaCampaignBudget(ss, data);
    if (data.action === 'trigger_cloud_sync') {
      triggerCloudSync();
      return { status: 'success', message: 'Đã kích hoạt GitHub Actions kéo số Cloud!' };
    }
    if (data.action === 'save_dashboard_settings') {
      const props = PropertiesService.getScriptProperties();
      if (data.lookerEmbedUrl !== undefined) props.setProperty('LOOKER_EMBED_URL', String(data.lookerEmbedUrl).trim());
      if (data.customFbToken) props.setProperty('CUSTOM_FB_TOKEN', String(data.customFbToken).trim());
      return { status: 'success', message: 'Đã lưu cấu hình!' };
    }
    return { status: 'error', message: 'Action không hợp lệ: ' + data.action };
  } catch (err) {
    return { status: 'error', message: err.toString() };
  }
}

// ==================== BỘ ĐIỀU KHIỂN CAMPAIGN & PHÂN QUYỀN (RBAC) ====================

const DEFAULT_ADMIN_EMAILS = [
  'ductq@unisoftstudio.com',
  'quyennh@unisoftstudio.com',
  'sonnm@unisoftstudio.com',
  'lienpt@unisoftstudio.com'
];

function getPermissionsContext(ss) {
  const adminEmails = DEFAULT_ADMIN_EMAILS.slice();
  const emailToSps = {};
  const allUsersSet = {};
  const appNamesMap = {};
  const marketerMap = {};

  DEFAULT_ADMIN_EMAILS.forEach(function(a) { allUsersSet[a] = true; });

  // 1. Đọc bảng PhanQuyen
  const pqSheet = ss.getSheetByName('PhanQuyen');
  if (pqSheet && pqSheet.getLastRow() > 1) {
    const pqValues = pqSheet.getDataRange().getValues();
    for (let r = 1; r < pqValues.length; r++) {
      const sp = String(pqValues[r][0] || '').trim().toUpperCase();
      const em = String(pqValues[r][1] || '').trim().toLowerCase();
      if (!sp || !em) continue;
      if (!emailToSps[em]) emailToSps[em] = [];
      if (emailToSps[em].indexOf(sp) === -1) emailToSps[em].push(sp);
      allUsersSet[em] = true;
    }
  }

  // 2. Đọc bảng Validate để lấy Tên App, Tên Marketer và Admin bổ sung
  const vSheet = ss.getSheetByName('Validate') || ss.getSheetByName('validate') || ss.getSheetByName('VALIDATE');
  if (vSheet && vSheet.getLastRow() > 1) {
    const vData = vSheet.getDataRange().getValues();
    const headers = vData[0].map(function(h) { return String(h || '').toLowerCase().trim(); });
    let spIdx = -1, nameIdx = -1, mktIdx = 0, admMailIdx = -1, khoIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h.indexOf('mail') !== -1 && h.indexOf('admin') !== -1) admMailIdx = i;
      else if (h.indexOf('mã') !== -1 || h.indexOf('code') !== -1 || (h.indexOf('sp') !== -1 && h.indexOf('tên') === -1)) spIdx = i;
      else if (h.indexOf('tên') !== -1 || h.indexOf('app') !== -1 || h.indexOf('name') !== -1) nameIdx = i;
      else if (h.indexOf('marketer') !== -1 || h.indexOf('pic') !== -1) mktIdx = i;
      else if (h.indexOf('kho') !== -1 || h.indexOf('bm') !== -1) khoIdx = i;
    }
    for (let r = 1; r < vData.length; r++) {
      const row = vData[r];
      let spRaw = spIdx !== -1 ? String(row[spIdx] || '').trim() : String(row[1] || '').trim();
      const m = spRaw.match(/([A-Za-z]{1,4}\d{2,4})/);
      const sp = m ? m[1].toUpperCase() : spRaw.toUpperCase();
      if (!sp) continue;

      if (nameIdx !== -1 && row[nameIdx]) appNamesMap[sp] = String(row[nameIdx]).trim();
      const mktName = mktIdx !== -1 ? String(row[mktIdx] || '').trim() : '';
      if (mktName) marketerMap[sp] = mktName;

      const khoVal = khoIdx !== -1 ? String(row[khoIdx] || '').trim() : '';
      const mktEmail = resolveMarketerEmailJS(mktName, khoVal);
      if (mktEmail) {
        if (!emailToSps[mktEmail]) emailToSps[mktEmail] = [];
        if (emailToSps[mktEmail].indexOf(sp) === -1) emailToSps[mktEmail].push(sp);
        allUsersSet[mktEmail] = true;
      }

      if (admMailIdx !== -1 && row[admMailIdx]) {
        const adms = String(row[admMailIdx]).split(/[\s,;]+/);
        adms.forEach(function(a) {
          const clean = resolveMarketerEmailJS(a, '');
          if (clean && adminEmails.indexOf(clean) === -1) adminEmails.push(clean);
        });
      }
    }
  }

  return {
    adminEmails: adminEmails,
    emailToSps: emailToSps,
    allUsers: Object.keys(allUsersSet).sort(),
    appNamesMap: appNamesMap,
    marketerMap: marketerMap
  };
}

function checkUserCanControl(ss, userEmail, spCode, campaignId) {
  const email = String(userEmail || '').trim().toLowerCase();
  if (!email) return false;
  const ctx = getPermissionsContext(ss);
  if (ctx.adminEmails.indexOf(email) !== -1) return true;

  const sp = String(spCode || '').trim().toUpperCase();
  const allowedSps = ctx.emailToSps[email] || [];
  if (sp && allowedSps.indexOf(sp) !== -1) return true;

  // Kiểm tra trực tiếp trong bảng FB Campaign xem dòng campaignId có gán cho email này không
  const fbSheet = ss.getSheetByName('FB Campaign');
  if (fbSheet && fbSheet.getLastRow() > 1) {
    const vals = fbSheet.getDataRange().getValues();
    const h = vals[0];
    const cidIdx = h.indexOf('Campaign id');
    const emIdx = h.indexOf('Email');
    if (cidIdx !== -1 && emIdx !== -1) {
      for (let r = 1; r < vals.length; r++) {
        if (String(vals[r][cidIdx]).trim() === String(campaignId).trim() &&
            String(vals[r][emIdx]).trim().toLowerCase() === email) {
          return true;
        }
      }
    }
  }
  return false;
}

function getDashboardData(ss, reqData) {
  const ctx = getPermissionsContext(ss);
  let sessionEmail = '';
  try {
    sessionEmail = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {}

  const userEmail = String(reqData.email || sessionEmail || 'ductq@unisoftstudio.com').trim().toLowerCase();
  const isAdmin = ctx.adminEmails.indexOf(userEmail) !== -1;

  // Nếu là Marketer: khóa cứng chỉ xem dữ liệu của chính email đó
  // Nếu là Admin: xem tất cả ('ALL') hoặc lọc theo filterEmail
  let targetEmail = userEmail;
  if (isAdmin) {
    const fEmail = String(reqData.filterEmail || 'ALL').trim().toLowerCase();
    targetEmail = (fEmail && fEmail !== 'all' && fEmail !== userEmail) ? fEmail : 'ALL';
  }

  const allowedSpsForTarget = targetEmail === 'ALL' ? null : (ctx.emailToSps[targetEmail] || []);

  // 1. Đọc CutOff
  const cutoffList = [];
  const seenCutoff = {};
  const cutSheet = ss.getSheetByName('CutOff') || ss.getSheetByName('Cut Off');
  if (cutSheet && cutSheet.getLastRow() > 1) {
    const vals = cutSheet.getDataRange().getValues();
    const h = vals[0];
    const dIdx = h.indexOf('Date');
    const mktIdx = h.indexOf('Marketer');
    const emIdx = h.indexOf('Email');
    const spIdx = h.indexOf('Mã SP');
    const appIdx = h.indexOf('App');
    const roasIdx = h.indexOf('ROAS D0');
    const costIdx = h.indexOf('Total Cost');
    const instIdx = h.indexOf('FistOpen');
    const revIdx = h.indexOf('Rev Cutoff adjust');

    for (let r = 1; r < vals.length; r++) {
      const row = vals[r];
      const dStr = normalizeDateStr(row[dIdx]);
      const sp = String(row[spIdx] || '').trim().toUpperCase();
      const rowEmail = String(row[emIdx] || '').trim().toLowerCase();
      if (!dStr || !sp) continue;

      if (targetEmail !== 'ALL') {
        if (rowEmail !== targetEmail && (!allowedSpsForTarget || allowedSpsForTarget.indexOf(sp) === -1)) {
          continue;
        }
      }

      const key = dStr + '_' + sp;
      if (seenCutoff[key]) continue;
      seenCutoff[key] = true;

      cutoffList.push({
        date: dStr,
        sp: sp,
        appName: String(row[appIdx] || ctx.appNamesMap[sp] || sp).trim(),
        marketer: String(row[mktIdx] || ctx.marketerMap[sp] || '').trim(),
        roas: parseRoas(row[roasIdx]),
        spend: parseFloat(row[costIdx]) || 0,
        installs: parseInt(row[instIdx], 10) || 0,
        rev: parseFloat(row[revIdx]) || 0
      });
    }
  }

  // 2. Đọc FB Campaign
  const fbCampaigns = [];
  const seenFbCamp = {};
  let syncTimeStr = '';
  const fbSheet = ss.getSheetByName('FB Campaign');
  if (fbSheet && fbSheet.getLastRow() > 1) {
    const vals = fbSheet.getDataRange().getValues();
    const h = vals[0];
    const dIdx = h.indexOf('Date');
    const spIdx = h.indexOf('Mã SP');
    const emIdx = h.indexOf('Email');
    const nameIdx = h.indexOf('Campaign name');
    const cidIdx = h.indexOf('Campaign id');
    const accIdx = h.indexOf('Account name');
    const stIdx = h.indexOf('Campaign status');
    const bgIdx = h.indexOf('Budget');
    const costIdx = h.indexOf('Total Cost');
    const instIdx = h.indexOf('Mobile App Install');
    const cpiIdx = h.indexOf('CPI');
    const roasIdx = h.indexOf('ROAS');
    const r1Idx = h.indexOf('ROAS D-1');
    const revIdx = h.indexOf('Rev D0');
    const timeIdx = h.indexOf('Time kéo');
    const cpi1Idx = h.indexOf('CPI D-1');
    const ltv0Idx = h.indexOf('LTV D0');
    const bmIdx = h.indexOf('BM');

    for (let r = 1; r < vals.length; r++) {
      const row = vals[r];
      const dStr = normalizeDateStr(row[dIdx]);
      const cid = String(row[cidIdx] || '').trim();
      const sp = String(row[spIdx] || '').trim().toUpperCase();
      const rowEmail = String(row[emIdx] || '').trim().toLowerCase();
      if (!dStr || !cid) continue;

      if (targetEmail !== 'ALL') {
        if (rowEmail !== targetEmail) continue;
      }

      const key = dStr + '_' + cid;
      if (seenFbCamp[key]) continue;
      seenFbCamp[key] = true;

      if (!syncTimeStr && timeIdx !== -1 && row[timeIdx]) {
        syncTimeStr = String(row[timeIdx]).trim();
      }

      fbCampaigns.push({
        date: dStr,
        sp: sp,
        appName: ctx.appNamesMap[sp] || sp,
        marketer: ctx.marketerMap[sp] || '',
        cid: cid,
        name: String(row[nameIdx] || '').trim(),
        accountName: String(row[accIdx] || '').trim(),
        status: String(row[stIdx] || 'PAUSED').trim(),
        budget: parseFloat(row[bgIdx]) || 0,
        spend: parseFloat(row[costIdx]) || 0,
        installs: parseInt(row[instIdx], 10) || 0,
        cpi: parseFloat(row[cpiIdx]) || 0,
        roas: parseRoas(row[roasIdx]),
        roasD1: parseRoas(row[r1Idx]),
        rev: parseFloat(row[revIdx]) || 0,
        cpiD1: cpi1Idx !== -1 ? (parseFloat(row[cpi1Idx]) || 0) : 0,
        ltvD0: ltv0Idx !== -1 ? (parseFloat(row[ltv0Idx]) || 0) : 0,
        bm: bmIdx !== -1 ? String(row[bmIdx] || '').trim() : ''
      });
    }
  }

  // 3. Đọc Google Campaign (nếu có)
  const googleCampaigns = [];
  const seenGgCamp = {};
  const ggSheet = ss.getSheetByName('Google Campaign') || ss.getSheetByName('GG');
  if (ggSheet && ggSheet.getLastRow() > 1) {
    const vals = ggSheet.getDataRange().getValues();
    const h = vals[0];
    const dIdx = h.indexOf('Date');
    const spIdx = h.indexOf('Mã SP');
    const emIdx = h.indexOf('Email');
    const nameIdx = h.indexOf('Campaign');
    const cidIdx = h.indexOf('Campaign ID');
    const costIdx = h.indexOf('Cost');
    const instIdx = h.indexOf('FirstOpen');
    const cpuIdx = h.indexOf('CPU (USD)');
    const roasIdx = h.indexOf('ROAS');
    const r1Idx = h.indexOf('ROAS D-1');

    for (let r = 1; r < vals.length; r++) {
      const row = vals[r];
      const dStr = normalizeDateStr(row[dIdx]);
      const cid = String(row[cidIdx] || '').trim();
      const sp = String(row[spIdx] || '').trim().toUpperCase();
      const rowEmail = String(row[emIdx] || '').trim().toLowerCase();
      if (!dStr || !cid) continue;
      if (targetEmail !== 'ALL' && rowEmail !== targetEmail) continue;

      const key = dStr + '_' + cid;
      if (seenGgCamp[key]) continue;
      seenGgCamp[key] = true;

      const spend = parseFloat(row[costIdx]) || 0;
      const roas = parseRoas(row[roasIdx]);
      googleCampaigns.push({
        date: dStr,
        sp: sp,
        appName: ctx.appNamesMap[sp] || sp,
        cid: cid,
        name: String(row[nameIdx] || '').trim(),
        spend: spend,
        rev: spend * roas,
        installs: parseInt(row[instIdx], 10) || 0,
        cpi: parseFloat(row[cpuIdx]) || 0,
        roas: roas,
        roasD1: parseRoas(row[r1Idx])
      });
    }
  }

  // 4. Đọc Hourly (Lịch sử ROAS Hour-1 -> Hour-7)
  const hourlyList = [];
  const seenHourly = {};
  const hrSheet = ss.getSheetByName('Hourly');
  if (hrSheet && hrSheet.getLastRow() > 1) {
    const vals = hrSheet.getDataRange().getValues();
    const h = vals[0];
    const dIdx = h.indexOf('Date');
    const cidIdx = h.indexOf('Campaign id');
    const h1Idx = h.indexOf('Hour-1');
    if (dIdx !== -1 && cidIdx !== -1 && h1Idx !== -1) {
      for (let r = 1; r < vals.length; r++) {
        const row = vals[r];
        const dStr = normalizeDateStr(row[dIdx]);
        const cid = String(row[cidIdx] || '').trim();
        if (!dStr || !cid) continue;
        const key = dStr + '_' + cid;
        if (seenHourly[key]) continue;
        seenHourly[key] = true;
        hourlyList.push({
          date: dStr,
          cid: cid,
          hours: [
            parseRoas(row[h1Idx]),
            parseRoas(row[h1Idx + 1]),
            parseRoas(row[h1Idx + 2]),
            parseRoas(row[h1Idx + 3]),
            parseRoas(row[h1Idx + 4]),
            parseRoas(row[h1Idx + 5]),
            parseRoas(row[h1Idx + 6])
          ]
        });
      }
    }
  }

  // 5. Đọc FB Country (Giới hạn các dòng chi tiêu cao để load siêu nhanh)
  const fbCountries = [];
  const seenCountry = {};
  const ctrySheet = ss.getSheetByName('FB Country');
  if (ctrySheet && ctrySheet.getLastRow() > 1) {
    const maxRows = Math.min(ctrySheet.getLastRow(), 2500);
    const vals = ctrySheet.getRange(1, 1, maxRows, ctrySheet.getLastColumn()).getValues();
    const h = vals[0];
    const dIdx = h.indexOf('Date');
    const cidIdx = h.indexOf('Campaign id');
    const ccIdx = h.indexOf('Country');
    const costIdx = h.indexOf('Total Cost');
    const instIdx = h.indexOf('Mobile App Install');
    const roasIdx = h.indexOf('ROAS D0');
    const r1Idx = h.indexOf('ROAS D-1');
    const ltvIdx = h.indexOf('LTV D0');

    for (let r = 1; r < vals.length; r++) {
      const row = vals[r];
      const cid = String(row[cidIdx] || '').trim();
      const dStr = normalizeDateStr(row[dIdx]);
      if (!seenFbCamp[dStr + '_' + cid]) continue;
      const country = String(row[ccIdx] || '').trim();
      const key = dStr + '_' + cid + '_' + country;
      if (seenCountry[key]) continue;
      seenCountry[key] = true;

      fbCountries.push({
        date: dStr,
        cid: cid,
        country: country,
        spend: parseFloat(row[costIdx]) || 0,
        installs: parseInt(row[instIdx], 10) || 0,
        roasD0: parseRoas(row[roasIdx]),
        roasD1: parseRoas(row[r1Idx]),
        ltvD0: parseFloat(row[ltvIdx]) || 0
      });
    }
  }

  // 6. Đọc Lịch sử thao tác
  const actionLogs = [];
  const logSheet = ss.getSheetByName('Lịch sử thao tác');
  if (logSheet && logSheet.getLastRow() > 1) {
    const vals = logSheet.getDataRange().getValues();
    for (let r = vals.length - 1; r >= 1 && actionLogs.length < 60; r--) {
      const row = vals[r];
      const lEmail = String(row[1] || '').trim().toLowerCase();
      if (targetEmail !== 'ALL' && lEmail !== targetEmail) continue;
      actionLogs.push({
        time: String(row[0] || ''),
        email: lEmail,
        sp: String(row[2] || ''),
        cid: String(row[3] || ''),
        campaignName: String(row[4] || ''),
        action: String(row[5] || ''),
        detail: String(row[6] || '')
      });
    }
  }

  const props = PropertiesService.getScriptProperties();
  return {
    status: 'success',
    userEmail: userEmail,
    isAdmin: isAdmin,
    allUsers: ctx.allUsers,
    syncTime: syncTimeStr,
    lookerEmbedUrl: props.getProperty('LOOKER_EMBED_URL') || '',
    cutoff: cutoffList,
    fbCampaigns: fbCampaigns,
    googleCampaigns: googleCampaigns,
    fbCountries: fbCountries,
    hourly: hourlyList,
    actionLogs: actionLogs
  };
}

function getMetaTokensList(bmHint, customToken) {
  const tokens = [];
  function addTok(t) {
    const clean = String(t || '').trim();
    if (clean && tokens.indexOf(clean) === -1) tokens.push(clean);
  }

  if (customToken) addTok(customToken);

  const props = PropertiesService.getScriptProperties();
  addTok(props.getProperty('CUSTOM_FB_TOKEN'));

  try {
    const mapJson = props.getProperty('META_TOKENS_JSON');
    if (mapJson) {
      const parsed = JSON.parse(mapJson);
      if (bmHint) {
        const bmParts = String(bmHint).split(',').map(function(x) { return x.trim(); });
        bmParts.forEach(function(b) { if (parsed[b]) addTok(parsed[b]); });
      }
      Object.keys(parsed).forEach(function(k) { addTok(parsed[k]); });
    }
  } catch (e) {}

  addTok(props.getProperty('META_TOKEN_IH'));
  addTok(props.getProperty('META_TOKEN_BIGTHINK02'));
  addTok(props.getProperty('META_TOKEN_AG'));
  addTok(props.getProperty('META_TOKEN'));
  return tokens;
}

function toggleMetaCampaign(ss, data) {
  const email = String(data.email || '').trim().toLowerCase();
  const cid = String(data.campaign_id || '').trim();
  const campName = String(data.campaign_name || cid).trim();
  const sp = String(data.app_code || '').trim().toUpperCase();
  const newStatus = String(data.new_status || '').trim().toUpperCase();

  if (!cid || (newStatus !== 'ACTIVE' && newStatus !== 'PAUSED')) {
    return { status: 'error', message: 'Tham số campaign_id hoặc new_status không hợp lệ!' };
  }

  if (!checkUserCanControl(ss, email, sp, cid)) {
    return { status: 'error', message: '⛔ Email ' + email + ' không có quyền bật/tắt chiến dịch thuộc Mã SP ' + sp + '!' };
  }

  const tokens = getMetaTokensList(data.bm, data.custom_token);
  if (tokens.length === 0) {
    return { status: 'error', message: '⚠️ Chưa có Meta Access Token! Hãy chạy đồng bộ Cloud hoặc nhập Token trong phần ⚙️ Cấu hình.' };
  }

  let lastErr = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const url = 'https://graph.facebook.com/v21.0/' + encodeURIComponent(cid);
    try {
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        payload: { status: newStatus, access_token: token },
        muteHttpExceptions: true
      });
      const body = JSON.parse(res.getContentText() || '{}');
      if (res.getResponseCode() === 200 && body.success) {
        updateCampaignRowInSheets(ss, cid, newStatus, null);
        const logEntry = appendActionLog(ss, {
          email: email,
          sp: sp,
          cid: cid,
          campaignName: campName,
          action: newStatus === 'ACTIVE' ? 'BẬT (ON)' : 'TẮT (PAUSED)',
          detail: 'Đổi trạng thái chiến dịch sang ' + newStatus
        });
        return {
          status: 'success',
          campaign_id: cid,
          new_status: newStatus,
          logEntry: logEntry
        };
      } else {
        lastErr = (body.error && body.error.message) ? body.error.message : res.getContentText();
      }
    } catch (e) {
      lastErr = e.toString();
    }
  }

  return { status: 'error', message: 'Facebook API: ' + lastErr };
}

function updateMetaCampaignBudget(ss, data) {
  const email = String(data.email || '').trim().toLowerCase();
  const cid = String(data.campaign_id || '').trim();
  const campName = String(data.campaign_name || cid).trim();
  const sp = String(data.app_code || '').trim().toUpperCase();
  const newBudgetUsd = parseFloat(data.new_budget);
  const oldBudgetUsd = parseFloat(data.old_budget) || 0;

  if (!cid || isNaN(newBudgetUsd) || newBudgetUsd < 1 || newBudgetUsd > 5000) {
    return { status: 'error', message: 'Ngân sách phải nằm trong khoảng $1 - $5,000!' };
  }

  if (!checkUserCanControl(ss, email, sp, cid)) {
    return { status: 'error', message: '⛔ Email ' + email + ' không có quyền chỉnh ngân sách Mã SP ' + sp + '!' };
  }

  const tokens = getMetaTokensList(data.bm, data.custom_token);
  if (tokens.length === 0) {
    return { status: 'error', message: '⚠️ Chưa có Meta Access Token! Hãy chạy đồng bộ Cloud hoặc nhập Token trong phần ⚙️ Cấu hình.' };
  }

  const budgetCents = String(Math.round(newBudgetUsd * 100));
  let lastErr = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const url = 'https://graph.facebook.com/v21.0/' + encodeURIComponent(cid);
    try {
      // 1. Thử cập nhật trực tiếp ở cấp Campaign (CBO)
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        payload: { daily_budget: budgetCents, access_token: token },
        muteHttpExceptions: true
      });
      const body = JSON.parse(res.getContentText() || '{}');
      if (res.getResponseCode() === 200 && body.success) {
        updateCampaignRowInSheets(ss, cid, null, newBudgetUsd);
        const logEntry = appendActionLog(ss, {
          email: email,
          sp: sp,
          cid: cid,
          campaignName: campName,
          action: 'CHỈNH BUDGET',
          detail: '$' + oldBudgetUsd + ' ➔ $' + newBudgetUsd
        });
        return {
          status: 'success',
          campaign_id: cid,
          new_budget: newBudgetUsd,
          logEntry: logEntry
        };
      }

      // 2. Fallback tự động nếu là chiến dịch ABO (Ngân sách đặt ở nhóm quảng cáo Adset)
      const adsetsUrl = 'https://graph.facebook.com/v21.0/' + encodeURIComponent(cid) + '/adsets?fields=id,name,status,effective_status,daily_budget&limit=50&access_token=' + encodeURIComponent(token);
      const adsetsRes = UrlFetchApp.fetch(adsetsUrl, { muteHttpExceptions: true });
      const adsetsData = JSON.parse(adsetsRes.getContentText() || '{}');
      if (adsetsData.data && adsetsData.data.length > 0) {
        const allAdsets = adsetsData.data;
        const activeAdsets = allAdsets.filter(function(a) { return (a.effective_status || a.status) === 'ACTIVE'; });
        const targetAdsets = activeAdsets.length > 0 ? activeAdsets : allAdsets;
        const perAdsetCents = String(Math.max(100, Math.round((newBudgetUsd * 100) / targetAdsets.length)));
        let updatedCount = 0;
        for (let a = 0; a < targetAdsets.length; a++) {
          const asUrl = 'https://graph.facebook.com/v21.0/' + encodeURIComponent(targetAdsets[a].id);
          const asRes = UrlFetchApp.fetch(asUrl, {
            method: 'post',
            payload: { daily_budget: perAdsetCents, access_token: token },
            muteHttpExceptions: true
          });
          const asBody = JSON.parse(asRes.getContentText() || '{}');
          if (asRes.getResponseCode() === 200 && asBody.success) updatedCount++;
        }
        if (updatedCount > 0) {
          updateCampaignRowInSheets(ss, cid, null, newBudgetUsd);
          const logEntry = appendActionLog(ss, {
            email: email,
            sp: sp,
            cid: cid,
            campaignName: campName,
            action: 'CHỈNH BUDGET (ABO)',
            detail: '$' + oldBudgetUsd + ' ➔ $' + newBudgetUsd + ' (' + updatedCount + ' adsets)'
          });
          return {
            status: 'success',
            campaign_id: cid,
            new_budget: newBudgetUsd,
            logEntry: logEntry
          };
        }
      }

      lastErr = (body.error && body.error.message) ? body.error.message : res.getContentText();
    } catch (e) {
      lastErr = e.toString();
    }
  }

  return { status: 'error', message: 'Facebook API: ' + lastErr };
}

function updateCampaignRowInSheets(ss, cid, newStatus, newBudget) {
  const sheetNames = ['FB Campaign', 'Hourly'];
  sheetNames.forEach(function(sName) {
    const sh = ss.getSheetByName(sName);
    if (!sh || sh.getLastRow() <= 1) return;
    const vals = sh.getDataRange().getValues();
    const h = vals[0];
    const cidIdx = h.indexOf('Campaign id');
    const stIdx = h.indexOf('Campaign status');
    const bgIdx = h.indexOf('Budget');
    if (cidIdx === -1) return;

    for (let r = 1; r < vals.length; r++) {
      if (String(vals[r][cidIdx]).trim() === String(cid).trim()) {
        if (newStatus && stIdx !== -1) {
          sh.getRange(r + 1, stIdx + 1).setValue(newStatus);
        }
        if (newBudget !== null && newBudget !== undefined && bgIdx !== -1) {
          sh.getRange(r + 1, bgIdx + 1).setValue(newBudget);
        }
      }
    }
  });
}

function appendActionLog(ss, info) {
  let sh = ss.getSheetByName('Lịch sử thao tác');
  if (!sh) {
    sh = ss.insertSheet('Lịch sử thao tác');
    sh.getRange(1, 1, 1, 7).setValues([['Thời gian', 'Email thực hiện', 'Mã SP', 'Campaign ID', 'Campaign Name', 'Hành động', 'Chi tiết']])
      .setBackground('#1877F2').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const timeStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss');
  sh.appendRow([timeStr, info.email, info.sp, info.cid, info.campaignName, info.action, info.detail]);
  return {
    time: timeStr,
    email: info.email,
    sp: info.sp,
    cid: info.cid,
    campaignName: info.campaignName,
    action: info.action,
    detail: info.detail
  };
}

function openCampaignControlModal() {
  const html = renderDashboardHtmlOutput({}).setWidth(1240).setHeight(780);
  SpreadsheetApp.getUi().showModalDialog(html, '🎛️ Quản Lý Bật/Tắt Campaign & Ngân Sách (Live Control)');
}

// ==================== BỘ ĐIỀU KHIỂN & KÍCH HOẠT CLOUD CHUẨN 100% ====================

// 1. Tạo Menu điều khiển ngay trên thanh menu Google Sheet
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Đồng Bộ Ads')
    .addItem('🎛️ Mở Bảng Bật/Tắt Campaign & Chỉnh Budget', 'openCampaignControlModal')
    .addSeparator()
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


// ==================== GIAO DIỆN WEB APP NHÚNG TRỰC TIẾP ====================
function renderDashboardHtmlOutput(e) {
  let userEmail = "";
  try {
    userEmail = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  } catch (err) {}
  if (e && e.parameter && e.parameter.email) {
    userEmail = String(e.parameter.email).trim().toLowerCase();
  }
  let rawHtml = "<!DOCTYPE html>\n<html lang=\"vi\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>Ads Campaign Manager & Looker Studio Control Center</title>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n  <style>\n    :root {\n      --bg-page: #f8fafc;\n      --bg-card: #ffffff;\n      --bg-row-hover: #f5f9f2;\n      --bg-row-highlight: #f3f8ec;\n      --border-light: #eceef2;\n      --border-input: #d1d5db;\n      --text-main: #111827;\n      --text-secondary: #4b5563;\n      --text-muted: #9ca3af;\n      --green-toggle: #4caf50;\n      --green-badge-bg: #dcfce7;\n      --green-badge-text: #15803d;\n      --amber-badge-bg: #fef3c7;\n      --amber-badge-text: #b45309;\n      --red-badge-bg: #fee2e2;\n      --red-badge-text: #dc2626;\n      --up-green: #16a34a;\n      --down-red: #dc2626;\n      --primary: #2563eb;\n    }\n\n    * {\n      box-sizing: border-box;\n      margin: 0;\n      padding: 0;\n    }\n\n    body {\n      font-family: 'Inter', -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n      background-color: var(--bg-page);\n      color: var(--text-main);\n      font-size: 13.5px;\n      line-height: 1.45;\n      -webkit-font-smoothing: antialiased;\n    }\n\n    /* ==================== TOP BAR ==================== */\n    .topbar {\n      background: #ffffff;\n      border-bottom: 1px solid var(--border-light);\n      padding: 10px 18px;\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 12px;\n      flex-wrap: wrap;\n      position: sticky;\n      top: 0;\n      z-index: 100;\n      box-shadow: 0 1px 3px rgba(0,0,0,0.03);\n    }\n\n    body.embed-mode .topbar-brand {\n      display: none;\n    }\n\n    .topbar-left {\n      display: flex;\n      align-items: center;\n      gap: 14px;\n      flex-wrap: wrap;\n    }\n\n    .topbar-brand {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n      font-weight: 700;\n      font-size: 15px;\n      color: #0f172a;\n    }\n\n    .brand-dot {\n      width: 10px;\n      height: 10px;\n      border-radius: 50%;\n      background: #4caf50;\n      box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.2);\n    }\n\n    .nav-tabs {\n      display: inline-flex;\n      background: #f1f5f9;\n      padding: 3px;\n      border-radius: 8px;\n      gap: 2px;\n    }\n\n    .nav-tab {\n      border: none;\n      background: transparent;\n      padding: 6px 12px;\n      border-radius: 6px;\n      font-size: 12.5px;\n      font-weight: 600;\n      color: #475569;\n      cursor: pointer;\n      transition: all 0.15s;\n      display: inline-flex;\n      align-items: center;\n      gap: 6px;\n    }\n\n    .nav-tab.active {\n      background: #ffffff;\n      color: #0f172a;\n      box-shadow: 0 1px 2px rgba(0,0,0,0.06);\n    }\n\n    .topbar-right {\n      display: flex;\n      align-items: center;\n      gap: 10px;\n      flex-wrap: wrap;\n    }\n\n    /* ==================== FILTER BAR ==================== */\n    .filter-bar {\n      background: #ffffff;\n      border-bottom: 1px solid var(--border-light);\n      padding: 8px 18px;\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 12px;\n      flex-wrap: wrap;\n    }\n\n    .filter-group {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n      flex-wrap: wrap;\n    }\n\n    .control-input, .control-select {\n      height: 32px;\n      padding: 0 10px;\n      border: 1px solid #d1d5db;\n      border-radius: 6px;\n      font-size: 12.5px;\n      font-family: inherit;\n      color: #1f2937;\n      background: #ffffff;\n      outline: none;\n      transition: border-color 0.15s;\n    }\n\n    .control-input:focus, .control-select:focus {\n      border-color: #2563eb;\n      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);\n    }\n\n    .btn {\n      height: 32px;\n      padding: 0 12px;\n      border-radius: 6px;\n      font-size: 12.5px;\n      font-weight: 600;\n      font-family: inherit;\n      cursor: pointer;\n      border: 1px solid #d1d5db;\n      background: #ffffff;\n      color: #374151;\n      display: inline-flex;\n      align-items: center;\n      gap: 6px;\n      transition: all 0.15s;\n    }\n\n    .btn:hover {\n      background: #f9fafb;\n      border-color: #9ca3af;\n    }\n\n    .btn-primary {\n      background: #16a34a;\n      border-color: #16a34a;\n      color: #ffffff;\n    }\n\n    .btn-primary:hover {\n      background: #15803d;\n      border-color: #15803d;\n    }\n\n    .btn-blue {\n      background: #2563eb;\n      border-color: #2563eb;\n      color: #ffffff;\n    }\n\n    .btn-blue:hover {\n      background: #1d4ed8;\n    }\n\n    .user-pill {\n      display: inline-flex;\n      align-items: center;\n      gap: 6px;\n      padding: 4px 10px;\n      border-radius: 999px;\n      font-size: 12px;\n      font-weight: 600;\n      background: #eff6ff;\n      color: #1d4ed8;\n      border: 1px solid #bfdbfe;\n    }\n\n    .user-pill.admin {\n      background: #fef3c7;\n      color: #b45309;\n      border-color: #fde68a;\n    }\n\n    /* ==================== SUMMARY KPI CARDS ==================== */\n    .summary-strip {\n      display: flex;\n      align-items: center;\n      gap: 16px;\n      padding: 8px 18px;\n      background: #f8fafc;\n      border-bottom: 1px solid var(--border-light);\n      overflow-x: auto;\n      font-size: 12.5px;\n    }\n\n    .kpi-item {\n      display: flex;\n      align-items: center;\n      gap: 6px;\n      white-space: nowrap;\n      color: #4b5563;\n    }\n\n    .kpi-item strong {\n      color: #111827;\n      font-weight: 700;\n      font-variant-numeric: tabular-nums;\n    }\n\n    .kpi-divider {\n      width: 1px;\n      height: 16px;\n      background: #cbd5e1;\n    }\n\n    /* ==================== LOOKER EMBED CONTAINER ==================== */\n    .looker-panel {\n      display: none;\n      width: 100%;\n      background: #ffffff;\n      border-bottom: 2px solid #e2e8f0;\n    }\n\n    .looker-panel.visible {\n      display: block;\n    }\n\n    .looker-iframe {\n      width: 100%;\n      height: 540px;\n      border: none;\n      display: block;\n    }\n\n    .looker-panel.full-height .looker-iframe {\n      height: calc(100vh - 110px);\n    }\n\n    .looker-empty {\n      padding: 40px 20px;\n      text-align: center;\n      color: #64748b;\n    }\n\n    /* ==================== TREE TABLE (EXACT SCREENSHOT MATCH) ==================== */\n    .table-wrapper {\n      background: #ffffff;\n      width: 100%;\n      overflow-x: auto;\n      min-height: calc(100vh - 145px);\n    }\n\n    table.ads-tree-table {\n      width: 100%;\n      border-collapse: collapse;\n      table-layout: fixed;\n      min-width: 1180px;\n    }\n\n    table.ads-tree-table thead th {\n      position: sticky;\n      top: 0;\n      background: #f9fafb;\n      color: #4b5563;\n      font-weight: 600;\n      font-size: 12px;\n      text-transform: uppercase;\n      letter-spacing: 0.02em;\n      padding: 10px 12px;\n      border-bottom: 1px solid #e5e7eb;\n      text-align: right;\n      z-index: 20;\n      user-select: none;\n      cursor: pointer;\n    }\n\n    table.ads-tree-table thead th:first-child {\n      text-align: left;\n      width: 390px;\n      padding-left: 16px;\n    }\n\n    table.ads-tree-table thead th.col-toggle {\n      text-align: center;\n      width: 88px;\n    }\n\n    table.ads-tree-table thead th.col-budget {\n      text-align: center;\n      width: 136px;\n    }\n\n    table.ads-tree-table thead th.col-metric {\n      width: 92px;\n    }\n\n    table.ads-tree-table thead th.col-delta {\n      width: 68px;\n    }\n\n    table.ads-tree-table tbody tr {\n      border-bottom: 1px solid var(--border-light);\n      transition: background-color 0.1s;\n    }\n\n    table.ads-tree-table tbody tr:hover {\n      background-color: var(--bg-row-hover);\n    }\n\n    table.ads-tree-table tbody tr.row-app {\n      background-color: #ffffff;\n      font-weight: 700;\n    }\n\n    table.ads-tree-table tbody tr.row-app:hover {\n      background-color: #f8fafc;\n    }\n\n    table.ads-tree-table tbody tr.row-network {\n      background-color: #fcfdfd;\n      font-weight: 500;\n    }\n\n    table.ads-tree-table tbody tr.row-campaign {\n      background-color: #ffffff;\n    }\n\n    table.ads-tree-table tbody tr.row-campaign:hover {\n      background-color: var(--bg-row-highlight);\n    }\n\n    table.ads-tree-table tbody tr.row-country {\n      background-color: #f8fafc;\n      font-size: 12.5px;\n      color: #334155;\n    }\n\n    table.ads-tree-table tbody td {\n      padding: 9px 12px;\n      text-align: right;\n      vertical-align: middle;\n      font-variant-numeric: tabular-nums;\n      white-space: nowrap;\n      color: #111827;\n    }\n\n    table.ads-tree-table tbody td:first-child {\n      text-align: left;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      padding-left: 14px;\n    }\n\n    table.ads-tree-table tbody td.col-toggle,\n    table.ads-tree-table tbody td.col-budget {\n      text-align: center;\n    }\n\n    /* ==================== TREE NODE STYLING ==================== */\n    .tree-cell {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n      overflow: hidden;\n    }\n\n    .indent-1 { padding-left: 18px; }\n    .indent-2 { padding-left: 38px; }\n    .indent-3 { padding-left: 62px; }\n\n    .chevron-btn {\n      width: 20px;\n      height: 20px;\n      border: none;\n      background: transparent;\n      color: #6b7280;\n      cursor: pointer;\n      display: inline-flex;\n      align-items: center;\n      justify-content: center;\n      border-radius: 4px;\n      flex-shrink: 0;\n      transition: transform 0.15s, background-color 0.15s;\n    }\n\n    .chevron-btn:hover {\n      background: rgba(0, 0, 0, 0.06);\n      color: #111827;\n    }\n\n    .chevron-btn.expanded svg {\n      transform: rotate(90deg);\n    }\n\n    .sp-badge {\n      background: #f1f3f5;\n      color: #374151;\n      font-weight: 600;\n      font-size: 11.5px;\n      padding: 2px 7px;\n      border-radius: 5px;\n      letter-spacing: 0.01em;\n      flex-shrink: 0;\n      border: 1px solid #e5e7eb;\n    }\n\n    .app-title {\n      font-weight: 700;\n      color: #111827;\n      font-size: 13.5px;\n      overflow: hidden;\n      text-overflow: ellipsis;\n    }\n\n    .mkt-subbadge {\n      font-size: 11px;\n      font-weight: 500;\n      color: #6b7280;\n      background: #f9fafb;\n      padding: 1px 6px;\n      border-radius: 4px;\n      border: 1px solid #e5e7eb;\n      margin-left: 4px;\n      flex-shrink: 0;\n    }\n\n    .network-title {\n      font-weight: 500;\n      color: #1f2937;\n      font-size: 13.5px;\n      display: inline-flex;\n      align-items: center;\n      gap: 6px;\n    }\n\n    .camp-title {\n      font-weight: 400;\n      color: #1f2937;\n      font-size: 13px;\n      overflow: hidden;\n      text-overflow: ellipsis;\n    }\n\n    /* ==================== ON / OFF TOGGLE SWITCH (EXACT SCREENSHOT MATCH) ==================== */\n    .toggle-wrapper {\n      display: inline-flex;\n      align-items: center;\n      gap: 6px;\n      cursor: pointer;\n      user-select: none;\n    }\n\n    .toggle- wrapper.disabled {\n      opacity: 0.5;\n      pointer-events: none;\n    }\n\n    .switch-track {\n      width: 40px;\n      height: 22px;\n      border-radius: 999px;\n      background: #cbd5e1;\n      position: relative;\n      transition: background-color 0.2s;\n      flex-shrink: 0;\n    }\n\n    .switch-track.on {\n      background: var(--green-toggle);\n    }\n\n    .switch-thumb {\n      width: 16px;\n      height: 16px;\n      border-radius: 50%;\n      background: #ffffff;\n      position: absolute;\n      top: 3px;\n      left: 3px;\n      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);\n      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);\n    }\n\n    .switch-track.on .switch-thumb {\n      transform: translateX(18px);\n    }\n\n    .switch-label {\n      font-size: 12.5px;\n      font-weight: 500;\n      color: #64748b;\n      min-width: 20px;\n      text-align: left;\n    }\n\n    .switch-label.on {\n      color: #2e7d32;\n    }\n\n    /* ==================== BUDGET STEPPER [- $ 61 +] (EXACT SCREENSHOT MATCH) ==================== */\n    .budget-box {\n      display: inline-flex;\n      align-items: center;\n      border: 1px solid #d1d5db;\n      border-radius: 7px;\n      background: #ffffff;\n      height: 29px;\n      padding: 0 4px;\n      width: 112px;\n      justify-content: space-between;\n      transition: border-color 0.15s, box-shadow 0.15s;\n    }\n\n    .budget-box:focus-within {\n      border-color: #4caf50;\n      box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.15);\n    }\n\n    .budget-box.saving {\n      border-color: #f59e0b;\n      background: #fffbeb;\n    }\n\n    .budget-box.saved {\n      border-color: #22c55e;\n      background: #f0fdf4;\n    }\n\n    .budget-step-btn {\n      width: 22px;\n      height: 24px;\n      border: none;\n      background: transparent;\n      color: #6b7280;\n      font-size: 14px;\n      font-weight: 600;\n      cursor: pointer;\n      border-radius: 4px;\n      display: inline-flex;\n      align-items: center;\n      justify-content: center;\n      user-select: none;\n    }\n\n    .budget-step-btn:hover {\n      background: #f3f4f6;\n      color: #111827;\n    }\n\n    .budget-currency {\n      color: #6b7280;\n      font-size: 12.5px;\n      font-weight: 500;\n      margin-left: 1px;\n    }\n\n    .budget-input {\n      width: 48px;\n      border: none;\n      background: transparent;\n      text-align: right;\n      font-family: inherit;\n      font-size: 13px;\n      font-weight: 700;\n      color: #111827;\n      outline: none;\n      padding-right: 3px;\n      font-variant-numeric: tabular-nums;\n    }\n\n    .budget-input::-webkit-outer-spin-button,\n    .budget-input::-webkit-inner-spin-button {\n      -webkit-appearance: none;\n      margin: 0;\n    }\n\n    /* ==================== ROAS PILL & DELTA WITH DARK TOOLTIP ==================== */\n    .roas-pill {\n      display: inline-block;\n      padding: 3px 9px;\n      border-radius: 6px;\n      font-weight: 600;\n      font-size: 12.5px;\n      min-width: 60px;\n      text-align: center;\n    }\n\n    .roas-pill.good {\n      background-color: var(--green-badge-bg);\n      color: var(--green-badge-text);\n    }\n\n    .roas-pill.warn {\n      background-color: var(--amber-badge-bg);\n      color: var(--amber-badge-text);\n    }\n\n    .roas-pill.bad {\n      background-color: var(--red-badge-bg);\n      color: var(--red-badge-text);\n    }\n\n    .delta-badge {\n      display: inline-flex;\n      align-items: center;\n      gap: 1px;\n      font-size: 11.5px;\n      font-weight: 600;\n      position: relative;\n      cursor: default;\n      padding: 2px 3px;\n      border-radius: 4px;\n    }\n\n    .delta-badge.positive {\n      color: var(--up-green);\n    }\n\n    .delta-badge.negative {\n      color: var(--down-red);\n    }\n\n    .delta-badge.neutral {\n      color: var(--text-muted);\n    }\n\n    .delta-badge[data-tooltip]:hover::after {\n      content: attr(data-tooltip);\n      position: absolute;\n      bottom: calc(100% + 5px);\n      left: 50%;\n      transform: translateX(-50%);\n      background: #262626;\n      color: #ffffff;\n      font-size: 11.5px;\n      font-weight: 500;\n      padding: 5px 9px;\n      border-radius: 5px;\n      white-space: nowrap;\n      z-index: 99;\n      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.22);\n      pointer-events: none;\n    }\n\n    /* ==================== DRILLDOWN PANEL (COUNTRIES + HOURLY ROAS) ==================== */\n    .drilldown-box {\n      padding: 10px 18px 14px 62px;\n      background: #f8fafc;\n      border-top: 1px dashed #e2e8f0;\n    }\n\n    .hourly-strip {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n      margin-bottom: 8px;\n      flex-wrap: wrap;\n      font-size: 12px;\n    }\n\n    .hourly-chip {\n      background: #ffffff;\n      border: 1px solid #e2e8f0;\n      border-radius: 5px;\n      padding: 3px 8px;\n      color: #334155;\n      font-variant-numeric: tabular-nums;\n    }\n\n    /* ==================== MODAL & TOAST ==================== */\n    .modal-backdrop {\n      position: fixed;\n      inset: 0;\n      background: rgba(15, 23, 42, 0.45);\n      display: none;\n      align-items: center;\n      justify-content: center;\n      z-index: 300;\n      padding: 16px;\n    }\n\n    .modal-backdrop.open {\n      display: flex;\n    }\n\n    .modal-card {\n      background: #ffffff;\n      border-radius: 12px;\n      width: 100%;\n      max-width: 580px;\n      padding: 20px 24px;\n      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);\n    }\n\n    .modal-header {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      margin-bottom: 14px;\n      padding-bottom: 10px;\n      border-bottom: 1px solid #e5e7eb;\n    }\n\n    .modal-header h3 {\n      font-size: 16px;\n      font-weight: 700;\n    }\n\n    .form-row {\n      margin-bottom: 12px;\n    }\n\n    .form-row label {\n      display: block;\n      font-size: 12.5px;\n      font-weight: 600;\n      color: #374151;\n      margin-bottom: 4px;\n    }\n\n    .form-row input, .form-row textarea {\n      width: 100%;\n      padding: 8px 10px;\n      border: 1px solid #d1d5db;\n      border-radius: 6px;\n      font-size: 13px;\n      font-family: inherit;\n    }\n\n    .toast-container {\n      position: fixed;\n      bottom: 20px;\n      right: 20px;\n      z-index: 400;\n      display: flex;\n      flex-direction: column;\n      gap: 8px;\n    }\n\n    .toast {\n      background: #1e293b;\n      color: #ffffff;\n      padding: 10px 16px;\n      border-radius: 8px;\n      font-size: 13px;\n      font-weight: 500;\n      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);\n      display: flex;\n      align-items: center;\n      gap: 8px;\n      animation: slideIn 0.2s ease-out;\n    }\n\n    .toast.success { border-left: 4px solid #22c55e; }\n    .toast.error { border-left: 4px solid #ef4444; }\n    .toast.info { border-left: 4px solid #3b82f6; }\n\n    @keyframes slideIn {\n      from { transform: translateY(12px); opacity: 0; }\n      to { transform: translateY(0); opacity: 1; }\n    }\n  </style>\n</head>\n<body>\n\n  <!-- TOP NAVIGATION BAR -->\n  <header class=\"topbar\">\n    <div class=\"topbar-left\">\n      <div class=\"topbar-brand\">\n        <span class=\"brand-dot\"></span>\n        <span>Unisoft Ads Control & Looker Center</span>\n      </div>\n\n      <div class=\"nav-tabs\">\n        <button class=\"nav-tab active\" id=\"tabBtnControl\" onclick=\"switchViewMode('control')\">\n          🎛️ Quản lý Campaign & Budget\n        </button>\n        <button class=\"nav-tab\" id=\"tabBtnSplit\" onclick=\"switchViewMode('split')\">\n          ⚡ Looker + Điều khiển (Split View)\n        </button>\n        <button class=\"nav-tab\" id=\"tabBtnLooker\" onclick=\"switchViewMode('looker')\">\n          📊 Báo cáo Looker Studio\n        </button>\n        <button class=\"nav-tab\" id=\"tabBtnLogs\" onclick=\"switchViewMode('logs')\">\n          📜 Lịch sử thao tác\n        </button>\n      </div>\n    </div>\n\n    <div class=\"topbar-right\">\n      <div id=\"userRoleBadge\" class=\"user-pill\">\n        👤 Đang xác thực...\n      </div>\n\n      <!-- Admin Impersonation / View-As Filter -->\n      <select id=\"adminEmailSwitch\" class=\"control-select\" style=\"display:none;\" onchange=\"onAdminSwitchUser(this.value)\" title=\"Admin: Xem theo góc nhìn Marketer\">\n        <option value=\"ALL\">👑 Admin: Xem tất cả Marketer</option>\n      </select>\n\n      <button class=\"btn\" onclick=\"openSettingsModal()\" title=\"Cấu hình Webhook, Token Meta & Link Looker Studio\">\n        ⚙️ Cấu hình\n      </button>\n      <button class=\"btn btn-blue\" onclick=\"loadDashboardData(true)\">\n        🔄 Làm mới\n      </button>\n      <button class=\"btn btn-primary\" onclick=\"triggerCloudSyncNow()\" title=\"Kích hoạt GitHub Actions kéo số mới nhất từ Meta & Adjust\">\n        ⚡ Kéo số Cloud\n      </button>\n    </div>\n  </header>\n\n  <!-- FILTER BAR -->\n  <section class=\"filter-bar\" id=\"filterBarSection\">\n    <div class=\"filter-group\">\n      <label style=\"font-size:12px;font-weight:600;color:#4b5563;\">📅 Ngày:</label>\n      <select id=\"dateSelect\" class=\"control-select\" onchange=\"renderTreeTable()\"></select>\n\n      <input type=\"text\" id=\"searchInput\" class=\"control-input\" style=\"width:230px;\" placeholder=\"🔍 Tìm Mã SP, tên App, Campaign...\" oninput=\"renderTreeTable()\" />\n\n      <select id=\"statusFilter\" class=\"control-select\" onchange=\"renderTreeTable()\">\n        <option value=\"ALL\">Trạng thái: Tất cả</option>\n        <option value=\"ACTIVE\">🟢 Đang BẬT (ON)</option>\n        <option value=\"PAUSED\">⚪ Đang TẮT (OFF)</option>\n      </select>\n\n      <select id=\"roasFilter\" class=\"control-select\" onchange=\"renderTreeTable()\">\n        <option value=\"ALL\">Mọi mức ROAS</option>\n        <option value=\"HIGH\">🟢 ROAS ≥ 100% (Tốt - Tăng tốc)</option>\n        <option value=\"MID\">🟡 ROAS 70% - 100% (Theo dõi)</option>\n        <option value=\"LOW\">🔴 ROAS &lt; 70% (Kém - Cân nhắc tắt)</option>\n      </select>\n\n      <label style=\"font-size:12px;color:#4b5563;display:inline-flex;align-items:center;gap:4px;cursor:pointer;\">\n        <input type=\"checkbox\" id=\"chkExpandAll\" onchange=\"toggleExpandAll(this.checked)\" />\n        Mở rộng toàn bộ Campaign\n      </label>\n    </div>\n\n    <div class=\"filter-group\">\n      <span style=\"font-size:12px;color:#6b7280;\">Bước tăng/giảm nút <b>-/+</b>:</span>\n      <select id=\"budgetStepSelect\" class=\"control-select\" style=\"width:78px;\">\n        <option value=\"1\">$1</option>\n        <option value=\"2\">$2</option>\n        <option value=\"5\" selected>$5</option>\n        <option value=\"10\">$10</option>\n        <option value=\"20\">$20</option>\n      </select>\n    </div>\n  </section>\n\n  <!-- KPI SUMMARY BAR -->\n  <section class=\"summary-strip\" id=\"summaryStripSection\">\n    <div class=\"kpi-item\">Tổng App: <strong id=\"kpiApps\">0</strong></div>\n    <div class=\"kpi-divider\"></div>\n    <div class=\"kpi-item\">Chiến dịch: <strong id=\"kpiCamps\">0</strong> (<span style=\"color:#16a34a;font-weight:600;\" id=\"kpiActiveCamps\">0 ON</span>)</div>\n    <div class=\"kpi-divider\"></div>\n    <div class=\"kpi-item\">Tổng Chi Tiêu (Spend): <strong id=\"kpiSpend\">$0.00</strong></div>\n    <div class=\"kpi-divider\"></div>\n    <div class=\"kpi-item\">Tổng Doanh Thu D0 (Rev): <strong id=\"kpiRev\">$0.00</strong></div>\n    <div class=\"kpi-divider\"></div>\n    <div class=\"kpi-item\">ROAS D0 Trung Bình: <strong id=\"kpiRoas\">0.0%</strong></div>\n    <div class=\"kpi-divider\"></div>\n    <div class=\"kpi-item\">Tổng Installs: <strong id=\"kpiInstalls\">0</strong></div>\n    <div class=\"kpi-divider\"></div>\n    <div class=\"kpi-item\">CPI Trung Bình: <strong id=\"kpiCpi\">$0.000</strong></div>\n    <div class=\"kpi-divider\"></div>\n    <div class=\"kpi-item\" style=\"margin-left:auto;color:#64748b;\" id=\"lastSyncTimeLabel\">Cập nhật: --:--:--</div>\n  </section>\n\n  <!-- LOOKER STUDIO EMBED PANEL -->\n  <section id=\"lookerPanel\" class=\"looker-panel\">\n    <div id=\"lookerContainer\"></div>\n  </section>\n\n  <!-- MAIN HIERARCHICAL TREE TABLE -->\n  <main class=\"table-wrapper\" id=\"controlTableSection\">\n    <table class=\"ads-tree-table\">\n      <thead>\n        <tr>\n          <th onclick=\"setSort('name')\">Ứng dụng / Kênh / Chiến dịch</th>\n          <th class=\"col-toggle\">Bật / Tắt</th>\n          <th class=\"col-budget\">Budget (Ngày)</th>\n          <th class=\"col-metric\" onclick=\"setSort('spend')\">Chi tiêu ↓</th>\n          <th class=\"col-metric\" onclick=\"setSort('rev')\">Doanh thu D0</th>\n          <th class=\"col-metric\" onclick=\"setSort('roas')\">ROAS D0</th>\n          <th class=\"col-delta\" title=\"Thay đổi ROAS so với hôm qua (D-1)\">% ROAS</th>\n          <th class=\"col-metric\" onclick=\"setSort('installs')\">Installs</th>\n          <th class=\"col-metric\" onclick=\"setSort('cpi')\">CPI</th>\n          <th class=\"col-delta\" title=\"Thay đổi CPI so với hôm qua (D-1)\">% CPI</th>\n          <th class=\"col-metric\" onclick=\"setSort('ltv')\">LTV D0</th>\n        </tr>\n      </thead>\n      <tbody id=\"treeTableBody\">\n        <tr>\n          <td colspan=\"11\" style=\"text-align:center;padding:48px;color:#64748b;\">\n            ⏳ Đang tải dữ liệu chiến dịch & phân quyền từ Google Sheets...\n          </td>\n        </tr>\n      </tbody>\n    </table>\n  </main>\n\n  <!-- ACTION LOGS VIEW -->\n  <section class=\"table-wrapper\" id=\"logsTableSection\" style=\"display:none;padding:18px;\">\n    <h3 style=\"margin-bottom:12px;font-size:15px;\">📜 Nhật ký Bật/Tắt Campaign & Điều chỉnh Ngân sách</h3>\n    <table class=\"ads-tree-table\" style=\"min-width:900px;\">\n      <thead>\n        <tr>\n          <th style=\"width:160px;\">Thời gian</th>\n          <th style=\"width:200px;text-align:left;\">Email thực hiện</th>\n          <th style=\"width:90px;text-align:center;\">Mã SP</th>\n          <th style=\"width:280px;text-align:left;\">Chiến dịch (Campaign)</th>\n          <th style=\"width:140px;text-align:center;\">Hành động</th>\n          <th style=\"text-align:left;\">Chi tiết thay đổi</th>\n        </tr>\n      </thead>\n      <tbody id=\"logsTableBody\">\n        <tr><td colspan=\"6\" style=\"text-align:center;padding:30px;color:#64748b;\">Chưa có lịch sử thao tác nào.</td></tr>\n      </tbody>\n    </table>\n  </section>\n\n  <!-- SETTINGS & AUTH MODAL -->\n  <div class=\"modal-backdrop\" id=\"settingsModal\">\n    <div class=\"modal-card\">\n      <div class=\"modal-header\">\n        <h3>⚙️ Cấu hình Kết nối, Phân quyền & Looker Studio</h3>\n        <button class=\"btn\" onclick=\"closeSettingsModal()\">✕</button>\n      </div>\n\n      <div class=\"form-row\">\n        <label>📧 Email của bạn (Dùng để phân quyền Mã SP theo bảng Validate / PhanQuyen):</label>\n        <input type=\"email\" id=\"cfgUserEmail\" placeholder=\"vd: ductq@unisoftstudio.com hoặc quynhnn@unisoftstudio.com\" />\n        <small style=\"color:#6b7280;font-size:11.5px;\">Marketer chỉ thấy và chỉnh được Campaign thuộc Mã SP của mình. Admin xem và chỉnh được toàn bộ.</small>\n      </div>\n\n      <div class=\"form-row\">\n        <label>🔗 Google Apps Script Webhook URL (Sheet chính):</label>\n        <input type=\"text\" id=\"cfgWebhookUrl\" placeholder=\"https://script.google.com/macros/s/.../exec\" />\n      </div>\n\n      <div class=\"form-row\">\n        <label>📊 Link Nhúng Báo Cáo Looker Studio (Embed URL):</label>\n        <input type=\"text\" id=\"cfgLookerUrl\" placeholder=\"https://lookerstudio.google.com/embed/reporting/...\" />\n        <small style=\"color:#6b7280;font-size:11.5px;\">Trong Looker Studio: Bấm File ➔ Embed report (Nhúng báo cáo) ➔ Copy Embed URL dán vào đây.</small>\n      </div>\n\n      <div class=\"form-row\">\n        <label>🔑 Meta Access Token (Tùy chọn - Nếu muốn ghi đè trực tiếp từ trình duyệt):</label>\n        <input type=\"password\" id=\"cfgCustomFbToken\" placeholder=\"Để trống nếu đã đồng bộ tự động qua Cloud / Apps Script\" />\n      </div>\n\n      <div style=\"display:flex;justify-content:flex-end;gap:8px;margin-top:16px;\">\n        <button class=\"btn\" onclick=\"closeSettingsModal()\">Hủy</button>\n        <button class=\"btn btn-primary\" onclick=\"saveSettingsFromModal()\">💾 Lưu & Tải lại dữ liệu</button>\n      </div>\n    </div>\n  </div>\n\n  <div class=\"toast-container\" id=\"toastContainer\"></div>\n\n  <script>\n    // ==================== STATE & CONFIG ====================\n    const DEFAULT_WEBHOOK_URL = window.__APPS_SCRIPT_WEBHOOK_URL__ || localStorage.getItem('unisoft_webhook_url') || 'https://script.google.com/macros/s/AKfycby75UnIdHKTuRb8E3rAMTLws-nU22eag0JD95roKQWPi6CEvgYMEHz03Am0NVsjx5sQbg/exec';\n    const SERVER_DETECTED_EMAIL = window.__SERVER_USER_EMAIL__ || '';\n\n    let state = {\n      webhookUrl: localStorage.getItem('unisoft_webhook_url') || DEFAULT_WEBHOOK_URL,\n      userEmail: (SERVER_DETECTED_EMAIL || localStorage.getItem('unisoft_user_email') || 'ductq@unisoftstudio.com').toLowerCase().trim(),\n      adminFilterEmail: 'ALL',\n      lookerUrl: localStorage.getItem('unisoft_looker_url') || '',\n      customFbToken: localStorage.getItem('unisoft_custom_fb_token') || '',\n      isAdmin: false,\n      dates: [],\n      rawCutOff: [],\n      rawFbCampaigns: [],\n      rawGoogleCampaigns: [],\n      rawFbCountries: [],\n      rawHourly: [],\n      actionLogs: [],\n      expandedApps: new Set(),\n      expandedNetworks: new Set(),\n      expandedCampaigns: new Set(),\n      sortBy: 'spend',\n      sortDesc: true,\n      budgetTimers: {}\n    };\n\n    // Check URL params (for Looker Studio iframe embed mode)\n    const urlParams = new URLSearchParams(window.location.search);\n    if (urlParams.get('embed') === '1') {\n      document.body.classList.add('embed-mode');\n    }\n    if (urlParams.get('email')) {\n      state.userEmail = urlParams.get('email').toLowerCase().trim();\n      localStorage.setItem('unisoft_user_email', state.userEmail);\n    }\n    if (urlParams.get('webhook')) {\n      state.webhookUrl = urlParams.get('webhook').trim();\n      localStorage.setItem('unisoft_webhook_url', state.webhookUrl);\n    }\n\n    // ==================== FORMAT HELPERS ====================\n    function fmtCurrency(val, decimals = 2) {\n      const n = Number(val) || 0;\n      return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });\n    }\n\n    function fmtRoasPill(roasRatio) {\n      const pct = (Number(roasRatio) || 0) * 100;\n      let cls = 'bad';\n      if (pct >= 100) cls = 'good';\n      else if (pct >= 70) cls = 'warn';\n      return `<span class=\"roas-pill ${cls}\">${pct.toFixed(1)}%</span>`;\n    }\n\n    /**\n     * Hiển thị % thay đổi so với hôm qua (D-1) kèm Tooltip \"Hôm qua: 0.2639\" giống hệt ảnh mẫu\n     * @param {number} todayVal Giá trị hôm nay\n     * @param {number} yesterdayVal Giá trị hôm qua (D-1)\n     * @param {boolean} inverseColor Nếu là CPI: tăng (▲) là Đỏ (xấu), giảm (▼) là Xanh (tốt)\n     * @param {number} tooltipDecimals Số chữ số thập phân hiển thị trong tooltip\n     */\n    function fmtDelta(todayVal, yesterdayVal, inverseColor = false, tooltipDecimals = 4) {\n      const t = Number(todayVal) || 0;\n      const y = Number(yesterdayVal) || 0;\n      if (y <= 0 || t <= 0) {\n        return `<span class=\"delta-badge neutral\">-</span>`;\n      }\n      const diffPct = ((t - y) / y) * 100;\n      const absPct = Math.round(Math.abs(diffPct));\n      if (absPct === 0) {\n        return `<span class=\"delta-badge neutral\" data-tooltip=\"Hôm qua: ${y.toFixed(tooltipDecimals)}\">0%</span>`;\n      }\n      const isUp = diffPct > 0;\n      const arrow = isUp ? '▲' : '▼';\n      let colorClass = isUp ? 'positive' : 'negative';\n      if (inverseColor) {\n        colorClass = isUp ? 'negative' : 'positive';\n      }\n      const tooltipText = `Hôm qua: ${y.toFixed(tooltipDecimals)}`;\n      return `<span class=\"delta-badge ${colorClass}\" data-tooltip=\"${tooltipText}\">${arrow}${absPct}%</span>`;\n    }\n\n    function showToast(msg, type = 'info') {\n      const container = document.getElementById('toastContainer');\n      const el = document.createElement('div');\n      el.className = `toast ${type}`;\n      el.innerHTML = `<span>${msg}</span>`;\n      container.appendChild(el);\n      setTimeout(() => {\n        el.style.opacity = '0';\n        setTimeout(() => el.remove(), 250);\n      }, 3600);\n    }\n\n    function escapeHtml(str) {\n      return String(str || '')\n        .replace(/&/g, '&amp;')\n        .replace(/</g, '&lt;')\n        .replace(/>/g, '&gt;')\n        .replace(/\"/g, '&quot;');\n    }\n\n    // ==================== VIEW SWITCHING (LOOKER + CONTROL) ====================\n    function switchViewMode(mode) {\n      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));\n      const lookerPanel = document.getElementById('lookerPanel');\n      const controlSection = document.getElementById('controlTableSection');\n      const logsSection = document.getElementById('logsTableSection');\n      const filterBar = document.getElementById('filterBarSection');\n      const summaryStrip = document.getElementById('summaryStripSection');\n\n      lookerPanel.classList.remove('visible', 'full-height');\n      controlSection.style.display = 'none';\n      logsSection.style.display = 'none';\n      filterBar.style.display = 'flex';\n      summaryStrip.style.display = 'flex';\n\n      if (mode === 'control') {\n        document.getElementById('tabBtnControl').classList.add('active');\n        controlSection.style.display = 'block';\n      } else if (mode === 'split') {\n        document.getElementById('tabBtnSplit').classList.add('active');\n        lookerPanel.classList.add('visible');\n        controlSection.style.display = 'block';\n        renderLookerEmbed();\n      } else if (mode === 'looker') {\n        document.getElementById('tabBtnLooker').classList.add('active');\n        lookerPanel.classList.add('visible', 'full-height');\n        filterBar.style.display = 'none';\n        renderLookerEmbed();\n      } else if (mode === 'logs') {\n        document.getElementById('tabBtnLogs').classList.add('active');\n        logsSection.style.display = 'block';\n        filterBar.style.display = 'none';\n        renderActionLogs();\n      }\n    }\n\n    function renderLookerEmbed() {\n      const container = document.getElementById('lookerContainer');\n      if (!state.lookerUrl) {\n        container.innerHTML = `\n          <div class=\"looker-empty\">\n            <h3 style=\"margin-bottom:8px;color:#1e293b;\">📊 Chưa cấu hình đường dẫn nhúng Looker Studio</h3>\n            <p style=\"margin-bottom:14px;\">Bạn có thể dán link Looker Studio Embed vào phần <b>⚙️ Cấu hình</b> để xem trực tiếp báo cáo trên cùng màn hình này, hoặc nhúng bảng điều khiển này vào bên trong trang Looker Studio của bạn!</p>\n            <button class=\"btn btn-blue\" onclick=\"openSettingsModal()\">⚙️ Dán Link Looker Studio ngay</button>\n          </div>\n        `;\n        return;\n      }\n      if (!container.querySelector('iframe') || container.querySelector('iframe').src !== state.lookerUrl) {\n        container.innerHTML = `<iframe class=\"looker-iframe\" src=\"${escapeHtml(state.lookerUrl)}\" allowfullscreen></iframe>`;\n      }\n    }\n\n    // ==================== API CALLER (SUPPORTS LOCAL PYTHON SERVER + APPS SCRIPT) ====================\n    async function callApi(payload) {\n      // 1. If running inside Google Apps Script HtmlService\n      if (typeof google !== 'undefined' && google.script && google.script.run) {\n        return new Promise((resolve, reject) => {\n          google.script.run\n            .withSuccessHandler(res => resolve(typeof res === 'string' ? JSON.parse(res) : res))\n            .withFailureHandler(err => reject(err))\n            .handleClientApiRequest(JSON.stringify(payload));\n        });\n      }\n\n      // 2. If running via Local Python Control Server (/api)\n      if (window.location.protocol.startsWith('http') && window.location.port === '8505') {\n        const res = await fetch('/api', {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json' },\n          body: JSON.stringify({ ...payload, webhookUrl: state.webhookUrl })\n        });\n        return await res.json();\n      }\n\n      // 3. Direct call to Google Apps Script Webhook (using text/plain to avoid CORS preflight)\n      const res = await fetch(state.webhookUrl, {\n        method: 'POST',\n        headers: { 'Content-Type': 'text/plain;charset=utf-8' },\n        body: JSON.stringify(payload)\n      });\n      return await res.json();\n    }\n\n    // ==================== LOAD DASHBOARD DATA ====================\n    async function loadDashboardData(manual = false) {\n      try {\n        if (manual) showToast('🔄 Đang đồng bộ dữ liệu mới nhất...', 'info');\n        const targetEmail = (state.isAdmin && state.adminFilterEmail !== 'ALL') ? state.adminFilterEmail : state.userEmail;\n\n        const data = await callApi({\n          action: 'get_dashboard_data',\n          email: state.userEmail,\n          filterEmail: targetEmail\n        });\n\n        if (!data || data.status === 'error') {\n          throw new Error((data && data.message) || 'Không thể tải dữ liệu từ Webhook');\n        }\n\n        applyDashboardPayload(data);\n        if (manual) showToast('✅ Đã cập nhật số liệu mới nhất!', 'success');\n      } catch (err) {\n        console.error('Load error:', err);\n        // Fallback demo data if webhook hasn't been updated yet so user can immediately preview & test UI\n        if (!state.rawFbCampaigns || state.rawFbCampaigns.length === 0) {\n          loadPreviewFallbackData();\n          showToast('ℹ️ Đang hiển thị dữ liệu mẫu (Cập nhật Receiver_Webhook.js hoặc cấu hình Webhook để kết nối thật)', 'info');\n        } else {\n          showToast('⚠️ Lỗi tải dữ liệu: ' + err.message, 'error');\n        }\n      }\n    }\n\n    function applyDashboardPayload(data) {\n      state.isAdmin = Boolean(data.isAdmin);\n      if (data.lookerEmbedUrl && !state.lookerUrl) {\n        state.lookerUrl = data.lookerEmbedUrl;\n      }\n\n      // Update User Role Badge\n      const badge = document.getElementById('userRoleBadge');\n      if (state.isAdmin) {\n        badge.className = 'user-pill admin';\n        badge.innerHTML = `👑 Admin (${escapeHtml(state.userEmail)})`;\n        const sel = document.getElementById('adminEmailSwitch');\n        sel.style.display = 'inline-block';\n        const currentVal = sel.value;\n        sel.innerHTML = `<option value=\"ALL\">👑 Xem tất cả (${(data.allUsers || []).length} Marketer)</option>` +\n          (data.allUsers || []).map(u => `<option value=\"${escapeHtml(u)}\">👤 Xem như: ${escapeHtml(u)}</option>`).join('');\n        if (currentVal && Array.from(sel.options).some(o => o.value === currentVal)) {\n          sel.value = currentVal;\n        }\n      } else {\n        badge.className = 'user-pill';\n        badge.innerHTML = `👤 Marketer: ${escapeHtml(state.userEmail)}`;\n        document.getElementById('adminEmailSwitch').style.display = 'none';\n      }\n\n      state.rawCutOff = data.cutoff || [];\n      state.rawFbCampaigns = data.fbCampaigns || [];\n      state.rawGoogleCampaigns = data.googleCampaigns || [];\n      state.rawFbCountries = data.fbCountries || [];\n      state.rawHourly = data.hourly || [];\n      state.actionLogs = data.actionLogs || [];\n\n      // Collect unique dates\n      const dateSet = new Set();\n      state.rawFbCampaigns.forEach(r => { if (r.date) dateSet.add(r.date); });\n      state.rawCutOff.forEach(r => { if (r.date) dateSet.add(r.date); });\n      state.dates = Array.from(dateSet).sort().reverse();\n\n      const dateSel = document.getElementById('dateSelect');\n      const prevDate = dateSel.value;\n      dateSel.innerHTML = state.dates.map((d, idx) =>\n        `<option value=\"${d}\">${d}${idx === 0 ? ' (Hôm nay)' : (idx === 1 ? ' (Hôm qua)' : '')}</option>`\n      ).join('');\n      if (prevDate && state.dates.includes(prevDate)) {\n        dateSel.value = prevDate;\n      }\n\n      // Auto-expand top 2 apps on first load\n      if (state.expandedApps.size === 0 && state.rawFbCampaigns.length > 0) {\n        const firstSp = state.rawFbCampaigns[0].sp;\n        if (firstSp) {\n          state.expandedApps.add(firstSp);\n          state.expandedNetworks.add(`${firstSp}__Facebook`);\n        }\n      }\n\n      document.getElementById('lastSyncTimeLabel').textContent = `Cập nhật: ${data.syncTime || new Date().toLocaleTimeString('vi-VN')}`;\n      renderTreeTable();\n      renderActionLogs();\n    }\n\n    function onAdminSwitchUser(val) {\n      state.adminFilterEmail = val;\n      loadDashboardData(true);\n    }\n\n    // ==================== BUILD & RENDER HIERARCHICAL TREE TABLE ====================\n    function renderTreeTable() {\n      const selectedDate = document.getElementById('dateSelect').value || state.dates[0] || '';\n      const searchQ = (document.getElementById('searchInput').value || '').toLowerCase().trim();\n      const statusFilter = document.getElementById('statusFilter').value;\n      const roasFilter = document.getElementById('roasFilter').value;\n\n      // Determine yesterday date string for D-1 comparison at App/Network level\n      const dateIdx = state.dates.indexOf(selectedDate);\n      const yesterdayDate = (dateIdx >= 0 && dateIdx + 1 < state.dates.length) ? state.dates[dateIdx + 1] : '';\n\n      // 1. Group data by App (Mã SP)\n      const appsMap = {};\n\n      function ensureApp(sp, appName, marketer) {\n        if (!sp) sp = 'UNKNOWN';\n        if (!appsMap[sp]) {\n          appsMap[sp] = {\n            sp,\n            appName: appName || sp,\n            marketer: marketer || '',\n            spendToday: 0,\n            revToday: 0,\n            instToday: 0,\n            spendD1: 0,\n            revD1: 0,\n            instD1: 0,\n            networks: {\n              Facebook: { name: 'Facebook', spend: 0, rev: 0, inst: 0, spendD1: 0, revD1: 0, instD1: 0, campaigns: [] },\n              Google: { name: 'Google', spend: 0, rev: 0, inst: 0, spendD1: 0, revD1: 0, instD1: 0, campaigns: [] }\n            }\n          };\n        } else {\n          if (appName && (appsMap[sp].appName === sp || !appsMap[sp].appName)) {\n            appsMap[sp].appName = appName;\n          }\n          if (marketer && !appsMap[sp].marketer) {\n            appsMap[sp].marketer = marketer;\n          }\n        }\n        return appsMap[sp];\n      }\n\n      // Populate App names & CutOff info\n      state.rawCutOff.forEach(c => {\n        if (c.date === selectedDate || c.date === yesterdayDate) {\n          // Strip duplicate SP prefix from appName if present (e.g. \"AB148 Genie...\" -> \"Genie...\")\n          let cleanName = String(c.appName || '').trim();\n          if (cleanName.toUpperCase().startsWith(c.sp.toUpperCase())) {\n            cleanName = cleanName.slice(c.sp.length).replace(/^[\\s:\\-_]+/, '').trim();\n          }\n          ensureApp(c.sp, cleanName || c.appName, c.marketer);\n        }\n      });\n\n      // Populate Facebook Campaigns for selectedDate\n      const fbCampsToday = state.rawFbCampaigns.filter(c => c.date === selectedDate);\n      fbCampsToday.forEach(c => {\n        const appObj = ensureApp(c.sp, c.appName, c.marketer);\n        const net = appObj.networks.Facebook;\n\n        const spend = Number(c.spend) || 0;\n        const rev = Number(c.rev) || 0;\n        const inst = Number(c.installs) || 0;\n        const roas = spend > 0 ? (rev / spend) : (Number(c.roas) || 0);\n        const roasD1 = Number(c.roasD1) || 0;\n        const cpi = inst > 0 ? (spend / inst) : (Number(c.cpi) || 0);\n        const cpiD1 = Number(c.cpiD1) || 0;\n        const ltv = inst > 0 ? (rev / inst) : (Number(c.ltvD0) || 0);\n\n        net.spend += spend;\n        net.rev += rev;\n        net.inst += inst;\n\n        // Estimate D-1 network totals for accurate % delta\n        if (roasD1 > 0 && spend > 0) {\n          net.spendD1 += spend;\n          net.revD1 += spend * roasD1;\n        }\n        if (cpiD1 > 0 && inst > 0) {\n          net.instD1 += inst;\n        }\n\n        net.campaigns.push({\n          ...c,\n          spend,\n          rev,\n          installs: inst,\n          roas,\n          roasD1,\n          cpi,\n          cpiD1,\n          ltv\n        });\n      });\n\n      // Populate Google Campaigns if any\n      const ggCampsToday = state.rawGoogleCampaigns.filter(c => c.date === selectedDate);\n      ggCampsToday.forEach(c => {\n        const appObj = ensureApp(c.sp, c.appName, c.marketer);\n        const net = appObj.networks.Google;\n        const spend = Number(c.spend) || 0;\n        const rev = Number(c.rev) || 0;\n        const inst = Number(c.installs) || 0;\n        const roas = spend > 0 ? (rev / spend) : (Number(c.roas) || 0);\n        const cpi = inst > 0 ? (spend / inst) : (Number(c.cpi) || 0);\n        const ltv = inst > 0 ? (rev / inst) : 0;\n\n        net.spend += spend;\n        net.rev += rev;\n        net.inst += inst;\n        net.campaigns.push({\n          ...c,\n          isGoogle: true,\n          spend,\n          rev,\n          installs: inst,\n          roas,\n          roasD1: Number(c.roasD1) || 0,\n          cpi,\n          cpiD1: 0,\n          ltv\n        });\n      });\n\n      // Compute App-level totals from Networks / CutOff\n      Object.values(appsMap).forEach(app => {\n        const fb = app.networks.Facebook;\n        const gg = app.networks.Google;\n        app.spendToday = fb.spend + gg.spend;\n        app.revToday = fb.rev + gg.rev;\n        app.instToday = fb.inst + gg.inst;\n        app.roasToday = app.spendToday > 0 ? (app.revToday / app.spendToday) : 0;\n        app.cpiToday = app.instToday > 0 ? (app.spendToday / app.instToday) : 0;\n        app.ltvToday = app.instToday > 0 ? (app.revToday / app.instToday) : 0;\n\n        // D-1 from CutOff if available\n        const cutD1 = state.rawCutOff.find(r => r.date === yesterdayDate && r.sp === app.sp);\n        if (cutD1 && Number(cutD1.spend) > 0) {\n          app.roasD1 = Number(cutD1.roas) || (Number(cutD1.rev) / Number(cutD1.spend));\n          app.cpiD1 = Number(cutD1.installs) > 0 ? (Number(cutD1.spend) / Number(cutD1.installs)) : 0;\n        } else {\n          // Fallback weighted average from campaigns\n          const campsWithR1 = fb.campaigns.filter(x => x.roasD1 > 0);\n          app.roasD1 = campsWithR1.length > 0\n            ? campsWithR1.reduce((acc, x) => acc + x.roasD1 * x.spend, 0) / (campsWithR1.reduce((acc, x) => acc + x.spend, 0) || 1)\n            : 0;\n          const campsWithC1 = fb.campaigns.filter(x => x.cpiD1 > 0);\n          app.cpiD1 = campsWithC1.length > 0\n            ? campsWithC1.reduce((acc, x) => acc + x.cpiD1 * x.installs, 0) / (campsWithC1.reduce((acc, x) => acc + x.installs, 0) || 1)\n            : 0;\n        }\n\n        fb.roas = fb.spend > 0 ? (fb.rev / fb.spend) : 0;\n        fb.cpi = fb.inst > 0 ? (fb.spend / fb.inst) : 0;\n        fb.ltv = fb.inst > 0 ? (fb.rev / fb.inst) : 0;\n        fb.roasD1 = app.roasD1;\n        fb.cpiD1 = app.cpiD1;\n      });\n\n      // Filter Apps & Campaigns\n      let appList = Object.values(appsMap).filter(a => a.spendToday > 0 || a.revToday > 0 || a.networks.Facebook.campaigns.length > 0);\n\n      // Sort Apps\n      appList.sort((a, b) => {\n        const mult = state.sortDesc ? -1 : 1;\n        if (state.sortBy === 'name') return a.sp.localeCompare(b.sp) * mult;\n        if (state.sortBy === 'rev') return (a.revToday - b.revToday) * mult;\n        if (state.sortBy === 'roas') return (a.roasToday - b.roasToday) * mult;\n        if (state.sortBy === 'installs') return (a.instToday - b.instToday) * mult;\n        if (state.sortBy === 'cpi') return (a.cpiToday - b.cpiToday) * mult;\n        if (state.sortBy === 'ltv') return (a.ltvToday - b.ltvToday) * mult;\n        return (a.spendToday - b.spendToday) * mult;\n      });\n\n      // KPI Totals\n      let totalAppsShown = 0;\n      let totalCampsShown = 0;\n      let totalActiveCamps = 0;\n      let grandSpend = 0;\n      let grandRev = 0;\n      let grandInst = 0;\n\n      const htmlRows = [];\n\n      for (const app of appList) {\n        // Filter campaigns inside networks\n        const filteredFbCamps = app.networks.Facebook.campaigns.filter(c => {\n          const isOn = String(c.status).toUpperCase() === 'ACTIVE';\n          if (statusFilter === 'ACTIVE' && !isOn) return false;\n          if (statusFilter === 'PAUSED' && isOn) return false;\n\n          const roasPct = c.roas * 100;\n          if (roasFilter === 'HIGH' && roasPct < 100) return false;\n          if (roasFilter === 'MID' && (roasPct < 70 || roasPct >= 100)) return false;\n          if (roasFilter === 'LOW' && roasPct >= 70) return false;\n\n          if (searchQ) {\n            const hay = `${app.sp} ${app.appName} ${app.marketer} ${c.name} ${c.cid} ${c.accountName}`.toLowerCase();\n            if (!hay.includes(searchQ)) return false;\n          }\n          return true;\n        });\n\n        const filteredGgCamps = app.networks.Google.campaigns.filter(c => {\n          if (searchQ) {\n            const hay = `${app.sp} ${app.appName} ${c.name} ${c.cid}`.toLowerCase();\n            if (!hay.includes(searchQ)) return false;\n          }\n          return true;\n        });\n\n        if (filteredFbCamps.length === 0 && filteredGgCamps.length === 0) {\n          if (searchQ || statusFilter !== 'ALL' || roasFilter !== 'ALL') continue;\n        }\n\n        totalAppsShown++;\n        totalCampsShown += filteredFbCamps.length + filteredGgCamps.length;\n        totalActiveCamps += filteredFbCamps.filter(c => String(c.status).toUpperCase() === 'ACTIVE').length;\n        grandSpend += app.spendToday;\n        grandRev += app.revToday;\n        grandInst += app.instToday;\n\n        const isAppExpanded = state.expandedApps.has(app.sp) || Boolean(searchQ);\n\n        // ==================== ROW LEVEL 1: APP ROW ====================\n        htmlRows.push(`\n          <tr class=\"row-app\" onclick=\"toggleAppRow('${escapeHtml(app.sp)}')\" style=\"cursor:pointer;\">\n            <td>\n              <div class=\"tree-cell\">\n                <button class=\"chevron-btn ${isAppExpanded ? 'expanded' : ''}\" type=\"button\">\n                  <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\"><polyline points=\"9 18 15 12 9 6\"></polyline></svg>\n                </button>\n                <span class=\"sp-badge\">${escapeHtml(app.sp)}</span>\n                <span class=\"app-title\" title=\"${escapeHtml(app.appName)}\">${escapeHtml(app.appName)}</span>\n                ${app.marketer ? `<span class=\"mkt-subbadge\">${escapeHtml(app.marketer)}</span>` : ''}\n              </div>\n            </td>\n            <td class=\"col-toggle\"></td>\n            <td class=\"col-budget\"></td>\n            <td><strong>${fmtCurrency(app.spendToday, 2)}</strong></td>\n            <td><strong>${fmtCurrency(app.revToday, 2)}</strong></td>\n            <td>${fmtRoasPill(app.roasToday)}</td>\n            <td>${fmtDelta(app.roasToday, app.roasD1, false, 4)}</td>\n            <td><strong>${app.instToday.toLocaleString('en-US')}</strong></td>\n            <td><strong>${app.instToday > 0 ? fmtCurrency(app.cpiToday, 3) : '-'}</strong></td>\n            <td>${fmtDelta(app.cpiToday, app.cpiD1, true, 4)}</td>\n            <td><strong>${app.instToday > 0 ? fmtCurrency(app.ltvToday, 2) : '$0.00'}</strong></td>\n          </tr>\n        `);\n\n        if (!isAppExpanded) continue;\n\n        // ==================== ROW LEVEL 2: FACEBOOK NETWORK ====================\n        if (filteredFbCamps.length > 0 || app.networks.Facebook.spend > 0) {\n          const fb = app.networks.Facebook;\n          const netKey = `${app.sp}__Facebook`;\n          const isNetExpanded = state.expandedNetworks.has(netKey) || Boolean(searchQ);\n\n          htmlRows.push(`\n            <tr class=\"row-network\" onclick=\"toggleNetworkRow('${escapeHtml(netKey)}')\" style=\"cursor:pointer;\">\n              <td>\n                <div class=\"tree-cell indent-1\">\n                  <button class=\"chevron-btn ${isNetExpanded ? 'expanded' : ''}\" type=\"button\">\n                    <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\"><polyline points=\"9 18 15 12 9 6\"></polyline></svg>\n                  </button>\n                  <span class=\"network-title\">Facebook</span>\n                  <span style=\"font-size:11.5px;color:#9ca3af;\">(${filteredFbCamps.length})</span>\n                </div>\n              </td>\n              <td class=\"col-toggle\"></td>\n              <td class=\"col-budget\"></td>\n              <td>${fmtCurrency(fb.spend, 2)}</td>\n              <td>${fmtCurrency(fb.rev, 2)}</td>\n              <td>${fmtRoasPill(fb.roas)}</td>\n              <td>${fmtDelta(fb.roas, fb.roasD1, false, 4)}</td>\n              <td>${fb.inst.toLocaleString('en-US')}</td>\n              <td>${fb.inst > 0 ? fmtCurrency(fb.cpi, 3) : '-'}</td>\n              <td>${fmtDelta(fb.cpi, fb.cpiD1, true, 4)}</td>\n              <td>${fb.inst > 0 ? fmtCurrency(fb.ltv, 2) : '$0.00'}</td>\n            </tr>\n          `);\n\n          if (isNetExpanded) {\n            // Sort campaigns inside Facebook\n            filteredFbCamps.sort((a, b) => {\n              const mult = state.sortDesc ? -1 : 1;\n              if (state.sortBy === 'rev') return (a.rev - b.rev) * mult;\n              if (state.sortBy === 'roas') return (a.roas - b.roas) * mult;\n              if (state.sortBy === 'installs') return (a.installs - b.installs) * mult;\n              if (state.sortBy === 'cpi') return (a.cpi - b.cpi) * mult;\n              return (a.spend - b.spend) * mult;\n            });\n\n            // ==================== ROW LEVEL 3: CAMPAIGN ROWS ====================\n            for (const camp of filteredFbCamps) {\n              const isOn = String(camp.status).toUpperCase() === 'ACTIVE';\n              const isCampExpanded = state.expandedCampaigns.has(camp.cid);\n              const budgetVal = Math.round(Number(camp.budget) || 0);\n\n              htmlRows.push(`\n                <tr class=\"row-campaign\" id=\"camp-row-${escapeHtml(camp.cid)}\">\n                  <td>\n                    <div class=\"tree-cell indent-2\">\n                      <button class=\"chevron-btn ${isCampExpanded ? 'expanded' : ''}\" type=\"button\" onclick=\"toggleCampaignDrilldown('${escapeHtml(camp.cid)}')\" title=\"Xem chi tiết Quốc gia & Lịch sử ROAS theo giờ\">\n                        <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\"><polyline points=\"9 18 15 12 9 6\"></polyline></svg>\n                      </button>\n                      <span class=\"camp-title\" title=\"Campaign: ${escapeHtml(camp.name)}&#10;ID: ${escapeHtml(camp.cid)}&#10;Account: ${escapeHtml(camp.accountName)} (${escapeHtml(camp.bm || '')})\">\n                        ${escapeHtml(camp.name)}\n                      </span>\n                    </div>\n                  </td>\n\n                  <!-- ON/OFF TOGGLE SWITCH -->\n                  <td class=\"col-toggle\">\n                    <div class=\"toggle-wrapper\" id=\"toggle-wrap-${escapeHtml(camp.cid)}\" onclick=\"onToggleCampaign('${escapeHtml(camp.cid)}', '${escapeHtml(camp.sp)}', '${escapeHtml(camp.bm || '')}')\">\n                      <div class=\"switch-track ${isOn ? 'on' : ''}\" id=\"switch-track-${escapeHtml(camp.cid)}\">\n                        <div class=\"switch-thumb\"></div>\n                      </div>\n                      <span class=\"switch-label ${isOn ? 'on' : ''}\" id=\"switch-lbl-${escapeHtml(camp.cid)}\">${isOn ? 'on' : 'off'}</span>\n                    </div>\n                  </td>\n\n                  <!-- BUDGET STEPPER [- $ 61 +] -->\n                  <td class=\"col-budget\">\n                    <div class=\"budget-box\" id=\"budget-box-${escapeHtml(camp.cid)}\">\n                      <button type=\"button\" class=\"budget-step-btn\" onclick=\"stepCampaignBudget('${escapeHtml(camp.cid)}', -1)\" title=\"Giảm ngân sách\">−</button>\n                      <span class=\"budget-currency\">$</span>\n                      <input type=\"number\" class=\"budget-input\" id=\"budget-input-${escapeHtml(camp.cid)}\"\n                             value=\"${budgetVal}\" min=\"1\" max=\"5000\"\n                             onchange=\"onDirectBudgetChange('${escapeHtml(camp.cid)}')\"\n                             onkeydown=\"if(event.key==='Enter'){this.blur();}\" />\n                      <button type=\"button\" class=\"budget-step-btn\" onclick=\"stepCampaignBudget('${escapeHtml(camp.cid)}', 1)\" title=\"Tăng ngân sách\">+</button>\n                    </div>\n                  </td>\n\n                  <td>${fmtCurrency(camp.spend, 2)}</td>\n                  <td>${fmtCurrency(camp.rev, 2)}</td>\n                  <td>${fmtRoasPill(camp.roas)}</td>\n                  <td>${fmtDelta(camp.roas, camp.roasD1, false, 4)}</td>\n                  <td>${camp.installs.toLocaleString('en-US')}</td>\n                  <td>${camp.installs > 0 ? fmtCurrency(camp.cpi, 3) : '-'}</td>\n                  <td>${fmtDelta(camp.cpi, camp.cpiD1, true, 4)}</td>\n                  <td>${camp.installs > 0 ? fmtCurrency(camp.ltv, 2) : '$0.00'}</td>\n                </tr>\n              `);\n\n              // ==================== ROW LEVEL 4: COUNTRY & HOURLY DRILLDOWN ====================\n              if (isCampExpanded) {\n                const campCountries = state.rawFbCountries.filter(x => x.date === selectedDate && String(x.cid) === String(camp.cid));\n                const hourlyRow = state.rawHourly.find(x => x.date === selectedDate && String(x.cid) === String(camp.cid));\n\n                let hourlyHtml = '';\n                if (hourlyRow && hourlyRow.hours) {\n                  hourlyHtml = `\n                    <div class=\"hourly-strip\">\n                      <strong style=\"color:#334155;\">⏱️ Lịch sử ROAS theo giờ:</strong>\n                      <span class=\"hourly-chip\">Hiện tại: <b>${(camp.roas * 100).toFixed(1)}%</b></span>\n                      ${hourlyRow.hours.map((h, i) => `<span class=\"hourly-chip\">Hour-${i+1}: <b>${(Number(h)*100).toFixed(1)}%</b></span>`).join('')}\n                    </div>\n                  `;\n                }\n\n                if (hourlyHtml) {\n                  htmlRows.push(`\n                    <tr class=\"row-country\">\n                      <td colspan=\"11\" class=\"drilldown-box\">${hourlyHtml}</td>\n                    </tr>\n                  `);\n                }\n\n                if (campCountries.length > 0) {\n                  campCountries.slice(0, 15).forEach(cc => {\n                    const cSpend = Number(cc.spend) || 0;\n                    const cInst = Number(cc.installs) || 0;\n                    const cRoas = Number(cc.roasD0) || 0;\n                    const cRoasD1 = Number(cc.roasD1) || 0;\n                    const cRev = cSpend * cRoas;\n                    const cCpi = cInst > 0 ? (cSpend / cInst) : 0;\n                    const cLtv = Number(cc.ltvD0) || 0;\n\n                    htmlRows.push(`\n                      <tr class=\"row-country\">\n                        <td>\n                          <div class=\"tree-cell indent-3\">\n                            <span>🌍 ${escapeHtml(cc.country)}</span>\n                          </div>\n                        </td>\n                        <td class=\"col-toggle\"></td>\n                        <td class=\"col-budget\"></td>\n                        <td>${fmtCurrency(cSpend, 2)}</td>\n                        <td>${fmtCurrency(cRev, 2)}</td>\n                        <td>${fmtRoasPill(cRoas)}</td>\n                        <td>${fmtDelta(cRoas, cRoasD1, false, 4)}</td>\n                        <td>${cInst.toLocaleString('en-US')}</td>\n                        <td>${cInst > 0 ? fmtCurrency(cCpi, 3) : '-'}</td>\n                        <td><span class=\"delta-badge neutral\">-</span></td>\n                        <td>${fmtCurrency(cLtv, 2)}</td>\n                      </tr>\n                    `);\n                  });\n                } else if (!hourlyHtml) {\n                  htmlRows.push(`\n                    <tr class=\"row-country\">\n                      <td colspan=\"11\" style=\"text-align:left;padding-left:66px;color:#64748b;\">\n                        ℹ️ Tài khoản: <b>${escapeHtml(camp.accountName)}</b> | Campaign ID: <code>${escapeHtml(camp.cid)}</code>\n                      </td>\n                    </tr>\n                  `);\n                }\n              }\n            }\n          }\n        }\n\n        // ==================== ROW LEVEL 2: GOOGLE NETWORK ====================\n        if (filteredGgCamps.length > 0) {\n          const gg = app.networks.Google;\n          const netKey = `${app.sp}__Google`;\n          const isNetExpanded = state.expandedNetworks.has(netKey);\n\n          htmlRows.push(`\n            <tr class=\"row-network\" onclick=\"toggleNetworkRow('${escapeHtml(netKey)}')\" style=\"cursor:pointer;\">\n              <td>\n                <div class=\"tree-cell indent-1\">\n                  <button class=\"chevron-btn ${isNetExpanded ? 'expanded' : ''}\" type=\"button\">\n                    <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\"><polyline points=\"9 18 15 12 9 6\"></polyline></svg>\n                  </button>\n                  <span class=\"network-title\">Google Ads</span>\n                  <span style=\"font-size:11.5px;color:#9ca3af;\">(${filteredGgCamps.length})</span>\n                </div>\n              </td>\n              <td class=\"col-toggle\"></td>\n              <td class=\"col-budget\"></td>\n              <td>${fmtCurrency(gg.spend, 2)}</td>\n              <td>${fmtCurrency(gg.rev, 2)}</td>\n              <td>${fmtRoasPill(gg.spend > 0 ? gg.rev / gg.spend : 0)}</td>\n              <td><span class=\"delta-badge neutral\">-</span></td>\n              <td>${gg.inst.toLocaleString('en-US')}</td>\n              <td>${gg.inst > 0 ? fmtCurrency(gg.spend / gg.inst, 3) : '-'}</td>\n              <td><span class=\"delta-badge neutral\">-</span></td>\n              <td>${gg.inst > 0 ? fmtCurrency(gg.rev / gg.inst, 2) : '$0.00'}</td>\n            </tr>\n          `);\n\n          if (isNetExpanded) {\n            for (const gc of filteredGgCamps) {\n              htmlRows.push(`\n                <tr class=\"row-campaign\">\n                  <td>\n                    <div class=\"tree-cell indent-2\">\n                      <span style=\"width:20px;\"></span>\n                      <span class=\"camp-title\">${escapeHtml(gc.name)}</span>\n                    </div>\n                  </td>\n                  <td class=\"col-toggle\"><span style=\"font-size:11px;color:#9ca3af;\">Google</span></td>\n                  <td class=\"col-budget\"><span style=\"font-size:11px;color:#9ca3af;\">-</span></td>\n                  <td>${fmtCurrency(gc.spend, 2)}</td>\n                  <td>${fmtCurrency(gc.rev, 2)}</td>\n                  <td>${fmtRoasPill(gc.roas)}</td>\n                  <td>${fmtDelta(gc.roas, gc.roasD1, false, 4)}</td>\n                  <td>${gc.installs.toLocaleString('en-US')}</td>\n                  <td>${gc.installs > 0 ? fmtCurrency(gc.cpi, 3) : '-'}</td>\n                  <td><span class=\"delta-badge neutral\">-</span></td>\n                  <td>${gc.installs > 0 ? fmtCurrency(gc.ltv, 2) : '$0.00'}</td>\n                </tr>\n              `);\n            }\n          }\n        }\n      }\n\n      const tbody = document.getElementById('treeTableBody');\n      if (htmlRows.length === 0) {\n        tbody.innerHTML = `\n          <tr>\n            <td colspan=\"11\" style=\"text-align:center;padding:48px;color:#64748b;\">\n              Không có chiến dịch nào khớp với bộ lọc hoặc quyền truy cập của email <b>${escapeHtml(state.userEmail)}</b>.\n            </td>\n          </tr>\n        `;\n      } else {\n        tbody.innerHTML = htmlRows.join('');\n      }\n\n      // Update KPI Bar\n      const avgRoas = grandSpend > 0 ? (grandRev / grandSpend) * 100 : 0;\n      const avgCpi = grandInst > 0 ? (grandSpend / grandInst) : 0;\n      document.getElementById('kpiApps').textContent = totalAppsShown;\n      document.getElementById('kpiCamps').textContent = totalCampsShown;\n      document.getElementById('kpiActiveCamps').textContent = `${totalActiveCamps} ON`;\n      document.getElementById('kpiSpend').textContent = fmtCurrency(grandSpend, 2);\n      document.getElementById('kpiRev').textContent = fmtCurrency(grandRev, 2);\n      document.getElementById('kpiRoas').textContent = `${avgRoas.toFixed(1)}%`;\n      document.getElementById('kpiInstalls').textContent = grandInst.toLocaleString('en-US');\n      document.getElementById('kpiCpi').textContent = fmtCurrency(avgCpi, 3);\n    }\n\n    // ==================== TREE EXPAND / COLLAPSE HANDLERS ====================\n    function toggleAppRow(sp) {\n      if (state.expandedApps.has(sp)) {\n        state.expandedApps.delete(sp);\n      } else {\n        state.expandedApps.add(sp);\n        state.expandedNetworks.add(`${sp}__Facebook`);\n      }\n      renderTreeTable();\n    }\n\n    function toggleNetworkRow(netKey) {\n      if (state.expandedNetworks.has(netKey)) {\n        state.expandedNetworks.delete(netKey);\n      } else {\n        state.expandedNetworks.add(netKey);\n      }\n      renderTreeTable();\n    }\n\n    function toggleCampaignDrilldown(cid) {\n      if (state.expandedCampaigns.has(cid)) {\n        state.expandedCampaigns.delete(cid);\n      } else {\n        state.expandedCampaigns.add(cid);\n      }\n      renderTreeTable();\n    }\n\n    function toggleExpandAll(checked) {\n      state.expandedApps.clear();\n      state.expandedNetworks.clear();\n      if (checked) {\n        state.rawFbCampaigns.forEach(c => {\n          if (c.sp) {\n            state.expandedApps.add(c.sp);\n            state.expandedNetworks.add(`${c.sp}__Facebook`);\n          }\n        });\n      }\n      renderTreeTable();\n    }\n\n    function setSort(col) {\n      if (state.sortBy === col) {\n        state.sortDesc = !state.sortDesc;\n      } else {\n        state.sortBy = col;\n        state.sortDesc = true;\n      }\n      renderTreeTable();\n    }\n\n    // ==================== LIVE ACTIONS: TOGGLE CAMPAIGN ON/OFF ====================\n    async function onToggleCampaign(cid, sp, bm) {\n      const campObj = state.rawFbCampaigns.find(c => String(c.cid) === String(cid));\n      if (!campObj) return;\n\n      const currentlyOn = String(campObj.status).toUpperCase() === 'ACTIVE';\n      const targetStatus = currentlyOn ? 'PAUSED' : 'ACTIVE';\n\n      const trackEl = document.getElementById(`switch-track-${cid}`);\n      const lblEl = document.getElementById(`switch-lbl-${cid}`);\n      const wrapEl = document.getElementById(`toggle-wrap-${cid}`);\n\n      // Optimistic UI update\n      if (trackEl) trackEl.classList.toggle('on', targetStatus === 'ACTIVE');\n      if (lblEl) {\n        lblEl.classList.toggle('on', targetStatus === 'ACTIVE');\n        lblEl.textContent = targetStatus === 'ACTIVE' ? 'on' : 'off';\n      }\n      if (wrapEl) wrapEl.classList.add('disabled');\n\n      try {\n        const res = await callApi({\n          action: 'toggle_campaign',\n          email: state.userEmail,\n          campaign_id: cid,\n          campaign_name: campObj.name,\n          app_code: sp,\n          new_status: targetStatus,\n          bm: bm || campObj.bm || '',\n          custom_token: state.customFbToken\n        });\n\n        if (res && res.status === 'success') {\n          state.rawFbCampaigns.forEach(c => {\n            if (String(c.cid) === String(cid)) c.status = targetStatus;\n          });\n          showToast(\n            `${targetStatus === 'ACTIVE' ? '🟢 Đã BẬT (ON)' : '🛑 Đã TẮT (PAUSED)'} chiến dịch: ${campObj.name}`,\n            'success'\n          );\n          if (res.logEntry) state.actionLogs.unshift(res.logEntry);\n        } else {\n          throw new Error((res && res.message) || 'Facebook API từ chối yêu cầu');\n        }\n      } catch (err) {\n        // Revert UI on error\n        if (trackEl) trackEl.classList.toggle('on', currentlyOn);\n        if (lblEl) {\n          lblEl.classList.toggle('on', currentlyOn);\n          lblEl.textContent = currentlyOn ? 'on' : 'off';\n        }\n        showToast(`❌ Không thể đổi trạng thái: ${err.message}`, 'error');\n      } finally {\n        if (wrapEl) wrapEl.classList.remove('disabled');\n      }\n    }\n\n    // ==================== LIVE ACTIONS: STEP / EDIT CAMPAIGN BUDGET ====================\n    function stepCampaignBudget(cid, direction) {\n      const inputEl = document.getElementById(`budget-input-${cid}`);\n      if (!inputEl) return;\n      const step = Number(document.getElementById('budgetStepSelect').value) || 5;\n      const currentVal = Number(inputEl.value) || 0;\n      const nextVal = Math.max(1, Math.min(5000, currentVal + direction * step));\n      inputEl.value = nextVal;\n\n      // Debounce 550ms so rapid clicks on + / - send a single API request\n      if (state.budgetTimers[cid]) clearTimeout(state.budgetTimers[cid]);\n      const boxEl = document.getElementById(`budget-box-${cid}`);\n      if (boxEl) boxEl.classList.add('saving');\n\n      state.budgetTimers[cid] = setTimeout(() => {\n        commitCampaignBudget(cid, nextVal);\n      }, 550);\n    }\n\n    function onDirectBudgetChange(cid) {\n      const inputEl = document.getElementById(`budget-input-${cid}`);\n      if (!inputEl) return;\n      const nextVal = Math.max(1, Math.min(5000, Math.round(Number(inputEl.value) || 1)));\n      inputEl.value = nextVal;\n      if (state.budgetTimers[cid]) clearTimeout(state.budgetTimers[cid]);\n      commitCampaignBudget(cid, nextVal);\n    }\n\n    async function commitCampaignBudget(cid, newBudgetUsd) {\n      const campObj = state.rawFbCampaigns.find(c => String(c.cid) === String(cid));\n      if (!campObj) return;\n      const oldBudget = Number(campObj.budget) || 0;\n      if (Math.round(oldBudget) === Math.round(newBudgetUsd)) {\n        const boxEl = document.getElementById(`budget-box-${cid}`);\n        if (boxEl) boxEl.classList.remove('saving');\n        return;\n      }\n\n      const boxEl = document.getElementById(`budget-box-${cid}`);\n      if (boxEl) boxEl.classList.add('saving');\n\n      try {\n        const res = await callApi({\n          action: 'update_budget',\n          email: state.userEmail,\n          campaign_id: cid,\n          campaign_name: campObj.name,\n          app_code: campObj.sp,\n          old_budget: oldBudget,\n          new_budget: newBudgetUsd,\n          bm: campObj.bm || '',\n          custom_token: state.customFbToken\n        });\n\n        if (res && res.status === 'success') {\n          state.rawFbCampaigns.forEach(c => {\n            if (String(c.cid) === String(cid)) c.budget = newBudgetUsd;\n          });\n          if (boxEl) {\n            boxEl.classList.remove('saving');\n            boxEl.classList.add('saved');\n            setTimeout(() => boxEl.classList.remove('saved'), 1500);\n          }\n          showToast(`💰 Đã cập nhật Budget: $${oldBudget} ➔ $${newBudgetUsd} (${campObj.name})`, 'success');\n          if (res.logEntry) state.actionLogs.unshift(res.logEntry);\n        } else {\n          throw new Error((res && res.message) || 'Không thể cập nhật ngân sách trên Facebook');\n        }\n      } catch (err) {\n        if (boxEl) boxEl.classList.remove('saving');\n        const inputEl = document.getElementById(`budget-input-${cid}`);\n        if (inputEl) inputEl.value = Math.round(oldBudget);\n        showToast(`❌ Lỗi chỉnh Budget: ${err.message}`, 'error');\n      }\n    }\n\n    // ==================== ACTION LOGS RENDERER ====================\n    function renderActionLogs() {\n      const tbody = document.getElementById('logsTableBody');\n      if (!state.actionLogs || state.actionLogs.length === 0) {\n        tbody.innerHTML = `<tr><td colspan=\"6\" style=\"text-align:center;padding:30px;color:#64748b;\">Chưa có lịch sử thao tác nào.</td></tr>`;\n        return;\n      }\n      tbody.innerHTML = state.actionLogs.map(log => `\n        <tr>\n          <td style=\"text-align:left;color:#475569;\">${escapeHtml(log.time)}</td>\n          <td style=\"text-align:left;font-weight:600;\">${escapeHtml(log.email)}</td>\n          <td style=\"text-align:center;\"><span class=\"sp-badge\">${escapeHtml(log.sp)}</span></td>\n          <td style=\"text-align:left;\">${escapeHtml(log.campaignName)} <small style=\"color:#9ca3af;\">(${escapeHtml(log.cid)})</small></td>\n          <td style=\"text-align:center;\"><span class=\"roas-pill ${log.action.includes('PAUSE') ? 'bad' : 'good'}\">${escapeHtml(log.action)}</span></td>\n          <td style=\"text-align:left;\">${escapeHtml(log.detail)}</td>\n        </tr>\n      `).join('');\n    }\n\n    // ==================== TRIGGER GITHUB CLOUD SYNC ====================\n    async function triggerCloudSyncNow() {\n      try {\n        showToast('⚡ Đang gửi lệnh kéo số lên GitHub Actions Cloud...', 'info');\n        const res = await callApi({ action: 'trigger_cloud_sync', email: state.userEmail });\n        if (res && res.status === 'success') {\n          showToast('🚀 Đã kích hoạt kéo số Cloud! Dữ liệu sẽ tự cập nhật sau ~2 phút.', 'success');\n        } else {\n          showToast('⚠️ ' + ((res && res.message) || 'Không thể kích hoạt Cloud Sync'), 'error');\n        }\n      } catch (err) {\n        showToast('❌ Lỗi kích hoạt Cloud Sync: ' + err.message, 'error');\n      }\n    }\n\n    // ==================== SETTINGS MODAL ====================\n    function openSettingsModal() {\n      document.getElementById('cfgUserEmail').value = state.userEmail;\n      document.getElementById('cfgWebhookUrl').value = state.webhookUrl;\n      document.getElementById('cfgLookerUrl').value = state.lookerUrl;\n      document.getElementById('cfgCustomFbToken').value = state.customFbToken;\n      document.getElementById('settingsModal').classList.add('open');\n    }\n\n    function closeSettingsModal() {\n      document.getElementById('settingsModal').classList.remove('open');\n    }\n\n    async function saveSettingsFromModal() {\n      state.userEmail = (document.getElementById('cfgUserEmail').value || 'ductq@unisoftstudio.com').toLowerCase().trim();\n      state.webhookUrl = (document.getElementById('cfgWebhookUrl').value || DEFAULT_WEBHOOK_URL).trim();\n      state.lookerUrl = (document.getElementById('cfgLookerUrl').value || '').trim();\n      state.customFbToken = (document.getElementById('cfgCustomFbToken').value || '').trim();\n\n      localStorage.setItem('unisoft_user_email', state.userEmail);\n      localStorage.setItem('unisoft_webhook_url', state.webhookUrl);\n      localStorage.setItem('unisoft_looker_url', state.lookerUrl);\n      localStorage.setItem('unisoft_custom_fb_token', state.customFbToken);\n\n      try {\n        await callApi({\n          action: 'save_dashboard_settings',\n          email: state.userEmail,\n          lookerEmbedUrl: state.lookerUrl\n        });\n      } catch (e) {}\n\n      closeSettingsModal();\n      loadDashboardData(true);\n    }\n\n    // ==================== REALISTIC PREVIEW FALLBACK (MATCHING SCREENSHOT) ====================\n    function loadPreviewFallbackData() {\n      const today = new Date().toISOString().slice(0, 10);\n      applyDashboardPayload({\n        status: 'success',\n        isAdmin: true,\n        allUsers: ['ductq@unisoftstudio.com', 'quynhnn@unisoftstudio.com', 'trungtt@unisoftstudio.com', 'locnd@unisoftstudio.com', 'hannk@unisoftstudio.com', 'quyennh@unisoftstudio.com'],\n        syncTime: '10:05:00',\n        cutoff: [\n          { date: today, sp: 'AB307', appName: 'Home Design', marketer: 'DucTQ', spend: 47.23, rev: 19.05, roas: 0.4033, installs: 176 },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', spend: 46.85, rev: 68.64, roas: 1.4651, installs: 174 }\n        ],\n        fbCampaigns: [\n          { date: today, sp: 'AB307', appName: 'Home Design', marketer: 'DucTQ', cid: '120210001', name: 'AB307_HomeDesign_US_ROAS_12.10|01', accountName: 'AB307_Acc01', status: 'ACTIVE', budget: 50, spend: 47.23, rev: 19.05, roas: 0.4033, roasD1: 0.4384, installs: 176, cpi: 0.268, cpiD1: 0.1707, ltvD0: 0.108, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210101', name: 'AB028_Photo_Global_ROAS_10.10_mix|01', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 61, spend: 23.84, rev: 48.93, roas: 2.0524, roasD1: 1.1094, installs: 44, cpi: 0.542, cpiD1: 0.3817, ltvD0: 1.112, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210102', name: 'AB028_Photo_Global_ROAS_14.10_photo1310|01', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 10, spend: 3.67, rev: 3.21, roas: 0.8747, roasD1: 0.4395, installs: 16, cpi: 0.229, cpiD1: 0.3053, ltvD0: 0.201, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210103', name: 'AB028_Photo_US_ROAS_13.10_80s|02', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 8, spend: 3.52, rev: 0.00, roas: 0.0, roasD1: 0.0, installs: 1, cpi: 3.520, cpiD1: 1.294, ltvD0: 0.0, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210104', name: 'AB028_Photo_Global_ROAS_14.10_haloween', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 8, spend: 2.79, rev: 3.60, roas: 1.2903, roasD1: 0.3982, installs: 8, cpi: 0.349, cpiD1: 0.831, ltvD0: 0.450, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210105', name: 'AB028_Photo_Global_ROAS_14.10_photo1310|02', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 8, spend: 2.19, rev: 0.34, roas: 0.157, roasD1: 0.5815, installs: 5, cpi: 0.439, cpiD1: 0.271, ltvD0: 0.068, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210106', name: 'AB028_Photo_Global_ROAS_10.10_mix|02', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 13, spend: 1.93, rev: 2.76, roas: 1.429, roasD1: 0.638, installs: 16, cpi: 0.121, cpiD1: 0.263, ltvD0: 0.173, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210107', name: 'AB028_Photo_Global_ROAS_10.10_mix|03', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 6, spend: 1.76, rev: 0.14, roas: 0.081, roasD1: 0.506, installs: 7, cpi: 0.251, cpiD1: 0.0877, ltvD0: 0.020, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210108', name: 'AB028_Photo_Global_ROAS_14.10_photo1310|03', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 8, spend: 1.68, rev: 1.15, roas: 0.6845, roasD1: 0.2639, installs: 42, cpi: 0.040, cpiD1: 0.0714, ltvD0: 0.027, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210109', name: 'AB028_Photo_US_ROAS_13.10_mix|01', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 6, spend: 1.49, rev: 0.00, roas: 0.0, roasD1: 0.0, installs: 0, cpi: 0.0, cpiD1: 0.0, ltvD0: 0.0, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210110', name: 'AB028_Photo_Global_ROAS_9.10_80s|02', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 6, spend: 1.22, rev: 3.02, roas: 2.478, roasD1: 0.339, installs: 9, cpi: 0.136, cpiD1: 0.128, ltvD0: 0.336, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210111', name: 'AB028_Photo_Global_ROAS_10.10_mix|04', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 6, spend: 1.21, rev: 2.63, roas: 2.175, roasD1: 0.686, installs: 13, cpi: 0.093, cpiD1: 0.0949, ltvD0: 0.202, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210112', name: 'AB028_Photo_Global_ROAS_9.10_80s|01', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 6, spend: 1.17, rev: 0.20, roas: 0.173, roasD1: 0.219, installs: 11, cpi: 0.106, cpiD1: 0.0706, ltvD0: 0.018, bm: 'BM_IH' },\n          { date: today, sp: 'AB028', appName: 'AI Photo Lab: Art Creator', marketer: 'QuynhNN', cid: '120210113', name: 'AB028_Photo_Global_ROAS_10.10_mix|05', accountName: 'AB028_Acc01', status: 'ACTIVE', budget: 6, spend: 0.37, rev: 1.64, roas: 4.422, roasD1: 0.321, installs: 2, cpi: 0.185, cpiD1: 0.0569, ltvD0: 0.820, bm: 'BM_IH' }\n        ],\n        fbCountries: [\n          { date: today, cid: '120210101', country: 'United States', spend: 14.20, installs: 21, roasD0: 2.35, roasD1: 1.20, ltvD0: 1.58 },\n          { date: today, cid: '120210101', country: 'Germany', spend: 5.40, installs: 12, roasD0: 1.82, roasD1: 1.05, ltvD0: 0.82 },\n          { date: today, cid: '120210101', country: 'Japan', spend: 4.24, installs: 11, roasD0: 1.35, roasD1: 0.98, ltvD0: 0.52 }\n        ],\n        hourly: [\n          { date: today, cid: '120210101', hours: [1.92, 1.85, 1.74, 1.60, 1.48, 1.30, 1.15] }\n        ],\n        actionLogs: []\n      });\n      state.expandedApps.add('AB028');\n      state.expandedNetworks.add('AB028__Facebook');\n      renderTreeTable();\n    }\n\n    // Boot\n    window.addEventListener('DOMContentLoaded', () => {\n      loadDashboardData(false);\n    });\n  </script>\n</body>\n</html>\n";
  const injectScript = "<script>window.__SERVER_USER_EMAIL__ = " + JSON.stringify(userEmail) + ";</script><!-- Web App Receiver đang hoạt động tốt! -->";
  rawHtml = rawHtml.replace("</head>", injectScript + "</head>");
  return HtmlService.createHtmlOutput(rawHtml)
    .setTitle("Unisoft Ads Control & Looker Studio Center")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
