import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import CallStatusBadge from '../components/ui/CallStatusBadge.jsx';
import RetryPanel from '../components/RetryPanel.jsx';
import { getRequest, errorMessage } from '../services/api.js';
import { formatCurrency, formatDateTime } from '../utils/format.js';

const stageLabel = (s) => s.replace(/_/g, ' ');

const Field = ({ label, children }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 text-sm text-slate-800">{children}</dd>
  </div>
);

const BackLink = () => (
  <Link to="/requests" className="text-sm font-medium text-brand-600 hover:underline">&larr; Back to requests</Link>
);

export default function RequestDetails() {
  const { id } = useParams();
  const [req, setReq] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // silent = refresh in place (no spinner, errors ignored) - used after a retry and while a retry is pending
  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); setReq(null); }
    try {
      setReq(await getRequest(id));
    } catch (err) {
      if (!silent) setError(err.response?.status === 404 ? `Request ${id} was not found.` : errorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // While a retry is scheduled or running, re-read the request every 3 s so the page follows what the retry worker does.
  const retryState = req?.retry?.state;
  const watching = retryState === 'SCHEDULED' || retryState === 'IN_PROGRESS' || req?.status === 'PROCESSING';
  useEffect(() => {
    if (!watching) return undefined;
    const t = setInterval(() => load(true), 3000);
    return () => clearInterval(t);
  }, [watching, load]);

  if (loading) return <p className="text-sm text-slate-500">Loading request...</p>;
  if (error) {
    return (
      <Card>
        <p className="text-sm text-slate-600">{error}</p>
        <div className="mt-2"><BackLink /></div>
      </Card>
    );
  }

  const history = req.executionHistory || [];
  // Phase 6 requests carry stageHistory; older ones fall back to their execution records.
  const stageSteps = req.stageHistory?.length
    ? req.stageHistory
    : history.map((h) => ({ stageId: h.stage, status: h.stageStatus, outcome: h.result?.outcome, error: h.result?.error }));

  return (
    <>
      <PageHeader title={`Request ${req.requestId}`} subtitle={req.requestType} actions={<BackLink />} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Applicant information">
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Name">{req.applicantName}</Field>
            <Field label="Email">{req.email}</Field>
            <Field label="Age">{req.age}</Field>
            <Field label="Employment type">{req.employmentType}</Field>
          </dl>
        </Card>
        <Card title="Financial details">
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Monthly income">{formatCurrency(req.monthlyIncome)}</Field>
            <Field label="Credit score">{req.creditScore}</Field>
            <Field label="Requested loan amount">{formatCurrency(req.loanAmount)}</Field>
          </dl>
        </Card>
        <Card title="Status">
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Current status"><StatusBadge status={req.status} /></Field>
            <Field label="Execution">{req.executionState ? req.executionState.toLowerCase() : '-'}</Field>
            <Field label="Current stage">{req.currentStage ? stageLabel(req.currentStage) : '-'}</Field>
            <Field label="Submitted">{formatDateTime(req.createdAt)}</Field>
            <Field label="Last updated">{formatDateTime(req.updatedAt)}</Field>
          </dl>
        </Card>
        <Card title="Decision">
          {req.decision?.reason ? (
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Outcome">{req.decision.outcome ? <StatusBadge status={req.decision.outcome} /> : <StatusBadge status={req.status} />}</Field>
              <Field label="Decided at">{req.decision.decidedAt ? formatDateTime(req.decision.decidedAt) : '-'}</Field>
              {req.decision.ruleId && <Field label="Decided by rule"><span className="font-mono text-xs">{req.decision.ruleId}</span></Field>}
              <div className="col-span-2"><Field label="Reason">{req.decision.reason}</Field></div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No decision has been recorded for this request.</p>
          )}
        </Card>
        <Card title="Application description">
          <p className="whitespace-pre-wrap text-sm text-slate-700">{req.description || 'No description provided.'}</p>
        </Card>
        <Card title="Workflow stages" className="lg:col-span-2">
          {stageSteps.length === 0 ? (
            <p className="text-sm text-slate-500">No stages were executed.</p>
          ) : (
            <ol className="flex flex-wrap gap-3">
              {stageSteps.map((h, i) => {
                const tone = h.status === 'FAILED' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-green-200 bg-green-50 text-green-700';
                return (
                  <li key={`${h.stageId}-${i}`} className={`rounded-md border px-3 py-2 text-xs font-medium ${tone}`}>
                    {i + 1}. {h.stageName || stageLabel(h.stageId)}
                    <span className="ml-1 font-normal">({h.status.toLowerCase()}{h.outcome ? `, ${h.outcome.replace('_', ' ').toLowerCase()}` : ''}{h.attempt > 0 ? `, retry #${h.attempt}` : ''})</span>
                    {h.error && <div className="mt-1 font-normal">{h.error}</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <RetryPanel req={req} onChanged={() => load(true)} />
        {req.failure?.kind && (
          <Card title="Failure details" className="lg:col-span-2">
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-semibold">
                {req.failure.kind === 'DEPENDENCY_TIMEOUT' ? 'The external verification service timed out.'
                  : req.failure.kind === 'DEPENDENCY_FAILURE' ? 'The external verification service returned an error.'
                  : 'The workflow failed.'}
              </p>
              <p className="mt-1">{req.failure.message}</p>
              <p className="mt-2 text-xs text-red-700">
                {req.failure.dependency && <>Dependency: <span className="font-mono">{req.failure.dependency}</span>. </>}
                Failed {formatDateTime(req.failure.at)}. The application data and the stages completed before the failure are preserved; no approval or rejection was made.
              </p>
            </div>
          </Card>
        )}
        <Card title="External dependency calls" className="lg:col-span-2">
          <div className="-m-5">
            <Table
              rowKey="_id"
              empty="No external dependency calls were made for this request."
              columns={[
                { key: 'dependency', header: 'Dependency', render: (c) => <span className="font-mono text-xs">{c.dependency}</span> },
                { key: 'status', header: 'Status', render: (c) => <CallStatusBadge status={c.status} /> },
                { key: 'attempt', header: 'Attempt', render: (c) => `#${c.attempt}` },
                { key: 'attemptedAt', header: 'Attempted', render: (c) => formatDateTime(c.attemptedAt) },
                { key: 'durationMs', header: 'Duration', render: (c) => `${c.durationMs} ms` },
                { key: 'error', header: 'Error / result', render: (c) => c.error || (c.response?.reference ? `Verified (${c.response.reference})` : '-') },
              ]}
              rows={req.dependencyCalls || []}
            />
          </div>
        </Card>
        <Card title="Rule evaluation trace" className="lg:col-span-2">
          <div className="-m-5">
            <Table
              rowKey="seq"
              empty="No rule evaluation trace recorded for this request."
              columns={[
                { key: 'ruleName', header: 'Rule', render: (t) => <span title={t.ruleId}>{t.ruleName} <span className="font-mono text-xs text-slate-400">{t.ruleId}</span></span> },
                { key: 'field', header: 'Field' },
                { key: 'actualValue', header: 'Actual', render: (t) => (t.actualValue === null || t.actualValue === undefined ? '(missing)' : String(t.actualValue)) },
                { key: 'operator', header: 'Operator', render: (t) => t.operator.replace(/_/g, ' ') },
                { key: 'expectedValue', header: 'Expected', render: (t) => (Array.isArray(t.expectedValue) ? t.expectedValue.join(', ') : String(t.expectedValue)) },
                { key: 'result', header: 'Result', render: (t) => <Badge tone={t.result === 'PASS' ? 'green' : 'slate'}>{t.result}</Badge> },
                { key: 'actionTriggered', header: 'Action', render: (t) => t.actionTriggered },
                { key: 'evaluatedAt', header: 'Evaluated', render: (t) => formatDateTime(t.evaluatedAt) },
              ]}
              rows={(req.evaluationTrace || []).map((t, i) => ({ ...t, seq: i }))}
            />
          </div>
        </Card>
        <Card title="Execution history" className="lg:col-span-2">
          <div className="-m-5">
            <Table
              rowKey="_id"
              empty="No execution history recorded."
              columns={[
                { key: 'stage', header: 'Stage', render: (h) => stageLabel(h.stage) },
                { key: 'attempt', header: 'Run', render: (h) => (h.attempt > 0 ? `Retry #${h.attempt}` : 'Initial') },
                { key: 'stageStatus', header: 'Status', render: (h) => <StatusBadge status={h.stageStatus} /> },
                { key: 'startedAt', header: 'Started', render: (h) => formatDateTime(h.startedAt) },
                { key: 'completedAt', header: 'Completed', render: (h) => formatDateTime(h.completedAt) },
                { key: 'result', header: 'Result', render: (h) => h.result?.error || h.result?.message || '-' },
              ]}
              rows={history}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
