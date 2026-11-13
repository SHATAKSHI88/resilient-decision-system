const test = require('node:test');
const assert = require('node:assert/strict');
const { fakes, state, call, fakeRequest } = require('./helpers/mocks');
const requests = require('../src/controllers/requestController');
const deps = require('../src/controllers/dependencyController');
const { runWorkflow, executeWorkflow } = require('../src/services/workflowService');
const dependency = require('../src/services/externalDependency');
const { validateDependencyConfig, DEFAULTS } = require('../src/validators/dependencyValidator');
const { seedDefaultWorkflow } = require('../src/services/workflowSeeder');
const { seedDefaultRules } = require('../src/services/ruleSeeder');

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const instant = { sleep: async () => {}, random: Math.random };
const payload = (o = {}) => ({ applicantName: 'Asha Rao', email: 'asha@example.com', age: 30, monthlyIncome: 50000, employmentType: 'Salaried', creditScore: 720, loanAmount: 200000, ...o });
const post = (body, key) => call(requests.createRequest, { body, headers: key ? { 'Idempotency-Key': key } : {} });
const setCfg = (cfg) => { fakes.DependencyConfig.docs = [{ _id: 'cfg1', name: dependency.NAME, ...DEFAULTS, ...cfg }]; };
const reset = async () => {
  state.connected = true;
  for (const k of ['WorkflowRequest', 'WorkflowExecution', 'WorkflowDefinition', 'Rule', 'DependencyConfig', 'DependencyCall']) fakes[k].docs = [];
  dependency.setHooks({ ...instant });
  await seedDefaultWorkflow(); await seedDefaultRules();
};
const callsOf = (id) => fakes.DependencyCall.docs.filter((c) => c.requestId === id);

test('config validation: defaults, partial update, limits', () => {
  assert.deepEqual(validateDependencyConfig({}).value, DEFAULTS);
  assert.deepEqual(validateDependencyConfig({ outcome: 'timeout', delayMs: '250' }, DEFAULTS).value, { ...DEFAULTS, outcome: 'TIMEOUT', delayMs: 250 });
  const base = { outcome: 'FAILURE', delayMs: 5, timeoutMs: 100, failureProbability: 0.5 };
  assert.deepEqual(validateDependencyConfig({ delayMs: 9 }, base).value, { ...base, delayMs: 9 }); // omitted fields keep the current values
  for (const [bad, field] of [[{ outcome: 'MAYBE' }, 'outcome'], [{ delayMs: -1 }, 'delayMs'], [{ delayMs: 30001 }, 'delayMs'], [{ delayMs: 1.5 }, 'delayMs'],
    [{ timeoutMs: 5 }, 'timeoutMs'], [{ timeoutMs: 'abc' }, 'timeoutMs'], [{ failureProbability: 1.1 }, 'failureProbability'], [{ failureProbability: -0.1 }, 'failureProbability']]) {
    assert.ok(validateDependencyConfig(bad).errors[field], JSON.stringify(bad));
  }
});

test('simulation: SUCCESS, FAILURE, TIMEOUT, slow response, failure probability', async () => {
  const waits = [];
  dependency.setHooks({ sleep: async (ms) => { waits.push(ms); }, random: () => 0.5 });
  const base = { delayMs: 40, timeoutMs: 100, failureProbability: 0 };
  assert.equal((await dependency.simulate({ ...base, outcome: 'SUCCESS' })).status, 'SUCCESS');
  assert.equal((await dependency.simulate({ ...base, outcome: 'FAILURE' })).status, 'FAILURE');
  const t = await dependency.simulate({ ...base, outcome: 'TIMEOUT' });
  assert.equal(t.status, 'TIMEOUT'); assert.match(t.error, /did not respond within 100 ms/);
  assert.equal((await dependency.simulate({ ...base, outcome: 'SUCCESS', delayMs: 500 })).status, 'TIMEOUT'); // slower than the timeout
  assert.deepEqual(waits, [40, 40, 100, 100]); // delay honoured; a timeout waits exactly timeoutMs
  assert.equal((await dependency.simulate({ ...base, outcome: 'SUCCESS', failureProbability: 0.6 })).status, 'FAILURE'); // random 0.5 < 0.6
  assert.equal((await dependency.simulate({ ...base, outcome: 'SUCCESS', failureProbability: 0.4 })).status, 'SUCCESS');
  assert.equal((await dependency.simulate({ ...base, outcome: 'SUCCESS', failureProbability: 1 })).status, 'FAILURE');
});

