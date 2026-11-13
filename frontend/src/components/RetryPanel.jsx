import { useEffect, useRef, useState } from 'react';
import Card from './ui/Card.jsx';
import Table from './ui/Table.jsx';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import { retryRequest, errorMessage } from '../services/api.js';
import { formatDateTime, formatDuration } from '../utils/format.js';

export const RETRY_STATE = {
  SCHEDULED: { label: 'Retry scheduled', tone: 'amber' },
  IN_PROGRESS: { label: 'Retry in progress', tone: 'blue' },
  EXHAUSTED: { label: 'Automatic retries used up', tone: 'red' },
  NOT_RETRYABLE: { label: 'Not retryable', tone: 'slate' },
  RECOVERED: { label: 'Recovered', tone: 'green' },
};
const OUTCOME = { RUNNING: { label: 'Running', tone: 'blue' }, SUCCEEDED: { label: 'Succeeded', tone: 'green' }, FAILED: { label: 'Failed', tone: 'red' }, INTERRUPTED: { label: 'Interrupted', tone: 'amber' } };

const Field = ({ label, children }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 text-sm text-slate-800">{children}</dd>
  </div>
);

const NOTICE_TONE = { info: 'border-blue-200 bg-blue-50 text-blue-800', ok: 'border-green-200 bg-green-50 text-green-800', warn: 'border-amber-200 bg-amber-50 text-amber-800', error: 'border-red-200 bg-red-50 text-red-800' };

// Retry count, next retry time, last failure, retry history and the manual retry action of one request.
// `req` comes from GET /api/requests/:id; `onChanged` reloads it. The page polls while a retry is pending, so the notices below
// ("scheduled", "started", "completed") also appear for automatic retries performed by the background worker.
export default function RetryPanel({ req, onChanged }) {
  const r = req.retry || {};
  const state = r.state;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text }
  const prev = useRef(null);
  const [now, setNow] = useState(Date.now());

  const ticking = state === 'SCHEDULED' && !!r.nextRetryAt;
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  // Turn changes between two loads of the request into feedback (covers retries started by the worker, not only by the button).
  useEffect(() => {
    const before = prev.current;
    prev.current = { state, count: r.count || 0 };
    if (!before || busy || (before.state === state && before.count === (r.count || 0))) return;
    const n = r.count || 0;
    if (state === 'IN_PROGRESS') setNotice({ tone: 'info', text: `Retry #${n} started...` });
    else if (before.state === 'IN_PROGRESS' && state === 'RECOVERED') setNotice({ tone: 'ok', text: `Retry #${n} completed: the request recovered and is now ${req.status.replace('_', ' ').toLowerCase()}.` });
    else if (before.state === 'IN_PROGRESS' && state === 'SCHEDULED') setNotice({ tone: 'warn', text: `Retry #${n} failed again. Retry #${n + 1} is scheduled for ${formatDateTime(r.nextRetryAt)}.` });
    else if (before.state === 'IN_PROGRESS') setNotice({ tone: 'error', text: `Retry #${n} failed again. No further automatic retry is scheduled.` });
    else if (state === 'SCHEDULED') setNotice({ tone: 'warn', text: `Retry #${n + 1} scheduled for ${formatDateTime(r.nextRetryAt)}.` });
  }, [state, r.count, r.nextRetryAt, req.status, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state && req.status !== 'FAILED') return null; // nothing to show for requests that never failed

  const manual = req.manualRetry || { eligible: false };
  const total = r.maxAttempts;

  const retryNow = async () => {
    setBusy(true);
    setNotice({ tone: 'info', text: 'Retry started... the verification step is being run again.' });
    try {
      const res = await retryRequest(req.requestId);
      setNotice({ tone: res.succeeded ? 'ok' : 'warn', text: res.message });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
      await onChanged();
    }
  };

  const next = r.nextRetryAt ? new Date(r.nextRetryAt) : null;
  const wait = next ? next.getTime() - now : null;
  const history = [...(r.history || [])].reverse();

  return (
    <Card
      title="Retries"
      className="lg:col-span-2"
      action={manual.eligible && (
        <Button size="sm" onClick={retryNow} disabled={busy}>{busy ? 'Retrying...' : 'Retry now'}</Button>
      )}
    >
      {notice && <p role="status" className={`mb-4 rounded-md border px-3 py-2 text-sm ${NOTICE_TONE[notice.tone]}`}>{notice.text}</p>}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Retry state">{state ? <Badge tone={RETRY_STATE[state].tone}>{RETRY_STATE[state].label}</Badge> : <Badge>Not scheduled</Badge>}</Field>
        <Field label="Retries so far">{r.count || 0}{total !== undefined && total !== null ? ` (automatic limit ${total})` : ''}</Field>
        <Field label="Next retry">
          {state === 'SCHEDULED' && next
            ? <>{formatDateTime(next)} <span className="text-xs text-slate-500">({wait > 0 ? `in ${formatDuration(Math.ceil(wait / 1000) * 1000)}` : 'due now, waiting for the worker'})</span></>
            : state === 'IN_PROGRESS' ? 'Running now' : '-'}
        </Field>
        <Field label="Last failure">
          {r.lastError ? <><span className="font-mono text-xs">{r.lastError.kind}</span><div className="text-xs text-slate-500">{formatDateTime(r.lastError.at)}</div></> : '-'}
        </Field>
        {r.lastError?.message && <div className="col-span-2 sm:col-span-4"><Field label="Last error message">{r.lastError.message}</Field></div>}
      </dl>

      {!manual.eligible && req.status === 'FAILED' && manual.reason && <p className="mt-3 text-xs text-slate-500">Manual retry unavailable: {manual.reason}</p>}
      {manual.eligible && state === 'SCHEDULED' && <p className="mt-3 text-xs text-slate-500">&ldquo;Retry now&rdquo; runs the retry immediately and replaces the scheduled automatic retry.</p>}
      {manual.eligible && state === 'EXHAUSTED' && <p className="mt-3 text-xs text-slate-500">Automatic retries are used up. An operator can still retry manually.</p>}

      <h4 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Retry history</h4>
      <div className="-mx-5 -mb-5">
        <Table
          rowKey="attempt"
          empty="No retries have been made yet."
          columns={[
            { key: 'attempt', header: 'Retry', render: (h) => `#${h.attempt}` },
            { key: 'trigger', header: 'Triggered by', render: (h) => (h.trigger === 'MANUAL' ? `Manual (${h.initiatedBy || 'operator'})` : 'Automatic (worker)') },
            { key: 'startedAt', header: 'Started', render: (h) => formatDateTime(h.startedAt) },
            { key: 'completedAt', header: 'Completed', render: (h) => (h.completedAt ? formatDateTime(h.completedAt) : '-') },
            { key: 'outcome', header: 'Outcome', render: (h) => <Badge tone={(OUTCOME[h.outcome] || OUTCOME.RUNNING).tone}>{(OUTCOME[h.outcome] || { label: h.outcome }).label}</Badge> },
            { key: 'error', header: 'Error', render: (h) => h.error || '-' },
          ]}
          rows={history}
        />
      </div>
    </Card>
  );
}
