const WorkflowDefinition = require('../models/WorkflowDefinition');
const defaultWorkflow = require('../data/defaultWorkflow');

/** Inserts the default workflow. force=true replaces it; otherwise only seeds an empty collection. */
async function seedDefaultWorkflow({ force = false } = {}) {
  if (force) await WorkflowDefinition.deleteMany({});
  else if ((await WorkflowDefinition.countDocuments()) > 0) return { seeded: 0, skipped: true };
  await WorkflowDefinition.create(defaultWorkflow);
  return { seeded: 1, skipped: false };
}

module.exports = { seedDefaultWorkflow };
