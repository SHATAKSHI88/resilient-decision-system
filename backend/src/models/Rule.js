const mongoose = require('mongoose');
const { OPERATORS, ACTIONS, GROUP_LOGICS, CONTINUE } = require('../rulesEngine/constants');

const ruleSchema = new mongoose.Schema(
  {
    ruleId: { type: String, required: true, unique: true, trim: true },
    workflowKey: { type: String, default: 'loan-approval', index: true },
    ruleName: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    field: { type: String, required: true, trim: true },
    operator: { type: String, enum: OPERATORS, required: true },
    expectedValue: { type: mongoose.Schema.Types.Mixed, required: true }, // number | string | boolean | array (IN / NOT_IN)
    priority: { type: Number, required: true, min: 1 }, // lower number runs first
    enabled: { type: Boolean, default: true },
    onPass: { type: String, enum: ACTIONS, default: CONTINUE },
    onFail: { type: String, enum: ACTIONS, default: CONTINUE },
    // Optional AND/OR grouping: rules with the same groupId are evaluated as one unit.
    groupId: { type: String, trim: true },
    groupLogic: { type: String, enum: GROUP_LOGICS },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model('Rule', ruleSchema);
