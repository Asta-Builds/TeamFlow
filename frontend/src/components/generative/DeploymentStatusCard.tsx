"use client";

import React, { useState } from "react";
import {
  Rocket,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  RotateCcw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { apiErrorDetail } from "@/lib/api";

export interface PipelineStage {
  name: string;
  status: "pending" | "running" | "success" | "failed";
  duration_seconds?: number;
}

export interface DeploymentCardData {
  id?: number;
  environment: "production" | "staging" | "preview";
  status: "deployed" | "deploying" | "failed" | "rolled_back";
  version: string;
  commit_hash?: string;
  commit_message?: string;
  deployed_url?: string;
  stages?: PipelineStage[];
  can_rollback?: boolean;
}

export function DeploymentStatusCard({
  data,
  onRollback,
}: {
  data: DeploymentCardData;
  onRollback?: () => Promise<void>;
}) {
  const [stages] = useState<PipelineStage[]>(data.stages || []);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleRollback = async () => {
    if (!onRollback) return;
    setIsRollingBack(true);
    try {
      await onRollback();
      toast.success("Rollback requested");
    } catch (err) {
      toast.error(apiErrorDetail(err, "Rollback failed"));
    } finally {
      setIsRollingBack(false);
    }
  };

  const isSuccess = data.status === "deployed";
  const isDeploying = data.status === "deploying";
  const isFailed = data.status === "failed";

  const hasStages = stages && stages.length > 0;

  return (
    <div className="rounded-2xl border border-sky-200 dark:border-sky-900/40 bg-white dark:bg-slate-900/90 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3.5 bg-sky-50/50 dark:bg-gradient-to-r dark:from-slate-900 dark:via-sky-950/40 dark:to-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-xl flex items-center justify-center border shadow-xs ${
              isSuccess
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:bg-emerald-950/80 dark:border-emerald-700/60 dark:text-emerald-400"
                : isDeploying
                ? "bg-sky-500/10 border-sky-500/30 text-sky-600 dark:bg-sky-950/80 dark:border-sky-700/60 dark:text-sky-400"
                : "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:bg-rose-950/80 dark:border-rose-700/60 dark:text-rose-400"
            }`}
          >
            {isDeploying ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Rocket className="h-5 w-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                DevOps CI/CD Deployment · {data.environment}
              </h4>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  isSuccess
                    ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-950/90 dark:text-emerald-300 border-emerald-500/30 dark:border-emerald-700/60"
                    : isDeploying
                    ? "bg-sky-500/10 text-sky-700 dark:bg-sky-950/90 dark:text-sky-300 border-sky-500/30 dark:border-sky-700/60"
                    : "bg-rose-500/10 text-rose-700 dark:bg-rose-950/90 dark:text-rose-300 border-rose-500/30 dark:border-rose-700/60"
                }`}
              >
                {data.status}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
              <span>{data.version}</span>
              {data.commit_hash && (
                <>
                  <span>•</span>
                  <span className="text-sky-600 dark:text-sky-300">{data.commit_hash.slice(0, 7)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {data.deployed_url && (
            <a
              href={data.deployed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700 transition"
            >
              <span>View App</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {onRollback && data.can_rollback !== false && (
            <button
              type="button"
              onClick={handleRollback}
              disabled={isRollingBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className={`h-3 w-3 ${isRollingBack ? "animate-spin" : ""}`} />
              <span>Rollback</span>
            </button>
          )}
          {hasStages && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded Pipeline Stages */}
      {isExpanded && hasStages && (
        <div className="p-3 bg-slate-50 dark:bg-slate-950/90 space-y-2 border-t border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            Pipeline Stages:
          </span>
          <div className="space-y-1.5">
            {stages.map((stg, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs"
              >
                <div className="flex items-center gap-2">
                  {stg.status === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : stg.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600 dark:text-sky-400" />
                  ) : stg.status === "failed" ? (
                    <XCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                  )}
                  <span className="text-slate-800 dark:text-slate-200 font-medium">{stg.name}</span>
                </div>
                {stg.duration_seconds && (
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                    {stg.duration_seconds}s
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
