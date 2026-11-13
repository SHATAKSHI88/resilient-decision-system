const RetryConfig = require('../models/RetryConfig');
const { DEFAULTS } = require('../validators/retryValidator');

const NAME = 'default';
const pick = (d) => ({ maxAttempts: d.maxAttempts, initialDelayMs: d.initialDelayMs, backoffMultiplier: d.backoffMultiplier, maxDelayMs: d.maxDelayMs });

async function getRetryConfig() {
  const doc = await RetryConfig.findOne({ name: NAME });
  return doc ? { ...DEFAULTS, ...pick(doc), updatedAt: doc.updatedAt } : { ...DEFAULTS };
}

async function saveRetryConfig(value) {
  const apply = async () => {
    const doc = await RetryConfig.findOne({ name: NAME });
    if (!doc) return null;
    doc.set(value);
    await doc.save();
    return doc;
  };
  let doc = await apply();
  if (!doc) {
    try { doc = await RetryConfig.create({ name: NAME, ...value }); } catch (err) {
      if (err && err.code === 11000) doc = await apply(); // a concurrent save created it first
      else throw err;
    }
  }
  return { ...pick(doc), updatedAt: doc.updatedAt };
}

module.exports = { NAME, getRetryConfig, saveRetryConfig };
