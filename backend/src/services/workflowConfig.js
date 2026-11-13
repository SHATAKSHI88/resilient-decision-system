// Vocabulary for configurable workflows. Stage *types* map to handlers in workflowService; stage IDs are free-form.
const STAGE_TYPES = ['RECEIVE', 'VALIDATION', 'VERIFICATION', 'EVALUATION', 'DECISION', 'COMPLETE'];
const DECISION_OUTCOMES = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
const ALWAYS = 'ALWAYS'; // transition taken whatever the stage outcome is (used when no specific outcome matches)
const TRANSITION_OUTCOMES = [ALWAYS, ...DECISION_OUTCOMES];

module.exports = { STAGE_TYPES, DECISION_OUTCOMES, ALWAYS, TRANSITION_OUTCOMES };
