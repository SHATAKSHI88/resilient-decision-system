const WorkflowRequest = require('../models/WorkflowRequest');
const { dbState } = require('../config/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { validateRequestBody } = require('../validators/requestValidator');
const WorkflowExecution = require('../models/WorkflowExecution');
const DependencyCall = require('../models/DependencyCall');
const { runWorkflow } = require('../services/workflowService');
const { parseKey, hashPayload, isIdempotencyDuplicate, isRequestIdDuplicate, stateOf } = require('../services/idempotency');
const { STATUSES } = require('../services/statusTransitions');
const { manualEligibility } = require('../services/retryPolicy');
const crypto = require('crypto');

const generateRequestId = () =>
  `REQ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const useDb = () => dbState() === 'connected';

exports.listRequests = asyncHandler(async (req, res) => {
  if (!useDb()) throw new ApiError(503, 'Database unavailable. Please try again later.');
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

  const filter = {};
  if (status) filter.status = status;
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ requestId: rx }, { applicantName: rx }, { email: rx }];
  }

  const [items, total] = await Promise.all([
    WorkflowRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-__v').lean(),
    WorkflowRequest.countDocuments(filter),
  ]);
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  res.json({
    success: true,
    meta: { source: 'database', page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    data: items,
  });
});

exports.getRequest = asyncHandler(async (req, res) => {
  if (!useDb()) throw new ApiError(503, 'Database unavailable. Please try again later.');
  const id = String(req.params.id).trim();
  const item = await WorkflowRequest.findOne({ requestId: id }).select('-__v').lean();
  if (!item) throw new ApiError(404, `Request ${id} not found`);
  const executionHistory = await WorkflowExecution.find({ requestId: id }).sort({ startedAt: 1, _id: 1 }).select('-__v').lean();
  const dependencyCalls = await DependencyCall.find({ requestId: id }).sort({ attemptedAt: 1, _id: 1 }).select('-__v').lean();
  res.json({ success: true, meta: { source: 'database' }, data: { ...item, executionHistory, dependencyCalls, manualRetry: manualEligibility(item) } });
});

exports.getStats = asyncHandler(async (req, res) => {
  if (!useDb()) throw new ApiError(503, 'Database unavailable. Please try again later.');
  const rows = await WorkflowRequest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  rows.forEach((r) => { if (r._id in byStatus) byStatus[r._id] = r.count; });
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  res.json({ success: true, data: { total, ...byStatus } });
});

// Human-readable summary for a request whose workflow ended in FAILED. Its data and completed stages are kept.
function failedMessage(doc, prefix) {
  const f = plain(doc).failure || {};
  const why = f.kind === 'DEPENDENCY_TIMEOUT' ? `verification timed out (${f.dependency})` : f.kind === 'DEPENDENCY_FAILURE' ? `verification failed (${f.dependency})` : `the workflow failed: ${f.message || doc.executionError || 'unknown error'}`;
  return `${prefix}, but ${why}. The request is FAILED; no approval or rejection was made.`;
}

const plain = (doc) => (doc && doc.toObject ? doc.toObject() : doc);

/**
 * One response shape for every outcome of POST /requests and POST /requests/:id/execute:
 *   { success, message, requestId, idempotent, processing, executionState, data }
 * 201 new request, 200 existing/finished request, 202 request still pending/running (Retry-After: 1).
 */
function reply(res, doc, { created = false, idempotent = false, executed, message }) {
  const state = stateOf(doc);
  const processing = state === 'PENDING' || state === 'RUNNING';
  const data = plain(doc);
  const failure = data.failure && data.failure.kind ? { kind: data.failure.kind, dependency: data.failure.dependency, message: data.failure.message } : undefined;
  if (idempotent) res.set('Idempotent-Replayed', 'true');
  if (processing) res.set('Retry-After', '1');
  res.status(processing ? 202 : created ? 201 : 200).json({
    success: true,
    message,
    requestId: doc.requestId,
    idempotent,
    processing,
    executionState: state,
    ...(executed !== undefined ? { executed } : {}),
    ...(failure ? { failure } : {}), // present when the workflow ended in FAILED (e.g. dependency timeout); nothing was approved or rejected
    data,
  });
}

// Existing request found for a key: same payload -> return it; different payload -> 422.
function replayOrConflict(res, existing, hash) {
  if (existing.payloadHash && existing.payloadHash !== hash) {
    throw new ApiError(422, 'Idempotency-Key was already used with a different request payload. Use a new key for a new submission.', {
      idempotencyKey: 'Key reused with a different payload',
      requestId: existing.requestId,
    });
  }
  const state = stateOf(existing);
  const done = state === 'COMPLETED' || state === 'FAILED';
  return reply(res, existing, {
    idempotent: true,
    message: done ? 'Existing request returned for this Idempotency-Key' : 'Request already received and is still being processed',
  });
}

exports.createRequest = asyncHandler(async (req, res) => {
  const { errors, value } = validateRequestBody(req.body);
  if (Object.keys(errors).length) throw new ApiError(400, 'Validation failed', errors);
  const parsed = parseKey(req.get('Idempotency-Key'));
  if (parsed.error) throw new ApiError(400, parsed.error, { idempotencyKey: parsed.error });
  if (!useDb()) throw new ApiError(503, 'Database unavailable. Please try again later.');

  const { key } = parsed;
  const hash = hashPayload(value);

  if (key) {
    const existing = await WorkflowRequest.findOne({ idempotencyKey: key });
    if (existing) return replayOrConflict(res, existing, hash);
  }

  let saved;
  for (let attempt = 0; ; attempt++) {
    try {
      saved = await WorkflowRequest.create({
        ...value, requestId: generateRequestId(), status: 'PENDING', executionState: 'PENDING',
        ...(key ? { idempotencyKey: key } : {}), payloadHash: hash,
      });
      break;
    } catch (err) {
      // Lost a race with a concurrent request carrying the same key: the unique index rejected us. Return the winner's record.
      if (key && isIdempotencyDuplicate(err)) {
        const winner = await WorkflowRequest.findOne({ idempotencyKey: key });
        if (winner) return replayOrConflict(res, winner, hash);
      }
      if (isRequestIdDuplicate(err) && attempt < 2) continue; // astronomically rare generated-ID clash: retry with a new ID
      throw err;
    }
  }

  const { request } = await runWorkflow(saved); // atomic claim: only this call executes the new request
  reply(res, request, { created: true, message: stateOf(request) === 'FAILED' ? failedMessage(request, 'Application saved') : 'Application submitted' });
});

// Safe to call any number of times, concurrently or not: the workflow runs at most once per request.
exports.executeRequest = asyncHandler(async (req, res) => {
  if (!useDb()) throw new ApiError(503, 'Database unavailable. Please try again later.');
  const id = String(req.params.id).trim();
  const existing = await WorkflowRequest.findOne({ requestId: id });
  if (!existing) throw new ApiError(404, `Request ${id} not found`);
  const { request, executed } = await runWorkflow(existing);
  const state = stateOf(request);
  const message = executed ? (state === 'FAILED' ? failedMessage(request, 'Workflow executed') : 'Workflow executed')
    : state === 'RUNNING' || state === 'PENDING' ? 'Workflow is already being executed'
      : 'Workflow already executed; no action taken';
  reply(res, request, { created: false, idempotent: !executed, executed, message });
});
