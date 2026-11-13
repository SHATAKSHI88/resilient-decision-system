import { useEffect, useState, useCallback } from 'react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import { getWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, errorMessage } from '../services/api.js';

const STAGE_TYPES = ['RECEIVE', 'VALIDATION', 'VERIFICATION', 'EVALUATION', 'DECISION', 'COMPLETE'];
const OUTCOMES = ['ALWAYS', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
const EMPTY = {
  key: '', name: '', description: '', enabled: false,
  stages: [{ stageId: 'REQUEST_RECEIVED', name: 'Request Received', type: 'RECEIVE', description: '' }, { stageId: 'COMPLETED', name: 'Completed', type: 'COMPLETE', description: '' }],
  transitions: [{ from: 'REQUEST_RECEIVED', to: 'COMPLETED', outcome: 'ALWAYS' }],
};
const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100';
const label = (s) => s.replace(/_/g, ' ');

function Err({ msg }) { return msg ? <p className="mt-1 text-xs text-red-600">{msg}</p> : null; }

function StageTable({ stages }) {
  return (
    <Table
      rowKey="stageId"
      columns={[
        { key: 'n', header: '#', render: (s) => stages.indexOf(s) + 1 },
        { key: 'stageId', header: 'Stage ID', render: (s) => <span className="font-mono text-xs">{s.stageId}</span> },
        { key: 'name', header: 'Name' },
        { key: 'type', header: 'Type', render: (s) => <Badge tone="blue">{s.type}</Badge> },
        { key: 'description', header: 'Description', className: 'whitespace-normal' },
      ]}
      rows={stages}
    />
  );
}

function TransitionTable({ transitions }) {
  const tone = { APPROVED: 'green', REJECTED: 'red', MANUAL_REVIEW: 'amber', ALWAYS: 'slate' };
  return (
    <Table
      rowKey="k"
      empty="No transitions."
      columns={[
        { key: 'from', header: 'From', render: (t) => <span className="font-mono text-xs">{t.from}</span> },
        { key: 'outcome', header: 'When outcome is', render: (t) => <Badge tone={tone[t.outcome]}>{label(t.outcome)}</Badge> },
        { key: 'to', header: 'Go to', render: (t) => <span className="font-mono text-xs">{t.to}</span> },
      ]}
      rows={transitions.map((t, i) => ({ ...t, k: i }))}
    />
  );
}

function WorkflowDetails({ wf, onClose, onEdit }) {
  return (
    <Card title={`Workflow: ${wf.name}`} action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button><Button size="sm" variant="secondary" onClick={onClose}>Close</Button></div>}>
      <p className="mb-1 text-sm text-slate-600">{wf.description || 'No description.'}</p>
      <p className="mb-4 text-xs text-slate-400">Key <span className="font-mono">{wf.key}</span> &middot; {wf.enabled ? 'Enabled (active)' : 'Disabled'}</p>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Stages</h3>
      <div className="mb-5 rounded-md border border-slate-200"><StageTable stages={wf.stages} /></div>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Transitions</h3>
      <div className="rounded-md border border-slate-200"><TransitionTable transitions={wf.transitions} /></div>
    </Card>
  );
}

