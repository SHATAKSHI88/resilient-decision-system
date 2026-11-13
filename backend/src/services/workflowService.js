const WorkflowExecution = require('../models/WorkflowExecution');
const WorkflowRequest = require('../models/WorkflowRequest');
const WorkflowDefinition = require('../models/WorkflowDefinition');
const { validateRequestBody } = require('../validators/requestValidator');
const { validateWorkflow } = require('../validators/workflowValidator');
const { createRulesEngine } = require('../rulesEngine');
const { transitionStatus } = require('./statusTransitions');
const { ALWAYS } = require('./workflowConfig');
const { DependencyError, verifyApplicant } = require('./externalDependency');
const retryPolicy = require('./retryPolicy');
const { getRetryConfig } = require('./retryConfig');
const { DEFAULTS: RETRY_DEFAULTS } = require('../validators/retryValidator');

// Decision rules come from MongoDB via the Rules Engine; stages/transitions come from the stored workflow.
let rulesEngine = createRulesEngine();
const setRulesEngine = (engine) => { rulesEngine = engine; }; // test hook
const DEFAULT_OUTCOME = 'MANUAL_REVIEW'; // safe fallback when no rule decides
const MAX_STEPS = 50; // guards against looping configurations

/**
 * Handlers are keyed by stage TYPE (not stage ID), so stages can be renamed/reordered in configuration.
 * Each receives the shared ctx { request, evaluation } and returns { result, outcome? }.
 * `outcome` (APPROVED | REJECTED | MANUAL_REVIEW) selects the outgoing transition; without it the ALWAYS transition is used.
 */
const stageHandlers = {
  RECEIVE: async ({ request }) => ({ result: { message: 'Request received', requestId: request.requestId } }),

  VALIDATION: async ({ request }) => {
    const { errors } = validateRequestBody(request);
    if (Object.keys(errors).length) throw new Error(`Validation failed: ${Object.values(errors).join('; ')}`);
    return { result: { message: 'Request data is valid' } };
  },

  // Calls the (simulated) external verification service. A FAILURE/TIMEOUT throws DependencyError: the run stops here, the request
  // becomes FAILED and no decision is recorded. Place this stage BEFORE the DECISION stage so nothing is decided unverified.
  VERIFICATION: async ({ request, stage }) => {
    const call = await verifyApplicant({ requestId: request.requestId, stageId: stage.stageId });
    if (call.status !== 'SUCCESS') throw new DependencyError(call.status, call.dependency, call.error, call);
    return { result: { message: 'Applicant verified', dependency: call.dependency, status: call.status, durationMs: call.durationMs, attempt: call.attempt, reference: call.response && call.response.reference } };
  },

  EVALUATION: async (ctx) => {
    const { request } = ctx;
    ctx.evaluation = await rulesEngine.evaluate(
      { age: request.age, creditScore: request.creditScore, monthlyIncome: request.monthlyIncome, loanAmount: request.loanAmount, employmentType: request.employmentType },
      { workflowKey: request.workflowKey, defaultOutcome: DEFAULT_OUTCOME }
    );
    request.evaluationTrace = ctx.evaluation.trace; // persisted with the request (and in this stage's history record)
    return {
      outcome: ctx.evaluation.outcome,
      result: {
        message: 'Evaluation complete', outcome: ctx.evaluation.outcome, reason: ctx.evaluation.reason,
        decidedByRuleId: ctx.evaluation.decidedByRuleId, defaultApplied: ctx.evaluation.defaultApplied, trace: ctx.evaluation.trace,
      },
    };
  },

  DECISION: async ({ request, evaluation }) => {
    if (!evaluation || !evaluation.outcome) throw new Error('DECISION stage reached without an evaluation outcome (workflow needs an EVALUATION stage before DECISION)');
    transitionStatus(request, evaluation.outcome);
    request.decision = { outcome: evaluation.outcome, reason: evaluation.reason, ruleId: evaluation.decidedByRuleId || undefined, decidedAt: new Date() };
    return { outcome: evaluation.outcome, result: { message: 'Decision recorded', outcome: evaluation.outcome, reason: evaluation.reason } };
  },

  COMPLETE: async ({ request }) => {
    request.completedAt = new Date();
    return { result: { message: 'Workflow completed', finalStatus: request.status } };
  },
};

/** Picks the outgoing transition: exact outcome match first, then ALWAYS. Returns undefined if none. */
function selectTransition(workflow, stageId, outcome) {
  const out = workflow.transitions.filter((t) => t.from === stageId);
  return (outcome && out.find((t) => t.outcome === outcome)) || out.find((t) => t.outcome === ALWAYS);
}

