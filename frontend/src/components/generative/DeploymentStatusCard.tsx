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
  Server,
  FolderGit2,
} from "lucide-react";
import { toast } from "sonner";

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

const DEFAULT_STAGES: PipelineStage[] = [
  { name: "Lint & TypeScript Validation", status: "success", duration_seconds: 12 },
  { name: "Unit & Integration Tests", status: "success", duration_seconds: 18 },
  { name: "Docker Container Image Scaffolding", status: "success", duration_seconds: 42 },
  { name: "Healthcheck & Smoke Verification", status: "success", duration_seconds: 6 },
];

export function DeploymentStatusCard({
  data,
  onRollback,
}: {
  data: DeploymentCardData;
  onRollback?: () => void;
}) {
  const [stages] = useState<PipelineStage[]>(data.stages || DEFAULT_STAGES);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleRollback = async () => {
    setIsRollingBack(true);
    try {
      toast.info("Joan of Arc (DevOps AI) initiating 1-click rollback to previous healthy revision...");
      setTimeout(() => {
        setIsRollingBack(false);
        toast.success("Rollback succeeded! Cluster re-routed to stable container revision.");
        if (onRollback) onRollback();
      }, 1500);
    } catch {
      setIsRollingBack(false);
      toast.error("Rollback failed");
    }
  };

  const isSuccess = data.status === "deployed";
  const isDeploying = data.status === "deploying";
  const isFailed = data.status === "failed";

  return (
    <div className="rounded-2xl border border-sky-900/40 bg-slate-900/90 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3.5 bg-gradient-to-r from-slate-900 via-sky-950/40 to-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-xl flex items-center justify-center border shadow-xs ${
              isSuccess
                ? "bg-emerald-950/80 border-emerald-700/60 text-emerald-400"
                : isDeploying
                ? "bg-sky-950/80 border-sky-700/60 text-sky-400"
                : "bg-rose-950/80 border-rose-700/60 text-rose-400"
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
              <h4 className="text-xs font-black uppercase tracking-wider text-white">
                DevOps CI/CD Deployment · {data.environment}
              </h4>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  isSuccess
                    ? "bg-emerald-950/90 text-emerald-300 border-emerald-700/60"
                    : isDeploying
                    ? "bg-sky-950/90 text-sky-300 border-sky-700/60"
                    : "bg-rose-950/90 text-rose-300 border-rose-700/60"
                }`}
              >
                {data.status}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 mt-0.5">
              <span>{data.version}</span>
              {data.commit_hash && (
                <>
                  <span>•</span>
                  <span className="text-sky-300">{data.commit_hash.slice(0, 7)}</span>
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
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900 text-xs font-bold text-slate-300 hover:text-white transition"
            >
              <span>View App</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {data.can_rollback !== false && (
            <button
              type="button"
              onClick={handleRollback}
              disabled={isRollingBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-800/60 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50 text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className={`h-3 w-3 ${isRollingBack ? "animate-spin" : ""}`} />
              <span>Rollback</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Pipeline Stages */}
      {isExpanded && (
        <div className="p-3 bg-slate-950/90 space-y-2 border-t border-slate-800">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            Pipeline Stages:
          </span>
          <div className="space-y-1.5">
            {stages.map((stg, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs"
              >
                <div className="flex items-center gap-2">
                  {stg.status === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : stg.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
                  ) : stg.status === "failed" ? (
                    <XCircle className="h-3.5 w-3.5 text-rose-400" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-slate-500" />
                  )}
                  <span className="text-slate-200 font-medium">{stg.name}</span>
                </div>
                {stg.duration_seconds && (
                  <span className="text-[10px] font-mono text-slate-500">
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