function WorkflowForm({ initial, editing, onSaved, onCancel }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const stageIds = form.stages.map((s) => s.stageId).filter(Boolean);

  const setTop = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    setErrors((er) => ({ ...er, [name]: undefined }));
  };
  const setItem = (list, i, field, value) => {
    setForm((f) => ({ ...f, [list]: f[list].map((x, j) => (j === i ? { ...x, [field]: value } : x)) }));
    setErrors((er) => ({ ...er, [`${list}[${i}].${field}`]: undefined }));
  };
  const addItem = (list, item) => setForm((f) => ({ ...f, [list]: [...f[list], item] }));
  const removeItem = (list, i) => { setForm((f) => ({ ...f, [list]: f[list].filter((_, j) => j !== i) })); setErrors({}); };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError('');
    try {
      onSaved(editing ? await updateWorkflow(initial.key, form) : await createWorkflow(form));
    } catch (err) {
      const apiErr = err.response?.data?.error;
      if (apiErr?.details) setErrors(apiErr.details);
      setFormError(apiErr?.message || errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const messages = Object.entries(errors).filter(([, v]) => v);
  return (
    <Card title={editing ? `Edit workflow ${initial.key}` : 'Create workflow'}>
      {formError && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">{formError}</p>
          {messages.length > 0 && <ul className="mt-1 list-disc pl-5">{messages.map(([k, v]) => <li key={k}><span className="font-mono text-xs">{k}</span>: {v}</li>)}</ul>}
        </div>
      )}
      <form onSubmit={submit} noValidate className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="key" className="mb-1 block text-sm font-medium text-slate-700">Workflow key</label>
            <input id="key" name="key" value={form.key} onChange={setTop} disabled={editing} placeholder="loan-approval" className={inputCls} />
            <Err msg={errors.key} />
          </div>
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">Name</label>
            <input id="name" name="name" value={form.name} onChange={setTop} className={inputCls} />
            <Err msg={errors.name} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="description" className="mb-1 block text-sm font-medium text-slate-700">Description (optional)</label>
            <input id="description" name="description" value={form.description} onChange={setTop} className={inputCls} />
            <Err msg={errors.description} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" name="enabled" checked={form.enabled} onChange={setTop} /> Enabled (used for new requests; replaces any other enabled workflow with the same key)
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Stages</h3>
            <Button type="button" size="sm" variant="secondary" onClick={() => addItem('stages', { stageId: '', name: '', type: 'VALIDATION', description: '' })}>Add stage</Button>
          </div>
          <Err msg={errors.stages} />
          <div className="space-y-2">
            {form.stages.map((s, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_10rem_auto]">
                <div><input aria-label={`Stage ${i + 1} ID`} placeholder="Stage ID" value={s.stageId} onChange={(e) => setItem('stages', i, 'stageId', e.target.value)} className={inputCls} /><Err msg={errors[`stages[${i}].stageId`]} /></div>
                <div><input aria-label={`Stage ${i + 1} name`} placeholder="Name" value={s.name} onChange={(e) => setItem('stages', i, 'name', e.target.value)} className={inputCls} /><Err msg={errors[`stages[${i}].name`]} /></div>
                <div>
                  <select aria-label={`Stage ${i + 1} type`} value={s.type} onChange={(e) => setItem('stages', i, 'type', e.target.value)} className={inputCls}>
                    {STAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <Err msg={errors[`stages[${i}].type`]} />
                </div>
                <Button type="button" size="sm" variant="ghost" className="!text-red-600" onClick={() => removeItem('stages', i)}>Remove</Button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Transitions</h3>
            <Button type="button" size="sm" variant="secondary" onClick={() => addItem('transitions', { from: stageIds[0] || '', to: stageIds[1] || '', outcome: 'ALWAYS' })}>Add transition</Button>
          </div>
          <p className="mb-2 text-xs text-slate-400">A stage follows the transition matching its outcome (APPROVED / REJECTED / MANUAL_REVIEW from evaluation and decision stages), otherwise the ALWAYS one.</p>
          <Err msg={errors.transitions} />
          <div className="space-y-2">
            {form.transitions.map((t, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_10rem_auto]">
                {['from', 'to'].map((f) => (
                  <div key={f}>
                    <select aria-label={`Transition ${i + 1} ${f}`} value={t[f]} onChange={(e) => setItem('transitions', i, f, e.target.value)} className={inputCls}>
                      <option value="">{f === 'from' ? 'From stage...' : 'To stage...'}</option>
                      {stageIds.map((id) => <option key={id} value={id}>{id}</option>)}
                    </select>
                    <Err msg={errors[`transitions[${i}].${f}`]} />
                  </div>
                ))}
                <div>
                  <select aria-label={`Transition ${i + 1} outcome`} value={t.outcome} onChange={(e) => setItem('transitions', i, 'outcome', e.target.value)} className={inputCls}>
                    {OUTCOMES.map((o) => <option key={o} value={o}>{label(o)}</option>)}
                  </select>
                  <Err msg={errors[`transitions[${i}].outcome`]} />
                </div>
                <Button type="button" size="sm" variant="ghost" className="!text-red-600" onClick={() => removeItem('transitions', i)}>Remove</Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create workflow'}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export default function Workflows() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState(null); // { mode: 'create' | 'edit' | 'view', wf? }

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getWorkflows().then(setItems).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const toggle = async (w) => {
    setNotice('');
    setError('');
    try {
      await updateWorkflow(w.key, { enabled: !w.enabled });
      setNotice(`Workflow ${w.key} ${w.enabled ? 'disabled' : 'enabled'}.`);
      load();
    } catch (e) { setError(e.response?.data?.error?.message || errorMessage(e)); }
  };
  const remove = async (w) => {
    if (!window.confirm(`Delete workflow ${w.key}?`)) return;
    setNotice('');
    setError('');
    try {
      await deleteWorkflow(w.key);
      setNotice(`Workflow ${w.key} deleted.`);
      setPanel(null);
      load();
    } catch (e) { setError(errorMessage(e)); } // e.g. 409: cannot delete the active workflow
  };
  const saved = (w) => { setNotice(`Workflow ${w.key} saved.`); setPanel(null); load(); };

  const columns = [
    { key: 'name', header: 'Workflow', render: (w) => <div><div className="font-medium text-slate-900">{w.name}</div><div className="font-mono text-xs text-slate-400">{w.key}</div></div> },
    { key: 'description', header: 'Description', className: 'whitespace-normal max-w-md' },
    { key: 'stages', header: 'Stages', render: (w) => w.stages.length },
    { key: 'transitions', header: 'Transitions', render: (w) => w.transitions.length },
    { key: 'enabled', header: 'Status', render: (w) => <Badge tone={w.enabled ? 'green' : 'slate'}>{w.enabled ? 'Enabled' : 'Disabled'}</Badge> },
    {
      key: 'actions', header: 'Actions',
      render: (w) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setPanel({ mode: 'view', wf: w })}>View</Button>
          <Button variant="ghost" size="sm" onClick={() => setPanel({ mode: 'edit', wf: w })}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => toggle(w)}>{w.enabled ? 'Disable' : 'Enable'}</Button>
          <Button variant="ghost" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => remove(w)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Workflow Configuration"
        subtitle="Stages and transitions that new requests follow. The enabled workflow is loaded from the database for every request."
        actions={<Button onClick={() => setPanel({ mode: 'create' })}>Create workflow</Button>}
      />
      {notice && <div role="status" className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{error}</span><Button size="sm" variant="secondary" onClick={load}>Retry</Button>
        </div>
      )}
      <div className="space-y-6">
        {panel?.mode === 'view' && <WorkflowDetails wf={panel.wf} onClose={() => setPanel(null)} onEdit={() => setPanel({ mode: 'edit', wf: panel.wf })} />}
        {panel?.mode === 'create' && <WorkflowForm key="new" initial={EMPTY} onSaved={saved} onCancel={() => setPanel(null)} />}
        {panel?.mode === 'edit' && <WorkflowForm key={panel.wf.key} initial={panel.wf} editing onSaved={saved} onCancel={() => setPanel(null)} />}
        <Card>
          <div className="-m-5">
            {loading ? <p className="p-5 text-sm text-slate-500">Loading workflows...</p> : <Table rowKey="key" columns={columns} rows={items} empty="No workflows configured." />}
          </div>
        </Card>
      </div>
    </>
  );
}
