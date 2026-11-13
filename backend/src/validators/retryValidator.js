// Retry policy settings (stored in MongoDB, see models/RetryConfig.js).
const DEFAULTS = { maxAttempts: 3, initialDelayMs: 5000, backoffMultiplier: 2, maxDelayMs: 60000 };
const LIMITS = {
  maxAttempts: [0, 10], // 0 = automatic retries off (manual recovery still works)
  initialDelayMs: [100, 3600000],
  backoffMultiplier: [1, 10],
  maxDelayMs: [100, 86400000],
};
const LABELS = { maxAttempts: 'Maximum retry attempts', initialDelayMs: 'Initial retry delay', backoffMultiplier: 'Backoff multiplier', maxDelayMs: 'Maximum retry delay' };

const isNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

/**
 * Validates retry settings. Omitted fields keep the value from `base` (so partial updates work).
 * Returns { errors: {field: message}, value: fullSettings }. Nothing should be saved when `errors` is not empty.
 */
function validateRetryConfig(body = {}, base = DEFAULTS) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {};
  const value = {};
  for (const k of Object.keys(DEFAULTS)) value[k] = base[k] === undefined ? DEFAULTS[k] : base[k];
  const given = (k) => b[k] !== undefined && b[k] !== null && b[k] !== '';

  for (const k of Object.keys(DEFAULTS)) {
    if (!given(k)) continue;
    const [min, max] = LIMITS[k];
    const integer = k !== 'backoffMultiplier';
    if (!isNum(b[k])) errors[k] = `${LABELS[k]} must be a number`;
    else if (integer && !Number.isInteger(Number(b[k]))) errors[k] = `${LABELS[k]} must be a whole number`;
    else if (Number(b[k]) < min || Number(b[k]) > max) errors[k] = `${LABELS[k]} must be between ${min} and ${max}`;
    else value[k] = Number(b[k]);
  }
  if (!errors.maxDelayMs && !errors.initialDelayMs && value.maxDelayMs < value.initialDelayMs) {
    errors.maxDelayMs = 'Maximum retry delay must be greater than or equal to the initial retry delay';
  }
  return { errors, value };
}

module.exports = { validateRetryConfig, DEFAULTS, LIMITS };
