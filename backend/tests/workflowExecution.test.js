const test = require('node:test');
const assert = require('node:assert/strict');
const { fakes, fakeRequest } = require('./helpers/mocks');
const { executeWorkflow, setRulesEngine } = require('../src/services/workflowService');
const { seedDefaultWorkflow } = require('../src/services/workflowSeeder');
const { seedDefaultRules } = require('../src/services/ruleSeeder');
const { createRulesEngine } = require('../src/rulesEngine');
const def = require('../src/data/defaultWorkflow');

const clone = (o) => JSON.parse(JSON.stringify(o));
const reset = async () => { fakes.WorkflowDefinition.docs = []; fakes.Rule.docs = []; fakes.WorkflowExecution.docs = []; await seedDefaultWorkflow(); await seedDefaultRules(); };
const run = async (fields) => { fakes.WorkflowExecution.docs = []; return executeWorkflow(fakeRequest(fields)); };
const setWorkflow = (mutate) => { const d = fakes.WorkflowDefinition.docs[0]; mutate(d); };

test('default workflow runs all five stages in order and stores stage history', async () => {
  await reset();
  const r = await run({ age: 30, creditScore: 800 });
  assert.equal(r.status, 'APPROVED');
  assert.deepEqual(r.stageHistory.map((h) => h.stageId), ['REQUEST_RECEIVED', 'VALIDATION', 'EXTERNAL_VERIFICATION', 'INITIAL_EVALUATION', 'DECISION', 'COMPLETED']);
  assert.ok(r.stageHistory.every((h) => h.status === 'COMPLETED' && h.startedAt && h.completedAt));
  assert.equal(r.stageHistory[4].outcome, 'APPROVED'); assert.equal(r.stageHistory[4].nextStageId, 'COMPLETED');
  assert.equal(r.currentStage, 'COMPLETED'); assert.ok(r.completedAt);
  assert.deepEqual(fakes.WorkflowExecution.docs.map((d) => d.stage), r.stageHistory.map((h) => h.stageId));
  assert.ok(r.evaluationTrace.length > 0); // Phase 5 rules engine still integrated
});

test('each decision outcome selects its transition', async () => {
  await reset();
  for (const [age, credit, outcome] of [[30, 800, 'APPROVED'], [30, 500, 'REJECTED'], [17, 800, 'REJECTED'], [30, 650, 'MANUAL_REVIEW']]) {
    const r = await run({ age, creditScore: credit });
    assert.equal(r.status, outcome); assert.equal(r.decision.outcome, outcome);
    assert.equal(r.stageHistory.find((h) => h.stageId === 'DECISION').outcome, outcome);
  }
});

test('outcome-specific routing: MANUAL_REVIEW goes through an extra stage when configured', async () => {
  await reset();
  setWorkflow((d) => {
    d.stages.splice(5, 0, { stageId: 'REVIEW_QUEUE', name: 'Review Queue', type: 'VALIDATION' });
    d.transitions = d.transitions.filter((t) => !(t.from === 'DECISION' && t.outcome === 'MANUAL_REVIEW'));
    d.transitions.push({ from: 'DECISION', to: 'REVIEW_QUEUE', outcome: 'MANUAL_REVIEW' }, { from: 'REVIEW_QUEUE', to: 'COMPLETED', outcome: 'ALWAYS' });
  });
  const mid = await run({ age: 30, creditScore: 650 });
  assert.deepEqual(mid.stageHistory.map((h) => h.stageId).slice(4), ['DECISION', 'REVIEW_QUEUE', 'COMPLETED']);
  const ok = await run({ age: 30, creditScore: 800 });
  assert.ok(!ok.stageHistory.some((h) => h.stageId === 'REVIEW_QUEUE'));
});

test('workflow changes affect future executions only (rename / skip a stage)', async () => {
  await reset();
  const before = await run({ age: 30, creditScore: 800 });
  assert.equal(before.stageHistory.length, 6);
  setWorkflow((d) => { // drop VALIDATION and EXTERNAL_VERIFICATION: RECEIVED -> INITIAL_EVALUATION; rename the evaluation stage
    const dropped = ['VALIDATION', 'EXTERNAL_VERIFICATION'];
    d.stages = d.stages.filter((s) => !dropped.includes(s.stageId));
    d.transitions = d.transitions.filter((t) => !dropped.includes(t.from) && !dropped.includes(t.to));
    d.transitions.push({ from: 'REQUEST_RECEIVED', to: 'INITIAL_EVALUATION', outcome: 'ALWAYS' });
    d.stages.find((s) => s.stageId === 'INITIAL_EVALUATION').name = 'Rules Check';
  });
  const after = await run({ age: 30, creditScore: 800 });
  assert.deepEqual(after.stageHistory.map((h) => h.stageId), ['REQUEST_RECEIVED', 'INITIAL_EVALUATION', 'DECISION', 'COMPLETED']);
  assert.equal(after.stageHistory[1].stageName, 'Rules Check');
  assert.equal(fakes.DependencyCall.docs.filter((c) => c.requestId === after.requestId).length, 0); // no verification stage -> no dependency call
  assert.equal(before.stageHistory.length, 6); // earlier request history untouched
});

