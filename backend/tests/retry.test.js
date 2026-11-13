const test = require('node:test');
const assert = require('node:assert/strict');
const { fakes, state, call, fakeRequest } = require('./helpers/mocks');
const requests = require('../src/controllers/requestController');
const retries = require('../src/controllers/retryController');
const { runWorkflow } = require('../src/services/workflowService');
const dependency = require('../src/services/externalDependency');
const policy = require('../src/services/retryPolicy');
const { computeDelay } = policy;
const { retryRequest, claimRetry, recoverInterrupted, processDueRetries } = require('../src/services/retryService');
const { createRetryWorker } = require('../src/services/retryWorker');
const { validateRetryConfig, DEFAULTS } = require('../src/validators/retryValidator');
const { DEFAULTS: DEP_DEFAULTS } = require('../src/validators/dependencyValidator');
const { seedDefaultWorkflow } = require('../src/services/workflowSeeder');
const { seedDefaultRules } = require('../src/services/ruleSeeder');

let T = Date.UTC(2026, 0, 1, 12, 0, 0); // controlled clock
const advance = (ms) => { T += ms; };
const setDep = (cfg) => { fakes.DependencyConfig.docs = [{ _id: 'cfg1', name: dependency.NAME, ...DEP_DEFAULTS, ...cfg }]; };
const setRetry = (cfg) => { fakes.RetryConfig.docs = [{ _id: 'rc1', name: 'default', ...DEFAULTS, ...cfg }]; };
const reset = async (retryCfg = {}) => {
  state.connected = true;
  for (const k of ['WorkflowRequest', 'WorkflowExecution', 'WorkflowDefinition', 'Rule', 'DependencyConfig', 'DependencyCall', 'RetryConfig', 'AuditLog']) fakes[k].docs = [];
  policy.setClock({ now: () => T });
  dependency.setHooks({ sleep: async () => {}, random: Math.random });
  setRetry({ initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 60000, maxAttempts: 3, ...retryCfg });
  await seedDefaultWorkflow(); await seedDefaultRules();
};
const doc = (id) => fakes.WorkflowRequest.docs.find((d) => d.requestId === id);
const callsOf = (id) => fakes.DependencyCall.docs.filter((c) => c.requestId === id);
const execsOf = (id) => fakes.WorkflowExecution.docs.filter((x) => x.requestId === id);
const payload = (o = {}) => ({ applicantName: 'Asha Rao', email: 'asha@example.com', age: 30, monthlyIncome: 50000, employmentType: 'Salaried', creditScore: 800, loanAmount: 200000, ...o });
const post = (body) => call(requests.createRequest, { body });
const manual = (id, extra = {}) => call(retries.retryNow, { params: { id }, ...extra });
/** A request that failed once at EXTERNAL_VERIFICATION (dependency FAILURE), retry scheduled. */
const failedRequest = async (outcome = 'FAILURE') => {
  setDep({ outcome });
  const r = await post(payload());
  assert.equal(r.body.executionState, 'FAILED');
  return r.body.requestId;
};
const ids = (id) => doc(id).stageHistory.map((h) => `${h.stageId}:${h.status}`);

// ---------------------------------------------------------------- configuration
test('config validation: defaults, partial update, limits, max >= initial', () => {
  assert.deepEqual(validateRetryConfig({}).value, DEFAULTS);
  assert.deepEqual(validateRetryConfig({ maxAttempts: '5', backoffMultiplier: '1.5' }).value, { ...DEFAULTS, maxAttempts: 5, backoffMultiplier: 1.5 });
  const base = { maxAttempts: 1, initialDelayMs: 200, backoffMultiplier: 3, maxDelayMs: 900 };
  assert.deepEqual(validateRetryConfig({ maxAttempts: 2 }, base).value, { ...base, maxAttempts: 2 }); // omitted fields keep current values
  for (const [bad, field] of [
    [{ maxAttempts: -1 }, 'maxAttempts'], [{ maxAttempts: 11 }, 'maxAttempts'], [{ maxAttempts: 1.5 }, 'maxAttempts'], [{ maxAttempts: 'x' }, 'maxAttempts'],
    [{ initialDelayMs: 99 }, 'initialDelayMs'], [{ initialDelayMs: 3600001 }, 'initialDelayMs'], [{ initialDelayMs: 100.5 }, 'initialDelayMs'],
    [{ backoffMultiplier: 0.9 }, 'backoffMultiplier'], [{ backoffMultiplier: 11 }, 'backoffMultiplier'], [{ backoffMultiplier: 'two' }, 'backoffMultiplier'],
    [{ maxDelayMs: 50 }, 'maxDelayMs'], [{ maxDelayMs: 86400001 }, 'maxDelayMs'],
    [{ initialDelayMs: 5000, maxDelayMs: 1000 }, 'maxDelayMs'], // max below initial
    [{ initialDelayMs: 90000 }, 'maxDelayMs'], // new initial above the stored max (base max = 60000)
  ]) assert.ok(validateRetryConfig(bad).errors[field], JSON.stringify(bad));
  assert.equal(validateRetryConfig({ maxAttempts: 0 }).errors.maxAttempts, undefined); // 0 turns automatic retries off
});

