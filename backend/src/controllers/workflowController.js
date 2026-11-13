const WorkflowDefinition = require('../models/WorkflowDefinition');
const { dbState } = require('../config/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { validateWorkflow } = require('../validators/workflowValidator');

const requireDb = () => { if (dbState() !== 'connected') throw new ApiError(503, 'Database unavailable. Please try again later.'); };
const idFilter = (id) => {
  const s = String(id).trim();
  return /^[a-f0-9]{24}$/i.test(s) ? { $or: [{ key: s }, { _id: s }] } : { key: s };
};
const findOr404 = async (id) => {
  const wf = await WorkflowDefinition.findOne(idFilter(id));
  if (!wf) throw new ApiError(404, `Workflow ${id} not found`);
  return wf;
};
const plain = (doc) => { const o = doc.toObject ? doc.toObject() : { ...doc }; delete o.__v; return o; };
// Only one workflow per key may be enabled: enabling one disables the others.
const disableOthers = (wf) => WorkflowDefinition.updateMany({ key: wf.key, _id: { $ne: wf._id }, enabled: true }, { $set: { enabled: false } });

exports.listWorkflows = asyncHandler(async (req, res) => {
  requireDb();
  const items = await WorkflowDefinition.find().sort({ name: 1 }).select('-__v').lean();
  res.json({ success: true, meta: { source: 'database', total: items.length }, data: items });
});

exports.getWorkflow = asyncHandler(async (req, res) => {
  requireDb();
  res.json({ success: true, data: plain(await findOr404(req.params.id)) });
});

exports.createWorkflow = asyncHandler(async (req, res) => {
  requireDb();
  const { errors, value } = validateWorkflow(req.body);
  if (Object.keys(errors).length) throw new ApiError(400, 'Validation failed', errors);
  if (await WorkflowDefinition.findOne({ key: value.key })) throw new ApiError(409, `Workflow key ${value.key} already exists`, { key: 'Workflow key already exists' });
  const created = await WorkflowDefinition.create(value);
  if (created.enabled) await disableOthers(created);
  res.status(201).json({ success: true, message: 'Workflow created', data: plain(created) });
});

// Partial updates allowed: body is merged over the stored workflow, then fully re-validated.
exports.updateWorkflow = asyncHandler(async (req, res) => {
  requireDb();
  const wf = await findOr404(req.params.id);
  const current = plain(wf);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.key !== undefined && String(body.key).trim() !== current.key) throw new ApiError(400, 'Validation failed', { key: 'Workflow key cannot be changed' });
  const { errors, value } = validateWorkflow({ ...current, ...body, key: current.key });
  if (Object.keys(errors).length) throw new ApiError(400, 'Validation failed', errors);
  wf.set(value);
  await wf.save();
  if (wf.enabled) await disableOthers(wf);
  res.json({ success: true, message: 'Workflow updated', data: plain(wf) });
});

exports.deleteWorkflow = asyncHandler(async (req, res) => {
  requireDb();
  const wf = await findOr404(req.params.id);
  if (wf.enabled) throw new ApiError(409, 'Cannot delete the active workflow. Disable it (or enable another workflow) first.');
  await WorkflowDefinition.deleteOne({ _id: wf._id });
  res.json({ success: true, message: `Workflow ${wf.key} deleted` });
});
