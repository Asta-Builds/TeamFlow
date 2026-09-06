// Thin fetch wrapper around the TeamFlow Django API with JWT handling.

import type { User, Organization } from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api";

const ACCESS_KEY = "teamflow_access";
const REFRESH_KEY = "teamflow_refresh";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function setTokens(access: string, refresh?: string) {
  localStorage.setItem(ACCESS_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(`API error ${status}`);
    this.status = status;
    this.data = data;
  }
}

async function refreshAccess(): Promise<string | null> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return null;
  const res = await fetch(`${API_BASE}/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  setTokens(data.access, data.refresh);
  return data.access as string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  retry?: boolean;
}

export async function apiFetch<T>(
  path: string,
  { method = "GET", body, auth = true, retry = true }: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry) {
    const newToken = await refreshAccess();
    if (newToken) {
      return apiFetch<T>(path, { method, body, auth, retry: false });
    }
    clearTokens();
  }

  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* no body */
    }
    throw new ApiError(res.status, data);
  }

  if (res.status === 204 || res.status === 205) return undefined as T;
  return (await res.json()) as T;
}

// --- Auth-specific helpers ---

export async function login(email: string, password: string) {
  const data = await apiFetch<{ access: string; refresh: string }>(
    "/auth/login/",
    { method: "POST", body: { email, password }, auth: false }
  );
  setTokens(data.access, data.refresh);
  return data;
}

export async function loginWithKeycloakToken(token: string) {
  const data = await apiFetch<{ access: string; refresh: string }>(
    "/auth/keycloak/",
    { method: "POST", body: { token }, auth: false }
  );
  setTokens(data.access, data.refresh);
  return data;
}

export async function loginWithClerkSession(payload: {
  token?: string;
  clerk_id?: string;
  email?: string;
  name?: string;
  avatar_url?: string;
}) {
  const data = await apiFetch<{ access: string; refresh: string; user?: User }>(
    "/auth/clerk/",
    { method: "POST", body: payload, auth: false }
  );
  setTokens(data.access, data.refresh);
  return data;
}

export async function register(payload: {
  email: string;
  name: string;
  password: string;
  organization_name?: string;
}) {
  return apiFetch("/auth/register/", {
    method: "POST",
    body: payload,
    auth: false,
  });
}

// --- Billing Helpers ---

export async function createCheckoutSession(tier: string, successUrl: string, cancelUrl: string) {
  return apiFetch<{ id: string; url: string; mock: boolean }>(
    "/billing/create-checkout-session/",
    {
      method: "POST",
      body: { tier, success_url: successUrl, cancel_url: cancelUrl }
    }
  );
}

export async function createPortalSession(returnUrl: string) {
  return apiFetch<{ url: string; mock: boolean }>(
    "/billing/customer-portal/",
    {
      method: "POST",
      body: { return_url: returnUrl }
    }
  );
}

export async function mockConfirmSubscription(tier: string) {
  return apiFetch<{ status: string; tier: string; subscription_status: string }>(
    "/billing/mock-confirm/",
    {
      method: "POST",
      body: { tier }
    }
  );
}

// --- Multi-Tenant Organization Helpers ---

export async function getCurrentOrganization() {
  return apiFetch<Organization>("/organizations/current/");
}

export async function getOrganizations() {
  return apiFetch<Organization[]>("/organizations/");
}

export async function updateOrganization(data: { name: string }) {
  return apiFetch<Organization>("/organizations/current/", {
    method: "PATCH",
    body: data,
  });
}

export async function createOrganization(data: { name: string; tier?: string }) {
  const res = await apiFetch<{
    organization: Organization;
    access: string;
    refresh: string;
    user: User;
  }>("/organizations/", {
    method: "POST",
    body: data,
  });
  if (res.access) {
    setTokens(res.access, res.refresh);
  }
  return res;
}

export async function switchOrganization(orgId: number) {
  const res = await apiFetch<{
    message: string;
    organization: Organization;
    access: string;
    refresh: string;
    user: User;
  }>(`/organizations/switch/${orgId}/`, {
    method: "POST",
  });
  if (res.access) {
    setTokens(res.access, res.refresh);
  }
  return res;
}

export async function inviteOrganizationMember(data: {
  email: string;
  name?: string;
  role?: string;
}) {
  return apiFetch<User>("/organizations/invite/", {
    method: "POST",
    body: data,
  });
}

// --- Multi-Agent Orchestration & RAG ---

export async function dispatchAgentSwarm(taskId: number) {
  return apiFetch<{
    message: string;
    trace: import("./types").AgentExecutionTrace;
    task_status: import("./types").TaskStatus;
  }>(`/agents/dispatch/${taskId}/`, {
    method: "POST",
  });
}

export async function getAgentTraces(taskId?: number) {
  const path = taskId ? `/agents/traces/${taskId}/` : "/agents/traces/";
  return apiFetch<import("./types").AgentExecutionTrace[]>(path);
}

export async function ingestRAGKnowledge(projectId?: number) {
  return apiFetch<{ message: string; chunks_ingested: number }>("/agents/ingest-rag/", {
    method: "POST",
    body: projectId ? { project_id: projectId } : {},
  });
}

export async function getAgentClusterStatus() {
  return apiFetch<import("./types").AgentClusterStatus>("/agents/status/");
}

export interface SwarmFeedItem {
  id: string;
  type: string;
  sender_name: string;
  sender_role: string;
  target_agent?: string;
  content: string;
  task_id: number;
  task_title: string;
  project_id: number;
  project_name: string;
  created_at: string;
}

export async function getSwarmLiveFeed(projectId?: number, taskId?: number) {
  let query = "";
  if (projectId) query += `?project=${projectId}`;
  if (taskId) query += `${query ? "&" : "?"}task=${taskId}`;
  return apiFetch<{ feed: SwarmFeedItem[]; total_events: number }>(`/agents/swarm-feed/${query}`);
}

export async function executeSwarmChain(taskId: number, instruction?: string) {
  return apiFetch<{
    message: string;
    task_id: number;
    task_status: import("./types").TaskStatus;
    trace: import("./types").AgentExecutionTrace;
  }>(`/agents/swarm-chain/${taskId}/`, {
    method: "POST",
    body: { instruction: instruction || "" },
  });
}

interface AgentEventQuery {
  projectId?: number;
  taskId?: number;
  sessionId?: string;
  after?: number;
}

function agentEventQuery({ projectId, taskId, sessionId, after }: AgentEventQuery) {
  const query = new URLSearchParams();
  if (projectId) query.set("project", String(projectId));
  if (taskId) query.set("task", String(taskId));
  if (sessionId) query.set("session", sessionId);
  if (after) query.set("after", String(after));
  return query.toString();
}

export async function getAgentEvents(options: AgentEventQuery = {}) {
  const query = agentEventQuery(options);
  return apiFetch<{
    events: import("./types").AgentEvent[];
    last_event_id: number;
  }>(`/agents/events/${query ? `?${query}` : ""}`);
}

export async function streamAgentEvents(
  options: AgentEventQuery,
  onEvent: (event: import("./types").AgentEvent) => void,
  signal: AbortSignal,
  retry = true,
) {
  const query = agentEventQuery(options);
  const token = getToken();
  const response = await fetch(`${API_BASE}/agents/events/stream/${query ? `?${query}` : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });

  if (response.status === 401 && retry) {
    const refreshed = await refreshAccess();
    if (refreshed) return streamAgentEvents(options, onEvent, signal, false);
  }
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, { detail: "Agent event stream unavailable." });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine) onEvent(JSON.parse(dataLine.slice(6)) as import("./types").AgentEvent);
    }
  }
}