test('config API: stored in MongoDB, validated, partial updates, nothing saved when invalid, 503 without database', async () => {
  await reset(); fakes.RetryConfig.docs = [];
  let r = await call(retries.getConfig);
  assert.equal(r.status, 200); assert.deepEqual({ ...r.body.data.config, updatedAt: undefined }, { ...DEFAULTS, updatedAt: undefined });
  assert.equal(r.body.data.worker.intervalMs > 0, true); assert.deepEqual(r.body.data.counts, { scheduled: 0, inProgress: 0, exhausted: 0 });
  r = await call(retries.updateConfig, { body: { maxAttempts: 99, initialDelayMs: 'abc' } });
  assert.equal(r.status, 400); assert.ok(r.body.error.details.maxAttempts && r.body.error.details.initialDelayMs); assert.equal(fakes.RetryConfig.docs.length, 0);
  r = await call(retries.updateConfig, { body: { maxAttempts: 4, initialDelayMs: 2000 } });
  assert.equal(r.status, 200); assert.equal(r.body.data.maxAttempts, 4); assert.equal(r.body.data.backoffMultiplier, 2);
  r = await call(retries.updateConfig, { body: { backoffMultiplier: 3 } });
  assert.equal(r.body.data.maxAttempts, 4); assert.equal(r.body.data.initialDelayMs, 2000); assert.equal(r.body.data.backoffMultiplier, 3);
  assert.equal(fakes.RetryConfig.docs.length, 1); assert.equal(fakes.RetryConfig.docs[0].backoffMultiplier, 3); // persisted
  r = await call(retries.updateConfig, { body: { maxDelayMs: 1500 } }); // below the stored initial delay (2000)
  assert.equal(r.status, 400); assert.equal(fakes.RetryConfig.docs[0].maxDelayMs, 60000);
  state.connected = false;
  for (const [h, o] of [[retries.getConfig, {}], [retries.updateConfig, { body: { maxAttempts: 1 } }], [retries.retryNow, { params: { id: 'X' } }]]) assert.equal((await call(h, o)).status, 503);
  state.connected = true;
});

// ---------------------------------------------------------------- backoff
test('exponential backoff: delay = min(initial * multiplier^retryCount, max)', () => {
  const cfg = { initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 10000, maxAttempts: 9 };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 20].map((n) => computeDelay(n, cfg)), [1000, 2000, 4000, 8000, 10000, 10000, 10000]);
  assert.equal(computeDelay(3, { ...cfg, backoffMultiplier: 1.5 }), Math.round(1000 * 1.5 ** 3)); // 3375
  assert.equal(computeDelay(7, { ...cfg, backoffMultiplier: 1 }), 1000); // multiplier 1 = constant delay
  assert.equal(computeDelay(2, { initialDelayMs: 500, backoffMultiplier: 3, maxDelayMs: 100000 }), 4500);
  assert.equal(computeDelay(5000, cfg), 10000); // overflow to Infinity is capped
  for (const n of [0, 1, 2, 3]) assert.equal(computeDelay(n, cfg), Math.min(cfg.initialDelayMs * cfg.backoffMultiplier ** n, cfg.maxDelayMs));
});

// ---------------------------------------------------------------- scheduling of failures
test('temporary failures (FAILURE and TIMEOUT) are scheduled with the initial delay and the last error is tracked', async () => {
  for (const outcome of ['FAILURE', 'TIMEOUT']) {
    await reset({ initialDelayMs: 2500 });
    const id = await failedRequest(outcome);
    const r = doc(id).retry;
    assert.equal(r.state, 'SCHEDULED'); assert.equal(r.count, 0); assert.equal(r.maxAttempts, 3);
    assert.equal(r.nextRetryAt.getTime(), T + 2500);
    assert.equal(r.lastError.kind, `DEPENDENCY_${outcome}`); assert.ok(r.lastError.message); assert.ok(r.lastError.at);
    assert.equal(doc(id).failure.retryable, true); assert.deepEqual(r.history, []);
  }
});

