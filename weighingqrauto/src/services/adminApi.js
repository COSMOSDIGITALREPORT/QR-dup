import {apiFetch} from './apiClient';
import {ensureReachableBaseUrl} from './serverConfig';

export const adminLogin = (email, password) =>
  apiFetch('/api/auth/login', {
    method: 'POST',
    body: {email, password},
  });

export const fetchBatches = token =>
  apiFetch('/api/batches', {
    method: 'GET',
    token,
  });

export const fetchBatchDetails = (batchId, token) =>
  apiFetch(`/api/batches/${batchId}`, {
    method: 'GET',
    token,
  });

export const fetchInventory = (params = {}, token) => {
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/api/batches/inventory${query ? `?${query}` : ''}`, {
    method: 'GET',
    token,
  });
};

export const duplicateBatch = (payload, token) =>
  apiFetch('/api/batches', {
    method: 'POST',
    body: payload,
    token,
    timeoutMs: 45000, // generating bulk QRs can take time
  });

export const getQrImageUrl = async path => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = await ensureReachableBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
};

