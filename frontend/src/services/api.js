import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  timeout: 5000,
});

export const getHealth = () => api.get('/health').then((r) => r.data.data);

// idempotencyKey makes retries safe: the server returns the original request instead of creating a duplicate.
export const submitRequest = (payload, idempotencyKey) =>
  api
    .post('/requests', payload, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined)
    .then((r) => ({ ...r.data, httpStatus: r.status }));

export const getRequests = (params) => api.get('/requests', { params }).then((r) => r.data);
export const getRequest = (id) => api.get(`/requests/${encodeURIComponent(id)}`).then((r) => r.data.data);

export const getStats = () => api.get('/requests/stats').then((r) => r.data.data);

// Simulated external verification service (Phase 8). The test call can take up to the configured timeout, so allow more time.
export const getVerificationDependency = () => api.get('/dependencies/verification').then((r) => r.data.data);
export const updateVerificationConfig = (payload) => api.put('/dependencies/verification/config', payload).then((r) => r.data.data);
export const testVerificationDependency = (payload) => api.post('/dependencies/verification/test', payload || {}, { timeout: 40000 }).then((r) => r.data);

// Retries (Phase 9). The manual retry runs the retry to completion on the server, so allow the dependency timeout (max 30 s) plus margin.
export const getRetryConfig = () => api.get('/retries/config').then((r) => r.data.data);
export const retryRequest = (id) => api.post(`/requests/${encodeURIComponent(id)}/retry`, {}, { timeout: 45000 }).then((r) => r.data);

export const getRules = () => api.get('/rules').then((r) => r.data.data);
export const createRule = (payload) => api.post('/rules', payload).then((r) => r.data.data);
export const updateRule = (id, payload) => api.put(`/rules/${encodeURIComponent(id)}`, payload).then((r) => r.data.data);
export const deleteRule = (id) => api.delete(`/rules/${encodeURIComponent(id)}`).then((r) => r.data);

export const getWorkflows = () => api.get('/workflows').then((r) => r.data.data);
export const createWorkflow = (payload) => api.post('/workflows', payload).then((r) => r.data.data);
export const updateWorkflow = (id, payload) => api.put(`/workflows/${encodeURIComponent(id)}`, payload).then((r) => r.data.data);
export const deleteWorkflow = (id) => api.delete(`/workflows/${encodeURIComponent(id)}`).then((r) => r.data);

export const errorMessage = (err) =>
  err.response?.data?.error?.message || 'Could not reach the server. Please try again.';

export default api;
