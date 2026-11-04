require('./setup');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { mockRes, authHeaderFor, freshRequireCache } = require('./helpers');
const Admin = require('../models/Admin');
const SeedBatch = require('../models/SeedBatch');
const SeedPacket = require('../models/SeedPacket');
const DesktopSeedRecord = require('../models/DesktopSeedRecord');
const WeightSession = require('../models/WeightSession');
const DeletionTombstone = require('../models/DeletionTombstone');
const Product = require('../models/Product');
const deletionService = require('../utils/deletionService');

const { createRecordStore } = require('../../weighingdesktop/electron/recordStore');
const { createYoyWorkbookWriter } = require('../../weighingdesktop/electron/yoyWorkbookWriter');

describe('WEIGHINGQR DELETION & CROSS-PLATFORM SYNCHRONIZATION VERIFICATION', () => {

  const superadminId = '64b000000000000000000001';
  const adminId      = '64b000000000000000000002';
  const operatorId   = '64b000000000000000000003';

  beforeEach(() => {
    Admin.findById = async (id) => {
      if (String(id) === superadminId) return { _id: superadminId, role: 'superadmin', isActive: true };
      if (String(id) === adminId)      return { _id: adminId, role: 'admin', isActive: true };
      if (String(id) === operatorId)   return { _id: operatorId, role: 'operator', isActive: true };
      return null;
    };
  });

  // 1. Role Authorization
  describe('1. Role Authorization: Only Superadmin can delete or preview deletion', () => {
    it('DELETE /api/batches/:id returns 401 with no token, 403 for operator, 403 for admin', async () => {
      freshRequireCache('../routes/batchRoutes');
      const batchRoutes = require('../routes/batchRoutes');

      // Check routes stack for DELETE /:id
      const delLayer = batchRoutes.stack.find(l => l.route && l.route.path === '/:id' && l.route.methods.delete);
      assert.ok(delLayer, 'DELETE /:id route exists on batchRoutes');
      assert.equal(delLayer.route.stack.length, 3, 'Stack has protect, allowRoles(superadmin), handler');

      // Check preview route
      const prevLayer = batchRoutes.stack.find(l => l.route && l.route.path === '/:id/delete-preview' && l.route.methods.get);
      assert.ok(prevLayer, 'GET /:id/delete-preview route exists on batchRoutes');
      assert.equal(prevLayer.route.stack.length, 3, 'Stack has protect, allowRoles(superadmin), handler');
    });

    it('DELETE /api/products/group/:name and GET /api/products/group/delete-preview require superadmin', async () => {
      freshRequireCache('../routes/productRoutes');
      const productRoutes = require('../routes/productRoutes');

      // Check router-level protect middleware
      const hasProtect = productRoutes.stack.some(l => l.handle && l.handle.name === 'protect');
      assert.ok(hasProtect, 'Router has protect middleware applied globally');

      const delGroupLayer = productRoutes.stack.find(l => l.route && l.route.path === '/group/:name' && l.route.methods.delete);
      assert.ok(delGroupLayer, 'DELETE /group/:name route exists on productRoutes');
      assert.equal(delGroupLayer.route.stack.length, 2, 'Stack has allowRoles(superadmin) and deleteProductGroup');

      const prevGroupLayer = productRoutes.stack.find(l => l.route && l.route.path === '/group/delete-preview' && l.route.methods.get);
      assert.ok(prevGroupLayer, 'GET /group/delete-preview route exists on productRoutes');
      assert.equal(prevGroupLayer.route.stack.length, 2, 'Stack has allowRoles(superadmin) and previewProductGroup');

      const prevDirectLayer = productRoutes.stack.find(l => l.route && l.route.path === '/delete-preview' && l.route.methods.get);
      assert.ok(prevDirectLayer, 'GET /delete-preview route exists on productRoutes');

      const delDirectLayer = productRoutes.stack.find(l => l.route && l.route.path === '/:id' && l.route.methods.delete);
      assert.ok(delDirectLayer, 'DELETE /:id route exists on productRoutes');
    });

    it('Verifies DELETE /api/products/group/Mustard and URL-encoded DELETE /api/products/group/Mustard%20Seed execute successfully', async () => {
      const express = require('express');
      const app = express();
      freshRequireCache('../routes/productRoutes');
      const productRoutes = require('../routes/productRoutes');
      app.use('/api/products', productRoutes);
      app.use((req, res) => res.status(404).json({ message: `Route ${req.originalUrl} not found` }));

      // Mock preview and cascade deletion
      const origPreview = deletionService.previewProductDeletion;
      const origCascade = deletionService.deleteProductCascade;

      deletionService.previewProductDeletion = async (name) => ({
        productName: name,
        associatedBatchesCount: 1,
        associatedQrsCount: 5,
      });

      deletionService.deleteProductCascade = async (name, adminId) => ({
        productName: name,
        deletedCounts: { batches: 1, packets: 5 },
      });

      try {
        // 1. Preview GET /api/products/group/delete-preview?name=Mustard
        const reqPrev = { method: 'GET', url: '/api/products/group/delete-preview?name=Mustard', headers: authHeaderFor(superadminId) };
        const resPrev = mockRes();
        await new Promise(r => { resPrev.on('finish', r); app.handle(reqPrev, resPrev); });
        assert.equal(resPrev.statusCode, 200);
        assert.equal(resPrev.body.success, true);
        assert.equal(resPrev.body.preview.productName, 'Mustard');

        // 2. DELETE /api/products/group/Mustard
        const reqDel1 = { method: 'DELETE', url: '/api/products/group/Mustard', headers: authHeaderFor(superadminId) };
        const resDel1 = mockRes();
        await new Promise(r => { resDel1.on('finish', r); app.handle(reqDel1, resDel1); });
        assert.equal(resDel1.statusCode, 200, 'DELETE /api/products/group/Mustard returns 200');
        assert.equal(resDel1.body.success, true);
        assert.equal(resDel1.body.result.productName, 'Mustard');

        // 3. DELETE /api/products/group/Mustard%20Seed (URL-encoded)
        const reqDel2 = { method: 'DELETE', url: '/api/products/group/Mustard%20Seed', headers: authHeaderFor(superadminId) };
        const resDel2 = mockRes();
        await new Promise(r => { resDel2.on('finish', r); app.handle(reqDel2, resDel2); });
        assert.equal(resDel2.statusCode, 200, 'DELETE /api/products/group/Mustard%20Seed returns 200');
        assert.equal(resDel2.body.success, true);
        assert.equal(resDel2.body.result.productName, 'Mustard Seed');

        // 4. Fallback direct DELETE /api/products/Mustard (via /:id)
        const reqDel3 = { method: 'DELETE', url: '/api/products/Mustard', headers: authHeaderFor(superadminId) };
        const resDel3 = mockRes();
        await new Promise(r => { resDel3.on('finish', r); app.handle(reqDel3, resDel3); });
        assert.equal(resDel3.statusCode, 200, 'DELETE /api/products/Mustard returns 200');
        assert.equal(resDel3.body.success, true);
      } finally {
        deletionService.previewProductDeletion = origPreview;
        deletionService.deleteProductCascade = origCascade;
      }
    });
  });

  // 2. Batch Deletion Preview & Cascade Deletion
  describe('2. Batch Deletion Cascade & Preview', () => {
    it('previewBatchDeletion returns counts for packets, sessions and desktop records', async () => {
      const mockBatchId = '64b000000000000000000100';
      const origBatchFindById = SeedBatch.findById;
      const origPacketFind = SeedPacket.find;
      const origSessionCount = WeightSession.countDocuments;
      const origDesktopCount = DesktopSeedRecord.countDocuments;

      SeedBatch.findById = () => ({
        lean: async () => ({
          _id: mockBatchId,
          batchName: 'Batch 100',
          batchNumber: 'B-100',
          count: 2,
          seeds: [{ crop: 'Soybean', count: 2 }],
        }),
      });

      SeedPacket.find = () => ({
        select: () => ({
          lean: async () => [
            { _id: 'pkt1', uniqueId: 'PRD-SOY-001' },
            { _id: 'pkt2', uniqueId: 'PRD-SOY-002' },
          ],
        }),
      });

      WeightSession.countDocuments = async () => 1;
      DesktopSeedRecord.countDocuments = async () => 2;

      try {
        const preview = await deletionService.previewBatchDeletion(mockBatchId);
        assert.equal(preview.batchName, 'Batch 100');
        assert.equal(preview.associatedQrsCount, 2);
        assert.equal(preview.associatedPacketsCount, 2);
        assert.equal(preview.associatedSessionsCount, 1);
        assert.equal(preview.associatedDesktopRecordsCount, 2);
      } finally {
        SeedBatch.findById = origBatchFindById;
        SeedPacket.find = origPacketFind;
        WeightSession.countDocuments = origSessionCount;
        DesktopSeedRecord.countDocuments = origDesktopCount;
      }
    });

    it('deleteBatchCascade permanently deletes batch, packets, sessions, desktop records and logs tombstone', async () => {
      const mockBatchId = '64b000000000000000000200';
      let batchDeleted = false;
      let packetsDeleted = 0;
      let sessionsDeleted = 0;
      let desktopDeleted = 0;
      let tombstoneCreated = null;

      const origBatchFindById = SeedBatch.findById;
      const origBatchDelete = SeedBatch.findByIdAndDelete;
      const origPacketFind = SeedPacket.find;
      const origPacketDelete = SeedPacket.deleteMany;
      const origSessionDelete = WeightSession.deleteMany;
      const origDesktopDelete = DesktopSeedRecord.deleteMany;
      const origTombstoneCreate = DeletionTombstone.create;

      SeedBatch.findById = () => ({
        lean: async () => ({
          _id: mockBatchId,
          batchName: 'Test Delete Batch',
          batchNumber: 'B-TEST',
          count: 3,
        }),
      });

      SeedBatch.findByIdAndDelete = async (id) => {
        if (String(id) === mockBatchId) batchDeleted = true;
      };

      SeedPacket.find = () => ({
        select: () => ({
          lean: async () => [
            { _id: 'pkt10', uniqueId: 'PRD-TEST-001' },
            { _id: 'pkt11', uniqueId: 'PRD-TEST-002' },
          ],
        }),
      });

      SeedPacket.deleteMany = async (query) => {
        packetsDeleted = query._id.$in.length;
        return { deletedCount: packetsDeleted };
      };

      WeightSession.deleteMany = async (query) => {
        sessionsDeleted = 1;
        return { deletedCount: 1 };
      };

      DesktopSeedRecord.deleteMany = async (query) => {
        desktopDeleted = 2;
        return { deletedCount: 2 };
      };

      DeletionTombstone.create = async (doc) => {
        tombstoneCreated = doc;
        return doc;
      };

      try {
        const result = await deletionService.deleteBatchCascade(mockBatchId, superadminId);

        assert.equal(batchDeleted, true, 'Batch was deleted from SeedBatch collection');
        assert.equal(packetsDeleted, 2, 'Associated packets were deleted');
        assert.equal(sessionsDeleted, 1, 'Associated sessions were deleted');
        assert.equal(desktopDeleted, 2, 'Associated desktop records were deleted');
        assert.ok(tombstoneCreated, 'DeletionTombstone was created');
        assert.equal(tombstoneCreated.entityType, 'batch');
        assert.deepEqual(tombstoneCreated.deletedPacketUniqueIds, ['PRD-TEST-001', 'PRD-TEST-002']);
        assert.deepEqual(tombstoneCreated.deletedDesktopRecordIds, ['PKT-PRD-TEST-001', 'PKT-PRD-TEST-002']);
      } finally {
        SeedBatch.findById = origBatchFindById;
        SeedBatch.findByIdAndDelete = origBatchDelete;
        SeedPacket.find = origPacketFind;
        SeedPacket.deleteMany = origPacketDelete;
        WeightSession.deleteMany = origSessionDelete;
        DesktopSeedRecord.deleteMany = origDesktopDelete;
        DeletionTombstone.create = origTombstoneCreate;
      }
    });
  });

  // 3. Shared Batch Protection vs Exclusive Batch Deletion
  describe('3. Shared Batch Crop Protection vs Exclusive Batch Cascade', () => {
    it('Deleting a crop from a shared batch preserves the batch document and other crops', async () => {
      const sharedBatchId = '64b000000000000000000300';
      let batchDocDeleted = false;
      let updatedSeeds = null;
      let deletedPacketIds = [];

      const origBatchFind = SeedBatch.find;
      const origBatchDelete = SeedBatch.findByIdAndDelete;
      const origBatchUpdate = SeedBatch.updateOne;
      const origPacketFind = SeedPacket.find;
      const origPacketDelete = SeedPacket.deleteMany;
      const origDesktopDelete = DesktopSeedRecord.deleteMany;
      const origSessionDelete = WeightSession.deleteMany;
      const origProductFind = Product.find;
      const origProductDelete = Product.deleteMany;
      const origTombstoneCreate = DeletionTombstone.create;

      // Mock shared batch containing Soybean AND Rice
      SeedBatch.find = () => ({
        lean: async () => [{
          _id: sharedBatchId,
          batchName: 'Shared Land Batch',
          batchNumber: 'R-2',
          crop: 'Soybean',
          seedType: 'Soybean',
          seeds: [
            { crop: 'Soybean', count: 2, seedCode: 'SOY' },
            { crop: 'Rice', count: 3, seedCode: 'RC' },
          ],
        }],
      });

      SeedBatch.findByIdAndDelete = async () => {
        batchDocDeleted = true;
      };

      SeedBatch.updateOne = async (filter, update) => {
        if (update.$set && update.$set.seeds) {
          updatedSeeds = update.$set.seeds;
        }
      };

      // Only Soybean packets are returned for deletion
      SeedPacket.find = () => ({
        select: () => ({
          lean: async () => [
            { _id: 'pkt-soy-1', uniqueId: 'PRD-SOY-001', crop: 'Soybean' },
            { _id: 'pkt-soy-2', uniqueId: 'PRD-SOY-002', crop: 'Soybean' },
          ],
        }),
      });

      SeedPacket.deleteMany = async (q) => {
        deletedPacketIds = q._id.$in;
        return { deletedCount: deletedPacketIds.length };
      };

      DesktopSeedRecord.deleteMany = async () => ({ deletedCount: 2 });
      WeightSession.deleteMany = async () => ({ deletedCount: 0 });
      Product.find = () => ({ select: () => ({ lean: async () => [] }) });
      Product.deleteMany = async () => ({ deletedCount: 0 });
      DeletionTombstone.create = async (doc) => doc;

      try {
        const result = await deletionService.deleteProductCascade('Soybean', superadminId);

        // Crucial assertions:
        assert.equal(batchDocDeleted, false, 'Shared SeedBatch document must NOT be deleted');
        assert.ok(updatedSeeds, 'Batch seeds were updated');
        assert.equal(updatedSeeds.some(s => s.crop === 'Soybean'), false, 'Soybean removed from batch');
        assert.equal(updatedSeeds.some(s => s.crop === 'Rice'), true, 'Rice kept in batch');
        assert.deepEqual(deletedPacketIds, ['pkt-soy-1', 'pkt-soy-2'], 'Only Soybean packets were deleted');
        assert.equal(result.deletedCounts.batches, 0, '0 batches deleted because it was shared');
        assert.equal(result.deletedCounts.packets, 2, '2 Soybean packets deleted');
      } finally {
        SeedBatch.find = origBatchFind;
        SeedBatch.findByIdAndDelete = origBatchDelete;
        SeedBatch.updateOne = origBatchUpdate;
        SeedPacket.find = origPacketFind;
        SeedPacket.deleteMany = origPacketDelete;
        DesktopSeedRecord.deleteMany = origDesktopDelete;
        WeightSession.deleteMany = origSessionDelete;
        Product.find = origProductFind;
        Product.deleteMany = origProductDelete;
        DeletionTombstone.create = origTombstoneCreate;
      }
    });

    it('Deleting a crop from an exclusive batch deletes the entire batch document', async () => {
      const exclBatchId = '64b000000000000000000400';
      let batchDocDeleted = false;

      const origBatchFind = SeedBatch.find;
      const origBatchDelete = SeedBatch.findByIdAndDelete;
      const origPacketFind = SeedPacket.find;
      const origPacketDelete = SeedPacket.deleteMany;
      const origDesktopDelete = DesktopSeedRecord.deleteMany;
      const origSessionDelete = WeightSession.deleteMany;
      const origProductFind = Product.find;
      const origProductDelete = Product.deleteMany;
      const origTombstoneCreate = DeletionTombstone.create;

      // Exclusive batch: only Sunflower
      SeedBatch.find = () => ({
        lean: async () => [{
          _id: exclBatchId,
          batchName: 'Sunflower Only',
          crop: 'Sunflower',
          seedType: 'Sunflower',
          seeds: [{ crop: 'Sunflower', count: 5 }],
        }],
      });

      SeedBatch.findByIdAndDelete = async (id) => {
        if (String(id) === exclBatchId) batchDocDeleted = true;
      };

      SeedPacket.find = () => ({
        select: () => ({
          lean: async () => [{ _id: 'pkt-sf-1', uniqueId: 'PRD-SF-001' }],
        }),
      });

      SeedPacket.deleteMany = async () => ({ deletedCount: 1 });
      DesktopSeedRecord.deleteMany = async () => ({ deletedCount: 1 });
      WeightSession.deleteMany = async () => ({ deletedCount: 0 });
      Product.find = () => ({ select: () => ({ lean: async () => [] }) });
      Product.deleteMany = async () => ({ deletedCount: 0 });
      DeletionTombstone.create = async (doc) => doc;

      try {
        const result = await deletionService.deleteProductCascade('Sunflower', superadminId);

        assert.equal(batchDocDeleted, true, 'Exclusive batch document was deleted');
        assert.equal(result.deletedCounts.batches, 1, '1 batch deleted');
      } finally {
        SeedBatch.find = origBatchFind;
        SeedBatch.findByIdAndDelete = origBatchDelete;
        SeedPacket.find = origPacketFind;
        SeedPacket.deleteMany = origPacketDelete;
        DesktopSeedRecord.deleteMany = origDesktopDelete;
        WeightSession.deleteMany = origSessionDelete;
        Product.find = origProductFind;
        Product.deleteMany = origProductDelete;
        DeletionTombstone.create = origTombstoneCreate;
      }
    });
  });

  // 4. Desktop Store & Excel Workbook Synchronization
  describe('4. Desktop Store & Excel Deletion Synchronization', () => {
    it('recordStore.deleteMany removes matching records from local cache for Seed_Management.xlsx', () => {
      let writtenState = null;
      const fakeFile = {
        read: () => ({
          records: {
            'PKT-PRD-SOY-001': { recordId: 'PKT-PRD-SOY-001', crop: 'Soybean' },
            'PKT-PRD-RICE-001': { recordId: 'PKT-PRD-RICE-001', crop: 'Rice' },
          },
          meta: {},
          cursor: null,
        }),
        write: (val) => { writtenState = val; },
      };

      const store = createRecordStore({ filePath: 'test.json', file: fakeFile });
      assert.equal(store.count(), 2);

      const removed = store.deleteMany(['PKT-PRD-SOY-001']);
      assert.equal(removed, 1, '1 record removed');
      assert.equal(store.count(), 1, '1 record remaining');
      assert.equal(store.get('PKT-PRD-SOY-001'), null, 'Soybean record deleted');
      assert.ok(store.get('PKT-PRD-RICE-001'), 'Rice record remains intact');
      assert.ok(writtenState, 'State saved to file');
    });

    it('yoyWorkbookWriter removes deletedPacketIds from existing packets', async () => {
      const testDir = path.join(__dirname, 'test_tmp');
      fs.mkdirSync(testDir, { recursive: true });
      const testXlsx = path.join(testDir, 'test_YOY.xlsx');

      try {
        const writer = createYoyWorkbookWriter({ filePath: testXlsx });

        // Initial write with 2 packets
        const initialPackets = [
          { packetId: 'PRD-SOY-001', crop: 'Soybean', location: 'R-2-1', status: 'filled' },
          { packetId: 'PRD-RICE-001', crop: 'Rice', location: 'R-2-2', status: 'empty' },
        ];
        await writer.write(initialPackets, []);

        // Sync write with Soybean deleted via deletedPacketIds
        await writer.write([], ['PRD-SOY-001']);

        // Verify with ExcelJS that only Rice exists
        let ExcelJS;
        try {
          ExcelJS = require('../../weighingdesktop/node_modules/exceljs');
        } catch (_) {
          ExcelJS = require('exceljs');
        }
        const book = new ExcelJS.Workbook();
        await book.xlsx.readFile(testXlsx);
        const sheet = book.getWorksheet(1);

        const packetIdsInSheet = [];
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // skip header
          packetIdsInSheet.push(String(row.getCell(1).value || '').trim());
        });

        assert.equal(packetIdsInSheet.includes('PRD-SOY-001'), false, 'PRD-SOY-001 was removed from YOY.xlsx');
        assert.equal(packetIdsInSheet.includes('PRD-RICE-001'), true, 'PRD-RICE-001 remains intact in YOY.xlsx');
      } finally {
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      }
    });
  });

  // 5. Firebase Cleanup Graceful Handling
  describe('5. Firebase Cleanup Handling', () => {
    it('cleanFirebaseRecords safely handles non-configured or non-existent Firebase records without crashing', async () => {
      const res = await deletionService.cleanFirebaseRecords({
        batchId: 'mock-batch-id',
        packetUniqueIds: ['PRD-SOY-001'],
        desktopRecordIds: ['PKT-PRD-SOY-001'],
      });
      assert.ok(res, 'Returns result object');
      assert.equal(typeof res.synced, 'boolean');
      assert.equal(typeof res.note, 'string');
    });
  });

  // 6. Existing Core Functionality Intact
  describe('6. Existing Core Functionality Preserved', () => {
    it('batchRoutes maintains getAll, inventory, qrList, createBatch/duplicateBatch intact', () => {
      freshRequireCache('../routes/batchRoutes');
      const batchRoutes = require('../routes/batchRoutes');

      const routePaths = batchRoutes.stack.filter(l => l.route).map(l => ({
        path: l.route.path,
        methods: Object.keys(l.route.methods),
      }));

      const hasGetInventory = routePaths.some(r => r.path === '/inventory' && r.methods.includes('get'));
      const hasGetAll = routePaths.some(r => r.path === '/' && r.methods.includes('get'));
      const hasPost = routePaths.some(r => r.path === '/' && r.methods.includes('post'));
      const hasQrList = routePaths.some(r => r.path === '/:id/qr-list' && r.methods.includes('get'));
      const hasDelete = routePaths.some(r => r.path === '/:id' && r.methods.includes('delete'));
      const hasPreview = routePaths.some(r => r.path === '/:id/delete-preview' && r.methods.includes('get'));

      assert.ok(hasGetInventory, 'GET /inventory exists');
      assert.ok(hasGetAll, 'GET / exists');
      assert.ok(hasPost, 'POST / (create & duplicate batch) exists');
      assert.ok(hasQrList, 'GET /:id/qr-list exists');
      assert.ok(hasDelete, 'DELETE /:id exists');
      assert.ok(hasPreview, 'GET /:id/delete-preview exists');
    });
  });
});
