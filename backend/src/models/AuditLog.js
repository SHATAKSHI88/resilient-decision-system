const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, index: true },
    action: { type: String, required: true },
    previousState: { type: String, default: null },
    newState: { type: String, default: null },
    description: { type: String, default: '' },
    actor: { type: String, default: 'system' },
    details: { type: mongoose.Schema.Types.Mixed, default: {} }, // rule trace etc. in later phases
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
