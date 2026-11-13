const AuditLog = require('../models/AuditLog');
const { dbState } = require('../config/db');
const sample = require('../data/sampleData');
const asyncHandler = require('../middleware/asyncHandler');

exports.listAuditLogs = asyncHandler(async (req, res) => {
  const { requestId } = req.query;
  if (dbState() === 'connected') {
    const items = await AuditLog.find(requestId ? { requestId } : {}).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ success: true, meta: { source: 'database' }, data: items });
  }
  const items = requestId ? sample.auditLogs.filter((l) => l.requestId === requestId) : sample.auditLogs;
  res.json({ success: true, meta: { source: 'sample' }, data: items });
});
