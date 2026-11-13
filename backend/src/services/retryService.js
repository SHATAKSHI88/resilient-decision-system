const WorkflowRequest = require('../models/WorkflowRequest');
const AuditLog = require('../models/AuditLog');
const env = require('../config/env');
const { resumeWorkflow } = require('./workflowService');
const { getRetryConfig } = require('./retryConfig');
const { DEFAULTS } = require('../validators/retryValidator');
const policy = require('./retryPolicy');

/**
 * Executes retries of FAILED requests (automatic from the worker, or manual from the API). Both paths use the SAME atomic claim,
 * so a request can only be retried by one caller at a time and never twice for the same failure:
 *
 *   findOneAndUpdate({ status FAILED, executionState FAILED, temporary failure, retry.state eligible, retry.count unchanged ... },
 *                    { status PROCESSING, executionState RUNNING, retry.state IN_PROGRESS, retry.count + 1, lease, history entry })
 *
 * The claim also takes the request out of the schedule (nextRetryAt = null), which is what makes a manual retry win cleanly over a
 * scheduled one (and vice versa). The retry then RESUMES at the failed stage (workflowService.resumeWorkflow).
 */

const audit = async (requestId, action, previousState, newState, description, actor, details) => {
  try { await AuditLog.create({ requestId, action, previousState, newState, description, actor, details }); } catch (e) { /* audit is best effort */ }
};

const configOrDefaults = async () => { try { return await getRetryConfig(); } catch (e) { return { ...DEFAULTS }; } };

/** Atomically moves a FAILED request to PROCESSING/IN_PROGRESS for a retry. Returns the claimed document or null. */
function claimRetry(doc, { trigger, initiatedBy, now, lockMs }) {
  const count = (doc.retry && doc.retry.count) || 0;
  const automatic = trigger === 'AUTOMATIC';
  const filter = {
    requestId: doc.requestId,
    status: 'FAILED',
    executionState: 'FAILED',
    'failure.kind': { $in: policy.TEMPORARY_KINDS }, // permanent failures can never be claimed
    'retry.count': { $in: count === 0 ? [0, null] : [count] }, // unchanged since we read it: nobody retried in between
    // automatic: only a scheduled retry that is due. manual: scheduled (takes over), exhausted, or a pre-Phase-9 failure (no retry state).
    'retry.state': automatic ? 'SCHEDULED' : { $in: [policy.STATE.SCHEDULED, policy.STATE.EXHAUSTED, null] },
    ...(automatic ? { 'retry.nextRetryAt': { $lte: new Date(now) } } : {}),
  };
  const startedAt = new Date(now);
  return WorkflowRequest.findOneAndUpdate(
    filter,
    {
      $set: {
        status: 'PROCESSING', executionState: 'RUNNING', executionStartedAt: startedAt,
        'retry.state': policy.STATE.IN_PROGRESS, 'retry.nextRetryAt': null, 'retry.lockedUntil': new Date(now + lockMs),
      },
      $inc: { 'retry.count': 1 },
      $push: { 'retry.history': { attempt: count + 1, trigger, initiatedBy, scheduledFor: doc.retry && doc.retry.nextRetryAt ? doc.retry.nextRetryAt : undefined, startedAt, outcome: 'RUNNING' } },
    },
    { new: true }
  );
}

/**
 * Retries one request.
 * @param {string} requestId
 * @param {{ trigger?: 'AUTOMATIC'|'MANUAL', initiatedBy?: string, lockMs?: number }} opts
 * @returns {Promise<{ outcome: 'RETRIED'|'NOT_FOUND'|'NOT_ELIGIBLE'|'NOT_CLAIMED', reason?: string, request?: object, succeeded?: boolean }>}
 *   NOT_ELIGIBLE: wrong status / permanent failure (manual only, reason says why). NOT_CLAIMED: somebody else got there first or
 *   the schedule changed (e.g. a manual retry took over); nothing was executed.
 */
