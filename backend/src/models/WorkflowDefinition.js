const mongoose = require('mongoose');
const { STAGE_TYPES, TRANSITION_OUTCOMES, ALWAYS } = require('../services/workflowConfig');

const stageSchema = new mongoose.Schema(
  {
    stageId: { type: String, required: true, trim: true }, // unique within the workflow, e.g. INITIAL_EVALUATION
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: STAGE_TYPES, required: true }, // decides which handler runs
    description: { type: String, default: '' },
  },
  { _id: false }
);

const transitionSchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    outcome: { type: String, enum: TRANSITION_OUTCOMES, default: ALWAYS }, // outcome of `from` that triggers this transition
  },
  { _id: false }
);

// Phase 6: stages and transitions are stored here and drive execution (see services/workflowService.js).
const workflowDefinitionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, unique: true }, // e.g. "loan-approval"; matches WorkflowRequest.workflowKey
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    version: { type: Number, default: 1 }, // informational only; versioning is a later phase
    enabled: { type: Boolean, default: false }, // at most one enabled workflow is used per key
    stages: { type: [stageSchema], default: [] },
    transitions: { type: [transitionSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WorkflowDefinition', workflowDefinitionSchema);