test('dependency success lets the workflow progress and stores a call record', async () => {
  await reset();
  const r = await post(payload());
  assert.equal(r.status, 201); assert.equal(r.body.executionState, 'COMPLETED'); assert.equal(r.body.data.status, 'APPROVED'); assert.equal(r.body.failure, undefined);
  const ids = r.body.data.stageHistory.map((h) => h.stageId);
  assert.deepEqual(ids, ['REQUEST_RECEIVED', 'VALIDATION', 'EXTERNAL_VERIFICATION', 'INITIAL_EVALUATION', 'DECISION', 'COMPLETED']);
  const calls = callsOf(r.body.requestId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dependency, 'verification-service'); assert.equal(calls[0].status, 'SUCCESS'); assert.equal(calls[0].stageId, 'EXTERNAL_VERIFICATION');
  assert.equal(calls[0].attempt, 1); assert.equal(calls[0].source, 'WORKFLOW'); assert.ok(calls[0].attemptedAt instanceof Date); assert.equal(typeof calls[0].durationMs, 'number');
  assert.ok(calls[0].response.reference);
  assert.ok(!JSON.stringify(calls[0]).includes('asha@example.com')); // no applicant data stored with the call
});

test('MANUAL_REVIEW path is preserved when verification succeeds', async () => {
  await reset();
  const r = await post(payload({ creditScore: 650 }));
  assert.equal(r.body.data.status, 'MANUAL_REVIEW'); assert.equal(r.body.executionState, 'COMPLETED');
});

test('dependency FAILURE: request data and completed stages are kept, state is FAILED, nothing is decided', async () => {
  await reset(); setCfg({ outcome: 'FAILURE', delayMs: 5 });
  const r = await post(payload());
  assert.equal(r.status, 201); // the request exists, so it is created; the body says what happened to the workflow
  assert.equal(r.body.executionState, 'FAILED'); assert.equal(r.body.processing, false);
  assert.equal(r.body.failure.kind, 'DEPENDENCY_FAILURE'); assert.equal(r.body.failure.dependency, 'verification-service');
  assert.match(r.body.message, /verification failed.*no approval or rejection/i);
  const d = r.body.data;
  assert.equal(d.status, 'FAILED'); assert.equal(d.decision.outcome, undefined); assert.match(d.decision.reason, /No approval or rejection was made/);
  assert.equal(d.applicantName, 'Asha Rao'); assert.equal(d.loanAmount, 200000); assert.equal(d.creditScore, 720); // data not lost
  assert.deepEqual(d.stageHistory.map((h) => `${h.stageId}:${h.status}`), ['REQUEST_RECEIVED:COMPLETED', 'VALIDATION:COMPLETED', 'EXTERNAL_VERIFICATION:FAILED']);
  assert.match(d.stageHistory[2].error, /verification-service/);
  assert.equal(d.evaluationTrace.length, 0); // the Rules Engine never ran
  assert.equal(fakes.WorkflowRequest.docs.length, 1);
  const saved = fakes.WorkflowRequest.docs[0];
  assert.equal(saved.executionState, 'FAILED'); assert.equal(saved.failure.kind, 'DEPENDENCY_FAILURE'); assert.match(saved.executionError, /simulated 503/);
  const ex = fakes.WorkflowExecution.docs.filter((x) => x.requestId === saved.requestId);
  assert.deepEqual(ex.map((x) => `${x.stage}:${x.stageStatus}`), ['REQUEST_RECEIVED:COMPLETED', 'VALIDATION:COMPLETED', 'EXTERNAL_VERIFICATION:FAILED']);
  assert.equal(ex[2].result.dependencyStatus, 'FAILURE');
  const c = callsOf(saved.requestId); assert.equal(c.length, 1); assert.equal(c[0].status, 'FAILURE'); assert.ok(c[0].error);
});

test('dependency TIMEOUT is handled safely (waits the timeout, records it, request FAILED)', async () => {
  await reset(); setCfg({ outcome: 'TIMEOUT', timeoutMs: 120 });
  const waits = []; dependency.setHooks({ sleep: async (ms) => { waits.push(ms); } });
  const r = await post(payload());
  assert.deepEqual(waits, [120]);
  assert.equal(r.body.executionState, 'FAILED'); assert.equal(r.body.failure.kind, 'DEPENDENCY_TIMEOUT'); assert.match(r.body.message, /timed out/);
  assert.equal(r.body.data.status, 'FAILED'); assert.equal(callsOf(r.body.requestId)[0].status, 'TIMEOUT');
  assert.match(callsOf(r.body.requestId)[0].error, /120 ms/);
});

