import Badge from './Badge.jsx';

const META = { SUCCESS: { label: 'Success', tone: 'green' }, FAILURE: { label: 'Failure', tone: 'red' }, TIMEOUT: { label: 'Timeout', tone: 'amber' } };

// Status of one call to an external dependency.
export default function CallStatusBadge({ status }) {
  const m = META[status] || { label: status, tone: 'slate' };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
