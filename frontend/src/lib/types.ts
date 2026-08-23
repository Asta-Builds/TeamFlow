export type Role = "admin" | "member";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  avatar_url: string;
  is_active: boolean;
  date_joined: string;
  organization?: number;
  organization_name?: string;
  organization_tier?: string;
  organization_status?: string;
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
  task_count: number;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";

export interface Comment {
  id: number;
  task: number;
  author: number | null;
  author_detail: User | null;
  body: string;
  created_at: string;
}

export interface Task {
  id: number;
  project: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignee: number | null;
  assignee_detail: User | null;
  created_by: number | null;
  created_by_detail?: User | null;
  order: number;
  comments: Comment[];
  created_at: string;
  updated_at: string;
}

export type DeploymentStatus =
  | "queued"
  | "in_progress"
  | "success"
  | "failed"
  | "rolled_back";

export interface Deployment {
  id: number;
  project: number;
  project_name?: string;
  environment: string;
  status: DeploymentStatus;
  commit_sha: string;
  triggered_by: number | null;
  triggered_by_detail: User | null;
  started_at: string;
  finished_at: string | null;
}

export interface SEOAudit {
  id: number;
  url: string;
  score: number;
  issues: { severity: string; message: string }[];
  created_at: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
