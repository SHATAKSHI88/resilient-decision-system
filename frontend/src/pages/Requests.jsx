import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Button from '../components/ui/Button.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { STATUS_META, REQUEST_STATUSES } from '../data/sampleData.js';
import { getRequests, errorMessage } from '../services/api.js';
import { formatDate } from '../utils/format.js';

const PAGE_SIZE = 10;
const inputCls = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

export default function Requests() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // debounced search
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getRequests({ page, limit: PAGE_SIZE, search: query || undefined, status: status || undefined })
      .then((res) => {
        if (!active) return;
        setRows(res.data);
        setTotal(res.meta.total);
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [page, query, status, reload]);

  const columns = [
    { key: 'requestId', header: 'Request ID', className: 'font-medium text-slate-900' },
    { key: 'applicantName', header: 'Applicant Name' },
    { key: 'email', header: 'Email' },
    { key: 'createdAt', header: 'Submission Date', render: (r) => formatDate(r.createdAt) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <Link to={`/requests/${r.requestId}`}>
          <Button variant="ghost" size="sm">View Details</Button>
        </Link>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Requests" subtitle="All submitted workflow requests." />
      <Card>
        <div className="-m-5">
          <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
            <input className={`${inputCls} w-full sm:w-72`} placeholder="Search by ID, name or email..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className={inputCls} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              {REQUEST_STATUSES.map((k) => (
                <option key={k} value={k}>{STATUS_META[k].label}</option>
              ))}
            </select>
          </div>
          {error ? (
            <div className="px-4 py-8 text-center text-sm text-red-700">
              {error}{' '}
              <Button variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>Retry</Button>
            </div>
          ) : loading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Loading requests...</p>
          ) : (
            <>
              <Table columns={columns} rows={rows} rowKey="requestId" empty={query || status ? 'No requests match your search.' : 'No applications submitted yet.'} />
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
