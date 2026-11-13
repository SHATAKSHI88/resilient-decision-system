import { useRef, useState } from 'react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { submitRequest } from '../services/api.js';

const EMPLOYMENT_TYPES = ['Salaried', 'Self-Employed', 'Business Owner', 'Retired', 'Unemployed'];
const EMPTY = { applicantName: '', email: '', age: '', monthlyIncome: '', employmentType: '', creditScore: '', loanAmount: '', description: '' };
// One idempotency key per submission attempt (crypto.randomUUID needs a secure context; fall back otherwise).
const newKey = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

function Field({ label, name, error, children }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function SubmitApplication() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null); // { requestId, status, existing, processing }
  // The key for the submission in progress. Kept after a network/server failure so retrying the SAME form reuses it
  // (no duplicate); dropped after success, validation errors, or when the form content changes (a genuinely new submission).
  const attempt = useRef(null); // { key, sig }
  const inFlight = useRef(false);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((er) => ({ ...er, [name]: undefined }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (inFlight.current) return; // second guard besides the disabled button; the server key is the real protection
    inFlight.current = true;
    setLoading(true);
    setErrors({});
    setFormError('');
    setSuccess(null);
    const sig = JSON.stringify(form);
    if (!attempt.current || attempt.current.sig !== sig) attempt.current = { key: newKey(), sig };
    try {
      const res = await submitRequest(form, attempt.current.key);
      setSuccess({ requestId: res.requestId, status: res.data?.status, existing: !!res.idempotent, processing: !!res.processing, failure: res.failure ? res.message : null });
      if (!res.processing) { attempt.current = null; setForm(EMPTY); } // still processing: keep form + key so a retry maps to the same request
    } catch (err) {
      const apiErr = err.response?.data?.error;
      const code = err.response?.status;
      if (code === 400 || code === 422) attempt.current = null; // definitively not created: next submit is a new attempt
      if (apiErr?.details) setErrors(apiErr.details);
      setFormError(
        apiErr?.message ||
          (err.response
            ? 'The server had a problem. Press Submit again to retry safely - the same submission key is reused, so no duplicate is created.'
            : 'Could not reach the server. Press Submit again to retry safely - the same submission key is reused, so no duplicate is created.')
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const f = (name, label, props = {}) => (
    <Field label={label} name={name} error={errors[name]}>
      <input id={name} name={name} value={form[name]} onChange={onChange} className={inputCls} {...props} />
    </Field>
  );

  return (
    <>
      <PageHeader title="Submit Application" subtitle="Submit a new loan application for processing." />
      {success && (
        <div
          role="status"
          className={`mb-4 rounded-md border px-4 py-3 text-sm ${success.failure ? 'border-red-200 bg-red-50 text-red-800' : success.processing ? 'border-amber-200 bg-amber-50 text-amber-800' : success.existing ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-green-200 bg-green-50 text-green-800'}`}
        >
          {success.failure ? (
            <span className="font-semibold">{success.failure}</span>
          ) : success.processing ? (
            <span className="font-semibold">This application was already received and is still being processed.</span>
          ) : success.existing ? (
            <span className="font-semibold">This submission was already received - showing the existing request. No duplicate was created.</span>
          ) : (
            <span className="font-semibold">Application submitted successfully.</span>
          )}{' '}
          Your request ID is <span className="font-mono font-semibold">{success.requestId}</span>.
          {success.status && <> Current status: <span className="font-semibold">{success.status.replace('_', ' ')}</span>.</>}
          {success.processing && <> Press Submit again in a moment to check the result.</>}
        </div>
      )}
      {formError && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{formError}</div>
      )}
      <Card>
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          {f('applicantName', 'Applicant name', { type: 'text', placeholder: 'Full name' })}
          {f('email', 'Email', { type: 'email', placeholder: 'name@example.com' })}
          {f('age', 'Age', { type: 'number', min: 1, max: 100 })}
          {f('monthlyIncome', 'Monthly income', { type: 'number', min: 0 })}
          <Field label="Employment type" name="employmentType" error={errors.employmentType}>
            <select id="employmentType" name="employmentType" value={form.employmentType} onChange={onChange} className={inputCls}>
              <option value="">Select...</option>
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          {f('creditScore', 'Credit score', { type: 'number', min: 300, max: 900 })}
          {f('loanAmount', 'Requested loan amount', { type: 'number', min: 1 })}
          <div className="sm:col-span-2">
            <Field label="Application description (optional)" name="description" error={errors.description}>
              <textarea id="description" name="description" rows={3} value={form.description} onChange={onChange} className={inputCls} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={loading}>{loading ? 'Submitting...' : 'Submit Application'}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
