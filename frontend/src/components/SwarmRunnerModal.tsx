"use client";

import React, { useState } from "react";
import { Modal, Button, Badge } from "@/components/ui";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { useTasks } from "@/lib/queries";
import { executeSwarmChain, apiErrorDetail } from "@/lib/api";
import { useAgentStream } from "@/lib/useAgentStream";
import { AgentReasoningTerminal } from "./generative/AgentReasoningTerminal";
import type { AgentExecutionTrace } from "@/lib/types";

export interface SwarmRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwarmCompleted?: (taskId: number) => void;
}

export function SwarmRunnerModal({
  isOpen,
  onClose,
  onSwarmCompleted,
}: SwarmRunnerModalProps) {
  const [instruction, setInstruction] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<number | "">("");
  const [isRunning, setIsRunning] = useState(false);
  const [resultTrace, setResultTrace] = useState<AgentExecutionTrace | { error: string } | null>(null);

  const { data: tasks } = useTasks();
  const availableTasks = tasks?.filter((t) => t.status !== "done") || [];

  const {
    events,
    isStreaming,
    activeTokens,
    activeAgent,
    activeTool,
    clearEvents
  } = useAgentStream({
    taskId: selectedTaskId ? Number(selectedTaskId) : undefined,
    autoConnect: isRunning
  });

  const handleClose = () => {
    if (isRunning) return;
    setInstruction("");
    setSelectedTaskId("");
    setResultTrace(null);
    clearEvents();
    onClose();
  };

  const runSwarm = async () => {
    if (!selectedTaskId) {
      toast.error("Please select a ticket.");
      return;
    }

    setIsRunning(true);
    setResultTrace(null);
    clearEvents();

    try {
      const res = await executeSwarmChain(Number(selectedTaskId), instruction);
      setResultTrace(res.trace);
      toast.success(res.message || "Agent swarm completed successfully!");
      if (onSwarmCompleted) onSwarmCompleted(Number(selectedTaskId));
    } catch (err) {
      const msg = apiErrorDetail(err, "The agent swarm could not start");
      toast.error(msg);
      setResultTrace({ error: msg });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Run the agent swarm"
      description="Pick a ticket and let the agent team work on it. Progress below comes from the live event stream."
      maxWidth="3xl"
    >
      <div className="space-y-6">
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="swarm-ticket">
            Ticket
          </label>
          <select
            id="swarm-ticket"
            value={selectedTaskId}
            onChange={(e) => setSelectedTaskId(e.target.value ? Number(e.target.value) : "")}
            disabled={isRunning}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          >
            <option value="">Select a ticket...</option>
            {availableTasks.length === 0 ? (
              <option disabled value="none">No open tickets found.</option>
            ) : (
              availableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.id} — {t.title} — {t.project_name || t.project || "Unknown Project"}
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="swarm-instruction">
            Instruction (Optional)
          </label>
          <div className="flex gap-2 items-start">
            <textarea
              id="swarm-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={isRunning}
              placeholder="Any specific instructions for the agent swarm..."
              rows={2}
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 resize-none"
            />
            <Button
              variant="default"
              size="md"
              onClick={runSwarm}
              isLoading={isRunning}
              disabled={isRunning || !selectedTaskId}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isRunning ? "Running…" : "Run swarm"}</span>
            </Button>
          </div>
        </div>

        {resultTrace && "error" in resultTrace && (
          <div className="p-3 text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl">
            {resultTrace.error}
          </div>
        )}

        {(events.length > 0 || isRunning) && (
          <div className="mt-4">
            <AgentReasoningTerminal
              events={events}
              isStreaming={isStreaming}
              activeTokens={activeTokens}
              activeAgent={activeAgent}
              activeTool={activeTool}
              title="Live agent activity"
              showIfEmpty={true}
            />
          </div>
        )}

        {resultTrace && !("error" in resultTrace) && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-2 text-xs">
            <div className="font-bold text-slate-900 dark:text-white">Execution Trace</div>
            <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-slate-400">
              <div>Status: <span className="font-medium text-slate-900 dark:text-white">{resultTrace.status}</span></div>
              <div>Tokens used: <span className="font-medium text-slate-900 dark:text-white">{resultTrace.tokens_used}</span></div>
              <div>Duration: <span className="font-medium text-slate-900 dark:text-white">{resultTrace.duration_seconds}s</span></div>
              <div>Cost: <span className="font-medium text-slate-900 dark:text-white">${resultTrace.cost_usd}</span></div>
            </div>
            {resultTrace.langfuse_url && (
              <div className="pt-2">
                <a href={resultTrace.langfuse_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                  View full trace on Langfuse
                </a>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Badge variant="indigo">LangGraph</Badge>
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
