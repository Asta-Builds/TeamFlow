export function KanbanSkeleton() {
  const columns = ["To Do", "In Progress", "In Review", "QA", "Done"];

  return (
    <div className="space-y-6 animate-pulse">
      {/* Top Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-2">
          <div className="h-4 w-32 bg-slate-800 rounded"></div>
          <div className="h-7 w-64 bg-slate-800 rounded"></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-28 bg-slate-800 rounded-lg"></div>
          <div className="h-9 w-32 bg-slate-800 rounded-lg"></div>
        </div>
      </div>

      {/* 5-Column Kanban Board Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {columns.map((col, idx) => (
          <div
            key={idx}
            className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-3 min-h-[480px]"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <div className="h-4 w-20 bg-slate-800 rounded"></div>
              <div className="h-4 w-6 bg-slate-800 rounded-full"></div>
            </div>
            {/* Card skeletons in column */}
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-800/80 bg-slate-900/80 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="h-3 w-16 bg-slate-800 rounded"></div>
                  <div className="h-4 w-12 bg-slate-800 rounded"></div>
                </div>
                <div className="h-4 w-full bg-slate-800 rounded"></div>
                <div className="h-3 w-3/4 bg-slate-800/60 rounded"></div>
                <div className="flex items-center justify-between pt-2">
                  <div className="h-5 w-5 bg-slate-800 rounded-full"></div>
                  <div className="h-3 w-12 bg-slate-800/60 rounded"></div>
                </div>
              </div>

              {idx < 3 && (
                <div className="rounded-lg border border-slate-800/80 bg-slate-900/80 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-14 bg-slate-800 rounded"></div>
                    <div className="h-4 w-10 bg-slate-800 rounded"></div>
                  </div>
                  <div className="h-4 w-4/5 bg-slate-800 rounded"></div>
                  <div className="flex items-center justify-between pt-2">
                    <div className="h-5 w-5 bg-slate-800 rounded-full"></div>
                    <div className="h-3 w-16 bg-slate-800/60 rounded"></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
