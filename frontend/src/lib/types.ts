export type Role =
  | "ceo"
  | "tech_lead"
  | "backend"
  | "frontend"
  | "devops"
  | "qa"
  | "designer"
  | "seo"
  | "admin"
  | "member";

export type UserStatus = "active" | "offline" | "pending" | "disabled";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  user_status?: UserStatus;
  avatar_url: string;
  bio?: string;
  is_active: boolean;
  date_joined: string;
  organization?: number;
  organization_name?: string;
  organization_tier?: string;
  organization_status?: string;
  open_tasks_count?: number;
  closed_tasks_count?: number;
}

export type ProjectStatus = "active" | "on_hold" | "completed" | "archived";

export interface Project {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  owner: number | null;
  owner_detail: User | null;
  members: number[];
  members_detail?: User[];
  task_count: number;
  done_task_count?: number;
  progress_percentage?: number;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "todo" | "in_progress" | "in_review" | "qa" | "done";
export type TaskType = "feature" | "bug" | "task";
export type Priority = "low" | "medium" | "high" | "urgent";

export interface Comment {
  id: number;
  task: number;
  author: number | null;
  author_detail: User | null;
  body: string;
  created_at: string;
}

export interface TaskActivity {
  id: number;
  task: number;
  actor: number | null;
  actor_detail: User | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Task {
  id: number;
  project: number;
  project_name?: string;
  title: string;
  description: string;
  status: TaskStatus;
  task_type: TaskType;
  priority: Priority;
  assignee: number | null;
  assignee_detail: User | null;
  created_by: number | null;
  created_by_detail?: User | null;
  due_date?: string | null;
  pr_url?: string;
  qa_rejected?: boolean;
  qa_rejection_reason?: string;
  order: number;
  comments: Comment[];
  activities?: TaskActivity[];
  created_at: string;
  updated_at: string;
}

export type DeploymentStatus =
  | "queued"
  | "in_progress"
  | "success"
  | "failed"
  | "rolled_back"
  | "cancelled";

export interface Deployment {
  id: number;
  project: number;
  project_name?: string;
  environment: string;
  status: DeploymentStatus;
  commit_sha: string;
  branch?: string;
  logs?: string;
  duration_seconds?: number;
  triggered_by: number | null;
  triggered_by_detail: User | null;
  started_at: string;
  finished_at: string | null;
}

export interface SEOIssue {
  severity: "critical" | "high" | "medium" | "low";
  category?: string;
  message: string;
  recommendation?: string;
}

export interface SEOMetrics {
  fcp_ms?: number;
  lcp_ms?: number;
  cls?: number;
  fid_ms?: number;
  ttfb_ms?: number;
  canonical_detected?: boolean;
  robots_txt_present?: boolean;
  sitemap_present?: boolean;
}

export interface SEOAudit {
  id: number;
  url: string;
  score: number;
  performance_score?: number;
  seo_score?: number;
  mobile_score?: number;
  load_time_ms?: number;
  issues: SEOIssue[];
  metrics?: SEOMetrics;
  created_at: string;
}

export interface Notification {
  id: number;
  recipient: number;
  actor: number | null;
  actor_detail: User | null;
  title: string;
  message: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

export interface ActivityFeedItem {
  id: number;
  task_id: number;
  task_title: string;
  project_id: number;
  project_name: string;
  actor_name: string;
  actor_role: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AgentStep {
  node: string;
  agent_role: string;
  action: string;
  message: string;
  pr_url?: string;
  qa_result?: "passed" | "failed";
  rejection_reason?: string;
  deployment_status?: string;
  timestamp: string;
  tokens?: number;
  cost_usd?: number;
}

export interface AgentExecutionTrace {
  id: number;
  task: number;
  task_title?: string;
  project_id?: number;
  project_name?: string;
  session_id: string;
  status: "running" | "completed" | "failed";
  graph_state: {
    retrieved_context?: string[];
    subtasks?: Array<{ role: string; task: string }>;
    code_changes?: Record<string, string>;
    pr_url?: string;
    qa_result?: string;
    total_tokens?: number;
    total_cost_usd?: number;
  };
  steps: AgentStep[];
  tokens_used: number;
  cost_usd: string | number;
  duration_seconds: number;
  langfuse_url: string;
  created_at: string;
  finished_at?: string | null;
}

export interface AgentClusterStatus {
  orchestration_framework: string;
  vector_store: string;
  observability: string;
  memory_queue: string;
  total_agent_seats: number;
  active_agents: Array<{
    role: string;
    name: string;
    title: string;
    status: string;
  }>;
  rag_embeddings_count: number;
  total_swarms_executed: number;
  successful_swarms: number;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
