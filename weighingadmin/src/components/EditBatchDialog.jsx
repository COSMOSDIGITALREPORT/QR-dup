import { useState, useEffect, useMemo } from 'react';
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Typography, Chip, CircularProgress, Grid,
  MenuItem, Alert, IconButton, Tooltip, Divider, Paper
} from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';
import EditNoteIcon from '@mui/icons-material/EditNote';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { batchAPI } from '../services/api';

const SEED_PRESETS = [
  { label: 'Soyabean',  code: 'SO' },
  { label: 'Wheat',     code: 'WH' },
  { label: 'Rice',      code: 'RI' },
  { label: 'Maize',     code: 'MA' },
  { label: 'Cotton',    code: 'CO' },
  { label: 'Mustard',   code: 'MU' },
  { label: 'Groundnut', code: 'GN' },
  { label: 'Sunflower', code: 'SF' },
];

const SEED_CATEGORY_OPTIONS = ['Organic', 'Hybrid', 'Open Pollinated', 'Heirloom', 'Conventional'];

export function getSeedCodeForCrop(cropName) {
  if (!cropName || typeof cropName !== 'string') return '';
  const trimmed = cropName.trim().toLowerCase();
  const found = SEED_PRESETS.find(p => p.label.toLowerCase() === trimmed);
  if (found) return found.code;
  const letters = cropName.replace(/[^A-Za-z]/g, '');
  return letters.slice(0, 2).toUpperCase();
}

export function parseLocation(loc) {
  if (!loc || typeof loc !== 'string') return null;
  const parts = loc.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 3) {
    const land = parts[0];
    const line = parts[1];
    const count = parseInt(parts[2], 10);
    if (land && line && !isNaN(count) && count > 0) {
      return { land, line, count, valid: true };
    }
  }
  return null;
}

const createInitialNewEntry = (id = 1) => ({
  id,
  cropName: '',
  seedCode: '',
  seedCategory: '',
  location: '',
  year: '',
  previousYear: '',
  previousLocation: '',
  gean: '',
  comments: '',
  extraQrCount: '',
});

