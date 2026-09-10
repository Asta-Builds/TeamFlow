"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";

export interface ValidationItem {
  id: string;
  label: string;
  category?: "security" | "functionality" | "accessibility" | "performance";
  passed: boolean;
  blocker?: boolean;
  notes?: string;
}

export interface ValidationContractData {
  title?: string;
  summary?: string;
  qa_agent_name?: string;
  qa_status: "passed" | "rejected" | "pending";
  items: ValidationItem[];
  automated_tests_total?: number;
  automated_tests_passed?: number;
  coverage_percentage?: number;
  langfuse_trace_id?: string;
}

export function ValidationContractCard({
  contract,
  interactive = true,
  onStatusChange,
}: {
  contract: ValidationContractData;
  interactive?: boolean;
  onStatusChange?: (updatedItems: ValidationItem[]) => void;
}) {
  const [items, setItems] = useState<ValidationItem[]>(contract.items || []);
  const [isExpanded, setIsExpanded] = useState(true);

  const passedCount = items.filter((i) => i.passed).length;
  const totalCount = items.length;
  const isFullyPassed = totalCount > 0 && passedCount === totalCount;
  const hasBlocker = items.some((i) => !i.passed && i.blocker);

  const toggleItem = (id: string) => {
    if (!interactive) return;
    const updated = items.map((i) => (i.id === id ? { ...i, passed: !i.passed } : i));
    setItems(updated);
    if (onStatusChange) onStatusChange(updated);
    toast.success("Validation contract updated");
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl overflow-hidden transition-all duration-200">
      {/* Contract Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-800 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-xl flex items-center justify-center border shadow-xs ${
              isFullyPassed
                ? "bg-emerald-950/80 border-emerald-700/60 text-emerald-400"
                : hasBlocker
                ? "bg-rose-950/80 border-rose-700/60 text-rose-400"
                : "bg-amber-950/80 border-amber-700/60 text-amber-400"
            }`}
          >
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-white">
                {contract.title || "QA Validation Contract · Definition of Done"}
              </h4>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  isFullyPassed
                    ? "bg-emerald-950/90 text-emerald-300 border-emerald-700/60"
                    : hasBlocker
                    ? "bg-rose-950/90 text-rose-300 border-rose-700/60"
                    : "bg-amber-950/90 text-amber-300 border-amber-700/60"
                }`}
              >
                {isFullyPassed ? "Accepted" : hasBlocker ? "QA Rejected" : "Reviewing"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {contract.summary || "Autonomous QA Decision Gate checks against acceptance criteria."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {contract.coverage_percentage !== undefined && (
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 font-semibold">
              Coverage: <span className="text-indigo-400">{contract.coverage_percentage}%</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            aria-label={isExpanded ? "Collapse Contract" : "Expand Contract"}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Contract Body */}
      {isExpanded && (
        <div className="p-4 space-y-3">
          {/* Progress Overview Bar */}
          <div className="space-y-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
            <div className="flex justify-between text-[11px] font-mono font-semibold text-slate-400">
              <span className="flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5 text-indigo-400" />
                <span>Verification Score</span>
              </span>
              <span className={isFullyPassed ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                {passedCount} of {totalCount} Criteria Satisfied ({totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-300 ${
                  isFullyPassed ? "bg-emerald-500" : hasBlocker ? "bg-rose-500" : "bg-amber-500"
                }`}
                style={{ width: `${totalCount > 0 ? (passedCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Checklist Items */}
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => toggleItem(item.id)}
                className={`group flex items-start gap-3 p-3 rounded-xl border transition-all ${
                  interactive ? "cursor-pointer hover:border-slate-600" : ""
                } ${
                  item.passed
                    ? "bg-slate-950/60 border-slate-800/80"
                    : item.blocker
                    ? "bg-rose-950/20 border-rose-900/40"
                    : "bg-slate-950/40 border-slate-800"
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {item.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : item.blocker ? (
                    <XCircle className="h-4 w-4 text-rose-400" />
                  ) : (
                    <Clock className="h-4 w-4 text-amber-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        item.passed ? "text-slate-300 line-through opacity-80" : "text-white"
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.blocker && (
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-950 border border-rose-800/60 text-rose-300">
                        Blocker
                      </span>
                    )}
                    {item.category && (
                      <span className="text-[9px] font-mono uppercase text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                        {item.category}
                      </span>
                    )}
                  </div>
                  {item.notes && (
                    <p className="text-[11px] text-slate-400 mt-1 font-mono">{item.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Footer with sign-off details */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 font-mono">
            <span>Inspector: {contract.qa_agent_name || "qa@teamflow.dev"}</span>
            {contract.automated_tests_total !== undefined && (
              <span>
                Automated Suite: {contract.automated_tests_passed || 0}/{contract.automated_tests_total} passed
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
