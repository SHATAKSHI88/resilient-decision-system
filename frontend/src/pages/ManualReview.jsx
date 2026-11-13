import { Link } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Button from '../components/ui/Button.jsx';
import SampleNotice from '../components/ui/SampleNotice.jsx';
import { requests } from '../data/sampleData.js';
import { formatCurrency, formatDate } from '../utils/format.js';

export default function ManualReview() {
  const rows = requests.filter((r) => r.status === 'manual_review');

  const columns = [
    { key: 'id', header: 'Request ID', render: (r) => <Link className="font-medium text-brand-600 hover:underline" to={`/requests/${r.id}`}>{r.id}</Link> },
    { key: 'applicant', header: 'Applicant' },
    { key: 'amount', header: 'Loan Amount', render: (r) => formatCurrency(r.data.loanAmount) },
    { key: 'creditScore', header: 'Credit Score', render: (r) => r.data.creditScore },
    { key: 'submittedAt', header: 'Submitted', render: (r) => formatDate(r.submittedAt) },
    {
      key: 'actions',
      header: 'Decision',
      render: () => (
        <div className="flex gap-2">
          <Button variant="success" size="sm" disabled title="Placeholder - not wired to backend">Approve</Button>
          <Button variant="danger" size="sm" disabled title="Placeholder - not wired to backend">Reject</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Manual Review" subtitle="Applications awaiting a human decision." />
      <SampleNotice>Approve/Reject buttons are UI placeholders and do not change any data.</SampleNotice>
      <Card>
        <div className="-m-5">
          <Table columns={columns} rows={rows} empty="Nothing awaiting review." />
        </div>
      </Card>
    </>
  );
}
