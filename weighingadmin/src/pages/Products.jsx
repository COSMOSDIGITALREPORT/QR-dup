import { useState, useEffect, useCallback, useMemo } from 'react';
import { batchAPI } from '../services/api';
import {
  Box, Button, Card, Chip, Grid, IconButton, LinearProgress,
  Tab, Tabs, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, InputBase, Paper, Snackbar, Alert, TextField, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Checkbox, MenuItem, CircularProgress
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import QrCodeIcon from '@mui/icons-material/QrCode';
import InventoryIcon from '@mui/icons-material/Inventory';
import PrintIcon from '@mui/icons-material/Print';
import EcoIcon from '@mui/icons-material/LocalFlorist';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import NewBatchDialog from '../components/NewBatchDialog';
import EditBatchDialog from '../components/EditBatchDialog';
import DuplicateBatchDialog from '../components/DuplicateBatchDialog';

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function getGroupInitials(name) {
  if (!name) return 'PR';
  const parts = name.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('');
  }
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const seedTypeColor = (s) => {
  if (!s) return { bg: '#f1f5f9', color: '#64748b' };
  if (s === 'Organic')  return { bg: '#dcfce7', color: '#16a34a' };
  if (s === 'Hybrid')   return { bg: '#dbeafe', color: '#1d4ed8' };
  if (s === 'Heirloom') return { bg: '#fef9c3', color: '#ca8a04' };
  return { bg: '#fce7f3', color: '#db2777' };
};

export default function Products() {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ organic: 0, hybrid: 0, heirloomModified: 0 });
  const [loading, setLoading] = useState(true);

  // Filters
  const [seed, setSeed] = useState('');
  const [batch, setBatch] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [seedOptions, setSeedOptions] = useState([]);
  const [batchOptions, setBatchOptions] = useState([]);
  const [warehouseOptions, setWarehouseOptions] = useState([]);

  // Pagination for grouped sets
  const [groupPage, setGroupPage] = useState(1);
  const groupsPerPage = 8;

  // Modals state
  const [createOpen, setCreateOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [detailGroup, setDetailGroup] = useState(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [editBatchId, setEditBatchId] = useState(null);
  const [batchSelectDialog, setBatchSelectDialog] = useState(null);
  const [duplicateBatchId, setDuplicateBatchId] = useState(null);
  const [duplicateSelectDialog, setDuplicateSelectDialog] = useState(null);

  const handleOpenDuplicateProduct = (group) => {
    if (!group || !group.records || group.records.length === 0) return;
    const batchesMap = new Map();
    group.records.forEach(r => {
      const bId = r.batchId;
      if (bId && !batchesMap.has(String(bId))) {
        batchesMap.set(String(bId), {
          id: bId,
          name: r.batchName || r.batch || 'Batch',
          number: r.batch,
        });
      }
    });
    const distinct = Array.from(batchesMap.values());
    if (distinct.length === 1) {
      setDuplicateBatchId(distinct[0].id);
    } else if (distinct.length > 1) {
      setDuplicateSelectDialog({ groupName: group.name, batches: distinct });
    } else if (group.records[0]?.batchId) {
      setDuplicateBatchId(group.records[0].batchId);
    } else {
      alert('No batch reference found for this product group.');
    }
  };

  const handleOpenEditProduct = (group) => {
    if (!group || !group.records || group.records.length === 0) return;
    const batchesMap = new Map();
    group.records.forEach(r => {
      const bId = r.batchId;
      if (bId && !batchesMap.has(String(bId))) {
        batchesMap.set(String(bId), {
          id: bId,
          name: r.batchName || r.batch || 'Batch',
          number: r.batch,
        });
      }
    });
    const distinct = Array.from(batchesMap.values());
    if (distinct.length === 1) {
      setEditBatchId(distinct[0].id);
    } else if (distinct.length > 1) {
      setBatchSelectDialog({ groupName: group.name, batches: distinct });
    } else if (group.records[0]?.batchId) {
      setEditBatchId(group.records[0].batchId);
    } else {
      alert('No batch reference found for this product group.');
    }
  };

  // Print selection & preview modal state
  const [printGroup, setPrintGroup] = useState(null);
  const [selectedQrs, setSelectedQrs] = useState({}); // { [id]: boolean }
  const [copiesMap, setCopiesMap] = useState({});     // { [id]: number }
  const [printTab, setPrintTab] = useState(0);         // 0: Select QRs, 1: Print Preview
  const [printSearch, setPrintSearch] = useState('');

  // Single QR quick viewer modal
  const [previewQr, setPreviewQr] = useState(null); // { id, name, crop, batch, locationCode, qrCodeUrl }

  const hasActiveFilters = Boolean(seed || batch || warehouse);
  const clearFilters = () => { setSeed(''); setBatch(''); setWarehouse(''); setGroupPage(1); };
  const handleBatchChange = (v) => { setBatch(v); setGroupPage(1); };
  const handleWarehouseChange = (v) => { setWarehouse(v); setGroupPage(1); };
  const handleSeedChange = (v) => { setSeed(v); setBatch(''); setGroupPage(1); };
  const handleSearchChange = (v) => { setSearch(v); setGroupPage(1); };

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await batchAPI.inventory({
        search,
        seedType: seed || undefined,
        batchNumber: batch || undefined,
        warehouse: warehouse || undefined,
        limit: 'all',
      });
      setProducts(res.data.products || []);
      setTotal(res.data.totalProducts || 0);
      setCounts({
        organic: res.data.organicCount || 0,
        hybrid: res.data.hybridCount || 0,
        heirloomModified: res.data.heirloomModifiedCount || 0,
      });
      setSeedOptions(res.data.seedOptions || []);
      setBatchOptions(res.data.batchOptions || []);
      setWarehouseOptions(res.data.warehouseOptions || []);
    } catch (_) {}
    setLoading(false);
  }, [search, seed, batch, warehouse]);

  useEffect(() => {
    const t = setTimeout(fetchInventory, 300);
    return () => clearTimeout(t);
  }, [fetchInventory]);

  // Group products having the same Product Name / combination into ONE parent group
  const groupedSets = useMemo(() => {
    const groupsMap = new Map();

    products.forEach(p => {
      const key = (p.name || 'Unassigned').trim();
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          name: key,
          category: p.category || '—',
          batches: new Set(),
          locations: new Set(),
          records: [],
          filledCount: 0,
          emptyCount: 0,
          createdAt: p.createdAt,
        });
      }
      const g = groupsMap.get(key);
      g.records.push(p);
      if (p.batch) g.batches.add(p.batch);
      if (p.location) g.locations.add(p.location);
      if (p.status === 'filled') g.filledCount++;
      else g.emptyCount++;
    });

    let list = Array.from(groupsMap.values()).map(g => ({
      ...g,
      batchList: Array.from(g.batches).join(', ') || '—',
      locationList: Array.from(g.locations).join(', ') || '—',
      totalCount: g.records.length,
      pctFilled: g.records.length > 0 ? Math.round((g.filledCount / g.records.length) * 100) : 0,
    }));

    // Filter by client search if typed
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.batchList.toLowerCase().includes(q) ||
        g.locationList.toLowerCase().includes(q) ||
        g.records.some(r =>
          (r.id && r.id.toLowerCase().includes(q)) ||
          (r.crop && r.crop.toLowerCase().includes(q)) ||
          (r.locationCode && r.locationCode.toLowerCase().includes(q))
        )
      );
    }

    if (tab === 1) {
      // Recently added: sort by newest created record in group
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else {
      // Sort alphabetically by product name
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [products, search, tab]);

  const totalGroups = groupedSets.length;
  const totalGroupPages = Math.ceil(totalGroups / groupsPerPage) || 1;
  const paginatedGroups = useMemo(() => {
    const start = (groupPage - 1) * groupsPerPage;
    return groupedSets.slice(start, start + groupsPerPage);
  }, [groupedSets, groupPage]);

  // Open print interface for a specific product group
  const openPrintDialog = (group) => {
    const sel = {};
    const cop = {};
    group.records.forEach(r => {
      sel[r.id] = true; // Selected by default
      cop[r.id] = 1;    // 1 copy by default
    });
    setPrintGroup(group);
    setSelectedQrs(sel);
    setCopiesMap(cop);
    setPrintTab(0);
    setPrintSearch('');
  };

  const toggleSelectAll = (select) => {
    if (!printGroup) return;
    const newSel = {};
    const newCop = { ...copiesMap };
    printGroup.records.forEach(r => {
      newSel[r.id] = select;
      if (select && !newCop[r.id]) newCop[r.id] = 1;
    });
    setSelectedQrs(newSel);
    setCopiesMap(newCop);
  };

  const handleToggleQr = (id) => {
    setSelectedQrs(prev => {
      const nextVal = !prev[id];
      if (nextVal && !copiesMap[id]) {
        setCopiesMap(c => ({ ...c, [id]: 1 }));
      }
      return { ...prev, [id]: nextVal };
    });
  };

  const handleCopyChange = (id, count) => {
    const val = Math.max(1, Math.min(99, parseInt(count, 10) || 1));
    setCopiesMap(prev => ({ ...prev, [id]: val }));
  };

  // Compute selected count and total label copies to print
  const selectedCount = printGroup ? printGroup.records.filter(r => selectedQrs[r.id]).length : 0;
  const totalLabelsToPrint = printGroup
    ? printGroup.records.reduce((sum, r) => sum + (selectedQrs[r.id] ? (parseInt(copiesMap[r.id], 10) || 1) : 0), 0)
    : 0;

  // Flattened array of all labels for preview and printing
  const previewLabels = useMemo(() => {
    if (!printGroup) return [];
    const labels = [];
    printGroup.records.forEach(r => {
      if (selectedQrs[r.id]) {
        const copies = Math.max(1, parseInt(copiesMap[r.id], 10) || 1);
        for (let c = 0; c < copies; c++) {
          labels.push({
            ...r,
            copyIndex: c + 1,
            totalCopies: copies,
          });
        }
      }
    });
    return labels;
  }, [printGroup, selectedQrs, copiesMap]);

  // Execute print window
  const executePrintLabels = () => {
    if (!printGroup || previewLabels.length === 0) {
      alert('Please select at least one QR code to print.');
      return;
    }

    const win = window.open('', '_blank');
    if (!win) {
      alert('Please allow popups to print QR labels.');
      return;
    }

    const baseUrl = batchAPI.qrBaseUrl();
    const cardsHtml = previewLabels.map(lbl => {
      const qrSrc = escapeHtml(`${baseUrl}${lbl.qrCodeUrl}`);
      const cropName = escapeHtml(lbl.crop || lbl.name || printGroup.name);
      const locNumber = escapeHtml(lbl.locationCode || lbl.id);
      const idText = escapeHtml(lbl.id);

      return `
        <div class="label-card">
          <img class="qr-img" src="${qrSrc}" alt="${idText}" />
          <div class="crop-name">${cropName}</div>
          <div class="loc-number">${locNumber}</div>
          <div class="id-text">${idText}</div>
          ${lbl.totalCopies > 1 ? `<div class="copy-tag">Copy ${lbl.copyIndex} of ${lbl.totalCopies}</div>` : ''}
        </div>
      `;
    }).join('');

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Print QR Labels — ${escapeHtml(printGroup.name)}</title>
  <style>
    @page { size: auto; margin: 8mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #fff; color: #0f172a; padding: 12px; }
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
    .sheet {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
    }
    .label-card {
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 10px;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center;
      background: #fff;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .qr-img { width: 130px; height: 130px; object-fit: contain; display: block; }
    .crop-name { font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 6px; line-height: 1.2; }
    .loc-number { font-size: 12px; font-weight: 700; color: #1a227f; font-family: monospace; margin-top: 4px; }
    .id-text { font-size: 10px; font-weight: 700; color: #475569; font-family: monospace; margin-top: 2px; }
    .copy-tag { font-size: 9px; color: #4338ca; font-weight: 700; margin-top: 3px; background: #e0e7ff; padding: 2px 6px; border-radius: 4px; }
    @media print {
      .no-print { display: none !important; }
      body { padding: 0; }
      .sheet { gap: 8px; }
      .label-card { border: 1px solid #94a3b8; }
    }
  </style>
</head>
<body>
  <div class="header-bar no-print">
    <div>
      <div class="title">${escapeHtml(printGroup.name)}</div>
      <div class="subtitle">${previewLabels.length} Labels (${selectedCount} unique QR codes)</div>
    </div>
    <button class="btn-print" onclick="window.print()">🖨️ Print Labels</button>
  </div>
  <div class="sheet">
    ${cardsHtml}
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 400);
    };
  </script>
</body>
</html>`);
    win.document.close();
  };

  return (
    <Layout>
      <PageHeader
        title="Product Inventory"
        subtitle="Manage all registered product batches and QR labels"
        showSearch={false}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}
            sx={{ background: 'linear-gradient(135deg,#1a227f,#3d47a3)' }}>
            New Batch
          </Button>
        }
      />

      {/* Filters */}
      <Card sx={{ p: 2, mb: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select size="small" value={seed} onChange={e => handleSeedChange(e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ minWidth: 160 }}>
            <MenuItem value=""><em>Select Seed</em></MenuItem>
            {seedOptions.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
          </TextField>
          <TextField select size="small" value={batch} onChange={e => handleBatchChange(e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ minWidth: 160 }}>
            <MenuItem value=""><em>Select Batch</em></MenuItem>
            {batchOptions.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
          </TextField>
          <TextField select size="small" value={warehouse} onChange={e => handleWarehouseChange(e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ minWidth: 160 }}>
            <MenuItem value=""><em>Select Warehouse</em></MenuItem>
            {warehouseOptions.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
          </TextField>
          {hasActiveFilters && (
            <Button size="small" onClick={clearFilters} sx={{ textTransform: 'none', fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>
              Clear Filters
            </Button>
          )}
        </Box>
      </Card>

      {/* Stats */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {[
          { title: 'Total Products', value: String(total || 0), icon: <InventoryIcon sx={{ color: '#1a227f', fontSize: 22 }} />, iconBg: 'rgba(26,34,127,0.08)' },
          { title: 'Organic', value: String(counts.organic || 0), icon: <InventoryIcon sx={{ color: '#10b981', fontSize: 22 }} />, iconBg: 'rgba(16,185,129,0.08)' },
          { title: 'Hybrid', value: String(counts.hybrid || 0), icon: <InventoryIcon sx={{ color: '#6366f1', fontSize: 22 }} />, iconBg: 'rgba(99,102,241,0.08)' },
          { title: 'Heirloom / Modified', value: String(counts.heirloomModified || 0), icon: <InventoryIcon sx={{ color: '#f59e0b', fontSize: 22 }} />, iconBg: 'rgba(245,158,11,0.08)' },
        ].map(c => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={c.title}>
            <StatCard {...c} />
          </Grid>
        ))}
      </Grid>

      {/* Seed type breakdown */}
      {total > 0 && (
        <Card sx={{ p: 2.5, mb: 2.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>Seed Type Distribution</Typography>
            <Typography sx={{ fontSize: 13, color: '#1a227f', fontWeight: 700 }}>{total} products</Typography>
          </Box>
          <LinearProgress variant="determinate"
            value={total ? (counts.organic / total) * 100 : 0}
            sx={{ height: 8, borderRadius: 99, background: '#f1f5f9', '& .MuiLinearProgress-bar': { background: '#10b981', borderRadius: 99 } }} />
        </Card>
      )}

      {/* Grouped Product Sets Container */}
      <Card sx={{ p: 2.5, mb: 3 }}>
        {/* Header bar: Tabs & Search */}
        <Box sx={{ pb: 2, mb: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, borderBottom: '1px solid #f1f5f9' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Tabs value={tab} onChange={(_, v) => { setTab(v); setGroupPage(1); }}
              sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, fontSize: 13.5, minWidth: 0, px: 2, minHeight: 40 } }}>
              <Tab label="All Product Sets" />
              <Tab label="Recently Added" />
            </Tabs>
            <Chip
              label={`${totalGroups} Groups · ${total} Individual QRs`}
              size="small"
              sx={{ background: 'rgba(26,34,127,0.08)', color: '#1a227f', fontWeight: 700, fontSize: 11 }}
            />
          </Box>
          <Paper elevation={0} sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.6, border: '1.5px solid #e2e8f0', borderRadius: 2, minWidth: 260 }}>
            <SearchIcon sx={{ color: '#94a3b8', fontSize: 19, mr: 1 }} />
            <InputBase
              placeholder="Search product name, crop, batch, QR ID..."
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              sx={{ fontSize: 13, flex: 1 }}
            />
          </Paper>
        </Box>

        {/* Grouped Cards List */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : paginatedGroups.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8, border: '2px dashed #e2e8f0', borderRadius: 3, background: '#fafafa' }}>
            <InventoryIcon sx={{ fontSize: 54, color: '#cbd5e1', mb: 1.5 }} />
            <Typography sx={{ fontWeight: 700, fontSize: 16, color: '#475569' }}>No product groups found</Typography>
            <Typography sx={{ fontSize: 13, color: '#94a3b8', mt: 0.5 }}>Try adjusting your filters or search keywords</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {paginatedGroups.map((g, idx) => {
              const gradient = GRADIENTS[idx % GRADIENTS.length];
              const initials = getGroupInitials(g.name);
              const sc = seedTypeColor(g.category);
              const firstId = g.records[0]?.id || '';
              const lastId  = g.records[g.records.length - 1]?.id || '';

              return (
                <Box key={g.name} sx={{
                  display: 'flex', alignItems: 'stretch',
                  borderRadius: 3, border: '1.5px solid #e2e8f0', overflow: 'hidden',
                  background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  transition: 'box-shadow 0.2s',
                  '&:hover': { boxShadow: '0 6px 20px rgba(0,0,0,0.08)', borderColor: '#cbd5e1' },
                }}>
                  {/* Left accent strip */}
                  <Box sx={{
                    width: 90, flexShrink: 0, background: gradient,
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 0.5, p: 2, position: 'relative', overflow: 'hidden',
                  }}>
                    <Box sx={{ position: 'absolute', top: -16, right: -16, width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                    <Typography sx={{ fontSize: 20, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{initials}</Typography>
                    <Chip label={`${g.totalCount} QRs`} size="small"
                      sx={{ background: 'rgba(255,255,255,0.25)', color: '#fff', fontWeight: 800, fontSize: 9, height: 18, mt: 0.5 }} />
                  </Box>

                  {/* Main content */}
                  <Box sx={{ flex: 1, p: 2.2, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', minWidth: 0 }}>
                    {/* Product Name & Metadata */}
                    <Box sx={{ minWidth: 200, flex: '1 1 200px' }}>
                      <Box sx={{ display: 'flex', gap: 0.8, alignItems: 'center', flexWrap: 'wrap', mb: 0.8 }}>
                        <Chip label={g.category || 'General'} size="small"
                          sx={{ fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.color, height: 20 }} />
                        <Chip label={`Batches: ${g.batchList}`} size="small"
                          sx={{ fontSize: 10, fontWeight: 600, background: '#f1f5f9', color: '#475569', height: 20 }} />
                      </Box>
                      <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>
                        {g.name}
                      </Typography>
                      <Typography sx={{ fontSize: 11.5, color: '#64748b', mt: 0.3 }}>
                        {g.locationList !== '—' ? `Warehouse: ${g.locationList} · ` : ''}
                        {g.totalCount} individual QR codes · {g.batches.size} batch{g.batches.size === 1 ? '' : 'es'}
                      </Typography>
                    </Box>

                    {/* QR Range */}
                    <Box sx={{ minWidth: 160, flex: '1 1 160px' }}>
                      <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', mb: 0.4 }}>
                        QR ID RANGE
                      </Typography>
                      <Typography sx={{ fontFamily: 'monospace', fontSize: 11.5, fontWeight: 700, color: '#1a227f' }}>
                        {firstId}
                      </Typography>
                      <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>
                        → {lastId}
                      </Typography>
                    </Box>

                    {/* Stats */}
                    <Box sx={{ display: 'flex', gap: 1.2, alignItems: 'center', flex: '0 0 auto' }}>
                      {[
                        { label: 'TOTAL', value: g.totalCount,  bg: '#f0f4ff', color: '#1a227f' },
                        { label: 'FILLED', value: g.filledCount, bg: '#f0fdf4', color: '#15803d' },
                        { label: 'EMPTY',  value: g.emptyCount,  bg: '#fff7ed', color: '#c2410c' },
                      ].map(s => (
                        <Box key={s.label} sx={{ textAlign: 'center', background: s.bg, borderRadius: 2, px: 1.5, py: 0.8 }}>
                          <Typography sx={{ fontSize: 17, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</Typography>
                          <Typography sx={{ fontSize: 8.5, color: '#64748b', fontWeight: 700, letterSpacing: '0.05em' }}>{s.label}</Typography>
                        </Box>
                      ))}
                    </Box>

                    {/* Progress */}
                    <Box sx={{ minWidth: 100, flex: '1 1 100px' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography sx={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>Filled</Typography>
                        <Typography sx={{ fontSize: 10, fontWeight: 700, color: g.pctFilled === 100 ? '#15803d' : '#1a227f' }}>
                          {g.pctFilled}%
                        </Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={g.pctFilled} sx={{
                        height: 6, borderRadius: 3, background: '#e2e8f0',
                        '& .MuiLinearProgress-bar': {
                          borderRadius: 3,
                          background: g.pctFilled === 100
                            ? 'linear-gradient(90deg,#16a34a,#22c55e)'
                            : 'linear-gradient(90deg,#1a227f,#6366f1)',
                        },
                      }} />
                    </Box>

                    {/* Action buttons */}
                    <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                      <Button
                        variant="outlined"
                        startIcon={<EditOutlinedIcon />}
                        onClick={() => handleOpenEditProduct(g)}
                        sx={{
                          borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                          borderColor: '#e2e8f0', color: '#1a227f', px: 2,
                          '&:hover': { borderColor: '#1a227f', background: 'rgba(26,34,127,0.04)' },
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outlined"
                        startIcon={<ContentCopyIcon />}
                        onClick={() => handleOpenDuplicateProduct(g)}
                        sx={{
                          borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                          borderColor: '#e2e8f0', color: '#1a227f', px: 2,
                          '&:hover': { borderColor: '#1a227f', background: 'rgba(26,34,127,0.04)' },
                        }}
                      >
                        Duplicate
                      </Button>
                      <Button
                        variant="outlined"
                        startIcon={<InfoOutlinedIcon />}
                        onClick={() => { setDetailGroup(g); setDetailSearch(''); }}
                        sx={{
                          borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                          borderColor: '#e2e8f0', color: '#1a227f', px: 2,
                          '&:hover': { borderColor: '#1a227f', background: 'rgba(26,34,127,0.04)' },
                        }}
                      >
                        View Details
                      </Button>
                      <Button
                        variant="contained"
                        startIcon={<PrintIcon />}
                        onClick={() => openPrintDialog(g)}
                        sx={{
                          borderRadius: 2, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                          background: 'linear-gradient(135deg,#1a227f,#3d47a3)', px: 2,
                          '&:hover': { background: 'linear-gradient(135deg,#141a5e,#2d3590)' },
                        }}
                      >
                        Print QR
                      </Button>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Pagination bar */}
        {!loading && totalGroups > 0 && (
          <Box sx={{ px: 2, pt: 3, mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap', gap: 1 }}>
            <Typography sx={{ fontSize: 12, color: '#64748b' }}>
              Showing {paginatedGroups.length} of {totalGroups} product groups ({total} total individual QRs)
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.8, alignItems: 'center' }}>
              <Button size="small" disabled={groupPage <= 1} onClick={() => setGroupPage(p => Math.max(1, p - 1))}
                sx={{ minWidth: 0, px: 1.5, fontSize: 12, fontWeight: 600, textTransform: 'none', color: '#1a227f' }}>
                Previous
              </Button>
              <Typography sx={{ fontSize: 12, color: '#64748b' }}>Page</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1a227f' }}>{groupPage}</Typography>
              <Typography sx={{ fontSize: 12, color: '#64748b' }}>of {totalGroupPages}</Typography>
              <Button size="small" disabled={groupPage >= totalGroupPages} onClick={() => setGroupPage(p => p + 1)}
                sx={{ minWidth: 0, px: 1.5, fontSize: 12, fontWeight: 600, textTransform: 'none', color: '#1a227f' }}>
                Next
              </Button>
            </Box>
          </Box>
        )}
      </Card>

      {/* ── 2. VIEW DETAILS MODAL ── */}
      <Dialog
        open={Boolean(detailGroup)}
        onClose={() => setDetailGroup(null)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, maxHeight: '90vh' } }}
      >
        {detailGroup && (
          <>
            <DialogTitle sx={{ p: 0 }}>
              <Box sx={{
                background: 'linear-gradient(135deg,#1a227f,#3d47a3)',
                p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff',
              }}>
                <Box>
                  <Typography sx={{ fontSize: 18, fontWeight: 800 }}>{detailGroup.name}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
                    Complete product group records · {detailGroup.records.length} individual QR codes · Category: {detailGroup.category}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Button
                    variant="contained"
                    startIcon={<EditOutlinedIcon />}
                    onClick={() => { const g = detailGroup; setDetailGroup(null); handleOpenEditProduct(g); }}
                    sx={{ background: 'rgba(255,255,255,0.2)', '&:hover': { background: 'rgba(255,255,255,0.3)' }, borderRadius: 2, fontSize: 12, fontWeight: 700 }}
                  >
                    Edit Batch
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<ContentCopyIcon />}
                    onClick={() => { const g = detailGroup; setDetailGroup(null); handleOpenDuplicateProduct(g); }}
                    sx={{ background: 'rgba(255,255,255,0.2)', '&:hover': { background: 'rgba(255,255,255,0.3)' }, borderRadius: 2, fontSize: 12, fontWeight: 700 }}
                  >
                    Duplicate
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<PrintIcon />}
                    onClick={() => { const g = detailGroup; setDetailGroup(null); openPrintDialog(g); }}
                    sx={{ background: 'rgba(255,255,255,0.2)', '&:hover': { background: 'rgba(255,255,255,0.3)' }, borderRadius: 2, fontSize: 12, fontWeight: 700 }}
                  >
                    Print QRs
                  </Button>
                  <IconButton onClick={() => setDetailGroup(null)} sx={{ color: '#fff' }}>
                    <CloseIcon />
                  </IconButton>
                </Box>
              </Box>
            </DialogTitle>

            <DialogContent sx={{ p: 2.5 }}>
              {/* Group summary cards */}
              <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
                {[
                  ['Product Name', detailGroup.name],
                  ['Category', detailGroup.category],
                  ['Batches Included', detailGroup.batchList],
                  ['Total QR Codes', detailGroup.totalCount],
                  ['Filled Packets', detailGroup.filledCount],
                  ['Empty Packets', detailGroup.emptyCount],
                ].map(([label, val]) => (
                  <Grid size={{ xs: 6, sm: 4, md: 2 }} key={label}>
                    <Box sx={{ background: '#f8fafc', p: 1.2, borderRadius: 2, border: '1px solid #f1f5f9', textAlign: 'center' }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#0f172a', wordBreak: 'break-word' }}>{val}</Typography>
                      <Typography sx={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', mt: 0.3 }}>{label}</Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>

              {/* Search within group */}
              <TextField
                size="small"
                fullWidth
                placeholder="Search within this group by Product ID, Crop, QR Number, Batch..."
                value={detailSearch}
                onChange={e => setDetailSearch(e.target.value)}
                InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ color: '#94a3b8', mr: 1 }} /> }}
                sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              />

              {/* Table of individual QR records */}
              <TableContainer sx={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 2 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {['Product ID', 'Product Name', 'Crop Name', 'Batch Name / Code', 'Individual QR Number', 'QR Code', 'Status', 'Action'].map(h => (
                        <TableCell key={h} sx={{ fontWeight: 700, fontSize: 12, background: '#f8fafc' }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detailGroup.records
                      .filter(r => {
                        if (!detailSearch.trim()) return true;
                        const q = detailSearch.trim().toLowerCase();
                        return (
                          (r.id && r.id.toLowerCase().includes(q)) ||
                          (r.name && r.name.toLowerCase().includes(q)) ||
                          (r.crop && r.crop.toLowerCase().includes(q)) ||
                          (r.batch && r.batch.toLowerCase().includes(q)) ||
                          (r.batchName && r.batchName.toLowerCase().includes(q)) ||
                          (r.locationCode && r.locationCode.toLowerCase().includes(q)) ||
                          (r.location && r.location.toLowerCase().includes(q))
                        );
                      })
                      .map(r => (
                        <TableRow key={r.id} hover>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#1a227f' }}>
                            {r.id}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12.5, fontWeight: 700 }}>
                            {r.name}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12.5, color: '#334155' }}>
                            {r.crop || r.name}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
                            {r.batchName || r.batch || r.batchCode || '—'}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                            {r.locationCode || r.id}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box
                                component="img"
                                src={`${batchAPI.qrBaseUrl()}${r.qrCodeUrl}`}
                                alt={r.id}
                                sx={{ width: 32, height: 32, objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: 1, cursor: 'pointer' }}
                                onClick={() => setPreviewQr(r)}
                              />
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => setPreviewQr(r)}
                                sx={{ fontSize: 11, minWidth: 0, p: 0.5, textTransform: 'none', color: '#1a227f' }}
                              >
                                View
                              </Button>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={r.status === 'filled' ? 'Filled' : 'Empty'}
                              size="small"
                              sx={{
                                fontSize: 10, fontWeight: 800,
                                background: r.status === 'filled' ? '#f0fdf4' : '#f8fafc',
                                color: r.status === 'filled' ? '#15803d' : '#64748b',
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {r.batchId && (
                              <Tooltip title="Edit / Add Extra QRs to this batch">
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    setDetailGroup(null);
                                    setEditBatchId(r.batchId);
                                  }}
                                  sx={{ color: '#1a227f' }}
                                >
                                  <EditOutlinedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            {r.batchId && (
                              <Tooltip title="Duplicate this batch">
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    setDetailGroup(null);
                                    setDuplicateBatchId(r.batchId);
                                  }}
                                  sx={{ color: '#1a227f' }}
                                >
                                  <ContentCopyIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            <Tooltip title="Print this single QR label">
                              <IconButton
                                size="small"
                                onClick={() => {
                                  openPrintDialog({
                                    ...detailGroup,
                                    records: [r],
                                  });
                                }}
                                sx={{ color: '#1a227f' }}
                              >
                                <PrintIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </DialogContent>
            <DialogActions sx={{ px: 2.5, py: 1.5, borderTop: '1px solid #f1f5f9' }}>
              <Button onClick={() => setDetailGroup(null)} sx={{ fontWeight: 600 }}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* ── 3. PRINT QR SELECTION & PREVIEW INTERFACE ── */}
      <Dialog
        open={Boolean(printGroup)}
        onClose={() => setPrintGroup(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, maxHeight: '90vh' } }}
      >
        {printGroup && (
          <>
            <DialogTitle sx={{ p: 0 }}>
              <Box sx={{
                background: 'linear-gradient(135deg,#1a227f,#3d47a3)',
                p: 2.2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff',
              }}>
                <Box>
                  <Typography sx={{ fontSize: 17, fontWeight: 800 }}>
                    Print QR Codes — {printGroup.name}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                    {selectedCount} of {printGroup.records.length} QR codes selected · {totalLabelsToPrint} total copies to print
                  </Typography>
                </Box>
                <IconButton onClick={() => setPrintGroup(null)} sx={{ color: '#fff' }}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </DialogTitle>

            <DialogContent sx={{ p: 2.5 }}>
              {/* Tab navigation: Selection vs Preview */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Tabs value={printTab} onChange={(_, v) => setPrintTab(v)}
                  sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, fontSize: 13, minHeight: 36 } }}>
                  <Tab label={`1. Select QRs & Copies (${selectedCount})`} />
                  <Tab label={`2. Print Preview (${totalLabelsToPrint} labels)`} />
                </Tabs>

                {printTab === 0 && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Button size="small" variant="outlined" onClick={() => toggleSelectAll(true)}
                      sx={{ fontSize: 11, fontWeight: 700, textTransform: 'none', py: 0.3 }}>
                      Select All
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => toggleSelectAll(false)}
                      sx={{ fontSize: 11, fontWeight: 700, textTransform: 'none', py: 0.3, color: '#64748b', borderColor: '#cbd5e1' }}>
                      Deselect All
                    </Button>
                  </Box>
                )}
              </Box>

              {/* ── TAB 0: SELECTION TABLE ── */}
              {printTab === 0 && (
                <>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Search QR codes in this selection list..."
                    value={printSearch}
                    onChange={e => setPrintSearch(e.target.value)}
                    InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ color: '#94a3b8', mr: 1 }} /> }}
                    sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                  />

                  <TableContainer sx={{ maxHeight: 400, overflowY: 'auto', border: '1.5px solid #e2e8f0', borderRadius: 2 }}>
                    <Table stickyHeader size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox" sx={{ background: '#f8fafc' }}>
                            <Checkbox
                              indeterminate={selectedCount > 0 && selectedCount < printGroup.records.length}
                              checked={printGroup.records.length > 0 && selectedCount === printGroup.records.length}
                              onChange={(e) => toggleSelectAll(e.target.checked)}
                              size="small"
                            />
                          </TableCell>
                          {['QR Number / Product ID', 'Crop / Product', 'Batch', 'Location', 'Copies'].map(h => (
                            <TableCell key={h} sx={{ fontWeight: 700, fontSize: 12, background: '#f8fafc' }}>{h}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {printGroup.records
                          .filter(r => {
                            if (!printSearch.trim()) return true;
                            const q = printSearch.trim().toLowerCase();
                            return (
                              (r.id && r.id.toLowerCase().includes(q)) ||
                              (r.crop && r.crop.toLowerCase().includes(q)) ||
                              (r.batch && r.batch.toLowerCase().includes(q)) ||
                              (r.locationCode && r.locationCode.toLowerCase().includes(q))
                            );
                          })
                          .map(r => {
                            const isChecked = Boolean(selectedQrs[r.id]);
                            const copies = copiesMap[r.id] ?? 1;

                            return (
                              <TableRow key={r.id} hover sx={{ background: isChecked ? '#f0f4ff' : '#fff' }}>
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    checked={isChecked}
                                    onChange={() => handleToggleQr(r.id)}
                                    size="small"
                                  />
                                </TableCell>
                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#1a227f' }}>
                                  {r.id}
                                </TableCell>
                                <TableCell sx={{ fontSize: 12.5, fontWeight: 600 }}>
                                  {r.crop || r.name}
                                </TableCell>
                                <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>
                                  {r.batch || r.batchCode || '—'}
                                </TableCell>
                                <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>
                                  {r.locationCode || r.location || '—'}
                                </TableCell>
                                <TableCell sx={{ width: 110 }}>
                                  <TextField
                                    type="number"
                                    size="small"
                                    disabled={!isChecked}
                                    value={isChecked ? copies : 0}
                                    onChange={(e) => handleCopyChange(r.id, e.target.value)}
                                    inputProps={{ min: 1, max: 99, style: { padding: '4px 8px', fontSize: 12, textAlign: 'center', fontWeight: 700 } }}
                                    sx={{ width: 75, '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }}
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}

              {/* ── TAB 1: LIVE PRINT PREVIEW ── */}
              {printTab === 1 && (
                <Box>
                  {previewLabels.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 6, border: '2px dashed #e2e8f0', borderRadius: 2 }}>
                      <PrintIcon sx={{ fontSize: 44, color: '#cbd5e1', mb: 1 }} />
                      <Typography sx={{ fontWeight: 700, color: '#475569' }}>No QR codes selected</Typography>
                      <Typography sx={{ fontSize: 12, color: '#94a3b8', mt: 0.5, mb: 2 }}>
                        Please go back to the selection tab and select at least one QR code.
                      </Typography>
                      <Button size="small" variant="contained" onClick={() => setPrintTab(0)}
                        sx={{ textTransform: 'none', background: '#1a227f' }}>
                        Go to Selection
                      </Button>
                    </Box>
                  ) : (
                    <>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                        <Typography sx={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
                          Live Preview: Showing all {previewLabels.length} labels that will be printed ({selectedCount} unique QRs)
                        </Typography>
                        <Chip
                          label={`${previewLabels.length} labels ready to print`}
                          size="small"
                          sx={{ background: '#f0fdf4', color: '#15803d', fontWeight: 700, fontSize: 11 }}
                        />
                      </Box>
                      <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                        gap: 1.5,
                        maxHeight: 420,
                        overflowY: 'auto',
                        p: 1.5,
                        background: '#f8fafc',
                        borderRadius: 2,
                        border: '1.5px solid #e2e8f0',
                      }}>
                        {previewLabels.map((lbl, idx) => (
                          <Box key={`${lbl.id}-${lbl.copyIndex}-${idx}`} sx={{
                            border: '1.5px solid #cbd5e1', borderRadius: 2, p: 1.5,
                            background: '#fff', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                          }}>
                            <Box
                              component="img"
                              src={`${batchAPI.qrBaseUrl()}${lbl.qrCodeUrl}`}
                              alt={lbl.id}
                              sx={{ width: 110, height: 110, objectFit: 'contain', display: 'block' }}
                            />
                            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#0f172a', mt: 0.8, lineHeight: 1.2 }}>
                              {lbl.crop || lbl.name || printGroup.name}
                            </Typography>
                            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#1a227f', fontFamily: 'monospace', mt: 0.4 }}>
                              {lbl.locationCode || lbl.id}
                            </Typography>
                            <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#475569', fontFamily: 'monospace', mt: 0.2 }}>
                              {lbl.id}
                            </Typography>
                            {lbl.totalCopies > 1 && (
                              <Chip
                                label={`Copy ${lbl.copyIndex} of ${lbl.totalCopies}`}
                                size="small"
                                sx={{ fontSize: 9, height: 18, mt: 0.6, background: '#e0e7ff', color: '#4338ca', fontWeight: 700 }}
                              />
                            )}
                          </Box>
                        ))}
                      </Box>
                    </>
                  )}
                </Box>
              )}
            </DialogContent>

            <DialogActions sx={{ px: 2.5, py: 1.8, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
              <Box>
                {printTab === 0 ? (
                  <Button
                    variant="outlined"
                    disabled={selectedCount === 0}
                    onClick={() => setPrintTab(1)}
                    sx={{ textTransform: 'none', fontWeight: 700, fontSize: 12.5 }}
                  >
                    View Print Preview ({totalLabelsToPrint} Labels)
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    startIcon={<ArrowBackIcon />}
                    onClick={() => setPrintTab(0)}
                    sx={{ textTransform: 'none', fontWeight: 700, fontSize: 12.5 }}
                  >
                    Back to Selection
                  </Button>
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button onClick={() => setPrintGroup(null)} sx={{ fontWeight: 600 }}>
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  startIcon={<PrintIcon />}
                  disabled={selectedCount === 0}
                  onClick={executePrintLabels}
                  sx={{
                    background: 'linear-gradient(135deg,#1a227f,#3d47a3)',
                    fontWeight: 700,
                    px: 2.5,
                  }}
                >
                  Print {totalLabelsToPrint} Label{totalLabelsToPrint === 1 ? '' : 's'}
                </Button>
              </Box>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* ── 4. SINGLE QR VIEWER MODAL ── */}
      <Dialog open={Boolean(previewQr)} onClose={() => setPreviewQr(null)} maxWidth="xs" fullWidth>
        {previewQr && (
          <DialogContent sx={{ textAlign: 'center', p: 3 }}>
            <Box
              component="img"
              src={`${batchAPI.qrBaseUrl()}${previewQr.qrCodeUrl}`}
              alt={previewQr.id}
              sx={{ width: 220, height: 220, objectFit: 'contain', mx: 'auto', display: 'block', border: '1px solid #e2e8f0', borderRadius: 2, p: 1 }}
            />
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a', mt: 2 }}>
              {previewQr.crop || previewQr.name}
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1a227f', fontFamily: 'monospace', mt: 0.8 }}>
              Location: {previewQr.locationCode || previewQr.id}
            </Typography>
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#475569', fontFamily: 'monospace', mt: 0.5 }}>
              ID: {previewQr.id}
            </Typography>
            <Button
              variant="outlined"
              onClick={() => setPreviewQr(null)}
              sx={{ mt: 2.5, fontWeight: 700, textTransform: 'none' }}
            >
              Close
            </Button>
          </DialogContent>
        )}
      </Dialog>

      {/* Edit Batch & Add Extra QR Dialog */}
      <EditBatchDialog
        open={Boolean(editBatchId)}
        batchId={editBatchId}
        onClose={() => setEditBatchId(null)}
        onUpdated={(data) => {
          setSuccessMsg(data?.message || 'Batch updated with extra QR codes successfully');
          fetchInventory();
        }}
      />

      {/* Duplicate Batch & Location-wise QR Dialog */}
      <DuplicateBatchDialog
        open={Boolean(duplicateBatchId)}
        batchId={duplicateBatchId}
        onClose={() => setDuplicateBatchId(null)}
        onSuccess={(data) => {
          setSuccessMsg(data?.message || 'Duplicate batch created successfully');
          fetchInventory();
        }}
      />

      {/* Batch Select Dialog for multi-batch product sets (Edit) */}
      <Dialog open={Boolean(batchSelectDialog)} onClose={() => setBatchSelectDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, fontSize: 16 }}>Select Batch to Edit</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2 }}>
            This product group contains items from multiple batches. Choose which batch to edit:
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {batchSelectDialog?.batches?.map(b => (
              <Button
                key={b.id}
                variant="outlined"
                onClick={() => {
                  const id = b.id;
                  setBatchSelectDialog(null);
                  setEditBatchId(id);
                }}
                sx={{
                  justifyContent: 'space-between', p: 1.5, textTransform: 'none',
                  borderRadius: 2, borderColor: '#cbd5e1', color: '#0f172a', fontWeight: 700,
                  '&:hover': { borderColor: '#1a227f', background: '#f0f4ff' }
                }}
              >
                <span>{b.name}</span>
                <Chip label="Edit Batch" size="small" sx={{ background: '#1a227f', color: '#fff', fontSize: 11, fontWeight: 700 }} />
              </Button>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBatchSelectDialog(null)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* Batch Select Dialog for multi-batch product sets (Duplicate) */}
      <Dialog open={Boolean(duplicateSelectDialog)} onClose={() => setDuplicateSelectDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, fontSize: 16 }}>Select Batch to Duplicate</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2 }}>
            This product group contains items from multiple batches. Choose which batch to duplicate:
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {duplicateSelectDialog?.batches?.map(b => (
              <Button
                key={b.id}
                variant="outlined"
                onClick={() => {
                  const id = b.id;
                  setDuplicateSelectDialog(null);
                  setDuplicateBatchId(id);
                }}
                sx={{
                  justifyContent: 'space-between', p: 1.5, textTransform: 'none',
                  borderRadius: 2, borderColor: '#cbd5e1', color: '#0f172a', fontWeight: 700,
                  '&:hover': { borderColor: '#1a227f', background: '#f0f4ff' }
                }}
              >
                <span>{b.name}</span>
                <Chip label="Duplicate" size="small" sx={{ background: '#1a227f', color: '#fff', fontSize: 11, fontWeight: 700 }} />
              </Button>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDuplicateSelectDialog(null)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* New Batch Dialog */}
      <NewBatchDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(data) => {
          setSuccessMsg(`${data.packets?.length || ''} QR codes generated for "${data.batch?.batchName || ''}"`);
          fetchInventory();
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
