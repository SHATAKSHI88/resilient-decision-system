const OPERATORS = [
  'EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL',
  'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'IN', 'NOT_IN',
];
// What a rule does when it passes / fails. CONTINUE = go on to the next rule.
const CONTINUE = 'CONTINUE';
const OUTCOMES = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
const ACTIONS = [...OUTCOMES, CONTINUE];
const GROUP_LOGICS = ['AND', 'OR'];

module.exports = { OPERATORS, CONTINUE, OUTCOMES, ACTIONS, GROUP_LOGICS };
