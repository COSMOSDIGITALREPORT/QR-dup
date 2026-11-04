'use strict';

const crypto = require('crypto');
const SeedBatch = require('../models/SeedBatch');
const SeedPacket = require('../models/SeedPacket');
const WeightSession = require('../models/WeightSession');
const DesktopSeedRecord = require('../models/DesktopSeedRecord');
const Product = require('../models/Product');
const WeightRecord = require('../models/WeightRecord');
const DeletionTombstone = require('../models/DeletionTombstone');
const { isFirebaseConfigured, getFirestore } = require('../config/firebase');

/**
 * Safely removes matching documents from Firebase Cloud Firestore if configured.
 * Does NOT modify Firebase authentication or project settings.
 */
async function cleanFirebaseRecords({ batchId, packetUniqueIds = [], desktopRecordIds = [] }) {
  if (!isFirebaseConfigured()) {
    return { synced: true, note: 'Firebase not configured; skipped' };
  }

  try {
    const db = getFirestore();
    const batchWriter = db.batch();
    let opCount = 0;

    if (batchId) {
      const batchRef = db.collection('batches').doc(String(batchId));
      batchWriter.delete(batchRef);
      opCount++;
    }

    for (const uniqueId of packetUniqueIds) {
      if (!uniqueId) continue;
      const pktRef1 = db.collection('seedPackets').doc(String(uniqueId));
      const pktRef2 = db.collection('packets').doc(String(uniqueId));
      batchWriter.delete(pktRef1);
      batchWriter.delete(pktRef2);
      opCount += 2;

      // Firestore batches are limited to 500 writes
      if (opCount >= 450) break;
    }

    for (const recordId of desktopRecordIds) {
      if (!recordId) continue;
      const recRef = db.collection('desktopRecords').doc(String(recordId));
      batchWriter.delete(recRef);
      opCount++;
      if (opCount >= 490) break;
    }

    if (opCount > 0) {
      await batchWriter.commit();
    }
    return { synced: true, note: `Successfully checked and deleted up to ${opCount} Firestore documents` };
  } catch (err) {
    return { synced: false, note: `Firebase cleanup failed or timed out: ${err.message}` };
  }
}

/**
 * Previews what will be deleted if a specific Batch is deleted.
 */
async function previewBatchDeletion(batchId) {
  const batch = await SeedBatch.findById(batchId).lean();
  if (!batch) {
    return null;
  }

  const packets = await SeedPacket.find({ batchId: batch._id }).select('_id uniqueId').lean();
  const packetIds = packets.map(p => p._id);
  const packetUniqueIds = packets.map(p => p.uniqueId).filter(Boolean);

  const [sessionCount, desktopRecordCount] = await Promise.all([
    WeightSession.countDocuments({
      $or: [
        { linkedPacket: { $in: packetIds } },
        { packetUniqueId: { $in: packetUniqueIds } },
      ],
    }),
    DesktopSeedRecord.countDocuments({
      packetUniqueId: { $in: packetUniqueIds },
    }),
  ]);

  return {
    batchId: String(batch._id),
    batchName: batch.batchName || '—',
    batchNumber: batch.batchNumber || '—',
    seedType: batch.seedType || '—',
    associatedSeedsCount: Array.isArray(batch.seeds) ? batch.seeds.length : 1,
    associatedQrsCount: batch.count || packets.length,
    associatedPacketsCount: packets.length,
    associatedSessionsCount: sessionCount,
    associatedDesktopRecordsCount: desktopRecordCount,
  };
}

/**
 * Permanently deletes a Batch and its exclusive related records.
 */
