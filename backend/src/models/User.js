const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    role: { type: String, enum: ['admin', 'reviewer', 'analyst', 'viewer'], default: 'viewer' },
    isActive: { type: Boolean, default: true },
    // Extensibility hook for later phases (permissions, preferences, ...)
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
