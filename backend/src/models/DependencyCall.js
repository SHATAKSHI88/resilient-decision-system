const mongoose = require('mongoose');

// One document per call made to an external dependency: by a workflow run (requestId set) or by the test endpoint.
const dependencyCallSchema = new mongoose.Schema(
  {
    dependency: { type: String, required: true }, // e.g. verification-service
    requestId: { type: String }, // absent for test calls
    stageId: { type: String },
    attempt: { type: Number, default: 1 }, // 1-based, per request + stage
    source: { type: String, enum: ['WORKFLOW', 'TEST'], default: 'WORKFLOW' },
    status: { type: String, enum: ['SUCCESS', 'FAILURE', 'TIMEOUT'], required: true },
    error: String,
    durationMs: { type: Number, required: true },
    attemptedAt: { type: Date, required: true },
    response: mongoose.Schema.Types.Mixed,
    simulation: mongoose.Schema.Types.Mixed, // the settings that produced this outcome
  },
  { timestamps: true }
);

// A workflow run can never store two records for the same request + stage + attempt (test calls have no requestId and are not indexed).
dependencyCallSchema.index({ requestId: 1, stageId: 1, attempt: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } });
dependencyCallSchema.index({ dependency: 1, attemptedAt: -1 });

module.exports = mongoose.model('DependencyCall', dependencyCallSchema);