async function deleteBatchCascade(batchId, adminId) {
  const batch = await SeedBatch.findById(batchId).lean();
  if (!batch) {
    return null;
  }

  const packets = await SeedPacket.find({ batchId: batch._id }).select('_id uniqueId').lean();
  const packetIds = packets.map(p => p._id);
  const packetUniqueIds = packets.map(p => p.uniqueId).filter(Boolean);
  const desktopRecordIds = packetUniqueIds.map(id => `PKT-${id}`);

  // 1. Delete associated WeightSessions
  const sessionDeleteRes = await WeightSession.deleteMany({
    $or: [
      { linkedPacket: { $in: packetIds } },
      { packetUniqueId: { $in: packetUniqueIds } },
    ],
  });

  // 2. Delete associated DesktopSeedRecords
  const desktopDeleteRes = await DesktopSeedRecord.deleteMany({
    $or: [
      { packetUniqueId: { $in: packetUniqueIds } },
      { recordId: { $in: desktopRecordIds } },
    ],
  });

  // 3. Delete SeedPackets
  const packetDeleteRes = await SeedPacket.deleteMany({ _id: { $in: packetIds } });

  // 4. Delete the SeedBatch
  await SeedBatch.findByIdAndDelete(batch._id);

  // 5. Clean Firebase if present
  const fbResult = await cleanFirebaseRecords({
    batchId: String(batch._id),
    packetUniqueIds,
    desktopRecordIds,
  });

  // 6. Record DeletionTombstone for cross-platform and offline desktop/Excel sync
  const opId = crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const tombstone = await DeletionTombstone.create({
    opId,
    entityType: 'batch',
    entityId: String(batch._id),
    entityName: batch.batchName || '',
    deletedPacketUniqueIds: packetUniqueIds,
    deletedDesktopRecordIds: desktopRecordIds,
    deletedCounts: {
      batches: 1,
      packets: packetDeleteRes.deletedCount || packets.length,
      sessions: sessionDeleteRes.deletedCount || 0,
      desktopRecords: desktopDeleteRes.deletedCount || 0,
      products: 0,
    },
    deletedBy: adminId || null,
    firebaseSynced: fbResult.synced,
    firebaseNote: fbResult.note,
  });

  return {
    opId,
    batchId: String(batch._id),
    batchName: batch.batchName,
    deletedCounts: tombstone.deletedCounts,
    firebaseSynced: fbResult.synced,
  };
}

/**
 * Previews what will be deleted if a Product Group (or Product name) is deleted.
 */
async function previewProductDeletion(productName) {
  if (!productName || typeof productName !== 'string') return null;
  const cleanName = productName.trim();

  // Find all batches containing this product name
  const batches = await SeedBatch.find({
    $or: [
      { seedType: cleanName },
      { crop: cleanName },
      { 'seeds.crop': cleanName },
      { 'seeds.seedType': cleanName },
    ],
  }).lean();

  const batchIds = batches.map(b => b._id);
  const packets = await SeedPacket.find({
    $or: [
      { batchId: { $in: batchIds } },
      { crop: cleanName },
      { seedType: cleanName },
    ],
  }).select('_id uniqueId batchId crop seedType').lean();

  const packetIds = packets.map(p => p._id);
  const packetUniqueIds = packets.map(p => p.uniqueId).filter(Boolean);

  // Check which batches are exclusively for this product vs shared
  const exclusiveBatchIds = [];
  const sharedBatchIds = [];
  for (const b of batches) {
    const isExclSeedType = b.seedType === cleanName || b.crop === cleanName;
    const otherSeeds = (b.seeds || []).filter(s => s.crop !== cleanName && s.seedType !== cleanName);
    if (otherSeeds.length === 0 && isExclSeedType) {
      exclusiveBatchIds.push(b._id);
    } else {
      sharedBatchIds.push(b._id);
    }
  }

  // Also check legacy Product documents
  const legacyProducts = await Product.find({
    $or: [
      { productName: cleanName },
      { productId: cleanName },
    ],
  }).select('_id productName productId').lean();

  return {
    productName: cleanName,
    associatedBatchesCount: batches.length,
    exclusiveBatchesCount: exclusiveBatchIds.length,
    sharedBatchesCount: sharedBatchIds.length,
    associatedQrsCount: packets.length,
    associatedPacketsCount: packets.length,
    legacyProductsCount: legacyProducts.length,
    batches: batches.map(b => ({
      id: String(b._id),
      name: b.batchName,
      number: b.batchNumber,
      isExclusive: exclusiveBatchIds.some(eid => String(eid) === String(b._id)),
    })),
  };
}

/**
 * Permanently deletes a Product and its exclusive related records.
 * If batches are shared with other crops, only the product's packets and seed entries are removed.
 */
