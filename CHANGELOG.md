# Changelog

## v9 - Phase 9: Automatic retries with exponential backoff and manual recovery
Added:
- Retry policy in MongoDB (`RetryConfig`, `services/retryConfig.js`): `maxAttempts`, `initialDelayMs`, `backoffMultiplier`, `maxDelayMs`; validated (`validators/retryValidator.js`: types, ranges, whole numbers, `maxDelayMs >= initialDelayMs`); defaults 3 / 5000 / 2 / 60000.
- Exponential backoff `delay = min(initialDelay * backoffMultiplier ^ retryCount, maximumDelay)` (`services/retryPolicy.js`, pure and unit-tested). Temporary dependency failures (`DEPENDENCY_TIMEOUT`, `DEPENDENCY_FAILURE`) are scheduled; permanent failures (`WORKFLOW_ERROR`: invalid request, bad/missing workflow, ...) are `NOT_RETRYABLE` and never retried.
- Retry state on `WorkflowRequest`: `retry { state, count, maxAttempts, nextRetryAt, lockedUntil, lastError, history[] }`, `failure.retryable`, and `attempt` on `stageHistory` / `WorkflowExecution`; index on `(retry.state, retry.nextRetryAt)`.
- Retries **resume at the failed stage** (`workflowService.resumeWorkflow`): completed stages are not re-run, stage history / execution records / dependency calls are not duplicated, an earlier evaluation result is reused. On success `failure` is cleared and `retry.state` becomes `RECOVERED`.
- `services/retryService.js`: one atomic claim shared by automatic and manual retries (a request is retried by one caller at a time; manual wins over a schedule), crash recovery through a lease (`recoverInterrupted`), `processDueRetries`. Audit-log entries `RETRY_STARTED / SUCCEEDED / FAILED / INTERRUPTED`.
- `services/retryWorker.js`: in-process polling worker (no Redis/BullMQ/queue), started from `server.js`, non-overlapping checks, graceful stop on SIGINT/SIGTERM. Env: `RETRY_WORKER_ENABLED`, `RETRY_POLL_INTERVAL_MS`, `RETRY_BATCH_SIZE`, `RETRY_LOCK_MS`.
- API: `POST /api/requests/:id/retry` (200 / 404 / 409 / 503; initiator = `req.user` if present, else `operator`), `GET|PUT /api/retries/config`; `GET /api/requests/:id` adds `retry` and `manualRetry { eligible, reason }`; `GET /api/health` adds `retryWorker`.
- Frontend: Request Details "Retries" card (state, count, live next-retry countdown, last failure, history, **Retry now**, scheduled/started/completed feedback, 3 s polling while a retry is pending); System Health "Retry policy" panel (settings, resulting delays, worker state, counts); stage tracker and execution history show retry runs.
- Tests: `tests/retry.test.js` (27) and `tests/retrySchema.test.js` (real schema, skipped without dependencies). Suite: 97 tests, 92 run here.
Changed:
- `statusTransitions`: `FAILED -> PROCESSING` is now allowed (only the retry claim uses it).
- `workflowService`: `runWorkflow` split into `runStages` (shared) + claim/load; `failRequest` now classifies the failure and schedules the next retry. `runWorkflow` itself still never re-runs a `FAILED` request, and `/execute` and idempotency replays behave exactly as before.
- Test fake (`tests/helpers/mocks.js`) gained dotted paths, `$inc/$push/$unset`, `$lte/$lt`, filtered `countDocuments`, deep-copy on `save`, and two collections. No existing assertion was changed.
Not done (by design): circuit breakers, Redis/BullMQ, distributed/multi-instance scheduling, jitter, editing retry settings in the UI, authentication.
Upgrade note: no migration. Phase 8 failures have no retry state: the worker ignores them, but they can be retried manually.
Verification note: tests run against the in-memory fake (no MongoDB/npm registry in the build sandbox); the real-Mongoose schema test could not run here. Frontend JSX was compile-checked with esbuild and the two new components were server-rendered with sample data; `vite build` could not run offline.

