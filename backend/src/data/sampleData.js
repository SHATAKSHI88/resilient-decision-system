// SAMPLE / SEED DATA - served only when MongoDB is not connected.
// Every response built from this file is flagged with meta.source = "sample".

const requests = [
  { requestId: 'REQ-1001', applicant: { name: 'Aarav Sharma' }, requestType: 'Loan Application', status: 'approved', createdAt: '2026-11-10T09:12:00Z', data: { amount: 250000, creditScore: 782 } },
  { requestId: 'REQ-1002', applicant: { name: 'Priya Verma' }, requestType: 'Loan Application', status: 'manual_review', createdAt: '2026-11-10T10:40:00Z', data: { amount: 900000, creditScore: 648 } },
  { requestId: 'REQ-1003', applicant: { name: 'Rohan Gupta' }, requestType: 'Loan Application', status: 'rejected', createdAt: '2026-11-11T08:05:00Z', data: { amount: 500000, creditScore: 512 } },
  { requestId: 'REQ-1004', applicant: { name: 'Neha Singh' }, requestType: 'Loan Application', status: 'processing', createdAt: '2026-11-12T11:22:00Z', data: { amount: 150000, creditScore: 720 } },
  { requestId: 'REQ-1005', applicant: { name: 'Karan Mehta' }, requestType: 'Loan Application', status: 'failed', createdAt: '2026-11-12T14:31:00Z', data: { amount: 300000, creditScore: 690 } },
  { requestId: 'REQ-1006', applicant: { name: 'Ananya Iyer' }, requestType: 'Loan Application', status: 'submitted', createdAt: '2026-11-13T07:50:00Z', data: { amount: 120000, creditScore: 735 } },
];

const workflows = [
  { key: 'loan-approval', name: 'Loan Approval', description: 'Evaluates personal loan applications.', version: 1, isActive: true },
  { key: 'claim-processing', name: 'Claim Processing', description: 'Handles insurance claim intake and review.', version: 1, isActive: false },
  { key: 'vendor-approval', name: 'Vendor Approval', description: 'Onboards and approves new vendors.', version: 2, isActive: true },
];

const auditLogs = [
  { requestId: 'REQ-1001', action: 'REQUEST_SUBMITTED', previousState: null, newState: 'submitted', description: 'Request received (sample)', createdAt: '2026-11-10T09:12:00Z' },
  { requestId: 'REQ-1001', action: 'STATUS_CHANGED', previousState: 'submitted', newState: 'approved', description: 'Approved (sample - no rules engine yet)', createdAt: '2026-11-10T09:13:00Z' },
  { requestId: 'REQ-1002', action: 'STATUS_CHANGED', previousState: 'processing', newState: 'manual_review', description: 'Routed to manual review (sample)', createdAt: '2026-11-10T10:41:00Z' },
  { requestId: 'REQ-1003', action: 'STATUS_CHANGED', previousState: 'processing', newState: 'rejected', description: 'Rejected (sample)', createdAt: '2026-11-11T08:06:00Z' },
];

module.exports = { requests, workflows, auditLogs };
