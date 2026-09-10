"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  ShieldAlert,
  Bot,
  Terminal,
  Code,
} from "lucide-react";
import type { ToolConfirmationRequest } from "@/lib/useAgentStream";

export function AgentToolConfirmationModal({
  request,
  onResolve,
}: {
  request: ToolConfirmationRequest;
  onResolve: (approved: boolean, feedback?: string) => void;
}) {
  const [feedback, setFeedback] = useState("");

  const isHighDanger = request.dangerLevel === "high";

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 shadow-2xl border border-amber-600/50 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div
              className={`h-10 w-10 rounded-xl flex items-center justify-center border shadow-sm ${
                isHighDanger
                  ? "bg-rose-950/80 border-rose-700/60 text-rose-400"
                  : "bg-amber-950/80 border-amber-700/60 text-amber-400"
              }`}
            >
              {isHighDanger ? <ShieldAlert className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-white">
                  Human Confirmation Required
                </h3>
                <span
                  className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                    isHighDanger
                      ? "bg-rose-950 border border-rose-800 text-rose-300"
                      : "bg-amber-950 border border-amber-800 text-amber-300"
                  }`}
                >
                  {request.dangerLevel} Risk
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                An autonomous agent is requesting permission to execute a privileged tool.
              </p>
            </div>
          </div>
          <button
            onClick={() => onResolve(false, "User dismissed modal.")}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Action Details */}
        <div className="space-y-3">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              Tool Action:
            </span>
            <div className="text-sm font-bold text-white mt-0.5 font-mono flex items-center gap-2">
              <Terminal className="h-4 w-4 text-amber-400" />
              <span>{request.toolName}</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300 leading-relaxed">
            {request.description}
          </div>

          {/* Arguments payload */}
          {request.arguments && Object.keys(request.arguments).length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Payload Arguments:
              </span>
              <pre className="p-3 rounded-xl border border-slate-800 bg-slate-950 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-36">
                {JSON.stringify(request.arguments, null, 2)}
              </pre>
            </div>
          )}

          {/* Feedback input */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Notes or Feedback for Agent (Optional):
            </label>
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. Approve only staging deployment; do not push to prod yet."
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={() => onResolve(false, feedback || "Rejected by Human Executive.")}
            className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition cursor-pointer flex items-center gap-1.5"
          >
            <XCircle className="h-4 w-4 text-rose-400" />
            <span>Reject Action</span>
          </button>

          <button
            type="button"
            onClick={() => onResolve(true, feedback)}
            className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-md shadow-emerald-600/30"
          >
            <CheckCircle2 className="h-4 w-4 text-white" />
            <span>Approve Execution</span>
          </button>
        </div>
      </div>
    </div>
  );
}