export default function EditBatchDialog({ open, batchId, onClose, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [batch, setBatch] = useState(null);
  const [packets, setPackets] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Extra QR counts for existing entries: { [seedIndex]: number }
  const [existingExtraQrs, setExistingExtraQrs] = useState({});

  // Newly added seed entries via "Add More": array of entries
  const [newEntries, setNewEntries] = useState([]);

  // Fetch complete batch data and existing packets
  useEffect(() => {
    if (!open || !batchId) {
      setBatch(null);
      setPackets([]);
      setExistingExtraQrs({});
      setNewEntries([]);
      setError('');
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError('');

    batchAPI.getOne(batchId)
      .then(res => {
        if (!isMounted) return;
        const b = res.data.batch;
        const pkts = res.data.packets || [];
        setBatch(b);
        setPackets(pkts);

        // Normalize existing seeds array
        const seedsList = Array.isArray(b?.seeds) && b.seeds.length > 0
          ? b.seeds
          : [{
              crop: b.crop || b.seedType,
              seedType: b.seedType,
              seedCategory: b.seedCategory || '',
              seedCode: b.seedCode,
              batchNumber: b.batchNumber,
              batchCode: b.batchCode,
              count: b.count,
              land: (b.locationCode && b.locationCode.split('-')[0]?.trim()) || 'R',
              line: (b.locationCode && b.locationCode.split('-')[1]?.trim()) || '1',
              locationCode: b.locationCode,
              year: b.year,
              previousYear: b.previousYear,
              previousLocationCode: b.previousLocationCode,
              gene: b.gene,
              comments: b.comments,
            }];

        // Initialize extra QR count as 0 for each existing entry
        const initialExtras = {};
        seedsList.forEach((_, idx) => {
          initialExtras[idx] = '';
        });
        setExistingExtraQrs(initialExtras);
        setNewEntries([]);
      })
      .catch(err => {
        if (!isMounted) return;
        setError(err.response?.data?.message || 'Could not load batch details');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [open, batchId]);

  // Normalized list of existing seeds
  const existingSeeds = useMemo(() => {
    if (!batch) return [];
    if (Array.isArray(batch.seeds) && batch.seeds.length > 0) return batch.seeds;
    return [{
      crop: batch.crop || batch.seedType,
      seedType: batch.seedType,
      seedCategory: batch.seedCategory || '',
      seedCode: batch.seedCode,
      batchNumber: batch.batchNumber,
      batchCode: batch.batchCode,
      count: batch.count,
      land: (batch.locationCode && batch.locationCode.split('-')[0]?.trim()) || 'R',
      line: (batch.locationCode && batch.locationCode.split('-')[1]?.trim()) || '1',
      locationCode: batch.locationCode,
      year: batch.year,
      previousYear: batch.previousYear,
      previousLocationCode: batch.previousLocationCode,
      gene: batch.gene,
      comments: batch.comments,
    }];
  }, [batch]);

  // Calculate highest existing serial number for each existing seed entry
  const existingStats = useMemo(() => {
    return existingSeeds.map((s) => {
      const crop = s.crop || s.seedType;
      const sc = (s.seedCode || '').toUpperCase();
      const land = s.land || (s.locationCode ? s.locationCode.split('-')[0]?.trim() : 'R') || 'R';
      const line = s.line || (s.locationCode ? s.locationCode.split('-')[1]?.trim() : '1') || '1';

      const matching = packets.filter(p =>
        (p.crop === crop || p.seedType === crop) && (p.seedCode || '').toUpperCase() === sc
      );

      let maxSerial = 0;
      matching.forEach(p => {
        if (typeof p.serialNumber === 'number' && p.serialNumber > maxSerial) {
          maxSerial = p.serialNumber;
        } else if (p.locationCode) {
          const parts = p.locationCode.split(/\s*-\s*/);
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxSerial) maxSerial = num;
        }
      });
      if (maxSerial === 0) maxSerial = s.count || matching.length || 0;

      return {
        crop,
        sc: s.seedCode,
        bc: s.batchCode,
        land,
        line,
        currentMaxSerial: maxSerial,
        matchingPacketsCount: matching.length,
      };
    });
  }, [existingSeeds, packets]);

  // Calculate total new QRs to be generated
  const totalExtraFromExisting = useMemo(() => {
    return Object.values(existingExtraQrs).reduce((sum, v) => {
      const n = parseInt(v, 10);
      return sum + (isNaN(n) || n < 0 ? 0 : n);
    }, 0);
  }, [existingExtraQrs]);

  const totalFromNewEntries = useMemo(() => {
    return newEntries.reduce((sum, e) => {
      const p = parseLocation(e.location);
      const base = p ? p.count : 0;
      const extra = parseInt(e.extraQrCount, 10);
      return sum + base + (isNaN(extra) || extra < 0 ? 0 : extra);
    }, 0);
  }, [newEntries]);

  const totalNewQrs = totalExtraFromExisting + totalFromNewEntries;

  // Handlers for existing entries extra QR count
  const handleExistingExtraChange = (index, val) => {
    const num = val === '' ? '' : Math.max(0, parseInt(val, 10) || 0);
    setExistingExtraQrs(prev => ({ ...prev, [index]: num }));
  };

  // Handlers for newly added entries ("Add More")
  const handleAddNewEntry = () => {
    setNewEntries(prev => [...prev, createInitialNewEntry(Date.now() + Math.random())]);
  };

  const handleRemoveNewEntry = (index) => {
    setNewEntries(prev => prev.filter((_, i) => i !== index));
  };

  const handleNewEntryChange = (index, name, value) => {
    setNewEntries(prev => {
      const copy = [...prev];
      const cur = { ...copy[index], [name]: value };
      if (name === 'cropName') {
        cur.seedCode = getSeedCodeForCrop(value);
      }
      copy[index] = cur;
      return copy;
    });
  };

  const handlePreset = (index, p) => {
    setNewEntries(prev => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        cropName: p.label,
        seedCode: p.code,
      };
      return copy;
    });
  };

  // Save / Generate Extra QRs
  const handleSave = async () => {
    setError('');

    // Validate newly added entries
    for (let i = 0; i < newEntries.length; i++) {
      const e = newEntries[i];
      const prefix = `[New Entry #${i + 1}] `;
      if (!e.cropName?.trim()) {
        setError(`${prefix}Please enter Crop Name`);
        return;
      }
      if (!e.seedCode?.trim()) {
        setError(`${prefix}Please enter Seed Code`);
        return;
      }
      if (!e.location?.trim()) {
        setError(`${prefix}Please enter Location (e.g. R - 2 - 24)`);
        return;
      }
      const parsed = parseLocation(e.location);
      if (!parsed) {
        setError(`${prefix}Location must follow format: Land - Line - Count (e.g. R - 2 - 24)`);
        return;
      }
      if (parsed.count < 1 || parsed.count > 5000) {
        setError(`${prefix}QR count in Location must be between 1 and 5000`);
        return;
      }
      if (e.year && String(e.year).trim()) {
        const y = Number(e.year);
        if (!Number.isFinite(y)) {
          setError(`${prefix}Year must be a number`);
          return;
        }
      }
      if (e.previousYear && String(e.previousYear).trim()) {
        const py = Number(e.previousYear);
        if (!Number.isFinite(py)) {
          setError(`${prefix}PreviousYear must be a number`);
          return;
        }
      }
    }

    if (totalNewQrs === 0 && newEntries.length === 0) {
      setError('Please specify Extra QR count or add a new seed entry.');
      return;
    }

    try {
      setSaving(true);

      const existingEntriesUpdates = Object.entries(existingExtraQrs).map(([idx, count]) => ({
        seedIndex: Number(idx),
        extraQrCount: parseInt(count, 10) || 0,
      })).filter(u => u.extraQrCount > 0);

      const formattedNewEntries = newEntries.map(e => {
        const parsed = parseLocation(e.location);
        const land = parsed.land;
        const line = parsed.line;
        const count = parsed.count;
        const batchNum = `${land}-${line}`;
        const batchCd = `${land}${line}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'B1';
        const sc = e.seedCode.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'SC';
        const extra = parseInt(e.extraQrCount, 10) || 0;

        return {
          cropName: e.cropName.trim(),
          crop: e.cropName.trim(),
          seedType: e.cropName.trim(),
          seedCategory: e.seedCategory || '',
          seedCode: sc,
          batchNumber: batchNum,
          batchCode: batchCd,
          location: e.location.trim(),
          locationCode: e.location.trim(),
          extraQrCount: extra,
          year: e.year && String(e.year).trim() ? Number(e.year) : null,
          previousYear: e.previousYear && String(e.previousYear).trim() ? Number(e.previousYear) : null,
          previousLocation: e.previousLocation?.trim() || '',
          previousLocationCode: e.previousLocation?.trim() || '',
          gean: e.gean?.trim() || '',
          gene: e.gean?.trim() || '',
          comments: e.comments?.trim() || '',
        };
      });

      const res = await batchAPI.addExtraQRs(batchId, {
        existingEntriesUpdates,
        newEntries: formattedNewEntries,
      });

      if (!res.data.success) {
        throw new Error(res.data.message || 'Failed to update batch with extra QR codes');
      }

      onUpdated?.(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Error updating batch');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3, maxHeight: '92vh' } }}
    >
      <DialogTitle sx={{ p: 0 }}>
        <Box sx={{
          background: 'linear-gradient(135deg,#1a227f,#3d47a3)',
          p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff',
        }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <EditNoteIcon />
              <Typography sx={{ fontSize: 18, fontWeight: 800 }}>
                Edit Batch — {batch?.batchName || 'Loading...'}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'monospace', mt: 0.3 }}>
              {batch?.batchNumber ? `Batch #${batch.batchNumber} · ` : ''}
              {packets.length} existing QR codes · {existingSeeds.length} seed {existingSeeds.length === 1 ? 'type' : 'types'}
            </Typography>
          </Box>
          <IconButton onClick={() => { if (!saving) onClose(); }} sx={{ color: '#fff' }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 2.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : error && !batch ? (
          <Alert severity="error" sx={{ my: 2, borderRadius: 2 }}>{error}</Alert>
        ) : (
          <>
            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

            {/* Read-only notification banner */}
            <Paper elevation={0} sx={{ p: 1.5, mb: 2.5, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12.5, color: '#334155', fontWeight: 600 }}>
                ℹ️ <strong>Original batch information is preserved and read-only.</strong> Enter <strong>Extra QR</strong> to generate additional QR codes in continuous sequence, or click <strong>+ Add More</strong> to register a new seed entry under this same parent batch.
              </Typography>
            </Paper>

            {/* ── SECTION 1: EXISTING SEED ENTRIES ── */}
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#1a227f', letterSpacing: '0.05em', textTransform: 'uppercase', mb: 1.5 }}>
              Existing Seed Entries ({existingSeeds.length})
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mb: 3 }}>
              {existingSeeds.map((s, idx) => {
                const stat = existingStats[idx] || {};
                const extraVal = existingExtraQrs[idx] ?? '';
                const extraNum = parseInt(extraVal, 10) || 0;
                const currentMax = stat.currentMaxSerial || s.count || 0;
                const nextStart = currentMax + 1;
                const nextEnd = currentMax + extraNum;
                const sc = (s.seedCode || stat.sc || 'SC').toUpperCase();
                const bc = (s.batchCode || stat.bc || 'B1').toUpperCase();
                const land = stat.land || 'R';
                const line = stat.line || '1';

                return (
                  <Box key={idx} sx={{
                    p: 2, borderRadius: 2.5, border: '1.5px solid #e2e8f0',
                    background: '#ffffff', boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                  }}>
                    {/* Header of existing entry */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.8, pb: 1, borderBottom: '1px solid #f1f5f9' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={`#${idx + 1}`}
                          size="small"
                          sx={{ background: '#1a227f', color: '#fff', fontWeight: 800, fontSize: 11, height: 22 }}
                        />
                        <Typography sx={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>
                          {s.crop || s.seedType}
                        </Typography>
                        {s.seedCategory && (
                          <Chip label={s.seedCategory} size="small" sx={{ fontSize: 10, fontWeight: 700, background: '#f1f5f9' }} />
                        )}
                      </Box>
                      <Chip
                        label={`${currentMax} Existing QRs`}
                        size="small"
                        sx={{ background: 'rgba(26,34,127,0.08)', color: '#1a227f', fontWeight: 800, fontSize: 11 }}
                      />
                    </Box>

                    {/* Read-only original fields */}
                    <Grid container spacing={1.5} sx={{ mb: 2 }}>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField
                          fullWidth size="small" label="Crop Name"
                          value={s.crop || s.seedType || '—'}
                          InputProps={{ readOnly: true }}
                          sx={{ '& .MuiOutlinedInput-root': { background: '#f8fafc' } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 6, sm: 4 }}>
                        <TextField
                          fullWidth size="small" label="Seed Code"
                          value={s.seedCode || '—'}
                          InputProps={{ readOnly: true }}
                          sx={{ '& .MuiOutlinedInput-root': { background: '#f8fafc', fontFamily: 'monospace', fontWeight: 700 } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 6, sm: 4 }}>
                        <TextField
                          fullWidth size="small" label="Seed Type"
                          value={s.seedCategory || '—'}
                          InputProps={{ readOnly: true }}
                          sx={{ '& .MuiOutlinedInput-root': { background: '#f8fafc' } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth size="small" label="Location"
                          value={s.locationCode || (s.land && s.line ? `${s.land} - ${s.line} - ${s.count}` : '—')}
                          InputProps={{ readOnly: true }}
                          sx={{ '& .MuiOutlinedInput-root': { background: '#f8fafc', fontFamily: 'monospace' } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <TextField
                          fullWidth size="small" label="Year"
                          value={s.year ?? '—'}
                          InputProps={{ readOnly: true }}
                          sx={{ '& .MuiOutlinedInput-root': { background: '#f8fafc' } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <TextField
                          fullWidth size="small" label="PreviousYear"
                          value={s.previousYear ?? '—'}
                          InputProps={{ readOnly: true }}
                          sx={{ '& .MuiOutlinedInput-root': { background: '#f8fafc' } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          fullWidth size="small" label="PreviousLocation"
                          value={s.previousLocationCode || '—'}
                          InputProps={{ readOnly: true }}
                          sx={{ '& .MuiOutlinedInput-root': { background: '#f8fafc' } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <TextField
                          fullWidth size="small" label="Gean"
                          value={s.gene || '—'}
                          InputProps={{ readOnly: true }}
                          sx={{ '& .MuiOutlinedInput-root': { background: '#f8fafc' } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <TextField
                          fullWidth size="small" label="Comments"
                          value={s.comments || '—'}
                          InputProps={{ readOnly: true }}
                          sx={{ '& .MuiOutlinedInput-root': { background: '#f8fafc' } }}
                        />
                      </Grid>
                    </Grid>

                    {/* ── EXTRA QR FIELD (ONLY IN EDIT MODE) ── */}
                    <Box sx={{
                      p: 1.8, borderRadius: 2, background: '#f0f4ff', border: '1.5px solid #c7d2fe',
                      display: 'flex', flexDirection: 'column', gap: 1,
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <QrCode2Icon sx={{ color: '#1a227f' }} />
                          <Typography sx={{ fontWeight: 800, fontSize: 13, color: '#1a227f' }}>
                            Add Extra QR Codes
                          </Typography>
                        </Box>
                        <TextField
                          type="number"
                          size="small"
                          label="Extra QR"
                          placeholder="0"
                          value={extraVal}
                          onChange={(e) => handleExistingExtraChange(idx, e.target.value)}
                          inputProps={{ min: 0, max: 1000, style: { fontWeight: 800, fontSize: 13, textAlign: 'center' } }}
                          sx={{
                            width: 130, background: '#fff',
                            '& .MuiOutlinedInput-root': { borderRadius: 1.5, borderColor: '#1a227f' },
                          }}
                        />
                      </Box>

                      {/* Live sequential number preview */}
                      {extraNum > 0 ? (
                        <Box sx={{
                          p: 1.2, borderRadius: 1.5, background: '#ecfdf5', border: '1px solid #a7f3d0',
                          fontSize: 12, color: '#065f46',
                        }}>
                          <Box sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.3 }}>
                            <CheckCircleOutlineIcon fontSize="small" sx={{ color: '#059669' }} />
                            Will generate {extraNum} additional QR code{extraNum === 1 ? '' : 's'}:
                          </Box>
                          <Typography sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#047857' }}>
                            Location: {land} - {line} - {nextStart}  →  {land} - {line} - {nextEnd}
                          </Typography>
                          <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#059669', mt: 0.2 }}>
                            Packet IDs: PRD-{sc}{bc}-{String(nextStart).padStart(3, '0')} → PRD-{sc}{bc}-{String(nextEnd).padStart(3, '0')}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography sx={{ fontSize: 11, color: '#64748b' }}>
                          Current sequence: {land} - {line} - 1 → {land} - {line} - {currentMax}. Enter a number above to generate extra QRs continuing from {nextStart}.
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>

            {/* ── SECTION 2: NEWLY ADDED SEED ENTRIES ("ADD MORE") ── */}
            {newEntries.length > 0 && (
              <>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#16a34a', letterSpacing: '0.05em', textTransform: 'uppercase', mb: 1.5 }}>
                  Newly Added Seed Entries ({newEntries.length})
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mb: 2.5 }}>
                  {newEntries.map((entry, index) => {
                    const parsed = parseLocation(entry.location);
                    const extra = parseInt(entry.extraQrCount, 10) || 0;
                    const totalEntryCount = (parsed ? parsed.count : 0) + extra;
                    const sc = entry.seedCode ? entry.seedCode.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
                    const bc = parsed ? `${parsed.land}${parsed.line}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '';

                    return (
                      <Box key={entry.id || index} sx={{
                        p: 2, borderRadius: 2.5, border: '1.5px solid #bbf7d0',
                        background: '#f0fdf4',
                      }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, pb: 0.8, borderBottom: '1px solid #dcfce7' }}>
                          <Typography sx={{ fontWeight: 800, fontSize: 13.5, color: '#166534', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box sx={{
                              width: 22, height: 22, borderRadius: '50%',
                              background: '#16a34a', color: '#fff', fontSize: 11,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                            }}>
                              +{index + 1}
                            </Box>
                            New Entry #{index + 1} {entry.cropName ? `— ${entry.cropName}` : ''}
                          </Typography>
                          <Button
                            size="small"
                            color="error"
                            startIcon={<DeleteOutlineIcon />}
                            onClick={() => handleRemoveNewEntry(index)}
                            sx={{ fontSize: 11.5, textTransform: 'none', fontWeight: 600 }}
                          >
                            Remove
                          </Button>
                        </Box>

                        {/* Quick Presets */}
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7, mb: 2 }}>
                          {SEED_PRESETS.map(p => (
                            <Chip
                              key={p.code}
                              label={`${p.label} (${p.code})`}
                              size="small"
                              clickable
                              onClick={() => handlePreset(index, p)}
                              sx={{
                                fontWeight: 600, fontSize: 11,
                                background: (entry.cropName?.toLowerCase() === p.label.toLowerCase()) ? '#dcfce7' : '#ffffff',
                                color: (entry.cropName?.toLowerCase() === p.label.toLowerCase()) ? '#166534' : '#475569',
                                border: '1px solid #cbd5e1',
                              }}
                            />
                          ))}
                        </Box>

                        <Grid container spacing={2}>
                          <Grid size={{ xs: 8 }}>
                            <TextField
                              fullWidth size="small" label="Crop Name"
                              value={entry.cropName}
                              onChange={(e) => handleNewEntryChange(index, 'cropName', e.target.value)}
                              placeholder="e.g. Maize"
                              sx={{ background: '#fff' }}
                            />
                          </Grid>
                          <Grid size={{ xs: 4 }}>
                            <TextField
                              fullWidth size="small" label="Seed Code"
                              value={entry.seedCode}
                              onChange={(e) => handleNewEntryChange(index, 'seedCode', e.target.value)}
                              inputProps={{ maxLength: 4, style: { textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 } }}
                              sx={{ background: '#fff' }}
                            />
                          </Grid>

                          <Grid size={{ xs: 12 }}>
                            <TextField
                              select fullWidth size="small"
                              label="Seed Type"
                              value={entry.seedCategory || ''}
                              onChange={(e) => handleNewEntryChange(index, 'seedCategory', e.target.value)}
                              sx={{ background: '#fff' }}
                            >
                              <MenuItem value=""><em>Select Seed Type</em></MenuItem>
                              {SEED_CATEGORY_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                            </TextField>
                          </Grid>

                          <Grid size={{ xs: 8 }}>
                            <TextField
                              fullWidth size="small" label="Location"
                              value={entry.location}
                              onChange={(e) => handleNewEntryChange(index, 'location', e.target.value)}
                              placeholder="e.g. R - 3 - 10"
                              helperText="Format: Land - Line - Count (e.g. R - 3 - 10)"
                              sx={{ background: '#fff' }}
                            />
                          </Grid>
                          <Grid size={{ xs: 4 }}>
                            <TextField
                              fullWidth size="small" label="Extra QR"
                              type="number"
                              value={entry.extraQrCount}
                              onChange={(e) => handleNewEntryChange(index, 'extraQrCount', e.target.value)}
                              placeholder="0"
                              inputProps={{ min: 0 }}
                              helperText="Additional QRs"
                              sx={{ background: '#fff' }}
                            />
                          </Grid>

                          <Grid size={{ xs: 6 }}>
                            <TextField
                              fullWidth size="small" label="Year" type="number"
                              value={entry.year}
                              onChange={(e) => handleNewEntryChange(index, 'year', e.target.value)}
                              placeholder="e.g. 2026"
                              sx={{ background: '#fff' }}
                            />
                          </Grid>
                          <Grid size={{ xs: 6 }}>
                            <TextField
                              fullWidth size="small" label="PreviousYear" type="number"
                              value={entry.previousYear}
                              onChange={(e) => handleNewEntryChange(index, 'previousYear', e.target.value)}
                              placeholder="e.g. 2025"
                              sx={{ background: '#fff' }}
                            />
                          </Grid>

                          <Grid size={{ xs: 12 }}>
                            <TextField
                              fullWidth size="small" label="PreviousLocation"
                              value={entry.previousLocation}
                              onChange={(e) => handleNewEntryChange(index, 'previousLocation', e.target.value)}
                              placeholder="e.g. R - 1 - 10"
                              sx={{ background: '#fff' }}
                            />
                          </Grid>

                          <Grid size={{ xs: 6 }}>
                            <TextField
                              fullWidth size="small" label="Gean"
                              value={entry.gean}
                              onChange={(e) => handleNewEntryChange(index, 'gean', e.target.value)}
                              sx={{ background: '#fff' }}
                            />
                          </Grid>
                          <Grid size={{ xs: 6 }}>
                            <TextField
                              fullWidth size="small" label="Comments"
                              value={entry.comments}
                              onChange={(e) => handleNewEntryChange(index, 'comments', e.target.value)}
                              sx={{ background: '#fff' }}
                            />
                          </Grid>
                        </Grid>

                        {/* Sequence preview for new entry */}
                        {parsed && (
                          <Box sx={{ mt: 1.5, p: 1.2, background: '#ffffff', borderRadius: 1.5, border: '1px solid #bbf7d0', fontSize: 12 }}>
                            <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, color: '#166534' }}>
                              Will generate {totalEntryCount} QRs: {parsed.land} - {parsed.line} - 1 → {parsed.land} - {parsed.line} - {totalEntryCount}
                            </Typography>
                            {sc && bc && (
                              <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#4338ca', mt: 0.2 }}>
                                IDs: PRD-{sc}{bc}-001 → PRD-{sc}{bc}-{String(totalEntryCount).padStart(3, '0')}
                              </Typography>
                            )}
                          </Box>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              </>
            )}

            {/* "+ Add More" Button */}
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={handleAddNewEntry}
              sx={{
                width: '100%', py: 1.2, borderRadius: 2,
                borderStyle: 'dashed', borderWidth: 1.8,
                borderColor: '#1a227f', color: '#1a227f', fontWeight: 700, fontSize: 13,
                textTransform: 'none',
                '&:hover': { borderWidth: 1.8, background: 'rgba(26,34,127,0.04)', borderColor: '#1a227f' },
              }}
            >
              + Add More Seed Entry to This Batch
            </Button>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.8, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: totalNewQrs > 0 ? '#15803d' : '#64748b' }}>
          {totalNewQrs > 0
            ? `Total new QR codes to generate: ${totalNewQrs}`
            : 'Enter Extra QR count to generate new codes'
          }
        </Typography>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={() => { if (!saving) onClose(); }} disabled={saving} sx={{ fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <QrCode2Icon />}
            disabled={saving || totalNewQrs === 0}
            onClick={handleSave}
            sx={{
              background: 'linear-gradient(135deg,#1a227f,#3d47a3)',
              fontWeight: 700, px: 2.5, borderRadius: 2,
              '&:hover': { background: 'linear-gradient(135deg,#141a5e,#2d3590)' },
            }}
          >
            {saving
              ? 'Generating...'
              : totalNewQrs > 0
                ? `Save & Generate ${totalNewQrs} Extra QR${totalNewQrs === 1 ? '' : 's'}`
                : 'Save / Generate Extra QR'
            }
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
