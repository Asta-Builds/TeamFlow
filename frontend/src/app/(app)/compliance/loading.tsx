import { StatSkeleton } from "@/components/skeletons/CardSkeleton";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

export default function ComplianceLoading() {
  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="space-y-2">
          <div className="h-8 w-56 bg-slate-800 rounded"></div>
          <div className="h-4 w-80 bg-slate-800/60 rounded"></div>
        </div>
        <div className="h-10 w-40 bg-slate-800 rounded-lg"></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>

      <TableSkeleton rows={5} />
    </div>
  );
}
