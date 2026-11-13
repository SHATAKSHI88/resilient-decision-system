const { OPERATORS, ACTIONS, GROUP_LOGICS, CONTINUE } = require('../rulesEngine/constants');

const ID_RE = /^[A-Za-z0-9_-]{2,50}$/;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const NUMERIC_OPS = ['GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL'];
const LIST_OPS = ['IN', 'NOT_IN'];
const isNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
const scalar = (v) => ['string', 'number', 'boolean'].includes(typeof v) && !(typeof v === 'string' && v.trim() === '');

/**
 * Validates a rule configuration. Returns { errors: {field: message}, value }.
 * Numeric expectedValues are normalised to numbers; IN/NOT_IN accept an array or a comma separated string.
 */
function validateRule(body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const ruleId = str(b.ruleId);
  if (!ruleId) errors.ruleId = 'Rule ID is required';
  else if (!ID_RE.test(ruleId)) errors.ruleId = 'Rule ID must be 2-50 characters: letters, numbers, - or _';

  const ruleName = str(b.ruleName);
  if (!ruleName) errors.ruleName = 'Rule name is required';
  else if (ruleName.length < 2 || ruleName.length > 100) errors.ruleName = 'Rule name must be 2-100 characters';

  let description = '';
  if (b.description !== undefined && b.description !== null && b.description !== '') {
    if (typeof b.description !== 'string') errors.description = 'Description must be text';
    else if (b.description.length > 500) errors.description = 'Description must be at most 500 characters';
    else description = b.description.trim();
  }

  const field = str(b.field);
  if (!field) errors.field = 'Field is required';
  else if (!FIELD_RE.test(field)) errors.field = 'Field must be a name such as creditScore (dots allowed for nested fields)';

  const operator = str(b.operator);
  if (!operator) errors.operator = 'Operator is required';
  else if (!OPERATORS.includes(operator)) errors.operator = `Operator must be one of: ${OPERATORS.join(', ')}`;

  let expectedValue = b.expectedValue;
  if (expectedValue === undefined || expectedValue === null || expectedValue === '') errors.expectedValue = 'Expected value is required';
  else if (OPERATORS.includes(operator)) {
    if (LIST_OPS.includes(operator)) {
      if (typeof expectedValue === 'string') expectedValue = expectedValue.split(',').map((s) => s.trim()).filter(Boolean);
      if (!Array.isArray(expectedValue) || expectedValue.length === 0 || !expectedValue.every(scalar)) {
        errors.expectedValue = `${operator} needs a non-empty list of values`;
      } else if (expectedValue.every(isNum)) expectedValue = expectedValue.map(Number);
    } else if (NUMERIC_OPS.includes(operator)) {
      if (!isNum(expectedValue)) errors.expectedValue = `${operator} needs a numeric expected value`;
      else expectedValue = Number(expectedValue);
    } else if (!scalar(expectedValue)) errors.expectedValue = `${operator} needs a single text, number or true/false value`;
    else if (typeof expectedValue === 'string' && isNum(expectedValue)) expectedValue = Number(expectedValue);
  }

  let priority = b.priority;
  if (priority === undefined || priority === null || priority === '') errors.priority = 'Priority is required';
  else if (!isNum(priority) || !Number.isInteger(Number(priority)) || Number(priority) < 1 || Number(priority) > 10000) errors.priority = 'Priority must be a whole number between 1 and 10000';
  else priority = Number(priority);

  let enabled = true;
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') errors.enabled = 'Enabled must be true or false';
    else enabled = b.enabled;
  }

  const action = (key) => {
    const v = b[key] === undefined || b[key] === '' ? CONTINUE : b[key];
    if (!ACTIONS.includes(v)) { errors[key] = `${key} must be one of: ${ACTIONS.join(', ')}`; return CONTINUE; }
    return v;
  };
  const onPass = action('onPass');
  const onFail = action('onFail');

  const value = { ruleId, ruleName, description, field, operator, expectedValue, priority, enabled, onPass, onFail };
  if (b.workflowKey !== undefined && b.workflowKey !== '') {
    if (!ID_RE.test(str(b.workflowKey))) errors.workflowKey = 'Workflow key must be 2-50 characters: letters, numbers, - or _';
    else value.workflowKey = str(b.workflowKey);
  }
  const groupId = str(b.groupId);
  if (groupId) {
    if (!ID_RE.test(groupId)) errors.groupId = 'Group ID must be 2-50 characters: letters, numbers, - or _';
    else value.groupId = groupId;
    const logic = str(b.groupLogic) || 'AND';
    if (!GROUP_LOGICS.includes(logic)) errors.groupLogic = `Group logic must be one of: ${GROUP_LOGICS.join(', ')}`;
    else value.groupLogic = logic;
  } else if (str(b.groupLogic)) errors.groupId = 'Group ID is required when group logic is set';

  return { errors, value };
}

module.exports = { validateRule };
