// Runs against the REAL Mongoose schema (no fake DB, no connection needed). Skipped when dependencies are not installed.
const test = require('node:test');
const assert = require('node:assert/strict');

let installed = true;
try { require.resolve('mongoose/package.json'); } catch (e) { installed = false; }

test('WorkflowRequest has a unique partial index on idempotencyKey (database-enforced uniqueness)', { skip: !installed && 'mongoose not installed' }, () => {
  const WorkflowRequest = require('../src/models/WorkflowRequest');
  const idx = WorkflowRequest.schema.indexes().find(([fields]) => Object.keys(fields).length === 1 && fields.idempotencyKey === 1);
  assert.ok(idx, 'idempotencyKey index missing');
  assert.equal(idx[1].unique, true);
  assert.deepEqual(idx[1].partialFilterExpression, { idempotencyKey: { $type: 'string' } }); // requests without a key are not indexed
  const reqIdx = WorkflowRequest.schema.indexes().find(([fields]) => fields.requestId === 1);
  assert.ok(reqIdx && reqIdx[1].unique === true, 'requestId must stay unique');
});

test('real MongoDB duplicate-key error shape is recognised', () => {
  const { isIdempotencyDuplicate, isRequestIdDuplicate } = require('../src/services/idempotency');
  const mk = (pattern, name) => Object.assign(new Error(`E11000 duplicate key error collection: db.workflowrequests index: ${name}_1 dup key`), { code: 11000, keyPattern: pattern });
  assert.equal(isIdempotencyDuplicate(mk({ idempotencyKey: 1 }, 'idempotencyKey')), true);
  assert.equal(isRequestIdDuplicate(mk({ idempotencyKey: 1 }, 'idempotencyKey')), false);
  assert.equal(isRequestIdDuplicate(mk({ requestId: 1 }, 'requestId')), true);
  assert.equal(isIdempotencyDuplicate({ code: 11000, message: 'E11000 ... index: idempotencyKey_1 dup key' }), true); // older drivers: no keyPattern
  assert.equal(isIdempotencyDuplicate(new Error('other')), false);
});
