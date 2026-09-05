import { StatSkeleton } from "@/components/skeletons/CardSkeleton";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-pulse">
      {/* Header */}
      <div className="border-b border-slate-800 pb-6 space-y-2">
        <div className="h-8 w-64 bg-slate-800 rounded"></div>
        <div className="h-4 w-96 bg-slate-800/60 rounded"></div>
      </div>

      {/* SuperStat Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>

      {/* Content tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TableSkeleton rows={4} />
        <TableSkeleton rows={4} />
      </div>
    </div>
  );
}
