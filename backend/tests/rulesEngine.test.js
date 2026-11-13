const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRules, createRulesEngine } = require('../src/rulesEngine');
const seed = require('../src/data/defaultRules');

const D = 'MANUAL_REVIEW';
const decide = (data, rules = seed) => evaluateRules(rules, data, { defaultOutcome: D });

test('1. age below 18 -> REJECTED (even with great credit)', () => {
  const r = decide({ age: 17, creditScore: 800 });
  assert.equal(r.outcome, 'REJECTED');
  assert.equal(r.decidedByRuleId, 'RULE-AGE-MIN');
});
test('2. credit below 600 -> REJECTED', () => {
  const r = decide({ age: 30, creditScore: 599 });
  assert.equal(r.outcome, 'REJECTED'); assert.equal(r.decidedByRuleId, 'RULE-CREDIT-LOW');
});
test('3. credit 600..699 -> MANUAL_REVIEW (AND group, boundaries)', () => {
  for (const c of [600, 650, 699]) {
    const r = decide({ age: 30, creditScore: c });
    assert.equal(r.outcome, 'MANUAL_REVIEW', `score ${c}`);
    assert.equal(r.decidedByRuleId, 'RULE-CREDIT-MID-MIN');
  }
});
test('4. credit 700+ -> APPROVED', () => {
  for (const c of [700, 850, 900]) assert.equal(decide({ age: 30, creditScore: c }).outcome, 'APPROVED', `score ${c}`);
});
test('5. disabled rules are not evaluated', () => {
  const rules = seed.map((r) => (r.ruleId === 'RULE-CREDIT-LOW' ? { ...r, enabled: false } : r));
  const r = decide({ age: 30, creditScore: 500 }, rules);
  assert.ok(!r.trace.some((t) => t.ruleId === 'RULE-CREDIT-LOW'));
  assert.notEqual(r.outcome, 'REJECTED'); // low-credit rejection is gone
});
test('6. changing a rule changes decisions without code change (via loader)', async () => {
  let rules = seed.map((r) => ({ ...r }));
  const engine = createRulesEngine({ loadRules: async () => rules });
  assert.equal((await engine.evaluate({ age: 30, creditScore: 650 }, { defaultOutcome: D })).outcome, 'MANUAL_REVIEW');
  rules = rules.map((r) => (r.ruleId === 'RULE-CREDIT-HIGH' ? { ...r, expectedValue: 650 } : r.ruleId === 'RULE-CREDIT-MID-MIN' ? { ...r, expectedValue: 500 } : r));
  // 650 now falls in mid band still (500..699) -> change band upper bound too
  rules = rules.map((r) => (r.ruleId === 'RULE-CREDIT-MID-MAX' ? { ...r, expectedValue: 649 } : r));
  assert.equal((await engine.evaluate({ age: 30, creditScore: 650 }, { defaultOutcome: D })).outcome, 'APPROVED');
});
test('7. priorities decide order, not array order', () => {
  const rules = [
    { ruleId: 'B', ruleName: 'B', field: 'x', operator: 'EQUALS', expectedValue: 1, priority: 2, onPass: 'APPROVED' },
    { ruleId: 'A', ruleName: 'A', field: 'x', operator: 'EQUALS', expectedValue: 1, priority: 1, onPass: 'REJECTED' },
  ];
  const r = decide({ x: 1 }, rules);
  assert.equal(r.outcome, 'REJECTED'); assert.equal(r.trace.length, 1); // stops at first decision
  const swapped = rules.map((x) => ({ ...x, priority: 3 - x.priority }));
  assert.equal(decide({ x: 1 }, swapped).outcome, 'APPROVED');
});
test('8. trace has every required field per evaluated rule', () => {
  const r = decide({ age: 30, creditScore: 720 });
  assert.deepEqual(r.trace.map((t) => t.ruleId), ['RULE-AGE-MIN', 'RULE-CREDIT-LOW', 'RULE-CREDIT-MID-MIN', 'RULE-CREDIT-MID-MAX', 'RULE-CREDIT-HIGH']);
  for (const t of r.trace) for (const k of ['ruleId', 'ruleName', 'field', 'actualValue', 'operator', 'expectedValue', 'result', 'actionTriggered', 'evaluatedAt']) assert.ok(k in t, k);
  assert.ok(r.trace[0].evaluatedAt instanceof Date);
  assert.equal(r.trace[4].actionTriggered, 'APPROVED');
  assert.equal(r.trace[0].actualValue, 30);
});
test('missing fields are handled safely (FAIL + note, default applied)', () => {
  const r = decide({ age: 30 });
  assert.equal(r.outcome, D); assert.equal(r.defaultApplied, true);
  assert.equal(r.trace.find((t) => t.ruleId === 'RULE-CREDIT-LOW').note.includes('missing'), true);
  assert.equal(decide({}).outcome, D);
  assert.equal(decide(null).outcome, D);
});
test('no enabled rules -> default outcome with explanatory reason', () => {
  const r = decide({ age: 30, creditScore: 800 }, []);
  assert.equal(r.outcome, D); assert.match(r.reason, /No enabled rules/);
});
test('all operators', () => {
  const t = (operator, expectedValue, actual) => evaluateRules([{ ruleId: 'R', ruleName: 'R', field: 'v', operator, expectedValue, priority: 1, onPass: 'APPROVED', onFail: 'REJECTED' }], { v: actual }, { defaultOutcome: D }).outcome;
  assert.equal(t('EQUALS', 5, '5'), 'APPROVED'); assert.equal(t('EQUALS', 'abc', 'ABC'), 'APPROVED');
  assert.equal(t('NOT_EQUALS', 5, 6), 'APPROVED'); assert.equal(t('NOT_EQUALS', 5, 5), 'REJECTED');
  assert.equal(t('GREATER_THAN', 5, 6), 'APPROVED'); assert.equal(t('GREATER_THAN', 5, 5), 'REJECTED');
  assert.equal(t('GREATER_THAN_OR_EQUAL', 5, 5), 'APPROVED');
  assert.equal(t('LESS_THAN', 5, 4), 'APPROVED'); assert.equal(t('LESS_THAN', 5, 5), 'REJECTED');
  assert.equal(t('LESS_THAN_OR_EQUAL', 5, 5), 'APPROVED');
  assert.equal(t('IN', ['Salaried', 'Retired'], 'retired'), 'APPROVED'); assert.equal(t('IN', [1, 2], 3), 'REJECTED');
  assert.equal(t('NOT_IN', [1, 2], 3), 'APPROVED'); assert.equal(t('NOT_IN', [1, 2], 2), 'REJECTED');
  assert.equal(t('GREATER_THAN', 5, 'abc'), 'REJECTED'); // non-numeric not comparable -> FAIL
});
test('OR group and nested field paths', () => {
  const rules = [
    { ruleId: 'G1', ruleName: 'g1', field: 'a.b', operator: 'EQUALS', expectedValue: 1, priority: 1, onPass: 'APPROVED', groupId: 'grp', groupLogic: 'OR' },
    { ruleId: 'G2', ruleName: 'g2', field: 'c', operator: 'EQUALS', expectedValue: 2, priority: 2, groupId: 'grp', groupLogic: 'OR' },
  ];
  assert.equal(decide({ a: { b: 1 }, c: 9 }, rules).outcome, 'APPROVED');
  assert.equal(decide({ a: { b: 0 }, c: 2 }, rules).outcome, 'APPROVED');
  assert.equal(decide({ a: { b: 0 }, c: 9 }, rules).outcome, D);
});
