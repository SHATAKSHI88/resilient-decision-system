require('dotenv').config();

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || '',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // Phase 9: in-process retry worker (polls MongoDB; no queue). Retry *policy* (attempts/delays) lives in MongoDB, not here.
  retryWorkerEnabled: String(process.env.RETRY_WORKER_ENABLED || 'true').toLowerCase() !== 'false',
  retryPollIntervalMs: int(process.env.RETRY_POLL_INTERVAL_MS, 5000), // how often the worker looks for due retries
  retryBatchSize: int(process.env.RETRY_BATCH_SIZE, 10), // max retries started per poll
  retryLockMs: int(process.env.RETRY_LOCK_MS, 120000), // a running retry that has not finished after this long is treated as interrupted
};
