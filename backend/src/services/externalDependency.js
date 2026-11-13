const crypto = require('crypto');
const DependencyConfig = require('../models/DependencyConfig');
const DependencyCall = require('../models/DependencyCall');
const { DEFAULTS } = require('../validators/dependencyValidator');

/**
 * Local simulation of an external applicant-verification API. Nothing leaves the process.
 * Behaviour comes from the settings stored in MongoDB (see validators/dependencyValidator.js):
 *   outcome SUCCESS  -> answers after delayMs; fails anyway with probability failureProbability
 *   outcome FAILURE  -> answers after delayMs with an error
 *   outcome TIMEOUT  -> never answers; the caller gives up after timeoutMs
 *   delayMs > timeoutMs -> also a TIMEOUT (a response that is too slow is no response)
 * Every call is stored as a DependencyCall (status, error, durationMs, attemptedAt).
 */
const NAME = 'verification-service';

class DependencyError extends Error {
  constructor(kind, dependency, message, call) {
    super(message);
    this.name = 'DependencyError';
    this.kind = kind; // FAILURE | TIMEOUT
    this.dependency = dependency;
    this.call = call;
  }
}

// Test hooks: lets tests run instantly and deterministically.
const hooks = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: Math.random, now: () => Date.now() };
const setHooks = (h) => Object.assign(hooks, h);

const pickConfig = (d) => ({ outcome: d.outcome, delayMs: d.delayMs, timeoutMs: d.timeoutMs, failureProbability: d.failureProbability });

async function getConfig() {
  const doc = await DependencyConfig.findOne({ name: NAME });
  return doc ? { ...DEFAULTS, ...pickConfig(doc), updatedAt: doc.updatedAt } : { ...DEFAULTS };
}

async function saveConfig(value) {
  const apply = async () => {
    const doc = await DependencyConfig.findOne({ name: NAME });
    if (!doc) return null;
    doc.set(value);
    await doc.save();
    return doc;
  };
  let doc = await apply();
  if (!doc) {
    try { doc = await DependencyConfig.create({ name: NAME, ...value }); } catch (err) {
      if (err && err.code === 11000) doc = await apply(); // a concurrent save created it first
      else throw err;
    }
  }
  return { ...pickConfig(doc), updatedAt: doc.updatedAt };
}

async function simulate(cfg) {
  if (cfg.outcome === 'TIMEOUT' || cfg.delayMs > cfg.timeoutMs) {
    await hooks.sleep(cfg.timeoutMs);
    return { status: 'TIMEOUT', error: `${NAME} did not respond within ${cfg.timeoutMs} ms` };
  }
  await hooks.sleep(cfg.delayMs);
  const failed = cfg.outcome === 'FAILURE' || (cfg.failureProbability > 0 && hooks.random() < cfg.failureProbability);
  if (failed) return { status: 'FAILURE', error: `${NAME} returned an error (simulated 503 Service Unavailable)` };
  return { status: 'SUCCESS', response: { verified: true, reference: `VER-${crypto.randomBytes(4).toString('hex').toUpperCase()}` } };
}

/**
 * Calls the simulated service once and stores the call. Never throws for a FAILURE/TIMEOUT outcome: it returns the stored
 * call so the caller decides what to do. `config` overrides the stored settings (used by the test endpoint).
 * Personal data from the applicant is not stored with the call.
 * @returns {Promise<object>} the stored DependencyCall as a plain object
 */
async function verifyApplicant({ requestId, stageId, source = 'WORKFLOW', config } = {}) {
  const cfg = config || (await getConfig());
  const attemptedAt = new Date(hooks.now());
  const started = hooks.now();
  const out = await simulate(cfg);
  const durationMs = Math.max(0, hooks.now() - started);
  let attempt = 1;
  if (requestId) attempt = (await DependencyCall.find({ requestId, stageId })).length + 1;
  const call = await DependencyCall.create({
    dependency: NAME, ...(requestId ? { requestId } : {}), ...(stageId ? { stageId } : {}), attempt, source,
    status: out.status, error: out.error, response: out.response, durationMs, attemptedAt,
    simulation: { outcome: cfg.outcome, delayMs: cfg.delayMs, timeoutMs: cfg.timeoutMs, failureProbability: cfg.failureProbability },
  });
  return call && call.toObject ? call.toObject() : call;
}

const WINDOW = 50;
/** Current settings + a health summary built from the most recent calls. */
async function getStatus() {
  const [config, calls] = await Promise.all([
    getConfig(),
    DependencyCall.find({ dependency: NAME }).sort({ attemptedAt: -1, _id: -1 }).limit(WINDOW).lean(),
  ]);
  const counts = { total: calls.length, success: 0, failure: 0, timeout: 0 };
  calls.forEach((c) => { counts[c.status.toLowerCase()] += 1; });
  const last5 = calls.slice(0, 5);
  const bad = last5.filter((c) => c.status !== 'SUCCESS').length;
  const state = !calls.length ? 'UNKNOWN' : bad === 0 ? 'HEALTHY' : bad === last5.length ? 'DOWN' : 'DEGRADED';
  const averageDurationMs = calls.length ? Math.round(calls.reduce((s, c) => s + c.durationMs, 0) / calls.length) : null;
  return { name: NAME, state, config, counts, window: WINDOW, averageDurationMs, lastCall: calls[0] || null, recentCalls: calls.slice(0, 10) };
}

module.exports = { NAME, DependencyError, verifyApplicant, getConfig, saveConfig, getStatus, setHooks, simulate };
