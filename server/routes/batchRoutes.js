const express  = require('express');
const router   = express.Router();
const QRCode   = require('qrcode');
const SeedBatch  = require('../models/SeedBatch');
const SeedPacket = require('../models/SeedPacket');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const { uploadQrPng, deleteQrFile } = require('../utils/qrStorage');
const { sendServerError } = require('../utils/errorResponse');

const { DETAIL_FIELDS, DETAIL_TEXT_MAX_LENGTH } = SeedBatch;

function parseLocationString(loc) {
  if (!loc || typeof loc !== 'string') return null;
  const parts = loc.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 3) {
    const land = parts[0];
    const line = parts[1];
    const count = parseInt(parts[2], 10);
    if (land && line && !isNaN(count) && count > 0) {
      return { land, line, count };
    }
  }
  return null;
}

// Validates the optional seed-management details of a new batch (see
// DETAIL_FIELDS in SeedBatch.js). Nothing is required and nothing is derived:
// a field that was not sent is stored blank, and Total is whatever was
// entered. Only plain text / finite numbers get through, so an object or
// array can never reach the database. Returns { clean } or { error }.
function parseDetailFields(body) {
  const clean = {};
  for (const { field, label, type } of DETAIL_FIELDS) {
    const value = body[field];
    const blank = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (type === 'number') {
      if (blank) { clean[field] = null; continue; }
      const parsed = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value.trim()) : NaN);
      if (!Number.isFinite(parsed)) return { error: `${label} must be a number` };
      clean[field] = parsed;
    } else {
      if (blank) { clean[field] = ''; continue; }
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
        return { error: `${label} must be text` };
      }
      const text = String(value).trim();
      if (text.length > DETAIL_TEXT_MAX_LENGTH) {
        return { error: `${label} must be at most ${DETAIL_TEXT_MAX_LENGTH} characters` };
      }
      clean[field] = text;
    }
  }
  return { clean };
}

// Public base URL that gets encoded into every packet's QR code (the
// /scan/:uniqueId destination a phone opens on scan) — NOT the qrCodeUrl
// path the PNG is stored at, which is unrelated and untouched by this.
//
// Production (NODE_ENV=production) must set PUBLIC_BASE_URL explicitly
// (e.g. https://your-backend.onrender.com) — there is intentionally no
// LAN-IP fallback here, so a missing value fails the request loudly instead
// of silently baking an unreachable address into printed QR labels.
// Local/dev keeps working exactly as before via SERVER_IP+PORT (or plain
// localhost if neither is set) — PUBLIC_BASE_URL can also be set locally to
// point at something else (e.g. a tunnel) if ever wanted.
function resolveQrBaseUrl() {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) {
    if (!/^https?:\/\//i.test(configured)) {
      throw new Error('PUBLIC_BASE_URL must start with http:// or https://');
    }
    return configured.replace(/\/+$/, ''); // no accidental double slash below
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_BASE_URL is not configured — refusing to generate a QR code with an unreachable URL');
  }

  const port = process.env.PORT || 5001;
  const host = process.env.SERVER_IP || 'localhost';
  return `http://${host}:${port}`;
}

