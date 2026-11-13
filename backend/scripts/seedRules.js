// Usage: npm run seed:rules          (seed only if the rules collection is empty)
//        npm run seed:rules -- --force (replace all rules with the defaults)
const mongoose = require('mongoose');
const { mongoUri } = require('../src/config/env');
const { seedDefaultRules } = require('../src/services/ruleSeeder');

(async () => {
  if (!mongoUri) { console.error('MONGODB_URI is not set'); process.exit(1); }
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  const r = await seedDefaultRules({ force: process.argv.includes('--force') });
  console.log(r.skipped ? 'Rules already exist - nothing seeded (use --force to reset).' : `Seeded ${r.seeded} rules.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
