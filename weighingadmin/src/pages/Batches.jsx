import { useState, useEffect } from 'react';
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Typography, Chip, IconButton, Tooltip, CircularProgress,
  Grid, InputAdornment, LinearProgress, Avatar, Alert, Snackbar,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import DownloadIcon from '@mui/icons-material/Download';
import PrintIcon from '@mui/icons-material/Print';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import InventoryIcon from '@mui/icons-material/Inventory';
import AllInboxIcon from '@mui/icons-material/AllInbox';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ImageIcon from '@mui/icons-material/Image';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import NewBatchDialog from '../components/NewBatchDialog';
import EditBatchDialog from '../components/EditBatchDialog';
import DuplicateBatchDialog from '../components/DuplicateBatchDialog';
import { BATCH_DETAIL_FIELDS } from '../components/batchDetailFields';
import { batchAPI } from '../services/api';

// Same hardcoded API host already used elsewhere in this app for resolving
// relative/local paths — a real Cloudinary URL is already absolute and must
// be used as-is (Step 14 rule: never prefix an absolute URL).
const resolvePhotoUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${batchAPI.qrBaseUrl()}${url}`;
};

const GRADIENTS = [
  'linear-gradient(135deg,#1a227f,#3d47a3)',
  'linear-gradient(135deg,#065f46,#059669)',
  'linear-gradient(135deg,#7c2d12,#ea580c)',
  'linear-gradient(135deg,#4c1d95,#7c3aed)',
  'linear-gradient(135deg,#831843,#db2777)',
  'linear-gradient(135deg,#1e3a5f,#0ea5e9)',
  'linear-gradient(135deg,#3b2500,#d97706)',
  'linear-gradient(135deg,#14532d,#16a34a)',
];

export default function Batches() {
  const [batches, setBatches]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [createOpen, setCreateOpen]   = useState(false);
  const [successMsg, setSuccessMsg]   = useState('');
  // QR drawer state
  const [qrBatch,    setQrBatch]    = useState(null);
  const [packets,    setPackets]    = useState([]);
  const [qrLoading,  setQrLoading]  = useState(false);
  const [dlLoading,  setDlLoading]  = useState({}); // batchId → true/false
  const [printLoading, setPrintLoading] = useState({}); // batchId → true/false

  // Batch detail dialog state (Step 14) — real SeedBatch + real SeedPacket
  // data from the existing GET /api/batches/:id endpoint.
  const [detailBatch,   setDetailBatch]   = useState(null);
  const [detailPackets, setDetailPackets] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError,   setDetailError]   = useState('');
  const [editBatchId,   setEditBatchId]   = useState(null);
  const [duplicateBatchId, setDuplicateBatchId] = useState(null);
  const [packetSearch,  setPacketSearch]  = useState('');
  const [viewPhoto,     setViewPhoto]     = useState(null); // { url, label } | null

  useEffect(() => { fetchBatches(); }, []);

  const fetchBatches = async () => {
    try {
      setLoading(true);
      const { data } = await batchAPI.getAll();
      setBatches(data.batches || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const openQRDrawer = async (batch) => {
    setQrBatch(batch);
    setPackets([]);
    setQrLoading(true);
    try {
      const { data } = await batchAPI.qrList(batch._id);
      setPackets(data.packets || []);
    } catch { /* silent */ }
    finally { setQrLoading(false); }
  };

  // Batch Details dialog — real SeedBatch fields + full real SeedPacket list
  // (status, weights, difference, photos, operator, deviceId) via the
  // existing GET /api/batches/:id endpoint. Read-only: never edits a packet.
  const openDetailDialog = async (batch) => {
    setDetailBatch(batch);
    setDetailPackets([]);
    setDetailError('');
    setPacketSearch('');
    setDetailLoading(true);
    try {
      const { data } = await batchAPI.getOne(batch._id);
      setDetailBatch(data.batch);
      setDetailPackets(data.packets || []);
    } catch (err) {
      setDetailError(err.response?.data?.message || 'Could not load batch details');
    } finally {
      setDetailLoading(false);
    }
  };

  // Generates styled PNG download with QR Code, Crop Name below it, and individual Location Code below that
  const downloadStyledQR = async (qrRelativeUrl, cropName, locationCode, uniqueId) => {
    try {
      const imgUrl = `${batchAPI.qrBaseUrl()}${qrRelativeUrl}`;
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => {
          fetch(imgUrl)
            .then(r => r.blob())
            .then(blob => {
              img.src = URL.createObjectURL(blob);
              img.onload = () => resolve();
              img.onerror = reject;
            })
            .catch(reject);
        };
        img.src = imgUrl;
      });

      const canvas = document.createElement('canvas');
      const width = 450;
      const height = 550;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Card subtle border
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.strokeRect(3, 3, width - 6, height - 6);

      // Draw QR code centered (350x350)
      const qrSize = 350;
      const qrX = (width - qrSize) / 2;
      const qrY = 25;
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

      // Text 1: Crop Name (bold)
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cropName || 'Seed Batch', width / 2, 415);

      // Text 2: Individual Location Code (bold monospace)
      ctx.fillStyle = '#1a227f';
      ctx.font = 'bold 20px "Courier New", Courier, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(locationCode || '', width / 2, 452);

      // Text 3: Packet ID (bold)
      ctx.fillStyle = '#475569';
      ctx.font = 'bold 13px "Courier New", Courier, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(uniqueId, width / 2, 485);

      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      const safeLoc = locationCode ? locationCode.replace(/\s+/g, '') : '';
      a.download = `${uniqueId}${safeLoc ? `_${safeLoc}` : ''}.png`;
      a.click();
    } catch {
      // Direct fallback
      const a = document.createElement('a');
      a.href = `${batchAPI.qrBaseUrl()}${qrRelativeUrl}`;
      a.download = `${uniqueId}.png`;
      a.target = '_blank';
      a.click();
    }
  };

  const downloadAll = () => {
    packets.forEach((p, i) => setTimeout(() => downloadStyledQR(p.qrCodeUrl, p.crop || qrBatch?.seedType, p.locationCode, p.uniqueId), i * 150));
  };

  const downloadBatch = async (batch) => {
    setDlLoading(prev => ({ ...prev, [batch._id]: true }));
    try {
      const { data } = await batchAPI.qrList(batch._id);
      const pkts = data.packets || [];
      pkts.forEach((p, i) => setTimeout(() => downloadStyledQR(p.qrCodeUrl, p.crop || batch.crop || batch.seedType, p.locationCode, p.uniqueId), i * 150));
    } catch { /* silent */ }
    finally { setDlLoading(prev => ({ ...prev, [batch._id]: false })); }
  };

  // Printable layout displaying QR code, Crop Name below QR code, and individual Location Code below Crop Name
  const handlePrintBatch = async (batch) => {
    setPrintLoading(prev => ({ ...prev, [batch._id]: true }));
    try {
      const { data } = await batchAPI.qrList(batch._id);
      const pkts = data.packets || [];
      if (pkts.length === 0) {
        alert('No QR codes available to print for this batch.');
        return;
      }

      const printWin = window.open('', '_blank');
      if (!printWin) {
        alert('Please allow popups to print QR codes.');
        return;
      }

      const baseUrl = batchAPI.qrBaseUrl();
      const cardsHtml = pkts.map(p => {
        const cropName = p.crop || batch.crop || batch.seedType || 'Seed';
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
          <title>Print QR Codes - ${batch.batchName}</title>
          <style>
            @page {
              size: auto;
              margin: 8mm;
            }
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
              margin: 0;
              padding: 16px;
              color: #0f172a;
              background: #fff;
            }
            .header-bar {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding-bottom: 12px;
              margin-bottom: 16px;
              border-bottom: 2px solid #e2e8f0;
            }
            .title {
              font-size: 20px;
              font-weight: 800;
              color: #1a227f;
              margin: 0;
            }
            .subtitle {
              font-size: 13px;
              color: #64748b;
              margin-top: 4px;
            }
            .btn-print {
              background: #1a227f;
              color: #fff;
              border: none;
              padding: 9px 20px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 700;
              cursor: pointer;
            }
            .stickers-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
              gap: 16px;
            }
            .sticker-card {
              border: 1.5px solid #cbd5e1;
              border-radius: 8px;
              padding: 12px;
              text-align: center;
              background: #ffffff;
              page-break-inside: avoid;
              break-inside: avoid;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
            }
            .qr-img {
              width: 140px;
              height: 140px;
              object-fit: contain;
              display: block;
            }
            .crop-name {
              font-size: 15px;
              font-weight: 800;
              color: #0f172a;
              margin-top: 8px;
              line-height: 1.2;
            }
            .loc-code {
              font-size: 13px;
              font-weight: 700;
              color: #1a227f;
              margin-top: 4px;
              font-family: monospace;
              letter-spacing: 0.04em;
            }
            .pkt-id {
              font-size: 10px;
              font-weight: 700;
              color: #475569;
              margin-top: 3px;
              font-family: monospace;
            }
            @media print {
              .header-bar { display: none !important; }
              body { padding: 0; }
              .stickers-grid {
                gap: 10px;
              }
              .sticker-card {
                border: 1px solid #94a3b8;
              }
            }
          </style>
        </head>
        <body>
          <div class="header-bar">
            <div>
              <h1 class="title">${batch.batchName}</h1>
              <div class="subtitle">${pkts.length} QR Stickers · Ready to Print</div>
            </div>
            <button class="btn-print" onclick="window.print()">Print Labels</button>
          </div>
          <div class="stickers-grid">
            ${cardsHtml}
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() { window.print(); }, 400);
            };
          </script>
        </body>
        </html>
      `);
      printWin.document.close();
    } catch (err) {
      alert('Failed to load QR codes for printing');
    } finally {
      setPrintLoading(prev => ({ ...prev, [batch._id]: false }));
    }
  };

  // Aggregate stats
  const totalQRs    = batches.reduce((s, b) => s + b.count, 0);
  const totalFilled = batches.reduce((s, b) => s + (b.filledCount || 0), 0);

  return (
    <Layout>
      <PageHeader
        title="Seed Batches"
        subtitle="Generate and manage bulk QR codes for seed packets"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2, px: 2.5 }}>
            New Batch
          </Button>
        }
      />

      {/* Summary bar */}
      {!loading && batches.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          {[
            { icon: <InventoryIcon sx={{ fontSize: 20 }} />, label: 'Total Batches', value: batches.length, color: '#1a227f', bg: 'rgba(26,34,127,0.07)' },
            { icon: <AllInboxIcon  sx={{ fontSize: 20 }} />, label: 'Total QR Codes', value: totalQRs,        color: '#0369a1', bg: '#f0f9ff' },
            { icon: <TaskAltIcon   sx={{ fontSize: 20 }} />, label: 'Filled Packets', value: totalFilled,     color: '#15803d', bg: '#f0fdf4' },
          ].map(s => (
            <Box key={s.label} sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              background: s.bg, borderRadius: 2.5, px: 2.5, py: 1.5,
              border: `1px solid ${s.color}22`, flex: '1 1 140px',
            }}>
              <Box sx={{ color: s.color }}>{s.icon}</Box>
              <Box>
                <Typography sx={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</Typography>
                <Typography sx={{ fontSize: 11, color: '#64748b', fontWeight: 600, mt: 0.2 }}>{s.label}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}>
          <CircularProgress />
        </Box>
      ) : batches.length === 0 ? (
        <Box sx={{
          textAlign: 'center', py: 12, border: '2px dashed #e2e8f0',
          borderRadius: 4, background: '#fafafa',
        }}>
          <QrCode2Icon sx={{ fontSize: 64, color: '#cbd5e1', mb: 2 }} />
          <Typography sx={{ fontWeight: 700, fontSize: 16, color: '#475569' }}>No batches yet</Typography>
          <Typography sx={{ fontSize: 13, color: '#94a3b8', mt: 0.5, mb: 3 }}>Create your first batch to generate QR sticker codes</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)', borderRadius: 2 }}>
            Create First Batch
          </Button>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {batches.map((b, idx) => {
            const SC      = b.seedCode, BC = b.batchCode;
            const filled  = b.filledCount || 0;
            const pct     = b.count > 0 ? Math.round((filled / b.count) * 100) : 0;
            const gradient = GRADIENTS[idx % GRADIENTS.length];
            const first   = `PRD-${SC}${BC}-001`;
            const last    = `PRD-${SC}${BC}-${String(b.count).padStart(3,'0')}`;
            const hasMultipleSeeds = b.seeds && b.seeds.length > 1;

            return (
              <Box key={b._id} sx={{
                display: 'flex', alignItems: 'stretch',
                borderRadius: 3, border: '1px solid #e2e8f0', overflow: 'hidden',
                background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: '0 6px 24px rgba(0,0,0,0.1)' },
              }}>

                {/* Left accent strip */}
                <Box sx={{
                  width: 88, flexShrink: 0, background: gradient,
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 0.5, p: 2, position: 'relative', overflow: 'hidden',
                }}>
                  <Box sx={{ position:'absolute', top:-18, right:-18, width:60, height:60, borderRadius:'50%', background:'rgba(255,255,255,0.1)' }} />
                  <Typography sx={{ fontSize: 22, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{SC}</Typography>
                  <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600, fontFamily: 'monospace' }}>{BC}</Typography>
                  {hasMultipleSeeds && (
                    <Chip label={`+${b.seeds.length - 1}`} size="small"
                      sx={{ background: 'rgba(255,255,255,0.25)', color: '#fff', fontWeight: 800, fontSize: 9, height: 16, mt: 0.4 }} />
                  )}
                </Box>

                {/* Main content */}
                <Box sx={{ flex: 1, p: 2.5, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', minWidth: 0 }}>

                  {/* Batch info */}
                  <Box sx={{ minWidth: 180, flex: '1 1 180px' }}>
                    {b.seeds && b.seeds.length > 0 ? (
                      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 0.8 }}>
                        {b.seeds.map((s, sIdx) => (
                          <Chip
                            key={sIdx}
                            label={`${s.crop || s.seedType}${s.batchNumber ? ` (${s.batchNumber})` : ''}`}
                            size="small"
                            sx={{
                              background: 'rgba(26,34,127,0.08)',
                              color: '#1a227f',
                              fontWeight: 700,
                              fontSize: 10,
                              height: 20,
                            }}
                          />
                        ))}
                      </Box>
                    ) : (
                      <Chip label={b.seedType} size="small"
                        sx={{ background: 'rgba(26,34,127,0.08)', color: '#1a227f', fontWeight: 700, fontSize: 10, mb: 0.8, height: 20 }} />
                    )}
                    <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>
                      {b.batchName}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 0.3, fontFamily: 'monospace' }}>
                      {hasMultipleSeeds ? `${b.seeds.length} Seed Types · ` : (b.batchNumber ? `${b.batchNumber} · ` : '')}
                      {new Date(b.createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}
                    </Typography>
                  </Box>

                  {/* QR Range */}
                  <Box sx={{ minWidth: 160, flex: '1 1 160px' }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', mb: 0.5 }}>QR ID RANGE</Typography>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#1a227f' }}>{first}</Typography>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>→ {last}</Typography>
                  </Box>

                  {/* Stats */}
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flex: '0 0 auto' }}>
                    {[
                      { label: 'TOTAL', value: b.count,          bg: '#f0f4ff', color: '#1a227f' },
                      { label: 'FILLED', value: filled,           bg: '#f0fdf4', color: '#15803d' },
                      { label: 'EMPTY',  value: b.count - filled, bg: '#fff7ed', color: '#c2410c' },
                    ].map(s => (
                      <Box key={s.label} sx={{ textAlign: 'center', background: s.bg, borderRadius: 2, px: 1.5, py: 1 }}>
                        <Typography sx={{ fontSize: 18, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</Typography>
                        <Typography sx={{ fontSize: 9, color: '#64748b', fontWeight: 700, letterSpacing: '0.05em' }}>{s.label}</Typography>
                      </Box>
                    ))}
                  </Box>

                  {/* Progress */}
                  <Box sx={{ minWidth: 110, flex: '1 1 110px' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography sx={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>Fill progress</Typography>
                      <Typography sx={{ fontSize: 10, fontWeight: 700, color: pct === 100 ? '#15803d' : '#1a227f' }}>{pct}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={pct} sx={{
                      height: 6, borderRadius: 3, background: '#e2e8f0',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 3,
                        background: pct === 100
                          ? 'linear-gradient(90deg,#16a34a,#22c55e)'
                          : 'linear-gradient(90deg,#1a227f,#6366f1)',
                      },
                    }} />
                  </Box>

                  {/* Buttons */}
                  <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                    <Button variant="outlined" startIcon={<EditOutlinedIcon />}
                      onClick={() => setEditBatchId(b._id)}
                      sx={{
                        borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                        borderColor: '#e2e8f0', color: '#1a227f', px: 1.8,
                        '&:hover': { borderColor: '#1a227f', background: 'rgba(26,34,127,0.04)' },
                      }}>
                      Edit
                    </Button>
                    <Button variant="outlined" startIcon={<ContentCopyIcon />}
                      onClick={() => setDuplicateBatchId(b._id)}
                      sx={{
                        borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                        borderColor: '#e2e8f0', color: '#1a227f', px: 1.8,
                        '&:hover': { borderColor: '#1a227f', background: 'rgba(26,34,127,0.04)' },
                      }}>
                      Duplicate
                    </Button>
                    <Button variant="outlined" startIcon={<InfoOutlinedIcon />}
                      onClick={() => openDetailDialog(b)}
                      sx={{
                        borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                        borderColor: '#e2e8f0', color: '#1a227f', px: 1.8,
                        '&:hover': { borderColor: '#1a227f', background: 'rgba(26,34,127,0.04)' },
                      }}>
                      Details
                    </Button>
                    <Button variant="outlined" startIcon={<QrCode2Icon />}
                      onClick={() => openQRDrawer(b)}
                      sx={{
                        borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                        borderColor: '#e2e8f0', color: '#1a227f', px: 1.8,
                        '&:hover': { borderColor: '#1a227f', background: 'rgba(26,34,127,0.04)' },
                      }}>
                      View QRs
                    </Button>
                    <Button variant="outlined" startIcon={<PrintIcon />}
                      onClick={() => handlePrintBatch(b)}
                      disabled={!!printLoading[b._id]}
                      sx={{
                        borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                        borderColor: '#e2e8f0', color: '#1a227f', px: 1.8,
                        '&:hover': { borderColor: '#1a227f', background: 'rgba(26,34,127,0.04)' },
                      }}>
                      {printLoading[b._id] ? <CircularProgress size={14} color="inherit" /> : 'Print'}
                    </Button>
                    <Tooltip title={`Download all ${b.count} QR codes`}>
                      <Button variant="contained"
                        onClick={() => downloadBatch(b)}
                        disabled={!!dlLoading[b._id]}
                        sx={{
                          borderRadius: 2, minWidth: 44, px: 1.5,
                          background: 'linear-gradient(135deg,#1a227f,#3d47a3)',
                          '&:hover': { background: 'linear-gradient(135deg,#141a5e,#2d3590)' },
                        }}>
                        {dlLoading[b._id]
                          ? <CircularProgress size={16} color="inherit" />
                          : <DownloadIcon sx={{ fontSize: 18 }} />
                        }
                      </Button>
                    </Tooltip>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* ── QR Viewer Dialog ── */}
      <Dialog open={!!qrBatch} onClose={() => setQrBatch(null)} maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: 3, maxHeight: '85vh' } }}>
        {qrBatch && (
          <>
            <DialogTitle sx={{ p: 0 }}>
              <Box sx={{
                background: GRADIENTS[batches.findIndex(b => b._id === qrBatch._id) % GRADIENTS.length] || GRADIENTS[0],
                p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <Box>
                  <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{qrBatch.batchName}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontFamily: 'monospace' }}>
                    PRD-{qrBatch.seedCode}{qrBatch.batchCode}-001 → -{String(qrBatch.count).padStart(3,'0')}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Button variant="contained" startIcon={<PrintIcon />} onClick={() => handlePrintBatch(qrBatch)}
                    disabled={qrLoading || packets.length === 0}
                    sx={{ background: 'rgba(255,255,255,0.2)', '&:hover': { background: 'rgba(255,255,255,0.3)' }, borderRadius: 2, fontSize: 12 }}>
                    Print All
                  </Button>
                  <Button variant="contained" startIcon={<DownloadIcon />} onClick={downloadAll}
                    disabled={qrLoading || packets.length === 0}
                    sx={{ background: 'rgba(255,255,255,0.2)', '&:hover': { background: 'rgba(255,255,255,0.3)' }, borderRadius: 2, fontSize: 12 }}>
                    Download All
                  </Button>
                  <IconButton onClick={() => setQrBatch(null)} sx={{ color: '#fff' }}>
                    <CloseIcon />
                  </IconButton>
                </Box>
              </Box>
            </DialogTitle>

            <DialogContent sx={{ p: 2.5 }}>
              {qrLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <>
                  {/* Summary chips */}
                  <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
                    <Chip icon={<AllInboxIcon sx={{ fontSize: '16px !important' }} />}
                      label={`${packets.length} total`} size="small"
                      sx={{ background: 'rgba(26,34,127,0.08)', color: '#1a227f', fontWeight: 700 }} />
                    <Chip icon={<CheckCircleIcon sx={{ fontSize: '16px !important' }} />}
                      label={`${packets.filter(p=>p.status==='filled').length} filled`} size="small"
                      sx={{ background: '#f0fdf4', color: '#15803d', fontWeight: 700 }} />
                    <Chip label={`${packets.filter(p=>p.status==='empty').length} empty`} size="small"
                      sx={{ background: '#f8fafc', color: '#64748b', fontWeight: 700 }} />
                  </Box>

                  {/* QR pills grid */}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
                    {packets.map(pkt => (
                      <Box key={pkt.uniqueId} sx={{
                        display: 'flex', alignItems: 'center', gap: 1,
                        px: 1.5, py: 0.8, borderRadius: 2,
                        border: '1.5px solid',
                        borderColor: pkt.status === 'filled' ? '#bbf7d0' : '#e2e8f0',
                        background: pkt.status === 'filled' ? '#f0fdf4' : '#fafafa',
                        '&:hover': { borderColor: '#1a227f', background: '#f0f4ff' },
                      }}>
                        <Box sx={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: pkt.status === 'filled' ? '#16a34a' : '#cbd5e1',
                          flexShrink: 0,
                        }} />
                        <Box>
                          <Typography sx={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                            {pkt.uniqueId}
                          </Typography>
                          {(pkt.crop || pkt.locationCode) && (
                            <Typography sx={{ fontSize: 9.5, color: '#64748b', fontWeight: 600 }}>
                              {pkt.crop ? `${pkt.crop} · ` : ''}{pkt.locationCode || ''}
                            </Typography>
                          )}
                        </Box>
                        <Tooltip title="Download Styled QR">
                          <IconButton size="small" onClick={() => downloadStyledQR(pkt.qrCodeUrl, pkt.crop || qrBatch.seedType, pkt.locationCode, pkt.uniqueId)}
                            sx={{ p: 0.2, color: '#94a3b8', '&:hover': { color: '#1a227f' } }}>
                            <DownloadIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ))}
                  </Box>
                </>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>

      {/* ── Batch Detail Dialog (Step 14) — real SeedBatch + SeedPacket data ── */}
      <Dialog open={!!detailBatch} onClose={() => setDetailBatch(null)} maxWidth="lg" fullWidth
        PaperProps={{ sx: { borderRadius: 3, maxHeight: '90vh' } }}>
        {detailBatch && (
          <>
            <DialogTitle sx={{ p: 0 }}>
              <Box sx={{
                background: GRADIENTS[batches.findIndex(b => b._id === detailBatch._id) % GRADIENTS.length] || GRADIENTS[0],
                p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <Box>
                  <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{detailBatch.batchName}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontFamily: 'monospace' }}>
                    {detailBatch.batchNumber}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Button
                    variant="contained"
                    startIcon={<EditOutlinedIcon />}
                    onClick={() => {
                      const id = detailBatch._id;
                      setDetailBatch(null);
                      setEditBatchId(id);
                    }}
                    sx={{
                      background: 'rgba(255,255,255,0.2)',
                      '&:hover': { background: 'rgba(255,255,255,0.3)' },
                      borderRadius: 2, fontSize: 12, fontWeight: 700
                    }}
                  >
                    Edit Batch
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<ContentCopyIcon />}
                    onClick={() => {
                      const id = detailBatch._id;
                      setDetailBatch(null);
                      setDuplicateBatchId(id);
                    }}
                    sx={{
                      background: 'rgba(255,255,255,0.2)',
                      '&:hover': { background: 'rgba(255,255,255,0.3)' },
                      borderRadius: 2, fontSize: 12, fontWeight: 700
                    }}
                  >
                    Duplicate
                  </Button>
                  <IconButton onClick={() => setDetailBatch(null)} sx={{ color: '#fff' }}>
                    <CloseIcon />
                  </IconButton>
                </Box>
              </Box>
            </DialogTitle>

            <DialogContent sx={{ p: 2.5 }}>
              {detailError && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{detailError}</Alert>}

              {detailLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <>
                  {/* Seed entries in this batch */}
                  {detailBatch.seeds && detailBatch.seeds.length > 0 ? (
                    <Box sx={{ mb: 2.5 }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#1a227f', letterSpacing: '0.06em', mb: 1, textTransform: 'uppercase' }}>
                        Seed Entries in this Batch ({detailBatch.seeds.length})
                      </Typography>
                      <Grid container spacing={1.5}>
                        {detailBatch.seeds.map((s, sIdx) => (
                          <Grid size={{ xs: 12, md: detailBatch.seeds.length > 1 ? 6 : 12 }} key={sIdx}>
                            <Box sx={{
                              p: 1.8, borderRadius: 2.5, border: '1.5px solid #e2e8f0',
                              background: '#f8fafc',
                            }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.2 }}>
                                <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                                  #{sIdx + 1} {s.crop || s.seedType}
                                </Typography>
                                <Chip
                                  label={`${s.count || 0} QRs`}
                                  size="small"
                                  sx={{ background: '#1a227f', color: '#fff', fontWeight: 800, fontSize: 11, height: 22 }}
                                />
                              </Box>
                              <Grid container spacing={1}>
                                {[
                                  ['Crop Name', s.crop || s.seedType || '—'],
                                  ['Seed Code', s.seedCode || '—'],
                                  ['Seed Type', s.seedCategory || '—'],
                                  ['Location', s.locationCode || (s.land && s.line ? `${s.land} - ${s.line} - ${s.count}` : '—')],
                                  ['Year', s.year ?? '—'],
                                  ['Previous Year', s.previousYear ?? '—'],
                                  ['Previous Location', s.previousLocationCode || '—'],
                                  ['Gean', s.gene || '—'],
                                  ['Comments', s.comments || '—'],
                                ].map(([label, val]) => (
                                  <Grid size={{ xs: 6, sm: 4, md: 2.66 }} key={label}>
                                    <Box sx={{ background: '#fff', p: 0.8, borderRadius: 1.5, border: '1px solid #f1f5f9' }}>
                                      <Typography sx={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                                        {label}
                                      </Typography>
                                      <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#0f172a', wordBreak: 'break-word' }}>
                                        {val}
                                      </Typography>
                                    </Box>
                                  </Grid>
                                ))}
                              </Grid>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>
                    </Box>
                  ) : (
                    <>
                      {/* Seed-management details for older batches */}
                      <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', mb: 1 }}>SEED MANAGEMENT DETAILS</Typography>
                      <Grid container spacing={1.2} sx={{ mb: 2.5 }}>
                        {BATCH_DETAIL_FIELDS.map(f => {
                          const value = detailBatch[f.name];
                          const shown = value === null || value === undefined || value === '' ? '—' : String(value);
                          return (
                            <Grid size={{ xs: 12, sm: f.multiline ? 12 : 6, md: f.multiline ? 6 : 3 }} key={f.name}>
                              <Box sx={{ background: '#f8fafc', borderRadius: 2, px: 1.2, py: 0.8, border: '1px solid #f1f5f9', height: '100%' }}>
                                <Typography sx={{ fontSize: 9, color: '#64748b', fontWeight: 700, letterSpacing: '0.04em' }}>{f.label}</Typography>
                                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{shown}</Typography>
                              </Box>
                            </Grid>
                          );
                        })}
                      </Grid>
                    </>
                  )}

                  <TextField
                    size="small" fullWidth placeholder="Search Packet ID, Crop, or Location…"
                    value={packetSearch} onChange={e => setPacketSearch(e.target.value)}
                    InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: '#94a3b8' }} /></InputAdornment> }}
                    sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                  />

                  <TableContainer sx={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #f1f5f9', borderRadius: 2 }}>
                    <Table stickyHeader size="small">
                      <TableHead>
                        <TableRow>
                          {['Packet ID', 'Crop', 'Location', 'Status', 'Before', 'After', 'Before Photo', 'After Photo', 'Operator', 'Weighed'].map(h => <TableCell key={h}>{h}</TableCell>)}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detailPackets.filter(p => !packetSearch || p.uniqueId.toLowerCase().includes(packetSearch.toLowerCase()) || (p.crop && p.crop.toLowerCase().includes(packetSearch.toLowerCase())) || (p.locationCode && p.locationCode.toLowerCase().includes(packetSearch.toLowerCase()))).length === 0 ? (
                          <TableRow><TableCell colSpan={10} align="center" sx={{ py: 3, color: '#94a3b8' }}>
                            {detailPackets.length === 0 ? 'This batch has no packets' : 'No packets match your search'}
                          </TableCell></TableRow>
                        ) : detailPackets
                            .filter(p => !packetSearch || p.uniqueId.toLowerCase().includes(packetSearch.toLowerCase()) || (p.crop && p.crop.toLowerCase().includes(packetSearch.toLowerCase())) || (p.locationCode && p.locationCode.toLowerCase().includes(packetSearch.toLowerCase())))
                            .map(p => {
                              const beforeUrl = resolvePhotoUrl(p.beforePhotoUrl);
                              const afterUrl  = resolvePhotoUrl(p.afterPhotoUrl);
                              return (
                                <TableRow key={p.uniqueId} hover>
                                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#1a227f' }}>{p.uniqueId}</TableCell>
                                  <TableCell sx={{ fontSize: 12, fontWeight: 700 }}>{p.crop || detailBatch.crop || detailBatch.seedType || '—'}</TableCell>
                                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: '#334155' }}>{p.locationCode || '—'}</TableCell>
                                  <TableCell>
                                    <Chip label={p.status === 'filled' ? 'Filled' : 'Empty'} size="small"
                                      sx={{ fontSize: 10, fontWeight: 800, background: p.status === 'filled' ? '#f0fdf4' : '#f8fafc', color: p.status === 'filled' ? '#15803d' : '#64748b' }} />
                                  </TableCell>
                                  <TableCell sx={{ fontSize: 12, fontWeight: 700 }}>{p.beforeWeight != null ? `${p.beforeWeight} kg` : '—'}</TableCell>
                                  <TableCell sx={{ fontSize: 12, fontWeight: 700 }}>{p.afterWeight != null ? `${p.afterWeight} kg` : '—'}</TableCell>
                                  <TableCell>
                                    <Button size="small" disabled={!beforeUrl} onClick={() => setViewPhoto({ url: beforeUrl, label: 'Before Photo' })}
                                      startIcon={<ImageIcon sx={{ fontSize: '14px !important' }} />}
                                      sx={{ fontSize: 10, minWidth: 0, px: 0.8, py: 0.2, textTransform: 'none' }}>
                                      {beforeUrl ? 'View' : '—'}
                                    </Button>
                                  </TableCell>
                                  <TableCell>
                                    <Button size="small" disabled={!afterUrl} onClick={() => setViewPhoto({ url: afterUrl, label: 'After Photo' })}
                                      startIcon={<ImageIcon sx={{ fontSize: '14px !important' }} />}
                                      sx={{ fontSize: 10, minWidth: 0, px: 0.8, py: 0.2, textTransform: 'none' }}>
                                      {afterUrl ? 'View' : '—'}
                                    </Button>
                                  </TableCell>
                                  <TableCell sx={{ fontSize: 12 }}>{p.operator?.name || '—'}</TableCell>
                                  <TableCell sx={{ fontSize: 11, fontFamily: 'monospace', color: '#475569' }}>
                                    {p.linkedAt ? new Date(p.linkedAt).toLocaleString() : '—'}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>

      {/* Photo viewer — reuses the same simple pattern as Weighing History (Step 11) */}
      <Dialog open={Boolean(viewPhoto)} onClose={() => setViewPhoto(null)} maxWidth="sm" fullWidth>
        <DialogContent sx={{ p: 1.5 }}>
          {viewPhoto?.url && (
            <Box component="img" src={viewPhoto.url} alt={viewPhoto.label}
              sx={{ width: '100%', borderRadius: 2, display: 'block' }} />
          )}
        </DialogContent>
      </Dialog>

      <NewBatchDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(data) => {
          setSuccessMsg(`${data.batch.batchName} saved — ${data.message}`);
          fetchBatches();
        }}
      />

      <EditBatchDialog
        open={Boolean(editBatchId)}
        batchId={editBatchId}
        onClose={() => setEditBatchId(null)}
        onUpdated={(data) => {
          setSuccessMsg(data?.message || 'Batch updated with extra QR codes successfully');
          fetchBatches();
        }}
      />

      <DuplicateBatchDialog
        open={Boolean(duplicateBatchId)}
        batchId={duplicateBatchId}
        onClose={() => setDuplicateBatchId(null)}
        onSuccess={(data) => {
          setSuccessMsg(data?.message || 'Duplicate batch created successfully');
          fetchBatches();
        }}
      />

      <Snackbar open={!!successMsg} autoHideDuration={5000} onClose={() => setSuccessMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setSuccessMsg('')} sx={{ borderRadius: 2 }}>
          {successMsg}
        </Alert>
      </Snackbar>
    </Layout>
  );
}
