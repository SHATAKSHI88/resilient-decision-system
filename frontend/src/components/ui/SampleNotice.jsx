// Makes it explicit that a view is not yet backed by real backend functionality.
export default function SampleNotice({ children = 'Sample data - backend integration for this view is planned for a later phase.' }) {
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <span className="font-semibold">Placeholder: </span>
      {children}
    </div>
  );
}
