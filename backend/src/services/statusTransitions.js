const STATUSES = ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'COMPLETED', 'FAILED'];

// Allowed status changes. Anything not listed is rejected.
const ALLOWED = {
  PENDING: ['PROCESSING', 'FAILED'],
  PROCESSING: ['APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'FAILED'],
  APPROVED: ['COMPLETED'],
  REJECTED: ['COMPLETED'],
  MANUAL_REVIEW: ['COMPLETED'],
  COMPLETED: [],
  FAILED: ['PROCESSING'], // Phase 9: only a retry can leave FAILED (services/retryService.js claims the request atomically)
};

const canTransition = (from, to) => (ALLOWED[from] || []).includes(to);

/** Sets doc.status = to, or throws if the transition is not allowed. */
function transitionStatus(doc, to) {
  if (!canTransition(doc.status, to)) throw new Error(`Invalid status transition: ${doc.status} -> ${to}`);
  doc.status = to;
}

module.exports = { STATUSES, ALLOWED, canTransition, transitionStatus };
