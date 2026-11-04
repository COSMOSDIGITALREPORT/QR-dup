const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const YOY_HEADERS = [
  'Packet ID',
  'Crop',
  'Location',
  'Year',
  'Previous Year',
  'Previous Location',
  'Gean',
  'Comments',
  'Status',
  'Before',
  'After',
  'Before Photo',
  'After Photo',
  'Operator',
  'Weighed',
];

const COLUMN_WIDTHS = [
  18, // 1: Packet ID
  15, // 2: Crop
  16, // 3: Location
  12, // 4: Year
  16, // 5: Previous Year
  20, // 6: Previous Location
  12, // 7: Gean
  24, // 8: Comments
  14, // 9: Status
  14, // 10: Before
  14, // 11: After
  32, // 12: Before Photo
  32, // 13: After Photo
  16, // 14: Operator
  24, // 15: Weighed
];

const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

const THIN_BORDER = {
  top:    { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left:   { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right:  { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

function formatPacketValues(p) {
  const packetId = String(p.packetId || p.uniqueId || '').trim();
  const crop = String(p.crop || '').trim();
  const location = String(p.location || p.locationCode || '').trim();

  let year = '';
  if (p.year !== null && p.year !== undefined && p.year !== '') {
    const n = Number(p.year);
    year = Number.isFinite(n) ? n : String(p.year).trim();
  }

  let previousYear = '';
  if (p.previousYear !== null && p.previousYear !== undefined && p.previousYear !== '') {
    const n = Number(p.previousYear);
    previousYear = Number.isFinite(n) ? n : String(p.previousYear).trim();
  }

  const previousLocation = String(p.previousLocation || p.previousLocationCode || '').trim();
  const gean = String(p.gean !== null && p.gean !== undefined ? p.gean : (p.gene || '')).trim();
  const comments = String(p.comments || '').trim();
  const status = String(p.status || 'empty').trim();

  let before = null;
  const rawBefore = p.before !== undefined && p.before !== null ? p.before : p.beforeWeight;
  if (rawBefore !== undefined && rawBefore !== null && rawBefore !== '') {
    const n = Number(rawBefore);
    if (Number.isFinite(n)) before = n;
  }

  let after = null;
  const rawAfter = p.after !== undefined && p.after !== null ? p.after : p.afterWeight;
  if (rawAfter !== undefined && rawAfter !== null && rawAfter !== '') {
    const n = Number(rawAfter);
    if (Number.isFinite(n)) after = n;
  }

  const beforePhoto = String(p.beforePhoto || p.beforePhotoUrl || '').trim();
  const afterPhoto = String(p.afterPhoto || p.afterPhotoUrl || '').trim();
  const operator = String(p.operator ? (typeof p.operator === 'object' ? p.operator.name || '' : p.operator) : '').trim();
  const weighed = String(p.weighed || (p.linkedAt ? new Date(p.linkedAt).toLocaleString() : '')).trim();

  return [
    packetId,
    crop,
    location,
    year,
    previousYear,
    previousLocation,
    gean,
    comments,
    status,
    before !== null ? before : '',
    after !== null ? after : '',
    beforePhoto,
    afterPhoto,
    operator,
    weighed,
  ];
}

function applyCellStyles(row, isHeader = false) {
  for (let col = 1; col <= YOY_HEADERS.length; col++) {
    const cell = row.getCell(col);
    cell.border = THIN_BORDER;

    if (isHeader) {
      cell.font = { name: 'Times New Roman', size: 12, bold: true, color: { argb: 'FF0F172A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    } else {
      cell.font = { name: 'Times New Roman', size: 12, bold: false };

      // Specific column alignments & number formats
      if (col === 1 || col === 3 || col === 4 || col === 5 || col === 6 || col === 7 || col === 9 || col === 15) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (col === 10 || col === 11) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        if (typeof cell.value === 'number') {
          cell.numFmt = '0.000';
        }
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    }
  }
}

function createYoyWorkbookWriter({ filePath, dir }) {
  const targetPath = filePath || (dir ? path.join(dir, 'YOY.xlsx') : (fs.existsSync('D:\\dapatri argo\\YOY.xlsx') ? 'D:\\dapatri argo\\YOY.xlsx' : path.join(process.cwd(), 'YOY.xlsx')));
  const backupPath = targetPath.replace(/\.xlsx$/i, '.backup.xlsx');

  async function write(packets = [], deletedPacketIds = []) {
    let existingPacketsMap = new Map();

    // 1. Read existing workbook if present to preserve any extra offline rows
    if (fs.existsSync(targetPath)) {
      try {
        const existingBook = new ExcelJS.Workbook();
        await existingBook.xlsx.readFile(targetPath);
        const existingSheet = existingBook.getWorksheet('Sheet1') || existingBook.worksheets[0];
        if (existingSheet && existingSheet.rowCount > 1) {
          const header4 = String(existingSheet.getRow(1).getCell(4).value || '').trim().toLowerCase();
          const isLegacy10 = header4 === 'status';

          existingSheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const pktId = String(row.getCell(1).value || '').trim();
            if (!pktId) return;

            if (isLegacy10) {
              // Legacy 10-column layout
              existingPacketsMap.set(pktId, {
                packetId: pktId,
                crop: row.getCell(2).value,
                location: row.getCell(3).value,
                year: '',
                previousYear: '',
                previousLocation: '',
                gean: '',
                comments: '',
                status: row.getCell(4).value,
                before: row.getCell(5).value,
                after: row.getCell(6).value,
                beforePhoto: row.getCell(7).value,
                afterPhoto: row.getCell(8).value,
                operator: row.getCell(9).value,
                weighed: row.getCell(10).value,
              });
            } else {
              // 15-column layout
              existingPacketsMap.set(pktId, {
                packetId: pktId,
                crop: row.getCell(2).value,
                location: row.getCell(3).value,
                year: row.getCell(4).value,
                previousYear: row.getCell(5).value,
                previousLocation: row.getCell(6).value,
                gean: row.getCell(7).value,
                comments: row.getCell(8).value,
                status: row.getCell(9).value,
                before: row.getCell(10).value,
                after: row.getCell(11).value,
                beforePhoto: row.getCell(12).value,
                afterPhoto: row.getCell(13).value,
                operator: row.getCell(14).value,
                weighed: row.getCell(15).value,
              });
            }
          });
        }
      } catch (readErr) {
        if (BUSY_CODES.has(readErr.code)) {
          const busy = new Error('YOY.xlsx is open in another program. Please close Excel and click Sync Now.');
          busy.busy = true;
          throw busy;
        }
        // If file is unreadable, proceed with fresh workbook
      }
    }

    // 2. Overlay / Merge verified incoming packets from MongoDB
    let inserted = 0;
    let updated = 0;

    for (const p of packets) {
      const pid = String(p.packetId || p.uniqueId || '').trim();
      if (!pid) continue;
      if (existingPacketsMap.has(pid)) {
        updated++;
      } else {
        inserted++;
      }
      existingPacketsMap.set(pid, p);
    }

    // 2b. Remove deleted packets confirmed on backend
    if (Array.isArray(deletedPacketIds) && deletedPacketIds.length > 0) {
      for (const delId of deletedPacketIds) {
        if (!delId) continue;
        const cleanId = String(delId).trim();
        existingPacketsMap.delete(cleanId);
      }
    }

    // 3. Rebuild fresh workbook cleanly with frozen headers and correct columns
    const book = new ExcelJS.Workbook();
    book.creator = 'Seed Management Desktop';
    const sheet = book.addWorksheet('Sheet1', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = YOY_HEADERS.map((header, idx) => ({
      header,
      key: header,
      width: COLUMN_WIDTHS[idx] || 16,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.height = 26;
    for (let c = 1; c <= YOY_HEADERS.length; c++) {
      headerRow.getCell(c).value = YOY_HEADERS[c - 1];
    }
    applyCellStyles(headerRow, true);
    headerRow.commit();

    // 4. Add data rows (preserve existing order, new records appended)
    const allRecords = Array.from(existingPacketsMap.values());

    for (const record of allRecords) {
      const rowValues = formatPacketValues(record);
      const newRow = sheet.addRow(rowValues);
      newRow.height = 22;
      applyCellStyles(newRow, false);
      newRow.commit();
    }

    // 5. Add AutoFilter across row 1
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: YOY_HEADERS.length },
    };

    // 6. Safe atomic write: write to .tmp, then backup, then rename
    const tmpPath = `${targetPath}.tmp`;
    const targetDir = path.dirname(targetPath);
    fs.mkdirSync(targetDir, { recursive: true });

    try {
      await book.xlsx.writeFile(tmpPath);
    } catch (writeErr) {
      if (BUSY_CODES.has(writeErr.code)) {
        const busy = new Error('YOY.xlsx is open in another program. Please close Excel and click Sync Now.');
        busy.busy = true;
        throw busy;
      }
      throw writeErr;
    }

    try {
      if (fs.existsSync(targetPath)) {
        try { fs.copyFileSync(targetPath, backupPath); } catch (_) {}
      }
      fs.renameSync(tmpPath, targetPath);
    } catch (renameErr) {
      try { fs.rmSync(tmpPath, { force: true }); } catch (_) {}
      if (BUSY_CODES.has(renameErr.code)) {
        const busy = new Error('YOY.xlsx is open in another program. Please close Excel and click Sync Now.');
        busy.busy = true;
        throw busy;
      }
      throw renameErr;
    }

    return {
      written: true,
      filePath: targetPath,
      rows: allRecords.length,
      inserted,
      updated,
    };
  }

  return {
    filePath: targetPath,
    backupPath,
    write,
  };
}

module.exports = {
  createYoyWorkbookWriter,
  YOY_HEADERS,
  COLUMN_WIDTHS,
  formatPacketValues,
};
