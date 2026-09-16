import * as React from "react";
import { memo } from "react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: string;
  color?: string;
  className?: string;
}

export const StatCard = memo(function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  trend,
  color = "border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5.5 shadow-sm transition-all duration-200 hover:border-slate-300 dark:hover:border-slate-700 hover:-translate-y-0.5 backdrop-blur-xs",
        color,
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-slate-700/50">
          <Icon className="h-5 w-5" />
        </div>
        {trend && (
          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 rounded-full">
            {trend}
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{value}</div>
      <div className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">{label}</div>
      {subtitle && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
  );
});
StatCard.displayName = "StatCard";
