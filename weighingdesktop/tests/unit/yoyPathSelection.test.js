const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { createCore } = require('../../electron/core');
const { createMemoryTokenStore } = require('../../electron/tokenStore');
const { YOY_HEADERS } = require('../../electron/yoyWorkbookWriter');

const tempDirs = [];
let dataDir;
let workbookDir;
let customWorkbookDir;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoy-data-'));
  workbookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoy-wb-'));
  customWorkbookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoy-custom-'));
  tempDirs.push(dataDir, workbookDir, customWorkbookDir);
});

after(() => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
  }
});

function createMockFetch(packets = []) {
  return async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/desktop-records/yoy-sync')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, count: packets.length, packets }),
      };
    }
    if (urlStr.includes('/api/auth/me')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, admin: { id: 'admin-1', name: 'Superadmin', role: 'superadmin' } }),
      };
    }
    if (urlStr.includes('/api/desktop-records')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, records: [] }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true }),
    };
  };
}

describe('YOY Workbook Selection & Path Persistence', () => {
  it('defaults to workbookDir or fallback when no custom settings exist', () => {
    const core = createCore({
      apiUrl: 'http://localhost:5001',
      dataDir,
      workbookDir,
      tokenStore: createMemoryTokenStore(),
      fetchImpl: createMockFetch(),
    });

    const status = core.getYoyStatus();
    assert.ok(status.filePath);
    assert.ok(status.filePath.endsWith('YOY.xlsx'));
    assert.equal(status.fileName, 'YOY.xlsx');
  });

  it('validates workbook extension when changing workbook path', () => {
    const core = createCore({
      apiUrl: 'http://localhost:5001',
      dataDir,
      workbookDir,
      tokenStore: createMemoryTokenStore(),
      fetchImpl: createMockFetch(),
    });

    assert.throws(() => {
      core.setYoyWorkbookPath('invalid-file.txt');
    }, /must be an Excel workbook \(\.xlsx\)/i);

    assert.throws(() => {
      core.setYoyWorkbookPath('');
    }, /valid Excel workbook path/i);
  });

  it('saves custom selected workbook path and automatically reconnects on next launch', () => {
    const customFile = path.join(customWorkbookDir, 'Custom_Field_Records.xlsx');

    const core1 = createCore({
      apiUrl: 'http://localhost:5001',
      dataDir,
      workbookDir,
      tokenStore: createMemoryTokenStore(),
      fetchImpl: createMockFetch(),
    });

    // Select and connect to the custom workbook path
    const updatedStatus = core1.setYoyWorkbookPath(customFile);
    assert.equal(updatedStatus.filePath, path.resolve(customFile));
    assert.equal(updatedStatus.fileName, 'Custom_Field_Records.xlsx');
    assert.equal(core1.yoyWorkbookPath, path.resolve(customFile));

    // Verify settings file was written to dataDir
    const settingsFile = path.join(dataDir, 'yoy-settings.json');
    assert.ok(fs.existsSync(settingsFile));
    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.equal(saved.filePath, path.resolve(customFile));

    // Simulate next app launch on the laptop: create new core instance with same dataDir
    const core2 = createCore({
      apiUrl: 'http://localhost:5001',
      dataDir,
      workbookDir,
      tokenStore: createMemoryTokenStore(),
      fetchImpl: createMockFetch(),
    });

    // Second instance must automatically reconnect to previously selected custom workbook path
    assert.equal(core2.yoyWorkbookPath, path.resolve(customFile));
    assert.equal(core2.getYoyStatus().filePath, path.resolve(customFile));
    assert.equal(core2.getYoyStatus().fileName, 'Custom_Field_Records.xlsx');
  });

  it('syncs 15 columns into the custom connected workbook without duplicating', async () => {
    const customFile = path.join(customWorkbookDir, 'Farm_YOY_Live.xlsx');
    const mockPackets = [
      {
        packetId: 'PRD-CUSTOM-001',
        crop: 'Groundnut',
        location: 'R-1-1',
        year: 2026,
        previousYear: 2024,
        previousLocation: 'S-99',
        gean: 'G2',
        comments: 'Test remarks',
        status: 'filled',
        before: 12.5,
        after: 15.8,
        beforePhoto: 'http://example.com/b.jpg',
        afterPhoto: 'http://example.com/a.jpg',
        operator: 'John Doe',
        weighed: '2026-11-03 10:00:00',
      },
    ];

    const core = createCore({
      apiUrl: 'http://localhost:5001',
      dataDir,
      workbookDir,
      tokenStore: createMemoryTokenStore(),
      fetchImpl: createMockFetch(mockPackets),
    });

    core.setYoyWorkbookPath(customFile);

    // Run first sync
    const syncRes = await core.yoySyncNow();
    assert.equal(syncRes.rowCount, 1);
    assert.equal(syncRes.inserted, 1);
    assert.equal(syncRes.lastError, null);
    assert.ok(fs.existsSync(customFile));

    // Verify Excel headers and values
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(customFile);
    const ws = wb.worksheets[0];
    assert.equal(ws.rowCount, 2); // 1 header + 1 data row

    const headers = [];
    for (let c = 1; c <= 15; c++) headers.push(ws.getRow(1).getCell(c).value);
    assert.deepEqual(headers, YOY_HEADERS);

    const row2 = [];
    for (let c = 1; c <= 15; c++) row2.push(ws.getRow(2).getCell(c).value);
    assert.equal(row2[0], 'PRD-CUSTOM-001');
    assert.equal(row2[1], 'Groundnut');
    assert.equal(row2[2], 'R-1-1');
    assert.equal(row2[3], 2026);
    assert.equal(row2[4], 2024);
    assert.equal(row2[5], 'S-99');
    assert.equal(row2[6], 'G2');
    assert.equal(row2[7], 'Test remarks');
    assert.equal(row2[8], 'filled');
    assert.equal(row2[9], 12.5);
    assert.equal(row2[10], 15.8);
    assert.equal(row2[13], 'John Doe');

    // Run second sync: must update without duplicate rows
    const syncRes2 = await core.yoySyncNow();
    assert.equal(syncRes2.rowCount, 1);
    assert.equal(syncRes2.updated, 1);

    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(customFile);
    assert.equal(wb2.worksheets[0].rowCount, 2);
  });
});
