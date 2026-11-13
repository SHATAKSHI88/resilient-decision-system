import Card from './ui/Card.jsx';
import Badge from './ui/Badge.jsx';
import { formatDateTime, formatDuration, retryDelay } from '../utils/format.js';

const Tile = ({ label, value, note }) => (
  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
  </div>
);

// Retry policy (read-only), worker status and how many requests are waiting. Data: GET /api/retries/config.
// Change the policy with PUT /api/retries/config (see README).
export default function RetryConfigPanel({ retry }) {
  if (retry.loading) return <Card title="Retry policy" className="lg:col-span-2"><p className="text-sm text-slate-500">Loading...</p></Card>;
  if (retry.error) return <Card title="Retry policy" className="lg:col-span-2"><p className="text-sm text-red-700">{retry.error}</p></Card>;

  const { config, worker, counts } = retry.data;
  const schedule = Array.from({ length: config.maxAttempts }, (_, i) => retryDelay(i, config));

  return (
    <Card title="Retry policy" className="lg:col-span-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Max retry attempts" value={config.maxAttempts} note={config.maxAttempts === 0 ? 'Automatic retries are off' : 'Automatic retries per request'} />
        <Tile label="Initial delay" value={formatDuration(config.initialDelayMs)} />
        <Tile label="Backoff multiplier" value={`x${config.backoffMultiplier}`} />
        <Tile label="Maximum delay" value={formatDuration(config.maxDelayMs)} />
      </div>
      <p className="mt-3 text-sm text-slate-600">
        {schedule.length
          ? <>Delay before each automatic retry: {schedule.map((d, i) => <span key={i}>{i > 0 && ', '}<b>#{i + 1}</b> {formatDuration(d)}</span>)}.{' '}</>
          : null}
        <span className="text-xs text-slate-500">delay = min(initial &times; multiplier<sup>retry count</sup>, maximum). Only temporary dependency failures are retried automatically.</span>
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
        <span>Retry worker: <Badge tone={worker.running ? 'green' : 'amber'}>{worker.running ? 'Running' : worker.enabled ? 'Stopped' : 'Disabled'}</Badge></span>
        <span>Checks every {formatDuration(worker.intervalMs)}</span>
        <span>Last check: {worker.lastTickAt ? formatDateTime(worker.lastTickAt) : 'not yet'}</span>
        <span><b>{counts.scheduled}</b> scheduled, <b>{counts.inProgress}</b> running, <b>{counts.exhausted}</b> out of attempts</span>
      </div>
      {worker.lastError && <p role="alert" className="mt-2 text-sm text-red-700">Last worker error: {worker.lastError}</p>}
      {config.updatedAt && <p className="mt-2 text-xs text-slate-400">Policy last changed {formatDateTime(config.updatedAt)}. Edit it with <span className="font-mono">PUT /api/retries/config</span>.</p>}
    </Card>
  );
}
