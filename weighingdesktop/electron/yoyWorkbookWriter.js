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

const COLUMN_WIDTHS = [15, 13, 15, 12, 14, 18, 12, 20, 17, 23, 13, 15, 18, 13, 13];

const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function createYoyWorkbookWriter({ filePath, dir }) {
  const targetPath = filePath || (dir ? path.join(dir, 'YOY.xlsx') : (fs.existsSync('D:\\dapatri argo\\YOY.xlsx') ? 'D:\\dapatri argo\\YOY.xlsx' : path.join(process.cwd(), 'YOY.xlsx')));
  const backupPath = targetPath.replace(/\.xlsx$/i, '.backup.xlsx');

  async function write(packets = []) {
    let book = new ExcelJS.Workbook();
    let sheet;

    const fileExists = fs.existsSync(targetPath);
    if (fileExists) {
      try {
        await book.xlsx.readFile(targetPath);
        sheet = book.getWorksheet('Sheet1') || book.worksheets[0];
      } catch (readErr) {
        if (BUSY_CODES.has(readErr.code)) {
          const busy = new Error('YOY.xlsx is open in another program. Please close Excel and click Sync Now.');
          busy.busy = true;
          throw busy;
        }
        // If file is unreadable/corrupt, create fresh
        book = new ExcelJS.Workbook();
        sheet = null;
      }
    }

    if (!sheet) {
      sheet = book.addWorksheet('Sheet1');
      sheet.columns = YOY_HEADERS.map((header, idx) => ({
        header,
        key: header,
        width: COLUMN_WIDTHS[idx] || 15,
      }));
      const headerRow = sheet.getRow(1);
      for (let c = 1; c <= YOY_HEADERS.length; c++) {
        const cell = headerRow.getCell(c);
        cell.font = { name: 'Times New Roman', size: 12, bold: false };
      }
      headerRow.commit();
    } else {
      // Check if existing sheet has legacy 10-column layout (col 4 was 'Status')
      const currentHeader4 = String(sheet.getRow(1).getCell(4).value || '').trim().toLowerCase();
      const isLegacy10Cols = currentHeader4 === 'status';

      if (isLegacy10Cols) {
        // Shift old data columns (4..10) to new positions (9..15) and keep 4..8 blank
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const status = row.getCell(4).value;
          const before = row.getCell(5).value;
          const after = row.getCell(6).value;
          const beforePhoto = row.getCell(7).value;
          const afterPhoto = row.getCell(8).value;
          const operator = row.getCell(9).value;
          const weighed = row.getCell(10).value;

          row.getCell(4).value = '';
          row.getCell(5).value = '';
          row.getCell(6).value = '';
          row.getCell(7).value = '';
          row.getCell(8).value = '';

          row.getCell(9).value = status;
          row.getCell(10).value = before;
          row.getCell(11).value = after;
          row.getCell(12).value = beforePhoto;
          row.getCell(13).value = afterPhoto;
          row.getCell(14).value = operator;
          row.getCell(15).value = weighed;

          for (let c = 1; c <= YOY_HEADERS.length; c++) {
            row.getCell(c).font = { name: 'Times New Roman', size: 12, bold: false };
          }
          row.commit();
        });
      }

      // Update row 1 headers to 15 columns with Times New Roman 12pt
      sheet.columns = YOY_HEADERS.map((header, idx) => ({
        header,
        key: header,
        width: COLUMN_WIDTHS[idx] || 15,
      }));
      const headerRow = sheet.getRow(1);
      for (let c = 1; c <= YOY_HEADERS.length; c++) {
        const cell = headerRow.getCell(c);
        cell.value = YOY_HEADERS[c - 1];
        cell.font = { name: 'Times New Roman', size: 12, bold: false };
      }
      headerRow.commit();
    }

    // Index existing rows by Packet ID (Column 1)
    const rowMap = new Map();
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const packetId = String(row.getCell(1).value || '').trim();
      if (packetId) rowMap.set(packetId, rowNumber);
    });

    let updated = 0;
    let inserted = 0;

    for (const p of packets) {
      const packetId = String(p.packetId || p.uniqueId || '').trim();
      if (!packetId) continue;

      const crop = p.crop || '';
      const location = p.location || p.locationCode || '';
      const year = (p.year !== null && p.year !== undefined && p.year !== '') ? p.year : '';
      const previousYear = (p.previousYear !== null && p.previousYear !== undefined && p.previousYear !== '') ? p.previousYear : '';
      const previousLocation = p.previousLocation || p.previousLocationCode || '';
      const gean = p.gean || p.gene || '';
      const comments = p.comments || '';
      const status = p.status || 'empty';
      const before = typeof p.before === 'number' ? p.before : (typeof p.beforeWeight === 'number' ? p.beforeWeight : '');
      const after = typeof p.after === 'number' ? p.after : (typeof p.afterWeight === 'number' ? p.afterWeight : '');
      const beforePhoto = p.beforePhoto || p.beforePhotoUrl || '';
      const afterPhoto = p.afterPhoto || p.afterPhotoUrl || '';
      const operator = p.operator ? (typeof p.operator === 'object' ? p.operator.name || '' : String(p.operator)) : '';
      const weighed = p.weighed ? String(p.weighed) : (p.linkedAt ? new Date(p.linkedAt).toLocaleString() : '');

      const values = [
        packetId,
        crop,
        location,
        year,
        previousYear,
        previousLocation,
        gean,
        comments,
        status,
        before,
        after,
        beforePhoto,
        afterPhoto,
        operator,
        weighed,
      ];

      if (rowMap.has(packetId)) {
        const rowNumber = rowMap.get(packetId);
        const row = sheet.getRow(rowNumber);
        for (let col = 1; col <= YOY_HEADERS.length; col++) {
          row.getCell(col).value = values[col - 1];
        }
        row.commit();
        updated++;
      } else {
        const newRow = sheet.addRow(values);
        for (let col = 1; col <= YOY_HEADERS.length; col++) {
          const cell = newRow.getCell(col);
          cell.font = { name: 'Times New Roman', size: 12, bold: false };
        }
        newRow.commit();
        inserted++;
      }
    }

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
      rows: sheet.rowCount - 1, // data rows
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
};

