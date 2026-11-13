// Usage: npm run seed:workflows          (seed only if the workflows collection is empty)
//        npm run seed:workflows -- --force (replace ALL workflows with the default)
const mongoose = require('mongoose');
const { mongoUri } = require('../src/config/env');
const { seedDefaultWorkflow } = require('../src/services/workflowSeeder');

(async () => {
  if (!mongoUri) { console.error('MONGODB_URI is not set'); process.exit(1); }
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  const r = await seedDefaultWorkflow({ force: process.argv.includes('--force') });
  console.log(r.skipped ? 'Workflows already exist - nothing seeded (use --force to reset).' : 'Seeded the default workflow.');
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
