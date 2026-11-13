// ======================================================================
// SAMPLE / SEED DATA - Phase 1 only.
// The frontend does NOT yet read requests, workflows, audit logs or
// analytics from the backend. Replace these with API calls in Phase 2+.
// ======================================================================

// Statuses used by real (database) requests.
export const REQUEST_STATUSES = ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'COMPLETED', 'FAILED'];

export const STATUS_META = {
  PENDING: { label: 'Pending', tone: 'slate' },
  PROCESSING: { label: 'Processing', tone: 'blue' },
  APPROVED: { label: 'Approved', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
  MANUAL_REVIEW: { label: 'Manual Review', tone: 'amber' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  FAILED: { label: 'Failed', tone: 'rose' },
  submitted: { label: 'Submitted', tone: 'slate' },
  processing: { label: 'Processing', tone: 'blue' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  manual_review: { label: 'Manual Review', tone: 'amber' },
  failed: { label: 'Failed', tone: 'rose' },
};

const names = ['Aarav Sharma', 'Priya Verma', 'Rohan Gupta', 'Neha Singh', 'Karan Mehta', 'Ananya Iyer', 'Vikram Rao', 'Sneha Patil', 'Arjun Nair', 'Isha Kapoor', 'Manish Joshi', 'Divya Reddy', 'Rahul Bansal', 'Pooja Desai'];
const statuses = ['approved', 'manual_review', 'rejected', 'processing', 'failed', 'submitted', 'approved', 'approved', 'manual_review', 'rejected', 'approved', 'manual_review', 'failed', 'approved'];
const types = ['Loan Application', 'Loan Application', 'Loan Application', 'Vendor Approval', 'Claim Processing'];

export const requests = names.map((name, i) => ({
  id: `REQ-${1001 + i}`,
  applicant: name,
  email: name.toLowerCase().replace(' ', '.') + '@example.com',
  phone: `+91 98${(10000000 + i * 137531).toString().slice(0, 8)}`,
  submittedAt: new Date(Date.UTC(2026, 10, 13 - (i % 7), 6 + i, 10 * (i % 6))).toISOString(),
  type: types[i % types.length],
  status: statuses[i],
  data: {
    loanAmount: 100000 + i * 65000,
    tenureMonths: [12, 24, 36, 48][i % 4],
    monthlyIncome: 40000 + i * 7500,
    creditScore: 520 + i * 18,
    employment: i % 3 === 0 ? 'Self-employed' : 'Salaried',
    purpose: ['Home renovation', 'Education', 'Medical', 'Business'][i % 4],
  },
}));

export const kpis = [
  { key: 'total', label: 'Total Requests', value: 1248, delta: '+12% this week' },
  { key: 'approved', label: 'Approved', value: 742, delta: '59.5%' },
  { key: 'rejected', label: 'Rejected', value: 286, delta: '22.9%' },
  { key: 'manual_review', label: 'Manual Review', value: 164, delta: '13.1%' },
  { key: 'failed', label: 'Failed Requests', value: 56, delta: '4.5%' },
];

export const processingTrend = [
  { day: 'Mon', received: 160, processed: 150 },
  { day: 'Tue', received: 182, processed: 170 },
  { day: 'Wed', received: 175, processed: 171 },
  { day: 'Thu', received: 210, processed: 196 },
  { day: 'Fri', received: 198, processed: 190 },
  { day: 'Sat', received: 120, processed: 118 },
  { day: 'Sun', received: 98, processed: 97 },
];

export const statusDistribution = [
  { name: 'Approved', value: 742, color: '#16a34a' },
  { name: 'Rejected', value: 286, color: '#dc2626' },
  { name: 'Manual Review', value: 164, color: '#d97706' },
  { name: 'Failed', value: 56, color: '#e11d48' },
];

export const systemActivity = [
  { time: '10:42', text: 'REQ-1014 submitted via intake API' },
  { time: '10:31', text: 'Workflow "Loan Approval" v3 loaded' },
  { time: '10:05', text: 'REQ-1013 moved to Failed (credit bureau timeout)' },
  { time: '09:48', text: 'REQ-1011 approved' },
  { time: '09:12', text: 'Manual review queue reached 10 items' },
];

export const workflows = [
  { id: 'wf-1', name: 'Loan Approval', description: 'Evaluates personal loan applications against credit and income criteria.', version: 3, active: true },
  { id: 'wf-2', name: 'Claim Processing', description: 'Handles insurance claim intake, validation and adjudication.', version: 1, active: false },
  { id: 'wf-3', name: 'Vendor Approval', description: 'Onboards and verifies new vendors before activation.', version: 2, active: true },
  { id: 'wf-4', name: 'Employee Onboarding', description: 'Coordinates document checks and approvals for new hires.', version: 1, active: false },
  { id: 'wf-5', name: 'Document Verification', description: 'Verifies identity and supporting documents.', version: 4, active: true },
];

export const auditLogs = [
  { id: 'a1', ts: '2026-11-13T10:42:11Z', requestId: 'REQ-1014', action: 'REQUEST_SUBMITTED', prev: '-', next: 'submitted', description: 'Request received via intake' },
  { id: 'a2', ts: '2026-11-13T10:42:13Z', requestId: 'REQ-1014', action: 'STATUS_CHANGED', prev: 'submitted', next: 'processing', description: 'Workflow execution started' },
  { id: 'a3', ts: '2026-11-13T10:05:40Z', requestId: 'REQ-1013', action: 'STATUS_CHANGED', prev: 'processing', next: 'failed', description: 'External dependency timeout' },
  { id: 'a4', ts: '2026-11-13T09:48:02Z', requestId: 'REQ-1011', action: 'DECISION_MADE', prev: 'processing', next: 'approved', description: 'All checks passed' },
  { id: 'a5', ts: '2026-11-12T16:20:55Z', requestId: 'REQ-1009', action: 'MANUAL_REVIEW_ASSIGNED', prev: 'processing', next: 'manual_review', description: 'Credit score in review band' },
  { id: 'a6', ts: '2026-11-12T15:02:31Z', requestId: 'REQ-1010', action: 'DECISION_MADE', prev: 'processing', next: 'rejected', description: 'Below minimum credit score' },
  { id: 'a7', ts: '2026-11-12T11:18:09Z', requestId: 'REQ-1006', action: 'REQUEST_SUBMITTED', prev: '-', next: 'submitted', description: 'Request received via intake' },
];

export const failedJobs = [
  { id: 'job-88', requestId: 'REQ-1013', reason: 'Credit bureau timeout', attempts: 3, at: '2026-11-13T10:05:40Z' },
  { id: 'job-85', requestId: 'REQ-1005', reason: 'Partial save failure', attempts: 2, at: '2026-11-12T14:31:00Z' },
];

export const externalDependencies = [
  { name: 'Credit Bureau API', status: 'degraded', latency: '820 ms' },
  { name: 'KYC Verification Service', status: 'operational', latency: '140 ms' },
  { name: 'Notification Service', status: 'operational', latency: '95 ms' },
];

// Placeholder content for Request Details sections whose backend is not built yet
export const placeholderExecutionHistory = [
  { stage: 'Intake & validation', result: 'Completed', at: '+0s' },
  { stage: 'Mandatory checks', result: 'Completed', at: '+1s' },
  { stage: 'Credit threshold check', result: 'Completed', at: '+2s' },
  { stage: 'Decision', result: 'Completed', at: '+3s' },
];
