const mongoose = require('mongoose');

const { STATUSES } = require('../services/statusTransitions');

const workflowRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, unique: true }, // e.g. REQ-M3K9X2-A1B2C3
    // Phase 7: client-supplied Idempotency-Key (optional) + fingerprint of the normalised payload it was first used with
    idempotencyKey: { type: String },
    payloadHash: { type: String },
    // Phase 7: execution lock/state. PENDING -> RUNNING (atomic claim) -> COMPLETED | FAILED. Only the claimer runs the workflow.
    executionState: { type: String, enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'], default: 'PENDING' },
    executionStartedAt: Date,
    executionError: String,
    workflowKey: { type: String, default: 'loan-approval' },
    workflowVersion: { type: Number, default: 1 },
    requestType: { type: String, default: 'Loan Application' },
    applicantName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    age: { type: Number, required: true, min: 1, max: 100 },
    monthlyIncome: { type: Number, required: true, min: 0 },
    employmentType: { type: String, required: true },
    creditScore: { type: Number, required: true, min: 300, max: 900 },
    loanAmount: { type: Number, required: true, min: 1 },
    description: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: STATUSES, default: 'PENDING' },
    currentStage: { type: String, default: 'REQUEST_RECEIVED' },
    decision: {
      outcome: { type: String, enum: ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'] },
      reason: String,
      ruleId: String, // rule (or rule group lead) that produced the decision
      decidedAt: Date,
    },
    // One entry per evaluated rule (Phase 5 Rules Engine trace)
    evaluationTrace: [
      new mongoose.Schema(
        {
          ruleId: String, ruleName: String, field: String, actualValue: mongoose.Schema.Types.Mixed,
          operator: String, expectedValue: mongoose.Schema.Types.Mixed, result: String, actionTriggered: String,
          priority: Number, groupId: String, groupResult: String, note: String, evaluatedAt: Date,
        },
        { _id: false }
      ),
    ],
    // Phase 6: one entry per executed stage of the configured workflow, in order
    stageHistory: [
      new mongoose.Schema(
        {
          stageId: String, stageName: String, type: String, status: String, outcome: String,
          nextStageId: String, error: String, startedAt: Date, completedAt: Date,
          attempt: Number, // Phase 9: 0 = original run, n = n-th retry
        },
        { _id: false }
      ),
    ],
    // Phase 8: why the request ended in FAILED. kind: DEPENDENCY_FAILURE | DEPENDENCY_TIMEOUT | WORKFLOW_ERROR
    // retryable (Phase 9): true for temporary dependency errors (see services/retryPolicy.js)
    failure: { kind: String, dependency: String, message: String, at: Date, retryable: Boolean },
    // Phase 9: retry bookkeeping. count = retries started (automatic + manual); the worker polls nextRetryAt; lockedUntil is the
    // lease of a running retry (an expired lease means the process died mid-retry, see services/retryService.js).
    retry: {
      state: { type: String, enum: ['SCHEDULED', 'IN_PROGRESS', 'EXHAUSTED', 'NOT_RETRYABLE', 'RECOVERED'] },
      count: { type: Number, default: 0 },
      maxAttempts: Number,
      nextRetryAt: Date,
      lockedUntil: Date,
      lastError: { kind: String, message: String, at: Date, attempt: Number },
      history: [
        new mongoose.Schema(
          {
            attempt: Number, trigger: { type: String, enum: ['AUTOMATIC', 'MANUAL'] }, initiatedBy: String, scheduledFor: Date,
            startedAt: Date, completedAt: Date, outcome: { type: String, enum: ['RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED'] }, error: String,
          },
          { _id: false }
        ),
      ],
    },
    completedAt: Date,
    // Reserved for later phases
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Database-enforced uniqueness of idempotency keys (requests without a key are not indexed).
workflowRequestSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

// Phase 9: lets the retry worker find due retries without scanning the collection.
workflowRequestSchema.index({ 'retry.state': 1, 'retry.nextRetryAt': 1 });

workflowRequestSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('WorkflowRequest', workflowRequestSchema);
