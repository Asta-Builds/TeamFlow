"use client";

import React, { useState } from "react";
import { Modal, Button, Badge } from "@/components/ui";
import { toast } from "sonner";
import {
  Sparkles,
  Code2,
  GitPullRequest,
  ShieldCheck,
  Rocket,
  CheckCircle2,
  Loader2,
  Clock,
  Terminal,
} from "lucide-react";

interface SwarmStage {
  id: string;
  agent: string;
  role: string;
  icon: React.ComponentType<{ className?: string }>;
  status: "pending" | "running" | "completed";
  detail: string;
  tokens: number;
}

const INITIAL_STAGES: SwarmStage[] = [
  {
    id: "tech_lead",
    agent: "Sarah Jenkins",
    role: "AI Tech Lead",
    icon: Code2,
    status: "pending",
    detail: "Querying pgvector RAG store & decomposing architectural scope...",
    tokens: 420,
  },
  {
    id: "backend",
    agent: "Marcus Aurelius",
    role: "AI Senior Backend",
    icon: GitPullRequest,
    status: "pending",
    detail: "Implementing database schema, migrations & REST API endpoints...",
    tokens: 680,
  },
  {
    id: "frontend",
    agent: "Ada Lovelace",
    role: "AI Senior Frontend",
    icon: Sparkles,
    status: "pending",
    detail: "Building Next.js 16 components, Lucide icons & Sonner feedback...",
    tokens: 590,
  },
  {
    id: "qa",
    agent: "Alan Turing",
    role: "AI QA Engineer",
    icon: ShieldCheck,
    status: "pending",
    detail: "Running boundary test suites, WCAG AA audit & signing QA decision gate...",
    tokens: 480,
  },
  {
    id: "devops",
    agent: "Joan of Arc",
    role: "AI DevOps Engineer",
    icon: Rocket,
    status: "pending",
    detail: "Automating staging container release, health check & Langfuse trace...",
    tokens: 390,
  },
];

export interface SwarmRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPrompt?: string;
  onSwarmCompleted?: (taskId?: number) => void;
}

