const WorkflowRequest = require('../models/WorkflowRequest');
const { dbState } = require('../config/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { validateRetryConfig } = require('../validators/retryValidator');
const { getRetryConfig, saveRetryConfig } = require('../services/retryConfig');
const { retryRequest } = require('../services/retryService');
const { worker } = require('../services/retryWorker');
const { STATE } = require('../services/retryPolicy');

const needDb = () => { if (dbState() !== 'connected') throw new ApiError(503, 'Database unavailable. Please try again later.'); };
const plain = (d) => (d && d.toObject ? d.toObject() : d);

// GET /api/retries/config - retry policy, worker status and how many requests are in each retry state
exports.getConfig = asyncHandler(async (req, res) => {
  needDb();
  const [config, scheduled, inProgress, exhausted] = await Promise.all([
    getRetryConfig(),
    WorkflowRequest.countDocuments({ 'retry.state': STATE.SCHEDULED }),
    WorkflowRequest.countDocuments({ 'retry.state': STATE.IN_PROGRESS }),
    WorkflowRequest.countDocuments({ 'retry.state': STATE.EXHAUSTED }),
  ]);
  res.json({ success: true, data: { config, worker: worker.getStatus(), counts: { scheduled, inProgress, exhausted } } });
});

// PUT /api/retries/config - omitted fields keep their current value; invalid values change nothing
exports.updateConfig = asyncHandler(async (req, res) => {
  needDb();
  const { errors, value } = validateRetryConfig(req.body, await getRetryConfig());
  if (Object.keys(errors).length) throw new ApiError(400, 'Validation failed', errors);
  res.json({ success: true, message: 'Retry settings saved. They apply to failures that happen from now on; already scheduled retries keep their time.', data: await saveRetryConfig(value) });
});

// Who pressed the button: the authenticated user if an auth layer ever sets req.user, otherwise the generic operator.
const actorOf = (req) => (req.user && (req.user.email || req.user.name || req.user.id)) || 'operator';

// POST /api/requests/:id/retry - manually retries a FAILED request whose failure was temporary. Runs the retry to completion
// (like POST /requests) and answers with the result. 409 when the request cannot be retried right now.
exports.retryNow = asyncHandler(async (req, res) => {
  needDb();
  const id = String(req.params.id).trim();
  const r = await retryRequest(id, { trigger: 'MANUAL', initiatedBy: actorOf(req) });
  if (r.outcome === 'NOT_FOUND') throw new ApiError(404, `Request ${id} not found`);
  if (r.outcome !== 'RETRIED') {
    throw new ApiError(409, r.reason, { requestId: id, status: r.request && r.request.status, retryState: r.request && r.request.retry && r.request.retry.state });
  }
  const data = plain(r.request);
  const next = data.retry && data.retry.nextRetryAt;
  const message = r.succeeded
    ? `Retry #${data.retry.count} succeeded. The request is now ${data.status}.`
    : `Retry #${data.retry.count} started but failed again: ${data.retry.lastError && data.retry.lastError.message}. ${next ? `Next automatic retry: ${new Date(next).toISOString()}.` : 'No further automatic retry is scheduled.'}`;
  res.json({ success: true, message, requestId: id, retried: true, succeeded: r.succeeded, executionState: data.executionState, initiatedBy: actorOf(req), data });
});
