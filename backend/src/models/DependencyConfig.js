const mongoose = require('mongoose');

// Settings of a simulated external dependency (one document per dependency name). Missing document = built-in defaults.
const dependencyConfigSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }, // e.g. verification-service
    outcome: { type: String, enum: ['SUCCESS', 'FAILURE', 'TIMEOUT'], default: 'SUCCESS' },
    delayMs: { type: Number, default: 0, min: 0 }, // simulated response time
    timeoutMs: { type: Number, default: 3000, min: 1 }, // the caller gives up after this long
    failureProbability: { type: Number, default: 0, min: 0, max: 1 }, // chance that an otherwise-SUCCESS call fails
  },
  { timestamps: true }
);

module.exports = mongoose.model('DependencyConfig', dependencyConfigSchema);