## v8 - Phase 8: External dependency simulation and safe failure handling
Added:
- Local simulated verification service (`services/externalDependency.js`): outcomes `SUCCESS | FAILURE | TIMEOUT`, `delayMs`, `timeoutMs`, `failureProbability`; settings stored in MongoDB (`DependencyConfig`), validated (`validators/dependencyValidator.js`), read on every call.
- `DependencyCall` model: every call stores dependency name, status, error message, attempt timestamp, response duration, attempt number, source and the settings used; unique partial index on `(requestId, stageId, attempt)`.
- New workflow stage type `VERIFICATION`; default workflow gains `EXTERNAL_VERIFICATION` between `VALIDATION` and `INITIAL_EVALUATION`.
- On FAILURE/TIMEOUT: stage recorded `FAILED`, request becomes `FAILED` (`executionState: FAILED`) with `failure { kind, dependency, message, at }`; request data, completed stages and the call record are kept; no decision is made, the Rules Engine does not run. Not re-run by repeated execute calls or idempotency replays.
- API: `GET /api/dependencies/verification` (settings, health state, counts, recent calls), `PUT /api/dependencies/verification/config`, `POST /api/dependencies/verification/test` (optional one-off overrides). `POST /api/requests` and `/execute` responses add `failure` and a clear message when the workflow failed (still 201/200: the request exists); `GET /api/requests/:id` adds `failure` and `dependencyCalls`. `GET /api/health` reports `externalDependencies: "simulated"`.
- Frontend: live System Health dependency tile + panel with settings form and test call; Request Details failure banner and dependency-call table; Submit Application failure banner; `VERIFICATION` selectable on the Workflows page.
- Tests: `tests/dependency.test.js` (17) and `tests/dependencySchema.test.js` (real schema, skipped without dependencies).
Changed:
- Default workflow is now 6 stages; earlier tests that hard-coded 5 stages were updated (assertions kept, not weakened). Test fake gained `limit`, thenable `findOne().select().lean()`, and two new collections.
- `workflowService`: stage context carries the stage; `failRequest` records `failure` and, for dependency errors, adds "No approval or rejection was made." to the decision reason.
- Message for a FAILED creation changed from "Application submitted" to "Application saved, but ...".
Not done (future, by design): automatic retries, exponential backoff, `WAITING_FOR_RETRY`, circuit breakers, BullMQ/Redis, distributed recovery, re-running `FAILED` requests.
Upgrade note: an existing database keeps its old workflow (no verification stage) until you add the stage on the Workflows page or run `npm run seed:workflows -- --force` (replaces ALL workflows). See README "Upgrading an existing database".
Verification note: tests run against the in-memory fake (no MongoDB/npm registry in the build sandbox); frontend JSX was compile- and import-checked with esbuild, `vite build` could not run offline.