// POST /api/batches — create batch + bulk QR generation. Mutating/
// privileged operation — matches the same allowRoles('superadmin','admin')
// convention already used for the equivalent create routes in
// productRoutes.js and machineRoutes.js. Without this, any authenticated
// Admin — including the lowest-privilege Admin role, 'operator' — could
// create batches of up to 5000 packets with no role check at all.
router.post('/', protect, allowRoles('superadmin', 'admin'), async (req, res) => {
  try {
    const baseUrl = resolveQrBaseUrl();

    // Check if this is an extra-qrs update on an existing batch
    if (req.body.batchId && (req.body.action === 'extra-qrs' || req.body.existingEntriesUpdates || req.body.newEntries)) {
      const batchId = req.body.batchId;
      if (!mongoose.Types.ObjectId.isValid(batchId)) {
        return res.status(400).json({ success: false, message: 'Invalid batch ID' });
      }

      const batch = await SeedBatch.findById(batchId);
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Batch not found' });
      }

      const existingPackets = await SeedPacket.find({ batchId: batch._id });
      const usedUniqueIds = new Set(existingPackets.map(p => p.uniqueId));

      const { existingEntriesUpdates = [], newEntries = [] } = req.body;

      // Normalize batch.seeds if empty (legacy batches)
      if (!Array.isArray(batch.seeds) || batch.seeds.length === 0) {
        const parsed = parseLocationString(batch.locationCode) || { land: 'R', line: '1', count: batch.count || 1 };
        batch.seeds = [{
          crop: batch.crop || batch.seedType,
          seedType: batch.seedType,
          seedCategory: batch.seedCategory || '',
          seedCode: batch.seedCode,
          batchNumber: batch.batchNumber,
          batchCode: batch.batchCode,
          count: batch.count || parsed.count,
          land: parsed.land,
          line: parsed.line,
          locationCode: batch.locationCode,
          year: batch.year,
          previousYear: batch.previousYear,
          previousLocationCode: batch.previousLocationCode,
          gene: batch.gene,
          comments: batch.comments,
        }];
      }

      const newPacketDefs = [];

      // 1. Process extra QRs on existing seed entries
      for (const update of existingEntriesUpdates) {
        const seedIndex = Number(update.seedIndex);
        const extraCount = Math.max(0, parseInt(update.extraQrCount, 10) || 0);
        if (extraCount <= 0) continue;

        if (seedIndex < 0 || seedIndex >= batch.seeds.length) {
          return res.status(400).json({ success: false, message: `Invalid seed index: ${seedIndex}` });
        }

        const s = batch.seeds[seedIndex];
        const crop = s.crop || s.seedType;
        const sc = (s.seedCode || 'SC').toUpperCase();
        const bc = (s.batchCode || 'B1').toUpperCase();
        const land = s.land || 'R';
        const line = s.line || '1';

        // Find packets matching this seed entry to determine highest serialNumber
        const matchingPackets = existingPackets.filter(p =>
          (p.crop === crop || p.seedType === crop) && p.seedCode === sc
        );

        let maxSerial = 0;
        matchingPackets.forEach(p => {
          if (typeof p.serialNumber === 'number' && p.serialNumber > maxSerial) {
            maxSerial = p.serialNumber;
          } else if (p.locationCode) {
            const parts = p.locationCode.split(/\s*-\s*/);
            const num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num) && num > maxSerial) maxSerial = num;
          }
        });
        if (maxSerial === 0) maxSerial = s.count || matchingPackets.length || 0;

        const startSerial = maxSerial + 1;
        const endSerial = maxSerial + extraCount;

        for (let i = startSerial; i <= endSerial; i++) {
          let uniqueId = `PRD-${sc}${bc}-${String(i).padStart(3, '0')}`;
          if (usedUniqueIds.has(uniqueId) || await SeedPacket.exists({ uniqueId })) {
            uniqueId = `PRD-${sc}${bc}-${seedIndex + 1}-${String(i).padStart(3, '0')}`;
            let attempt = 1;
            while (usedUniqueIds.has(uniqueId) || await SeedPacket.exists({ uniqueId })) {
              uniqueId = `PRD-${sc}${bc}-${seedIndex + 1}-${String(i).padStart(3, '0')}-${attempt++}`;
            }
          }
          usedUniqueIds.add(uniqueId);

          newPacketDefs.push({
            uniqueId,
            fileName: `${uniqueId}.png`,
            crop: crop,
            seedType: s.seedType || crop,
            seedCode: sc,
            locationCode: `${land} - ${line} - ${i}`,
            serialNumber: i,
            seedIndex,
          });
        }

        // Update the count and location code for this entry
        s.count = (s.count || 0) + extraCount;
        s.locationCode = `${land} - ${line} - ${s.count}`;
      }

      // 2. Process newly added seed entries (from "Add More" in Edit mode)
      if (Array.isArray(newEntries) && newEntries.length > 0) {
        for (let i = 0; i < newEntries.length; i++) {
          const e = newEntries[i];
          const prefix = `[New Entry #${i + 1}] `;
          const cropName = (e.cropName || e.crop || e.seedType || '').trim();
          if (!cropName) {
            return res.status(400).json({ success: false, message: `${prefix}Crop Name is required` });
          }
          const sc = (e.seedCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!sc) {
            return res.status(400).json({ success: false, message: `${prefix}Seed Code is required` });
          }
          const loc = (e.location || e.locationCode || '').trim();
          const parsed = parseLocationString(loc);
          if (!parsed) {
            return res.status(400).json({ success: false, message: `${prefix}Location must follow Land - Line - Count (e.g. R - 2 - 24)` });
          }
          const extra = Math.max(0, parseInt(e.extraQrCount, 10) || 0);
          const totalEntryCount = parsed.count + extra;
          if (totalEntryCount < 1 || totalEntryCount > 5000) {
            return res.status(400).json({ success: false, message: `${prefix}Count must be between 1 and 5000` });
          }

          const batchNum = e.batchNumber || `${parsed.land}-${parsed.line}`;
          const batchCd = (e.batchCode || `${parsed.land}${parsed.line}`).replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'B1';
          const newSeedIndex = batch.seeds.length;

          for (let seq = 1; seq <= totalEntryCount; seq++) {
            let uniqueId = `PRD-${sc}${batchCd}-${String(seq).padStart(3, '0')}`;
            if (usedUniqueIds.has(uniqueId) || await SeedPacket.exists({ uniqueId })) {
              uniqueId = `PRD-${sc}${batchCd}-${newSeedIndex + 1}-${String(seq).padStart(3, '0')}`;
              let attempt = 1;
              while (usedUniqueIds.has(uniqueId) || await SeedPacket.exists({ uniqueId })) {
                uniqueId = `PRD-${sc}${batchCd}-${newSeedIndex + 1}-${String(seq).padStart(3, '0')}-${attempt++}`;
              }
            }
            usedUniqueIds.add(uniqueId);

            newPacketDefs.push({
              uniqueId,
              fileName: `${uniqueId}.png`,
              crop: cropName,
              seedType: cropName,
              seedCode: sc,
              locationCode: `${parsed.land} - ${parsed.line} - ${seq}`,
              serialNumber: seq,
              seedIndex: newSeedIndex,
            });
          }

          batch.seeds.push({
            crop: cropName,
            seedType: cropName,
            seedCategory: e.seedCategory || '',
            seedCode: sc,
            batchNumber: batchNum,
            batchCode: batchCd,
            count: totalEntryCount,
            land: parsed.land,
            line: parsed.line,
            locationCode: `${parsed.land} - ${parsed.line} - ${totalEntryCount}`,
            year: e.year ? Number(e.year) : null,
            previousYear: e.previousYear ? Number(e.previousYear) : null,
            previousLocationCode: e.previousLocation || e.previousLocationCode || '',
            gene: e.gean || e.gene || '',
            comments: e.comments || '',
          });
        }
      }

      if (newPacketDefs.length === 0) {
        return res.json({ success: true, message: 'No extra QR codes requested', batch, newPackets: [] });
      }

      // Generate QR images and upload to GridFS
      const uploadedFileIds = [];
      try {
        await Promise.all(newPacketDefs.map(async (def) => {
          const buffer = await QRCode.toBuffer(`${baseUrl}/scan/${def.uniqueId}`, {
            type: 'png', width: 400, margin: 2,
            color: { dark: '#1a227f', light: '#ffffff' },
          });
          def.fileId = await uploadQrPng(buffer, def.fileName, {
            uniqueId: def.uniqueId,
            batchId: String(batch._id),
          });
          uploadedFileIds.push(def.fileId);
        }));
      } catch (err) {
        await Promise.all(uploadedFileIds.map(id => deleteQrFile(id)));
        throw err;
      }

      // Insert new SeedPacket documents
      const packetsToInsert = newPacketDefs.map(def => ({
        uniqueId: def.uniqueId,
        batchId: batch._id,
        qrCodeUrl: `/api/qr/${def.fileId}`,
        status: 'empty',
        crop: def.crop,
        seedType: def.seedType,
        seedCode: def.seedCode,
        locationCode: def.locationCode,
        serialNumber: def.serialNumber,
      }));

      const insertedPackets = await SeedPacket.insertMany(packetsToInsert);

      // Update parent batch
      batch.packets.push(...insertedPackets.map(p => p._id));
      batch.count = (batch.count || 0) + insertedPackets.length;
      batch.seedType = batch.seeds.map(s => s.crop || s.seedType).filter(Boolean).join(', ');
      batch.seedCategory = batch.seeds.map(s => s.seedCategory).filter(Boolean).join(', ');
      if (batch.seeds.length > 1) {
        batch.batchName = batch.seeds.map(s => `${s.crop || s.seedType} (${s.batchNumber})`).join(', ');
      }

      await batch.save();

      return res.status(200).json({
        success: true,
        message: `Successfully generated ${insertedPackets.length} extra QR codes`,
        batch,
        newPackets: insertedPackets,
      });
    }


    // Check if multi-seed entries are submitted
    if (Array.isArray(req.body.entries) && req.body.entries.length > 0) {
      const rawEntries = req.body.entries;
      const processedEntries = [];
      let totalCount = 0;

      for (let i = 0; i < rawEntries.length; i++) {
        const e = rawEntries[i];
        const prefix = rawEntries.length > 1 ? `[Entry #${i + 1}] ` : '';
        const cropName = (e.cropName || e.crop || e.seedType || '').trim();
        if (!cropName) {
          return res.status(400).json({ success: false, message: `${prefix}cropName required` });
        }
        const sc = (e.seedCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!sc) {
          return res.status(400).json({ success: false, message: `${prefix}seedCode required` });
        }
        const loc = (e.location || e.locationCode || '').trim();
        const parsed = parseLocationString(loc);
        if (!parsed) {
          return res.status(400).json({ success: false, message: `${prefix}location must follow Land - Line - Count (e.g. R - 2 - 24)` });
        }
        if (parsed.count < 1 || parsed.count > 5000) {
          return res.status(400).json({ success: false, message: `${prefix}count must be 1–5000` });
        }

        const batchNum = e.batchNumber || `${parsed.land}-${parsed.line}`;
        const batchCd = (e.batchCode || `${parsed.land}${parsed.line}`).replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'B1';

        totalCount += parsed.count;
        processedEntries.push({
          cropName,
          seedType: cropName,
          seedCategory: e.seedCategory || '',
          seedCode: sc,
          batchNumber: batchNum,
          batchCode: batchCd,
          land: parsed.land,
          line: parsed.line,
          count: parsed.count,
          location: loc,
          year: e.year ? Number(e.year) : null,
          previousYear: e.previousYear ? Number(e.previousYear) : null,
          previousLocationCode: e.previousLocation || e.previousLocationCode || '',
          gene: e.gean || e.gene || '',
          comments: e.comments || '',
          index: i,
        });
      }

      if (totalCount < 1 || totalCount > 5000) {
        return res.status(400).json({ success: false, message: 'Total count across all seed entries must be 1–5000' });
      }

      const first = processedEntries[0];
      const batchName = req.body.batchName || (
        processedEntries.length === 1
          ? `${first.cropName} ${first.batchNumber}`
          : processedEntries.map(e => `${e.cropName} (${e.batchNumber})`).join(', ')
      );
      const seedType = processedEntries.map(e => e.cropName).join(', ');
      const seedCategory = processedEntries.map(e => e.seedCategory).filter(Boolean).join(', ') || '';
      const batchNumber = processedEntries.map(e => e.batchNumber).join(', ');

      const seedsData = processedEntries.map(e => ({
        crop: e.cropName,
        seedType: e.seedType,
        seedCategory: e.seedCategory,
        seedCode: e.seedCode,
        batchNumber: e.batchNumber,
        batchCode: e.batchCode,
        count: e.count,
        land: e.land,
        line: e.line,
        locationCode: e.location,
        year: e.year,
        previousYear: e.previousYear,
        previousLocationCode: e.previousLocationCode,
        gene: e.gene,
        comments: e.comments,
      }));

      const batch = await SeedBatch.create({
        batchName,
        seedType,
        seedCategory,
        seedCode: first.seedCode,
        batchNumber,
        batchCode: first.batchCode,
        count: totalCount,
        crop: first.cropName,
        locationCode: first.location,
        year: first.year || null,
        previousYear: first.previousYear,
        previousLocationCode: first.previousLocationCode,
        gene: first.gene,
        comments: first.comments,
        seeds: seedsData,
        createdBy: req.admin._id,
      });

      const packetDefs = [];
      const usedUniqueIds = new Set();
      for (const entry of processedEntries) {
        const sc = entry.seedCode;
        const bc = entry.batchCode;
        for (let i = 1; i <= entry.count; i++) {
          let uniqueId = `PRD-${sc}${bc}-${String(i).padStart(3, '0')}`;
          if (usedUniqueIds.has(uniqueId)) {
            uniqueId = `PRD-${sc}${bc}-${entry.index + 1}-${String(i).padStart(3, '0')}`;
          }
          usedUniqueIds.add(uniqueId);
          packetDefs.push({
            uniqueId,
            fileName: `${uniqueId}.png`,
            crop: entry.cropName,
            seedType: entry.seedType,
            seedCode: sc,
            locationCode: `${entry.land} - ${entry.line} - ${i}`,
            serialNumber: i,
          });
        }
      }

      const uploadedFileIds = [];
      try {
        await Promise.all(packetDefs.map(async (def) => {
          const buffer = await QRCode.toBuffer(`${baseUrl}/scan/${def.uniqueId}`, {
            type: 'png', width: 400, margin: 2,
            color: { dark: '#1a227f', light: '#ffffff' },
          });
          def.fileId = await uploadQrPng(buffer, def.fileName, {
            uniqueId: def.uniqueId,
            batchId:  String(batch._id),
          });
          uploadedFileIds.push(def.fileId);
        }));
      } catch (err) {
        await Promise.all(uploadedFileIds.map(id => deleteQrFile(id)));
        throw err;
      }

      const packets = packetDefs.map(def => ({
        uniqueId:     def.uniqueId,
        batchId:      batch._id,
        qrCodeUrl:    `/api/qr/${def.fileId}`,
        status:       'empty',
        crop:         def.crop,
        seedType:     def.seedType,
        seedCode:     def.seedCode,
        locationCode: def.locationCode,
        serialNumber: def.serialNumber,
      }));

      const created = await SeedPacket.insertMany(packets);
      batch.packets = created.map(p => p._id);
      await batch.save();

      return res.status(201).json({
        success: true,
        message: `${totalCount} QR codes generated`,
        batch: {
          _id:          batch._id,
          batchName:    batch.batchName,
          seedType:     batch.seedType,
          seedCategory: batch.seedCategory,
          seedCode:     batch.seedCode,
          batchNumber:  batch.batchNumber,
          batchCode:    batch.batchCode,
          count:        batch.count,
          month:        batch.month,
          year:         batch.year,
          warehouse:    batch.warehouse,
          rack:         batch.rack,
          shelf:        batch.shelf,
          seeds:        batch.seeds,
          ...Object.fromEntries(DETAIL_FIELDS.map(({ field }) => [field, batch[field]])),
          createdAt:    batch.createdAt,
        },
        packets: created.map(p => ({
          uniqueId:     p.uniqueId,
          qrCodeUrl:    p.qrCodeUrl,
          crop:         p.crop,
          locationCode: p.locationCode,
        })),
      });
    }

    // Single-entry legacy flow
    const { batchName, seedType, seedCategory, seedCode, batchNumber, batchCode, count, month, year, warehouse, rack, shelf } = req.body;

    if (!seedCode || !batchCode || !count) {
      return res.status(400).json({ success: false, message: 'seedCode, batchCode, count required' });
    }

    const total = parseInt(count);
    if (isNaN(total) || total < 1 || total > 5000) {
      return res.status(400).json({ success: false, message: 'count must be 1–5000' });
    }

    const parsedMonth = (month !== undefined && month !== null && month !== '') ? parseInt(month) : null;
    if (parsedMonth !== null && (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12)) {
      return res.status(400).json({ success: false, message: 'month must be 1–12' });
    }
    const parsedYear = (year !== undefined && year !== null && year !== '') ? parseInt(year) : null;
    if (parsedYear !== null && isNaN(parsedYear)) {
      return res.status(400).json({ success: false, message: 'year must be a number' });
    }

    const { clean: details, error: detailError } = parseDetailFields(req.body);
    if (detailError) {
      return res.status(400).json({ success: false, message: detailError });
    }

    const SC = seedCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const BC = batchCode.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const batch = await SeedBatch.create({
      batchName: batchName || `${seedType} ${batchNumber}`,
      seedType, seedCategory: seedCategory || '', seedCode: SC, batchNumber, batchCode: BC,
      count: total, createdBy: req.admin._id,
      month: parsedMonth, year: parsedYear,
      warehouse: warehouse || '', rack: rack || '', shelf: shelf || '',
      ...details,
    });

    const packetDefs = Array.from({ length: total }, (_, i) => {
      const serial   = String(i + 1).padStart(3, '0');
      const uniqueId = `PRD-${SC}${BC}-${serial}`;
      const fileName = `${uniqueId}.png`;
      return { uniqueId, fileName };
    });

    const uploadedFileIds = [];
    try {
      await Promise.all(packetDefs.map(async (def) => {
        const buffer = await QRCode.toBuffer(`${baseUrl}/scan/${def.uniqueId}`, {
          type: 'png', width: 400, margin: 2,
          color: { dark: '#1a227f', light: '#ffffff' },
        });
        def.fileId = await uploadQrPng(buffer, def.fileName, {
          uniqueId: def.uniqueId,
          batchId:  String(batch._id),
        });
        uploadedFileIds.push(def.fileId);
      }));
    } catch (err) {
      await Promise.all(uploadedFileIds.map(id => deleteQrFile(id)));
      throw err;
    }

    const packets = packetDefs.map(({ uniqueId, fileId }) => ({
      uniqueId,
      batchId:   batch._id,
      qrCodeUrl: `/api/qr/${fileId}`,
      status:    'empty',
    }));

    const created = await SeedPacket.insertMany(packets);
    batch.packets = created.map(p => p._id);
    await batch.save();

    res.status(201).json({
      success: true,
      message: `${total} QR codes generated`,
      batch: {
        _id:       batch._id,
        batchName: batch.batchName,
        seedType:  batch.seedType,
        seedCategory: batch.seedCategory,
        seedCode:  batch.seedCode,
        batchNumber: batch.batchNumber,
        batchCode: batch.batchCode,
        count:     batch.count,
        month:     batch.month,
        year:      batch.year,
        warehouse: batch.warehouse,
        rack:      batch.rack,
        shelf:     batch.shelf,
        // The details as stored, so the form can confirm what was saved.
        ...Object.fromEntries(DETAIL_FIELDS.map(({ field }) => [field, batch[field]])),
        createdAt: batch.createdAt,
      },
      packets: created.map(p => ({ uniqueId: p.uniqueId, qrCodeUrl: p.qrCodeUrl })),
    });
  } catch (err) {
    sendServerError(res, err, 'batchRoutes');
  }
});



