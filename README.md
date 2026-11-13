# FlowDecide - Configurable Workflow Decision Platform

Hackathon project: **Design and Build a Resilient Decision System**.
Demo use case: Loan / Application Approval.

> **Status: Phase 9 - automatic retries with exponential backoff and manual recovery.** Stages/transitions come from MongoDB (Workflows page),
> decisions from the Rules Engine (Rules page), `POST /api/requests` accepts an `Idempotency-Key` so double clicks never create or execute
> a request twice, and a local **verification service** simulation (configurable outcome, delay, timeout, failure chance) is called
> during the workflow. If it fails or times out the request becomes `FAILED` with nothing approved or rejected; **temporary** failures are
> now retried automatically by a background worker with exponential backoff (policy stored in MongoDB), and operators can retry a failed
> request manually. No workflow versioning, circuit breakers, Redis/BullMQ or distributed scheduling. Other screens marked "Placeholder" use sample data.

## Prerequisites
- Node.js 18+ and npm
- MongoDB (required for submitting and viewing applications; the rest of the backend still starts without it)

## Install
```bash
cd backend && npm install
cd ../frontend && npm install
```

## Environment variables
`backend/.env` (copy from `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | API port |
| `NODE_ENV` | `development` | Enables stack traces on 5xx |
| `MONGODB_URI` | *(empty)* | MongoDB connection string. Required for `POST /api/requests` |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS origin of the frontend |
| `RETRY_WORKER_ENABLED` | `true` | Phase 9: set `false` to stop the in-process retry worker (scheduled retries then wait; manual retry still works) |
| `RETRY_POLL_INTERVAL_MS` | `5000` | How often the worker looks for due retries |
| `RETRY_BATCH_SIZE` | `10` | Most retries the worker starts per check |
| `RETRY_LOCK_MS` | `120000` | A running retry that has not finished after this long is treated as interrupted (see "Restarts and crashes") |

`frontend/.env` (optional, copy from `frontend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:5000/api` | Backend base URL |

## Run
```bash
# terminal 1
cd backend && cp .env.example .env && npm run dev     # http://localhost:5000/api/health

# terminal 2
cd frontend && npm run dev                            # http://localhost:5173
```
Production build check: `cd frontend && npm run build`.

## Structure
```
backend/src
  config/       env.js, db.js
  models/       User, WorkflowDefinition, WorkflowRequest, WorkflowExecution, AuditLog, Rule, DependencyConfig, DependencyCall, RetryConfig
  rulesEngine/  constants, operators, evaluator (pure), index (loads enabled rules from DB)
  validators/   requestValidator, ruleValidator, workflowValidator, dependencyValidator, retryValidator
  services/     workflowService, externalDependency (simulated verification API), retryPolicy (backoff, classification), retryConfig, retryService (claim + retry + recovery), retryWorker (polling), idempotency, workflowConfig, statusTransitions, ruleSeeder, workflowSeeder
  scripts/ (backend/)  seedRules.js, seedWorkflows.js     tests/ (backend/)  node:test suites
  controllers/  health, request, workflow, dependency, retry, audit
  routes/       index.js (mounted at /api)
  middleware/   errorHandler.js, asyncHandler.js
  data/         sampleData.js (used only when MongoDB is not connected)
  app.js, server.js
frontend/src
  components/ui/      Badge, StatusBadge, CallStatusBadge, Button, Card, Table, Pagination, PageHeader, SampleNotice
  components/         DependencyPanel (System Health: dependency status + settings), RetryPanel (Request Details), RetryConfigPanel (System Health)
  components/layout/  Sidebar, Topbar, Layout
  pages/              Rules, Workflows (configurable), Dashboard, Requests, RequestDetails, Workflows, ManualReview, AuditLogs, SystemHealth
  data/sampleData.js  ALL placeholder data for the UI
  services/api.js     Axios client
```

## API (Phase 1)
| Endpoint | Notes |
|---|---|
| `GET /api/health` | Real status, uptime and real Mongo connection state |
| `GET /api/requests`, `/api/requests/:id` | Read-only. DB if connected, else sample (`meta.source` says which) |
| `GET /api/workflows`, `/api/audit-logs` | Same behaviour |

## What is real vs placeholder
- **Real:** Express app, routing, error handling, Mongo connection, models, health endpoint,
  and the System Health page's Backend/Database tiles.
- **Placeholder:** every other value shown in the frontend (it reads `frontend/src/data/sampleData.js`,
  not the API), Approve/Reject buttons, Workflow View/Edit, dependency status, failed jobs.

## Postponed (later phases)
Rules engine and configurable workflows, workflow execution/stages, intake + schema validation,
state history, real audit trail and decision explanations, retries/idempotency/failure handling,
simulated external dependency, manual-review actions, frontend-to-API wiring, tests,
architecture document, auth.

## Submit Application API (Phase 2)
`POST /api/requests` with JSON: `applicantName`, `email`, `age` (18-100), `monthlyIncome` (>=0),
`employmentType` (Salaried | Self-Employed | Business Owner | Retired | Unemployed),
`creditScore` (300-900), `loanAmount` (>0), optional `description`.

- `201` -> `{ success, requestId, data }` (status `PENDING`)
- `400` -> `{ success:false, error:{ message, details:{ field: message } } }`
- `503` -> database not connected

UI: sidebar -> **Submit Application** (`/submit`).

## Listing and details API (Phase 3)
- `GET /api/requests?page=1&limit=10&search=&status=` - newest first. `search` matches request ID, applicant name or email (case-insensitive); `status` is an exact match (e.g. `PENDING`). Response: `{ success, meta: { page, limit, total, totalPages, hasNext, hasPrev }, data: [...] }`. `limit` is capped at 100.
- `GET /api/requests/:requestId` - full record; `404` with a message if the ID does not exist.
- Both return `503` if MongoDB is not connected.

UI: **Requests** (search, status filter, pagination, View Details), **Request Details** (`/requests/:requestId`), and the Dashboard "Recent requests" card use live data. Other dashboard widgets remain Phase 1 sample data.

## Workflow execution (Phase 4; now configuration-driven, see Phase 6 below)
On `POST /api/requests` the request is saved as `PENDING`, then `services/workflowService.js` runs:
`REQUEST_RECEIVED` -> `VALIDATION` -> `EXTERNAL_VERIFICATION` (Phase 8) -> `INITIAL_EVALUATION` -> `DECISION` -> `COMPLETED`.
Status goes `PENDING` -> `PROCESSING` -> `APPROVED` | `REJECTED` | `MANUAL_REVIEW` (or `FAILED` if a stage errors).
Each completed (or failed) stage is saved in the `workflowexecutions` collection (model `WorkflowExecution`).
The request stores `decision { outcome, reason, decidedAt }`, `currentStage`, `completedAt`.
The workflow completes (stage `COMPLETED`) with the decision as the request status; the `COMPLETED` status value is
supported by the transition table but is not set automatically.

Decisions now come from the Rules Engine (Phase 5, below); `services/evaluationRules.js` was removed.
Allowed status transitions live in `services/statusTransitions.js`; others throw.

API changes: `GET /api/requests/:requestId` now includes `executionHistory`; new `GET /api/requests/stats`
returns `{ total, PENDING, PROCESSING, APPROVED, REJECTED, MANUAL_REVIEW, COMPLETED, FAILED }`.
Age validation now accepts 1-100 so under-18 applications are submitted and then rejected by the workflow.

## Rules Engine (Phase 5)
Rules are documents in the `rules` collection (model `Rule`). The `INITIAL_EVALUATION` stage calls
`rulesEngine.evaluate(requestData, { workflowKey, defaultOutcome: 'MANUAL_REVIEW' })`, which reads **enabled** rules
from MongoDB on every call (no caching, so edits apply to the next decision), sorts by `priority` (lowest first) and
evaluates sequentially. The first rule whose action is not `CONTINUE` decides; evaluation stops there. If no rule decides
(or none are enabled, or fields are missing) the safe default `MANUAL_REVIEW` is used and the reason says so.

```
backend/src/rulesEngine/
  constants.js  operators, actions, group logics
  operators.js  operator registry (add an operator = add one function + its name)
  evaluator.js  pure evaluateRules(rules, data) - no DB, no business rules
  index.js      createRulesEngine({ loadRules }) - default loader reads enabled rules from MongoDB
```

Rule fields: `ruleId, ruleName, description, field, operator, expectedValue, priority, enabled, onPass, onFail`
(+ optional `workflowKey` (default `loan-approval`), `groupId`, `groupLogic`).
Operators: `EQUALS, NOT_EQUALS, GREATER_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN, LESS_THAN_OR_EQUAL, IN, NOT_IN`.
Actions (`onPass`/`onFail`): `APPROVED, REJECTED, MANUAL_REVIEW, CONTINUE` (default `CONTINUE`).
`field` may be a dotted path. Missing/empty fields and non-numeric values in ordering comparisons evaluate to FAIL
(never throw) and are noted in the trace.

AND/OR grouping: rules sharing a `groupId` are evaluated as one unit (`groupLogic` AND = all pass, OR = any passes).
The unit runs at the priority of its first member, and that first member's `onPass`/`onFail` is the group's action.
The seeded 600-699 band is an AND group of `creditScore >= 600` and `creditScore <= 699`.

Example rule:
```json
{ "ruleId": "RULE-CREDIT-LOW", "ruleName": "Credit score too low", "description": "Credit score below 600 is rejected.",
  "field": "creditScore", "operator": "LESS_THAN", "expectedValue": 600, "priority": 20,
  "enabled": true, "onPass": "REJECTED", "onFail": "CONTINUE" }
```

Seeded rules (`backend/src/data/defaultRules.js`, priority order): age < 18 -> REJECTED (10); creditScore < 600 -> REJECTED (20);
creditScore 600-699 -> MANUAL_REVIEW (30/31 group); creditScore >= 700 -> APPROVED (40).
They are inserted automatically on server start **only if the `rules` collection is empty**; or run
`cd backend && npm run seed:rules` (add `-- --force` to reset to the defaults).

**Trace.** Each evaluated rule produces `{ ruleId, ruleName, field, actualValue, operator, expectedValue, result (PASS|FAIL),
actionTriggered, priority, evaluatedAt, [groupId, groupResult, note] }`. It is saved on the request (`evaluationTrace`),
in the `INITIAL_EVALUATION` execution record (`result.trace`), and shown on Request Details. The deciding rule is stored as `decision.ruleId`.

### Rules API (`/api/rules`)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/rules` | create; 400 on validation errors (`error.details` per field), 409 if `ruleId` exists |
| GET | `/api/rules` | sorted by priority; optional `?enabled=true|false&workflowKey=` |
| GET | `/api/rules/:id` | `:id` is the `ruleId` (Mongo `_id` also accepted); 404 if unknown |
| PUT | `/api/rules/:id` | partial update allowed (merged then fully re-validated); `ruleId` cannot change |
| DELETE | `/api/rules/:id` | |

All return 503 when MongoDB is not connected. Validation: ruleId 2-50 chars (`A-Za-z0-9_-`), name 2-100, field identifier/dotted path,
operator in the list, expectedValue numeric for ordering operators / non-empty list for IN, NOT_IN / scalar otherwise,
priority integer 1-10000, onPass/onFail in the action list, `enabled` boolean.

### Tests
`cd backend && npm test` (Node's built-in runner, no extra dependencies). The suites run the real engine, validator, controller
and workflow code against an in-memory fake of the Mongoose models (`tests/helpers/mocks.js`), so they need no database.
They do not exercise a real MongoDB or HTTP routing - see "Manual check against MongoDB" in the Phase 7 section.
`tests/idempotencySchema.test.js` is the exception: it inspects the **real** Mongoose schema (and real duplicate-key error shapes)
and is skipped automatically when `npm install` has not been run.

### Rules page
Sidebar -> **Rules**: list (priority order), View, Create, Edit, Enable/Disable, Delete.

### Limitations (Phase 5)
No authentication (the Rules page/API are open, as the rest of the app), no rule versioning or audit history, no workflow-type
selection (rules default to `loan-approval`), group actions come from the group's first rule, rule changes are not validated
for conflicts or coverage gaps, and the engine does not cache rules (one DB read per decision).

## Configurable workflows (Phase 6)
A workflow is a document in the `workflowdefinitions` collection (model `WorkflowDefinition`):
`key, name, description, enabled, stages[], transitions[]`.
- **Stage:** `{ stageId, name, type, description }`. `stageId` is unique inside the workflow. `type` picks the handler:
  `RECEIVE` (start, exactly one), `VALIDATION` (request data check), `VERIFICATION` (calls the simulated external service, Phase 8), `EVALUATION` (runs the Rules Engine), `DECISION`
  (sets the decision/status from the evaluation), `COMPLETE` (end, at least one). Stage IDs and names are free to change.
- **Transition:** `{ from, to, outcome }`. `outcome` is `APPROVED | REJECTED | MANUAL_REVIEW | ALWAYS`. After a stage runs,
  the engine takes the transition whose outcome equals the stage's outcome (EVALUATION and DECISION stages produce the rule
  outcome); if none matches it takes the `ALWAYS` transition; if there is none, the request is marked `FAILED`.

Execution (`services/workflowService.js`): load the **enabled** workflow whose `key` equals the request's `workflowKey`
(`loan-approval`), validate it, then start at the RECEIVE stage and follow transitions to a COMPLETE stage (max 50 steps).
The request is saved after every stage with `currentStage` and `stageHistory[]` (`stageId, stageName, type, status, outcome,
nextStageId, error, startedAt, completedAt`); one `WorkflowExecution` record per stage is kept as before. The workflow is read
on every request, so edits affect **future** requests only; past requests keep their stored history.

Safe failures: no enabled workflow, a definition that fails validation (e.g. hand-edited in MongoDB), an unknown stage type,
a missing transition, DECISION without a preceding EVALUATION, or a loop -> the request is saved with status `FAILED` and
`decision.reason` explains why (a `WORKFLOW_LOAD` history record is written when the workflow cannot be loaded).

Default workflow (seeded if the collection is empty; or `cd backend && npm run seed:workflows [-- --force]`):
`REQUEST_RECEIVED -> VALIDATION -> EXTERNAL_VERIFICATION -> INITIAL_EVALUATION -> DECISION -> COMPLETED`, with `DECISION -> COMPLETED` for each of
APPROVED, REJECTED and MANUAL_REVIEW. See `backend/src/data/defaultWorkflow.js`.

Validation (API and runtime): key 2-50 chars (`A-Za-z0-9_-`); 2-30 stages with unique IDs and valid types; exactly one RECEIVE
and at least one COMPLETE; transitions reference existing stages, no outgoing transitions from COMPLETE, none into RECEIVE,
no self-loops, no duplicate (from, outcome); every non-COMPLETE stage has an outgoing transition; a DECISION stage covers all three
outcomes (or has ALWAYS); all stages are reachable from the start. Errors come back as `error.details` keyed by path, e.g.
`stages[1].stageId`, `transitions[0].to`.

### Workflows API (`/api/workflows`)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/workflows` | list, by name |
| GET | `/api/workflows/:id` | `:id` is the workflow `key` (Mongo `_id` also accepted); 404 if unknown |
| POST | `/api/workflows` | create; 400 validation, 409 duplicate key; `enabled` defaults to false |
| PUT | `/api/workflows/:id` | partial update merged then re-validated; `key` cannot change |
| DELETE | `/api/workflows/:id` | **409 if the workflow is enabled** (disable it first) |

Enabling a workflow (create or update with `enabled: true`) disables other workflows with the same `key`, so one is active per key.
All endpoints return 503 when MongoDB is not connected. (Phase 1 sample-data fallback for `/api/workflows` was removed.)

```json
POST /api/workflows
{ "key": "express-loan", "name": "Express Loan", "enabled": false,
  "stages": [ { "stageId": "IN", "name": "In", "type": "RECEIVE" }, { "stageId": "EVAL", "name": "Eval", "type": "EVALUATION" },
              { "stageId": "DECIDE", "name": "Decide", "type": "DECISION" }, { "stageId": "DONE", "name": "Done", "type": "COMPLETE" } ],
  "transitions": [ { "from": "IN", "to": "EVAL", "outcome": "ALWAYS" }, { "from": "EVAL", "to": "DECIDE", "outcome": "ALWAYS" },
                   { "from": "DECIDE", "to": "DONE", "outcome": "ALWAYS" } ] }
```
Note: requests use `workflowKey` `loan-approval` (the model default); the app has no workflow-type selector yet, so to change the
live process edit the `loan-approval` workflow (or enable one whose key is `loan-approval`).

### Workflows page
Sidebar -> **Workflows**: list, View (stages + transitions tables), Create / Edit (simple stage and transition rows, no drag and drop),
Enable / Disable, Delete (the active one is refused). Validation errors are listed with their field path and shown under the fields.
Request Details shows the executed stages from `stageHistory`.

### Phase 6 limitations
No versioning (the `version` field is informational), no authentication, no conditional branching other than rule outcomes,
EVALUATION always uses the Rules Engine, stage-type handlers are fixed in code, and requests always use the `loan-approval` key.

## Idempotency and single execution (Phase 7)

### `POST /api/requests` with `Idempotency-Key`
```
curl -X POST http://localhost:5000/api/requests \
  -H "Content-Type: application/json" -H "Idempotency-Key: 6f1c2d3e-8a7b-4c5d-9e0f-1a2b3c4d5e6f" \
  -d '{"applicantName":"Asha Rao","email":"asha@example.com","age":30,"monthlyIncome":50000,
       "employmentType":"Salaried","creditScore":720,"loanAmount":200000}'
```
The header is optional (without it every call creates a new request, as before). Format: 8-128 characters of `A-Za-z0-9._:-`
(a UUID is ideal); anything else is `400`. The key is stored on the request (`idempotencyKey`) and protected by a MongoDB
**unique index** (partial: only documents that have a key). The stored `payloadHash` is a SHA-256 of the *normalised* payload
(so `"30"` and `30`, or extra spaces, count as the same payload).

| Situation | HTTP | Body highlights |
|---|---|---|
| New key, workflow ran | **201** | `idempotent:false, processing:false, executionState:"COMPLETED"` (or `"FAILED"`), `data` |
| Key seen before, same payload, finished | **200** | `idempotent:true`, original `requestId`, header `Idempotent-Replayed: true` |
| Key seen before, request still pending/running | **202** | `idempotent:true, processing:true`, header `Retry-After: 1` - retry with the same key |
| Key seen before, **different** payload | **422** | `error.details.idempotencyKey`, `error.details.requestId` of the original; nothing is created or changed |
| Invalid body / invalid key format | 400 | validation details (nothing stored) |
| Database down | 503 | |

Every success has the same shape: `{ success, message, requestId, idempotent, processing, executionState, data }`.
Concurrent calls with the same key: they may all pass the lookup, but the unique index lets exactly one insert succeed; the
others catch the duplicate-key error (code 11000 on `idempotencyKey`), load the winner's request and answer as a replay
(200/202, or 422 if their payload differs). Only the request that inserted the document executes the workflow. Other
duplicate-key errors are not hidden: a clash on a generated `requestId` is retried with a new ID (max 3 attempts).
Keys are never expired or reused; without a key, identical payloads are intentionally **not** de-duplicated.

### Execution protection
Each request has `executionState`: `PENDING -> RUNNING -> COMPLETED | FAILED`. `workflowService.runWorkflow` first does an atomic
`findOneAndUpdate({ requestId, status: "PENDING", executionState: { $in: ["PENDING", null] } }) -> { status: "PROCESSING", executionState: "RUNNING" }`
(`null` also matches pre-Phase-7 requests that have no `executionState` field, so those can still be executed once).
Only the caller whose update matches runs the stages; every other call (repeat, concurrent, retry) gets the current document back
without touching `stageHistory` or the execution records. `executionState` becomes `COMPLETED` only **after** the last stage has been
saved (a failure sets `FAILED`, also with the reason in `executionError`). A request that is `RUNNING` is reported as processing (202),
never as finished. Pre-Phase-7 documents without `executionState` are reported according to their status (finished unless
`PENDING`/`PROCESSING`).

### `POST /api/requests/:requestId/execute`
Runs the workflow for a request that is still `PENDING` (for example one whose creation call died before executing), and is safe to
call repeatedly or concurrently:
| State | HTTP | `executed` |
|---|---|---|
| was pending, now executed | 200 | `true` ("Workflow executed") |
| already completed / failed | 200 | `false` ("Workflow already executed; no action taken"), `idempotent:true` |
| running right now | 202 | `false`, `processing:true` |
| unknown ID | 404 | |

A `FAILED` request is **not** re-run by this endpoint (retries are a later phase).

### Frontend (Submit Application)
Each submission gets its own key (`crypto.randomUUID()`). After a network error or 5xx the key is kept, so pressing Submit again
with the same form re-sends the **same** key; after success, or a 400/422, or when the form content changes, the next submit gets a
**new** key. The button is disabled and a ref blocks re-entry while a call is in flight, but the server key is the real protection.
Banners: green = new request, blue = "already received - showing the existing request, no duplicate created", amber = still processing
(press Submit again to check). Request Details shows the execution state.

### Index readiness
On startup the server awaits `WorkflowRequest.init()` right after connecting, so the unique `idempotencyKey` index exists before
it is relied on; if the index cannot be built (for example duplicate keys already stored) the log says
`idempotency uniqueness is NOT enforced`. Check the server log after the first start against a database.

### Manual check against MongoDB
The automated tests use an in-memory fake, so confirm the real database once:
1. Start the API with `MONGODB_URI` set, then run
   `curl -s -X POST localhost:5000/api/requests -H "Content-Type: application/json" -H "Idempotency-Key: demo-key-0001" -d '{...}'`
   twice with the same body: first call `201`, second `200` with `idempotent:true` and the same `requestId`.
2. Change one field (e.g. `loanAmount`) and reuse the key: `422`.
3. Fire 10 parallel calls (`seq 10 | xargs -P10 -I{} curl ...` with the same key): one `201`, the rest `200`/`202`, one document.
4. In `mongosh`: `db.workflowrequests.getIndexes()` must list `idempotencyKey_1` with `unique: true` and a `partialFilterExpression`;
   `db.workflowrequests.countDocuments({ idempotencyKey: "demo-key-0001" })` must be `1`.

### Phase 7 limitations
No automatic retries, no expiry of keys, no recovery of requests stuck in `RUNNING` (e.g. server crashed mid-run) or `PENDING`
(use the execute endpoint for the latter), `FAILED` requests are not re-run, keys are global (not per user - there is no auth), and
the tests exercise the logic against an in-memory fake of the models, not a real MongoDB (the unique index is declared in the schema but was
not exercised against a live database here).


## External dependency simulation and failure handling (Phase 8)

### The simulated verification service
`services/externalDependency.js` simulates an applicant identity/credit verification API **inside the backend process** (no network,
no third-party API). Its settings are stored in MongoDB (`dependencyconfigs`, one document named `verification-service`; without a
document the defaults below apply) and are read on every call, so changes take effect on the next workflow run with no restart.

| Setting | Default | Range | Meaning |
|---|---|---|---|
| `outcome` | `SUCCESS` | `SUCCESS` \| `FAILURE` \| `TIMEOUT` | What the service does |
| `delayMs` | `0` | 0 - 30000 | Simulated response time |
| `timeoutMs` | `3000` | 10 - 30000 | The caller gives up after this long |
| `failureProbability` | `0` | 0 - 1 | Chance that a `SUCCESS` call fails anyway (random `FAILURE`) |

Behaviour: `SUCCESS` answers after `delayMs` (or fails with the given probability); `FAILURE` answers after `delayMs` with a simulated
`503`; `TIMEOUT` never answers, so the call ends after `timeoutMs`; a `delayMs` **greater than** `timeoutMs` is also a timeout.
Invalid settings are rejected with `400` and `error.details` per field; nothing is saved.

### Workflow integration and failure behaviour
A new stage type `VERIFICATION` calls the service. The default workflow now is
`REQUEST_RECEIVED -> VALIDATION -> EXTERNAL_VERIFICATION -> INITIAL_EVALUATION -> DECISION -> COMPLETED`, i.e. verification happens
**before** any decision. Put a `VERIFICATION` stage before `DECISION` in any workflow you edit.

| Dependency result | What happens |
|---|---|
| `SUCCESS` | Stage completes, the workflow continues; rules decide APPROVED / REJECTED / **MANUAL_REVIEW** exactly as before |
| `FAILURE` or `TIMEOUT` | The stage is recorded as `FAILED`, the run stops, the request gets status **`FAILED`**, `executionState: FAILED`, no `decision.outcome`, and `failure { kind, dependency, message, at }` |

`failure.kind` is `DEPENDENCY_FAILURE`, `DEPENDENCY_TIMEOUT` or `WORKFLOW_ERROR` (any other failure). Request data, the stages that
completed before the failure (`stageHistory`, execution records) and the dependency call record are all kept; the Rules Engine does not
run, so a request whose verification failed can never be APPROVED, REJECTED or MANUAL_REVIEW. `WAITING_FOR_RETRY` was deliberately **not**
added: nothing retries in this phase, so `FAILED` is the honest state.

Every call (workflow or test) is stored in `dependencycalls`: `dependency, requestId, stageId, attempt, source (WORKFLOW|TEST), status
(SUCCESS|FAILURE|TIMEOUT), error, durationMs, attemptedAt, response, simulation` (the settings used). A unique partial index on
`(requestId, stageId, attempt)` makes duplicate workflow call records impossible at database level; in addition the Phase 7 atomic
execution claim means a request's workflow (and so its dependency call) runs once, and a `FAILED` request is **not** re-run by
`POST /api/requests/:id/execute`, by repeated calls, or by an `Idempotency-Key` replay (these return the stored failure unchanged).
No applicant data is stored with a call record.

### API responses
`POST /api/requests` (and `/execute`) keep the Phase 7 shape and add `failure` when the workflow ended in `FAILED`. The request exists
and its data is safe, so creation is still **201**; read `executionState`, `failure` and `message`:
```
HTTP/1.1 201 Created
{ "success": true,
  "message": "Application saved, but verification timed out (verification-service). The request is FAILED; no approval or rejection was made.",
  "requestId": "REQ-MH3K9X2-A1B2C3", "idempotent": false, "processing": false, "executionState": "FAILED",
  "failure": { "kind": "DEPENDENCY_TIMEOUT", "dependency": "verification-service", "message": "verification-service did not respond within 3000 ms" },
  "data": { "status": "FAILED", "stageHistory": [ ... "EXTERNAL_VERIFICATION" with status FAILED ], "decision": { "reason": "Workflow failed at EXTERNAL_VERIFICATION: ... No approval or rejection was made." } } }
```
`GET /api/requests/:requestId` now also returns `failure` and `dependencyCalls[]`.

### Dependency API
| Method | Path | Notes |
|---|---|---|
| GET | `/api/dependencies/verification` | `{ name, state, config, counts, averageDurationMs, lastCall, recentCalls }`. `state`: `HEALTHY` (last 5 calls ok), `DEGRADED` (some failed), `DOWN` (all of the last 5 failed), `UNKNOWN` (no calls). `counts` cover the last 50 calls |
| PUT | `/api/dependencies/verification/config` | Save settings. Omitted fields keep their current value. `400` + `details` when invalid |
| POST | `/api/dependencies/verification/test` | Makes one call (stored with `source: "TEST"`). An optional body overrides the settings **for this call only** (nothing saved). A failed/timed-out simulated call is still `200`; `data.call.status` says what happened |

All return `503` when MongoDB is not connected.
```bash
# make the service time out after 2 s
curl -X PUT localhost:5000/api/dependencies/verification/config -H "Content-Type: application/json" \
  -d '{"outcome":"TIMEOUT","timeoutMs":2000}'
# submit an application: request is saved, ends FAILED, nothing decided
curl -X POST localhost:5000/api/requests -H "Content-Type: application/json" \
  -d '{"applicantName":"Asha Rao","email":"asha@example.com","age":30,"monthlyIncome":50000,"employmentType":"Salaried","creditScore":720,"loanAmount":200000}'
# a 25 % random failure rate with a 300 ms response time
curl -X PUT localhost:5000/api/dependencies/verification/config -H "Content-Type: application/json" \
  -d '{"outcome":"SUCCESS","delayMs":300,"timeoutMs":3000,"failureProbability":0.25}'
# one-off test call without saving anything
curl -X POST localhost:5000/api/dependencies/verification/test -H "Content-Type: application/json" -d '{"outcome":"FAILURE"}'
# inspect
curl localhost:5000/api/dependencies/verification
```

### Frontend
- **System Health:** the "Verification service" tile and panel are live: status badge, success/failure/timeout counts, average response
  time, last call, recent calls, and a form for outcome / delay / timeout / failure chance (**Save settings**, or **Test call with
  these values**, which does not save).
- **Request Details:** a "Failure details" banner (what failed, that data and completed stages are preserved, that nothing was decided)
  and an "External dependency calls" table (status badge, attempt, time, duration, error/reference). The failed stage also shows in the stage tracker.
- **Submit Application:** a red banner explains that the application was saved but verification failed, with the request ID.
- **Workflows page:** `VERIFICATION` is a selectable stage type.
- Note: the Axios timeout is 5 s. A configured delay above that makes the browser give up while the server finishes; pressing Submit again
  reuses the Idempotency-Key (Phase 7), so no duplicate is created.

### Tests (Phase 8)
`backend/tests/dependency.test.js` (17 tests, same in-memory fake database as before): config validation; SUCCESS / FAILURE / TIMEOUT / slow
response / failure probability; success lets the workflow progress; failure and timeout keep request data and completed stages and make no
decision (also for applicants who would have been approved, rejected or sent to manual review); real-timer duration measurement; repeated,
concurrent and idempotency-key-replayed execution create no second dependency record; settings persist and drive the next run; API
validation, partial update, test endpoint, status summary, 503. The default-workflow tests of earlier phases were updated for the extra stage.
`tests/dependencySchema.test.js` checks the real Mongoose schema (unique call index, `failure` fields) and is skipped when dependencies are not installed.
Full suite: 68 tests (65 run here; the 3 real-schema tests are skipped without Mongoose). Like Phase 7, none of this ran against a live MongoDB; the same "Manual check against MongoDB" advice applies.

### Upgrading an existing database
The default workflow is only seeded when the `workflowdefinitions` collection is empty, so an **existing** `loan-approval` workflow
keeps working but has **no** verification stage. Either add the stage on the Workflows page (stage type `VERIFICATION`, transitions
`VALIDATION -> it -> INITIAL_EVALUATION`), or run `cd backend && npm run seed:workflows -- --force` (this **replaces all workflows**).
Requests created earlier are untouched. Indexes for the new collections are built on first start.

### Phase 8 limitations
*(Superseded by Phase 9, which adds retries and manual recovery.)* In Phase 8 itself there were no automatic retries, backoff, circuit breaker or recovery: a `FAILED` request stayed `FAILED` and could not be re-run. The simulation
is in-process and one instance; `timeoutMs`/`delayMs` really block the request (up to 30 s). There is no authentication on the
configuration endpoints. The health `state` is derived from recent calls only (including test calls), not from an active probe.

## Retries and manual recovery (Phase 9)

A request that fails because of a **temporary** external dependency error is retried automatically, with exponential backoff, by a small
background worker. Operators can also retry a failed request by hand. There is no queue, Redis or BullMQ: all retry state lives on the
request document in MongoDB and the worker simply polls it, which is why it survives restarts.

### Retry policy (configuration)
Stored in MongoDB (`retryconfigs`, one document named `default`; without a document the defaults apply) and read when a failure happens.

| Setting | Default | Range | Meaning |
|---|---|---|---|
| `maxAttempts` | `3` | 0 - 10 | Maximum **automatic** retries per request (the original run is not counted). `0` turns automatic retries off |
| `initialDelayMs` | `5000` | 100 - 3 600 000 | Delay before the first retry |
| `backoffMultiplier` | `2` | 1 - 10 | Growth factor per retry (`1` = constant delay) |
| `maxDelayMs` | `60000` | 100 - 86 400 000 | Upper limit for any delay; must be >= `initialDelayMs` |

Invalid values (wrong type, out of range, non-integer where a whole number is required, `maxDelayMs` below `initialDelayMs`) are rejected
with `400` and `error.details` per field; nothing is saved. Omitted fields keep their current value. New settings apply to failures that
happen afterwards; a retry that is already scheduled keeps its time.

### What is retried
| Failure (`failure.kind`) | Automatic retry | Manual retry |
|---|---|---|
| `DEPENDENCY_TIMEOUT` (service did not answer in time) | yes | yes |
| `DEPENDENCY_FAILURE` (service returned an error, e.g. simulated `503`) | yes | yes |
| `WORKFLOW_ERROR` (validation failed / invalid request, missing or invalid workflow, no transition, ...) | **no** | **no** (409) |

Permanent failures are marked `retry.state: NOT_RETRYABLE`: repeating them could only give the same result. Retrying is also refused for a
request whose decision was already recorded (status is not `FAILED`).

### Backoff calculation
```
delay = min(initialDelay * backoffMultiplier ^ retryCount, maximumDelay)
```
`retryCount` is the number of retries **already started** (automatic + manual), so the first retry waits `initialDelay`. With the defaults
(`5 s`, x2, cap `60 s`, 3 attempts): retry 1 after 5 s, retry 2 after 10 s, retry 3 after 20 s, then the request is `EXHAUSTED`.
With `initialDelayMs=1000, backoffMultiplier=2, maxDelayMs=3000`: 1 s, 2 s, 3 s (4 s capped), 3 s, ...
The delay is counted from the moment the previous attempt **failed** and is stored as `retry.nextRetryAt`.

### Retry state on the request
`GET /api/requests/:id` returns `retry` and `manualRetry`:
```json
{ "status": "FAILED",
  "failure": { "kind": "DEPENDENCY_TIMEOUT", "dependency": "verification-service", "retryable": true, "message": "...", "at": "..." },
  "retry": {
    "state": "SCHEDULED", "count": 1, "maxAttempts": 3, "nextRetryAt": "2026-11-13T12:30:20.000Z", "lockedUntil": null,
    "lastError": { "kind": "DEPENDENCY_TIMEOUT", "message": "verification-service did not respond within 3000 ms", "at": "...", "attempt": 1 },
    "history": [ { "attempt": 1, "trigger": "AUTOMATIC", "initiatedBy": "system", "scheduledFor": "...", "startedAt": "...", "completedAt": "...", "outcome": "FAILED", "error": "..." } ] },
  "manualRetry": { "eligible": true, "reason": null } }
```
| `retry.state` | Meaning |
|---|---|
| `SCHEDULED` | An automatic retry is due at `nextRetryAt` |
| `IN_PROGRESS` | A retry is running (status `PROCESSING`, `lockedUntil` is its lease) |
| `EXHAUSTED` | Temporary failure but `count >= maxAttempts`. Manual retry is still possible |
| `NOT_RETRYABLE` | Permanent failure |
| `RECOVERED` | A retry finished the workflow (the `failure` is cleared; `retry.lastError` and `retry.history` keep the story) |

`history[].outcome` is `RUNNING`, `SUCCEEDED`, `FAILED` or `INTERRUPTED`; `trigger` is `AUTOMATIC` or `MANUAL`. Retries also write
`RETRY_STARTED / RETRY_SUCCEEDED / RETRY_FAILED / RETRY_INTERRUPTED` entries to the audit log (best effort).

### How a retry runs (no duplicate history)
A retry does **not** start the workflow over. It **resumes at the stage that failed**:
- stages that already completed are not executed again, so their `stageHistory` entries and `WorkflowExecution` records are never duplicated;
- the failed stage gets exactly one new entry per retry (the earlier `FAILED` entry stays as the record of what happened); every history
  entry carries `attempt` (`0` = original run, `n` = n-th retry);
- the dependency is called once per retry; each real call is one `DependencyCall` with the next `attempt` number (the unique index
  `(requestId, stageId, attempt)` still applies), so a retry can never produce two records for the same attempt;
- an `EVALUATION` result from an earlier, completed stage is reused for `DECISION` instead of evaluating again.

If the workflow was changed so that the failed stage no longer exists, the retry fails permanently (`NOT_RETRYABLE`) instead of looping.

### Worker behaviour
`services/retryWorker.js` starts after the database is ready (`server.js`) and runs a check immediately and then every
`RETRY_POLL_INTERVAL_MS`:
1. **Recover interrupted retries** (see below).
2. **Start due retries:** requests with `status FAILED`, `retry.state SCHEDULED` and `nextRetryAt <= now`, oldest first, at most `RETRY_BATCH_SIZE`
   per check, run in parallel.

Checks never overlap inside a process; the timer does not keep Node alive; `SIGINT/SIGTERM` stop it and wait for a running check.

**Concurrency.** Automatic and manual retries use the *same atomic claim* (`findOneAndUpdate`): it only matches a `FAILED` request with a
temporary failure, an eligible `retry.state`, an unchanged `retry.count` and (for the worker) a due `nextRetryAt`, and in one step sets
`PROCESSING / IN_PROGRESS`, increments `retry.count`, clears `nextRetryAt` and records the attempt. Exactly one caller can win, so
a manual retry and a scheduled retry never run together, and two workers (or two app instances) would still never run the same retry twice.
(Multi-instance *scheduling* is not part of this phase; the claim just keeps it safe.)

**Restarts and crashes.** Nothing is kept in memory: `count`, `nextRetryAt` and `history` are on the request. After a restart the first check picks up every retry that
became due while the app was down. A retry that was running when the process died would stay `PROCESSING` forever, so each claim sets a lease
(`retry.lockedUntil = now + RETRY_LOCK_MS`); once it expires the worker puts the request back to `FAILED`, marks that attempt `INTERRUPTED`
and reschedules it with the normal backoff (or `EXHAUSTED` when attempts are used up). Choose `RETRY_LOCK_MS` larger than your longest
dependency timeout (the simulation allows up to 30 s; the default is 120 s).

### Manual recovery API
`POST /api/requests/:requestId/retry` - retries an eligible failed request now and returns when the retry has finished.

Eligible = status `FAILED`, a **temporary** failure, and no retry already running. It is allowed before a scheduled retry is due (the
manual retry takes over and the schedule is cleared) and after the automatic attempts are used up. A manual retry counts in `retry.count`.
The initiator is stored in `retry.history[].initiatedBy` and the audit log: the authenticated user (`req.user.email/name/id`) if an
authentication layer ever provides one; the project has no authentication yet, so today it is recorded as `operator`.

| HTTP | When |
|---|---|
| `200` | The retry ran. `succeeded: true` = request recovered; `false` = it failed again (the message says whether another automatic retry is scheduled) |
| `404` | Unknown request |
| `409` | Not eligible: not `FAILED` (e.g. `COMPLETED`, `PENDING`), permanent failure, or a retry is already in progress / another retry started first. `error.message` says why |
| `503` | MongoDB not connected |

```bash
# make the dependency fail, submit (request ends FAILED with a retry scheduled), then recover it
curl -X PUT localhost:5000/api/dependencies/verification/config -H "Content-Type: application/json" -d '{"outcome":"FAILURE"}'
curl -X POST localhost:5000/api/requests -H "Content-Type: application/json" \
  -d '{"applicantName":"Asha Rao","email":"asha@example.com","age":30,"monthlyIncome":50000,"employmentType":"Salaried","creditScore":720,"loanAmount":200000}'
curl -X PUT localhost:5000/api/dependencies/verification/config -H "Content-Type: application/json" -d '{"outcome":"SUCCESS"}'

# manual retry
curl -X POST localhost:5000/api/requests/REQ-MH3K9X2-A1B2C3/retry
```
```json
{ "success": true, "message": "Retry #1 succeeded. The request is now APPROVED.", "requestId": "REQ-MH3K9X2-A1B2C3",
  "retried": true, "succeeded": true, "executionState": "COMPLETED", "initiatedBy": "operator", "data": { "status": "APPROVED", "retry": { "state": "RECOVERED", "count": 1 } } }
```
```json
{ "success": false, "error": { "status": 409, "message": "Only FAILED requests can be retried (this request is APPROVED).",
  "details": { "requestId": "REQ-MH3K9X2-A1B2C3", "status": "APPROVED", "retryState": "RECOVERED" } } }
```

### Retry configuration API
| Method | Path | Notes |
|---|---|---|
| GET | `/api/retries/config` | `{ config, worker: { enabled, running, intervalMs, lastTickAt, lastResult, lastError }, counts: { scheduled, inProgress, exhausted } }` |
| PUT | `/api/retries/config` | Save settings (partial updates allowed; `400` + `details` when invalid) |

`GET /api/health` also reports `retryWorker`.
```bash
# 4 automatic retries: 2 s, 3 s, 4.5 s, 6.75 s (capped at 30 s)
curl -X PUT localhost:5000/api/retries/config -H "Content-Type: application/json" \
  -d '{"maxAttempts":4,"initialDelayMs":2000,"backoffMultiplier":1.5,"maxDelayMs":30000}'
# turn automatic retries off (manual retry keeps working)
curl -X PUT localhost:5000/api/retries/config -H "Content-Type: application/json" -d '{"maxAttempts":0}'
curl localhost:5000/api/retries/config
```

### Frontend
- **Request Details -> "Retries" card** (shown for requests that failed or have retry state): retry state, retries so far (and the automatic
  limit), next retry time with a live countdown, last failure (kind, time, message) and the retry history table (who/what triggered it,
  start/finish, outcome, error). The stage tracker marks stages run by a retry (`retry #n`) and the execution history has a "Run" column.
- **Retry now** button, only for eligible requests. Feedback is shown in the card: *retry scheduled*, *retry started...*, *retry #n
  succeeded / failed again (next retry at ...)*. The page re-reads the request every 3 s while a retry is scheduled or running, so the same
  messages appear when the worker (not you) performs the retry. Ineligible failed requests say why (e.g. permanent failure).
- **System Health -> "Retry policy"** panel: the four settings, the resulting delay for each automatic retry, worker state, last check, and how many
  requests are scheduled / running / out of attempts. It is read-only; change the policy with the API above.

### Tests (Phase 9)
`backend/tests/retry.test.js` (27 tests, same in-memory fake database; the fake now supports dotted paths, `$inc`, `$push`, `$unset`, `$lte/$lt`) covers: config
validation and API (persisted, partial, 400, 503); the backoff formula (growth, cap, multiplier 1, overflow); temporary failures scheduled
and permanent ones / invalid requests never retried; `maxAttempts` respected (and `0`); due vs not-yet-due; recovery of the request; **no
duplicate stage history, execution records or dependency calls**; retry history and growing delays; manual retry (success, failing again, exhausted,
operator / authenticated user recorded, 404, 409 for completed / pending / running / permanent, pre-Phase-9 failures); **concurrent manual
retries run once, manual vs worker never together**, atomic claim; **state survives a restart** (new worker instance picks up work that came due
while down); crash recovery through the lease and exhaustion afterwards; resume with an earlier evaluation; changed workflow; worker
mechanics (no overlap, no DB, error survival). `tests/retrySchema.test.js` checks the real Mongoose schema and is skipped without dependencies.
All Phase 1-8 tests still pass unchanged (the test fake was extended, no assertions were changed). Run: `cd backend && npm test`.
Like earlier phases, nothing here ran against a live MongoDB or the real Mongoose; see "Manual check against MongoDB" and the checklist below.

Manual check against MongoDB: set the dependency to `FAILURE`, set `initialDelayMs` to `2000`, submit an application, watch the request details page
count down and retry (`failure` -> `retry` fields), switch the dependency to `SUCCESS` and see it recover; restart the backend between the failure and
the due time to confirm the retry still happens; click **Retry now** twice quickly to confirm the second click gets a `409`.

### Upgrading an existing database
No migration is needed. New fields (`retry`, `failure.retryable`, `attempt`) are optional and the worker index is built on start. Requests that failed in
Phase 8 have no `retry` state: the worker leaves them alone, but they can be retried manually (their `failure.kind` is used). To schedule them, retry them once by hand.

### Phase 9 limitations
Single-process worker polling MongoDB (no distributed scheduling; the atomic claim only guarantees safety if several instances run). No circuit breaker and
no jitter in the backoff. Only the simulated verification dependency exists, so "temporary" means `DEPENDENCY_FAILURE/TIMEOUT`; add new kinds to
`TEMPORARY_KINDS` in `services/retryPolicy.js`. The manual retry request waits for the retry to finish (up to the dependency timeout, 30 s at most; the
browser timeout for it is 45 s). Retry settings are edited through the API, not the UI. There is no authentication, so manual retries are attributed to `operator`.
A retry that outlives `RETRY_LOCK_MS` is treated as interrupted and could then overlap with its slow original; keep the lease longer than your slowest dependency.
