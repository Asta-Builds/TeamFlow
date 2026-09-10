"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamAgentEvents, getAgentEvents } from "@/lib/api";
import type { AgentEvent, AgentEventType } from "@/lib/types";
import { toast } from "sonner";

export interface ToolConfirmationRequest {
  id: string;
  toolName: string;
  title: string;
  description: string;
  arguments: Record<string, unknown>;
  dangerLevel: "low" | "medium" | "high";
  requiresReason?: boolean;
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

        // Client-side tool triggering: human-in-the-loop confirmation
        if (
          e.metadata &&
          (e.metadata.requires_confirmation ||
            e.metadata.tool_name === "request_user_confirmation" ||
            e.metadata.tool_name === "git_merge_pr" ||
            e.metadata.tool_name === "deploy_to_production")
        ) {
          const req: ToolConfirmationRequest = {
            id: `conf-${e.id || Date.now()}`,
            toolName,
            title: String(e.metadata.confirmation_title || `Confirm ${toolName}`),
            description: String(
              e.metadata.confirmation_description || e.message || "Human approval required."
            ),
            arguments: (e.metadata.tool_args as Record<string, unknown>) || {},
            dangerLevel:
              (e.metadata.danger_level as "low" | "medium" | "high") ||
              (toolName.includes("deploy") || toolName.includes("merge")
                ? "high"
                : "medium"),
            requiresReason: Boolean(e.metadata.requires_reason),
          };
          setPendingConfirmation(req);
          if (onToolConfirmation) {
            onToolConfirmation(req).catch(console.error);
          }
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
    setIsStreaming(true);
    setError(null);

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
      ac.signal
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

  // Client-side confirmation resolver
  const resolveConfirmation = useCallback(
    (approved: boolean, feedback?: string) => {
      if (!pendingConfirmation) return;
      const conf = pendingConfirmation;
      setPendingConfirmation(null);

      // Create an optimistic confirmation event
      const confirmationEvent: AgentEvent = {
        id: Date.now(),
        session_id: sessionId || `session-${Date.now()}`,
        event_type: approved ? "progress" : "blocked",
        sender_key: "ceo",
        sender_name: "Human Executive (CEO)",
        sender_role: "ceo",
        recipient_key: activeAgent?.key || "pm",
        message: approved
          ? `Human approved action: "${conf.title}". Proceeding with execution.`
          : `Human rejected action: "${conf.title}". Reason: ${feedback || "Rejected by user."}`,
        current_work: approved ? `Executing ${conf.toolName}` : "Action canceled",
        remaining_work: [],
        metadata: {
          confirmation_id: conf.id,
          tool_name: conf.toolName,
          approved,
          feedback: feedback || null,
        },
        task: taskId || 0,
        task_title: "",
        project: projectId || 0,
        project_name: "",
        trace: null,
        created_at: new Date().toISOString(),
      };

      setEvents((prev) => [...prev, confirmationEvent]);

      if (approved) {
        toast.success(`Action approved: ${conf.title}`);
      } else {
        toast.error(`Action canceled: ${conf.title}`);
      }
    },
    [pendingConfirmation, sessionId, activeAgent, taskId, projectId]
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