async function deleteProductCascade(productName, adminId) {
  if (!productName || typeof productName !== 'string') return null;
  const cleanName = productName.trim();

  // 1. Identify all matching batches
  const batches = await SeedBatch.find({
    $or: [
      { seedType: cleanName },
      { crop: cleanName },
      { 'seeds.crop': cleanName },
      { 'seeds.seedType': cleanName },
    ],
  }).lean();

  const batchIds = batches.map(b => b._id);
  const packets = await SeedPacket.find({
    $or: [
      { batchId: { $in: batchIds } },
      { crop: cleanName },
      { seedType: cleanName },
    ],
  }).select('_id uniqueId batchId crop seedType').lean();

  const packetIds = packets.map(p => p._id);
  const packetUniqueIds = packets.map(p => p.uniqueId).filter(Boolean);
  const desktopRecordIds = packetUniqueIds.map(id => `PKT-${id}`);

  // 2. Delete WeightSessions
  const sessionDeleteRes = await WeightSession.deleteMany({
    $or: [
      { linkedPacket: { $in: packetIds } },
      { packetUniqueId: { $in: packetUniqueIds } },
    ],
  });

  // 3. Delete DesktopSeedRecords
  const desktopDeleteRes = await DesktopSeedRecord.deleteMany({
    $or: [
      { packetUniqueId: { $in: packetUniqueIds } },
      { recordId: { $in: desktopRecordIds } },
      { crop: cleanName },
    ],
  });

  // 4. Delete SeedPackets
  const packetDeleteRes = await SeedPacket.deleteMany({ _id: { $in: packetIds } });

  // 5. Handle Batches: Delete if exclusive, update seed entries if shared
  let deletedBatchesCount = 0;
  for (const b of batches) {
    const isExclSeedType = b.seedType === cleanName || b.crop === cleanName;
    const remainingSeeds = (b.seeds || []).filter(s => s.crop !== cleanName && s.seedType !== cleanName);

    if (remainingSeeds.length === 0 && isExclSeedType) {
      await SeedBatch.findByIdAndDelete(b._id);
      deletedBatchesCount++;
    } else {
      // Shared batch: remove only the seed entry for this product and update count
      const updatedPackets = (b.packets || []).filter(pid => !packetIds.some(delId => String(delId) === String(pid)));
      await SeedBatch.updateOne(
        { _id: b._id },
        {
          $set: {
            seeds: remainingSeeds,
            packets: updatedPackets,
            count: Math.max(1, updatedPackets.length),
          },
        }
      );
    }
  }

  // 6. Delete legacy Product and WeightRecord documents if any
  const legacyProducts = await Product.find({
    $or: [
      { productName: cleanName },
      { productId: cleanName },
    ],
  }).select('_id').lean();
  const legacyIds = legacyProducts.map(p => p._id);

  if (legacyIds.length > 0) {
    await WeightRecord.deleteMany({ product: { $in: legacyIds } });
    await Product.deleteMany({ _id: { $in: legacyIds } });
  }

  // 7. Clean Firebase
  const fbResult = await cleanFirebaseRecords({
    batchId: null,
    packetUniqueIds,
    desktopRecordIds,
  });

  // 8. Record DeletionTombstone
  const opId = crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const tombstone = await DeletionTombstone.create({
    opId,
    entityType: 'product',
    entityId: cleanName,
    entityName: cleanName,
    deletedPacketUniqueIds: packetUniqueIds,
    deletedDesktopRecordIds: desktopRecordIds,
    deletedCounts: {
      batches: deletedBatchesCount,
      packets: packetDeleteRes.deletedCount || packets.length,
      sessions: sessionDeleteRes.deletedCount || 0,
      desktopRecords: desktopDeleteRes.deletedCount || 0,
      products: legacyIds.length,
    },
    deletedBy: adminId || null,
    firebaseSynced: fbResult.synced,
    firebaseNote: fbResult.note,
  });

  return {
    opId,
    productName: cleanName,
    deletedCounts: tombstone.deletedCounts,
    firebaseSynced: fbResult.synced,
  };
}

module.exports = {
  previewBatchDeletion,
  deleteBatchCascade,
  previewProductDeletion,
  deleteProductCascade,
  cleanFirebaseRecords,
};

