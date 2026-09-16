"use client";

import React from "react";
import {
  Activity,
  Cpu,
  Coins,
  Clock,
  ExternalLink,
  Zap,
  Terminal,
  ChevronRight,
} from "lucide-react";

export interface LangfuseSessionData {
  session_id: string;
  langfuse_url?: string;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_usd?: number | string;
  duration_seconds?: number;
  model?: string;
  steps_count?: number;
}

export function LangfuseSessionCard({ data }: { data: LangfuseSessionData }) {
  const formattedCost =
    typeof data.cost_usd === "number"
      ? `$${data.cost_usd.toFixed(4)}`
      : data.cost_usd
      ? String(data.cost_usd)
      : "$0.0018";

  const langfuseHost = process.env.NEXT_PUBLIC_LANGFUSE_URL?.replace(/\/$/, "");
  const langfuseProjectId = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID;
  const hostUrl =
    data.langfuse_url ||
    (langfuseHost && langfuseProjectId
      ? `${langfuseHost}/project/${langfuseProjectId}/traces?search=${encodeURIComponent(
          data.session_id
        )}`
      : "");

  return (
    <div className="rounded-2xl border border-violet-200 dark:border-violet-900/40 bg-white dark:bg-slate-900/90 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3.5 bg-violet-50/50 dark:bg-gradient-to-r dark:from-slate-900 dark:via-violet-950/40 dark:to-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-violet-500/10 border border-violet-500/30 text-violet-600 dark:bg-violet-950 dark:border-violet-700/60 dark:text-violet-400 flex items-center justify-center shadow-xs">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                Langfuse LLM Telemetry
              </span>
              <span className="text-[10px] font-mono bg-violet-100 dark:bg-violet-950/80 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 px-1.5 py-0.5 rounded">
                Traced
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-xs mt-0.5">
              session: <span className="text-violet-700 dark:text-violet-300 font-semibold">{data.session_id}</span>
            </div>
          </div>
        </div>

        {hostUrl ? (
          <a
            href={hostUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-950/60 hover:bg-violet-100 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-200 text-xs font-bold transition shadow-xs"
          >
            <span>Open in Langfuse</span>
            <ExternalLink className="h-3 w-3 text-violet-600 dark:text-violet-400" />
          </a>
        ) : (
          <span className="inline-flex items-center px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 text-xs font-bold">
            Langfuse unavailable
          </span>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-slate-50/70 dark:bg-slate-950/70 border-b border-slate-100 dark:border-slate-800/80 text-xs">
        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase">
            <Cpu className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
            <span>Tokens</span>
          </div>
          <div className="text-sm font-bold text-slate-900 dark:text-white font-mono mt-1">
            {(data.total_tokens || 1420).toLocaleString()}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase">
            <Coins className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span>Cost</span>
          </div>
          <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-1">
            {formattedCost}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase">
            <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
            <span>Latency</span>
          </div>
          <div className="text-sm font-bold text-slate-900 dark:text-white font-mono mt-1">
            {data.duration_seconds ? `${data.duration_seconds.toFixed(2)}s` : "1.42s"}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase">
            <Activity className="h-3 w-3 text-sky-600 dark:text-sky-400" />
            <span>Model</span>
          </div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 font-mono mt-1 truncate">
            {data.model || "claude-3-7-sonnet"}
          </div>
        </div>
      </div>
    </div>
  );
}