test('response duration is measured (real timers)', async () => {
  await reset(); setCfg({ outcome: 'SUCCESS', delayMs: 40, timeoutMs: 1000 });
  dependency.setHooks({ sleep: realSleep });
  const r = await post(payload());
  const c = callsOf(r.body.requestId)[0];
  assert.ok(c.durationMs >= 35 && c.durationMs < 500, `durationMs ${c.durationMs}`);
  assert.equal(r.body.executionState, 'COMPLETED');
});

test('failed verification never produces APPROVED / REJECTED / MANUAL_REVIEW, whatever the applicant looks like', async () => {
  await reset(); setCfg({ outcome: 'FAILURE' });
  for (const creditScore of [850, 500, 650]) { // would be APPROVED, REJECTED, MANUAL_REVIEW
    const r = await post(payload({ creditScore }));
    assert.equal(r.body.data.status, 'FAILED'); assert.equal(r.body.data.decision.outcome, undefined);
    assert.equal(r.body.data.completedAt, undefined);
  }
  setCfg({ outcome: 'TIMEOUT', timeoutMs: 10 });
  const t = await post(payload({ creditScore: 850 }));
  assert.equal(t.body.data.status, 'FAILED'); assert.equal(t.body.data.decision.outcome, undefined);
});

test('repeated and concurrent execution does not duplicate dependency records or history', async () => {
  await reset(); setCfg({ outcome: 'FAILURE' });
  const first = await post(payload());
  const id = first.body.requestId;
  const doc = () => fakes.WorkflowRequest.docs.find((d) => d.requestId === id);
  const snapshot = JSON.stringify(doc());
  const runs = await Promise.all([1, 2, 3, 4].map(() => call(requests.executeRequest, { params: { id } })));
  for (const r of runs) { assert.equal(r.status, 200); assert.equal(r.body.executed, false); assert.equal(r.body.executionState, 'FAILED'); assert.equal(r.body.failure.kind, 'DEPENDENCY_FAILURE'); }
  assert.equal(callsOf(id).length, 1); assert.equal(doc().stageHistory.length, 3); assert.equal(JSON.stringify(doc()), snapshot); // nothing changed
  // dependency recovers; a failed request is still not silently re-run in this phase
  setCfg({ outcome: 'SUCCESS' });
  assert.equal((await runWorkflow(doc())).executed, false); assert.equal(callsOf(id).length, 1);
  assert.equal(doc().status, 'FAILED');
});

test('concurrent runs on a pending request call the dependency exactly once', async () => {
  await reset(); setCfg({ outcome: 'SUCCESS', delayMs: 5 });
  const req = fakeRequest({ age: 30, creditScore: 800 });
  const out = await Promise.all(Array.from({ length: 6 }, () => runWorkflow(req)));
  assert.equal(out.filter((o) => o.executed).length, 1);
  assert.equal(callsOf(req.requestId).length, 1);
  assert.equal(fakes.WorkflowRequest.docs.find((d) => d.requestId === req.requestId).stageHistory.length, 6);
});

test('same Idempotency-Key replay of a failed request returns it without another dependency call', async () => {
  await reset(); setCfg({ outcome: 'FAILURE' });
  const a = await post(payload(), 'key-failed-0001');
  setCfg({ outcome: 'SUCCESS' });
  const b = await post(payload(), 'key-failed-0001');
  assert.equal(b.status, 200); assert.equal(b.body.idempotent, true); assert.equal(b.body.requestId, a.body.requestId);
  assert.equal(b.body.executionState, 'FAILED'); assert.equal(b.body.failure.kind, 'DEPENDENCY_FAILURE');
  assert.equal(fakes.DependencyCall.docs.length, 1); assert.equal(fakes.WorkflowRequest.docs.length, 1);
});

