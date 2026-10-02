"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamAgentEvents, getAgentEvents, approveRelease, rejectRelease } from "@/lib/api";
import type { AgentEvent } from "@/lib/types";
import { toast } from "sonner";

export interface ToolConfirmationRequest {
  id: string;
  toolName: string;
  title: string;
  description: string;
  arguments: Record<string, unknown>;
  dangerLevel: "low" | "medium" | "high";
  requiresReason?: boolean;
  /** The server-side approval this prompt decides. Without one there is nothing to decide. */
  approvalId?: number;
}

export interface UseAgentStreamOptions {
  taskId?: number;
  projectId?: number;
  sessionId?: string;
  autoConnect?: boolean;
  onEvent?: (event: AgentEvent) => void;
  onToolConfirmation?: (request: ToolConfirmationRequest) => Promise<boolean>;
  onStreamComplete?: () => void;
}

export function useAgentStream({
  taskId,
  projectId,
  sessionId,
  autoConnect = true,
  onEvent,
  onToolConfirmation,
  onStreamComplete,
}: UseAgentStreamOptions) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTokens, setActiveTokens] = useState("");
  const [activeAgent, setActiveAgent] = useState<{
    name: string;
    role: string;
    key?: string;
  } | null>(null);
  const [activeTool, setActiveTool] = useState<{
    name: string;
    args?: unknown;
    status: "running" | "completed" | "failed";
  } | null>(null);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<ToolConfirmationRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const seenEventIdsRef = useRef<Set<number>>(new Set());

  // Handle individual event processing
  const handleIncomingEvent = useCallback(
    (e: AgentEvent) => {
      // Deduplicate by event ID
      if (e.id && seenEventIdsRef.current.has(e.id)) {
        return;
      }
      if (e.id) {
        seenEventIdsRef.current.add(e.id);
      }

      setEvents((prev) => [...prev, e]);

      // A release waiting for a human. The backend emits this as a `blocked` event,
      // so it is handled for every event type, not only tool calls.
      if (e.metadata && e.metadata.requires_confirmation && e.metadata.approval_id) {
        const approvalTool = String((e.metadata && e.metadata.tool_name) || "release");
        const req: ToolConfirmationRequest = {
          id: `approval-${e.metadata.approval_id}`,
          approvalId: Number(e.metadata.approval_id),
          toolName: approvalTool,
          title: String(e.metadata.confirmation_title || "Approve release"),
          description: String(
            e.metadata.confirmation_description || e.message || "Human approval required."
          ),
          arguments: (e.metadata.tool_args as Record<string, unknown>) || {},
          dangerLevel: (e.metadata.danger_level as "low" | "medium" | "high") || "high",
          requiresReason: Boolean(e.metadata.requires_reason),
        };
        setPendingConfirmation(req);
        if (onToolConfirmation) {
          onToolConfirmation(req).catch(console.error);
        }
      }

      // Update active agent presence
      if (e.sender_name) {
        setActiveAgent({
          name: e.sender_name,
          role: e.sender_role,
          key: e.sender_key,
        });
      }

      // Handle thought streaming & token accumulation
      if (e.event_type === "thought") {
        setActiveTokens(e.message);
      } else if (e.event_type === "tool_call") {
        const toolName = String(
          (e.metadata && e.metadata.tool_name) || "Tool Execution"
        );
        setActiveTool({
          name: toolName,
          args: e.metadata && e.metadata.tool_args,
          status: "running",
        });

        // Client-side tool triggering: check for toast triggers
        if (e.metadata && e.metadata.trigger_toast) {
          toast.info(String(e.metadata.toast_message || `Agent executing ${toolName}`));
        }

      } else if (e.event_type === "completed") {
        setActiveTool((prev) => (prev ? { ...prev, status: "completed" } : null));
        setActiveTokens("");
      } else if (e.event_type === "failed") {
        setActiveTool((prev) => (prev ? { ...prev, status: "failed" } : null));
      }

      if (onEvent) {
        onEvent(e);
      }
    },
    [onEvent, onToolConfirmation]
  );

  // Connect SSE
  const connect = useCallback(() => {
    if (!taskId && !projectId) return;

    abortControllerRef.current?.abort();
    const ac = new AbortController();
    abortControllerRef.current = ac;

    // Initial historical events catch-up
    getAgentEvents({ taskId, projectId, sessionId })
      .then((res) => {
        if (res.events && res.events.length > 0) {
          res.events.forEach((ev) => {
            if (ev.id) seenEventIdsRef.current.add(ev.id);
          });
          setEvents(res.events);
        }
      })
      .catch((err) => {
        console.warn("Could not prefetch historical agent events:", err);
      });

    // Begin SSE stream
    streamAgentEvents(
      { taskId, projectId, sessionId },
      handleIncomingEvent,
      ac.signal,
      true,
      () => {
        setIsStreaming(true);
        setError(null);
      }
    )
      .then(() => {
        setIsStreaming(false);
        setActiveTokens("");
        if (onStreamComplete) onStreamComplete();
      })
      .catch((err) => {
        if (!ac.signal.aborted) {
          console.error("SSE agent stream error:", err);
          setError(err instanceof Error ? err.message : String(err));
          setIsStreaming(false);
        }
      });
  }, [taskId, projectId, sessionId, handleIncomingEvent, onStreamComplete]);

  const disconnect = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
    seenEventIdsRef.current.clear();
    setActiveTokens("");
    setActiveTool(null);
  }, []);

  /**
   * Sends the decision to the backend and clears the prompt only when the server
   * accepted it. Progress after that arrives through the event stream; this hook
   * never adds an event of its own, because nothing has happened until the
   * backend says so.
   */
  const resolveConfirmation = useCallback(
    async (approved: boolean, feedback?: string) => {
      if (!pendingConfirmation) return;
      const conf = pendingConfirmation;
      if (!conf.approvalId) {
        toast.error("This action has no approval on the server and cannot be decided here.");
        return;
      }
      const reason = (feedback || "").trim();
      if (!approved && !reason) {
        toast.error("A reason is required to reject a release.");
        return;
      }

      try {
        if (approved) {
          await approveRelease(conf.approvalId, reason);
          toast.success("Release approved — merging now.");
        } else {
          await rejectRelease(conf.approvalId, reason);
          toast.success("Release rejected.");
        }
        setPendingConfirmation(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The decision could not be recorded.");
      }
    },
    [pendingConfirmation]
  );

  // Optimistic UI state injector
  const injectOptimisticEvent = useCallback((partial: Partial<AgentEvent>) => {
    const syntheticEvent: AgentEvent = {
      id: Date.now(),
      session_id: "optimistic",
      event_type: partial.event_type || "thought",
      sender_key: partial.sender_key || "frontend",
      sender_name: partial.sender_name || "Senior Frontend",
      sender_role: partial.sender_role || "frontend",
      recipient_key: partial.recipient_key || "",
      message: partial.message || "",
      current_work: partial.current_work || "",
      remaining_work: partial.remaining_work || [],
      metadata: partial.metadata || {},
      task: partial.task || 0,
      task_title: partial.task_title || "",
      project: partial.project || 0,
      project_name: partial.project_name || "",
      trace: null,
      created_at: new Date().toISOString(),
    };
    setEvents((prev) => [...prev, syntheticEvent]);
  }, []);

  useEffect(() => {
    if (autoConnect && (taskId || projectId)) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [autoConnect, taskId, projectId, connect, disconnect]);

  return {
    events,
    isStreaming,
    activeTokens,
    activeAgent,
    activeTool,
    pendingConfirmation,
    error,
    connect,
    disconnect,
    clearEvents,
    resolveConfirmation,
    injectOptimisticEvent,
  };
}
