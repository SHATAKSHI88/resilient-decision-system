import { useEffect, useState } from 'react';
import Card from './ui/Card.jsx';
import Table from './ui/Table.jsx';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import CallStatusBadge from './ui/CallStatusBadge.jsx';
import { updateVerificationConfig, testVerificationDependency, errorMessage } from '../services/api.js';
import { formatDateTime } from '../utils/format.js';

export const DEP_STATE = {
  HEALTHY: { label: 'Healthy', tone: 'green' },
  DEGRADED: { label: 'Degraded', tone: 'amber' },
  DOWN: { label: 'Down', tone: 'red' },
  UNKNOWN: { label: 'No calls yet', tone: 'slate' },
};

const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';
const toForm = (c) => ({ outcome: c.outcome, delayMs: String(c.delayMs), timeoutMs: String(c.timeoutMs), failureProbability: String(c.failureProbability) });

// Live status + settings of the simulated verification service (GET/PUT /api/dependencies/verification...).
export default function DependencyPanel({ dep, onChanged }) {
  const config = dep.data?.config;
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState(null); // { tone: 'ok' | 'error', text }
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => { if (config && !form) setForm(toForm(config)); }, [config, form]);

  if (dep.loading) return <Card title="Verification service (simulated)"><p className="text-sm text-slate-500">Loading...</p></Card>;
  if (dep.error) return <Card title="Verification service (simulated)"><p className="text-sm text-red-700">{dep.error}</p></Card>;

  const { state, counts, averageDurationMs, lastCall, recentCalls } = dep.data;
  const meta = DEP_STATE[state] || DEP_STATE.UNKNOWN;
  const onChange = (e) => { setForm((f) => ({ ...f, [e.target.name]: e.target.value })); setErrors((er) => ({ ...er, [e.target.name]: undefined })); };

  const run = async (kind) => {
    setBusy(kind); setMsg(null); setErrors({}); setTestResult(null);
    try {
      if (kind === 'save') {
        const saved = await updateVerificationConfig(form);
        setForm(toForm(saved));
        setMsg({ tone: 'ok', text: 'Settings saved. New workflow runs use them immediately.' });
      } else {
        const res = await testVerificationDependency(form); // form values are used for this call only (not saved)
        setTestResult(res.data.call);
      }
      await onChanged();
    } catch (err) {
      const apiErr = err.response?.data?.error;
      if (apiErr?.details) setErrors(apiErr.details);
      setMsg({ tone: 'error', text: apiErr?.message || errorMessage(err) });
    } finally { setBusy(''); }
  };

  const field = (name, label, props = {}) => (
    <div>
      <label htmlFor={`dep-${name}`} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input id={`dep-${name}`} name={name} value={form?.[name] ?? ''} onChange={onChange} className={inputCls} {...props} />
      {errors[name] && <p className="mt-1 text-xs text-red-600">{errors[name]}</p>}
    </div>
  );

  return (
    <Card title="Verification service (simulated)" className="lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
        <span>Status: <Badge tone={meta.tone}>{meta.label}</Badge></span>
        <span>Last {counts.total} calls: <b className="text-green-700">{counts.success} ok</b>, <b className="text-red-700">{counts.failure} failed</b>, <b className="text-amber-700">{counts.timeout} timed out</b></span>
        {averageDurationMs !== null && <span>Average response: {averageDurationMs} ms</span>}
        {lastCall && <span>Last call: <CallStatusBadge status={lastCall.status} /> {formatDateTime(lastCall.attemptedAt)}</span>}
      </div>

      {form && (
        <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
          <div>
            <label htmlFor="dep-outcome" className="mb-1 block text-sm font-medium text-slate-700">Outcome</label>
            <select id="dep-outcome" name="outcome" value={form.outcome} onChange={onChange} className={inputCls}>
              <option value="SUCCESS">SUCCESS</option><option value="FAILURE">FAILURE</option><option value="TIMEOUT">TIMEOUT</option>
            </select>
            {errors.outcome && <p className="mt-1 text-xs text-red-600">{errors.outcome}</p>}
          </div>
          {field('delayMs', 'Response delay (ms)', { type: 'number', min: 0, max: 30000 })}
          {field('timeoutMs', 'Timeout (ms)', { type: 'number', min: 10, max: 30000 })}
          {field('failureProbability', 'Random failure chance (0-1)', { type: 'number', min: 0, max: 1, step: 0.05 })}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
            <Button type="button" onClick={() => run('save')} disabled={!!busy}>{busy === 'save' ? 'Saving...' : 'Save settings'}</Button>
            <Button type="button" variant="secondary" onClick={() => run('test')} disabled={!!busy}>{busy === 'test' ? 'Calling...' : 'Test call with these values'}</Button>
            <span className="text-xs text-slate-500">SUCCESS can still fail at random (chance above). A delay longer than the timeout is a TIMEOUT. The test call does not save the values.</span>
          </div>
        </div>
      )}

      {msg && <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${msg.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>{msg.text}</p>}
      {testResult && (
        <p role="status" className="mt-3 text-sm text-slate-700">
          Test call: <CallStatusBadge status={testResult.status} /> in {testResult.durationMs} ms{testResult.error ? ` - ${testResult.error}` : testResult.response?.reference ? ` - reference ${testResult.response.reference}` : ''}
        </p>
      )}

      <h4 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Recent calls</h4>
      <div className="-mx-5 -mb-5">
        <Table
          rowKey="_id"
          empty="No calls recorded yet. Submit an application or run a test call."
          columns={[
            { key: 'attemptedAt', header: 'When', render: (c) => formatDateTime(c.attemptedAt) },
            { key: 'status', header: 'Status', render: (c) => <CallStatusBadge status={c.status} /> },
            { key: 'source', header: 'Source', render: (c) => (c.requestId ? <span className="font-mono text-xs">{c.requestId}</span> : 'Test call') },
            { key: 'durationMs', header: 'Duration', render: (c) => `${c.durationMs} ms` },
            { key: 'error', header: 'Error', render: (c) => c.error || '-' },
          ]}
          rows={recentCalls}
        />
      </div>
    </Card>
  );
}
