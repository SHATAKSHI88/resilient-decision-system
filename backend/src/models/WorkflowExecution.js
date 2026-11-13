const mongoose = require('mongoose');

// One document per completed workflow stage of a request.
const workflowExecutionSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, index: true },
    stage: { type: String, required: true },
    stageStatus: { type: String, enum: ['COMPLETED', 'FAILED'], required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
    attempt: { type: Number }, // Phase 9: 0 = original run, n = n-th retry
    result: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WorkflowExecution', workflowExecutionSchema);
