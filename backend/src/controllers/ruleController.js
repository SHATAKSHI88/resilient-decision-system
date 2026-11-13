const Rule = require('../models/Rule');
const { dbState } = require('../config/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { validateRule } = require('../validators/ruleValidator');

const requireDb = () => { if (dbState() !== 'connected') throw new ApiError(503, 'Database unavailable. Please try again later.'); };
const idFilter = (id) => {
  const s = String(id).trim();
  return /^[a-f0-9]{24}$/i.test(s) ? { $or: [{ ruleId: s }, { _id: s }] } : { ruleId: s };
};
const findOr404 = async (id) => {
  const rule = await Rule.findOne(idFilter(id));
  if (!rule) throw new ApiError(404, `Rule ${id} not found`);
  return rule;
};
const plain = (doc) => { const o = doc.toObject ? doc.toObject() : doc; delete o.__v; return o; };

exports.listRules = asyncHandler(async (req, res) => {
  requireDb();
  const filter = {};
  if (req.query.enabled === 'true' || req.query.enabled === 'false') filter.enabled = req.query.enabled === 'true';
  if (typeof req.query.workflowKey === 'string' && req.query.workflowKey) filter.workflowKey = req.query.workflowKey;
  const items = await Rule.find(filter).sort({ priority: 1, ruleId: 1 }).select('-__v').lean();
  res.json({ success: true, meta: { source: 'database', total: items.length }, data: items });
});

exports.getRule = asyncHandler(async (req, res) => {
  requireDb();
  res.json({ success: true, data: plain(await findOr404(req.params.id)) });
});

exports.createRule = asyncHandler(async (req, res) => {
  requireDb();
  const { errors, value } = validateRule(req.body);
  if (Object.keys(errors).length) throw new ApiError(400, 'Validation failed', errors);
  if (await Rule.findOne({ ruleId: value.ruleId })) throw new ApiError(409, `Rule ID ${value.ruleId} already exists`, { ruleId: 'Rule ID already exists' });
  const created = await Rule.create(value);
  res.status(201).json({ success: true, message: 'Rule created', data: plain(created) });
});

// Partial updates allowed: the body is merged over the stored rule, then the whole rule is re-validated.
exports.updateRule = asyncHandler(async (req, res) => {
  requireDb();
  const rule = await findOr404(req.params.id);
  const current = plain(rule);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.ruleId !== undefined && String(body.ruleId).trim() !== current.ruleId) {
    throw new ApiError(400, 'Validation failed', { ruleId: 'Rule ID cannot be changed' });
  }
  const merged = { ...current, ...body, ruleId: current.ruleId };
  // Clearing a group: client sends groupId '' -> drop both group fields
  if (merged.groupId === '' || merged.groupId === null) { merged.groupId = ''; merged.groupLogic = ''; }
  const { errors, value } = validateRule(merged);
  if (Object.keys(errors).length) throw new ApiError(400, 'Validation failed', errors);
  rule.set(value);
  if (!value.groupId) { rule.groupId = undefined; rule.groupLogic = undefined; }
  await rule.save();
  res.json({ success: true, message: 'Rule updated', data: plain(rule) });
});

exports.deleteRule = asyncHandler(async (req, res) => {
  requireDb();
  const rule = await findOr404(req.params.id);
  await Rule.deleteOne({ _id: rule._id });
  res.json({ success: true, message: `Rule ${rule.ruleId} deleted` });
});
