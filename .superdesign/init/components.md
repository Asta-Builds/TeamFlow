# Components — Shared UI Primitives

**Framework:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4
**CSS approach:** Tailwind v4 (`@import "tailwindcss"` + `@theme inline` in `globals.css`; no `tailwind.config.*` file).
**Component library:** none (no shadcn/MUI/Radix) — hand-rolled primitives in `src/lib/ui.tsx`.

The project has NO `components/ui/` directory. All shared UI primitives + design constants live in `src/lib/ui.tsx`.

---

## Design constants (`src/lib/ui.tsx`)

Role labels, claim-status labels, priority styles, status dots, avatar palette. These are the source of truth for badge/label styling across every page.

```tsx
import type { Priority, Role, TaskStatus } from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  hr_admin: "HR Admin",
  employee: "Employee",
  partner: "Benefits Partner",
};

// NOTE: the app reuses the generic Task pipeline for benefit CLAIMS.
// Status labels are relabelled to the claims/reimbursement domain:
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "Pending",
  in_progress: "In Review",
  in_review: "Approved",
  done: "Paid",
};

export const TASK_COLUMNS: TaskStatus[] = ["todo", "in_progress", "in_review", "done"];

export const PRIORITY_STYLES: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-600 border border-slate-200",
  medium: "bg-blue-50 text-blue-700 border border-blue-200/60",
  high: "bg-amber-50 text-amber-700 border border-amber-200/60",
  urgent: "bg-red-50 text-red-700 border border-red-200/60",
};

export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-slate-400",
  in_progress: "bg-amber-400",
  in_review: "bg-teal-400",
  done: "bg-emerald-500",
};

const AVATAR_COLORS = [
  "bg-teal-600", "bg-emerald-600", "bg-rose-500", "bg-amber-500",
  "bg-sky-500", "bg-violet-500", "bg-indigo-600",
];
```

---

## Avatar

- File: `src/lib/ui.tsx`
- Round initials avatar; deterministic color from `AVATAR_COLORS` seeded by first char of name/email.
- Props: `name: string`, `email?: string`, `size?: number` (default 32).

```tsx
export function initials(name: string, email = ""): string {
  const source = name?.trim() || email;
  if (!source) return "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ name, email, size = 32 }: { name: string; email?: string; size?: number; }) {
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
```

## Badge

- File: `src/lib/ui.tsx`
- Pill; caller supplies color via `className` (see `PRIORITY_STYLES`, and inline `bg-teal-50 text-teal-700 border border-teal-200/50` usages).
- Props: `children: React.ReactNode`, `className?: string`.

```tsx
export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string; }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}
```

## Inline primitives (not extracted — reproduce as inline HTML)

These recur on nearly every page but are written inline (Tailwind utility strings), not as components:

- **Card**: `rounded-xl border border-slate-200 bg-white p-5 shadow-sm`
- **Primary button**: `rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 shadow-sm transition`
- **Secondary button**: `border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50`
- **Input**: `rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100`
- **StatCard** (dashboard, local component): `rounded-xl border border-slate-200 bg-white p-5 shadow-sm` → big `text-2xl font-bold text-slate-800` value + `text-sm font-semibold text-slate-500` label + `text-xs text-slate-400` description
- **Table**: `w-full text-left text-sm` inside `overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm`; head `bg-slate-50/75 text-xs uppercase font-bold text-slate-400`; rows `divide-y divide-slate-100`
