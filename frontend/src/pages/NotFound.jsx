import { Link } from 'react-router-dom';
import Card from '../components/ui/Card.jsx';

export default function NotFound() {
  return (
    <Card>
      <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
      <p className="mt-1 text-sm text-slate-600">The page you requested does not exist.</p>
      <Link to="/" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">Go to dashboard</Link>
    </Card>
  );
}
