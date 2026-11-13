const crypto = require('crypto');

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/** Validates the Idempotency-Key header. Returns { key } (key may be null when absent) or { error }. */
function parseKey(header) {
  if (header === undefined || header === null || header === '') return { key: null };
  if (typeof header !== 'string' || !KEY_RE.test(header.trim())) {
    return { error: 'Idempotency-Key must be 8-128 characters: letters, numbers, . _ : or -' };
  }
  return { key: header.trim() };
}

const FIELDS = ['applicantName', 'email', 'age', 'monthlyIncome', 'employmentType', 'creditScore', 'loanAmount', 'description'];

/** Fingerprint of the NORMALISED payload (validator output), so "30" vs 30 or extra spaces hash the same. */
function hashPayload(value) {
  const canonical = JSON.stringify(FIELDS.map((f) => [f, value[f] === undefined ? null : value[f]]));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/** True for a Mongo duplicate-key error on the idempotencyKey index. */
const isIdempotencyDuplicate = (err) =>
  !!err && err.code === 11000 && !!((err.keyPattern && err.keyPattern.idempotencyKey) || /idempotencyKey/.test(err.message || ''));
const isRequestIdDuplicate = (err) =>
  !!err && err.code === 11000 && !isIdempotencyDuplicate(err);

/** Effective execution state, tolerant of pre-Phase-7 documents that have no executionState. */
function stateOf(doc) {
  if (doc.executionState) return doc.executionState;
  if (doc.status === 'PENDING') return 'PENDING';
  if (doc.status === 'PROCESSING') return 'RUNNING';
  return doc.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
}

module.exports = { parseKey, hashPayload, isIdempotencyDuplicate, isRequestIdDuplicate, stateOf };
