// Thin fetch wrapper around the TeamFlow Django API with JWT handling.

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

