import { useState } from 'react';
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Typography, Chip, CircularProgress, Grid,
  MenuItem, Accordion, AccordionSummary, AccordionDetails,
  Checkbox, FormControlLabel, Divider,
} from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { batchAPI } from '../services/api';
import { BATCH_DETAIL_SECTIONS, BATCH_DETAIL_FIELDS, BATCH_DETAIL_TEXT_MAX, buildBatchDetails } from './batchDetailFields';

// Shared with the Batches page's "New Batch" flow (and Products' "New
// Batch" button) so there is exactly one implementation of batch creation —
// same fields, same validation, same POST /api/batches call, same permanent
// QR generation on the backend. Nothing here creates or fakes a batch on
// the frontend; the backend remains the sole source of truth.
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

const WAREHOUSE_OPTIONS = ['Warehouse A', 'Warehouse B', 'Warehouse C'];
const RACK_OPTIONS      = ['Rack 1', 'Rack 2', 'Rack 3', 'Rack 4'];
const SHELF_OPTIONS     = ['Shelf 1', 'Shelf 2', 'Shelf 3', 'Shelf 4'];
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

const createInitialEntry = (id = 1) => ({
  id,
  // Section 1: Crop Name & Seed Code
  cropName: '',
  seedType: '', // Seed Name
  seedCode: '', // Seed Code
  seedCategory: '', // Seed Type

  // Section 2: Location & QR count
  location: '', // e.g. R - 2 - 24
  count: '', // Number of QR Codes

  // Batch Identification
  batchNumber: '',
  batchCode: '',

  // Storage & Date
  month: '',
  year: '',
  warehouse: '',
  rack: '',
  shelf: '',

  // Section 3: Four new fields
  previousYear: '',
  previousLocation: '',
  gean: '',
  comments: '',

  // Seed-management details — all optional, all start blank.
  ...Object.fromEntries(BATCH_DETAIL_FIELDS.map(f => [f.name, ''])),
});

