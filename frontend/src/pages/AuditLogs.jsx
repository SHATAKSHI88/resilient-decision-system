import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import SampleNotice from '../components/ui/SampleNotice.jsx';
import { auditLogs } from '../data/sampleData.js';
import { formatDateTime } from '../utils/format.js';

export default function AuditLogs() {
  const columns = [
    { key: 'ts', header: 'Timestamp', render: (l) => formatDateTime(l.ts) },
    { key: 'requestId', header: 'Request ID', className: 'font-medium text-slate-900' },
    { key: 'action', header: 'Action', render: (l) => <Badge tone="blue">{l.action}</Badge> },
    { key: 'prev', header: 'Previous State' },
    { key: 'next', header: 'New State' },
    { key: 'description', header: 'Description' },
  ];

  return (
    <>
      <PageHeader title="Audit Logs" subtitle="Chronological record of request state changes." />
      <SampleNotice>Sample entries. Real audit logging is planned for a later phase.</SampleNotice>
      <Card>
        <div className="-m-5">
          <Table columns={columns} rows={auditLogs} />
        </div>
      </Card>
    </>
  );
}