## v7 - Phase 7: Idempotency and single workflow execution
Added:
- `Idempotency-Key` header on `POST /api/requests`; stored as `idempotencyKey` with a partial unique index; `payloadHash` detects reuse with a different payload (422).
- Duplicate-key (11000) handling: concurrent same-key calls return the winner's request; generated request-ID clashes are retried.
- Atomic execution claim (`executionState` PENDING -> RUNNING -> COMPLETED/FAILED, `executionStartedAt`, `executionError`); `COMPLETED` is set only after the last stage is saved; repeated/concurrent runs never duplicate `stageHistory` or execution records.
- `POST /api/requests/:requestId/execute` (safe to repeat). Consistent response shape (`idempotent`, `processing`, `executionState`) with 201 / 200 / 202 / 422.
- Frontend: per-submission key, reused on retry after network/server failure, renewed for new submissions; banners for existing / still-processing requests; execution state on Request Details.
- 14 new backend tests (46 total), then 3 more (49 total) in the Phase 7 verification pass below.
Changed:
- `workflowService`: `runWorkflow()` (claims then executes; `executeWorkflow()` kept as a wrapper); failures now always leave `RUNNING` (status kept if a decision was already recorded).
- `createRequest` responds through one shared response builder (a finished new request is still 201 with the same fields plus the new ones).
Phase 7 verification pass (hardening, no behaviour change for new requests):
- `server.js` awaits `WorkflowRequest.init()` after connecting so the unique idempotency index is built (and any failure is logged) before it is relied on.
- The execution claim matches `executionState` of `PENDING` **or missing**, so requests created before Phase 7 can still be executed exactly once instead of reporting "being executed" forever.
- Tests: legacy-request execution; real-Mongoose-schema check of the unique partial index and of real duplicate-key error shapes (`tests/idempotencySchema.test.js`, skipped when dependencies are not installed). Test fake now supports `$in`.
- README: "Index readiness" and "Manual check against MongoDB" sections. Frontend JSX/JS was compile-checked with esbuild (full `vite build` could not run offline).
Not done (future): automatic retries, BullMQ/Redis, external dependency simulation, circuit breakers, stuck-run recovery, key expiry.
Upgrade note: the unique index is created by Mongoose on startup (`autoIndex`); existing requests keep working (no key, state treated as finished).

## v6 - Phase 6: Configurable workflows
Added:
- `WorkflowDefinition` model reworked: `key, name, description, enabled, stages[{stageId,name,type,description}], transitions[{from,to,outcome}]`.
- Default `loan-approval` workflow (5 stages, outcome transitions for APPROVED / REJECTED / MANUAL_REVIEW), auto-seeded when empty; `npm run seed:workflows`.
- `workflowService` now loads the enabled workflow from MongoDB and follows stored transitions (stage-type handlers, Rules Engine outcome selects the transition); `request.stageHistory`; safe FAILED handling for missing/invalid configuration.
- `/api/workflows` GET, GET :id, POST, PUT :id, DELETE :id (active workflow cannot be deleted); `validators/workflowValidator.js` (also run at execution time).
- Workflows page: list, view, create/edit stages and transitions, enable/disable, delete, field-level validation errors. Request Details stage tracker driven by `stageHistory`.
- Tests: 14 new (33 total with the Phase 5 suites).
Changed:
- `GET /api/workflows` now reads only from MongoDB (503 without it); `isActive`/`rules`/`inputSchema` removed from the model (replaced by `enabled`/`transitions`); unique index is now on `key`.
- Stage `type` replaces hardcoded stage-name handlers. The fixed `STAGES` list was removed from the service.
Not done (future): versioning, retries, idempotency, external dependency simulation, BullMQ, advanced recovery.
Note: existing Phase 5 databases already containing old-format workflow documents are not migrated; run `npm run seed:workflows -- --force` (this deletes all workflows).

## v5 - Phase 5: Configurable Rules Engine
Added:
- `Rule` Mongoose model; `/api/rules` CRUD (POST, GET, GET :id, PUT :id, DELETE :id) with validation (`validators/ruleValidator.js`).
- `rulesEngine/` module: pure evaluator, operator registry (8 operators), optional AND/OR grouping, missing-field safety, default outcome `MANUAL_REVIEW` when nothing decides.
- Seed rules (`data/defaultRules.js`), auto-seeded when the `rules` collection is empty; `npm run seed:rules [-- --force]`.
- Rule evaluation trace stored on `WorkflowRequest.evaluationTrace` and in the INITIAL_EVALUATION execution record; `decision.ruleId`.
- Frontend: Rules page (list, view, create, edit, enable/disable, delete) + sidebar link; trace table and "decided by rule" on Request Details.
- Backend tests (`npm test`, 19 tests, node:test).
Changed:
- `workflowService` INITIAL_EVALUATION now calls the Rules Engine. Removed `services/evaluationRules.js` (hardcoded Phase 4 rules).
Not done (future phases): versioning, idempotency, Redis/BullMQ, retries, failure recovery, visual rule builder, multiple workflow types.
Verification note: built in a sandbox without MongoDB or npm network access; see README "Tests".

