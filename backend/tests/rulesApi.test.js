const test = require('node:test');
const assert = require('node:assert/strict');
const { fakes, state, call } = require('./helpers/mocks');
const rules = require('../src/controllers/ruleController');
const { validateRule } = require('../src/validators/ruleValidator');
const { seedDefaultRules } = require('../src/services/ruleSeeder');
const { loadEnabledRules } = require('../src/rulesEngine');

const good = { ruleId: 'R-1', ruleName: 'Income floor', field: 'monthlyIncome', operator: 'GREATER_THAN_OR_EQUAL', expectedValue: '3000', priority: 5, onFail: 'REJECTED' };

test('9. invalid rule configurations are rejected by the validator', () => {
  const bad = [
    [{ ...good, ruleId: '' }, 'ruleId'], [{ ...good, ruleId: 'a b!' }, 'ruleId'],
    [{ ...good, ruleName: '' }, 'ruleName'], [{ ...good, field: '1bad field' }, 'field'],
    [{ ...good, operator: 'BETWEEN' }, 'operator'], [{ ...good, operator: undefined }, 'operator'],
    [{ ...good, expectedValue: 'abc' }, 'expectedValue'], [{ ...good, expectedValue: '' }, 'expectedValue'],
    [{ ...good, operator: 'IN', expectedValue: [] }, 'expectedValue'], [{ ...good, operator: 'IN', expectedValue: [{ a: 1 }] }, 'expectedValue'],
    [{ ...good, priority: 0 }, 'priority'], [{ ...good, priority: 1.5 }, 'priority'], [{ ...good, priority: 'x' }, 'priority'],
    [{ ...good, onPass: 'EXPLODE' }, 'onPass'], [{ ...good, onFail: 'nope' }, 'onFail'],
    [{ ...good, enabled: 'yes' }, 'enabled'], [{ ...good, groupLogic: 'XOR', groupId: 'g1' }, 'groupLogic'],
    [{ ...good, groupLogic: 'AND' }, 'groupId'],
  ];
  for (const [body, key] of bad) assert.ok(validateRule(body).errors[key], `${key} should fail for ${JSON.stringify(body)}`);
  assert.deepEqual(validateRule(good).errors, {});
  assert.equal(validateRule(good).value.expectedValue, 3000); // numeric string normalised
  assert.deepEqual(validateRule({ ...good, operator: 'IN', expectedValue: 'A, B ,C' }).value.expectedValue, ['A', 'B', 'C']);
});

test('CRUD API flow', async () => {
  fakes.Rule.docs = [];
  let r = await call(rules.createRule, { body: { ...good, expectedValue: 'abc' } });
  assert.equal(r.status, 400); assert.ok(r.body.error.details.expectedValue);
  r = await call(rules.createRule, { body: good });
  assert.equal(r.status, 201); assert.equal(r.body.data.expectedValue, 3000); assert.equal(r.body.data.enabled, true);
  r = await call(rules.createRule, { body: good });
  assert.equal(r.status, 409);
  r = await call(rules.getRule, { params: { id: 'R-1' } }); assert.equal(r.status, 200); assert.equal(r.body.data.ruleName, 'Income floor');
  r = await call(rules.getRule, { params: { id: 'NOPE' } }); assert.equal(r.status, 404);
  r = await call(rules.updateRule, { params: { id: 'R-1' }, body: { enabled: false } });
  assert.equal(r.status, 200); assert.equal(r.body.data.enabled, false); assert.equal(r.body.data.field, 'monthlyIncome');
  r = await call(rules.updateRule, { params: { id: 'R-1' }, body: { operator: 'WRONG' } }); assert.equal(r.status, 400);
  r = await call(rules.updateRule, { params: { id: 'R-1' }, body: { ruleId: 'OTHER' } }); assert.equal(r.status, 400);
  r = await call(rules.updateRule, { params: { id: 'NOPE' }, body: { priority: 3 } }); assert.equal(r.status, 404);
  r = await call(rules.listRules, {}); assert.equal(r.body.data.length, 1);
  r = await call(rules.listRules, { query: { enabled: 'true' } }); assert.equal(r.body.data.length, 0);
  r = await call(rules.deleteRule, { params: { id: 'R-1' } }); assert.equal(r.status, 200);
  r = await call(rules.getRule, { params: { id: 'R-1' } }); assert.equal(r.status, 404);
  state.connected = false;
  r = await call(rules.listRules, {}); assert.equal(r.status, 503);
  state.connected = true;
});

test('seeding + only enabled rules are loaded from the store', async () => {
  fakes.Rule.docs = [];
  assert.deepEqual(await seedDefaultRules(), { seeded: 5, skipped: false });
  assert.equal((await seedDefaultRules()).skipped, true); // never overwrites
  await call(rules.updateRule, { params: { id: 'RULE-CREDIT-LOW' }, body: { enabled: false } });
  const loaded = await loadEnabledRules('loan-approval');
  assert.equal(loaded.length, 4); assert.ok(!loaded.some((x) => x.ruleId === 'RULE-CREDIT-LOW'));
  assert.deepEqual(loaded.map((x) => x.priority), [10, 30, 31, 40]);
});
