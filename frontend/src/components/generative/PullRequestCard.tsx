"use client";

import React from "react";
import {
  GitPullRequest,
  GitMerge,
  GitBranch,
  ExternalLink,
  FileCode,
  Sparkles,
} from "lucide-react";

export interface PullRequestData {
  pr_url?: string;
  pr_number?: number;
  title: string;
  branch?: string;
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
}: {
  data: PullRequestData;
}) {
  const { status } = data;

  return (
    <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/50 bg-white dark:bg-slate-900/90 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-gradient-to-r dark:from-slate-900 dark:via-indigo-950/40 dark:to-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-xl flex items-center justify-center border shadow-xs ${
              status === "merged"
                ? "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:bg-purple-950/80 dark:border-purple-700/60 dark:text-purple-400"
                : "bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:bg-indigo-950/80 dark:border-indigo-700/60 dark:text-indigo-400"
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
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                {data.title || "GitHub Pull Request Generated"}
              </h4>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  status === "merged"
                    ? "bg-purple-500/10 text-purple-700 dark:bg-purple-950/90 dark:text-purple-300 border-purple-500/30 dark:border-purple-700/60"
                    : status === "open"
                    ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-950/90 dark:text-emerald-300 border-emerald-500/30 dark:border-emerald-700/60"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                }`}
              >
                {status === "merged" ? "Merged" : status === "open" ? "Open" : status}
              </span>
            </div>
            {(data.branch || data.target_branch) && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                {data.branch && (
                  <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                    <GitBranch className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                    {data.branch}
                  </span>
                )}
                {data.branch && data.target_branch && <span>➔</span>}
                {data.target_branch && (
                  <span className="text-slate-700 dark:text-slate-300">{data.target_branch}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Diff Stats */}
        <div className="flex items-center gap-2">
          {data.additions !== undefined && (
            <span className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-950/60 border border-emerald-500/30 dark:border-emerald-800/60 px-2 py-0.5 rounded-md">
              +{data.additions}
            </span>
          )}
          {data.deletions !== undefined && (
            <span className="text-[11px] font-mono font-bold text-rose-700 dark:text-rose-400 bg-rose-500/10 dark:bg-rose-950/60 border border-rose-500/30 dark:border-rose-800/60 px-2 py-0.5 rounded-md">
              -{data.deletions}
            </span>
          )}
          {data.changed_files_count !== undefined && (
            <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-950 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-800 flex items-center gap-1">
              <FileCode className="h-3 w-3" />
              {data.changed_files_count} files
            </span>
          )}
        </div>
      </div>

      {/* Footer & Actions */}
      <div className="p-3 bg-slate-50/80 dark:bg-slate-950/80 flex items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          {(data.author_name || data.author_role) && (
            <>
              <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>
                Author: {data.author_name && data.author_role ? `${data.author_name} (${data.author_role})` : (data.author_name || data.author_role)}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {data.pr_url && (
            <a
              href={data.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700 transition"
            >
              <span>View on GitHub</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
