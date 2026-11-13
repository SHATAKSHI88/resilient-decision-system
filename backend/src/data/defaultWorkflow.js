// Seed workflow = the Phase 4/5 process. Stored in MongoDB; edit via /api/workflows or the Workflows page.
module.exports = {
  key: 'loan-approval',
  name: 'Loan Approval',
  description: 'Default loan application workflow: validate, verify with the external service, evaluate with the Rules Engine, decide, complete.',
  enabled: true,
  stages: [
    { stageId: 'REQUEST_RECEIVED', name: 'Request Received', type: 'RECEIVE', description: 'Request accepted into the workflow' },
    { stageId: 'VALIDATION', name: 'Validation', type: 'VALIDATION', description: 'Validate application data' },
    { stageId: 'EXTERNAL_VERIFICATION', name: 'External Verification', type: 'VERIFICATION', description: 'Verify the applicant with the external verification service' },
    { stageId: 'INITIAL_EVALUATION', name: 'Initial Evaluation', type: 'EVALUATION', description: 'Evaluate configured rules' },
    { stageId: 'DECISION', name: 'Decision', type: 'DECISION', description: 'Record the decision and set the status' },
    { stageId: 'COMPLETED', name: 'Completed', type: 'COMPLETE', description: 'Workflow finished' },
  ],
  transitions: [
    { from: 'REQUEST_RECEIVED', to: 'VALIDATION', outcome: 'ALWAYS' },
    { from: 'VALIDATION', to: 'EXTERNAL_VERIFICATION', outcome: 'ALWAYS' },
    { from: 'EXTERNAL_VERIFICATION', to: 'INITIAL_EVALUATION', outcome: 'ALWAYS' },
    { from: 'INITIAL_EVALUATION', to: 'DECISION', outcome: 'ALWAYS' },
    { from: 'DECISION', to: 'COMPLETED', outcome: 'APPROVED' },
    { from: 'DECISION', to: 'COMPLETED', outcome: 'REJECTED' },
    { from: 'DECISION', to: 'COMPLETED', outcome: 'MANUAL_REVIEW' },
  ],
};
