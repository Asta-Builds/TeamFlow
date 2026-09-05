export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-4 w-28 bg-slate-800 rounded"></div>
        <div className="h-5 w-16 bg-slate-800/80 rounded-full"></div>
      </div>
      <div className="h-6 w-3/4 bg-slate-800 rounded"></div>
      <div className="space-y-2">
        <div className="h-3 w-full bg-slate-800/60 rounded"></div>
        <div className="h-3 w-4/5 bg-slate-800/60 rounded"></div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
        <div className="h-4 w-20 bg-slate-800/60 rounded"></div>
        <div className="h-6 w-6 bg-slate-800 rounded-full"></div>
      </div>
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-2 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-3.5 w-24 bg-slate-800 rounded"></div>
        <div className="h-4 w-4 bg-slate-800 rounded"></div>
      </div>
      <div className="h-8 w-16 bg-slate-800 rounded mt-1"></div>
      <div className="h-3 w-32 bg-slate-800/60 rounded"></div>
    </div>
  );
}
