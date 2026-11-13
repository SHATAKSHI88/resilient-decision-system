const mongoose = require('mongoose');

// Retry policy (single document, name "default"). Missing document = built-in defaults (validators/retryValidator.js).
const retryConfigSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    maxAttempts: { type: Number, default: 3, min: 0, max: 10 },
    initialDelayMs: { type: Number, default: 5000, min: 100 },
    backoffMultiplier: { type: Number, default: 2, min: 1, max: 10 },
    maxDelayMs: { type: Number, default: 60000, min: 100 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RetryConfig', retryConfigSchema);