test('missing configuration: no workflow / disabled workflow -> request FAILED safely', async () => {
  await reset();
  fakes.WorkflowDefinition.docs = [];
  let r = await run({ age: 30, creditScore: 800 });
  assert.equal(r.status, 'FAILED'); assert.match(r.decision.reason, /No enabled workflow/);
  assert.equal(fakes.WorkflowExecution.docs[0].stage, 'WORKFLOW_LOAD');
  await reset(); setWorkflow((d) => { d.enabled = false; });
  r = await run({ age: 30, creditScore: 800 });
  assert.equal(r.status, 'FAILED');
});

test('invalid configuration in the database is rejected before running', async () => {
  await reset(); setWorkflow((d) => { d.transitions = []; });
  let r = await run({ age: 30, creditScore: 800 });
  assert.equal(r.status, 'FAILED'); assert.match(r.decision.reason, /configuration is invalid/);
  assert.equal(r.stageHistory.length, 0);
});

test('invalid transition at runtime: no transition for the outcome -> FAILED with history', async () => {
  await reset();
  // Bypass API validation (as a hand edit in MongoDB would): DECISION loses its REJECTED transition. Validator catches it first.
  setWorkflow((d) => { d.transitions = d.transitions.filter((t) => !(t.from === 'DECISION' && t.outcome === 'REJECTED')); });
  const r = await run({ age: 30, creditScore: 500 });
  assert.equal(r.status, 'FAILED'); assert.match(r.decision.reason, /invalid|REJECTED/);
});

test('runtime failures: unknown stage type and DECISION before EVALUATION', async () => {
  await reset(); setWorkflow((d) => { d.stages[1].type = 'TELEPORT'; });
  let r = await run({ age: 30, creditScore: 800 });
  assert.equal(r.status, 'FAILED');
  await reset(); // decision stage with no evaluation before it (valid graph, bad design) fails at runtime
  setWorkflow((d) => { d.stages.find((s) => s.stageId === 'INITIAL_EVALUATION').type = 'VALIDATION'; });
  r = await run({ age: 30, creditScore: 800 });
  assert.equal(r.status, 'FAILED'); assert.match(r.decision.reason, /without an evaluation outcome/);
  assert.equal(r.stageHistory.at(-1).status, 'FAILED'); assert.equal(r.stageHistory.at(-1).stageId, 'DECISION');
});

test('validation failure in the request fails at VALIDATION and records it', async () => {
  await reset();
  const r = await run({ age: 30, creditScore: 5 }); // below 300 -> request validator error
  assert.equal(r.status, 'FAILED');
  assert.equal(r.stageHistory.at(-1).stageId, 'VALIDATION'); assert.equal(r.stageHistory.at(-1).status, 'FAILED');
});

test('Rules Engine still drives outcomes (disabled rule changes decision; injected engine works)', async () => {
  await reset();
  fakes.Rule.docs.find((x) => x.ruleId === 'RULE-CREDIT-LOW').enabled = false;
  assert.notEqual((await run({ age: 30, creditScore: 500 })).status, 'REJECTED');
  setRulesEngine(createRulesEngine({ loadRules: async () => [{ ruleId: 'X', ruleName: 'X', field: 'age', operator: 'EQUALS', expectedValue: 30, priority: 1, onPass: 'REJECTED' }] }));
  assert.equal((await run({ age: 30, creditScore: 800 })).status, 'REJECTED');
  setRulesEngine(createRulesEngine());
});

test('selectTransition: exact outcome beats ALWAYS; none -> undefined', () => {
  const { selectTransition } = require('../src/services/workflowService');
  const w = { transitions: [{ from: 'A', to: 'B', outcome: 'ALWAYS' }, { from: 'A', to: 'C', outcome: 'REJECTED' }, { from: 'D', to: 'E', outcome: 'APPROVED' }] };
  assert.equal(selectTransition(w, 'A', 'REJECTED').to, 'C');
  assert.equal(selectTransition(w, 'A', 'APPROVED').to, 'B');
  assert.equal(selectTransition(w, 'D', 'REJECTED'), undefined);
  assert.equal(selectTransition(w, 'Z', undefined), undefined);
});
