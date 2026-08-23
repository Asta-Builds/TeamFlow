import React from "react";
import type { Priority, Role, TaskStatus, TaskType, UserStatus } from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  ceo: "CEO",
  tech_lead: "Tech Lead",
  backend: "Senior Backend Engineer",
  frontend: "Senior Frontend Engineer",
  devops: "DevOps Engineer",
  qa: "QA Engineer",
  designer: "UI/UX Designer",
  seo: "SEO Specialist",
  admin: "Admin",
  member: "Member",
};

export const ROLE_COLORS: Record<Role, string> = {
  ceo: "bg-purple-100 text-purple-800 border-purple-200",
  tech_lead: "bg-indigo-100 text-indigo-800 border-indigo-200",
  backend: "bg-blue-100 text-blue-800 border-blue-200",
  frontend: "bg-cyan-100 text-cyan-800 border-cyan-200",
  devops: "bg-orange-100 text-orange-800 border-orange-200",
  qa: "bg-emerald-100 text-emerald-800 border-emerald-200",
  designer: "bg-pink-100 text-pink-800 border-pink-200",
  seo: "bg-teal-100 text-teal-800 border-teal-200",
  admin: "bg-rose-100 text-rose-800 border-rose-200",
  member: "bg-slate-100 text-slate-800 border-slate-200",
};

export const USER_STATUS_STYLES: Record<UserStatus, { label: string; dot: string; badge: string }> = {
  active: { label: "Active", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  offline: { label: "Offline", dot: "bg-slate-400", badge: "bg-slate-50 text-slate-600 border-slate-200" },
  pending: { label: "Pending Approval", dot: "bg-amber-400", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  disabled: { label: "Disabled", dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 border-rose-200" },
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  qa: "QA / Ready for Test",
  done: "Done",
};

export const TASK_COLUMNS: TaskStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "qa",
  "done",
];

export const TASK_TYPE_STYLES: Record<TaskType, { label: string; icon: string; style: string }> = {
  feature: { label: "Feature", icon: "✨", style: "bg-indigo-50 text-indigo-700 border border-indigo-200" },
  bug: { label: "Bug", icon: "🐛", style: "bg-rose-50 text-rose-700 border border-rose-200" },
  task: { label: "Task", icon: "📌", style: "bg-slate-100 text-slate-700 border border-slate-200" },
};

export const PRIORITY_STYLES: Record<Priority, { label: string; style: string }> = {
  low: { label: "Low", style: "bg-slate-100 text-slate-600 border border-slate-200" },
  medium: { label: "Medium", style: "bg-blue-50 text-blue-700 border border-blue-200/60" },
  high: { label: "High", style: "bg-amber-50 text-amber-700 border border-amber-200/60" },
  urgent: { label: "Critical", style: "bg-rose-50 text-rose-700 border border-rose-200/60" },
};

export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-slate-400",
  in_progress: "bg-amber-400",
  in_review: "bg-indigo-400",
  qa: "bg-purple-500",
  done: "bg-emerald-500",
};

const AVATAR_COLORS = [
  "bg-indigo-600",
  "bg-emerald-600",
  "bg-rose-500",
  "bg-amber-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-teal-600",
];

export function initials(name: string, email = ""): string {
  const source = name?.trim() || email;
  if (!source) return "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({
  name,
  email,
  size = 32,
}: {
  name: string;
  email?: string;
  size?: number;
}) {
  const seed = (name || email || "?").charCodeAt(0) || 0;
  const color = AVATAR_COLORS[seed % AVATAR_COLORS.length];
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-white font-medium ${color}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      title={name || email}
    >
      {initials(name, email)}
    </span>
  );
}

export function Badge({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${className}`}
    >
      {children}
    </span>
  );
}
