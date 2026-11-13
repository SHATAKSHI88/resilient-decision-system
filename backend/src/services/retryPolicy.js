const { DEFAULTS } = require('../validators/retryValidator');

/**
 * Pure retry rules (no database access): backoff, classification of failures and the retry state written to a request.
 *
 * Terminology: `retry.count` = retries already STARTED (automatic + manual). Automatic retries are scheduled only while
 * count < maxAttempts, so with maxAttempts = 3 a request runs once and is retried automatically at most 3 times.
 */

// Failure kinds (WorkflowRequest.failure.kind) that are TEMPORARY, i.e. worth retrying. Everything else (validation errors,
// missing/invalid workflow configuration, no transition, ...) is permanent: repeating it cannot give a different answer.
const TEMPORARY_KINDS = ['DEPENDENCY_TIMEOUT', 'DEPENDENCY_FAILURE'];
const isTemporaryFailure = (failure) => !!failure && TEMPORARY_KINDS.includes(failure.kind);

// retry.state values
const STATE = {
  SCHEDULED: 'SCHEDULED', // an automatic retry is due at retry.nextRetryAt
  IN_PROGRESS: 'IN_PROGRESS', // a retry (automatic or manual) is executing right now
  EXHAUSTED: 'EXHAUSTED', // temporary failure but the maximum number of attempts was reached (manual retry still possible)
  NOT_RETRYABLE: 'NOT_RETRYABLE', // permanent failure
  RECOVERED: 'RECOVERED', // a retry finished the workflow
};

// Test hook so tests control "now".
const clock = { now: () => Date.now() };
const setClock = (c) => Object.assign(clock, c);

/** delay = min(initialDelay * backoffMultiplier ^ retryCount, maximumDelay), in ms. retryCount = retries already started. */
function computeDelay(retryCount, cfg = DEFAULTS) {
  const raw = cfg.initialDelayMs * Math.pow(cfg.backoffMultiplier, Math.max(0, retryCount));
  return Math.round(Math.min(raw, cfg.maxDelayMs)); // min() also caps Infinity from very large exponents
}

const ensureRetry = (request) => {
  if (!request.retry) request.retry = { count: 0, history: [] };
  if (!request.retry.history) request.retry.history = [];
  if (!request.retry.count) request.retry.count = 0;
  return request.retry;
};

/** Closes the history entry of the retry that is running (the last one), if any. Returns true when one was open. */
function closeAttempt(request, outcome, error) {
  const r = ensureRetry(request);
  const entry = r.history[r.history.length - 1];
  if (!entry || entry.outcome !== 'RUNNING') return false;
  entry.outcome = outcome;
  entry.completedAt = new Date(clock.now());
  if (error) entry.error = error;
  return true;
}

/**
 * Called when a run ends in FAILED. Records lastError, closes the running attempt and decides what happens next:
 * permanent -> NOT_RETRYABLE; attempts used up -> EXHAUSTED; otherwise SCHEDULED with nextRetryAt from the backoff formula.
 */
function applyFailure(request, cfg = DEFAULTS, now = clock.now()) {
  const r = ensureRetry(request);
  const f = request.failure || {};
  closeAttempt(request, 'FAILED', f.message);
  r.maxAttempts = cfg.maxAttempts;
  r.lastError = { kind: f.kind, message: f.message, at: new Date(now), attempt: r.count };
  r.lockedUntil = null;
  // a request whose decision was already recorded (status not FAILED) cannot be resumed, so it is never scheduled
  if (!isTemporaryFailure(f) || request.status !== 'FAILED') { r.state = STATE.NOT_RETRYABLE; r.nextRetryAt = null; return r; }
  if (r.count >= cfg.maxAttempts) { r.state = STATE.EXHAUSTED; r.nextRetryAt = null; return r; }
  r.state = STATE.SCHEDULED;
  r.nextRetryAt = new Date(now + computeDelay(r.count, cfg));
  return r;
}

/** Called when a retry finished the workflow. */
function applySuccess(request) {
  const r = ensureRetry(request);
  closeAttempt(request, 'SUCCEEDED');
  r.state = STATE.RECOVERED; r.nextRetryAt = null; r.lockedUntil = null;
  return r;
}

/**
 * Can an operator retry this request now? Returns { eligible, reason }.
 * Eligible: FAILED with a temporary failure and no retry running. Allowed even when automatic attempts are used up
 * (that is what manual recovery is for) and before a scheduled retry is due (the manual retry takes over the schedule).
 */
function manualEligibility(doc) {
  const state = doc.retry && doc.retry.state;
  if (doc.status === 'PROCESSING' || doc.executionState === 'RUNNING' || state === STATE.IN_PROGRESS) return { eligible: false, reason: 'A retry or execution is already in progress for this request.' };
  if (doc.status !== 'FAILED') return { eligible: false, reason: `Only FAILED requests can be retried (this request is ${doc.status}).` };
  if (!isTemporaryFailure(doc.failure)) return { eligible: false, reason: 'This failure is permanent (not a temporary dependency error), so retrying would give the same result.' };
  return { eligible: true, reason: null };
}

module.exports = { TEMPORARY_KINDS, STATE, isTemporaryFailure, computeDelay, applyFailure, applySuccess, closeAttempt, ensureRetry, manualEligibility, clock, setClock };
