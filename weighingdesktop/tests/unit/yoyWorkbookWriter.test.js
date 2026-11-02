const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { createYoyWorkbookWriter, YOY_HEADERS } = require('../../electron/yoyWorkbookWriter');

const dirs = [];
let dir;
let targetPath;
let writer;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-yoy-'));
  dirs.push(dir);
  targetPath = path.join(dir, 'YOY.xlsx');
  writer = createYoyWorkbookWriter({ filePath: targetPath });
});

after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
  }
});

describe('yoyWorkbookWriter — initial creation and formatting', () => {
  it('creates YOY.xlsx with the 15 headers and correct font when file is missing', async () => {
    const packets = [
      {
        packetId: 'PRD-001',
        crop: 'Rice',
        location: 'L1',
        year: 2026,
        previousYear: 2025,
        previousLocation: 'PL-1',
        gean: 'G1',
        comments: 'Sample comment',
        status: 'filled',
        before: 10,
        after: 12,
        beforePhoto: 'b.jpg',
        afterPhoto: 'a.jpg',
        operator: 'Op1',
        weighed: '2026-01-01',
      }
    ];
    const res = await writer.write(packets);
    assert.equal(res.written, true);
    assert.equal(res.inserted, 1);
    assert.equal(res.updated, 0);

    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(targetPath);
    const sheet = book.getWorksheet('Sheet1');
    assert.ok(sheet);

    const headers = [];
    sheet.getRow(1).eachCell((cell) => headers.push(cell.value));
    assert.deepEqual(headers, YOY_HEADERS);
    assert.equal(headers.length, 15);
    assert.equal(headers[3], 'Year');
    assert.equal(headers[4], 'Previous Year');
    assert.equal(headers[5], 'Previous Location');
    assert.equal(headers[6], 'Gean');
    assert.equal(headers[7], 'Comments');
    assert.equal(headers[8], 'Status');

    const dataRow = sheet.getRow(2);
    assert.equal(dataRow.getCell(1).value, 'PRD-001');
    assert.equal(dataRow.getCell(2).value, 'Rice');
    assert.equal(dataRow.getCell(3).value, 'L1');
    assert.equal(dataRow.getCell(4).value, 2026);
    assert.equal(dataRow.getCell(5).value, 2025);
    assert.equal(dataRow.getCell(6).value, 'PL-1');
    assert.equal(dataRow.getCell(7).value, 'G1');
    assert.equal(dataRow.getCell(8).value, 'Sample comment');
    assert.equal(dataRow.getCell(9).value, 'filled');
    assert.equal(dataRow.getCell(10).value, 10);
    assert.equal(dataRow.getCell(11).value, 12);
    assert.equal(dataRow.getCell(14).value, 'Op1');
  });

  it('prevents duplicate rows on repeated writes and updates existing rows', async () => {
    const initial = [
      { packetId: 'PRD-001', crop: 'Rice', location: 'L1', year: 2026, previousYear: 2025, previousLocation: 'PL-1', gean: 'G1', comments: 'C1', status: 'empty', before: null, after: null, beforePhoto: '', afterPhoto: '', operator: '', weighed: '' }
    ];
    await writer.write(initial);

    // Second write: PRD-001 is now filled with weights, and a new packet PRD-002 is added
    const updated = [
      { packetId: 'PRD-001', crop: 'Rice', location: 'L1', year: 2026, previousYear: 2025, previousLocation: 'PL-1', gean: 'G1', comments: 'Updated', status: 'filled', before: 15, after: 18, beforePhoto: 'bp.jpg', afterPhoto: 'ap.jpg', operator: 'John', weighed: '2026-11-02' },
      { packetId: 'PRD-002', crop: 'Wheat', location: 'L2', year: 2026, previousYear: null, previousLocation: '', gean: 'G2', comments: '', status: 'empty', before: null, after: null, beforePhoto: '', afterPhoto: '', operator: '', weighed: '' }
    ];
    const res = await writer.write(updated);
    assert.equal(res.inserted, 1);
    assert.equal(res.updated, 1);

    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(targetPath);
    const sheet = book.getWorksheet('Sheet1');
    assert.equal(sheet.rowCount, 3); // 1 header + 2 data rows

    const row1 = sheet.getRow(2);
    assert.equal(row1.getCell(1).value, 'PRD-001');
    assert.equal(row1.getCell(4).value, 2026);
    assert.equal(row1.getCell(8).value, 'Updated');
    assert.equal(row1.getCell(9).value, 'filled');
    assert.equal(row1.getCell(10).value, 15);
    assert.equal(row1.getCell(11).value, 18);
    assert.equal(row1.getCell(14).value, 'John');

    const row2 = sheet.getRow(3);
    assert.equal(row2.getCell(1).value, 'PRD-002');
    assert.equal(row2.getCell(2).value, 'Wheat');
    assert.equal(row2.getCell(7).value, 'G2');
  });

  it('migrates legacy 10-column YOY.xlsx by inserting the 5 new columns and shifting Status to col 9', async () => {
    // Manually create a legacy 10-column sheet with an existing record
    const legacyBook = new ExcelJS.Workbook();
    const sheet = legacyBook.addWorksheet('Sheet1');
    const legacyHeaders = ['Packet ID', 'Crop', 'Location', 'Status', 'Before', 'After', 'Before Photo', 'After Photo', 'Operator', 'Weighed'];
    sheet.addRow(legacyHeaders);
    sheet.addRow(['PRD-OLD-001', 'Cotton', 'L-Old', 'filled', 25.5, 30.5, 'old_b.jpg', 'old_a.jpg', 'Sam', '2025-10-10']);
    await legacyBook.xlsx.writeFile(targetPath);

    // Write a new packet; PRD-OLD-001 should have its legacy data shifted and preserved
    const res = await writer.write([
      { packetId: 'PRD-NEW-002', crop: 'Soybean', location: 'L-New', year: 2026, previousYear: 2025, previousLocation: 'PL-Old', gean: 'G3', comments: 'New lot', status: 'empty', before: null, after: null, beforePhoto: '', afterPhoto: '', operator: '', weighed: '' }
    ]);
    assert.equal(res.inserted, 1);

    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(targetPath);
    const vSheet = book.getWorksheet('Sheet1');
    assert.equal(vSheet.rowCount, 3); // 1 header + 2 data rows

    // Verify row 1 upgraded to 15 columns
    const headers = [];
    vSheet.getRow(1).eachCell((cell) => headers.push(cell.value));
    assert.deepEqual(headers, YOY_HEADERS);

    // Verify legacy row 2 has shifted data and blank new columns
    const oldRow = vSheet.getRow(2);
    assert.equal(oldRow.getCell(1).value, 'PRD-OLD-001');
    assert.equal(oldRow.getCell(2).value, 'Cotton');
    assert.equal(oldRow.getCell(3).value, 'L-Old');
    assert.equal(oldRow.getCell(4).value, ''); // Year blank
    assert.equal(oldRow.getCell(5).value, ''); // Previous Year blank
    assert.equal(oldRow.getCell(6).value, ''); // Previous Location blank
    assert.equal(oldRow.getCell(7).value, ''); // Gean blank
    assert.equal(oldRow.getCell(8).value, ''); // Comments blank
    assert.equal(oldRow.getCell(9).value, 'filled'); // Status shifted to col 9
    assert.equal(oldRow.getCell(10).value, 25.5); // Before shifted to col 10
    assert.equal(oldRow.getCell(11).value, 30.5); // After shifted to col 11
    assert.equal(oldRow.getCell(14).value, 'Sam'); // Operator shifted to col 14

    // Verify new row 3 has all 15 columns
    const newRow = vSheet.getRow(3);
    assert.equal(newRow.getCell(1).value, 'PRD-NEW-002');
    assert.equal(newRow.getCell(4).value, 2026);
    assert.equal(newRow.getCell(7).value, 'G3');
    assert.equal(newRow.getCell(8).value, 'New lot');
    assert.equal(newRow.getCell(9).value, 'empty');
  });
});

