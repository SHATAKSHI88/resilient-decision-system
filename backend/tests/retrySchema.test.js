// Runs against the REAL Mongoose schemas (no fake DB, no connection needed). Skipped when dependencies are not installed.
const test = require('node:test');
const assert = require('node:assert/strict');

let installed = true;
try { require.resolve('mongoose/package.json'); } catch (e) { installed = false; }

test('WorkflowRequest stores retry state and history and has the retry-worker index', { skip: !installed && 'mongoose not installed' }, () => {
  const WorkflowRequest = require('../src/models/WorkflowRequest');
  for (const p of ['retry.state', 'retry.count', 'retry.nextRetryAt', 'retry.lockedUntil', 'retry.maxAttempts', 'retry.lastError.message', 'retry.history', 'failure.retryable']) assert.ok(WorkflowRequest.schema.path(p), p);
  const idx = WorkflowRequest.schema.indexes().find(([f]) => f['retry.state'] === 1 && f['retry.nextRetryAt'] === 1);
  assert.ok(idx, 'worker index missing');
});

test('RetryConfig name is unique and defaults match the validator', { skip: !installed && 'mongoose not installed' }, () => {
  const RetryConfig = require('../src/models/RetryConfig');
  const { DEFAULTS } = require('../src/validators/retryValidator');
  assert.equal(RetryConfig.schema.path('name').options.unique, true);
  for (const k of Object.keys(DEFAULTS)) assert.equal(RetryConfig.schema.path(k).options.default, DEFAULTS[k], k);
});
