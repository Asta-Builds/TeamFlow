import type { Priority, Role, TaskStatus } from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  member: "Member",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

export const TASK_COLUMNS: TaskStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
];

export const PRIORITY_STYLES: Record<Priority, string> = {
  low: "bg-gray-100 text-gray-600 border border-gray-200",
  medium: "bg-blue-50 text-blue-700 border border-blue-200/60",
  high: "bg-amber-50 text-amber-700 border border-amber-200/60",
  urgent: "bg-red-50 text-red-700 border border-red-200/60",
};

export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-gray-400",
  in_progress: "bg-amber-400",
  in_review: "bg-indigo-400",
  done: "bg-green-500",
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}
