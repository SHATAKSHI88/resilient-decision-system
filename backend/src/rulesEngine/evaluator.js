// Pure, database-free evaluation. No business rule lives here - everything comes from the rules passed in.
const { operators } = require('./operators');
const { CONTINUE } = require('./constants');

/** Reads a (possibly dotted) path like "applicant.age" from data. */
function getField(data, path) {
  return String(path).split('.').reduce((o, k) => (o !== null && o !== undefined && typeof o === 'object' ? o[k] : undefined), data);
}
const isMissing = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const byPriority = (a, b) => a.priority - b.priority || String(a.ruleId).localeCompare(String(b.ruleId));
const describe = (r, actual) => `${r.ruleName}: ${r.field} (${actual === undefined ? 'missing' : JSON.stringify(actual)}) ${r.operator} ${JSON.stringify(r.expectedValue)}`;

/** Evaluates one rule against data. Never throws; a bad operator or missing field is a safe FAIL. */
function evaluateRule(rule, data, now = () => new Date()) {
  const actual = getField(data, rule.field);
  const op = operators[rule.operator];
  let passed = false;
  let note;
  if (!op) note = `Unknown operator ${rule.operator}`;
  else if (isMissing(actual)) note = `Field "${rule.field}" is missing or empty`;
  else {
    try { passed = Boolean(op(actual, rule.expectedValue)); } catch (e) { note = `Evaluation error: ${e.message}`; }
  }
  return {
    ruleId: rule.ruleId,
    ruleName: rule.ruleName,
    field: rule.field,
    actualValue: isMissing(actual) ? null : actual,
    operator: rule.operator,
    expectedValue: rule.expectedValue,
    result: passed ? 'PASS' : 'FAIL',
    actionTriggered: CONTINUE, // filled in below once the action is known
    priority: rule.priority,
    ...(rule.groupId ? { groupId: rule.groupId } : {}),
    ...(note ? { note } : {}),
    evaluatedAt: now(),
  };
}

/**
 * Evaluates rules sequentially by ascending priority and stops at the first rule/group whose action is not CONTINUE.
 * Rules that share a groupId are one unit: they are evaluated together (AND = all pass, OR = any passes), the unit
 * sits at the priority of its first member, and the first member's onPass/onFail is the unit's action.
 *
 * @param {object[]} rules   rule configs (only enabled ones are evaluated - disabled are filtered defensively)
 * @param {object}   data    request data
 * @param {object}   options { defaultOutcome, now }
 * @returns {{ outcome, reason, decidedByRuleId, defaultApplied, trace }}
 */
function evaluateRules(rules, data, { defaultOutcome = null, now = () => new Date() } = {}) {
  const active = (rules || []).filter((r) => r && r.enabled !== false).sort(byPriority);
  // Build ordered units: single rules or groups.
  const units = [];
  const seenGroups = new Map();
  for (const r of active) {
    if (r.groupId) {
      if (!seenGroups.has(r.groupId)) { const u = { group: r.groupId, logic: r.groupLogic === 'OR' ? 'OR' : 'AND', rules: [] }; seenGroups.set(r.groupId, u); units.push(u); }
      seenGroups.get(r.groupId).rules.push(r);
    } else units.push({ rules: [r] });
  }

  const trace = [];
  for (const unit of units) {
    const entries = unit.rules.map((r) => evaluateRule(r, data, now));
    trace.push(...entries);
    const lead = unit.rules[0];
    const passed = unit.group
      ? (unit.logic === 'OR' ? entries.some((e) => e.result === 'PASS') : entries.every((e) => e.result === 'PASS'))
      : entries[0].result === 'PASS';
    const action = (passed ? lead.onPass : lead.onFail) || CONTINUE;
    entries[0].actionTriggered = action;
    if (unit.group) entries[0].groupResult = `${unit.logic}:${passed ? 'PASS' : 'FAIL'}`;
    if (action !== CONTINUE) {
      const reason = unit.group
        ? `Rule group "${unit.group}" (${unit.logic}) ${passed ? 'passed' : 'failed'} -> ${action}. ${entries.map((e) => `${e.ruleName}=${e.result}`).join(', ')}`
        : `${passed ? 'Passed' : 'Failed'} - ${describe(lead, entries[0].actualValue ?? undefined)} -> ${action}`;
      return { outcome: action, reason, decidedByRuleId: lead.ruleId, defaultApplied: false, trace };
    }
  }
  const reason = active.length
    ? `No rule produced a decision; default outcome ${defaultOutcome} applied`
    : `No enabled rules configured; default outcome ${defaultOutcome} applied`;
  return { outcome: defaultOutcome, reason, decidedByRuleId: null, defaultApplied: true, trace };
}

module.exports = { evaluateRules, evaluateRule, getField };
