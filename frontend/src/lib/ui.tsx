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
  ceo: "bg-purple-50 text-purple-700 border-purple-200/80",
  tech_lead: "bg-indigo-50 text-indigo-700 border-indigo-200/80",
  backend: "bg-blue-50 text-blue-700 border-blue-200/80",
  frontend: "bg-cyan-50 text-cyan-700 border-cyan-200/80",
  devops: "bg-orange-50 text-orange-700 border-orange-200/80",
  qa: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  designer: "bg-pink-50 text-pink-700 border-pink-200/80",
  seo: "bg-teal-50 text-teal-700 border-teal-200/80",
  admin: "bg-rose-50 text-rose-700 border-rose-200/80",
  member: "bg-slate-50 text-slate-700 border-slate-200/80",
};

export const USER_STATUS_STYLES: Record<UserStatus, { label: string; dot: string; badge: string }> = {
  active: { label: "Active", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200/80" },
  offline: { label: "Offline", dot: "bg-slate-400", badge: "bg-slate-50 text-slate-600 border-slate-200/80" },
  pending: { label: "Pending Approval", dot: "bg-amber-400", badge: "bg-amber-50 text-amber-700 border-amber-200/80" },
  disabled: { label: "Disabled", dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 border-rose-200/80" },
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
  feature: { label: "Feature", icon: "✨", style: "bg-indigo-50/80 text-indigo-700 border border-indigo-200/70" },
  bug: { label: "Bug", icon: "🐛", style: "bg-rose-50/80 text-rose-700 border border-rose-200/70" },
  task: { label: "Task", icon: "📌", style: "bg-slate-100 text-slate-700 border border-slate-200/70" },
};

export const PRIORITY_STYLES: Record<Priority, { label: string; style: string }> = {
  low: { label: "Low", style: "bg-slate-50 text-slate-600 border border-slate-200/70" },
  medium: { label: "Medium", style: "bg-blue-50/80 text-blue-700 border border-blue-200/70" },
  high: { label: "High", style: "bg-amber-50/80 text-amber-700 border border-amber-200/70" },
  urgent: { label: "Critical", style: "bg-rose-50/80 text-rose-700 border border-rose-200/70 font-semibold" },
};

export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-slate-400",
  in_progress: "bg-amber-500",
  in_review: "bg-indigo-500",
  qa: "bg-purple-500",
  done: "bg-emerald-500",
};

const AVATAR_GRADIENTS = [
  "from-indigo-600 to-indigo-800",
  "from-emerald-600 to-teal-700",
  "from-rose-500 to-pink-600",
  "from-amber-500 to-orange-600",
  "from-sky-500 to-blue-700",
  "from-violet-600 to-purple-800",
  "from-teal-500 to-emerald-700",
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
  showStatus = false,
  status = "active",
}: {
  name: string;
  email?: string;
  size?: number;
  showStatus?: boolean;
  status?: UserStatus;
}) {
  const seed = (name || email || "?").charCodeAt(0) || 0;
  const gradient = AVATAR_GRADIENTS[seed % AVATAR_GRADIENTS.length];
  return (
    <div className="relative inline-block shrink-0">
      <span
        className={`inline-flex items-center justify-center rounded-full text-white font-bold bg-gradient-to-br ${gradient} shadow-xs ring-2 ring-white`}
        style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
        title={name || email}
      >
        {initials(name, email)}
      </span>
      {showStatus && (
        <span
          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${USER_STATUS_STYLES[status]?.dot || "bg-emerald-500"}`}
        />
      )}
    </div>
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
      className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold border shadow-2xs ${className}`}
    >
      {children}
    </span>
  );
}