async function retryRequest(requestId, { trigger = 'MANUAL', initiatedBy = 'operator', lockMs = env.retryLockMs } = {}) {
  const doc = await WorkflowRequest.findOne({ requestId });
  if (!doc) return { outcome: 'NOT_FOUND' };
  if (trigger === 'MANUAL') {
    const e = policy.manualEligibility(doc);
    if (!e.eligible) return { outcome: 'NOT_ELIGIBLE', reason: e.reason, request: doc };
  }
  const claimed = await claimRetry(doc, { trigger, initiatedBy, now: policy.clock.now(), lockMs });
  if (!claimed) {
    const fresh = (await WorkflowRequest.findOne({ requestId })) || doc;
    const e = policy.manualEligibility(fresh);
    return { outcome: 'NOT_CLAIMED', reason: e.eligible ? 'Another retry started first or the retry schedule changed; nothing was executed.' : e.reason, request: fresh };
  }
  const attempt = claimed.retry.count;
  await audit(requestId, 'RETRY_STARTED', 'FAILED', 'PROCESSING', `${trigger === 'MANUAL' ? 'Manual' : 'Automatic'} retry #${attempt} started`, initiatedBy, { trigger, attempt });
  const { request, succeeded } = await resumeWorkflow(claimed);
  await audit(requestId, succeeded ? 'RETRY_SUCCEEDED' : 'RETRY_FAILED', 'PROCESSING', request.status,
    succeeded ? `Retry #${attempt} succeeded; request is ${request.status}` : `Retry #${attempt} failed: ${request.retry && request.retry.lastError ? request.retry.lastError.message : 'unknown error'}`,
    initiatedBy, { trigger, attempt, nextRetryAt: request.retry && request.retry.nextRetryAt });
  return { outcome: 'RETRIED', succeeded, request };
}

/**
 * Restart/crash recovery. A retry that holds an expired lease belongs to a process that died (or hung) mid-retry: the request would
 * otherwise stay PROCESSING forever. Each one is atomically put back to FAILED and rescheduled (or EXHAUSTED) exactly like any other
 * failed attempt; the interrupted attempt is kept in the history as INTERRUPTED. Returns the number of requests recovered.
 */
async function recoverInterrupted({ now = policy.clock.now(), limit = 50 } = {}) {
  const stale = await WorkflowRequest.find({
    status: 'PROCESSING', executionState: 'RUNNING', 'retry.state': policy.STATE.IN_PROGRESS, 'retry.lockedUntil': { $lt: new Date(now) },
  }).limit(limit);
  if (!stale.length) return 0;
  const cfg = await configOrDefaults();
  let recovered = 0;
  for (const doc of stale) {
    const count = doc.retry.count || 0;
    const exhausted = count >= cfg.maxAttempts;
    const idx = (doc.retry.history || []).length - 1;
    const message = 'Retry was interrupted (the application stopped or the retry did not finish in time)';
    const set = {
      status: 'FAILED', executionState: 'FAILED', executionError: message,
      'retry.state': exhausted ? policy.STATE.EXHAUSTED : policy.STATE.SCHEDULED,
      'retry.nextRetryAt': exhausted ? null : new Date(now + policy.computeDelay(count, cfg)),
      'retry.lockedUntil': null, 'retry.maxAttempts': cfg.maxAttempts,
      'retry.lastError': { kind: 'INTERRUPTED', message, at: new Date(now), attempt: count },
    };
    if (idx >= 0) Object.assign(set, { [`retry.history.${idx}.outcome`]: 'INTERRUPTED', [`retry.history.${idx}.completedAt`]: new Date(now), [`retry.history.${idx}.error`]: message });
    const won = await WorkflowRequest.findOneAndUpdate(
      // lockedUntil must still be the value we saw: if the owner finished (or somebody else recovered it) this matches nothing
      { requestId: doc.requestId, status: 'PROCESSING', executionState: 'RUNNING', 'retry.state': policy.STATE.IN_PROGRESS, 'retry.lockedUntil': doc.retry.lockedUntil },
      { $set: set },
      { new: true }
    );
    if (won) {
      recovered += 1;
      await audit(doc.requestId, 'RETRY_INTERRUPTED', 'PROCESSING', 'FAILED', `Retry #${count} was interrupted and has been rescheduled`, 'system', { attempt: count });
    }
  }
  return recovered;
}

/** Starts every automatic retry that is due (at most `limit`, in parallel; the atomic claim keeps each request single-run). */
async function processDueRetries({ now = policy.clock.now(), limit = env.retryBatchSize } = {}) {
  const due = await WorkflowRequest.find({
    status: 'FAILED', executionState: 'FAILED', 'retry.state': policy.STATE.SCHEDULED, 'retry.nextRetryAt': { $lte: new Date(now) },
  }).sort({ 'retry.nextRetryAt': 1 }).limit(limit);
  const results = await Promise.allSettled(due.map((d) => retryRequest(d.requestId, { trigger: 'AUTOMATIC', initiatedBy: 'system' })));
  const summary = { due: due.length, started: 0, succeeded: 0, failedAgain: 0, skipped: 0, errors: 0 };
  results.forEach((r) => {
    if (r.status === 'rejected') { summary.errors += 1; console.error('[retry] unexpected error:', r.reason && r.reason.message); return; }
    if (r.value.outcome !== 'RETRIED') summary.skipped += 1;
    else { summary.started += 1; if (r.value.succeeded) summary.succeeded += 1; else summary.failedAgain += 1; }
  });
  return summary;
}

module.exports = { retryRequest, claimRetry, recoverInterrupted, processDueRetries };
