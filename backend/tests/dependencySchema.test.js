// Runs against the REAL Mongoose schemas (no fake DB, no connection needed). Skipped when dependencies are not installed.
const test = require('node:test');
const assert = require('node:assert/strict');

let installed = true;
try { require.resolve('mongoose/package.json'); } catch (e) { installed = false; }

test('DependencyCall has a unique partial index on (requestId, stageId, attempt)', { skip: !installed && 'mongoose not installed' }, () => {
  const DependencyCall = require('../src/models/DependencyCall');
  const idx = DependencyCall.schema.indexes().find(([f]) => f.requestId === 1 && f.stageId === 1 && f.attempt === 1);
  assert.ok(idx, 'composite index missing');
  assert.equal(idx[1].unique, true);
  assert.deepEqual(idx[1].partialFilterExpression, { requestId: { $type: 'string' } }); // test calls (no requestId) are not indexed
});

test('DependencyConfig name is unique; WorkflowRequest stores failure details', { skip: !installed && 'mongoose not installed' }, () => {
  const DependencyConfig = require('../src/models/DependencyConfig');
  assert.equal(DependencyConfig.schema.path('name').options.unique, true);
  const WorkflowRequest = require('../src/models/WorkflowRequest');
  for (const p of ['failure.kind', 'failure.dependency', 'failure.message', 'failure.at']) assert.ok(WorkflowRequest.schema.path(p), p);
});
