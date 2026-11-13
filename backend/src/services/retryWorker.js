const env = require('../config/env');
const { dbState } = require('../config/db');
const { recoverInterrupted, processDueRetries } = require('./retryService');

/**
 * Background retry worker: no queue, no Redis. It simply polls MongoDB every `intervalMs`:
 *   1. recoverInterrupted(): puts retries whose lease expired (process died mid-retry) back on the schedule
 *   2. processDueRetries(): starts every retry whose nextRetryAt has passed
 * All retry state (count, nextRetryAt, history) lives on the request document, so nothing is lost on restart: the first tick after
 * start-up picks up whatever became due while the app was down. Ticks never overlap inside one process, and the atomic claim in
 * retryService makes concurrent ticks / manual retries / even a second process safe (only one can claim a request).
 */
function createRetryWorker({ intervalMs = env.retryPollIntervalMs, enabled = env.retryWorkerEnabled } = {}) {
  let timer = null;
  let inFlight = null;
  const status = { lastTickAt: null, lastResult: null, lastError: null, ticks: 0 };

  async function tick() {
    if (inFlight) return { skipped: 'tick already running' }; // never overlap
    if (dbState() !== 'connected') return { skipped: 'database not connected' };
    inFlight = (async () => {
      try {
        const recovered = await recoverInterrupted();
        const summary = await processDueRetries();
        status.lastResult = { recovered, ...summary };
        status.lastError = null;
      } catch (err) {
        status.lastError = err.message;
        console.error('[retry] worker tick failed:', err.message);
      } finally {
        status.lastTickAt = new Date();
        status.ticks += 1;
      }
      return status.lastResult;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }

  function start() {
    if (!enabled) { console.log('[retry] worker disabled (RETRY_WORKER_ENABLED=false); scheduled retries will not run automatically'); return false; }
    if (timer) return true;
    tick(); // pick up retries that became due while the app was down
    timer = setInterval(tick, intervalMs);
    timer.unref(); // never keeps the process alive on its own
    console.log(`[retry] worker started (polling every ${intervalMs} ms)`);
    return true;
  }

  /** Stops polling and waits for a tick that is already running. */
  async function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (inFlight) await inFlight.catch(() => {});
  }

  const getStatus = () => ({ enabled, running: !!timer, intervalMs, ...status });
  return { start, stop, tick, getStatus };
}

const worker = createRetryWorker();

module.exports = { createRetryWorker, worker };
