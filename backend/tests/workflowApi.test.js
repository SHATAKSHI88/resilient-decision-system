const test = require('node:test');
const assert = require('node:assert/strict');
const { fakes, state, call } = require('./helpers/mocks');
const wf = require('../src/controllers/workflowController');
const { validateWorkflow } = require('../src/validators/workflowValidator');
const { seedDefaultWorkflow } = require('../src/services/workflowSeeder');
const def = require('../src/data/defaultWorkflow');

const clone = (o) => JSON.parse(JSON.stringify(o));
const custom = () => ({ ...clone(def), key: 'custom-flow', name: 'Custom', enabled: false });

test('default workflow definition is valid and matches the Phase 5 process', () => {
  const { errors } = validateWorkflow(def);
  assert.deepEqual(errors, {});
  assert.deepEqual(def.stages.map((s) => s.stageId), ['REQUEST_RECEIVED', 'VALIDATION', 'EXTERNAL_VERIFICATION', 'INITIAL_EVALUATION', 'DECISION', 'COMPLETED']);
});

test('invalid workflow configurations are rejected', () => {
  const bad = (mutate, key) => {
    const w = clone(def); mutate(w);
    const { errors } = validateWorkflow(w);
    assert.ok(errors[key], `expected error at ${key}, got ${JSON.stringify(errors)}`);
  };
  bad((w) => { w.name = ''; }, 'name');
  bad((w) => { w.key = 'a b'; }, 'key');
  bad((w) => { w.enabled = 'yes'; }, 'enabled');
  bad((w) => { w.stages = [w.stages[0]]; }, 'stages');
  bad((w) => { w.stages[1].stageId = 'REQUEST_RECEIVED'; }, 'stages[1].stageId'); // duplicate
  bad((w) => { w.stages[1].type = 'MAGIC'; }, 'stages[1].type');
  bad((w) => { w.stages[1].name = ''; }, 'stages[1].name');
  bad((w) => { w.stages[1].type = 'RECEIVE'; }, 'stages'); // two start stages
  bad((w) => { w.stages[5].type = 'VALIDATION'; }, 'stages'); // no COMPLETE
  bad((w) => { w.transitions = []; }, 'transitions');
  bad((w) => { w.transitions[0].to = 'NOWHERE'; }, 'transitions[0].to');
  bad((w) => { w.transitions[0].from = 'NOWHERE'; }, 'transitions[0].from');
  bad((w) => { w.transitions[0].outcome = 'MAYBE'; }, 'transitions[0].outcome');
  bad((w) => { w.transitions[1].to = 'REQUEST_RECEIVED'; }, 'transitions[1].to'); // back to start
  bad((w) => { w.transitions[1].to = 'VALIDATION'; }, 'transitions[1].to'); // self loop
  bad((w) => { w.transitions.push({ from: 'COMPLETED', to: 'DECISION', outcome: 'ALWAYS' }); }, 'transitions[7].from');
  bad((w) => { w.transitions.push({ from: 'VALIDATION', to: 'COMPLETED', outcome: 'ALWAYS' }); }, 'transitions[7].outcome'); // duplicate
  bad((w) => { w.transitions.pop(); }, 'transitions'); // DECISION misses MANUAL_REVIEW
  bad((w) => { w.transitions.splice(1, 1); }, 'transitions'); // VALIDATION has no outgoing
  bad((w) => { w.stages.splice(2, 0, { stageId: 'ORPHAN', name: 'Orphan', type: 'VALIDATION' }); w.transitions.push({ from: 'ORPHAN', to: 'COMPLETED', outcome: 'ALWAYS' }); }, 'stages'); // unreachable
});

test('workflow CRUD API', async () => {
  fakes.WorkflowDefinition.docs = [];
  await seedDefaultWorkflow();
  assert.equal((await seedDefaultWorkflow()).skipped, true); // never overwrites

  let r = await call(wf.listWorkflows, {});
  assert.equal(r.body.data.length, 1);
  r = await call(wf.getWorkflow, { params: { id: 'loan-approval' } });
  assert.equal(r.status, 200); assert.equal(r.body.data.stages.length, 6);
  r = await call(wf.getWorkflow, { params: { id: 'nope' } }); assert.equal(r.status, 404);

  r = await call(wf.createWorkflow, { body: { ...custom(), stages: [] } });
  assert.equal(r.status, 400); assert.ok(r.body.error.details.stages);
  r = await call(wf.createWorkflow, { body: { ...custom(), key: 'loan-approval' } }); assert.equal(r.status, 409);
  r = await call(wf.createWorkflow, { body: custom() }); assert.equal(r.status, 201);

  r = await call(wf.updateWorkflow, { params: { id: 'custom-flow' }, body: { name: 'Renamed' } });
  assert.equal(r.status, 200); assert.equal(r.body.data.name, 'Renamed'); assert.equal(r.body.data.stages.length, 6);
  r = await call(wf.updateWorkflow, { params: { id: 'custom-flow' }, body: { transitions: [] } }); assert.equal(r.status, 400);
  r = await call(wf.updateWorkflow, { params: { id: 'custom-flow' }, body: { key: 'other' } }); assert.equal(r.status, 400);
  r = await call(wf.updateWorkflow, { params: { id: 'zzz' }, body: { name: 'x' } }); assert.equal(r.status, 404);

  // active workflow cannot be deleted
  r = await call(wf.deleteWorkflow, { params: { id: 'loan-approval' } });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /active workflow/);
  // enabling another with the same key... different key here, so both stay enabled independently
  r = await call(wf.updateWorkflow, { params: { id: 'custom-flow' }, body: { enabled: true } }); assert.equal(r.body.data.enabled, true);
  r = await call(wf.deleteWorkflow, { params: { id: 'custom-flow' } }); assert.equal(r.status, 409);
  await call(wf.updateWorkflow, { params: { id: 'custom-flow' }, body: { enabled: false } });
  r = await call(wf.deleteWorkflow, { params: { id: 'custom-flow' } }); assert.equal(r.status, 200);
  r = await call(wf.getWorkflow, { params: { id: 'custom-flow' } }); assert.equal(r.status, 404);

  state.connected = false;
  r = await call(wf.listWorkflows, {}); assert.equal(r.status, 503);
  state.connected = true;
});