test('permanent failures and invalid requests are never scheduled or retried', async () => {
  await reset(); setDep({ outcome: 'FAILURE' });
  const bad = fakeRequest({ age: 500, creditScore: 800 }); // fails VALIDATION: a permanent, "invalid request" failure
  await runWorkflow(bad);
  assert.equal(doc(bad.requestId).status, 'FAILED'); assert.equal(doc(bad.requestId).failure.kind, 'WORKFLOW_ERROR');
  assert.equal(doc(bad.requestId).retry.state, 'NOT_RETRYABLE'); assert.equal(doc(bad.requestId).retry.nextRetryAt, null); assert.equal(doc(bad.requestId).failure.retryable, false);
  fakes.WorkflowDefinition.docs = []; // missing configuration is permanent too
  const noWf = fakeRequest({ age: 30, creditScore: 800 });
  await runWorkflow(noWf);
  assert.equal(doc(noWf.requestId).retry.state, 'NOT_RETRYABLE');
  advance(10 * 60 * 1000);
  const before = JSON.stringify(fakes.WorkflowRequest.docs);
  const s = await processDueRetries({ now: T });
  assert.equal(s.due, 0); assert.equal(JSON.stringify(fakes.WorkflowRequest.docs), before); // the worker leaves them alone
  const m = await manual(bad.requestId);
  assert.equal(m.status, 409); assert.match(m.body.error.message, /permanent/);
  assert.equal(execsOf(bad.requestId).length, doc(bad.requestId).stageHistory.length); // nothing re-run
});

test('maxAttempts = 0 disables automatic retries (request is EXHAUSTED, manual retry still possible)', async () => {
  await reset({ maxAttempts: 0 });
  const id = await failedRequest();
  assert.equal(doc(id).retry.state, 'EXHAUSTED'); assert.equal(doc(id).retry.nextRetryAt, null);
  advance(3600000);
  assert.equal((await processDueRetries({ now: T })).due, 0);
  setDep({ outcome: 'SUCCESS' });
  assert.equal((await manual(id)).status, 200); assert.equal(doc(id).status, 'APPROVED');
});

// ---------------------------------------------------------------- automatic retry execution
test('worker: a retry is not started before nextRetryAt, then recovers the request once the dependency is back', async () => {
  await reset();
  const id = await failedRequest();
  const worker = createRetryWorker({ intervalMs: 1000, enabled: true });
  advance(999);
  assert.equal((await worker.tick()).due, 0); assert.equal(callsOf(id).length, 1); assert.equal(doc(id).status, 'FAILED'); // 1 ms early: nothing
  advance(1);
  setDep({ outcome: 'SUCCESS' });
  assert.deepEqual({ ...(await worker.tick()) }, { recovered: 0, due: 1, started: 1, succeeded: 1, failedAgain: 0, skipped: 0, errors: 0 });
  const d = doc(id);
  assert.equal(d.status, 'APPROVED'); assert.equal(d.executionState, 'COMPLETED'); assert.ok(d.completedAt);
  assert.equal(d.failure, undefined); assert.equal(d.executionError, undefined);
  assert.equal(d.retry.state, 'RECOVERED'); assert.equal(d.retry.count, 1); assert.equal(d.retry.nextRetryAt, null); assert.equal(d.retry.lockedUntil, null);
  assert.equal(d.retry.lastError.kind, 'DEPENDENCY_FAILURE'); // the history of what went wrong is kept
  assert.equal(d.retry.history.length, 1);
  assert.deepEqual({ ...d.retry.history[0], startedAt: 0, completedAt: 0, scheduledFor: 0 }, { attempt: 1, trigger: 'AUTOMATIC', initiatedBy: 'system', scheduledFor: 0, startedAt: 0, completedAt: 0, outcome: 'SUCCEEDED' });
  assert.equal(d.decision.outcome, 'APPROVED');
  assert.equal((await worker.tick()).due, 0); // recovered requests are not picked up again
});

