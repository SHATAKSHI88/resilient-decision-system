export default function Topbar({ onMenu }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
          onClick={onMenu}
          aria-label="Open navigation"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <span className="hidden text-sm text-slate-500 sm:inline">Loan Approval Demo Environment</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
          Phase 1 - sample data
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">AD</div>
      </div>
    </header>
  );
}