/** Loads and validates the enabled workflow for a key. Throws a clear Error if missing or invalid. */
async function loadWorkflow(workflowKey) {
  const found = await WorkflowDefinition.find({ key: workflowKey, enabled: true }).sort({ updatedAt: -1 }).lean();
  const wf = found && found[0];
  if (!wf) throw new Error(`No enabled workflow found for "${workflowKey}"`);
  const { errors, value } = validateWorkflow(wf);
  if (Object.keys(errors).length) throw new Error(`Workflow "${workflowKey}" configuration is invalid: ${Object.values(errors).join('; ')}`);
  return { ...value, _id: wf._id };
}

async function recordStage(request, stage, stageStatus, startedAt, result, attempt = 0) {
  await WorkflowExecution.create({ requestId: request.requestId, stage, stageStatus, startedAt, completedAt: new Date(), result, attempt });
}

// A missing/unreadable retry configuration must never stop a failure from being recorded: fall back to the defaults.
async function currentRetryConfig() {
  try { return await getRetryConfig(); } catch (e) { return { ...RETRY_DEFAULTS }; }
}

async function failRequest(request, message, err) {
  const isDependency = err instanceof DependencyError;
  console.error(`[workflow] ${request.requestId} failed at ${request.currentStage}:`, message);
  request.executionState = 'FAILED'; // always leave the RUNNING state, even if the status can no longer change
  request.executionError = message;
  request.failure = { kind: isDependency ? `DEPENDENCY_${err.kind}` : 'WORKFLOW_ERROR', dependency: isDependency ? err.dependency : undefined, message, at: new Date() };
  try {
    transitionStatus(request, 'FAILED');
    request.decision = { reason: `Workflow failed at ${request.currentStage}: ${message}${isDependency ? ' No approval or rejection was made.' : ''}`, decidedAt: new Date() };
  } catch (e) { /* a decision was already recorded; keep that status */ }
  // Phase 9: decide whether (and when) this failure is retried. Temporary dependency errors are scheduled with exponential
  // backoff; permanent failures are marked NOT_RETRYABLE; the running retry attempt (if this was one) is closed.
  request.failure.retryable = retryPolicy.isTemporaryFailure(request.failure) && request.status === 'FAILED';
  retryPolicy.applyFailure(request, await currentRetryConfig());
  try {
    await request.save();
  } catch (saveErr) {
    console.error('[workflow] could not record failure:', saveErr.message);
  }
}

/**
 * Atomically claims a request for execution: only one caller can move it from PENDING/PENDING to PROCESSING/RUNNING.
 * Returns the claimed document, or null if somebody else already claimed (or finished) it.
 */
function claimExecution(request) {
  return WorkflowRequest.findOneAndUpdate(
    // `null` also matches documents created before Phase 7 that have no executionState field
    { requestId: request.requestId, status: 'PENDING', executionState: { $in: ['PENDING', null] } },
    { $set: { status: 'PROCESSING', executionState: 'RUNNING', executionStartedAt: new Date() } },
    { new: true }
  );
}

/**
 * Executes stages starting at `startStage` and follows stored transitions to a COMPLETE stage. Persists the request after each
 * stage, plus one WorkflowExecution record per stage. Throws on any failure (the caller marks the request FAILED).
 * `attempt` is 0 for the original run and n for the n-th retry; it is stored on every history record.
 */
async function runStages(request, workflow, ctx, startStage, attempt) {
  const byId = Object.fromEntries(workflow.stages.map((s) => [s.stageId, s]));
  let stage = startStage;
  for (let step = 0; stage; step++) {
    if (step >= MAX_STEPS) throw new Error(`Workflow exceeded ${MAX_STEPS} steps (possible loop)`);
    const startedAt = new Date();
    request.currentStage = stage.stageId;
    ctx.stage = stage;
    const entry = { stageId: stage.stageId, stageName: stage.name, type: stage.type, status: 'COMPLETED', startedAt, attempt };
    let out;
    try {
      const handler = stageHandlers[stage.type];
      if (!handler) throw new Error(`No handler for stage type "${stage.type}"`);
      out = await handler(ctx);
    } catch (err) {
      await recordStage(request, stage.stageId, 'FAILED', startedAt, err instanceof DependencyError ? { error: err.message, dependency: err.dependency, dependencyStatus: err.kind } : { error: err.message }, attempt);
      request.stageHistory.push({ ...entry, status: 'FAILED', error: err.message, completedAt: new Date() });
      throw err;
    }
    let next = null;
    if (stage.type !== 'COMPLETE') {
      const t = selectTransition(workflow, stage.stageId, out.outcome);
      if (!t) {
        const msg = `No transition from stage "${stage.stageId}" for outcome ${out.outcome || ALWAYS}`;
        await recordStage(request, stage.stageId, 'FAILED', startedAt, { error: msg }, attempt);
        request.stageHistory.push({ ...entry, status: 'FAILED', outcome: out.outcome, error: msg, completedAt: new Date() });
        throw new Error(msg);
      }
      next = byId[t.to];
    }
    request.stageHistory.push({ ...entry, outcome: out.outcome, nextStageId: next ? next.stageId : undefined, completedAt: new Date() });
    await request.save();
    await recordStage(request, stage.stageId, 'COMPLETED', startedAt, out.result, attempt);
    stage = next;
  }
}