test('a retry resumes at the failed stage: no duplicated stage history, execution records or dependency calls', async () => {
  await reset();
  const id = await failedRequest();
  assert.deepEqual(ids(id), ['REQUEST_RECEIVED:COMPLETED', 'VALIDATION:COMPLETED', 'EXTERNAL_VERIFICATION:FAILED']);
  assert.equal(execsOf(id).length, 3); assert.equal(callsOf(id).length, 1);
  advance(1000); setDep({ outcome: 'SUCCESS' });
  await processDueRetries({ now: T });
  // RECEIVE and VALIDATION are NOT executed again; the failed stage gets exactly one new entry
  assert.deepEqual(ids(id), ['REQUEST_RECEIVED:COMPLETED', 'VALIDATION:COMPLETED', 'EXTERNAL_VERIFICATION:FAILED', 'EXTERNAL_VERIFICATION:COMPLETED', 'INITIAL_EVALUATION:COMPLETED', 'DECISION:COMPLETED', 'COMPLETED:COMPLETED']);
  assert.deepEqual(doc(id).stageHistory.map((h) => h.attempt), [0, 0, 0, 1, 1, 1, 1]);
  assert.equal(execsOf(id).length, 7); assert.equal(new Set(execsOf(id).map((x) => `${x.stage}/${x.stageStatus}/${x.attempt}`)).size, 7);
  assert.deepEqual(callsOf(id).map((c) => [c.attempt, c.status]), [[1, 'FAILURE'], [2, 'SUCCESS']]); // one record per real call, numbered
  assert.equal(doc(id).evaluationTrace.length > 0, true);
  const snapshot = JSON.stringify(fakes.WorkflowRequest.docs); const calls = fakes.DependencyCall.docs.length;
  advance(3600000);
  await processDueRetries({ now: T }); await processDueRetries({ now: T });
  assert.equal(JSON.stringify(fakes.WorkflowRequest.docs), snapshot); assert.equal(fakes.DependencyCall.docs.length, calls);
});

test('retry history and exponential backoff across repeated failures; maximum attempts are respected', async () => {
  await reset({ initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 3000, maxAttempts: 3 });
  const id = await failedRequest('TIMEOUT');
  const waits = [doc(id).retry.nextRetryAt.getTime() - T]; // delay before retry 1
  for (let n = 1; n <= 3; n++) {
    advance(waits[n - 1] - 1);
    assert.equal((await processDueRetries({ now: T })).due, 0); // not due 1 ms early
    advance(1);
    const s = await processDueRetries({ now: T });
    assert.equal(s.started, 1); assert.equal(s.failedAgain, 1);
    const r = doc(id).retry;
    assert.equal(r.count, n);
    if (n < 3) { assert.equal(r.state, 'SCHEDULED'); waits.push(r.nextRetryAt.getTime() - T); }
  }
  assert.deepEqual(waits, [1000, 2000, 3000]); // 1000*2^0, 1000*2^1, min(1000*2^2, 3000)
  const r = doc(id).retry;
  assert.equal(r.state, 'EXHAUSTED'); assert.equal(r.nextRetryAt, null); assert.equal(r.count, 3);
  assert.equal(r.history.length, 3); assert.ok(r.history.every((h, i) => h.attempt === i + 1 && h.outcome === 'FAILED' && h.trigger === 'AUTOMATIC' && h.error && h.completedAt));
  assert.equal(r.lastError.attempt, 3); assert.equal(doc(id).status, 'FAILED');
  assert.equal(callsOf(id).length, 4); // original + 3 retries, never more
  advance(24 * 3600 * 1000);
  assert.equal((await processDueRetries({ now: T })).due, 0); assert.equal(callsOf(id).length, 4);
  assert.equal(doc(id).stageHistory.filter((h) => h.stageId === 'VALIDATION').length, 1); // earlier stages never repeated
});

