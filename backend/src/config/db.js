const mongoose = require('mongoose');
const { mongoUri } = require('./env');

/**
 * Connects to MongoDB if MONGODB_URI is set.
 * The server keeps running without a DB so the foundation can be demoed anywhere;
 * the health endpoint reports the real connection state.
 */
async function connectDB() {
  if (!mongoUri) {
    console.warn('[db] MONGODB_URI not set - running without a database (sample data only).');
    return false;
  }
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log('[db] MongoDB connected');
    return true;
  } catch (err) {
    console.error('[db] MongoDB connection failed:', err.message);
    return false;
  }
}

const dbState = () =>
  ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ||
  'unknown';

module.exports = { connectDB, dbState };
