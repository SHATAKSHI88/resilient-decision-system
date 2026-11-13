import { useEffect, useState, useCallback } from 'react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import { getRules, createRule, updateRule, deleteRule, errorMessage } from '../services/api.js';

const OPERATORS = ['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'IN', 'NOT_IN'];
const ACTIONS = ['CONTINUE', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
const EMPTY = { ruleId: '', ruleName: '', description: '', field: '', operator: 'EQUALS', expectedValue: '', priority: '', enabled: true, onPass: 'CONTINUE', onFail: 'CONTINUE', groupId: '', groupLogic: 'AND' };
const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100';
const actionTone = { APPROVED: 'green', REJECTED: 'red', MANUAL_REVIEW: 'amber', CONTINUE: 'slate' };
const showValue = (v) => (Array.isArray(v) ? v.join(', ') : String(v));
const toForm = (r) => ({ ...EMPTY, ...r, description: r.description || '', expectedValue: showValue(r.expectedValue), groupId: r.groupId || '', groupLogic: r.groupLogic || 'AND' });

function Field({ label, name, error, hint, children }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function RuleForm({ initial, editing, onSaved, onCancel }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const isList = form.operator === 'IN' || form.operator === 'NOT_IN';

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    setErrors((er) => ({ ...er, [name]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError('');
    const payload = { ...form, groupId: form.groupId.trim(), groupLogic: form.groupId.trim() ? form.groupLogic : '' };
    try {
      const saved = editing ? await updateRule(initial.ruleId, payload) : await createRule(payload);
      onSaved(saved);
    } catch (err) {
      const apiErr = err.response?.data?.error;
      if (apiErr?.details) setErrors(apiErr.details);
      setFormError(apiErr?.message || errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const text = (name, label, props = {}, hint) => (
    <Field label={label} name={name} error={errors[name]} hint={hint}>
      <input id={name} name={name} value={form[name]} onChange={onChange} className={inputCls} {...props} />
    </Field>
  );
  const select = (name, label, options) => (
    <Field label={label} name={name} error={errors[name]}>
      <select id={name} name={name} value={form[name]} onChange={onChange} className={inputCls}>
        {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
    </Field>
  );

  return (
    <Card title={editing ? `Edit rule ${initial.ruleId}` : 'Create rule'}>
      {formError && <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{formError}</div>}
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {text('ruleId', 'Rule ID', { disabled: editing, placeholder: 'RULE-AGE-MIN' })}
        {text('ruleName', 'Rule name', { placeholder: 'Minimum age' })}
        <div className="sm:col-span-2">{text('description', 'Description (optional)')}</div>
        {text('field', 'Input field', { placeholder: 'creditScore' }, 'Request field to check, e.g. age, creditScore')}
        {select('operator', 'Operator', OPERATORS)}
        {text('expectedValue', 'Expected value', { placeholder: isList ? 'Salaried, Retired' : '600' }, isList ? 'Comma separated list' : undefined)}
        {text('priority', 'Priority', { type: 'number', min: 1 }, 'Lower number runs first')}
        {select('onPass', 'On pass', ACTIONS)}
        {select('onFail', 'On fail', ACTIONS)}
        {text('groupId', 'Group ID (optional)', { placeholder: 'credit-mid-band' }, 'Rules sharing a group ID are combined; the first rule in the group sets the action')}
        {select('groupLogic', 'Group logic', ['AND', 'OR'])}
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" name="enabled" checked={form.enabled} onChange={onChange} /> Enabled
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create rule'}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function RuleDetails({ rule, onClose, onEdit }) {
  const rows = [
    ['Rule ID', rule.ruleId], ['Rule name', rule.ruleName], ['Description', rule.description || '-'],
    ['Condition', `${rule.field} ${rule.operator.replace(/_/g, ' ')} ${showValue(rule.expectedValue)}`],
    ['Priority', rule.priority], ['Status', rule.enabled ? 'Enabled' : 'Disabled'],
    ['On pass', rule.onPass], ['On fail', rule.onFail],
    ['Group', rule.groupId ? `${rule.groupId} (${rule.groupLogic})` : '-'], ['Workflow', rule.workflowKey || '-'],
  ];
  return (
    <Card title={`Rule details: ${rule.ruleId}`} action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button><Button size="sm" variant="secondary" onClick={onClose}>Close</Button></div>}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
            <dd className="mt-1 text-sm text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState(null); // { mode: 'create' | 'edit' | 'view', rule? }

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getRules().then(setRules).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const toggle = async (r) => {
    setNotice('');
    try {
      const saved = await updateRule(r.ruleId, { enabled: !r.enabled });
      setRules((list) => list.map((x) => (x.ruleId === saved.ruleId ? saved : x)));
    } catch (e) { setError(errorMessage(e)); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Delete rule ${r.ruleId}?`)) return;
    try {
      await deleteRule(r.ruleId);
      setNotice(`Rule ${r.ruleId} deleted.`);
      setPanel(null);
      load();
    } catch (e) { setError(errorMessage(e)); }
  };
  const saved = (rule) => { setNotice(`Rule ${rule.ruleId} saved.`); setPanel(null); load(); };

  const columns = [
    { key: 'priority', header: 'Priority' },
    { key: 'ruleName', header: 'Rule', render: (r) => <div><div className="font-medium text-slate-900">{r.ruleName}</div><div className="font-mono text-xs text-slate-400">{r.ruleId}</div></div> },
    { key: 'condition', header: 'Condition', render: (r) => `${r.field} ${r.operator.replace(/_/g, ' ').toLowerCase()} ${showValue(r.expectedValue)}` },
    { key: 'onPass', header: 'On pass', render: (r) => <Badge tone={actionTone[r.onPass]}>{r.onPass.replace('_', ' ')}</Badge> },
    { key: 'onFail', header: 'On fail', render: (r) => <Badge tone={actionTone[r.onFail]}>{r.onFail.replace('_', ' ')}</Badge> },
    { key: 'enabled', header: 'Status', render: (r) => <Badge tone={r.enabled ? 'green' : 'slate'}>{r.enabled ? 'Enabled' : 'Disabled'}</Badge> },
    {
      key: 'actions', header: 'Actions',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setPanel({ mode: 'view', rule: r })}>View</Button>
          <Button variant="ghost" size="sm" onClick={() => setPanel({ mode: 'edit', rule: r })}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => toggle(r)}>{r.enabled ? 'Disable' : 'Enable'}</Button>
          <Button variant="ghost" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => remove(r)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Rules"
        subtitle="Decision rules evaluated in priority order (lowest number first). Only enabled rules are used."
        actions={<Button onClick={() => setPanel({ mode: 'create' })}>Create rule</Button>}
      />
      {notice && <div role="status" className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{error}</span><Button size="sm" variant="secondary" onClick={load}>Retry</Button>
        </div>
      )}
      <div className="space-y-6">
        {panel?.mode === 'view' && <RuleDetails rule={panel.rule} onClose={() => setPanel(null)} onEdit={() => setPanel({ mode: 'edit', rule: panel.rule })} />}
        {panel?.mode === 'create' && <RuleForm key="new" initial={EMPTY} onSaved={saved} onCancel={() => setPanel(null)} />}
        {panel?.mode === 'edit' && <RuleForm key={panel.rule.ruleId} initial={toForm(panel.rule)} editing onSaved={saved} onCancel={() => setPanel(null)} />}
        <Card>
          <div className="-m-5">
            {loading ? <p className="p-5 text-sm text-slate-500">Loading rules...</p> : <Table rowKey="ruleId" columns={columns} rows={rules} empty="No rules configured." />}
          </div>
        </Card>
      </div>
    </>
  );
}
