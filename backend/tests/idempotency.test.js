const test = require('node:test');
const assert = require('node:assert/strict');
const { fakes, call, fakeRequest } = require('./helpers/mocks');
const requests = require('../src/controllers/requestController');
const { runWorkflow, executeWorkflow, setRulesEngine } = require('../src/services/workflowService');
const { createRulesEngine } = require('../src/rulesEngine');
const { seedDefaultWorkflow } = require('../src/services/workflowSeeder');
const { seedDefaultRules } = require('../src/services/ruleSeeder');
const { parseKey, hashPayload } = require('../src/services/idempotency');

const payload = (o = {}) => ({ applicantName: 'Asha Rao', email: 'asha@example.com', age: 30, monthlyIncome: 50000, employmentType: 'Salaried', creditScore: 720, loanAmount: 200000, ...o });
const KEY = 'key-aaaaaaaa-0001';
const post = (body, key) => call(requests.createRequest, { body, headers: key ? { 'Idempotency-Key': key } : {} });
const reset = async () => { fakes.WorkflowRequest.docs = []; fakes.WorkflowExecution.docs = []; fakes.WorkflowDefinition.docs = []; fakes.Rule.docs = []; await seedDefaultWorkflow(); await seedDefaultRules(); };

test('key parsing and payload hashing', () => {
  assert.deepEqual(parseKey(undefined), { key: null });
  assert.equal(parseKey('  abcdefgh  ').key, 'abcdefgh');
  for (const bad of ['short', 'has space here', 'x'.repeat(129), 'bad/slash/key']) assert.ok(parseKey(bad).error, bad);
  const { value } = require('../src/validators/requestValidator').validateRequestBody(payload());
  const { value: v2 } = require('../src/validators/requestValidator').validateRequestBody(payload({ age: '30', applicantName: '  Asha Rao ' }));
  assert.equal(hashPayload(value), hashPayload(v2)); // normalised -> equal
  assert.notEqual(hashPayload(value), hashPayload({ ...value, loanAmount: 1 }));
});

test('no key: behaves as before (201, workflow executed, no key stored)', async () => {
  await reset();
  const r = await post(payload());
  assert.equal(r.status, 201); assert.equal(r.body.idempotent, false); assert.equal(r.body.processing, false);
  assert.equal(r.body.executionState, 'COMPLETED'); assert.equal(r.body.data.status, 'APPROVED');
  assert.equal(r.body.data.stageHistory.length, 6);
  assert.equal(fakes.WorkflowRequest.docs[0].idempotencyKey, undefined);
  await post(payload()); // without a key identical payloads are NOT deduplicated
  assert.equal(fakes.WorkflowRequest.docs.length, 2);
});

test('same key + same payload creates exactly one request and returns it again', async () => {
  await reset();
  const first = await post(payload(), KEY);
  assert.equal(first.status, 201); assert.equal(first.body.idempotent, false);
  const again = await post(payload({ age: '30' }), KEY); // normalised-equal payload
  assert.equal(again.status, 200); assert.equal(again.body.idempotent, true);
  assert.equal(again.body.requestId, first.body.requestId); assert.equal(again.headers['Idempotent-Replayed'], 'true');
  assert.equal(fakes.WorkflowRequest.docs.length, 1);
  assert.equal(fakes.WorkflowRequest.docs[0].idempotencyKey, KEY);
  assert.equal(fakes.WorkflowRequest.docs[0].stageHistory.length, 6); // not executed again
  assert.equal(fakes.WorkflowExecution.docs.length, 6);
});

test('same key + different payload -> 422, nothing created or changed', async () => {
  await reset();
  const first = await post(payload(), KEY);
  const r = await post(payload({ loanAmount: 999 }), KEY);
  assert.equal(r.status, 422); assert.equal(r.body.success, false); assert.ok(r.body.error.details.idempotencyKey);
  assert.equal(r.body.error.details.requestId, first.body.requestId);
  assert.equal(fakes.WorkflowRequest.docs.length, 1);
  assert.equal(fakes.WorkflowRequest.docs[0].loanAmount, 200000);
});

test('different keys are different submissions', async () => {
  await reset();
  await post(payload(), KEY); await post(payload(), 'key-aaaaaaaa-0002');
  assert.equal(fakes.WorkflowRequest.docs.length, 2);
});

test('invalid key -> 400; invalid body -> 400 and nothing stored even with a key', async () => {
  await reset();
  let r = await post(payload(), 'bad key!'); assert.equal(r.status, 400); assert.ok(r.body.error.details.idempotencyKey);
  r = await post(payload({ email: 'nope' }), KEY); assert.equal(r.status, 400);
  assert.equal(fakes.WorkflowRequest.docs.length, 0);
});

test('concurrent requests with the same key create one request and run the workflow once', async () => {
  await reset();
  const results = await Promise.all(Array.from({ length: 8 }, () => post(payload(), KEY)));
  assert.equal(fakes.WorkflowRequest.docs.length, 1, 'duplicate documents created');
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  const ids = new Set(results.map((r) => r.body.requestId)); assert.equal(ids.size, 1);
  for (const r of results.filter((x) => x.status !== 201)) { assert.equal(r.body.idempotent, true); assert.ok([200, 202].includes(r.status)); }
  const doc = fakes.WorkflowRequest.docs[0];
  assert.equal(doc.stageHistory.length, 6); assert.equal(fakes.WorkflowExecution.docs.length, 6);
  assert.equal(doc.executionState, 'COMPLETED');
});