// ---------------------------------------------------------------- manual recovery
test('manual retry: works for a failed request, records the operator, counts as an attempt, and clears the schedule', async () => {
  await reset();
  const id = await failedRequest(); // retry scheduled for later, NOT due yet
  setDep({ outcome: 'SUCCESS' });
  const r = await manual(id);
  assert.equal(r.status, 200); assert.equal(r.body.retried, true); assert.equal(r.body.succeeded, true); assert.equal(r.body.initiatedBy, 'operator');
  assert.match(r.body.message, /succeeded.*APPROVED/); assert.equal(r.body.data.status, 'APPROVED'); assert.equal(r.body.executionState, 'COMPLETED');
  const d = doc(id);
  assert.equal(d.retry.history.length, 1); assert.equal(d.retry.history[0].trigger, 'MANUAL'); assert.equal(d.retry.history[0].initiatedBy, 'operator'); assert.equal(d.retry.count, 1);
  assert.equal(d.retry.state, 'RECOVERED'); assert.equal(d.retry.nextRetryAt, null);
  assert.deepEqual(fakes.AuditLog.docs.map((a) => `${a.action}:${a.actor}`), ['RETRY_STARTED:operator', 'RETRY_SUCCEEDED:operator']);
  advance(3600000);
  assert.equal((await processDueRetries({ now: T })).due, 0); assert.equal(callsOf(id).length, 2); // the old schedule did not fire
  const again = await manual(id); // no longer eligible
  assert.equal(again.status, 409); assert.match(again.body.error.message, /Only FAILED/); assert.equal(callsOf(id).length, 2);
});

test('manual retry records the authenticated user when an auth layer provides one', async () => {
  await reset();
  const id = await failedRequest(); setDep({ outcome: 'SUCCESS' });
  const handler = (req, res, next) => { req.user = { email: 'ops@example.com' }; return retries.retryNow(req, res, next); };
  const r = await call(handler, { params: { id } });
  assert.equal(r.status, 200); assert.equal(r.body.initiatedBy, 'ops@example.com'); assert.equal(doc(id).retry.history[0].initiatedBy, 'ops@example.com');
});

test('manual retry is allowed after automatic attempts are exhausted, and a failing manual retry reports it clearly', async () => {
  await reset({ maxAttempts: 1 });
  const id = await failedRequest();
  advance(1000); await processDueRetries({ now: T });
  assert.equal(doc(id).retry.state, 'EXHAUSTED');
  const r = await manual(id); // dependency still down
  assert.equal(r.status, 200); assert.equal(r.body.succeeded, false); assert.match(r.body.message, /failed again.*No further automatic retry/);
  assert.equal(doc(id).status, 'FAILED'); assert.equal(doc(id).retry.state, 'EXHAUSTED'); assert.equal(doc(id).retry.count, 2);
  assert.deepEqual(doc(id).retry.history.map((h) => `${h.attempt}:${h.trigger}:${h.outcome}`), ['1:AUTOMATIC:FAILED', '2:MANUAL:FAILED']);
  setDep({ outcome: 'SUCCESS' });
  assert.equal((await manual(id)).body.succeeded, true);
  assert.equal(doc(id).status, 'APPROVED');
});

test('manual retry validates status: 404, completed/pending/running requests and permanent failures are refused (409) and untouched', async () => {
  await reset(); setDep({ outcome: 'SUCCESS' });
  assert.equal((await manual('REQ-NOPE')).status, 404);
  const done = (await post(payload())).body.requestId;
  const pending = fakeRequest({}).requestId;
  const running = fakeRequest({ status: 'PROCESSING', executionState: 'RUNNING' }).requestId;
  const bad = fakeRequest({ age: 500 }); await runWorkflow(bad);
  for (const [id, re] of [[done, /Only FAILED.*APPROVED/], [pending, /Only FAILED.*PENDING/], [running, /already in progress/], [bad.requestId, /permanent/]]) {
    const before = JSON.stringify(doc(id));
    const r = await manual(id);
    assert.equal(r.status, 409, id); assert.match(r.body.error.message, re); assert.equal(r.body.error.details.requestId, id);
    assert.equal(JSON.stringify(doc(id)), before);
  }
  assert.equal(callsOf(done).length, 1);
  assert.equal(fakes.AuditLog.docs.length, 0);
});

test('a request that failed before Phase 9 (no retry fields) can be retried manually but is not picked up by the worker', async () => {
  await reset(); setDep({ outcome: 'FAILURE' });
  const id = await failedRequest();
  const d = doc(id); delete d.retry; delete d.failure.retryable; // looks like a Phase 8 document
  advance(3600000);
  assert.equal((await processDueRetries({ now: T })).due, 0);
  setDep({ outcome: 'SUCCESS' });
  const r = await manual(id);
  assert.equal(r.status, 200); assert.equal(r.body.succeeded, true); assert.equal(doc(id).retry.count, 1); assert.equal(doc(id).status, 'APPROVED');
});

