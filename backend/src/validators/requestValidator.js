const EMPLOYMENT_TYPES = ['Salaried', 'Self-Employed', 'Business Owner', 'Retired', 'Unemployed'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
// Accepts numbers or numeric strings only; returns NaN otherwise.
const toNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

/**
 * Validates and normalises a submission body.
 * Returns { errors: {field: message}, value: cleanedObject }.
 */
function validateRequestBody(body = {}) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};

  const name = typeof b.applicantName === 'string' ? b.applicantName.trim() : '';
  if (!name) errors.applicantName = 'Applicant name is required';
  else if (name.length < 2 || name.length > 100) errors.applicantName = 'Name must be 2-100 characters';

  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address';

  const num = (field, label, { min, max, integer }) => {
    if (isBlank(b[field])) {
      errors[field] = `${label} is required`;
      return undefined;
    }
    const n = toNum(b[field]);
    if (!Number.isFinite(n)) errors[field] = `${label} must be a number`;
    else if (integer && !Number.isInteger(n)) errors[field] = `${label} must be a whole number`;
    else if (min !== undefined && n < min) errors[field] = `${label} must be at least ${min}`;
    else if (max !== undefined && n > max) errors[field] = `${label} must be at most ${max}`;
    else return n;
    return undefined;
  };

  const age = num('age', 'Age', { min: 1, max: 100, integer: true });
  const monthlyIncome = num('monthlyIncome', 'Monthly income', { min: 0 });
  const creditScore = num('creditScore', 'Credit score', { min: 300, max: 900, integer: true });
  const loanAmount = num('loanAmount', 'Requested loan amount', { min: 1 });

  const employmentType = typeof b.employmentType === 'string' ? b.employmentType.trim() : '';
  if (!employmentType) errors.employmentType = 'Employment type is required';
  else if (!EMPLOYMENT_TYPES.includes(employmentType)) errors.employmentType = `Employment type must be one of: ${EMPLOYMENT_TYPES.join(', ')}`;

  let description = '';
  if (!isBlank(b.description)) {
    if (typeof b.description !== 'string') errors.description = 'Description must be text';
    else if (b.description.trim().length > 1000) errors.description = 'Description must be at most 1000 characters';
    else description = b.description.trim();
  }

  return {
    errors,
    value: { applicantName: name, email, age, monthlyIncome, employmentType, creditScore, loanAmount, description },
  };
}

module.exports = { validateRequestBody, EMPLOYMENT_TYPES };