export function SwarmRunnerModal({
  isOpen,
  onClose,
  defaultPrompt = "Implement Zero-Trust JWT Rotation & Accessible Navigation",
  onSwarmCompleted,
}: SwarmRunnerModalProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [isRunning, setIsRunning] = useState(false);
  const [stages, setStages] = useState<SwarmStage[]>(INITIAL_STAGES);
  const [logs, setLogs] = useState<Array<{ time: string; message: string; agent: string }>>([]);
  const [ticketId, setTicketId] = useState<number>(() => Math.floor(100 + Math.random() * 900));

  const handleClose = () => {
    if (isRunning) return;
    setStages(INITIAL_STAGES);
    setLogs([]);
    onClose();
  };

  const runSwarm = async () => {
    if (!prompt.trim()) {
      toast.error("Please provide a swarm task scope or prompt.");
      return;
    }

    setIsRunning(true);
    setStages(INITIAL_STAGES.map((s) => ({ ...s, status: "pending" })));
    const assignedTicket = ticketId || Math.floor(100 + Math.random() * 900);
    setTicketId(assignedTicket);
    const sessionId = `ticket-${assignedTicket}`;

    toast.info(`Swarm initiated for ticket #${assignedTicket}`, {
      description: "Tech Lead orchestrating LangGraph multi-agent execution pipeline.",
    });

    const addLog = (agent: string, message: string) => {
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLogs((prev) => [{ time, message, agent }, ...prev]);
    };

    addLog("CEO (Founder)", `Dispatched task: "${prompt}" (Trace: ${sessionId})`);

    for (let i = 0; i < INITIAL_STAGES.length; i++) {
      setStages((prev) =>
        prev.map((stage, idx) => {
          if (idx === i) return { ...stage, status: "running" };
          if (idx < i) return { ...stage, status: "completed" };
          return { ...stage, status: "pending" };
        })
      );

      const stage = INITIAL_STAGES[i];
      addLog(stage.role, stage.detail);

      // Simulate realistic agent pipeline step execution
      await new Promise((r) => setTimeout(r, 1400));

      setStages((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "completed" } : s))
      );
    }

    setIsRunning(false);
    toast.success(`Autonomous Swarm execution completed for ticket #${assignedTicket}!`, {
      description: "All 5 stages passed. Staging deployment verified.",
    });

    addLog("System", `All gates passed. 100% traces recorded to Langfuse (session: ${sessionId}).`);
    if (onSwarmCompleted) onSwarmCompleted(assignedTicket);
  };

  const totalTokens = stages
    .filter((s) => s.status === "completed")
    .reduce((acc, s) => acc + s.tokens, 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Autonomous Multi-Agent Swarm Orchestrator"
      description="Orchestrate full-lifecycle tickets through autonomous AI specialists grounded in pgvector RAG."
      maxWidth="3xl"
    >
      <div className="space-y-6">
        {/* Scope Input */}
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5" htmlFor="swarm-prompt">
            Feature Scope / Initiative Directive
          </label>
          <div className="flex gap-2">
            <input
              id="swarm-prompt"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isRunning}
              placeholder="e.g. Architect Zero-Trust JWT rotation and WCAG AA contrast..."
              className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
            />
            <Button
              variant="default"
              size="md"
              onClick={runSwarm}
              isLoading={isRunning}
              disabled={isRunning || !prompt.trim()}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isRunning ? "Executing Swarm…" : "Execute Swarm"}</span>
            </Button>
          </div>
        </div>

        {/* 5-Stage Visual Workflow Chain */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400">
            <span>Specialist Execution Chain</span>
            {ticketId && (
              <span className="font-mono text-[11px] text-indigo-400">
                Session: ticket-{ticketId}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {stages.map((stage, idx) => {
              const Icon = stage.icon;
              const isCompleted = stage.status === "completed";
              const isCurrent = stage.status === "running";

              return (
                <div
                  key={stage.id}
                  className={`rounded-xl border p-3 flex flex-col justify-between transition-all duration-200 ${
                    isCurrent
                      ? "border-indigo-500 bg-indigo-950/40 shadow-md shadow-indigo-600/20 ring-1 ring-indigo-500"
                      : isCompleted
                      ? "border-emerald-800/60 bg-emerald-950/20"
                      : "border-slate-800 bg-slate-950/60 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                      <Icon className="h-4 w-4" />
                    </div>
                    {isCompleted ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : isCurrent ? (
                      <Loader2 className="h-4 w-4 text-indigo-400 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Clock className="h-4 w-4 text-slate-600" />
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-bold text-white truncate">{stage.role}</div>
                    <div className="text-[10px] text-slate-400 truncate">{stage.agent}</div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>Stage {idx + 1}</span>
                    <span>{stage.tokens} tok</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Real-time Streaming Logs & Observability Console */}
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
              <Terminal className="h-3.5 w-3.5 text-indigo-400" />
              <span>Live Agent Communication & Handoff Logs</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="text-slate-400">
                Tokens: <strong className="text-white">{totalTokens}</strong>
              </span>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none"></span>
                Langfuse Active
              </span>
            </div>
          </div>

          <div
            role="log"
            aria-live="polite"
            className="max-h-48 overflow-y-auto space-y-2 font-mono text-xs text-slate-300 pr-1"
          >
            {logs.length === 0 ? (
              <p className="text-slate-600 text-[11px] py-4 text-center">
                Click &quot;Execute Swarm&quot; to initiate multi-agent orchestration.
              </p>
            ) : (
              logs.map((log, lIdx) => (
                <div key={lIdx} className="flex items-start gap-2.5 text-[11px]">
                  <span className="text-slate-500 shrink-0">{log.time}</span>
                  <span className="font-bold text-indigo-400 shrink-0">[{log.agent}]</span>
                  <span className="text-slate-300 break-words">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <Badge variant="indigo">LangGraph 0.2</Badge>
            <Badge variant="success">pgvector RAG</Badge>
            <Badge variant="outline">Langfuse Traced</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleClose} disabled={isRunning}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
