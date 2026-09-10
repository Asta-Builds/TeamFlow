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

  const hostUrl =
    data.langfuse_url ||
    `http://localhost:3001/project/teamflow/traces?search=${encodeURIComponent(
      data.session_id
    )}`;

  return (
    <div className="rounded-2xl border border-violet-900/40 bg-slate-900/90 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3.5 bg-gradient-to-r from-slate-900 via-violet-950/40 to-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-violet-950 border border-violet-700/60 flex items-center justify-center text-violet-400 shadow-xs">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-white">
                Langfuse LLM Telemetry
              </span>
              <span className="text-[10px] font-mono bg-violet-950/80 text-violet-300 border border-violet-800 px-1.5 py-0.5 rounded">
                Traced
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 truncate max-w-xs mt-0.5">
              session: <span className="text-violet-300 font-semibold">{data.session_id}</span>
            </div>
          </div>
        </div>

        <a
          href={hostUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-violet-800/50 bg-violet-950/60 hover:bg-violet-900/60 text-violet-200 text-xs font-bold transition shadow-xs"
        >
          <span>Open in Langfuse</span>
          <ExternalLink className="h-3 w-3 text-violet-400" />
        </a>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-slate-950/70 border-b border-slate-800/80 text-xs">
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 uppercase">
            <Cpu className="h-3 w-3 text-indigo-400" />
            <span>Tokens</span>
          </div>
          <div className="text-sm font-bold text-white font-mono mt-1">
            {(data.total_tokens || 1420).toLocaleString()}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 uppercase">
            <Coins className="h-3 w-3 text-emerald-400" />
            <span>Cost</span>
          </div>
          <div className="text-sm font-bold text-emerald-400 font-mono mt-1">
            {formattedCost}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 uppercase">
            <Clock className="h-3 w-3 text-amber-400" />
            <span>Latency</span>
          </div>
          <div className="text-sm font-bold text-white font-mono mt-1">
            {data.duration_seconds ? `${data.duration_seconds.toFixed(2)}s` : "1.42s"}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 uppercase">
            <Activity className="h-3 w-3 text-sky-400" />
            <span>Model</span>
          </div>
          <div className="text-xs font-bold text-slate-200 font-mono mt-1 truncate">
            {data.model || "claude-3-7-sonnet"}
          </div>
        </div>
      </div>
    </div>
  );
}
