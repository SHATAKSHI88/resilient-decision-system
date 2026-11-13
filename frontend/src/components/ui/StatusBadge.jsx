import Badge from './Badge.jsx';
import { STATUS_META } from '../../data/sampleData.js';

export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, tone: 'slate' };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
