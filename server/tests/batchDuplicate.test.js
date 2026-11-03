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

describe('batch duplicate functionality — location-wise QR generation', () => {
  let createdBatches = [];
  let createdPackets = [];

  beforeEach(() => {
    uploads = [];
    createdBatches = [];
    createdPackets = [];

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
        locationCode: 'R-2-5',
        seeds: [],
      };
    };

    SeedBatch.create = async (doc) => {
      const batchDoc = { _id: 'dupBatch1', ...doc, save: async () => {} };
      createdBatches.push(batchDoc);
      return batchDoc;
    };

    SeedPacket.find = () => ({
      lean: async () => [
        { uniqueId: 'PRD-SOR2-001', serialNumber: 1 },
        { uniqueId: 'PRD-SOR2-002', serialNumber: 2 },
        { uniqueId: 'PRD-SOR2-003', serialNumber: 3 },
        { uniqueId: 'PRD-SOR2-004', serialNumber: 4 },
        { uniqueId: 'PRD-SOR2-005', serialNumber: 5 },
      ],
    });

    SeedPacket.exists = async () => false;

    SeedPacket.insertMany = async (docs) => {
      createdPackets.push(...docs);
      return docs.map((d, i) => ({ ...d, _id: `pkt${i}` }));
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
          cropNames: ['Soyabean', '   '], // Whitespace-only crop name
        },
      ],
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Crop name is mandatory/);
  });

  it('generates unique QRs with preserved location mapping and custom crop names', async () => {
    const res = await post({
      action: 'duplicate',
      batchId: VALID_SOURCE_ID,
      batchName: 'Soyabean R-2 (Duplicate)',
      rows: [
        {
          location: 'R-2-1',
          cropNames: ['Soyabean'],
        },
        {
          location: 'R-2-3',
          cropNames: ['Soyabean (Crop 1)', 'Crop 2', 'Crop 3'],
        },
      ],
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(createdPackets.length, 4);

    // Verify location R-2-1
    assert.equal(createdPackets[0].locationCode, 'R - 2 - 1');
    assert.equal(createdPackets[0].crop, 'Soyabean');
    assert.equal(createdPackets[0].serialNumber, 1);
    assert.equal(createdPackets[0].uniqueId, 'PRD-SOR2-006');

    // Verify location R-2-3 entries
    assert.equal(createdPackets[1].locationCode, 'R - 2 - 3');
    assert.equal(createdPackets[1].crop, 'Soyabean (Crop 1)');
    assert.equal(createdPackets[1].serialNumber, 3);
    assert.equal(createdPackets[1].uniqueId, 'PRD-SOR2-007');

    assert.equal(createdPackets[2].locationCode, 'R - 2 - 3');
    assert.equal(createdPackets[2].crop, 'Crop 2');
    assert.equal(createdPackets[2].serialNumber, 3);
    assert.equal(createdPackets[2].uniqueId, 'PRD-SOR2-008');

    assert.equal(createdPackets[3].locationCode, 'R - 2 - 3');
    assert.equal(createdPackets[3].crop, 'Crop 3');
    assert.equal(createdPackets[3].serialNumber, 3);
    assert.equal(createdPackets[3].uniqueId, 'PRD-SOR2-009');

    // Verify all generated IDs are distinct and none collide with 001-005
    const uniqueIds = createdPackets.map(p => p.uniqueId);
    assert.equal(new Set(uniqueIds).size, 4);
    assert.equal(uniqueIds.includes('PRD-SOR2-001'), false);
    assert.equal(uniqueIds.includes('PRD-SOR2-005'), false);

    // Verify batch record created with correct count
    assert.equal(createdBatches.length, 1);
    assert.equal(createdBatches[0].count, 4);
    assert.equal(createdBatches[0].batchName, 'Soyabean R-2 (Duplicate)');
  });
});
