// Seed rules for the loan-approval example. Stored in MongoDB; edit them there or via /api/rules - not here.
// Execution order = priority ascending. A rule that doesn't decide (CONTINUE) hands over to the next one.
const base = { workflowKey: 'loan-approval', enabled: true, onPass: 'CONTINUE', onFail: 'CONTINUE' };

module.exports = [
  { ...base, ruleId: 'RULE-AGE-MIN', ruleName: 'Minimum age', description: 'Applicants younger than 18 are rejected.',
    field: 'age', operator: 'LESS_THAN', expectedValue: 18, priority: 10, onPass: 'REJECTED' },
  { ...base, ruleId: 'RULE-CREDIT-LOW', ruleName: 'Credit score too low', description: 'Credit score below 600 is rejected.',
    field: 'creditScore', operator: 'LESS_THAN', expectedValue: 600, priority: 20, onPass: 'REJECTED' },
  // 600-699: two rules combined with AND. The first member's onPass decides for the whole group.
  { ...base, ruleId: 'RULE-CREDIT-MID-MIN', ruleName: 'Credit score at least 600', description: 'Lower bound of the manual review band (AND group).',
    field: 'creditScore', operator: 'GREATER_THAN_OR_EQUAL', expectedValue: 600, priority: 30, onPass: 'MANUAL_REVIEW', groupId: 'credit-mid-band', groupLogic: 'AND' },
  { ...base, ruleId: 'RULE-CREDIT-MID-MAX', ruleName: 'Credit score at most 699', description: 'Upper bound of the manual review band (AND group).',
    field: 'creditScore', operator: 'LESS_THAN_OR_EQUAL', expectedValue: 699, priority: 31, groupId: 'credit-mid-band', groupLogic: 'AND' },
  { ...base, ruleId: 'RULE-CREDIT-HIGH', ruleName: 'Credit score 700 or above', description: 'Credit score of 700 or more is approved.',
    field: 'creditScore', operator: 'GREATER_THAN_OR_EQUAL', expectedValue: 700, priority: 40, onPass: 'APPROVED' },
];
