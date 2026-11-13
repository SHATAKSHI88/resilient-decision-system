const Rule = require('../models/Rule');
const defaultRules = require('../data/defaultRules');

/** Inserts the default rules. force=true wipes existing rules first; otherwise only seeds an empty collection. */
async function seedDefaultRules({ force = false } = {}) {
  if (force) await Rule.deleteMany({});
  else if ((await Rule.countDocuments()) > 0) return { seeded: 0, skipped: true };
  await Rule.insertMany(defaultRules);
  return { seeded: defaultRules.length, skipped: false };
}

module.exports = { seedDefaultRules };