export default function NewBatchDialog({ open, onClose, onCreated }) {
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState('');
  const [entries, setEntries]         = useState([createInitialEntry()]);

  const handlePreset = (index, p) => {
    setEntries(prev => {
      const copy = [...prev];
      const cur = { ...copy[index] };
      cur.cropName = p.label;
      cur.seedType = p.label;
      cur.seedCode = p.code;
      cur.crop = p.label;
      copy[index] = cur;
      return copy;
    });
  };

  const handleEntryChange = (index, name, value) => {
    setEntries(prev => {
      const copy = [...prev];
      const cur = { ...copy[index], [name]: value };

      if (name === 'cropName') {
        // Automatically populate Seed Code based on selected/entered Crop Name
        cur.seedCode = getSeedCodeForCrop(value);
        if (!cur.seedType || SEED_PRESETS.some(p => p.label.toLowerCase() === cur.seedType.toLowerCase())) {
          cur.seedType = value;
        }
        cur.crop = value;
      }

      if (name === 'seedType') {
        if (!cur.cropName) {
          cur.cropName = value;
        }
        if (!cur.seedCode) {
          cur.seedCode = getSeedCodeForCrop(value);
        }
      }

      if (name === 'batchNumber') {
        cur.batchCode = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      }

      if (name === 'location') {
        cur.locationCode = value;
        const parsed = parseLocation(value);
        if (parsed) {
          cur.count = String(parsed.count);
          if (!cur.batchNumber) {
            cur.batchNumber = `${parsed.land}-${parsed.line}`;
            cur.batchCode = `${parsed.land}${parsed.line}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          }
        }
      }

      if (name === 'count') {
        const parsed = parseLocation(cur.location);
        if (parsed && value) {
          cur.location = `${parsed.land} - ${parsed.line} - ${value}`;
          cur.locationCode = cur.location;
        }
      }

      if (name === 'previousLocation') {
        cur.previousLocationCode = value;
      }
      if (name === 'previousLocationCode') {
        cur.previousLocation = value;
      }

      if (name === 'gean') {
        cur.gene = value;
      }
      if (name === 'gene') {
        cur.gean = value;
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
    // Validate each entry
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const prefix = entries.length > 1 ? `[Entry #${i + 1}] ` : '';
      const missing = [];
      const cropOrSeed = entry.cropName || entry.seedType;
      if (!cropOrSeed)       missing.push('Crop Name / Seed Name');
      if (!entry.seedCode)    missing.push('Seed Code');
      if (!entry.batchNumber) missing.push('Batch Number');
      if (!entry.batchCode)   missing.push('Batch Code');
      if (!entry.count)       missing.push('Number of QR Codes / Location count');
      if (missing.length > 0) {
        setCreateError(`${prefix}Please fill: ${missing.join(', ')}`);
        return;
      }

      const total = parseInt(entry.count, 10);
      if (isNaN(total) || total < 1 || total > 5000) {
        setCreateError(`${prefix}Number of QR Codes must be between 1 and 5000`);
        return;
      }

      const { error: detailError } = buildBatchDetails({
        ...entry,
        crop: entry.cropName || entry.seedType,
        locationCode: entry.location || entry.locationCode || '',
        previousLocationCode: entry.previousLocation || entry.previousLocationCode || '',
        gene: entry.gean || entry.gene || '',
        comments: entry.comments || '',
      });
      if (detailError) {
        setCreateError(`${prefix}${detailError}`);
        return;
      }
    }

    try {
      setCreating(true);
      const responses = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const { details } = buildBatchDetails({
          ...entry,
          crop: entry.cropName || entry.seedType,
          locationCode: entry.location || entry.locationCode || '',
          previousLocationCode: entry.previousLocation || entry.previousLocationCode || '',
          gene: entry.gean || entry.gene || '',
          comments: entry.comments || '',
        });

        const res = await batchAPI.create({
          batchName:    `${entry.cropName || entry.seedType} ${entry.batchNumber}`,
          seedType:     entry.seedType || entry.cropName,
          seedCategory: entry.seedCategory,
          seedCode:     entry.seedCode,
          batchNumber:  entry.batchNumber,
          batchCode:    entry.batchCode,
          count:        parseInt(entry.count, 10),
          month:        entry.month,
          year:         entry.year,
          warehouse:    entry.warehouse,
          rack:         entry.rack,
          shelf:        entry.shelf,
          ...details,
          crop:         entry.cropName || entry.seedType,
          locationCode: entry.location || entry.locationCode || '',
          previousLocationCode: entry.previousLocation || entry.previousLocationCode || '',
          gene:         entry.gean || entry.gene || '',
          comments:     entry.comments || '',
        });

        if (!res.data.success || !res.data.batch?._id) {
          throw new Error(res.data.message || `The server did not confirm batch #${i + 1} was saved`);
        }
        responses.push(res.data);
      }

      setEntries([createInitialEntry()]);
      setCreateError('');
      onCreated?.(responses[0]);
      onClose();
    } catch (err) {
      setCreateError(err.response?.data?.message || err.message || 'Error creating batch');
    } finally {
      setCreating(false);
    }
  };

  const totalCount = entries.reduce((sum, e) => sum + (parseInt(e.count, 10) || 0), 0);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3, maxHeight: '92vh' } }}
    >
      <DialogTitle sx={{ fontWeight: 800, fontSize: 18, borderBottom: '1px solid #e2e8f0' }}>
        Create New Batch
      </DialogTitle>
      <DialogContent sx={{ pt: 2.5 }}>
        {entries.map((entry, index) => {
          const parsedLoc = parseLocation(entry.location);
          const previewId = entry.seedCode && entry.batchCode && entry.count
            ? `PRD-${entry.seedCode}${entry.batchCode}-001  →  PRD-${entry.seedCode}${entry.batchCode}-${String(entry.count).padStart(3, '0')}`
            : null;

          return (
            <Box
              key={entry.id || index}
              sx={{
                p: entries.length > 1 ? 2.5 : 0,
                mb: entries.length > 1 ? 3 : 1.5,
                borderRadius: 2.5,
                border: entries.length > 1 ? '1px solid #cbd5e1' : 'none',
                background: entries.length > 1 ? '#ffffff' : 'transparent',
                boxShadow: entries.length > 1 ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              {entries.length > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, pb: 1, borderBottom: '1px solid #f1f5f9' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: 14, color: '#1a227f', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: '#1a227f', color: '#fff', fontSize: 12,
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
                    sx={{ fontSize: 12, textTransform: 'none', fontWeight: 600 }}
                  >
                    Remove Form
                  </Button>
                </Box>
              )}

              {/* Crop Name Quick Select chips */}
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', mb: 1, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Crop Name Quick Select
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7, mb: 2.5 }}>
                {SEED_PRESETS.map(p => {
                  const isSelected = (entry.cropName === p.label) || (entry.seedCode === p.code);
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
                {/* 1. Crop Name & Auto Seed Code */}
                <Grid size={{ xs: 12, sm: 8 }}>
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
                <Grid size={{ xs: 12, sm: 4 }}>
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

                {/* Existing Seed Name & Seed Type */}
                <Grid size={{ xs: 12, sm: 8 }}>
                  <TextField
                    fullWidth
                    label="Seed Name"
                    name="seedType"
                    value={entry.seedType}
                    onChange={(e) => handleEntryChange(index, 'seedType', e.target.value)}
                    size="small"
                    placeholder="e.g. Soybean JS-335"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    select
                    fullWidth
                    name="seedCategory"
                    value={entry.seedCategory}
                    onChange={(e) => handleEntryChange(index, 'seedCategory', e.target.value)}
                    size="small"
                    SelectProps={{
                      displayEmpty: true,
                      MenuProps: {
                        PaperProps: {
                          sx: {
                            mt: 0.5,
                            borderRadius: 2,
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
                          },
                        },
                      },
                    }}
                  >
                    <MenuItem value=""><em>Select Seed Type</em></MenuItem>
                    {SEED_CATEGORY_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                  </TextField>
                </Grid>

                {/* 2. Location & Number of QR Codes */}
                <Grid size={{ xs: 12, sm: 8 }}>
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
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    fullWidth
                    label="Number of QR Codes"
                    name="count"
                    value={entry.count}
                    onChange={(e) => handleEntryChange(index, 'count', e.target.value)}
                    size="small"
                    type="number"
                    placeholder="e.g. 24"
                    inputProps={{ min: 1, max: 5000 }}
                    helperText={entry.location ? "Synced with Location" : "1–5000"}
                  />
                </Grid>

                {/* Existing Batch Number & Batch Code */}
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Batch Number"
                    name="batchNumber"
                    value={entry.batchNumber}
                    onChange={(e) => handleEntryChange(index, 'batchNumber', e.target.value)}
                    size="small"
                    placeholder="e.g. BA-09"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Batch Code"
                    name="batchCode"
                    value={entry.batchCode}
                    onChange={(e) => handleEntryChange(index, 'batchCode', e.target.value)}
                    size="small"
                    inputProps={{ style: { textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700 } }}
                    helperText="Auto-derived"
                  />
                </Grid>

                {/* 3. Four New Fields: PreviousYear, PreviousLocation, Gean, Comments */}
                <Grid size={{ xs: 12, sm: 6 }}>
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
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="PreviousLocation"
                    name="previousLocation"
                    value={entry.previousLocation}
                    onChange={(e) => handleEntryChange(index, 'previousLocation', e.target.value)}
                    size="small"
                    placeholder="e.g. R - 1 - 20"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Gean"
                    name="gean"
                    value={entry.gean}
                    onChange={(e) => handleEntryChange(index, 'gean', e.target.value)}
                    size="small"
                    placeholder="e.g. Gean / Gene info"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Comments"
                    name="comments"
                    value={entry.comments}
                    onChange={(e) => handleEntryChange(index, 'comments', e.target.value)}
                    size="small"
                    placeholder="e.g. Remarks / comments"
                  />
                </Grid>

                {/* Existing Storage & Date fields */}
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Month"
                    name="month"
                    value={entry.month}
                    onChange={(e) => handleEntryChange(index, 'month', e.target.value)}
                    size="small"
                    type="number"
                    placeholder="e.g. 6"
                    inputProps={{ min: 1, max: 12 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Year"
                    name="year"
                    value={entry.year}
                    onChange={(e) => handleEntryChange(index, 'year', e.target.value)}
                    size="small"
                    type="number"
                    placeholder="e.g. 2026"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    select
                    fullWidth
                    name="warehouse"
                    value={entry.warehouse}
                    onChange={(e) => handleEntryChange(index, 'warehouse', e.target.value)}
                    size="small"
                    SelectProps={{ displayEmpty: true }}
                  >
                    <MenuItem value=""><em>Select Warehouse</em></MenuItem>
                    {WAREHOUSE_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    select
                    fullWidth
                    name="rack"
                    value={entry.rack}
                    onChange={(e) => handleEntryChange(index, 'rack', e.target.value)}
                    size="small"
                    SelectProps={{ displayEmpty: true }}
                  >
                    <MenuItem value=""><em>Select Rack</em></MenuItem>
                    {RACK_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    select
                    fullWidth
                    name="shelf"
                    value={entry.shelf}
                    onChange={(e) => handleEntryChange(index, 'shelf', e.target.value)}
                    size="small"
                    SelectProps={{ displayEmpty: true }}
                  >
                    <MenuItem value=""><em>Select Shelf</em></MenuItem>
                    {SHELF_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                  </TextField>
                </Grid>
              </Grid>

              {/* Seed Management Details (optional) Accordion */}
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', mt: 2.5, mb: 1, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Seed Management Details (optional)
              </Typography>
              {BATCH_DETAIL_SECTIONS.map(section => {
                const filled = section.fields.filter(f => String(entry[f.name]).trim() !== '').length;
                return (
                  <Accordion
                    key={section.title}
                    disableGutters
                    elevation={0}
                    sx={{ border: '1px solid #e2e8f0', borderRadius: '8px !important', mb: 1, '&:before': { display: 'none' } }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{ minHeight: 44, '& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1, my: 0.5 } }}
                    >
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{section.title}</Typography>
                      <Typography sx={{ fontSize: 11, fontWeight: 600, color: filled ? '#1a227f' : '#94a3b8' }}>
                        {filled} of {section.fields.length} filled
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0.5 }}>
                      <Grid container spacing={2}>
                        {section.fields.map(f => (
                          <Grid key={f.name} size={{ xs: 12, sm: f.multiline ? 12 : 6 }}>
                            <TextField
                              fullWidth
                              label={f.label}
                              name={f.name}
                              value={entry[f.name]}
                              onChange={(e) => handleEntryChange(index, f.name, e.target.value)}
                              size="small"
                              type={f.type === 'number' ? 'number' : 'text'}
                              multiline={!!f.multiline}
                              minRows={f.multiline ? 2 : undefined}
                              placeholder={f.placeholder}
                              helperText={f.helperText}
                              inputProps={f.type === 'number' ? { step: 'any' } : { maxLength: BATCH_DETAIL_TEXT_MAX }}
                            />
                          </Grid>
                        ))}
                      </Grid>
                    </AccordionDetails>
                  </Accordion>
                );
              })}

              {/* QR Preview & Sequence Display */}
              {entry.location && parsedLoc ? (
                <Box sx={{ mt: 2, p: 1.5, background: '#f0fdf4', borderRadius: 2, border: '1px solid #bbf7d0' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      QR Codes & Location Sequence ({parsedLoc.count} Individual QRs)
                    </Typography>
                    <Chip
                      label={`${entry.cropName || entry.seedType || 'Crop'} Associated`}
                      size="small"
                      sx={{ fontSize: 10, fontWeight: 700, background: '#dcfce7', color: '#15803d' }}
                    />
                  </Box>
                  <Typography sx={{ fontFamily: 'monospace', fontSize: 12, color: '#15803d', fontWeight: 700 }}>
                    {parsedLoc.land} - {parsedLoc.line} - 1  →  {parsedLoc.land} - {parsedLoc.line} - {parsedLoc.count}
                  </Typography>
                  {previewId && (
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#3d47a3', mt: 0.5 }}>
                      {previewId}
                    </Typography>
                  )}
                  <Typography sx={{ fontSize: 11, color: '#475569', mt: 0.5 }}>
                    {parsedLoc.count} individual QR codes will be generated in sequence:
                  </Typography>
                  <Box sx={{
                    maxHeight: 110,
                    overflowY: 'auto',
                    mt: 0.7,
                    p: 1,
                    background: '#ffffff',
                    borderRadius: 1.5,
                    border: '1px solid #e2e8f0',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: '#334155'
                  }}>
                    {Array.from({ length: Math.min(parsedLoc.count, 5) }, (_, i) => (
                      <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.2 }}>
                        <span>{i + 1}. {parsedLoc.land} - {parsedLoc.line} - {i + 1}</span>
                        <span style={{ color: '#64748b' }}>PRD-{entry.seedCode || 'XX'}{entry.batchCode || 'YY'}-{String(i + 1).padStart(3, '0')}</span>
                      </Box>
                    ))}
                    {parsedLoc.count > 6 && (
                      <Box sx={{ color: '#94a3b8', fontStyle: 'italic', py: 0.3 }}>
                        ... Continue in sequence ({parsedLoc.count - 6} more) ...
                      </Box>
                    )}
                    {parsedLoc.count > 5 && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.2 }}>
                        <span>{parsedLoc.count}. {parsedLoc.land} - {parsedLoc.line} - {parsedLoc.count}</span>
                        <span style={{ color: '#64748b' }}>PRD-{entry.seedCode || 'XX'}{entry.batchCode || 'YY'}-{String(parsedLoc.count).padStart(3, '0')}</span>
                      </Box>
                    )}
                  </Box>
                </Box>
              ) : previewId ? (
                <Box sx={{ mt: 2, p: 1.5, background: '#f0f4ff', borderRadius: 2, border: '1px solid #c7d2fe' }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#1a227f', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Preview</Typography>
                  <Typography sx={{ fontFamily: 'monospace', fontSize: 12, color: '#3d47a3', fontWeight: 700 }}>{previewId}</Typography>
                  <Typography sx={{ fontSize: 11, color: '#64748b', mt: 0.3 }}>{entry.count} unique QR codes will be generated</Typography>
                </Box>
              ) : null}
            </Box>
          );
        })}

        {/* 4. Add More – Unlimited Repeatable Form Sections */}
        <Box
          sx={{
            mt: 2,
            mb: 2,
            p: 1.5,
            border: '2px dashed #1a227f44',
            borderRadius: 2.5,
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
                <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: '#1a227f' }}>
                  Add More
                </Typography>
                <Typography sx={{ fontSize: 11, color: '#64748b' }}>
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
              fontSize: 12,
              '&:hover': { background: 'rgba(26,34,127,0.06)', borderColor: '#1a227f' },
            }}
          >
            Add More
          </Button>
        </Box>

        {entries.length > 1 && (
          <Box sx={{ p: 1.5, background: '#f1f5f9', borderRadius: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              Total Forms: {entries.length} crop entries
            </Typography>
            <Chip
              label={`${totalCount} Total QRs`}
              color="primary"
              size="small"
              sx={{ fontWeight: 800, background: '#1a227f' }}
            />
          </Box>
        )}

        {createError && (
          <Box sx={{ mt: 2, p: 1.5, background: '#fef2f2', borderRadius: 2, border: '1px solid #fecaca' }}>
            <Typography sx={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>⚠ {createError}</Typography>
          </Box>
        )}
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button onClick={handleClose} variant="outlined" sx={{ borderRadius: 2 }}>Cancel</Button>
        <Button
          onClick={handleCreate}
          variant="contained"
          disabled={creating}
          startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <QrCode2Icon />}
          sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2 }}
        >
          {creating ? 'Generating...' : `Generate ${totalCount || ''} QRs`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
