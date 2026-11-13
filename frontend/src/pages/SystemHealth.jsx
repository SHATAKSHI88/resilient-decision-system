import { useEffect, useState } from 'react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import SampleNotice from '../components/ui/SampleNotice.jsx';
import DependencyPanel, { DEP_STATE } from '../components/DependencyPanel.jsx';
import RetryConfigPanel from '../components/RetryConfigPanel.jsx';
import { getHealth, getVerificationDependency, getRetryConfig, errorMessage } from '../services/api.js';
import { failedJobs, systemActivity } from '../data/sampleData.js';
import { formatDateTime } from '../utils/format.js';

function StatusTile({ label, value, tone, note }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2"><Badge tone={tone}>{value}</Badge></div>
      {note && <p className="mt-2 text-xs text-slate-400">{note}</p>}
    </div>
  );
}

export default function SystemHealth() {
  const [health, setHealth] = useState({ loading: true });
  const [dep, setDep] = useState({ loading: true });
  const [retry, setRetry] = useState({ loading: true });

  const loadDependency = () =>
    getVerificationDependency()
      .then((data) => setDep({ data }))
      .catch((err) => setDep({ error: err.response?.status === 503 ? 'Database unavailable - dependency status needs MongoDB.' : errorMessage(err) }));

  useEffect(() => {
    getRetryConfig()
      .then((data) => setRetry({ data }))
      .catch((err) => setRetry({ error: err.response?.status === 503 ? 'Database unavailable - retry settings need MongoDB.' : errorMessage(err) }));
    getHealth()
      .then((data) => setHealth({ data }))
      .catch(() => setHealth({ error: true }));
    loadDependency();
  }, []);

  const depMeta = dep.loading ? { label: 'Checking...', tone: 'slate' } : dep.error ? { label: 'Unavailable', tone: 'slate' } : DEP_STATE[dep.data.state];

  const backend = health.loading
    ? { value: 'Checking...', tone: 'slate' }
    : health.error
    ? { value: 'Unreachable', tone: 'red' }
    : { value: 'Online', tone: 'green' };

  const db = health.data?.database;
  const dbTile = health.loading
    ? { value: 'Checking...', tone: 'slate' }
    : health.error
    ? { value: 'Unknown', tone: 'slate' }
    : db === 'connected'
    ? { value: 'Connected', tone: 'green' }
    : { value: 'Not connected', tone: 'amber' };

  return (
    <>
      <PageHeader title="System Health" subtitle="Service and dependency status." />
      <SampleNotice>Backend, database and the verification service are live. Failed jobs and recent activity below are placeholders.</SampleNotice>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatusTile label="Backend status" {...backend} note={health.data ? `Uptime ${health.data.uptimeSeconds}s` : undefined} />
        <StatusTile label="Database" {...dbTile} note="Live mongoose connection state" />
        <StatusTile label="Verification service" value={depMeta.label} tone={depMeta.tone} note="Simulated external dependency" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DependencyPanel dep={dep} onChanged={loadDependency} />
        <RetryConfigPanel retry={retry} />

        <Card title="Failed jobs (placeholder)">
          <div className="-m-5">
            <Table
              columns={[
                { key: 'id', header: 'Job' },
                { key: 'requestId', header: 'Request' },
                { key: 'reason', header: 'Reason' },
                { key: 'attempts', header: 'Attempts' },
                { key: 'at', header: 'When', render: (j) => formatDateTime(j.at) },
              ]}
              rows={failedJobs}
            />
          </div>
        </Card>
      </div>

      <Card title="Recent system activity (placeholder)" className="mt-6">
        <ul className="space-y-3">
          {systemActivity.map((a, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-12 shrink-0 text-xs text-slate-400">{a.time}</span>
              <span className="text-slate-700">{a.text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
