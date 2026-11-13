// Test harness: the sandbox has no npm network or MongoDB, so mongoose/dotenv and the models are replaced
// with an in-memory fake. Real application code (engine, validator, controller, workflow service) runs unmodified.
const Module = require('module');
const path = require('path');

const state = { connected: true };
const makeId = (() => { let n = 0; return () => (++n).toString(16).padStart(24, '0'); })();

// Dotted-path helpers (Mongo-style "retry.state", "retry.history.2.outcome")
const getPath = (o, p) => p.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);
const setPath = (o, p, v) => {
  const keys = p.split('.');
  let cur = o;
  keys.slice(0, -1).forEach((k, i) => { if (cur[k] === undefined || cur[k] === null) cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {}; cur = cur[k]; });
  cur[keys[keys.length - 1]] = v;
};
const unsetPath = (o, p) => { const keys = p.split('.'); const parent = getPath(o, keys.slice(0, -1).join('.')) || (keys.length === 1 ? o : undefined); if (parent) delete parent[keys[keys.length - 1]]; };

class FakeCollection {
  constructor(uniques = [], defaults = {}) { this.docs = []; this.uniques = uniques; this.defaults = defaults; }
  _match(d, f) {
    return Object.entries(f).every(([k, v]) => {
      if (k === '$or') return v.some((sub) => this._match(d, sub));
      const val = getPath(d, k);
      const isNil = val === undefined || val === null;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('$ne' in v) return String(val) !== String(v.$ne);
        if ('$in' in v) return v.$in.some((x) => (x === null ? isNil : String(val) === String(x)));
        if ('$lte' in v) return !isNil && val <= v.$lte; // like Mongo, a missing/null value never matches a range
        if ('$lt' in v) return !isNil && val < v.$lt;
      }
      return String(val) === String(v);
    });
  }
  _wrap(d) {
    const self = this;
    const doc = structuredClone(d);
    Object.defineProperty(doc, 'toObject', { enumerable: false, value: () => JSON.parse(JSON.stringify(doc), (k, v) => v) });
    Object.defineProperty(doc, 'set', { enumerable: false, value: (v) => Object.assign(doc, v) });
    Object.defineProperty(doc, 'save', { enumerable: false, value: async () => { self.docs[self.docs.findIndex((x) => x._id === doc._id)] = structuredClone({ ...doc }); return doc; } });
    return doc;
  }
  findOne(f) { // thenable that also supports .select()/.lean() like a Mongoose query
    const run = async () => { const d = this.docs.find((x) => this._match(x, f)); return d ? this._wrap(d) : null; };
    const q = { select: () => q, lean: () => q, then: (res, rej) => run().then(res, rej) };
    return q;
  }
  async updateMany(f, u) { this.docs.forEach((d) => { if (this._match(d, f)) Object.assign(d, u.$set); }); }
  find(f = {}) {
    let rows = this.docs.filter((x) => this._match(x, f)).map((x) => ({ ...x }));
    const q = {
      sort: (s) => { const ks = Object.entries(s); rows.sort((a, b) => { for (const [k, dir] of ks) { const x = getPath(a, k); const y = getPath(b, k); if (x < y) return -dir; if (x > y) return dir; } return 0; }); return q; },
      select: () => q, lean: () => q, limit: (n) => { rows = rows.slice(0, n); return q; }, then: (res, rej) => Promise.resolve(rows).then(res, rej),
    };
    return q;
  }
  async countDocuments(f = {}) { return this.docs.filter((x) => this._match(x, f)).length; }
  _checkUnique(d) { // emulates Mongo unique indexes (documents without the field are not indexed)
    for (const k of this.uniques) {
      if (d[k] !== undefined && d[k] !== null && this.docs.some((x) => x[k] === d[k])) {
        const e = new Error(`E11000 duplicate key error collection: test index: ${k}_1 dup key: { ${k}: "${d[k]}" }`);
        e.code = 11000; e.keyPattern = { [k]: 1 }; throw e;
      }
    }
  }
  // Atomic like Mongo: the check-and-set runs synchronously, so two concurrent callers cannot both match.
  // Supports $set / $inc / $push / $unset with dotted paths.
  async findOneAndUpdate(f, u) {
    const d = this.docs.find((x) => this._match(x, f));
    if (!d) return null;
    Object.entries(u.$set || {}).forEach(([k, v]) => setPath(d, k, structuredClone(v)));
    Object.entries(u.$inc || {}).forEach(([k, v]) => setPath(d, k, (getPath(d, k) || 0) + v));
    Object.entries(u.$push || {}).forEach(([k, v]) => { const arr = getPath(d, k) || []; arr.push(structuredClone(v)); setPath(d, k, arr); });
    Object.keys(u.$unset || {}).forEach((k) => unsetPath(d, k));
    return this._wrap(d);
  }
  async create(v) { const d = { _id: makeId(), createdAt: new Date(), ...structuredClone(this.defaults), ...structuredClone(v) }; this._checkUnique(d); this.docs.push(d); return this._wrap(d); }
  async insertMany(a) { for (const v of a) await this.create(v); }
  async deleteOne(f) { const i = this.docs.findIndex((x) => this._match(x, f)); if (i >= 0) this.docs.splice(i, 1); }
  async deleteMany() { this.docs = []; }
}