test('GET /requests/:id exposes retry state, history and manual-retry eligibility', async () => {
  await reset();
  const id = await failedRequest();
  let r = await call(requests.getRequest, { params: { id } });
  assert.equal(r.body.data.retry.state, 'SCHEDULED'); assert.ok(r.body.data.retry.nextRetryAt); assert.equal(r.body.data.retry.lastError.kind, 'DEPENDENCY_FAILURE');
  assert.deepEqual(r.body.data.manualRetry, { eligible: true, reason: null });
  setDep({ outcome: 'SUCCESS' }); await manual(id);
  r = await call(requests.getRequest, { params: { id } });
  assert.equal(r.body.data.manualRetry.eligible, false); assert.equal(r.body.data.retry.history.length, 1); assert.equal(r.body.data.dependencyCalls.length, 2);
});

// ---------------------------------------------------------------- concurrency
test('concurrent manual retries execute the request exactly once', async () => {
  await reset();
  const id = await failedRequest();
  setDep({ outcome: 'SUCCESS', delayMs: 5 });
  dependency.setHooks({ sleep: () => new Promise((r) => setImmediate(r)) }); // real interleaving between callers
  const out = await Promise.all(Array.from({ length: 8 }, () => manual(id)));
  assert.equal(out.filter((o) => o.status === 200).length, 1);
  assert.equal(out.filter((o) => o.status === 409).length, 7);
  assert.equal(callsOf(id).length, 2); assert.equal(doc(id).retry.count, 1); assert.equal(doc(id).retry.history.length, 1);
  assert.equal(doc(id).stageHistory.filter((h) => h.stageId === 'EXTERNAL_VERIFICATION' && h.status === 'COMPLETED').length, 1);
  assert.equal(execsOf(id).length, 7);
});

test('manual and automatic retries never run together (either order)', async () => {
  for (const order of ['manual-first', 'worker-first']) {
    await reset();
    const id = await failedRequest(); advance(1000); // due now
    setDep({ outcome: 'SUCCESS' });
    dependency.setHooks({ sleep: () => new Promise((r) => setImmediate(r)) });
    const w = createRetryWorker({ enabled: true });
    const jobs = order === 'manual-first' ? [manual(id), w.tick(), w.tick()] : [w.tick(), manual(id), w.tick()];
    const [a, b] = await Promise.all(jobs);
    assert.equal(callsOf(id).length, 2, order); assert.equal(doc(id).retry.count, 1, order); assert.equal(doc(id).retry.history.length, 1, order);
    assert.equal(doc(id).status, 'APPROVED', order); assert.equal(execsOf(id).length, 7, order);
    const manualRes = order === 'manual-first' ? a : b;
    if (manualRes.status === 409) assert.match(manualRes.body.error.message, /already in progress|Only FAILED|started first/); // lost the race cleanly
  }
});

test('claim is atomic and conditional: two claims, stale claims and early automatic claims are rejected', async () => {
  await reset();
  const id = await failedRequest();
  const snap = fakes.WorkflowRequest.docs.find((d) => d.requestId === id);
  const early = await claimRetry(snap, { trigger: 'AUTOMATIC', initiatedBy: 'system', now: T, lockMs: 1000 }); // not due
  assert.equal(early, null);
  const [a, b] = await Promise.all([1, 2].map(() => claimRetry(structuredClone(snap), { trigger: 'MANUAL', initiatedBy: 'x', now: T, lockMs: 1000 })));
  assert.equal([a, b].filter(Boolean).length, 1);
  const d = doc(id);
  assert.equal(d.status, 'PROCESSING'); assert.equal(d.retry.state, 'IN_PROGRESS'); assert.equal(d.retry.count, 1); assert.equal(d.retry.nextRetryAt, null); assert.equal(d.retry.lockedUntil.getTime(), T + 1000);
  assert.equal(d.retry.history.length, 1); assert.equal(d.retry.history[0].outcome, 'RUNNING');
});

// ---------------------------------------------------------------- restart survival
test('retry state survives an application restart: a new worker picks up what became due while the app was down', async () => {
  await reset();
  const id = await failedRequest();
  const scheduled = doc(id).retry.nextRetryAt.getTime();
  const w1 = createRetryWorker({ intervalMs: 50, enabled: true }); w1.start(); await w1.stop(); // "app" shuts down
  const persisted = JSON.stringify(fakes.WorkflowRequest.docs); // everything needed is in the database
  advance(60 * 1000); // downtime
  setDep({ outcome: 'SUCCESS' });
  const w2 = createRetryWorker({ intervalMs: 50, enabled: true }); // "restart": fresh in-memory state
  assert.equal(JSON.parse(persisted)[0].retry.state, 'SCHEDULED'); assert.equal(new Date(JSON.parse(persisted)[0].retry.nextRetryAt).getTime(), scheduled);
  assert.equal(w2.start(), true); await w2.stop(); // start() ticks immediately
  assert.equal(doc(id).status, 'APPROVED'); assert.equal(doc(id).retry.state, 'RECOVERED'); assert.equal(callsOf(id).length, 2);
  assert.equal(w2.getStatus().lastResult.succeeded, 1);
});

