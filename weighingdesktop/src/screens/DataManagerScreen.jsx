import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import RecordGrid from '../components/RecordGrid';
import SyncStatusBar from '../components/SyncStatusBar';
import ConflictDialog from '../components/ConflictDialog';
import AddRecordDialog from '../components/AddRecordDialog';

const desktop = window.desktop;

const ROLE_LABEL = { superadmin: 'Superadmin', admin: 'Admin', operator: 'Operator (admin)' };

// Screen 2 of 2: the Excel-style table and Excel Workbook Synchronization.
export default function DataManagerScreen({ session, info }) {
  const { columns, packetDerived } = info;
  const canManage = session.canManage;

  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(null);
  // The message is kept while the toast animates out; `open` alone hides it.
  const [toastState, setToastState] = useState({ open: false, severity: 'info', message: '' });
  const setToast = useCallback((next) => setToastState((current) => (next ? { open: true, ...next } : { ...current, open: false })), []);
  const [addOpen, setAddOpen] = useState(false);
  const [issueRecordId, setIssueRecordId] = useState(null);

  useEffect(() => {
    let active = true;
    const off = desktop.on('data', (data) => {
      if (!active) return;
      setRows(data.rows);
      setStatus(data.status);
    });
    desktop.call('data.get').then((data) => {
      if (!active) return;
      setRows(data.rows);
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

  // Thrown errors reach the grid, which then restores the previous value.
  const onEdit = useCallback((recordId, changes) => desktop.call('records.update', recordId, changes), []);
  const onOpenIssue = useCallback((row) => { if (canManage) setIssueRecordId(row.recordId); }, [canManage]);

  // What an empty table should say. An error or a first load in progress is
  // never worded as "there are no records".
  const hasRows = rows.length > 0;
  const failed = Boolean(status?.lastError) && status.state !== 'syncing' && status.lastErrorKind !== 'forbidden';
  // Normally 0: the backend adds existing packets before it lists records.
  // It is briefly non-zero only if packets were created while this sync ran.
  const notImported = status?.packetsNotImported || 0;
  let emptyState;
  if (!status || status.loading || (!status.lastSyncAt && !failed)) {
    emptyState = { kind: 'loading', message: 'Loading records from the server…' };
  } else if (failed) {
    emptyState = { kind: 'error', message: 'Records could not be loaded. This does not mean the database is empty — see the message above and retry.' };
  } else if (notImported > 0) {
    emptyState = { kind: 'not-imported', message: `${notImported} existing seed packet${notImported === 1 ? ' is' : 's are'} in the database but not loaded yet. Sync again to load ${notImported === 1 ? 'it' : 'them'}.` };
  } else {
    emptyState = { kind: 'empty', message: 'The server was reached and returned no desktop records.' };
  }

  const issueRow = issueRecordId ? rows.find((r) => r.recordId === issueRecordId && (r.syncState === 'conflict' || r.syncState === 'error')) : null;
  const closeIssue = () => setIssueRecordId(null);

  // YOY Workbook Synchronization state
  const yoy = status?.yoy || info.yoyStatus || {};
  const yoyFilePath = yoy.filePath || info.yoyWorkbookPath || 'D:\\dapatri argo\\YOY.xlsx';
  const yoySyncing = Boolean(yoy.syncing);
  const yoyLastError = yoy.lastError;
  const yoyLastSync = yoy.lastSyncAt;
  const yoyRowCount = yoy.rowCount || 0;

  let yoyStatusLabel = 'Synced';
  let yoyStatusColor = 'success';
  if (yoySyncing) {
    yoyStatusLabel = 'Syncing…';
    yoyStatusColor = 'info';
  } else if (yoyLastError) {
    yoyStatusLabel = 'Attention';
    yoyStatusColor = 'warning';
  } else if (!yoyLastSync) {
    yoyStatusLabel = 'Pending Sync';
    yoyStatusColor = 'default';
  }

  const yoyLastSyncText = yoyLastSync
    ? `Last sync: ${new Date(yoyLastSync).toLocaleTimeString()}`
    : 'Not synced yet';

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }} data-testid="data-screen">
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <Typography variant="h6" fontWeight={700} noWrap>Excel Data Manager</Typography>
          <SyncStatusBar status={status} />
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

      {/* Connected Excel Workbook Section */}
      <Paper
        elevation={0}
        sx={{
          mx: 2,
          mt: 1.5,
          mb: 0.5,
          p: 1.5,
          border: '1px solid #cbd5e1',
          borderRadius: 2,
          background: '#f8fafc',
        }}
        data-testid="excel-sync-section"
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between">
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography variant="subtitle2" fontWeight={800} color="#0f172a">
                Connected Excel Workbook:
              </Typography>
              <Chip
                size="small"
                label="YOY.xlsx"
                color="primary"
                sx={{ fontWeight: 700, fontSize: 12, height: 24 }}
              />
              <Chip
                size="small"
                color={yoyStatusColor}
                label={yoyStatusLabel}
                sx={{ fontWeight: 700, fontSize: 11, height: 22 }}
                data-testid="yoy-status-chip"
              />
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="caption" color="#475569" noWrap title={yoyFilePath} sx={{ maxWidth: 420, fontFamily: 'monospace', fontWeight: 600 }}>
                {yoyFilePath}
              </Typography>
              <Typography variant="caption" color="#64748b">
                • {yoyLastSyncText}
              </Typography>
              {yoyRowCount > 0 && (
                <Typography variant="caption" color="#64748b">
                  • {yoyRowCount} packets synchronized
                </Typography>
              )}
            </Stack>
          </Box>

          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
            <Button
              variant="contained"
              size="small"
              onClick={async () => {
                try {
                  await desktop.call('yoy.open');
                } catch (err) {
                  fail(err);
                }
              }}
              sx={{ textTransform: 'none', fontWeight: 700 }}
              data-testid="open-yoy-btn"
            >
              Open in Excel
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={async () => {
                try {
                  await desktop.call('yoy.sync');
                  setToast({ severity: 'success', message: 'YOY.xlsx synchronized with MongoDB.' });
                } catch (err) {
                  fail(err);
                }
              }}
              disabled={yoySyncing}
              sx={{ textTransform: 'none', fontWeight: 700 }}
              data-testid="sync-yoy-btn"
            >
              {yoySyncing ? 'Syncing...' : 'Sync Now'}
            </Button>
            <Button
              size="small"
              onClick={() => run('yoy.showInFolder')}
              sx={{ textTransform: 'none' }}
              data-testid="folder-yoy-btn"
            >
              Folder
            </Button>
            <Button
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

        {yoyLastError && (
          <Alert severity="warning" sx={{ mt: 1, py: 0.25 }} data-testid="yoy-error-banner">
            {yoyLastError}
          </Alert>
        )}
      </Paper>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1 }}>
        {canManage && (
          <Button variant="contained" size="small" onClick={() => setAddOpen(true)} data-testid="add-record">Add record</Button>
        )}
        <Button variant="outlined" size="small" onClick={() => run('sync.now')} disabled={status?.state === 'syncing'} data-testid="sync-now">Full Sync</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" color="text.secondary" noWrap title={info.workbookPath} data-testid="workbook-path">
          {info.workbookPath}
        </Typography>
        <Button size="small" onClick={() => run('workbook.showInFolder')} data-testid="show-workbook">Show in folder</Button>
        <Button
          size="small"
          onClick={async () => {
            const saved = await run('workbook.saveCopy');
            if (saved) setToast({ severity: 'success', message: `Copy saved to ${saved}` });
          }}
          data-testid="save-copy"
        >
          Save a copy
        </Button>
      </Stack>

      <Box sx={{ px: 2 }}>
        {!canManage && (
          <Alert severity="info" sx={{ mb: 1 }} data-testid="read-only-banner">
            View only. Adding and editing records is limited to Superadmin accounts.
          </Alert>
        )}
        {!session.verified && (
          <Alert severity="warning" sx={{ mb: 1 }} data-testid="unverified-banner">
            The server could not be reached to confirm your account. You are seeing the last downloaded records;
            nothing is sent until the connection returns.
          </Alert>
        )}
        {failed && (
          <Alert
            severity={status.lastErrorKind === 'offline' ? 'warning' : 'error'}
            sx={{ mb: 1 }}
            data-testid="sync-error"
            data-kind={status.lastErrorKind}
            action={(
              <Button color="inherit" size="small" onClick={() => run('sync.now')} data-testid="sync-retry">Retry</Button>
            )}
          >
            {status.lastError}
            {' '}
            {!hasRows && 'Nothing has been loaded from the server.'}
            {hasRows && (status.lastSyncAt
              ? `Showing the records from the last successful sync (${new Date(status.lastSyncAt).toLocaleString()}).`
              : 'Showing records saved on this computer from an earlier session.')}
          </Alert>
        )}
        {!failed && notImported > 0 && (
          <Alert
            severity="info"
            sx={{ mb: 1 }}
            data-testid="not-imported"
            action={(
              <Button color="inherit" size="small" onClick={() => run('sync.now')} data-testid="not-imported-sync">Sync now</Button>
            )}
          >
            {notImported} existing seed packet{notImported === 1 ? ' is' : 's are'} in the database but not in this table yet.
            {' '}{notImported === 1 ? 'It' : 'They'} will be loaded at the next sync.
          </Alert>
        )}
        {status?.workbookError && (
          <Alert severity="warning" sx={{ mb: 1 }} data-testid="workbook-error">{status.workbookError}</Alert>
        )}
      </Box>

      <Box sx={{ flexGrow: 1, minHeight: 0, px: 2, pb: 2 }}>
        <RecordGrid
          rows={rows}
          columns={columns}
          packetDerived={packetDerived}
          canManage={canManage}
          loading={Boolean(status?.loading) && !hasRows}
          emptyState={emptyState}
          onEdit={onEdit}
          onEditError={fail}
          onOpenIssue={onOpenIssue}
        />
      </Box>

      {canManage && (
        <AddRecordDialog
          open={addOpen}
          columns={columns}
          onSave={(fields) => desktop.call('records.create', fields)}
          onClose={() => setAddOpen(false)}
        />
      )}

      <ConflictDialog
        row={issueRow}
        columns={columns}
        onResolve={async (recordId, choice) => { await run('records.resolveConflict', recordId, choice); closeIssue(); }}
        onRetry={async (recordId) => { await run('records.retry', recordId); closeIssue(); }}
        onDiscard={async (recordId) => { await run('records.discard', recordId); closeIssue(); }}
        onClose={closeIssue}
      />

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
