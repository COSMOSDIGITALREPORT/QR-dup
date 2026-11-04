require('./setup');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { mockRes, authHeaderFor, fullStackFor, runStack, freshRequireCache } = require('./helpers');

const Admin = require('../models/Admin');
const SeedBatch = require('../models/SeedBatch');
const SeedPacket = require('../models/SeedPacket');
const qrStorage = require('../utils/qrStorage');

let uploads = [];
qrStorage.uploadQrPng = async (buffer, fileName, meta) => {
  uploads.push({ fileName, meta });
  return `file-${uploads.length}`;
};

function loadBatchRoutes() {
  freshRequireCache('../routes/batchRoutes');
  return require('../routes/batchRoutes');
}

async function post(body, headers = authHeaderFor('adm1')) {
  const router = loadBatchRoutes();
  const res = mockRes();
  await runStack(fullStackFor(router, 'post', '/'), 0, { body, headers }, res);
  return res;
}

const VALID_SOURCE_ID = '507f1f77bcf86cd799439011';
const NON_EXISTENT_ID = '507f1f77bcf86cd799439012';

describe('Duplicate Batch & Location-wise QR Generation', () => {
  let createdBatches = [];
  let createdPackets = [];
  let mockPackets = [];

  beforeEach(() => {
    uploads = [];
    createdBatches = [];
    createdPackets = [];

    mockPackets = [
      { _id: 'pkt1', uniqueId: 'PRD-SOR2-001', productId: 'PRD-SOR2-001', crop: 'Soyabean', seedType: 'Soyabean', locationCode: 'R - 2 - 1', serialNumber: 1, qrCodeUrl: '/api/qr/1', save: async function() {} },
      { _id: 'pkt2', uniqueId: 'PRD-SOR2-002', productId: 'PRD-SOR2-002', crop: 'Soyabean', seedType: 'Soyabean', locationCode: 'R - 2 - 2', serialNumber: 2, qrCodeUrl: '/api/qr/2', save: async function() {} },
      { _id: 'pkt3', uniqueId: 'PRD-SOR2-003', productId: 'PRD-SOR2-003', crop: 'Soyabean', seedType: 'Soyabean', locationCode: 'R - 2 - 3', serialNumber: 3, qrCodeUrl: '/api/qr/3', save: async function() {} },
      { _id: 'pkt4', uniqueId: 'PRD-SOR2-004', productId: 'PRD-SOR2-004', crop: 'Soyabean', seedType: 'Soyabean', locationCode: 'R - 2 - 4', serialNumber: 4, qrCodeUrl: '/api/qr/4', save: async function() {} },
      { _id: 'pkt5', uniqueId: 'PRD-SOR2-005', productId: 'PRD-SOR2-005', crop: 'Soyabean', seedType: 'Soyabean', locationCode: 'R - 2 - 5', serialNumber: 5, qrCodeUrl: '/api/qr/5', save: async function() {} },
    ];

    Admin.findById = async (id) => ({
      _id: id,
      name: 'Test Admin',
      role: 'admin',
      isActive: true,
    });

    SeedBatch.findById = async (id) => {
      if (String(id) === NON_EXISTENT_ID) return null;
      return {
        _id: id,
        batchName: 'Soyabean R-2',
        seedType: 'Soyabean',
        seedCode: 'SO',
        batchNumber: 'R-2',
        batchCode: 'R2',
        count: 5,
        locationCode: 'R - 2 - 5',
        seeds: [],
        packets: mockPackets.map(p => p._id),
      };
    };

    SeedBatch.findOne = async (query) => {
      if (query?.batchName) {
        return createdBatches.find(b => b.batchName === query.batchName) || null;
      }
      return null;
    };

    SeedBatch.create = async (doc) => {
      const batchDoc = { _id: `dupBatch-${createdBatches.length + 1}`, ...doc, save: async function() {} };
      createdBatches.push(batchDoc);
      return batchDoc;
    };

    SeedPacket.find = () => mockPackets;

    SeedPacket.findOne = async (query) => {
      if (query?.uniqueId) {
        return mockPackets.find(p => p.uniqueId === query.uniqueId)
          || createdPackets.find(p => p.uniqueId === query.uniqueId)
          || null;
      }
      return null;
    };

    SeedPacket.exists = async () => false;

    SeedPacket.insertMany = async (docs) => {
      const inserted = docs.map((d, i) => ({
        ...d,
        _id: `extraPkt-${createdPackets.length + i + 1}`,
        save: async function() {},
      }));
      createdPackets.push(...inserted);
      return inserted;
    };
  });

  it('rejects invalid ObjectId for batchId', async () => {
    const res = await post({
      action: 'duplicate',
      batchId: 'invalid-id-123',
      rows: [{ location: 'R-2-1', cropNames: ['Soyabean'] }],
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Invalid batch ID/);
  });

  it('rejects when rows are missing or empty', async () => {
    const res = await post({
      action: 'duplicate',
      batchId: VALID_SOURCE_ID,
      rows: [],
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /No location rows provided/);
  });

  it('rejects when source batch does not exist', async () => {
    const res = await post({
      action: 'duplicate',
      batchId: NON_EXISTENT_ID,
      rows: [{ location: 'R-2-1', cropNames: ['Soyabean'] }],
    });
    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /Source batch not found/);
  });

  it('validates that empty or whitespace crop names are rejected with clear error', async () => {
    const res = await post({
      action: 'duplicate',
      batchId: VALID_SOURCE_ID,
      rows: [
        {
          location: 'R-2-1',
          cropNames: ['Soyabean', '   '],
        },
      ],
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Crop name is mandatory/);
  });

  it('1. Test case: Generated 1 + Extra 0 = 1 QR (Existing QR reused, no extra generated)', async () => {
    const res = await post({
      action: 'duplicate',
      batchId: VALID_SOURCE_ID,
      batchName: 'Soyabean R-2 (Exact)',
      rows: [
        {
          location: 'R - 2 - 3',
          cropNames: ['Soyabean'],
          generated: 1,
          extra: 0,
        },
      ],
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.packets.length, 1);
    assert.equal(createdPackets.length, 0); // No new QR generated
    assert.equal(uploads.length, 0);

    const pkt = res.body.packets[0];
    assert.equal(pkt.uniqueId, 'PRD-SOR2-003');
    assert.equal(pkt.crop, 'Soyabean');
    assert.equal(pkt.locationCode, 'R - 2 - 3');
    assert.equal(pkt.productId, 'PRD-SOR2-003');
  });

  it('2. Test case: Generated 1 + Extra 2 = 3 QRs (1 reused + 2 extra generated with suffixes a, b)', async () => {
    const res = await post({
      action: 'duplicate',
      batchId: VALID_SOURCE_ID,
      batchName: 'Soyabean R-2 (+2 Extra)',
      rows: [
        {
          location: 'R - 2 - 3',
          cropNames: ['Soyabean', 'Rice', 'Sunflower'],
          generated: 1,
          extra: 2,
        },
      ],
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.packets.length, 3);
    assert.equal(createdPackets.length, 2); // Exactly 2 new QRs
    assert.equal(uploads.length, 2);

    // 1. Existing QR: reused
    const p1 = res.body.packets[0];
    assert.equal(p1.uniqueId, 'PRD-SOR2-003');
    assert.equal(p1.crop, 'Soyabean');
    assert.equal(p1.locationCode, 'R - 2 - 3');
    assert.equal(p1.productId, 'PRD-SOR2-003');

    // 2. Extra QR 1: Rice, R - 2 - 3a, Product ID inherited PRD-SOR2-003
    const p2 = res.body.packets[1];
    assert.equal(p2.crop, 'Rice');
    assert.equal(p2.locationCode, 'R - 2 - 3a');
    assert.equal(p2.productId, 'PRD-SOR2-003');
    assert.equal(p2.uniqueId, 'PRD-SOR2-003-a');

    // 3. Extra QR 2: Sunflower, R - 2 - 3b, Product ID inherited PRD-SOR2-003
    const p3 = res.body.packets[2];
    assert.equal(p3.crop, 'Sunflower');
    assert.equal(p3.locationCode, 'R - 2 - 3b');
    assert.equal(p3.productId, 'PRD-SOR2-003');
    assert.equal(p3.uniqueId, 'PRD-SOR2-003-b');
  });

  it('3. Test case: Generated 1 + Extra 3 = 4 QRs (suffixes a, b, c)', async () => {
    const res = await post({
      action: 'duplicate',
      batchId: VALID_SOURCE_ID,
      batchName: 'Soyabean R-2 (+3 Extra)',
      rows: [
        {
          location: 'R - 2 - 3',
          cropNames: ['Soyabean', 'Rice', 'Sunflower', 'Maize'],
          generated: 1,
          extra: 3,
        },
      ],
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.packets.length, 4);
    assert.equal(createdPackets.length, 3);

    assert.equal(res.body.packets[0].crop, 'Soyabean');
    assert.equal(res.body.packets[0].locationCode, 'R - 2 - 3');

    assert.equal(res.body.packets[1].crop, 'Rice');
    assert.equal(res.body.packets[1].locationCode, 'R - 2 - 3a');
    assert.equal(res.body.packets[1].productId, 'PRD-SOR2-003');
    assert.equal(res.body.packets[1].uniqueId, 'PRD-SOR2-003-a');

    assert.equal(res.body.packets[2].crop, 'Sunflower');
    assert.equal(res.body.packets[2].locationCode, 'R - 2 - 3b');
    assert.equal(res.body.packets[2].productId, 'PRD-SOR2-003');
    assert.equal(res.body.packets[2].uniqueId, 'PRD-SOR2-003-b');

    assert.equal(res.body.packets[3].crop, 'Maize');
    assert.equal(res.body.packets[3].locationCode, 'R - 2 - 3c');
    assert.equal(res.body.packets[3].productId, 'PRD-SOR2-003');
    assert.equal(res.body.packets[3].uniqueId, 'PRD-SOR2-003-c');
  });

  it('4. Test case: Original crop name editing (Soyabean -> Wheat) updates crop without generating another QR', async () => {
    const res = await post({
      action: 'duplicate',
      batchId: VALID_SOURCE_ID,
      batchName: 'Soyabean R-2 (Crop Edit)',
      rows: [
        {
          location: 'R - 2 - 3',
          cropNames: ['Wheat', 'Rice'], // Soyabean edited to Wheat
          generated: 1,
          extra: 1,
        },
      ],
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.packets.length, 2);
    assert.equal(createdPackets.length, 1); // Only 1 new QR generated (for Rice)

    // Original QR: crop updated to Wheat, location & uniqueId preserved!
    const original = res.body.packets[0];
    assert.equal(original.crop, 'Wheat');
    assert.equal(original.locationCode, 'R - 2 - 3');
    assert.equal(original.productId, 'PRD-SOR2-003');
    assert.equal(original.uniqueId, 'PRD-SOR2-003');

    // Extra QR: Rice with suffix a
    const extra = res.body.packets[1];
    assert.equal(extra.crop, 'Rice');
    assert.equal(extra.locationCode, 'R - 2 - 3a');
    assert.equal(extra.productId, 'PRD-SOR2-003');
    assert.equal(extra.uniqueId, 'PRD-SOR2-003-a');
  });

  it('5. Test case: Retrying generation does not create duplicate records (Idempotency)', async () => {
    const payload = {
      action: 'duplicate',
      batchId: VALID_SOURCE_ID,
      batchName: 'Soyabean R-2 (Retry Test)',
      rows: [
        {
          location: 'R - 2 - 3',
          cropNames: ['Soyabean', 'Rice', 'Sunflower'],
          generated: 1,
          extra: 2,
        },
      ],
    };

    // First request
    const res1 = await post(payload);
    assert.equal(res1.statusCode, 201);
    assert.equal(createdPackets.length, 2);
    assert.equal(uploads.length, 2);

    // Second request (simulating retry)
    const res2 = await post(payload);
    assert.equal(res2.statusCode, 201);
    assert.equal(createdPackets.length, 2); // No new packets created!
    assert.equal(uploads.length, 2); // No new QR images uploaded!
    assert.equal(res2.body.packets.length, 3);
  });

  it('6. Test case: QR scanning returns correct records for original and extra QRs', async () => {
    // Perform duplicate generation
    await post({
      action: 'duplicate',
      batchId: VALID_SOURCE_ID,
      batchName: 'Soyabean R-2 (Scan Test)',
      rows: [
        {
          location: 'R - 2 - 3',
          cropNames: ['Wheat', 'Rice'],
          generated: 1,
          extra: 1,
        },
      ],
    });

    // Lookup original QR by uniqueId
    const originalLookup = await SeedPacket.findOne({ uniqueId: 'PRD-SOR2-003' });
    assert.ok(originalLookup);
    assert.equal(originalLookup.crop, 'Wheat');
    assert.equal(originalLookup.locationCode, 'R - 2 - 3');
    assert.equal(originalLookup.productId, 'PRD-SOR2-003');

    // Lookup extra QR by uniqueId
    const extraLookup = await SeedPacket.findOne({ uniqueId: 'PRD-SOR2-003-a' });
    assert.ok(extraLookup);
    assert.equal(extraLookup.crop, 'Rice');
    assert.equal(extraLookup.locationCode, 'R - 2 - 3a');
    assert.equal(extraLookup.productId, 'PRD-SOR2-003');
  });
});
