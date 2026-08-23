# Pages — Component Dependency Trees

Single source of truth for `--context-file` sets. Every file listed for a page MUST be passed when designing that page, plus always: `src/app/globals.css`, `.superdesign/design-system.md`. There is no `tailwind.config` (Tailwind v4 config lives in `globals.css`). Pages are self-contained (all UI inline) — the only shared deps are the shell layout + `ui.tsx`.

Shared by ALL authenticated pages:
```
src/app/(app)/layout.tsx        (sidebar + top bar shell)
src/lib/ui.tsx                  (Avatar, Badge, ROLE_LABELS, TASK_STATUS_LABELS, PRIORITY_STYLES, STATUS_DOT)
src/lib/types.ts               (Role, User, Project, Task, Deployment, ... types)
src/app/globals.css
```

## /login
Entry: `src/app/login/page.tsx`  (self-contained; no AppLayout)
Deps:
- src/lib/auth.tsx  (useAuth)
- src/lib/api.ts    (register)  ← logic only, strip
- src/app/globals.css

## /dashboard
Entry: `src/app/(app)/dashboard/page.tsx`  (role-split HR Admin vs Employee; local `StatCard`)
Deps:
- src/app/(app)/layout.tsx
- src/lib/ui.tsx        (Avatar, Badge, PRIORITY_STYLES, TASK_STATUS_LABELS)
- src/lib/auth.tsx, src/lib/api.ts, src/lib/types.ts  (logic — strip data fetching)
- src/app/globals.css

## /projects  (Benefits & Perks)
Entry: `src/app/(app)/projects/page.tsx`
Deps:
- src/app/(app)/layout.tsx
- src/lib/ui.tsx        (Badge)
- src/lib/auth.tsx, src/lib/api.ts, src/lib/types.ts
- src/app/globals.css

## /projects/[id]  (Claims Kanban board + claim detail panel)
Entry: `src/app/(app)/projects/[id]/page.tsx`  (contains `ProjectBoardPage` + `TaskPanel` side panel — BOTH render on this route)
Deps:
- src/app/(app)/layout.tsx
- src/lib/ui.tsx        (Avatar, Badge, PRIORITY_STYLES, STATUS_DOT, TASK_COLUMNS, TASK_STATUS_LABELS)
- src/lib/api.ts, src/lib/types.ts
- src/app/globals.css

## /team  (Employee Directory)
Entry: `src/app/(app)/team/page.tsx`
Deps:
- src/app/(app)/layout.tsx
- src/lib/ui.tsx        (Avatar, Badge, ROLE_LABELS)
- src/lib/auth.tsx, src/lib/api.ts, src/lib/types.ts
- src/app/globals.css

## /deployments  (Payroll Sync)
Entry: `src/app/(app)/deployments/page.tsx`
Deps:
- src/app/(app)/layout.tsx
- src/lib/ui.tsx        (Avatar, Badge)
- src/lib/auth.tsx, src/lib/api.ts, src/lib/types.ts
- src/app/globals.css

## /billing  (Billing & Subscriptions)
Entry: `src/app/(app)/billing/page.tsx`  (self-contained; 3 pricing cards; no ui.tsx primitives)
Deps:
- src/app/(app)/layout.tsx
- src/lib/auth.tsx, src/lib/api.ts  (createCheckoutSession/createPortalSession/mockConfirmSubscription — strip)
- src/app/globals.css

## /compliance  (HR Compliance Audits)
Entry: `src/app/(app)/compliance/page.tsx`  (self-contained; local `AuditRecord` type; uses next/link)
Deps:
- src/app/(app)/layout.tsx
- src/lib/auth.tsx, src/lib/api.ts, src/lib/types.ts  (Paginated)
- src/app/globals.css
