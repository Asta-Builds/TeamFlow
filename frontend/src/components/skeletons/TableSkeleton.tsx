export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden animate-pulse">
      {/* Table Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-4">
        <div className="h-4 w-32 bg-slate-800 rounded"></div>
        <div className="h-4 w-20 bg-slate-800 rounded"></div>
      </div>
      {/* Table Rows */}
      <div className="divide-y divide-slate-800/60">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-slate-800"></div>
              <div className="space-y-1.5">
                <div className="h-4 w-40 bg-slate-800 rounded"></div>
                <div className="h-3 w-28 bg-slate-800/60 rounded"></div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-5 w-16 bg-slate-800 rounded-full"></div>
              <div className="h-4 w-24 bg-slate-800/60 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
