import { NavLink } from 'react-router-dom';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/submit', label: 'Submit Application' },
  { to: '/requests', label: 'Requests' },
  { to: '/manual-review', label: 'Manual Review' },
  { to: '/workflows', label: 'Workflows' },
  { to: '/rules', label: 'Rules' },
  { to: '/audit-logs', label: 'Audit Logs' },
  { to: '/system-health', label: 'System Health' },
];

export default function Sidebar({ open, onClose }) {
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 transform border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">F</div>
          <span className="font-semibold text-slate-900">FlowDecide</span>
        </div>
        <nav className="space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