// GET /api/batches — list all batches
router.get('/', protect, async (req, res) => {
  try {
    const batches = await SeedBatch.find()
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });

    // Real filled-packet count per batch, from SeedPacket only (never
    // WeightSession/WeightRecord). One aggregation covers every batch, so
    // this stays a single extra query regardless of how many batches exist.
    const filledCounts = await SeedPacket.aggregate([
      { $match: { status: 'filled' } },
      { $group: { _id: '$batchId', filledCount: { $sum: 1 } } },
    ]);
    const filledMap = new Map(filledCounts.map(f => [String(f._id), f.filledCount]));

    const withCounts = batches.map(b => {
      const obj = b.toObject();
      obj.filledCount = filledMap.get(String(b._id)) || 0;
      return obj;
    });

    res.json({ success: true, batches: withCounts });
  } catch (err) {
    sendServerError(res, err, 'batchRoutes');
  }
});

// GET /api/batches/inventory — Product Inventory page data: real packets
// (one row per QR packet) joined with their batch, filtered by seed/batch/
// warehouse (AND logic, all optional), plus the dropdown options and the
// category counts for the stat cards. SeedBatch/SeedPacket are the sole
// source of truth here — the legacy Product collection is never touched.
router.get('/inventory', protect, async (req, res) => {
  try {
    const { seedType, batchNumber, warehouse, search } = req.query;

    const isAll = req.query.limit === 'all' || req.query.all === 'true';
    const limit = isAll ? 0 : (req.query.limit ? Math.max(1, parseInt(req.query.limit, 10) || 10) : 1000);
    const requestedPage = parseInt(req.query.page, 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const skip = limit > 0 ? (page - 1) * limit : 0;

    // Dropdown options — always real, distinct values from SeedBatch.
    // Batch options narrow to the selected seed, per spec; seed options
    // always list every seed so switching seed never hides itself.
    const seedOptions = (await SeedBatch.distinct('seedType')).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const batchOptionFilter = seedType ? { seedType } : {};
    const batchOptions = (await SeedBatch.distinct('batchNumber', batchOptionFilter)).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const warehouseOptions = ['Warehouse A', 'Warehouse B', 'Warehouse C'];

    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const batchMatch = {};
    if (seedType)    batchMatch.seedType = seedType;
    if (batchNumber) batchMatch.batchNumber = batchNumber;
    // Warehouse is a fixed 3-option field (Warehouse A/B/C) — matched
    // case-insensitively since older batches were free-typed before this
    // dropdown existed (e.g. "warehouse b"). Seed/batch stay exact matches
    // against the literal values their own dropdowns list.
    if (warehouse)   batchMatch.warehouse = new RegExp(`^${escapeRegex(warehouse)}$`, 'i');

    const pipeline = [
      { $match: batchMatch },
      { $lookup: { from: SeedPacket.collection.name, localField: '_id', foreignField: 'batchId', as: 'packets' } },
      { $unwind: '$packets' },
      { $project: {
          _id:          '$packets._id',
          id:           '$packets.uniqueId',
          qrCodeUrl:    '$packets.qrCodeUrl',
          name:         '$seedType',
          crop:         '$packets.crop',
          seedCode:     '$packets.seedCode',
          locationCode: '$packets.locationCode',
          status:       '$packets.status',
          serialNumber: '$packets.serialNumber',
          category:     '$seedCategory',
          batch:        '$batchNumber',
          batchName:    '$batchName',
          batchCode:    '$batchCode',
          batchId:      '$_id',
          location:     '$warehouse',
          createdAt:    '$packets.createdAt',
      } },
    ];
    if (search) {
      const rx = new RegExp(search, 'i');
      pipeline.push({ $match: { $or: [{ id: rx }, { name: rx }, { batch: rx }, { crop: rx }, { locationCode: rx }] } });
    }

    // Counts reflect every matching packet (not just the displayed page),
    // so the stat cards are always correct for the active filter combination.
    const countsAgg = await SeedBatch.aggregate([
      ...pipeline,
      { $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          organicCount:  { $sum: { $cond: [{ $eq: ['$category', 'Organic'] }, 1, 0] } },
          hybridCount:   { $sum: { $cond: [{ $eq: ['$category', 'Hybrid'] }, 1, 0] } },
          heirloomModifiedCount: { $sum: { $cond: [{ $in: ['$category', ['Heirloom', 'Modified']] }, 1, 0] } },
      } },
    ]);
    const counts = countsAgg[0] || { totalProducts: 0, organicCount: 0, hybridCount: 0, heirloomModifiedCount: 0 };
    const totalPages = limit > 0 ? Math.ceil(counts.totalProducts / limit) : 1;

    const paginationStages = [];
    if (skip > 0) paginationStages.push({ $skip: skip });
    if (limit > 0) paginationStages.push({ $limit: limit });

    const products = await SeedBatch.aggregate([
      ...pipeline,
      { $sort: { createdAt: -1 } },
      ...paginationStages,
    ]);

    const enrichedProducts = products.map((p) => {
      if (!p.crop) p.crop = p.name;
      if (!p.locationCode) p.locationCode = p.id;
      if (!p.batchName) p.batchName = `${p.name} ${p.batch || ''}`.trim();
      return p;
    });

    res.json({
      success: true,
      products: enrichedProducts,
      totalProducts: counts.totalProducts,
      organicCount: counts.organicCount,
      hybridCount: counts.hybridCount,
      heirloomModifiedCount: counts.heirloomModifiedCount,
      seedOptions,
      batchOptions,
      warehouseOptions,
      pagination: { page, limit: limit || counts.totalProducts, total: counts.totalProducts, totalPages },
    });
  } catch (err) {
    sendServerError(res, err, 'batchRoutes');
  }
});

