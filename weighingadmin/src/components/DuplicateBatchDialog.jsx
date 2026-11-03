import { useState, useEffect, useMemo } from 'react';
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Typography, Chip, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, IconButton, Tooltip, Paper,
} from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import CloseIcon from '@mui/icons-material/Close';
import PrintIcon from '@mui/icons-material/Print';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { batchAPI } from '../services/api';

function normalizeLocationCode(loc) {
  if (!loc || typeof loc !== 'string') return '';
  return loc.replace(/\s+/g, '').toUpperCase();
}

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

function getSeedCodeForCrop(cropName) {
  if (!cropName || typeof cropName !== 'string') return 'SC';
  const trimmed = cropName.trim().toLowerCase();
  const found = SEED_PRESETS.find(p => p.label.toLowerCase() === trimmed);
  if (found) return found.code;
  const letters = cropName.replace(/[^A-Za-z]/g, '');
  return letters.slice(0, 2).toUpperCase() || 'SC';
}

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

function formatLocationDisplay(loc) {
  if (!loc || typeof loc !== 'string') return '';
  const parts = loc.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 3) {
    return `${parts[0]}-${parts[1]}-${parts[2]}`;
  }
  return loc.replace(/\s+/g, '');
}

export default function DuplicateBatchDialog({ open, batchId, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [batch, setBatch] = useState(null);
  const [batchName, setBatchName] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState(null);

  // Load batch data and group existing packets by location
  useEffect(() => {
    if (!open || !batchId) {
      setBatch(null);
      setBatchName('');
      setRows([]);
      setError('');
      setGeneratedResult(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError('');
    setGeneratedResult(null);

    batchAPI.getOne(batchId)
      .then(res => {
        if (!isMounted) return;
        const b = res.data.batch;
        const pkts = res.data.packets || [];
        setBatch(b);
        setBatchName(`${b.batchName || 'Batch'} (Duplicate)`);

        // Group packets by location code
        const locationMap = new Map();

        pkts.forEach(p => {
          const rawLoc = p.locationCode || b.locationCode || 'R-1-1';
          const normKey = normalizeLocationCode(rawLoc);
          const displayLoc = formatLocationDisplay(rawLoc);
          const cropName = p.crop || b.crop || b.seedType || 'Crop';

          if (!locationMap.has(normKey)) {
            locationMap.set(normKey, {
              location: displayLoc,
              crop: cropName,
              packets: [],
            });
          }
          locationMap.get(normKey).packets.push(p);
        });

        // Fallback if no packets found: create rows from batch seeds or locationCode
        if (locationMap.size === 0) {
          const seedsList = Array.isArray(b.seeds) && b.seeds.length > 0
            ? b.seeds
            : [{ crop: b.crop || b.seedType || 'Seed', locationCode: b.locationCode || 'R-1-1', count: b.count || 1 }];

          seedsList.forEach(s => {
            const rawLoc = s.locationCode || b.locationCode || 'R-1-1';
            const normKey = normalizeLocationCode(rawLoc);
            const displayLoc = formatLocationDisplay(rawLoc);
            const cropName = s.crop || b.crop || b.seedType || 'Crop';

            if (!locationMap.has(normKey)) {
              locationMap.set(normKey, {
                location: displayLoc,
                crop: cropName,
                packets: Array.from({ length: s.count || 1 }, () => ({ crop: cropName })),
              });
            }
          });
        }

        // Sort location rows naturally by line and sequence number
        const sortedEntries = Array.from(locationMap.values()).sort((a, b) => {
          const parseP = (s) => {
            const parts = (s.location || '').split('-');
            return {
              land: parts[0] || '',
              line: parseInt(parts[1], 10) || 0,
              seq: parseInt(parts[2], 10) || 0,
            };
          };
          const pa = parseP(a);
          const pb = parseP(b);
          if (pa.land !== pb.land) return pa.land.localeCompare(pb.land);
          if (pa.line !== pb.line) return pa.line - pb.line;
          return pa.seq - pb.seq;
        });

        const initialRows = sortedEntries.map((item, idx) => {
          const generatedCount = item.packets.length || 1;
          const initialCropNames = item.packets.map(p => p.crop || item.crop || 'Crop');

          return {
            id: `loc-row-${idx}`,
            crop: item.crop,
            location: item.location,
            generated: generatedCount,
            extra: 0,
            cropNames: initialCropNames,
          };
        });

        setRows(initialRows);
      })
      .catch(err => {
        if (!isMounted) return;
        setError(err.response?.data?.message || 'Failed to load batch details for duplication');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [open, batchId]);

  // Handle changes to Extra numeric input for a location row
  const handleExtraChange = (rowIndex, val) => {
    const extraNum = val === '' ? 0 : Math.max(0, parseInt(val, 10) || 0);

    setRows(prevRows => {
      const copy = [...prevRows];
      const target = { ...copy[rowIndex] };
      const generated = target.generated;
      const totalDesired = generated + extraNum;

      const currentNames = [...target.cropNames];
      if (totalDesired > currentNames.length) {
        // Expand with empty editable textboxes
        const diff = totalDesired - currentNames.length;
        for (let i = 0; i < diff; i++) {
          currentNames.push('');
        }
      } else if (totalDesired < currentNames.length) {
        // Trim back to desired total
        currentNames.splice(totalDesired);
      }

      target.extra = extraNum;
      target.cropNames = currentNames;
      copy[rowIndex] = target;
      return copy;
    });
  };

  // Handle editing a specific crop name in a row's cropNames list
  const handleCropNameChange = (rowIndex, nameIndex, value) => {
    setRows(prevRows => {
      const copy = [...prevRows];
      const target = { ...copy[rowIndex] };
      const names = [...target.cropNames];
      names[nameIndex] = value;
      target.cropNames = names;
      copy[rowIndex] = target;
      return copy;
    });
  };

  // Compute total QRs to be generated
  const totalQrs = useMemo(() => {
    return rows.reduce((sum, r) => sum + (r.cropNames?.length || 0), 0);
  }, [rows]);

  // Handle Generate QRs submission
  const handleGenerate = async () => {
    setError('');

    if (!batchName.trim()) {
      setError('Please enter a Batch Name for the duplicate batch.');
      return;
    }

    if (rows.length === 0) {
      setError('No location rows available to duplicate.');
      return;
    }

    // Validation: ensure every entry has a non-empty crop name
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];
      for (let cIdx = 0; cIdx < row.cropNames.length; cIdx++) {
        const name = (row.cropNames[cIdx] || '').trim();
        if (!name) {
          setError(`Crop name is mandatory for every entry. Please fill Crop Name for Location "${row.location}" (Entry #${cIdx + 1}).`);
          return;
        }
      }
    }

    if (totalQrs < 1 || totalQrs > 5000) {
      setError('Total QR codes must be between 1 and 5000.');
      return;
    }

    try {
      setGenerating(true);

      // 1. Resolve seedCode (never undefined, null or empty)
      let sc = (batch?.seedCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!sc && rows[0]?.cropNames[0]) {
        sc = getSeedCodeForCrop(rows[0].cropNames[0]);
      }
      if (!sc) sc = 'SC';

      // 2. Resolve batchCode (never undefined, null or empty)
      let bc = (batch?.batchCode || '').toUpperCase().replace(/[^A-Za-z0-9]/g, '');
      if (!bc && rows[0]?.location) {
        const p = parseLocationString(rows[0].location);
        if (p) bc = `${p.land}${p.line}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      }
      if (!bc) bc = 'B1';

      // 3. Count is the actual number of new QR codes being generated (not existing)
      const count = totalQrs;

      // 4. Location code
      const loc = (batch?.locationCode || (rows[0]?.location ? formatLocationDisplay(rows[0].location) : 'R-1-1')).trim();

      // 5. Crop name
      const firstCrop = (rows[0]?.cropNames[0] || batch?.seedType || batch?.crop || 'Crop').trim();

      // Multi-seed entries array for full backend compatibility
      const entries = [];
      rows.forEach(r => {
        const locStr = r.location;
        const parsed = parseLocationString(locStr) || { land: 'R', line: '1', count: 1 };
        const land = parsed.land || (batch?.locationCode ? batch.locationCode.split('-')[0]?.trim() : 'R') || 'R';
        const line = parsed.line || (batch?.locationCode ? batch.locationCode.split('-')[1]?.trim() : '1') || '1';
        const rowBc = `${land}${line}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || bc;

        r.cropNames.forEach((cn, cIdx) => {
          const entryCrop = cn.trim();
          const entrySc = batch?.seedCode || getSeedCodeForCrop(entryCrop) || sc;
          entries.push({
            cropName: entryCrop,
            crop: entryCrop,
            seedType: entryCrop,
            seedCategory: batch?.seedCategory || '',
            seedCode: entrySc,
            batchNumber: batch?.batchNumber || `${land}-${line}`,
            batchCode: rowBc,
            count: 1,
            srNo: parsed.count != null ? parsed.count : (cIdx + 1),
            land,
            line,
            location: locStr,
            locationCode: locStr,
          });
        });
      });

      const payload = {
        batchId,
        action: 'duplicate',
        seedCode: sc,
        batchCode: bc,
        count,
        location: loc,
        cropName: firstCrop,
        crop: firstCrop,
        seedType: firstCrop,
        batchNumber: batch?.batchNumber || 'R-2',
        batchName: batchName.trim(),
        rows: rows.map(r => ({
          location: r.location,
          cropNames: r.cropNames.map(cn => cn.trim()),
          generated: r.generated,
          extra: r.extra,
        })),
        entries,
      };

      const res = await batchAPI.duplicate(batchId, payload);
      if (!res.data.success) {
        throw new Error(res.data.message || 'Duplication failed');
      }

      setGeneratedResult(res.data);
      onSuccess?.(res.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Error generating duplicate QR codes');
    } finally {
      setGenerating(false);
    }
  };

  // Print newly generated labels
  const handlePrintGenerated = () => {
    if (!generatedResult || !generatedResult.packets?.length) return;
    const pkts = generatedResult.packets;
    const printWin = window.open('', '_blank');
    if (!printWin) {
      alert('Please allow popups to print QR codes.');
      return;
    }

    const baseUrl = batchAPI.qrBaseUrl();
    const cardsHtml = pkts.map(p => {
      const cropName = p.crop || 'Seed';
      const locCode = p.locationCode || '';
      const imgFullUrl = `${baseUrl}${p.qrCodeUrl}`;
      return `
        <div class="sticker-card">
          <img class="qr-img" src="${imgFullUrl}" alt="${p.uniqueId}" />
          <div class="crop-name">${cropName}</div>
          <div class="loc-code">${locCode}</div>
          <div class="pkt-id">${p.uniqueId}</div>
        </div>
      `;
    }).join('');

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8"/>
        <title>Print QR Codes — ${generatedResult.batch?.batchName || 'Duplicate Batch'}</title>
        <style>
          @page { size: auto; margin: 8mm; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            padding: 16px; color: #0f172a; background: #fff;
          }
          .header-bar {
            display: flex; justify-content: space-between; align-items: center;
            padding-bottom: 12px; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0;
          }
          .title { font-size: 18px; font-weight: 800; color: #1a227f; }
          .subtitle { font-size: 12px; color: #64748b; margin-top: 3px; }
          .btn-print {
            background: #1a227f; color: #fff; border: none; padding: 8px 20px;
            border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer;
          }
          .stickers-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;
          }
          .sticker-card {
            border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 10px;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            text-align: center; background: #fff; page-break-inside: avoid; break-inside: avoid;
          }
          .qr-img { width: 130px; height: 130px; object-fit: contain; display: block; }
          .crop-name { font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 6px; line-height: 1.2; }
          .loc-code { font-size: 12px; font-weight: 700; color: #1a227f; font-family: monospace; margin-top: 4px; }
          .pkt-id { font-size: 10px; font-weight: 700; color: #475569; margin-top: 2px; font-family: monospace; }
          @media print {
            .no-print { display: none !important; }
            body { padding: 0; }
            .stickers-grid { gap: 8px; }
            .sticker-card { border: 1px solid #94a3b8; }
          }
        </style>
      </head>
      <body>
        <div class="header-bar no-print">
          <div>
            <h1 class="title">${generatedResult.batch?.batchName || 'Duplicate Batch'}</h1>
            <div class="subtitle">${pkts.length} QR Stickers · Ready to Print</div>
          </div>
          <button class="btn-print" onclick="window.print()">🖨️ Print Labels</button>
        </div>
        <div class="stickers-grid">
          ${cardsHtml}
        </div>
        <script>
          window.onload = function() { setTimeout(function() { window.print(); }, 400); };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  };

  return (
    <Dialog
      open={open}
      onClose={generating ? undefined : onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3, maxHeight: '92vh' } }}
    >
      {/* Header bar */}
      <DialogTitle sx={{ p: 0 }}>
        <Box sx={{
          background: 'linear-gradient(135deg,#1a227f,#3d47a3)',
          p: 2.2, color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{
              width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <ContentCopyIcon sx={{ color: '#fff', fontSize: 20 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 17, fontWeight: 800 }}>
                Duplicate Batch & Location-wise QR Generation
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                {batch ? `${batch.batchName} · ${rows.length} Location${rows.length === 1 ? '' : 's'}` : 'Loading batch details...'}
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose} disabled={generating} sx={{ color: '#fff' }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 2.5, pb: 1 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : generatedResult ? (
          /* Success Screen */
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <CheckCircleOutlineIcon sx={{ fontSize: 60, color: '#16a34a', mb: 1.5 }} />
            <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
              Duplication Complete!
            </Typography>
            <Typography sx={{ fontSize: 14, color: '#475569', mt: 0.8 }}>
              Successfully created duplicate batch <strong>{generatedResult.batch?.batchName}</strong> with <strong>{generatedResult.packets?.length || totalQrs}</strong> independent QR codes.
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 3 }}>
              <Button
                variant="contained"
                startIcon={<PrintIcon />}
                onClick={handlePrintGenerated}
                sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', fontWeight: 700, borderRadius: 2 }}
              >
                Print {generatedResult.packets?.length} QR Labels
              </Button>
              <Button
                variant="outlined"
                onClick={onClose}
                sx={{ borderRadius: 2, fontWeight: 700 }}
              >
                Close
              </Button>
            </Box>
          </Box>
        ) : (
          /* Configuration & Location Table Form */
          <>
            {/* Batch Name configuration */}
            <Box sx={{ mb: 2.5, p: 2, background: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0' }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.8 }}>
                Duplicate Batch Name
              </Typography>
              <TextField
                fullWidth
                size="small"
                value={batchName}
                onChange={e => setBatchName(e.target.value)}
                placeholder="Enter new batch name"
                sx={{ background: '#fff' }}
                inputProps={{ style: { fontWeight: 700, fontSize: 14 } }}
              />
            </Box>

            {/* Instruction Banner */}
            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#475569' }}>
                Set additional QR counts and customize crop names for each location. Total entries = Generated + Extra.
              </Typography>
              <Chip
                label={`${totalQrs} Total QRs to Generate`}
                size="small"
                sx={{ background: '#1a227f', color: '#fff', fontWeight: 800, fontSize: 11.5 }}
              />
            </Box>

            {/* Location-wise Duplicate Table */}
            <TableContainer component={Paper} elevation={0} sx={{ maxHeight: 420, overflowY: 'auto', border: '1.5px solid #e2e8f0', borderRadius: 2 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ background: '#f8fafc', fontWeight: 800, fontSize: 12, color: '#1a227f', width: 140 }}>
                      Crop / Product
                    </TableCell>
                    <TableCell sx={{ background: '#f8fafc', fontWeight: 800, fontSize: 12, color: '#1a227f', width: 110 }}>
                      Location
                    </TableCell>
                    <TableCell align="center" sx={{ background: '#f8fafc', fontWeight: 800, fontSize: 12, color: '#1a227f', width: 95 }}>
                      Generated
                    </TableCell>
                    <TableCell align="center" sx={{ background: '#f8fafc', fontWeight: 800, fontSize: 12, color: '#1a227f', width: 95 }}>
                      Extra
                    </TableCell>
                    <TableCell sx={{ background: '#f8fafc', fontWeight: 800, fontSize: 12, color: '#1a227f' }}>
                      Crop Name Entries (Total: Generated + Extra)
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, rIdx) => (
                    <TableRow key={row.id || rIdx} hover sx={{ verticalAlign: 'top' }}>
                      {/* 1. Crop / Product */}
                      <TableCell sx={{ fontWeight: 700, fontSize: 12.5, color: '#0f172a', pt: 1.8 }}>
                        {row.crop}
                      </TableCell>

                      {/* 2. Location */}
                      <TableCell sx={{ pt: 1.5 }}>
                        <Chip
                          label={row.location}
                          size="small"
                          sx={{
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            fontSize: 11.5,
                            background: 'rgba(26,34,127,0.08)',
                            color: '#1a227f',
                          }}
                        />
                      </TableCell>

                      {/* 3. Generated (Read-only count) */}
                      <TableCell align="center" sx={{ fontWeight: 800, fontSize: 13, color: '#475569', pt: 1.8 }}>
                        {row.generated}
                      </TableCell>

                      {/* 4. Extra (Numeric input) */}
                      <TableCell align="center" sx={{ pt: 1.2 }}>
                        <TextField
                          type="number"
                          size="small"
                          value={row.extra}
                          onChange={e => handleExtraChange(rIdx, e.target.value)}
                          inputProps={{
                            min: 0,
                            max: 100,
                            style: { textAlign: 'center', fontWeight: 800, fontSize: 13, padding: '4px 6px' }
                          }}
                          sx={{ width: 75, background: '#fff' }}
                        />
                      </TableCell>

                      {/* 5. Crop Name Entries */}
                      <TableCell sx={{ pt: 1.2, pb: 1.2 }}>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                          {row.cropNames.map((name, cIdx) => (
                            <Box
                              key={cIdx}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.6,
                                background: '#f8fafc',
                                p: 0.4,
                                pl: 0.8,
                                borderRadius: 1.5,
                                border: '1px solid #e2e8f0',
                              }}
                            >
                              <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>
                                #{cIdx + 1}
                              </Typography>
                              <TextField
                                size="small"
                                value={name}
                                onChange={e => handleCropNameChange(rIdx, cIdx, e.target.value)}
                                placeholder={cIdx === 0 ? (row.crop || 'Crop Name') : `Crop ${cIdx + 1}`}
                                inputProps={{ style: { fontSize: 12, padding: '4px 8px', fontWeight: 600 } }}
                                sx={{ width: 165, background: '#fff' }}
                              />
                            </Box>
                          ))}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Error Message */}
            {error && (
              <Alert severity="error" sx={{ mt: 2, borderRadius: 2 }}>
                {error}
              </Alert>
            )}
          </>
        )}
      </DialogContent>

      {!generatedResult && (
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
              Preview: {rows.length} Locations · {totalQrs} Unique QRs
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={onClose} disabled={generating} variant="outlined" sx={{ borderRadius: 2 }}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              variant="contained"
              disabled={generating || totalQrs === 0}
              startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <QrCode2Icon />}
              sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2, fontWeight: 700, px: 2.5 }}
            >
              {generating ? 'Generating QRs...' : `Generate ${totalQrs ? `${totalQrs} ` : ''}QRs`}
            </Button>
          </Box>
        </DialogActions>
      )}
    </Dialog>
  );
}

