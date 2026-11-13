const { STAGE_TYPES, DECISION_OUTCOMES, TRANSITION_OUTCOMES, ALWAYS } = require('../services/workflowConfig');

const ID_RE = /^[A-Za-z0-9_-]{2,50}$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Validates a workflow definition (structure + graph sanity). Returns { errors, value }.
 * Error keys are field paths such as "name", "stages[1].stageId", "transitions[0].to".
 * Also used at runtime so a hand-edited / corrupt definition in MongoDB is rejected before it runs.
 */
function validateWorkflow(body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {};

  const key = str(b.key);
  if (!key) errors.key = 'Workflow key is required';
  else if (!ID_RE.test(key)) errors.key = 'Workflow key must be 2-50 characters: letters, numbers, - or _';

  const name = str(b.name);
  if (!name) errors.name = 'Workflow name is required';
  else if (name.length < 2 || name.length > 100) errors.name = 'Workflow name must be 2-100 characters';

  let description = '';
  if (b.description !== undefined && b.description !== null && b.description !== '') {
    if (typeof b.description !== 'string') errors.description = 'Description must be text';
    else if (b.description.length > 500) errors.description = 'Description must be at most 500 characters';
    else description = b.description.trim();
  }

  let enabled = false;
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') errors.enabled = 'Enabled must be true or false';
    else enabled = b.enabled;
  }

  // ---- stages
  const stages = [];
  if (!Array.isArray(b.stages) || b.stages.length < 2) errors.stages = 'At least 2 stages are required';
  else if (b.stages.length > 30) errors.stages = 'At most 30 stages are allowed';
  else {
    const seen = new Set();
    b.stages.forEach((s, i) => {
      const p = `stages[${i}]`;
      const o = s && typeof s === 'object' ? s : {};
      const stageId = str(o.stageId);
      const sName = str(o.name);
      const type = str(o.type);
      if (!stageId) errors[`${p}.stageId`] = 'Stage ID is required';
      else if (!ID_RE.test(stageId)) errors[`${p}.stageId`] = 'Stage ID must be 2-50 characters: letters, numbers, - or _';
      else if (seen.has(stageId)) errors[`${p}.stageId`] = `Duplicate stage ID "${stageId}"`;
      else seen.add(stageId);
      if (!sName) errors[`${p}.name`] = 'Stage name is required';
      else if (sName.length > 100) errors[`${p}.name`] = 'Stage name must be at most 100 characters';
      if (!type) errors[`${p}.type`] = 'Stage type is required';
      else if (!STAGE_TYPES.includes(type)) errors[`${p}.type`] = `Stage type must be one of: ${STAGE_TYPES.join(', ')}`;
      stages.push({ stageId, name: sName, type, description: str(o.description) });
    });
    if (!Object.keys(errors).some((k) => k.startsWith('stages['))) {
      const count = (t) => stages.filter((s) => s.type === t).length;
      if (count('RECEIVE') !== 1) errors.stages = 'Exactly one RECEIVE stage (the start) is required';
      else if (count('COMPLETE') < 1) errors.stages = 'At least one COMPLETE stage (the end) is required';
    }
  }

  // ---- transitions
  const transitions = [];
  if (!Array.isArray(b.transitions) || b.transitions.length < 1) errors.transitions = 'At least 1 transition is required';
  else if (b.transitions.length > 100) errors.transitions = 'At most 100 transitions are allowed';
  else {
    const byId = Object.fromEntries(stages.map((s) => [s.stageId, s]));
    const used = new Set();
    b.transitions.forEach((t, i) => {
      const p = `transitions[${i}]`;
      const o = t && typeof t === 'object' ? t : {};
      const from = str(o.from);
      const to = str(o.to);
      const outcome = str(o.outcome) || ALWAYS;
      if (!from) errors[`${p}.from`] = 'Source stage is required';
      else if (!byId[from]) errors[`${p}.from`] = `Unknown source stage "${from}"`;
      else if (byId[from].type === 'COMPLETE') errors[`${p}.from`] = 'A COMPLETE stage cannot have outgoing transitions';
      if (!to) errors[`${p}.to`] = 'Target stage is required';
      else if (!byId[to]) errors[`${p}.to`] = `Unknown target stage "${to}"`;
      else if (byId[to].type === 'RECEIVE') errors[`${p}.to`] = 'A transition cannot go back to the RECEIVE (start) stage';
      else if (to === from) errors[`${p}.to`] = 'A transition cannot point to its own source stage';
      if (!TRANSITION_OUTCOMES.includes(outcome)) errors[`${p}.outcome`] = `Outcome must be one of: ${TRANSITION_OUTCOMES.join(', ')}`;
      else if (from) {
        const k = `${from}|${outcome}`;
        if (used.has(k)) errors[`${p}.outcome`] = `Duplicate transition from "${from}" for outcome ${outcome}`;
        used.add(k);
      }
      transitions.push({ from, to, outcome });
    });
  }

  // ---- graph checks (only when stages and transitions are individually valid)
  if (!Object.keys(errors).some((k) => k.startsWith('stages') || k.startsWith('transitions'))) {
    const out = (id) => transitions.filter((t) => t.from === id);
    for (const s of stages) {
      if (s.type === 'COMPLETE') continue;
      const list = out(s.stageId);
      if (list.length === 0) { errors.transitions = `Stage "${s.stageId}" has no outgoing transition`; break; }
      if (s.type === 'DECISION' && !list.some((t) => t.outcome === ALWAYS)) {
        const missing = DECISION_OUTCOMES.filter((o) => !list.some((t) => t.outcome === o));
        if (missing.length) { errors.transitions = `DECISION stage "${s.stageId}" needs transitions for: ${missing.join(', ')} (or an ALWAYS transition)`; break; }
      }
    }
    if (!errors.transitions) {
      const start = stages.find((s) => s.type === 'RECEIVE').stageId;
      const reached = new Set([start]);
      const queue = [start];
      while (queue.length) for (const t of out(queue.shift())) if (!reached.has(t.to)) { reached.add(t.to); queue.push(t.to); }
      const unreachable = stages.filter((s) => !reached.has(s.stageId)).map((s) => s.stageId);
      if (unreachable.length) errors.stages = `Stages not reachable from the start stage: ${unreachable.join(', ')}`;
      else if (!stages.some((s) => s.type === 'COMPLETE' && reached.has(s.stageId))) errors.stages = 'No COMPLETE stage is reachable from the start stage';
    }
  }

  return { errors, value: { key, name, description, enabled, stages, transitions } };
}

module.exports = { validateWorkflow };
