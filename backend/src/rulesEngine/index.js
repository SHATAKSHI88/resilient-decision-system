const { evaluateRules } = require('./evaluator');
const constants = require('./constants');

/** Default rule source: enabled rules for a workflow from MongoDB (read on every call, so edits apply immediately). */
async function loadEnabledRules(workflowKey) {
  const Rule = require('../models/Rule'); // lazy so the pure evaluator can be used/tested without mongoose
  const filter = { enabled: true };
  if (workflowKey) filter.workflowKey = workflowKey;
  return Rule.find(filter).sort({ priority: 1, ruleId: 1 }).lean();
}

/**
 * Creates a reusable engine. `loadRules(workflowKey)` can be swapped (tests, other stores).
 * engine.evaluate(data, { workflowKey, defaultOutcome }) -> { outcome, reason, decidedByRuleId, defaultApplied, trace }
 */
function createRulesEngine({ loadRules = loadEnabledRules } = {}) {
  return {
    async evaluate(data, { workflowKey, defaultOutcome = null, now } = {}) {
      const rules = await loadRules(workflowKey);
      return evaluateRules(rules, data, { defaultOutcome, now });
    },
  };
}

module.exports = { createRulesEngine, evaluateRules, loadEnabledRules, ...constants };