// GET /api/batches/:id/qr-list — just QR urls for download
router.get('/:id/qr-list', protect, async (req, res) => {
  try {
    const packets = await SeedPacket.find({ batchId: req.params.id })
      .select('uniqueId qrCodeUrl status crop locationCode seedType serialNumber')
      .sort({ uniqueId: 1 });

    const batch = await SeedBatch.findById(req.params.id);
    const enrichedPackets = packets.map((p, idx) => {
      const pObj = p.toObject();
      if (!pObj.crop && batch) {
        pObj.crop = batch.crop || batch.seedType || '';
      }
      if (!pObj.locationCode && batch) {
        const parsed = parseLocationString(batch.locationCode);
        if (parsed) {
          pObj.locationCode = `${parsed.land} - ${parsed.line} - ${idx + 1}`;
        } else {
          pObj.locationCode = batch.locationCode || '';
        }
      }
      return pObj;
    });

    res.json({ success: true, packets: enrichedPackets });
  } catch (err) {
    sendServerError(res, err, 'batchRoutes');
  }
});

// GET /api/batches/:id — batch + all packets
// Kept below the fixed-path routes above (inventory, qr-list) so those
// literal segments never get swallowed by this param route.
router.get('/:id', protect, async (req, res) => {
  try {
    const batch = await SeedBatch.findById(req.params.id).populate('createdBy', 'name');
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

    const packets = await SeedPacket.find({ batchId: batch._id })
      .populate('operator', 'name')
      .sort({ uniqueId: 1 });

    const enrichedPackets = packets.map((p, idx) => {
      const pObj = p.toObject();
      if (!pObj.crop && batch) {
        pObj.crop = batch.crop || batch.seedType || '';
      }
      if (!pObj.locationCode && batch) {
        const parsed = parseLocationString(batch.locationCode);
        if (parsed) {
          pObj.locationCode = `${parsed.land} - ${parsed.line} - ${idx + 1}`;
        } else {
          pObj.locationCode = batch.locationCode || '';
        }
      }
      return pObj;
    });

    res.json({ success: true, batch, packets: enrichedPackets });
  } catch (err) {
    sendServerError(res, err, 'batchRoutes');
  }
});

module.exports = router;