test('a retry interrupted by a crash is recovered after its lease expires and then completes without duplicates', async () => {
  await reset();
  const id = await failedRequest(); advance(1000);
  // a process claims the retry and dies before doing anything
  const claimed = await claimRetry(doc(id), { trigger: 'AUTOMATIC', initiatedBy: 'system', now: T, lockMs: 60000 });
  assert.ok(claimed); assert.equal(doc(id).status, 'PROCESSING');
  assert.equal(await recoverInterrupted({ now: T + 59999 }), 0); // lease still valid: a live retry is not touched
  assert.equal((await processDueRetries({ now: T + 59999 })).due, 0); assert.equal((await manual(id)).status, 409); // and cannot be double-run meanwhile
  advance(60001);
  assert.equal(await recoverInterrupted({ now: T }), 1);
  assert.equal(await recoverInterrupted({ now: T }), 0); // exactly once
  let d = doc(id);
  assert.equal(d.status, 'FAILED'); assert.equal(d.executionState, 'FAILED'); assert.equal(d.retry.state, 'SCHEDULED'); assert.equal(d.retry.lockedUntil, null);
  assert.equal(d.retry.history[0].outcome, 'INTERRUPTED'); assert.equal(d.retry.lastError.kind, 'INTERRUPTED'); assert.equal(d.retry.count, 1);
  assert.equal(d.retry.nextRetryAt.getTime(), T + 2000); // backoff continues: count 1 -> initial * 2^1
  assert.equal(fakes.AuditLog.docs.at(-1).action, 'RETRY_INTERRUPTED');
  advance(2000); setDep({ outcome: 'SUCCESS' });
  const w = createRetryWorker({ enabled: true });
  assert.equal((await w.tick()).succeeded, 1); // the worker tick also runs recovery first
  d = doc(id);
  assert.equal(d.status, 'APPROVED'); assert.equal(d.retry.count, 2); assert.deepEqual(d.retry.history.map((h) => h.outcome), ['INTERRUPTED', 'SUCCEEDED']);
  assert.equal(d.stageHistory.filter((h) => h.stageId === 'VALIDATION').length, 1);
  assert.deepEqual(callsOf(id).map((c) => c.attempt), [1, 2]);
});

test('an interrupted retry past the attempt limit becomes EXHAUSTED instead of looping', async () => {
  await reset({ maxAttempts: 1 });
  const id = await failedRequest(); advance(1000);
  await claimRetry(doc(id), { trigger: 'AUTOMATIC', initiatedBy: 'system', now: T, lockMs: 10 });
  advance(11);
  assert.equal(await recoverInterrupted({ now: T }), 1);
  assert.equal(doc(id).retry.state, 'EXHAUSTED'); assert.equal(doc(id).retry.nextRetryAt, null);
});

// ---------------------------------------------------------------- resume correctness
test('resume after an earlier EVALUATION stage re-uses its stored result for DECISION (no second evaluation)', async () => {
  await reset(); setDep({ outcome: 'FAILURE' });
  const wf = fakes.WorkflowDefinition.docs[0];
  wf.stages = [wf.stages[0], wf.stages[3], wf.stages[2], wf.stages[4], wf.stages[5]]; // RECEIVE, EVALUATION, VERIFICATION, DECISION, COMPLETE
  wf.transitions = [
    { from: 'REQUEST_RECEIVED', to: 'INITIAL_EVALUATION', outcome: 'ALWAYS' }, { from: 'INITIAL_EVALUATION', to: 'EXTERNAL_VERIFICATION', outcome: 'ALWAYS' },
    { from: 'EXTERNAL_VERIFICATION', to: 'DECISION', outcome: 'ALWAYS' },
    ...['APPROVED', 'REJECTED', 'MANUAL_REVIEW'].map((o) => ({ from: 'DECISION', to: 'COMPLETED', outcome: o })),
  ];
  const id = (await post(payload({ creditScore: 800 }))).body.requestId;
  assert.deepEqual(ids(id), ['REQUEST_RECEIVED:COMPLETED', 'INITIAL_EVALUATION:COMPLETED', 'EXTERNAL_VERIFICATION:FAILED']);
  const evaluations = execsOf(id).filter((x) => x.stage === 'INITIAL_EVALUATION').length;
  setDep({ outcome: 'SUCCESS' }); advance(1000);
  await processDueRetries({ now: T });
  assert.equal(doc(id).status, 'APPROVED'); assert.equal(doc(id).decision.outcome, 'APPROVED');
  assert.equal(execsOf(id).filter((x) => x.stage === 'INITIAL_EVALUATION').length, evaluations); // evaluation was not repeated
});