const fakes = { WorkflowRequest: new FakeCollection(['idempotencyKey', 'requestId'], { workflowKey: 'loan-approval', stageHistory: [], evaluationTrace: [] }), Rule: new FakeCollection(), WorkflowDefinition: new FakeCollection(), WorkflowExecution: new FakeCollection(), DependencyConfig: new FakeCollection(['name']), DependencyCall: new FakeCollection(), RetryConfig: new FakeCollection(['name']), AuditLog: new FakeCollection() };
const intercept = {
  mongoose: () => ({ connection: { get readyState() { return state.connected ? 1 : 0; } }, Schema: class {}, model: () => ({}) }),
  dotenv: () => ({ config() {} }),
};
const modelByFile = { 'WorkflowRequest.js': 'WorkflowRequest', 'Rule.js': 'Rule', 'WorkflowDefinition.js': 'WorkflowDefinition', 'WorkflowExecution.js': 'WorkflowExecution', 'DependencyConfig.js': 'DependencyConfig', 'DependencyCall.js': 'DependencyCall', 'RetryConfig.js': 'RetryConfig', 'AuditLog.js': 'AuditLog' };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (intercept[request]) return intercept[request]();
  if (/models[\\/]/.test(request) || /^\.\.?\/.*models\//.test(request)) {
    const name = modelByFile[path.basename(request) + (request.endsWith('.js') ? '' : '.js')];
    if (name) return fakes[name];
  }
  return origLoad.apply(this, arguments);
};

function mockRes() {
  return { statusCode: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
/** Calls an express handler (wrapped by asyncHandler) and resolves { status, body } or { status, body } from the error handler. */
async function call(handler, { params = {}, body = {}, query = {}, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { params, body, query, headers: lower, get: (n) => lower[String(n).toLowerCase()] };
  const res = mockRes();
  const { errorHandler } = require('../../src/middleware/errorHandler');
  await new Promise((resolve) => {
    const next = (err) => { if (err) errorHandler(err, {}, res, () => {}); resolve(); };
    Promise.resolve(handler(req, res, next)).then(resolve, resolve);
  });
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

let reqSeq = 0;
// Inserts a PENDING request into the fake collection and returns a document-like wrapper (has save(), plain fields).
function fakeRequest(fields) {
  const doc = {
    _id: makeId(), requestId: `REQ-TEST-${++reqSeq}`, workflowKey: 'loan-approval', status: 'PENDING', executionState: 'PENDING', stageHistory: [],
    applicantName: 'Test User', email: 't@x.io', monthlyIncome: 5000, employmentType: 'Salaried', loanAmount: 1000, ...fields,
  };
  fakes.WorkflowRequest.docs.push(doc);
  return fakes.WorkflowRequest._wrap(doc);
}

module.exports = { fakes, state, call, fakeRequest };