## v4 - Phase 4: Basic workflow execution and status management
Added:
- `services/workflowService.js` (5 stages, runs on submission), `services/evaluationRules.js` (isolated temporary rules), `services/statusTransitions.js` (valid-transition enforcement).
- `WorkflowExecution` model: one record per stage (requestId, stage, stageStatus, startedAt, completedAt, result).
- `GET /api/requests/stats` (counts per status); `GET /api/requests/:id` now returns `executionHistory`.
- Request Details: Decision card (outcome + reason), workflow stage tracker, execution history table.
- Dashboard: live Total / Approved / Rejected / Manual review / Pending counts.
Changed:
- `WorkflowRequest`: statuses are now PENDING, PROCESSING, APPROVED, REJECTED, MANUAL_REVIEW, COMPLETED, FAILED; `decision` is structured `{ outcome, reason, decidedAt }`; added `completedAt`; default `currentStage` is `REQUEST_RECEIVED`.
- Age validation minimum lowered from 18 to 1 (under-18 applications are now rejected by the workflow rather than at the API).
- Requests status filter lists the real statuses; Submit success message shows the resulting status.
Limitations: rules are hardcoded demo rules; no retries; workflow runs synchronously inside the POST request.

## v3 - Phase 3: Request listing, search and details
Added:
- `GET /api/requests` now searches request ID / name / email, filters by status, paginates (`totalPages`, `hasNext`, `hasPrev`), newest first.
- `GET /api/requests/:requestId` returns the full record, 404 if unknown.
- Requests page uses live data: search (debounced), status filter, pagination, loading / empty / error (with Retry) states, View Details.
- Request Details page loads from the API (applicant, income, employment, credit score, loan amount, description, status, submitted date) with loading and not-found states.
- Dashboard "Recent requests" card uses live data.
Changed:
- Requests list/details no longer fall back to sample data; they return 503 when MongoDB is not connected.
- Request Details no longer shows the Phase 1 placeholder cards (decision summary, execution history, audit); they would have shown fake data for real requests.
- `PENDING` added to the frontend status labels.
Unchanged: Submit Application, other Phase 1 pages.

## v2 - Phase 2: Database integration and request submission
Added:
- `POST /api/requests`: backend validation (required fields, email, numeric ranges), unique request ID (`REQ-<time>-<random>`), saved to MongoDB with status `PENDING`; returns saved request and `requestId`.
- `validators/requestValidator.js`; error handler now returns field `details`, and handles malformed JSON and duplicate keys.
- Frontend: Submit Application page (`/submit`) + sidebar link; Axios call, field errors, loading state, success banner with request ID, form reset.
Changed:
- `WorkflowRequest` model: flat fields (applicantName, email, age, monthlyIncome, employmentType, creditScore, loanAmount, description), `PENDING` status added. Request search uses `applicantName`.
Unchanged: all Phase 1 pages and behaviour.

## v1 - Phase 1: Application foundation
Added:
- Backend: Express app, env config, optional MongoDB connection, centralized error handling, `GET /api/health`.
- Backend: Mongoose models (User, WorkflowDefinition, WorkflowRequest, AuditLog) with extensible fields.
- Backend: read-only `/api/requests`, `/api/requests/:id`, `/api/workflows`, `/api/audit-logs` (sample data when no DB is connected; `meta.source` indicates which).
- Frontend: React + Vite + Tailwind admin shell (sidebar, top bar, responsive layout) and reusable UI components.
- Frontend pages: Dashboard, Requests (search/filter/pagination), Request Details, Workflow Configuration, Manual Review, Audit Logs, System Health.
- System Health shows live backend/database status from `/api/health`.

Placeholders (not real functionality): all other frontend data (`frontend/src/data/sampleData.js`), Approve/Reject buttons, Workflow View/Edit.
