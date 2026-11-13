const { dbState } = require('../config/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { validateDependencyConfig } = require('../validators/dependencyValidator');
const dependency = require('../services/externalDependency');

const needDb = () => { if (dbState() !== 'connected') throw new ApiError(503, 'Database unavailable. Please try again later.'); };

// GET /api/dependencies/verification - settings, health summary and the latest calls
exports.getVerification = asyncHandler(async (req, res) => {
  needDb();
  res.json({ success: true, data: await dependency.getStatus() });
});

// PUT /api/dependencies/verification/config - omitted fields keep their current value
exports.updateVerificationConfig = asyncHandler(async (req, res) => {
  needDb();
  const { errors, value } = validateDependencyConfig(req.body, await dependency.getConfig());
  if (Object.keys(errors).length) throw new ApiError(400, 'Validation failed', errors);
  res.json({ success: true, message: 'Dependency settings saved', data: await dependency.saveConfig(value) });
});

// POST /api/dependencies/verification/test - makes one real call to the simulation (stored with source TEST).
// Optional body overrides the settings for this call only; nothing is saved. A failed/timed-out simulated call is still a 200:
// the endpoint worked, the result says what the dependency did.
exports.testVerification = asyncHandler(async (req, res) => {
  needDb();
  const { errors, value } = validateDependencyConfig(req.body, await dependency.getConfig());
  if (Object.keys(errors).length) throw new ApiError(400, 'Validation failed', errors);
  const call = await dependency.verifyApplicant({ source: 'TEST', config: value });
  res.json({
    success: true,
    message: call.status === 'SUCCESS' ? 'Test call succeeded' : `Test call ${call.status === 'TIMEOUT' ? 'timed out' : 'failed'}: ${call.error}`,
    data: { call },
  });
});
