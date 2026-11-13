const test = require('node:test');
const assert = require('node:assert/strict');
const { fakes, fakeRequest, call } = require('./helpers/mocks');
const { executeWorkflow } = require('../src/services/workflowService');
const { seedDefaultRules } = require('../src/services/ruleSeeder');
const { seedDefaultWorkflow } = require('../src/services/workflowSeeder');
const rules = require('../src/controllers/ruleController');

fakes.WorkflowDefinition.docs = [];
seedDefaultWorkflow(); // Phase 6: stages come from the stored workflow
const run = async (fields) => { fakes.WorkflowExecution.docs = []; return executeWorkflow(fakeRequest(fields)); };

test('workflow decisions come from rules stored in the (fake) DB and the trace is persisted', async () => {
  fakes.Rule.docs = []; await seedDefaultRules();
  const cases = [[17, 800, 'REJECTED'], [30, 599, 'REJECTED'], [30, 600, 'MANUAL_REVIEW'], [30, 699, 'MANUAL_REVIEW'], [30, 700, 'APPROVED']];
  for (const [age, creditScore, expected] of cases) {
    const req = await run({ age, creditScore });
    assert.equal(req.status, expected); // final status is the decision outcome (Phase 4 flow)
    assert.equal(req.decision.outcome, expected, `${age}/${creditScore}`);
    assert.ok(req.decision.ruleId);
    assert.ok(req.evaluationTrace.length >= 1);
    const stage = fakes.WorkflowExecution.docs.find((d) => d.stage === 'INITIAL_EVALUATION');
    assert.equal(stage.result.trace.length, req.evaluationTrace.length); // trace also in execution history
  }
});

test('editing a rule in the store changes the next decision with no code change', async () => {
  fakes.Rule.docs = []; await seedDefaultRules();
  assert.equal((await run({ age: 30, creditScore: 720 })).decision.outcome, 'APPROVED');
  await call(rules.updateRule, { params: { id: 'RULE-CREDIT-HIGH' }, body: { expectedValue: 750 } });
  const after = await run({ age: 30, creditScore: 720 });
  assert.equal(after.decision.outcome, 'MANUAL_REVIEW'); // nothing decides -> safe default
  assert.equal(after.decision.reason.includes('default outcome'), true);
  assert.equal((await run({ age: 30, creditScore: 760 })).decision.outcome, 'APPROVED');
});

test('disabled rule via API is skipped; request status flow stays valid', async () => {
  fakes.Rule.docs = []; await seedDefaultRules();
  await call(rules.updateRule, { params: { id: 'RULE-AGE-MIN' }, body: { enabled: false } });
  const req = await run({ age: 17, creditScore: 800 });
  assert.equal(req.decision.outcome, 'APPROVED'); // age rule disabled
  assert.ok(!req.evaluationTrace.some((t) => t.ruleId === 'RULE-AGE-MIN'));
});

test('no rules in DB -> MANUAL_REVIEW fallback, request still completes', async () => {
  fakes.Rule.docs = [];
  const req = await run({ age: 30, creditScore: 800 });
  assert.equal(req.decision.outcome, 'MANUAL_REVIEW');
});