test('concurrent requests with the same key but different payloads: one wins, others get 422', async () => {
  await reset();
  const results = await Promise.all([post(payload(), KEY), post(payload({ age: 31 }), KEY), post(payload({ age: 32 }), KEY)]);
  assert.equal(fakes.WorkflowRequest.docs.length, 1);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 422).length + results.filter((r) => r.status === 200 || r.status === 202).length, 2);
});

test('replay while the request is still being processed -> 202 processing with Retry-After', async () => {
  await reset();
  await post(payload(), KEY);
  fakes.WorkflowRequest.docs[0].executionState = 'RUNNING';
  const r = await post(payload(), KEY);
  assert.equal(r.status, 202); assert.equal(r.body.processing, true); assert.equal(r.body.idempotent, true);
  assert.equal(r.headers['Retry-After'], '1'); assert.equal(r.body.executionState, 'RUNNING');
});

test('workflow executed at most once: concurrent runWorkflow calls', async () => {
  await reset();
  const req = fakeRequest({ age: 30, creditScore: 800 });
  const out = await Promise.all(Array.from({ length: 6 }, () => runWorkflow(req)));
  assert.equal(out.filter((o) => o.executed).length, 1);
  const doc = fakes.WorkflowRequest.docs.find((d) => d.requestId === req.requestId);
  assert.deepEqual(doc.stageHistory.map((h) => h.stageId), ['REQUEST_RECEIVED', 'VALIDATION', 'EXTERNAL_VERIFICATION', 'INITIAL_EVALUATION', 'DECISION', 'COMPLETED']);
  assert.equal(fakes.WorkflowExecution.docs.filter((d) => d.requestId === req.requestId).length, 6);
  // later repeated executions change nothing
  const again = await runWorkflow(req);
  assert.equal(again.executed, false); assert.equal(doc.stageHistory.length, 6);
  await executeWorkflow(req); assert.equal(doc.stageHistory.length, 6);
});

test('executionState is RUNNING during the run and COMPLETED only after the last stage', async () => {
  await reset();
  const seen = [];
  const real = createRulesEngine();
  setRulesEngine({ evaluate: async (...a) => { seen.push(fakes.WorkflowRequest.docs[0].executionState + '/' + fakes.WorkflowRequest.docs[0].status); return real.evaluate(...a); } });
  const req = fakeRequest({ age: 30, creditScore: 800 });
  await runWorkflow(req);
  setRulesEngine(real);
  assert.deepEqual(seen, ['RUNNING/PROCESSING']);
  assert.equal(fakes.WorkflowRequest.docs[0].executionState, 'COMPLETED');
});

test('failed workflow ends in executionState FAILED and is not re-run', async () => {
  await reset(); fakes.WorkflowDefinition.docs = [];
  const req = fakeRequest({ age: 30, creditScore: 800 });
  const a = await runWorkflow(req);
  assert.equal(a.request.status, 'FAILED'); assert.equal(a.request.executionState, 'FAILED');
  await seedDefaultWorkflow(); // fixing the config does not silently re-run an already failed request
  assert.equal((await runWorkflow(req)).executed, false);
});

test('POST /requests/:id/execute: 404, runs a pending request once, then reports already executed', async () => {
  await reset();
  let r = await call(requests.executeRequest, { params: { id: 'REQ-NOPE' } }); assert.equal(r.status, 404);
  const req = fakeRequest({ age: 30, creditScore: 650 });
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => call(requests.executeRequest, { params: { id: req.requestId } })));
  const all = [a, b, c];
  assert.equal(all.filter((x) => x.body.executed === true).length, 1);
  assert.equal(fakes.WorkflowRequest.docs.find((d) => d.requestId === req.requestId).stageHistory.length, 6);
  r = await call(requests.executeRequest, { params: { id: req.requestId } });
  assert.equal(r.status, 200); assert.equal(r.body.executed, false); assert.equal(r.body.idempotent, true); assert.match(r.body.message, /already executed/);
  assert.equal(r.body.data.status, 'MANUAL_REVIEW');
  const running = fakeRequest({ age: 30, creditScore: 800, status: 'PROCESSING', executionState: 'RUNNING' });
  r = await call(requests.executeRequest, { params: { id: running.requestId } });
  assert.equal(r.status, 202); assert.equal(r.body.processing, true); assert.equal(r.body.executed, false);
  assert.equal(fakes.WorkflowRequest.docs.find((d) => d.requestId === running.requestId).stageHistory.length, 0);
});

test('legacy request without executionState (created before Phase 7) can still be executed exactly once', async () => {
  await reset();
  const legacy = fakeRequest({ age: 30, creditScore: 800 });
  delete fakes.WorkflowRequest.docs.find((d) => d.requestId === legacy.requestId).executionState;
  const out = await Promise.all([1, 2, 3].map(() => runWorkflow(legacy)));
  assert.equal(out.filter((o) => o.executed).length, 1);
  const doc = fakes.WorkflowRequest.docs.find((d) => d.requestId === legacy.requestId);
  assert.equal(doc.executionState, 'COMPLETED'); assert.equal(doc.stageHistory.length, 6);
});
