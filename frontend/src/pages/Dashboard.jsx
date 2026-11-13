import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import SampleNotice from '../components/ui/SampleNotice.jsx';
import { processingTrend, statusDistribution, systemActivity } from '../data/sampleData.js';
import { getRequests, getStats, errorMessage } from '../services/api.js';
import { formatDate } from '../utils/format.js';

const KPIS = [
  { key: 'total', label: 'Total requests', accent: 'text-slate-900' },
  { key: 'APPROVED', label: 'Approved', accent: 'text-green-600' },
  { key: 'REJECTED', label: 'Rejected', accent: 'text-red-600' },
  { key: 'MANUAL_REVIEW', label: 'Manual review', accent: 'text-amber-600' },
  { key: 'PENDING', label: 'Pending', accent: 'text-slate-600' },
];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState('');
  const [recent, setRecent] = useState([]);
  const [recentState, setRecentState] = useState('loading'); // loading | ok | error
  const [recentError, setRecentError] = useState('');

  useEffect(() => {
    let active = true;
    getRequests({ page: 1, limit: 6 })
      .then((res) => {
        if (!active) return;
        setRecent(res.data);
        setRecentState('ok');
      })
      .catch((err) => {
        if (!active) return;
        setRecentError(errorMessage(err));
        setRecentState('error');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getStats()
      .then((d) => active && setStats(d))
      .catch((err) => active && setStatsError(errorMessage(err)));
    return () => {
      active = false;
    };
  }, []);

  const columns = [
    { key: 'requestId', header: 'Request ID', render: (r) => <Link className="font-medium text-brand-600 hover:underline" to={`/requests/${r.requestId}`}>{r.requestId}</Link> },
    { key: 'applicantName', header: 'Applicant' },
    { key: 'createdAt', header: 'Submitted', render: (r) => formatDate(r.createdAt) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of request processing across all workflows." />
      <SampleNotice>Charts and system activity are sample data. Status counts and recent requests are live from the database.</SampleNotice>

      {statsError && <p className="mb-3 text-sm text-red-700">Could not load status counts: {statsError}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {KPIS.map((k) => (
          <div key={k.key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
            <p className={`mt-2 text-2xl font-semibold ${k.accent}`}>{stats ? stats[k.key].toLocaleString('en-IN') : '-'}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Request processing analytics" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={processingTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="received" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="processed" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Status distribution">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusDistribution} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {statusDistribution.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Recent requests" className="lg:col-span-2" action={<Link to="/requests" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>}>
          <div className="-m-5">
            {recentState === 'loading' && <p className="px-4 py-8 text-center text-sm text-slate-500">Loading recent requests...</p>}
            {recentState === 'error' && <p className="px-4 py-8 text-center text-sm text-red-700">{recentError}</p>}
            {recentState === 'ok' && <Table columns={columns} rows={recent} rowKey="requestId" empty="No applications submitted yet." />}
          </div>
        </Card>

        <Card title="System activity">
          <ul className="space-y-3">
            {systemActivity.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="w-12 shrink-0 text-xs text-slate-400">{a.time}</span>
                <span className="text-slate-700">{a.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
