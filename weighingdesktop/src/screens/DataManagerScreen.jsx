import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';

const desktop = window.desktop;

const ROLE_LABEL = { superadmin: 'Superadmin', admin: 'Admin', operator: 'Operator (admin)' };

export default function DataManagerScreen({ session, info }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(null);
  const [toastState, setToastState] = useState({ open: false, severity: 'info', message: '' });
  const setToast = useCallback((next) => setToastState((current) => (next ? { open: true, ...next } : { ...current, open: false })), []);

  // Selected file via Browse Excel that is pending connection
  const [pendingSelection, setPendingSelection] = useState(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let active = true;
    const off = desktop.on('data', (data) => {
      if (!active) return;
      setRows(data.rows || []);
      setStatus(data.status);
    });
    desktop.call('data.get').then((data) => {
      if (!active) return;
      setRows(data.rows || []);
      setStatus(data.status);
    });
    return () => { active = false; off(); };
  }, []);

  const fail = useCallback((err) => setToast({ severity: 'error', message: err.message || 'Something went wrong.' }), [setToast]);

  const run = useCallback(async (method, ...args) => {
    try {
      return await desktop.call(method, ...args);
    } catch (err) {
      fail(err);
      return undefined;
    }
  }, [fail]);

  // YOY Workbook Synchronization state
  const yoy = status?.yoy || info.yoyStatus || {};
  const yoyFilePath = yoy.filePath || info.yoyWorkbookPath || 'D:\\dapatri argo\\YOY.xlsx';
  const yoyFileName = yoy.fileName || (yoyFilePath ? yoyFilePath.split(/[/\\]/).pop() : 'YOY.xlsx');
  const yoyExists = Boolean(yoy.exists);
  const yoySyncing = Boolean(yoy.syncing);
  const yoyLastError = yoy.lastError;
  const yoyLastSync = yoy.lastSyncAt;
  const yoyRowCount = yoy.rowCount || rows.length || 0;

  // Status computation
  let yoyStatusLabel = 'Connected & Synced';
  let yoyStatusColor = 'success';
  if (yoySyncing) {
    yoyStatusLabel = 'Syncing…';
    yoyStatusColor = 'info';
  } else if (yoyLastError) {
    yoyStatusLabel = 'Attention';
    yoyStatusColor = 'error';
  } else if (!yoyLastSync) {
    yoyStatusLabel = yoyExists ? 'Ready to Sync' : 'Pending Sync';
    yoyStatusColor = yoyExists ? 'primary' : 'default';
  }

  const yoyLastSyncText = yoyLastSync
    ? `Last sync: ${new Date(yoyLastSync).toLocaleTimeString()}`
    : 'Not synced yet';

  // Handle Browse Excel
  const handleBrowse = async () => {
    try {
      const res = await desktop.call('yoy.browse');
      if (res && !res.canceled && res.filePath) {
        setPendingSelection(res);
        setToast({ severity: 'info', message: `Selected: ${res.fileName}. Click "Connect Workbook" to activate.` });
      }
    } catch (err) {
      fail(err);
    }
  };

  // Handle Connect Workbook
  const handleConnect = async () => {
    const targetPath = pendingSelection?.filePath || yoyFilePath;
    if (!targetPath) {
      setToast({ severity: 'warning', message: 'Please browse and select an Excel workbook first.' });
      return;
    }
    setConnecting(true);
    try {
      await desktop.call('yoy.connect', targetPath);
      setPendingSelection(null);
      setToast({ severity: 'success', message: `Workbook connected: ${targetPath.split(/[/\\]/).pop()}` });
    } catch (err) {
      fail(err);
    } finally {
      setConnecting(false);
    }
  };

  // Handle Sync Excel File
  const handleSyncYoy = async () => {
    try {
      await desktop.call('yoy.sync');
      setToast({ severity: 'success', message: 'Excel file synchronized with MongoDB.' });
    } catch (err) {
      fail(err);
    }
  };

  // Handle Open in Excel
  const handleOpenExcel = async () => {
    try {
      await desktop.call('yoy.open');
    } catch (err) {
      fail(err);
    }
  };

  const failed = Boolean(status?.lastError) && status.state !== 'syncing' && status.lastErrorKind !== 'forbidden';

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#f4f6f8' }} data-testid="data-screen">
      {/* Top Application Bar */}
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <Typography variant="h6" fontWeight={800} color="#1a227f" noWrap>
            WeighingQR — Excel Data Manager
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" color="text.secondary" noWrap title={`Version ${info.version} · Server: ${info.apiUrl}`} data-testid="app-version">
            v{info.version} · {info.apiUrl}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={`${session.admin.name} · ${ROLE_LABEL[session.admin.role] || session.admin.role}`}
            data-testid="account-chip"
            data-role={session.admin.role}
          />
          <Button size="small" onClick={() => run('auth.logout')} data-testid="logout">Sign out</Button>
        </Toolbar>
      </AppBar>

      {/* Main Content Area */}
      <Container maxWidth="lg" sx={{ py: 3, flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Alerts */}
        {!session.verified && (
          <Alert severity="warning" sx={{ mb: 2 }} data-testid="unverified-banner">
            The server could not be reached to confirm your account. You are seeing the last downloaded records.
          </Alert>
        )}
        {failed && (
          <Alert
            severity={status.lastErrorKind === 'offline' ? 'warning' : 'error'}
            sx={{ mb: 2 }}
            data-testid="sync-error"
            action={(
              <Button color="inherit" size="small" onClick={() => run('sync.now')} data-testid="sync-retry">Retry</Button>
            )}
          >
            {status.lastError}
          </Alert>
        )}

        {/* Connected Excel Workbook Section */}
        <Paper
          elevation={1}
          sx={{
            p: 3,
            border: '1px solid #cbd5e1',
            borderRadius: 2.5,
            background: '#ffffff',
          }}
          data-testid="excel-sync-section"
        >
          {/* Card Title & Status Header */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" sx={{ mb: 2 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Typography variant="h6" fontWeight={800} color="#0f172a">
                Connected Excel Workbook:
              </Typography>
              <Chip
                size="medium"
                label={yoyFileName}
                sx={{
                  bgcolor: '#107c41',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: 13,
                  height: 28,
                  letterSpacing: 0.3,
                }}
              />
              <Chip
                size="small"
                color={yoyStatusColor}
                label={yoyStatusLabel}
                sx={{ fontWeight: 700, fontSize: 11, height: 24 }}
                data-testid="yoy-status-chip"
              />
            </Stack>

            <Typography variant="caption" sx={{ color: '#059669', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              ● MongoDB Connected
            </Typography>
          </Stack>

          <Divider sx={{ my: 1.5 }} />

          {/* Connected File Path & Meta Display */}
          <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0', mb: 2.5 }}>
            <Typography variant="caption" fontWeight={700} color="#64748b" textTransform="uppercase" letterSpacing={0.5} sx={{ display: 'block', mb: 0.5 }}>
              Active Workbook Path
            </Typography>
            <Typography
              variant="body2"
              color="#0f172a"
              title={yoyFilePath}
              sx={{
                fontFamily: 'Consolas, monospace',
                fontWeight: 600,
                fontSize: 13.5,
                wordBreak: 'break-all',
                bgcolor: '#ffffff',
                p: 1.25,
                borderRadius: 1,
                border: '1px solid #cbd5e1',
              }}
            >
              {yoyFilePath}
            </Typography>

            <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="caption" color="#475569" fontWeight={600}>
                • {yoyLastSyncText}
              </Typography>
              {yoyRowCount > 0 && (
                <Typography variant="caption" color="#0284c7" fontWeight={700}>
                  • {yoyRowCount} records synchronized
                </Typography>
              )}
              <Typography variant="caption" color={yoyExists ? '#16a34a' : '#d97706'} fontWeight={600}>
                • {yoyExists ? 'File exists on disk' : 'File will be generated on sync'}
              </Typography>
            </Stack>
          </Box>

          {/* Pending Selection Banner (When user browsed a file) */}
          {pendingSelection && pendingSelection.filePath !== yoyFilePath && (
            <Alert
              severity="info"
              sx={{ mb: 2 }}
              action={(
                <Button color="primary" size="small" variant="contained" onClick={handleConnect} disabled={connecting} sx={{ textTransform: 'none', fontWeight: 700 }}>
                  {connecting ? 'Connecting…' : 'Activate Connection'}
                </Button>
              )}
            >
              Selected: <strong>{pendingSelection.fileName}</strong> ({pendingSelection.filePath}). Click &ldquo;Activate Connection&rdquo; to save and connect.
            </Alert>
          )}

          {/* Error Banner */}
          {yoyLastError && (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="yoy-error-banner">
              {yoyLastError}
            </Alert>
          )}

          {/* Action Buttons Bar */}
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Button
              variant="outlined"
              size="medium"
              onClick={handleBrowse}
              sx={{ textTransform: 'none', fontWeight: 700, minWidth: 130 }}
              data-testid="browse-excel-btn"
            >
              Browse Excel
            </Button>
            <Button
              variant={pendingSelection ? 'contained' : 'outlined'}
              color="primary"
              size="medium"
              onClick={handleConnect}
              disabled={connecting || (!pendingSelection && yoyExists)}
              sx={{ textTransform: 'none', fontWeight: 700, minWidth: 150 }}
              data-testid="connect-workbook-btn"
            >
              {connecting ? 'Connecting…' : 'Connect Workbook'}
            </Button>
            <Button
              variant="contained"
              size="medium"
              onClick={handleOpenExcel}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                minWidth: 130,
                bgcolor: '#107c41',
                '&:hover': { bgcolor: '#0b5c30' },
              }}
              data-testid="open-yoy-btn"
            >
              Open in Excel
            </Button>
            <Button
              variant="contained"
              color="primary"
              size="medium"
              onClick={handleSyncYoy}
              disabled={yoySyncing}
              sx={{ textTransform: 'none', fontWeight: 700, minWidth: 130 }}
              data-testid="sync-yoy-btn"
            >
              {yoySyncing ? 'Syncing…' : 'Sync Excel File'}
            </Button>
            <Button
              variant="outlined"
              size="medium"
              onClick={() => run('sync.now')}
              disabled={status?.state === 'syncing'}
              data-testid="sync-now"
              sx={{ textTransform: 'none', fontWeight: 700, minWidth: 140 }}
            >
              Full Sync from DB
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                onClick={() => run('yoy.showInFolder')}
                sx={{ textTransform: 'none' }}
                data-testid="folder-yoy-btn"
              >
                Folder
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                onClick={async () => {
                  const saved = await run('yoy.saveCopy');
                  if (saved) setToast({ severity: 'success', message: `Copy saved to ${saved}` });
                }}
                sx={{ textTransform: 'none' }}
                data-testid="save-yoy-copy-btn"
              >
                Save Copy
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {/* Informative Guidance Card */}
        <Paper
          elevation={0}
          sx={{
            mt: 3,
            p: 2.5,
            border: '1px solid #e2e8f0',
            borderRadius: 2,
            bgcolor: '#ffffff',
          }}
        >
          <Typography variant="subtitle2" fontWeight={700} color="#334155" gutterBottom>
            How to use on any laptop:
          </Typography>
          <Stack spacing={1}>
            <Typography variant="body2" color="#64748b">
              1. <strong>Browse Excel:</strong> Click &ldquo;Browse Excel&rdquo; to select any existing <code>.xlsx</code> workbook on this computer.
            </Typography>
            <Typography variant="body2" color="#64748b">
              2. <strong>Connect Workbook:</strong> Click &ldquo;Connect Workbook&rdquo; to save this file path in your application settings. Next time you open the app, it will automatically connect to this file.
            </Typography>
            <Typography variant="body2" color="#64748b">
              3. <strong>Sync Excel File:</strong> Click &ldquo;Sync Excel File&rdquo; to synchronize seed records from the MongoDB database directly into your connected Excel workbook.
            </Typography>
            <Typography variant="body2" color="#64748b">
              4. <strong>Open in Excel:</strong> Opens the live connected workbook directly in Microsoft Excel.
            </Typography>
            <Typography variant="body2" color="#64748b">
              5. <strong>Full Sync from DB:</strong> Pulls all recent changes from the production database to keep local records completely up to date.
            </Typography>
          </Stack>
        </Paper>
      </Container>

      {/* Toast Notification */}
      <Snackbar
        open={toastState.open}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toastState.severity} onClose={() => setToast(null)} data-testid="toast">{toastState.message}</Alert>
      </Snackbar>
    </Box>
  );
}