// --- Pulse execution workspace ---

export function getPulseDashboard(date: string) {
  return apiFetch<import("./types").PulseDashboard>(
    `/pulse/dashboard/?date=${encodeURIComponent(date)}`
  );
}

export function savePulseNote(date: string, body: string) {
  return apiFetch<import("./types").PulseNote>(
    `/pulse/note/?date=${encodeURIComponent(date)}`,
    { method: "PUT", body: { body } }
  );
}

export function createPulsePlanItem(payload: {
  task: number;
  date: string;
  time_block: import("./types").PulseTimeBlock;
  position: number;
}) {
  return apiFetch<import("./types").PulsePlanItem>("/pulse/plan-items/", {
    method: "POST",
    body: payload,
  });
}

export function deletePulsePlanItem(id: number) {
  return apiFetch<void>(`/pulse/plan-items/${id}/`, { method: "DELETE" });
}

export function startPulseFocus(planItem?: number) {
  return apiFetch<import("./types").PulseFocusSession>("/pulse/focus-sessions/start/", {
    method: "POST",
    body: planItem ? { plan_item: planItem } : {},
  });
}

export function updatePulseFocus(
  id: number,
  action: "pause" | "resume" | "complete"
) {
  return apiFetch<import("./types").PulseFocusSession>(
    `/pulse/focus-sessions/${id}/${action}/`,
    { method: "POST" }
  );
}

// --- Data Normalization & Resilient Helpers ---

export function normalizeList<T>(data: unknown): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as T[];
  if (typeof data === "object" && data !== null && "results" in data && Array.isArray((data as { results: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}

export function createSeoTask(auditId: number, payload: { project_id: number; issue_index: number }) {
  return apiFetch<{ success: boolean; task_id: number; title: string }>(
    `/seo/audits/${auditId}/create-task/`,
    { method: "POST", body: payload }
  );
}

export function rollbackDeployment(deploymentId: number) {
  return apiFetch<import("./types").Deployment>(
    `/deployments/${deploymentId}/rollback/`,
    { method: "POST", body: {} }
  );
}

export function qaValidateTask(taskId: number) {
  return apiFetch<import("./types").Task>(
    `/tasks/${taskId}/qa_validate/`,
    { method: "POST" }
  );
}