test('GET /requests/:id returns failure details and dependency calls', async () => {
  await reset(); setCfg({ outcome: 'TIMEOUT', timeoutMs: 50 });
  const created = await post(payload());
  const r = await call(requests.getRequest, { params: { id: created.body.requestId } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.failure.kind, 'DEPENDENCY_TIMEOUT'); assert.equal(r.body.data.status, 'FAILED');
  assert.equal(r.body.data.dependencyCalls.length, 1); assert.equal(r.body.data.dependencyCalls[0].status, 'TIMEOUT');
  assert.equal(r.body.data.executionHistory.length, 3);
});

test('a workflow without a verification stage still runs and makes no dependency call', async () => {
  await reset(); setCfg({ outcome: 'FAILURE' });
  const d = fakes.WorkflowDefinition.docs[0];
  d.stages = d.stages.filter((s) => s.stageId !== 'EXTERNAL_VERIFICATION');
  d.transitions = d.transitions.filter((t) => t.from !== 'EXTERNAL_VERIFICATION' && t.to !== 'EXTERNAL_VERIFICATION');
  d.transitions.push({ from: 'VALIDATION', to: 'INITIAL_EVALUATION', outcome: 'ALWAYS' });
  const r = await post(payload());
  assert.equal(r.body.data.status, 'APPROVED'); assert.equal(fakes.DependencyCall.docs.length, 0);
});

test('dependency API: inspect, configure (validated, partial), 503 without database', async () => {
  await reset();
  let r = await call(deps.getVerification);
  assert.equal(r.status, 200); assert.equal(r.body.data.state, 'UNKNOWN'); assert.deepEqual({ ...r.body.data.config, updatedAt: undefined }, { ...DEFAULTS, updatedAt: undefined });
  r = await call(deps.updateVerificationConfig, { body: { outcome: 'FAILURE', delayMs: '50', failureProbability: 2 } });
  assert.equal(r.status, 400); assert.ok(r.body.error.details.failureProbability); assert.equal(fakes.DependencyConfig.docs.length, 0); // nothing saved when invalid
  r = await call(deps.updateVerificationConfig, { body: { outcome: 'FAILURE', delayMs: '50' } });
  assert.equal(r.status, 200); assert.equal(r.body.data.outcome, 'FAILURE'); assert.equal(r.body.data.delayMs, 50); assert.equal(r.body.data.timeoutMs, 3000);
  r = await call(deps.updateVerificationConfig, { body: { timeoutMs: 800 } }); // partial: earlier values kept
  assert.equal(r.body.data.outcome, 'FAILURE'); assert.equal(r.body.data.delayMs, 50); assert.equal(r.body.data.timeoutMs, 800);
  assert.equal(fakes.DependencyConfig.docs.length, 1);
  state.connected = false;
  for (const [h, o] of [[deps.getVerification, {}], [deps.updateVerificationConfig, { body: { outcome: 'SUCCESS' } }], [deps.testVerification, {}]]) assert.equal((await call(h, o)).status, 503);
  state.connected = true;
});

test('settings persist in the database and drive the next workflow run (no code change)', async () => {
  await reset();
  await call(deps.updateVerificationConfig, { body: { outcome: 'FAILURE' } });
  assert.equal((await post(payload())).body.executionState, 'FAILED');
  await call(deps.updateVerificationConfig, { body: { outcome: 'SUCCESS' } });
  assert.equal((await post(payload())).body.executionState, 'COMPLETED');
});

test('test endpoint: makes a TEST call, supports one-off overrides, saves nothing', async () => {
  await reset(); await call(deps.updateVerificationConfig, { body: { outcome: 'SUCCESS' } });
  let r = await call(deps.testVerification);
  assert.equal(r.status, 200); assert.equal(r.body.data.call.status, 'SUCCESS'); assert.equal(r.body.data.call.source, 'TEST'); assert.equal(r.body.data.call.requestId, undefined);
  r = await call(deps.testVerification, { body: { outcome: 'TIMEOUT', timeoutMs: 20 } });
  assert.equal(r.status, 200); assert.equal(r.body.data.call.status, 'TIMEOUT'); assert.match(r.body.message, /timed out/);
  assert.equal(fakes.DependencyConfig.docs[0].outcome, 'SUCCESS'); // override not persisted
  r = await call(deps.testVerification, { body: { delayMs: -5 } });
  assert.equal(r.status, 400);
  assert.equal(fakes.DependencyCall.docs.length, 2);
});

test('status summary: UNKNOWN -> HEALTHY -> DEGRADED -> DOWN, counts and last call', async () => {
  await reset();
  const run = async (outcome) => { setCfg({ outcome }); await call(deps.testVerification); };
  await run('SUCCESS'); await run('SUCCESS');
  let s = (await call(deps.getVerification)).body.data;
  assert.equal(s.state, 'HEALTHY'); assert.equal(s.counts.success, 2); assert.equal(s.lastCall.status, 'SUCCESS');
  await run('FAILURE');
  s = (await call(deps.getVerification)).body.data;
  assert.equal(s.state, 'DEGRADED'); assert.equal(s.lastCall.status, 'FAILURE');
  for (let i = 0; i < 5; i++) await run(i % 2 ? 'FAILURE' : 'TIMEOUT');
  s = (await call(deps.getVerification)).body.data;
  assert.equal(s.state, 'DOWN'); assert.equal(s.counts.total, 8); assert.ok(s.counts.timeout >= 1 && s.counts.failure >= 1); assert.equal(s.recentCalls.length, 8);
  assert.equal(typeof s.averageDurationMs, 'number');
});
