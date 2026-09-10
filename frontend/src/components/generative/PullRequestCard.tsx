"use client";

import React, { useState } from "react";
import {
  GitPullRequest,
  GitMerge,
  GitBranch,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Loader2,
  Clock,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

export interface PullRequestData {
  pr_url?: string;
  pr_number?: number;
  title: string;
  branch: string;
  target_branch?: string;
  author_name?: string;
  author_role?: string;
  additions?: number;
  deletions?: number;
  changed_files_count?: number;
  status: "open" | "merged" | "closed" | "draft";
  can_merge?: boolean;
}

export function PullRequestCard({
  data,
  onMerged,
}: {
  data: PullRequestData;
  onMerged?: () => void;
}) {
  const [isMerging, setIsMerging] = useState(false);
  const [status, setStatus] = useState(data.status);

  const handleMerge = async () => {
    setIsMerging(true);
    try {
      // Dispatch merge notification or tool execution
      toast.success(
        <div className="flex flex-col gap-0.5">
          <span className="font-bold text-white">Pull Request Approved & Merged!</span>
          <span className="text-xs text-slate-300">
            Branch {data.branch} merged into {data.target_branch || "main"}.
          </span>
        </div>
      );
      setStatus("merged");
      if (onMerged) onMerged();
    } catch (err) {
      toast.error("Failed to merge pull request: " + String(err));
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="rounded-2xl border border-indigo-900/50 bg-slate-900/90 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-xl flex items-center justify-center border shadow-xs ${
              status === "merged"
                ? "bg-purple-950/80 border-purple-700/60 text-purple-400"
                : "bg-indigo-950/80 border-indigo-700/60 text-indigo-400"
            }`}
          >
            {status === "merged" ? (
              <GitMerge className="h-5 w-5" />
            ) : (
              <GitPullRequest className="h-5 w-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-white">
                {data.title || "GitHub Pull Request Generated"}
              </h4>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  status === "merged"
                    ? "bg-purple-950/90 text-purple-300 border-purple-700/60"
                    : status === "open"
                    ? "bg-emerald-950/90 text-emerald-300 border-emerald-700/60"
                    : "bg-slate-800 text-slate-400 border-slate-700"
                }`}
              >
                {status === "merged" ? "Merged" : status === "open" ? "Open" : status}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 mt-1">
              <span className="flex items-center gap-1 text-slate-300">
                <GitBranch className="h-3 w-3 text-indigo-400" />
                {data.branch}
              </span>
              <span>➔</span>
              <span className="text-slate-300">{data.target_branch || "main"}</span>
            </div>
          </div>
        </div>

        {/* Diff Stats */}
        <div className="flex items-center gap-2">
          {data.additions !== undefined && (
            <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-md">
              +{data.additions}
            </span>
          )}
          {data.deletions !== undefined && (
            <span className="text-[11px] font-mono font-bold text-rose-400 bg-rose-950/60 border border-rose-800/60 px-2 py-0.5 rounded-md">
              -{data.deletions}
            </span>
          )}
          {data.changed_files_count !== undefined && (
            <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800 flex items-center gap-1">
              <FileCode className="h-3 w-3" />
              {data.changed_files_count} files
            </span>
          )}
        </div>
      </div>

      {/* Footer & Actions */}
      <div className="p-3 bg-slate-950/80 flex items-center justify-between gap-3 border-t border-slate-800">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
          <span>Author: {data.author_name || "Autonomous Agent"} ({data.author_role || "backend"})</span>
        </div>

        <div className="flex items-center gap-2">
          {data.pr_url && (
            <a
              href={data.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-700 transition"
            >
              <span>View on GitHub</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {status === "open" && data.can_merge !== false && (
            <button
              type="button"
              onClick={handleMerge}
              disabled={isMerging}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md shadow-purple-600/30 transition cursor-pointer disabled:opacity-50"
            >
              {isMerging ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Merging PR…</span>
                </>
              ) : (
                <>
                  <GitMerge className="h-3.5 w-3.5" />
                  <span>Tech Lead Merge</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