/**
 * Runs the enabled workflow for a saved request, at most once. Safe to call repeatedly / concurrently: the atomic claim
 * lets exactly one caller execute; the others get { executed: false } with the current document and never touch
 * stageHistory. executionState becomes COMPLETED only after the final stage has been saved.
 * Starts at the RECEIVE stage. Never throws for workflow failures: the request is marked FAILED.
 * A FAILED request is NOT re-run by this function; retrying goes through services/retryService.js (-> resumeWorkflow).
 * @returns {Promise<{ request: object, executed: boolean }>}
 */
async function runWorkflow(original) {
  const request = await claimExecution(original);
  if (!request) {
    const current = await WorkflowRequest.findOne({ requestId: original.requestId });
    return { request: current || original, executed: false };
  }
  const ctx = { request, evaluation: null };
  if (!request.stageHistory) request.stageHistory = [];
  let workflow;
  try {
    workflow = await loadWorkflow(request.workflowKey);
  } catch (err) {
    request.currentStage = 'WORKFLOW_LOAD';
    try { await recordStage(request, 'WORKFLOW_LOAD', 'FAILED', new Date(), { error: err.message }); } catch (e) { /* history is best effort here */ }
    await failRequest(request, err.message);
    return { request, executed: true };
  }

  try {
    await runStages(request, workflow, ctx, workflow.stages.find((s) => s.type === 'RECEIVE'), 0);
    request.executionState = 'COMPLETED'; // only now is the request "processed"
    await request.save();
  } catch (err) {
    await failRequest(request, err.message, err);
  }
  return { request, executed: true };
}

/** Where a retry continues: the stage that failed, or the stage after the last completed one. null = nothing left to run. */
function resumePoint(request, workflow) {
  const hist = request.stageHistory || [];
  const last = hist[hist.length - 1];
  if (!last) return workflow.stages.find((s) => s.type === 'RECEIVE');
  const id = last.status === 'FAILED' ? last.stageId : last.nextStageId;
  if (!id) return null;
  const stage = workflow.stages.find((s) => s.stageId === id);
  if (!stage) throw new Error(`Cannot resume: stage "${id}" no longer exists in workflow "${workflow.key}"`);
  return stage;
}

/** Rebuilds the evaluation result of an earlier, already completed EVALUATION stage so a later DECISION stage can use it. */
async function rehydrateEvaluation(request, workflow) {
  const evalIds = workflow.stages.filter((s) => s.type === 'EVALUATION').map((s) => s.stageId);
  const done = (await WorkflowExecution.find({ requestId: request.requestId })).filter((x) => evalIds.includes(x.stage) && x.stageStatus === 'COMPLETED');
  const r = done.length && done[done.length - 1].result;
  return r && r.outcome ? { outcome: r.outcome, reason: r.reason, decidedByRuleId: r.decidedByRuleId, defaultApplied: r.defaultApplied, trace: r.trace } : null;
}

/**
 * Continues a request that was claimed for retry by services/retryService.js (status PROCESSING, retry.state IN_PROGRESS).
 * Resumes at the stage that failed: stages that already completed are NOT executed again, so stageHistory and the stage
 * records are never duplicated; the failed stage gets one new entry (attempt = retry number). Never throws for workflow failures.
 * @returns {Promise<{ request: object, succeeded: boolean }>}
 */
async function resumeWorkflow(request) {
  if (!request.stageHistory) request.stageHistory = [];
  const attempt = (request.retry && request.retry.count) || 1;
  let workflow;
  try {
    workflow = await loadWorkflow(request.workflowKey);
  } catch (err) {
    request.currentStage = 'WORKFLOW_LOAD';
    await failRequest(request, err.message);
    return { request, succeeded: false };
  }
  try {
    const start = resumePoint(request, workflow);
    const ctx = { request, evaluation: start ? await rehydrateEvaluation(request, workflow) : null };
    if (start) await runStages(request, workflow, ctx, start, attempt);
    request.executionState = 'COMPLETED';
    request.failure = undefined; // recovered: the failure now lives only in retry.lastError / retry.history
    request.executionError = undefined;
    retryPolicy.applySuccess(request);
    await request.save();
    return { request, succeeded: true };
  } catch (err) {
    await failRequest(request, err.message, err);
    return { request, succeeded: false };
  }
}

/** Backwards-compatible wrapper: returns the request document (claimed + executed, or current if already claimed). */
async function executeWorkflow(request) {
  return (await runWorkflow(request)).request;
}

module.exports = { executeWorkflow, runWorkflow, resumeWorkflow, setRulesEngine, selectTransition, loadWorkflow };
