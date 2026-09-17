import React from "react";
import type { HumanRole, Priority, Role, TaskStatus, TaskType, UserStatus } from "./types";
import { Sparkles, Bug, CheckSquare, Crown, Bot, UserRound } from "lucide-react";

export const ROLE_LABELS: Record<Role, string> = {
  ceo: "CEO",
  admin: "Admin",
  member: "Member",
  pm: "Product Manager",
  tech_lead: "Tech Lead",
  backend: "Backend Engineer",
  frontend: "Frontend Engineer",
  devops: "DevOps Engineer",
  qa: "QA Engineer",
  designer: "UI/UX Designer",
  seo: "SEO Specialist",
};

/** Roles a person can be given. Specialist roles belong to AI agent seats. */
export const HUMAN_ROLE_OPTIONS: { value: HumanRole; label: string; description: string }[] = [
  { value: "member", label: "Member", description: "Works on the projects they are added to" },
  { value: "admin", label: "Admin", description: "Manages projects, people and workspace settings" },
  { value: "ceo", label: "CEO", description: "Owns the workspace, including billing and admins" },
];

/** Label for a role, marking AI agent seats as such. */
export function roleLabel(role: Role | null | undefined, isAi = false): string {
  const label = (role && ROLE_LABELS[role]) || role || ROLE_LABELS.member;
  return isAi ? `AI ${label}` : label;
}

export const ROLE_COLORS: Record<Role, string> = {
  ceo: "bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/50",
  pm: "bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800/50",
  tech_lead: "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/50",
  backend: "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/50",
  frontend: "bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800/50",
  devops: "bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800/50",
  qa: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50",
  designer: "bg-pink-50 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800/50",
  seo: "bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/50",
  admin: "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50",
  member: "bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800",
};

export const USER_STATUS_STYLES: Record<UserStatus, { label: string; dot: string; badge: string }> = {
  active: { label: "Active", dot: "bg-emerald-500", badge: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50" },
  offline: { label: "Offline", dot: "bg-slate-500", badge: "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800" },
  pending: { label: "Pending Approval", dot: "bg-amber-400", badge: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50" },
  disabled: { label: "Disabled", dot: "bg-rose-500", badge: "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50" },
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

export const TASK_TYPE_STYLES: Record<TaskType, { label: string; icon: React.ReactNode; style: string }> = {
  feature: {
    label: "Feature",
    icon: <Sparkles className="h-3 w-3 inline text-indigo-500 dark:text-indigo-400" />,
    style: "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/50",
  },
  bug: {
    label: "Bug",
    icon: <Bug className="h-3 w-3 inline text-rose-500 dark:text-rose-400" />,
    style: "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50",
  },
  task: {
    label: "Task",
    icon: <CheckSquare className="h-3 w-3 inline text-slate-500 dark:text-slate-400" />,
    style: "bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800",
  },
};

export const PRIORITY_STYLES: Record<Priority, { label: string; style: string }> = {
  low: { label: "Low", style: "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800" },
  medium: { label: "Medium", style: "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/50" },
  high: { label: "High", style: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50 font-semibold" },
  urgent: { label: "Critical", style: "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50 font-bold" },
};

export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-slate-500",
  in_progress: "bg-amber-400 animate-pulse motion-reduce:animate-none",
  in_review: "bg-indigo-400 animate-pulse motion-reduce:animate-none",
  qa: "bg-purple-400 animate-pulse motion-reduce:animate-none",
  done: "bg-emerald-400",
};

const AVATAR_GRADIENTS = [
  "from-indigo-600 to-indigo-800",
  "from-emerald-600 to-teal-700",
  "from-rose-600 to-pink-700",
  "from-amber-600 to-orange-700",
  "from-sky-600 to-blue-800",
  "from-violet-600 to-purple-800",
  "from-teal-600 to-emerald-800",
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
  isAi?: boolean;
}) {
  const seed = (name || email || "?").charCodeAt(0) || 0;
  const gradient = AVATAR_GRADIENTS[seed % AVATAR_GRADIENTS.length];
  return (
    <div className="relative inline-block shrink-0">
      <span
        className={`inline-flex items-center justify-center rounded-full text-white font-bold bg-gradient-to-br ${gradient} shadow-xs ring-1 ring-slate-200 dark:ring-slate-800`}
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
        title={name || email}
      >
        {initials(name, email)}
      </span>
      {showStatus && (
        <span
          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-950 ${USER_STATUS_STYLES[status]?.dot || "bg-emerald-500"}`}
        />
      )}
    </div>
  );
}

/** Tells people and AI agent seats apart. Only accounts flagged as agents are AI. */
export function AgentTypeBadge({ role, isAi = false }: { role?: Role; isAi?: boolean }) {
  if (!isAi && role === "ceo") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800/60 px-2 py-0.5 rounded-md">
        <Crown className="h-3 w-3 inline text-purple-600 dark:text-purple-400" />
        <span>Human · CEO</span>
      </span>
    );
  }
  if (!isAi) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 rounded-md">
        <UserRound className="h-3 w-3 inline text-emerald-600 dark:text-emerald-400" />
        <span>Human</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800/60 px-2 py-0.5 rounded-md">
      <Bot className="h-3 w-3 inline text-indigo-600 dark:text-indigo-400" />
      <span>AI Agent</span>
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
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold border shadow-2xs ${className}`}
    >
      {children}
    </span>
  );
}
