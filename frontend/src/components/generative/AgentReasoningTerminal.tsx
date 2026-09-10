"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  Terminal,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Layers,
  CheckCircle2,
  XCircle,
  Bot,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  Trash2,
  Cpu,
  Filter,
} from "lucide-react";
import type { AgentEvent } from "@/lib/types";
import { toast } from "sonner";

export interface AgentReasoningTerminalProps {
  events: AgentEvent[];
  isStreaming?: boolean;
  activeTokens?: string;
  activeAgent?: { name: string; role: string } | null;
  activeTool?: { name: string; args?: unknown; status: string } | null;
  onClear?: () => void;
  title?: string;
  maxHeight?: string;
  showIfEmpty?: boolean;
}

export function AgentReasoningTerminal({
  events,
  isStreaming = false,
  activeTokens = "",
  activeAgent,
  activeTool,
  onClear,
  title = "Athena & Swarm · Live Reasoning Stream",
  maxHeight = "max-h-80",
  showIfEmpty = false,
}: AgentReasoningTerminalProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [filterType, setFilterType] = useState<"all" | "thought" | "tool_call" | "qa">("all");
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (isExpanded) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, activeTokens, isExpanded]);

  const toggleTool = (id: number) => {
    setExpandedTools((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyLog = () => {
    const text = events
      .map(
        (e) =>
          `[${new Date(e.created_at).toLocaleTimeString()}] ${e.sender_name || "Agent"} (${e.event_type}): ${
            e.message
          }`
      )
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Execution logs copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredEvents = useMemo(() => {
    if (filterType === "all") return events;
    if (filterType === "thought") return events.filter((e) => e.event_type === "thought");
    if (filterType === "tool_call") return events.filter((e) => e.event_type === "tool_call");
    if (filterType === "qa")
      return events.filter(
        (e) =>
          e.sender_role === "qa" ||
          (e.metadata && typeof e.metadata === "object" && "qa_gate" in e.metadata)
      );
    return events;
  }, [events, filterType]);

  if (events.length === 0 && !isStreaming && !showIfEmpty) {
    return null;
  }

  const containerClasses = isFullscreen
    ? "fixed inset-4 z-80 flex flex-col bg-slate-950 border border-indigo-500/50 rounded-2xl shadow-2xl overflow-hidden"
    : "rounded-2xl border border-indigo-900/40 bg-slate-950/90 shadow-xl overflow-hidden text-xs";

  return (
    <div className={containerClasses}>
      {/* Terminal Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-slate-950 via-indigo-950/60 to-slate-950 border-b border-indigo-900/40">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex h-2.5 w-2.5 items-center justify-center">
            {isStreaming ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </>
            ) : (
              <span className="inline-flex rounded-full h-2 w-2 bg-indigo-400" />
            )}
          </div>
          <Terminal className="h-3.5 w-3.5 text-indigo-400" />
          <span className="font-mono font-bold text-white text-[11px] uppercase tracking-wider">
            {title}
          </span>

          {isStreaming ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800/60 text-emerald-300 font-semibold flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin text-emerald-400" />
              <span>Streaming Live (SSE)</span>
            </span>
          ) : (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">
              {events.length} events logged
            </span>
          )}

          {activeAgent && (
            <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/80 border border-indigo-800/60 px-2 py-0.5 rounded-md flex items-center gap-1">
              <Bot className="h-2.5 w-2.5 text-indigo-400" />
              <span>{activeAgent.name}</span>
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {/* Filter Pills */}
          <div className="hidden sm:flex items-center gap-1 mr-2 bg-slate-900/80 p-0.5 rounded-lg border border-slate-800">
            {(["all", "thought", "tool_call", "qa"] as const).map((ft) => (
              <button
                key={ft}
                type="button"
                onClick={() => setFilterType(ft)}
                className={`px-2 py-0.5 text-[10px] font-mono rounded capitalize transition cursor-pointer ${
                  filterType === ft
                    ? "bg-indigo-600 text-white font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {ft === "all" ? "All" : ft === "thought" ? "Thoughts" : ft === "tool_call" ? "Tools" : "QA"}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={copyLog}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
            title="Copy Execution Logs"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>

          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 transition cursor-pointer"
              title="Clear Logs"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal Content Area */}
      {isExpanded && (
        <div
          className={`p-3 overflow-y-auto space-y-2 font-mono text-[11px] bg-slate-950/95 ${
            isFullscreen ? "flex-1" : maxHeight
          }`}
        >
          {filteredEvents.length === 0 && !isStreaming && (
            <div className="text-center py-6 text-slate-500 font-mono text-xs">
              No live reasoning events yet. Dispatch a task or swarm to stream agent steps.
            </div>
          )}

          {filteredEvents.map((e) => {
            const isThought = e.event_type === "thought";
            const isTool = e.event_type === "tool_call";
            const isCompleted = e.event_type === "completed";
            const isFailed = e.event_type === "failed";
            const isToolExpanded = expandedTools[e.id];

            return (
              <div
                key={e.id}
                className={`p-2.5 rounded-xl border transition-all duration-150 ${
                  isThought
                    ? "bg-indigo-950/30 border-indigo-800/40 text-indigo-200"
                    : isTool
                    ? "bg-amber-950/20 border-amber-800/40 text-amber-200"
                    : isCompleted
                    ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-200"
                    : isFailed
                    ? "bg-rose-950/30 border-rose-800/50 text-rose-200"
                    : "bg-slate-900/60 border-slate-800 text-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isThought ? (
                      <Sparkles className="h-3 w-3 text-indigo-400 shrink-0" />
                    ) : isTool ? (
                      <Layers className="h-3 w-3 text-amber-400 shrink-0" />
                    ) : isCompleted ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                    ) : isFailed ? (
                      <XCircle className="h-3 w-3 text-rose-400 shrink-0" />
                    ) : (
                      <Bot className="h-3 w-3 text-slate-400 shrink-0" />
                    )}
                    <span className="font-bold text-[10px] uppercase tracking-wider text-white">
                      {e.sender_name || "Athena"} · {e.event_type}
                    </span>
                    {e.metadata && typeof e.metadata === "object" && "tool_name" in e.metadata && (
                      <span className="bg-amber-950 border border-amber-800/60 text-amber-300 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono">
                        {String(e.metadata.tool_name)}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono">
                    {new Date(e.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>

                <div className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {e.message}
                </div>

                {/* Tool parameters & output disclosure */}
                {isTool && e.metadata && (
                  <div className="mt-2 pt-1.5 border-t border-amber-900/30">
                    <button
                      type="button"
                      onClick={() => toggleTool(e.id)}
                      className="text-[10px] font-mono text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                    >
                      {isToolExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      <span>{isToolExpanded ? "Hide Tool Details" : "View Tool Arguments & Result"}</span>
                    </button>
                    {isToolExpanded && (
                      <pre className="mt-1.5 p-2 rounded-lg bg-slate-950 text-[10px] text-amber-200/90 font-mono overflow-x-auto">
                        {JSON.stringify(e.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Active Streaming Token Delta with Pulse Cursor */}
          {isStreaming && activeTokens && (
            <div className="p-2.5 rounded-xl border border-emerald-800/50 bg-emerald-950/20 text-emerald-200">
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Streaming Partial Tokens…</span>
              </div>
              <div className="text-xs font-mono text-emerald-100 whitespace-pre-wrap leading-relaxed">
                {activeTokens}
                <span className="inline-block w-1.5 h-3.5 bg-emerald-400 ml-1 animate-pulse align-middle" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
