const OUTCOMES = ['SUCCESS', 'FAILURE', 'TIMEOUT'];
const DEFAULTS = { outcome: 'SUCCESS', delayMs: 0, timeoutMs: 3000, failureProbability: 0 };
const LIMITS = { delayMs: [0, 30000], timeoutMs: [10, 30000], failureProbability: [0, 1] };

const isNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

/**
 * Validates simulation settings. Fields that are omitted keep the value from `base` (current settings or defaults),
 * so a partial update is allowed. Returns { errors: {field: message}, value: fullSettings }.
 */
function validateDependencyConfig(body = {}, base = DEFAULTS) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {};
  const value = { outcome: base.outcome, delayMs: base.delayMs, timeoutMs: base.timeoutMs, failureProbability: base.failureProbability };
  const given = (k) => b[k] !== undefined && b[k] !== null && b[k] !== '';

  if (given('outcome')) {
    if (typeof b.outcome !== 'string' || !OUTCOMES.includes(b.outcome.trim().toUpperCase())) errors.outcome = `Outcome must be one of: ${OUTCOMES.join(', ')}`;
    else value.outcome = b.outcome.trim().toUpperCase();
  }
  const num = (k, label, integer) => {
    if (!given(k)) return;
    const [min, max] = LIMITS[k];
    if (!isNum(b[k])) errors[k] = `${label} must be a number`;
    else if (integer && !Number.isInteger(Number(b[k]))) errors[k] = `${label} must be a whole number of milliseconds`;
    else if (Number(b[k]) < min || Number(b[k]) > max) errors[k] = `${label} must be between ${min} and ${max}`;
    else value[k] = Number(b[k]);
  };
  num('delayMs', 'Delay', true);
  num('timeoutMs', 'Timeout', true);
  num('failureProbability', 'Failure probability', false);
  return { errors, value };
}

module.exports = { validateDependencyConfig, OUTCOMES, DEFAULTS, LIMITS };
