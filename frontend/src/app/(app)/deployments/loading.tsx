import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

export default function DeploymentsLoading() {
  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="space-y-2">
          <div className="h-8 w-56 bg-slate-800 rounded"></div>
          <div className="h-4 w-80 bg-slate-800/60 rounded"></div>
        </div>
        <div className="h-10 w-44 bg-slate-800 rounded-lg"></div>
      </div>

      <TableSkeleton rows={6} />
    </div>
  );
}
