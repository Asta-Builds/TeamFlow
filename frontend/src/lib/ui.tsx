import React from "react";
import type { Priority, Role, TaskStatus, TaskType, UserStatus } from "./types";
import { Sparkles, Bug, CheckSquare, Shield, Code, Palette, Search, Terminal, Crown, UserCheck, Bot } from "lucide-react";

export const ROLE_LABELS: Record<Role, string> = {
  ceo: "CEO (Human Founder)",
  tech_lead: "AI Tech Lead",
  backend: "AI Backend Engineer",
  frontend: "AI Frontend Engineer",
  devops: "AI DevOps Engineer",
  qa: "AI QA Engineer",
  designer: "AI UI/UX Designer",
  seo: "AI SEO Specialist",
  admin: "Admin",
  member: "AI Member Agent",
};

export const ROLE_COLORS: Record<Role, string> = {
  ceo: "bg-purple-950/60 text-purple-300 border-purple-800/50",
  tech_lead: "bg-indigo-950/60 text-indigo-300 border-indigo-800/50",
  backend: "bg-blue-950/60 text-blue-300 border-blue-800/50",
  frontend: "bg-cyan-950/60 text-cyan-300 border-cyan-800/50",
  devops: "bg-orange-950/60 text-orange-300 border-orange-800/50",
  qa: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50",
  designer: "bg-pink-950/60 text-pink-300 border-pink-800/50",
  seo: "bg-teal-950/60 text-teal-300 border-teal-800/50",
  admin: "bg-rose-950/60 text-rose-300 border-rose-800/50",
  member: "bg-slate-900 text-slate-300 border-slate-800",
};

export const USER_STATUS_STYLES: Record<UserStatus, { label: string; dot: string; badge: string }> = {
  active: { label: "Active", dot: "bg-emerald-500", badge: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50" },
  offline: { label: "Offline", dot: "bg-slate-500", badge: "bg-slate-900 text-slate-400 border-slate-800" },
  pending: { label: "Pending Approval", dot: "bg-amber-400", badge: "bg-amber-950/60 text-amber-300 border-amber-800/50" },
  disabled: { label: "Disabled", dot: "bg-rose-500", badge: "bg-rose-950/60 text-rose-300 border-rose-800/50" },
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
    icon: <Sparkles className="h-3 w-3 inline text-indigo-400" />,
    style: "bg-indigo-950/60 text-indigo-300 border-indigo-800/50",
  },
  bug: {
    label: "Bug",
    icon: <Bug className="h-3 w-3 inline text-rose-400" />,
    style: "bg-rose-950/60 text-rose-300 border-rose-800/50",
  },
  task: {
    label: "Task",
    icon: <CheckSquare className="h-3 w-3 inline text-slate-400" />,
    style: "bg-slate-900 text-slate-300 border-slate-800",
  },
};

export const PRIORITY_STYLES: Record<Priority, { label: string; style: string }> = {
  low: { label: "Low", style: "bg-slate-900 text-slate-400 border-slate-800" },
  medium: { label: "Medium", style: "bg-blue-950/60 text-blue-300 border-blue-800/50" },
  high: { label: "High", style: "bg-amber-950/60 text-amber-300 border-amber-800/50 font-semibold" },
  urgent: { label: "Critical", style: "bg-rose-950/60 text-rose-300 border-rose-800/50 font-bold" },
};

export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-slate-500",
  in_progress: "bg-amber-400",
  in_review: "bg-indigo-400",
  qa: "bg-purple-400",
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
  isAi = true,
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
        className={`inline-flex items-center justify-center rounded-full text-white font-bold bg-gradient-to-br ${gradient} shadow-xs ring-1 ring-slate-800`}
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
        title={name || email}
      >
        {initials(name, email)}
      </span>
      {showStatus && (
        <span
          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950 ${USER_STATUS_STYLES[status]?.dot || "bg-emerald-500"}`}
        />
      )}
    </div>
  );
}

export function AgentTypeBadge({ role, isAi }: { role?: Role; isAi?: boolean }) {
  const isHuman = role === "ceo" || isAi === false;
  if (isHuman) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-300 bg-purple-950/70 border border-purple-800/60 px-2 py-0.5 rounded-md">
        <Crown className="h-3 w-3 inline text-purple-400" />
        <span>Human Founder</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-300 bg-indigo-950/70 border border-indigo-800/60 px-2 py-0.5 rounded-md">
      <Bot className="h-3 w-3 inline text-indigo-400" />
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