test('a retry whose stage no longer exists fails permanently instead of looping', async () => {
  await reset();
  const id = await failedRequest(); advance(1000);
  const wf = fakes.WorkflowDefinition.docs[0];
  wf.stages = wf.stages.filter((s) => s.stageId !== 'EXTERNAL_VERIFICATION');
  wf.transitions = wf.transitions.filter((t) => t.from !== 'EXTERNAL_VERIFICATION' && t.to !== 'EXTERNAL_VERIFICATION');
  wf.transitions.push({ from: 'VALIDATION', to: 'INITIAL_EVALUATION', outcome: 'ALWAYS' });
  const s = await processDueRetries({ now: T });
  assert.equal(s.failedAgain, 1);
  assert.equal(doc(id).retry.state, 'NOT_RETRYABLE'); assert.match(doc(id).failure.message, /Cannot resume/); assert.equal(doc(id).retry.nextRetryAt, null);
});

test('Phase 7/8 behaviour intact: runWorkflow still never re-runs a FAILED request and replays stay idempotent', async () => {
  await reset();
  const id = await failedRequest(); setDep({ outcome: 'SUCCESS' });
  assert.equal((await runWorkflow(doc(id))).executed, false); assert.equal(callsOf(id).length, 1); assert.equal(doc(id).status, 'FAILED');
  const r = await call(requests.executeRequest, { params: { id } });
  assert.equal(r.body.executed, false); assert.equal(callsOf(id).length, 1);
});

// ---------------------------------------------------------------- worker mechanics
test('worker: skips without a database, never overlaps ticks, reports status, start/stop are idempotent', async () => {
  await reset();
  const w = createRetryWorker({ intervalMs: 20, enabled: true });
  state.connected = false; assert.deepEqual(await w.tick(), { skipped: 'database not connected' }); state.connected = true;
  const id = await failedRequest(); advance(1000); setDep({ outcome: 'SUCCESS' });
  dependency.setHooks({ sleep: () => new Promise((r) => setTimeout(r, 10)) });
  const [a, b] = await Promise.all([w.tick(), w.tick()]);
  assert.equal([a, b].filter((x) => x.skipped === 'tick already running').length, 1);
  assert.equal(callsOf(id).length, 2);
  assert.equal(w.start(), true); assert.equal(w.start(), true); assert.equal(w.getStatus().running, true);
  await w.stop(); assert.equal(w.getStatus().running, false); assert.ok(w.getStatus().lastTickAt);
  const off = createRetryWorker({ enabled: false }); assert.equal(off.start(), false); assert.equal(off.getStatus().running, false);
});

test('worker survives errors: a failing tick is reported and the next tick still works', async () => {
  await reset();
  const w = createRetryWorker({ enabled: true });
  const real = fakes.WorkflowRequest.find; fakes.WorkflowRequest.find = () => { throw new Error('boom'); };
  const origErr = console.error; console.error = () => {};
  try { await w.tick(); } finally { fakes.WorkflowRequest.find = real; console.error = origErr; }
  assert.equal(w.getStatus().lastError, 'boom');
  await w.tick(); assert.equal(w.getStatus().lastError, null);
});

test('retry settings drive the next failure (stored policy is read at failure time)', async () => {
  await reset();
  await call(retries.updateConfig, { body: { initialDelayMs: 7000, backoffMultiplier: 3, maxDelayMs: 100000, maxAttempts: 2 } });
  const id = await failedRequest();
  assert.equal(doc(id).retry.nextRetryAt.getTime() - T, 7000); assert.equal(doc(id).retry.maxAttempts, 2);
  advance(7000); await processDueRetries({ now: T });
  assert.equal(doc(id).retry.nextRetryAt.getTime() - T, 21000); // 7000 * 3^1
});
