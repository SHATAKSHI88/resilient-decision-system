const app = require('./app');
const { port } = require('./config/env');
const { connectDB } = require('./config/db');

// Start listening immediately; connect to MongoDB in the background so a slow or
// unreachable database never delays the API (health endpoint reports the real state).
const server = app.listen(port, () => console.log(`[server] API listening on http://localhost:${port}/api`));
const { worker: retryWorker } = require('./services/retryWorker');
connectDB().then(async (ok) => {
  if (!ok) return;
  try {
    // Build the unique idempotency-key index before relying on it (Mongoose builds indexes in the background otherwise).
    await require('./models/WorkflowRequest').init();
    console.log('[db] request indexes ready (idempotency-key uniqueness enforced)');
  } catch (err) { console.error('[db] could not build request indexes - idempotency uniqueness is NOT enforced:', err.message); }
  try {
    // First run: seed the default rules if the collection is empty (never overwrites existing rules).
    const r = await require('./services/ruleSeeder').seedDefaultRules();
    if (!r.skipped) console.log(`[rules] seeded ${r.seeded} default rules`);
  } catch (err) { console.error('[rules] seeding failed:', err.message); }
  try {
    const w = await require('./services/workflowSeeder').seedDefaultWorkflow();
    if (!w.skipped) console.log('[workflow] seeded the default workflow');
  } catch (err) { console.error('[workflow] seeding failed:', err.message); }
  // Phase 9: start the retry worker last, so the schema/indexes are ready. It immediately picks up retries that came due while the app was down.
  retryWorker.start();
});

// Stop polling and let a running tick finish before exiting.
const shutdown = (signal) => {
  console.log(`[server] ${signal} received, shutting down`);
  retryWorker.stop().finally(() => server.close(() => process.exit(0)));
};
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
