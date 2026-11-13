import { Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import SubmitApplication from './pages/SubmitApplication.jsx';
import Requests from './pages/Requests.jsx';
import RequestDetails from './pages/RequestDetails.jsx';
import Workflows from './pages/Workflows.jsx';
import Rules from './pages/Rules.jsx';
import ManualReview from './pages/ManualReview.jsx';
import AuditLogs from './pages/AuditLogs.jsx';
import SystemHealth from './pages/SystemHealth.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="submit" element={<SubmitApplication />} />
        <Route path="requests" element={<Requests />} />
        <Route path="requests/:id" element={<RequestDetails />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="rules" element={<Rules />} />
        <Route path="manual-review" element={<ManualReview />} />
        <Route path="audit-logs" element={<AuditLogs />} />
        <Route path="system-health" element={<SystemHealth />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
