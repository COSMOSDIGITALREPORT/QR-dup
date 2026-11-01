import { useState } from 'react';
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Typography, Chip, CircularProgress, Grid,
  Checkbox, FormControlLabel,
} from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
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

const createInitialEntry = (id = 1) => ({
  id,
  cropName: '',
  seedCode: '',
  location: '',
  previousYear: '',
  previousLocation: '',
  gean: '',
  comments: '',
});

export default function NewBatchDialog({ open, onClose, onCreated }) {
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState('');
  const [entries, setEntries]         = useState([createInitialEntry()]);

  const handlePreset = (index, p) => {
    setEntries(prev => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        cropName: p.label,
        seedCode: p.code,
      };
      return copy;
    });
  };

  const handleEntryChange = (index, name, value) => {
    setEntries(prev => {
      const copy = [...prev];
      const cur = { ...copy[index], [name]: value };

      if (name === 'cropName') {
        cur.seedCode = getSeedCodeForCrop(value);
      }

      copy[index] = cur;
      return copy;
    });
  };

  const handleAddMore = () => {
    setEntries(prev => [...prev, createInitialEntry(Date.now() + Math.random())]);
  };

  const handleRemoveEntry = (index) => {
    setEntries(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleClose = () => {
    if (creating) return;
    setCreateError('');
    onClose();
  };

  const handleCreate = async () => {
    setCreateError('');

    // Validate each crop entry
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const prefix = entries.length > 1 ? `[Entry #${i + 1}] ` : '';
      if (!entry.cropName?.trim()) {
        setCreateError(`${prefix}Please enter Crop Name`);
        return;
      }
      if (!entry.seedCode?.trim()) {
        setCreateError(`${prefix}Please enter Seed Code`);
        return;
      }
      if (!entry.location?.trim()) {
        setCreateError(`${prefix}Please enter Location (e.g. R - 2 - 24)`);
        return;
      }
      const parsed = parseLocation(entry.location);
      if (!parsed) {
        setCreateError(`${prefix}Location must follow format: Land - Line - Count (e.g. R - 2 - 24)`);
        return;
      }
      if (parsed.count < 1 || parsed.count > 5000) {
        setCreateError(`${prefix}QR count in Location must be between 1 and 5000`);
        return;
      }
      if (entry.previousYear && String(entry.previousYear).trim()) {
        const py = Number(entry.previousYear);
        if (!Number.isFinite(py)) {
          setCreateError(`${prefix}PreviousYear must be a number`);
          return;
        }
      }
    }

    try {
      setCreating(true);
      const createdResponses = [];

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const parsed = parseLocation(entry.location);
        const land = parsed.land;
        const line = parsed.line;
        const count = parsed.count;
        const batchNum = `${land}-${line}`;
        const batchCd = `${land}${line}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'B1';
        const sc = entry.seedCode.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'SC';

        const payload = {
          batchName: `${entry.cropName.trim()} ${batchNum}`,
          seedType: entry.cropName.trim(),
          seedCategory: '',
          seedCode: sc,
          batchNumber: batchNum,
          batchCode: batchCd,
          count: count,
          crop: entry.cropName.trim(),
          locationCode: entry.location.trim(),
          previousYear: entry.previousYear && String(entry.previousYear).trim() ? Number(entry.previousYear) : null,
          previousLocationCode: entry.previousLocation?.trim() || '',
          gene: entry.gean?.trim() || '',
          comments: entry.comments?.trim() || '',
        };

        const res = await batchAPI.create(payload);
        if (!res.data.success || !res.data.batch?._id) {
          throw new Error(res.data.message || `Failed to create batch for entry #${i + 1}`);
        }
        createdResponses.push(res.data);
      }

      setEntries([createInitialEntry()]);
      setCreateError('');
      onCreated?.(createdResponses[0]);
      onClose();
    } catch (err) {
      setCreateError(err.response?.data?.message || err.message || 'Error creating batch');
    } finally {
      setCreating(false);
    }
  };

  // Calculate total QR codes across all entries
  const totalCount = entries.reduce((sum, e) => {
    const p = parseLocation(e.location);
    return sum + (p ? p.count : 0);
  }, 0);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3, maxHeight: '92vh' } }}
    >
      <DialogTitle sx={{ fontWeight: 800, fontSize: 18 }}>
        Create New Batch
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {entries.map((entry, index) => {
          const parsed = parseLocation(entry.location);
          const sc = entry.seedCode ? entry.seedCode.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
          const bc = parsed ? `${parsed.land}${parsed.line}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '';
          const previewPrd = sc && bc && parsed
            ? `PRD-${sc}${bc}-001  →  PRD-${sc}${bc}-${String(parsed.count).padStart(3, '0')}`
            : null;

          return (
            <Box
              key={entry.id || index}
              sx={{
                p: entries.length > 1 ? 2 : 0,
                mb: entries.length > 1 ? 2.5 : 1,
                borderRadius: 2.5,
                border: entries.length > 1 ? '1px solid #e2e8f0' : 'none',
                background: entries.length > 1 ? '#f8fafc' : 'transparent',
              }}
            >
              {entries.length > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, pb: 0.8, borderBottom: '1px solid #e2e8f0' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: 13.5, color: '#1a227f', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: '#1a227f', color: '#fff', fontSize: 11,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                    }}>
                      {index + 1}
                    </Box>
                    Crop Entry #{index + 1} {entry.cropName ? `— ${entry.cropName}` : ''}
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteOutlineIcon />}
                    onClick={() => handleRemoveEntry(index)}
                    sx={{ fontSize: 11.5, textTransform: 'none', fontWeight: 600 }}
                  >
                    Remove
                  </Button>
                </Box>
              )}

              {/* Crop Name Quick Select chips */}
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', mb: 1, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Quick Select
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7, mb: 2.5 }}>
                {SEED_PRESETS.map(p => {
                  const isSelected = (entry.cropName?.toLowerCase() === p.label.toLowerCase()) || (entry.seedCode === p.code);
                  return (
                    <Chip
                      key={p.code}
                      label={`${p.label} (${p.code})`}
                      size="small"
                      clickable
                      onClick={() => handlePreset(index, p)}
                      sx={{
                        fontWeight: 600, fontSize: 11,
                        background: isSelected ? 'rgba(26,34,127,0.12)' : '#f1f5f9',
                        color:      isSelected ? '#1a227f' : '#475569',
                        border:     isSelected ? '1px solid #1a227f' : '1px solid transparent',
                      }}
                    />
                  );
                })}
              </Box>

              <Grid container spacing={2}>
                {/* 1. Crop Name & Seed Code */}
                <Grid size={{ xs: 8 }}>
                  <TextField
                    fullWidth
                    label="Crop Name"
                    name="cropName"
                    value={entry.cropName}
                    onChange={(e) => handleEntryChange(index, 'cropName', e.target.value)}
                    size="small"
                    placeholder="e.g. Soyabean"
                  />
                </Grid>
                <Grid size={{ xs: 4 }}>
                  <TextField
                    fullWidth
                    label="Seed Code"
                    name="seedCode"
                    value={entry.seedCode}
                    onChange={(e) => handleEntryChange(index, 'seedCode', e.target.value)}
                    size="small"
                    inputProps={{ maxLength: 4, style: { textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 } }}
                    helperText="Auto-populated"
                  />
                </Grid>

                {/* 2. Location */}
                <Grid size={{ xs: 12 }}>
                  <TextField
                    fullWidth
                    label="Location"
                    name="location"
                    value={entry.location}
                    onChange={(e) => handleEntryChange(index, 'location', e.target.value)}
                    size="small"
                    placeholder="e.g. R - 2 - 24"
                    helperText="Format: Land - Line - Count (e.g. R - 2 - 24)"
                  />
                </Grid>

                {/* 3. PreviousYear & PreviousLocation */}
                <Grid size={{ xs: 6 }}>
                  <TextField
                    fullWidth
                    label="PreviousYear"
                    name="previousYear"
                    value={entry.previousYear}
                    onChange={(e) => handleEntryChange(index, 'previousYear', e.target.value)}
                    size="small"
                    type="number"
                    placeholder="e.g. 2025"
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    fullWidth
                    label="PreviousLocation"
                    name="previousLocation"
                    value={entry.previousLocation}
                    onChange={(e) => handleEntryChange(index, 'previousLocation', e.target.value)}
                    size="small"
                    placeholder="e.g. R - 1 - 24"
                  />
                </Grid>

                {/* 4. Gean & Comments */}
                <Grid size={{ xs: 6 }}>
                  <TextField
                    fullWidth
                    label="Gean"
                    name="gean"
                    value={entry.gean}
                    onChange={(e) => handleEntryChange(index, 'gean', e.target.value)}
                    size="small"
                    placeholder="e.g. Gean / Gene details"
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    fullWidth
                    label="Comments"
                    name="comments"
                    value={entry.comments}
                    onChange={(e) => handleEntryChange(index, 'comments', e.target.value)}
                    size="small"
                    placeholder="e.g. Remarks"
                  />
                </Grid>
              </Grid>

              {/* Individual QR preview based on Location */}
              {parsed && (
                <Box sx={{ mt: 2, p: 1.5, background: '#f0fdf4', borderRadius: 2, border: '1px solid #bbf7d0' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Individual QR Codes ({parsed.count} Total QRs)
                    </Typography>
                    <Chip
                      label={`${entry.cropName || 'Crop'} Associated`}
                      size="small"
                      sx={{ fontSize: 10, fontWeight: 700, background: '#dcfce7', color: '#15803d' }}
                    />
                  </Box>
                  <Typography sx={{ fontFamily: 'monospace', fontSize: 12, color: '#15803d', fontWeight: 700 }}>
                    {parsed.land} - {parsed.line} - 1  →  {parsed.land} - {parsed.line} - {parsed.count}
                  </Typography>
                  {previewPrd && (
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#3d47a3', mt: 0.3 }}>
                      {previewPrd}
                    </Typography>
                  )}
                  <Box sx={{
                    maxHeight: 100,
                    overflowY: 'auto',
                    mt: 0.7,
                    p: 1,
                    background: '#ffffff',
                    borderRadius: 1.5,
                    border: '1px solid #e2e8f0',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: '#334155',
                  }}>
                    {Array.from({ length: Math.min(parsed.count, 4) }, (_, i) => (
                      <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.2 }}>
                        <span>{i + 1}. {parsed.land} - {parsed.line} - {i + 1}</span>
                        <span style={{ color: '#64748b' }}>PRD-{sc || 'XX'}{bc || 'YY'}-{String(i + 1).padStart(3, '0')}</span>
                      </Box>
                    ))}
                    {parsed.count > 5 && (
                      <Box sx={{ color: '#94a3b8', fontStyle: 'italic', py: 0.2 }}>
                        ... Continue in sequence ({parsed.count - 5} more) ...
                      </Box>
                    )}
                    {parsed.count > 4 && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.2 }}>
                        <span>{parsed.count}. {parsed.land} - {parsed.line} - {parsed.count}</span>
                        <span style={{ color: '#64748b' }}>PRD-{sc || 'XX'}{bc || 'YY'}-{String(parsed.count).padStart(3, '0')}</span>
                      </Box>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}

        {/* Add More checkbox-style control */}
        <Box
          sx={{
            mt: 1.5,
            p: 1.2,
            border: '1.5px dashed #1a227f44',
            borderRadius: 2,
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            '&:hover': { background: '#f0f4ff', borderColor: '#1a227f' },
          }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={false}
                onChange={handleAddMore}
                sx={{
                  color: '#1a227f',
                  '&.Mui-checked': { color: '#1a227f' },
                }}
              />
            }
            label={
              <Box onClick={handleAddMore} sx={{ cursor: 'pointer' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1a227f' }}>
                  Add More
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: '#64748b' }}>
                  Check to add another complete crop entry form below
                </Typography>
              </Box>
            }
          />
          <Button
            size="small"
            variant="outlined"
            onClick={handleAddMore}
            startIcon={<AddIcon />}
            sx={{
              borderRadius: 2,
              borderColor: '#1a227f',
              color: '#1a227f',
              fontWeight: 700,
              textTransform: 'none',
              fontSize: 11.5,
            }}
          >
            Add More
          </Button>
        </Box>

        {entries.length > 1 && (
          <Box sx={{ p: 1.2, background: '#f1f5f9', borderRadius: 2, mt: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
              Total Entries: {entries.length}
            </Typography>
            <Chip
              label={`${totalCount} Total QRs`}
              size="small"
              sx={{ fontWeight: 800, background: '#1a227f', color: '#fff' }}
            />
          </Box>
        )}

        {createError && (
          <Box sx={{ mt: 2, p: 1.5, background: '#fef2f2', borderRadius: 2, border: '1px solid #fecaca' }}>
            <Typography sx={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>⚠ {createError}</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={handleClose} variant="outlined" sx={{ borderRadius: 2 }}>Cancel</Button>
        <Button
          onClick={handleCreate}
          variant="contained"
          disabled={creating}
          startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <QrCode2Icon />}
          sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2 }}
        >
          {creating ? 'Generating...' : `Generate ${totalCount ? `${totalCount} ` : ''}QRs`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
