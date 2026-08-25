# TeamFlow — Frontend Upgrade & Modernization Plan

**Date:** 2026
**Scope:** `frontend/` (Next.js 16 App Router, TypeScript, Tailwind)
**Status:** Reference document for phased upgrades

---

## 📊 Current State Assessment

### Codebase Inventory

| Area | Path | Lines | Notes |
|---|---|---|---|
| API Client | `src/lib/api.ts` | 220 | JWT wrapper, manual refresh-on-401, billing + agent helpers |
| Auth Context | `src/lib/auth.tsx` | 72 | Context-based, no token expiry handling |
| UI Primitives | `src/lib/ui.tsx` | 174 | Avatar, Badge, role/status/priority styles, no variants API |
| Dashboard | `src/app/(app)/dashboard/page.tsx` | 414 | SuperStat grid, role banners, KPI cards |
| Projects list | `src/app/(app)/projects/page.tsx` | — | Grid/table, search, filters |
| Project detail | `src/app/(app)/projects/[id]/page.tsx` | — | Kanban board, ticket drawer |
| Team | `src/app/(app)/team/page.tsx` | — | Member grid, roles |
| Deployments | `src/app/(app)/deployments/page.tsx` | — | Status timeline, rollback |
| Billing | `src/app/(app)/billing/page.tsx` | — | Stripe checkout/portal |
| Compliance | `src/app/(app)/compliance/page.tsx` | — | Audit trail |
| Settings | `src/app/(app)/settings/page.tsx` | — | Profile, notifications |
| Profile | `src/app/(app)/profile/page.tsx` | — | Personal dashboard |
| Auth pages | `src/app/login/page.tsx`, `src/app/auth/callback/page.tsx` | — | Email + Keycloak |
| Root | `src/app/page.tsx`, `src/app/layout.tsx` | — | Entry + globals |
| Styles | `src/app/globals.css` | — | Tailwind v4 |

### Strengths
- ✅ Clean separation of `lib/` (api, auth, types, ui) from app routes
- ✅ Consistent dark theme with semantic role/status/priority color maps
- ✅ Reusable `Avatar`, `Badge`, `AgentTypeBadge` primitives
- ✅ Centralized JWT refresh logic in `apiFetch`
- ✅ Type-safe `apiFetch<T>` with `ApiError` subclass
- ✅ Role-aware dashboard banners (CEO / Tech Lead / QA / DevOps)
- ✅ App Router group `(app)` for auth-gated routes
- ✅ TypeScript strict typing throughout

### Pain Points & Gaps
- ❌ No global error boundary / toast system
- ❌ No loading skeleton or Suspense fallbacks
- ❌ No optimistic updates for task transitions
- ❌ No data caching layer (no React Query / SWR / RSC fetch)
- ❌ No SSR data fetching — all client-side `useEffect`
- ❌ No accessibility audit (aria-live for activity feed, focus management, keyboard nav)
- ❌ No i18n / locale formatting for dates & numbers
- ❌ No test coverage (no unit, integration, e2e, or visual tests)
- ❌ No Storybook for UI primitives
- ❌ Manual token storage in `localStorage` (XSS risk)
- ❌ No request cancellation on unmount
- ❌ Duplicate `DashboardPage` data fetching logic — could be a custom hook
- ❌ No virtualization for long lists (activity feed, task lists)
- ❌ No design tokens (colors, spacing, radii hardcoded in components)
- ❌ No feature flags / config system
- ❌ `refreshAccess()` mutates localStorage from inside `apiFetch` (side effect in fetch layer)

---

## 🎯 Upgrade Goals

1. **Reliability** — resilient to network failures, auth expirations, and race conditions
2. **Performance** — faster first paint, smaller bundles, snappier interactions
3. **Developer Experience** — typed contracts, reusable hooks, component library
4. **Accessibility** — WCAG 2.1 AA compliance, keyboard-driven flows
5. **Testability** — confident refactors through automated tests
6. **Security** — defense in depth around auth, secrets, and user data
7. **Observability** — production-grade error tracking and tracing

---

## 🗓️ Phased Roadmap

### Phase 1 — Foundation (Weeks 1–2)

#### 1.1 Introduce TanStack Query for data layer
Replace ad-hoc `useEffect` + `useState` with a typed query layer.

- [ ] Install `@tanstack/react-query`
- [ ] Wrap `<QueryClientProvider>` in `(app)/layout.tsx`
- [ ] Create `src/lib/queries/` directory with typed query keys + hooks:
  - `useProjects()`, `useProject(id)`, `useTasks(filters)`, `useTask(id)`
  - `useDeployments()`, `useSeoAudits()`, `useTeam()`
  - `useAgentClusterStatus()`, `useSwarmLiveFeed()`
  - `useMyTasks()`, `useActivityFeed()`
- [ ] Move `refreshUser()` to `useMe()` query with 5-min stale time
- [ ] Configure default `staleTime`, `gcTime`, retry behavior

**Impact:** Removes ~200 lines of `useEffect` boilerplate, adds caching, deduplication, automatic refetch on focus.

#### 1.2 Toast / Notification system
- [ ] Install `sonner` (lightweight, themeable)
- [ ] Add `<Toaster />` to root layout
- [ ] Wrap `ApiError` to auto-toast on mutation failures
- [ ] Replace any silent `console.error` paths with user-visible toasts

#### 1.3 Loading skeletons
- [ ] Create `src/components/skeletons/` matching each card/row
- [ ] Use them as Suspense fallbacks in route segments
- [ ] Add `loading.tsx` to each route for instant perceived performance

#### 1.4 Extract hooks
- [ ] `useDebounce(value, ms)`
- [ ] `useMediaQuery(query)` for responsive layout
- [ ] `useLocalStorage(key, initial)` with SSR safety
- [ ] `useMounted()` to defer client-only rendering

---

### Phase 2 — Performance (Weeks 3–4)

#### 2.1 Server Components for static data
- [ ] Convert `(app)/team/page.tsx` and `(app)/deployments/page.tsx` to RSC where possible
- [ ] Move auth/me lookup to a server-side helper
- [ ] Use `cache: 'no-store'` only for live data; `next: { revalidate: 60 }` for cluster status

#### 2.2 Route-level code splitting audit
- [ ] Confirm dynamic imports for heavy client widgets (Monaco, charts)
- [ ] Verify no barrel imports (`import { ... } from 'lucide-react'` → tree-shake test)
- [ ] Run `@next/bundle-analyzer` and ship a bundle-size budget CI check

#### 2.3 Virtualization
- [ ] `react-virtuoso` for activity feed (`/tasks/feed/`)
- [ ] `react-window` for task table when list > 100 rows

#### 2.4 Image & font optimization
- [ ] `next/image` for avatars (currently rendered as text gradients — add user-uploaded avatars with proper `sizes`)
- [ ] Self-host Inter via `next/font` (remove runtime fetch)

#### 2.5 Memoization audit
- [ ] Wrap `SuperStatCard` in `React.memo`
- [ ] Stabilize `TASK_STATUS_LABELS`, `ROLE_COLORS` outside component scope (already done — verify)
- [ ] `useMemo` derived lists in `DashboardPage` (`openTickets`, `myTickets`, etc.)

---

### Phase 3 — Accessibility (Weeks 5–6)

#### 3.1 Keyboard & screen reader
- [ ] Add `aria-live="polite"` region for activity feed updates
- [ ] Ensure all icon-only buttons have `aria-label`
- [ ] Visible focus rings (Tailwind `focus-visible:ring-2`)
- [ ] Skip-to-content link in root layout
- [ ] Semantic landmarks: `<main>`, `<nav>`, `<aside>`, `<header>` (verify route groups)

#### 3.2 Color contrast audit
- [ ] Run `axe-core` in CI
- [ ] Fix any failing pairs (especially `slate-500/600` on `slate-900` backgrounds)
- [ ] Document approved Tailwind class pairs in `STYLE_GUIDE.md`

#### 3.3 Form accessibility
- [ ] Associate `<label>` with all inputs (login, settings, billing)
- [ ] `aria-invalid` + `aria-describedby` for error states
- [ ] Announce form submission results via toast + inline messaging

#### 3.4 Motion preferences
- [ ] Respect `prefers-reduced-motion` (disable `animate-pulse` on status dots)
- [ ] Allow disabling background animations

---

### Phase 4 — Testing (Weeks 7–9)

#### 4.1 Unit tests (Vitest)
- [ ] `lib/api.ts` — token refresh flow, error mapping
- [ ] `lib/auth.tsx` — context provider state machine
- [ ] `lib/ui.tsx` — `Avatar` initials logic, role/status mapping

#### 4.2 Component tests (Testing Library)
- [ ] `DashboardPage` — renders role-specific banners
- [ ] `Badge`, `Avatar` — visual regression baselines
- [ ] Kanban column drop interactions (DnD)

#### 4.3 Integration tests (Playwright)
- [ ] Login → dashboard navigation
- [ ] Create project → create task → assign → move columns
- [ ] Trigger agent dispatch → assert task transitions to DONE
- [ ] Billing checkout flow (mock)

#### 4.4 Visual regression (Chromatic or Playwright snapshots)
- [ ] Storybook stories for every primitive
- [ ] Snapshots for dashboard, project detail, team, deployments

#### 4.5 CI gates
- [ ] Lint (`eslint`)
- [ ] Type-check (`tsc --noEmit`)
- [ ] Unit + component tests
- [ ] Bundle size budget
- [ ] Lighthouse CI with min score 90

---

### Phase 5 — Security Hardening (Weeks 10–11)

#### 5.1 Token storage
- [ ] Evaluate httpOnly secure cookies via Django + CSRF token pair
- [ ] If cookies: short-lived access (15 min) + long-lived refresh (7 d) with rotation
- [ ] If localStorage persists: add CSP `default-src 'self'` + nonce-based script tags
- [ ] Add `SameSite=Strict` to any cookie-based auth

#### 5.2 Content Security Policy
- [ ] Add CSP via `next.config.js` headers
- [ ] Lock down `connect-src` to API domain
- [ ] `frame-ancestors 'none'`

#### 5.3 Input sanitization
- [ ] Sanitize any `dangerouslySetInnerHTML` paths
- [ ] URL validation on user-provided `next` param
- [ ] Rate-limit login via backend (already exists — verify frontend UX)

#### 5.4 Dependency hygiene
- [ ] `npm audit` in CI
- [ ] Renovate bot for automated PRs
- [ ] Pin Next.js major version (currently 16 — track breaking changes per `AGENTS.md`)

---

### Phase 6 — Developer Experience (Weeks 12–13)

#### 6.1 Design tokens
- [ ] Convert hardcoded color/spacing/radius values to `tailwind.config.ts` theme extensions
- [ ] Create `STYLE_GUIDE.md` with usage examples

#### 6.2 Component library
- [ ] Promote `Badge`, `Avatar`, `SuperStatCard` to `src/components/ui/`
- [ ] Add: `Button`, `Card`, `Dialog`, `DropdownMenu`, `Select`, `Tabs`, `Toast`, `Tooltip`
- [ ] Use `class-variance-authority` (cva) for variant APIs
- [ ] Document in Storybook

#### 6.3 Type-safety
- [ ] Generate types from OpenAPI schema (`openapi-typescript` against `http://localhost:8000/api/schema/`)
- [ ] Replace manual `import("./types")` with generated `ApiSchemas` namespace
- [ ] Strict `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`

#### 6.4 Tooling
- [ ] Add `prettier` with `prettier-plugin-tailwindcss`
- [ ] `husky` + `lint-staged` pre-commit
- [ ] `commitlint` with conventional commits
- [ ] VS Code workspace settings committed

#### 6.5 Observability
- [ ] Sentry (or equivalent) for error tracking
- [ ] Web Vitals reporting to backend analytics endpoint
- [ ] Custom events: `agent_dispatch_started`, `task_status_changed`, `billing_checkout_started`

---

### Phase 7 — Feature Enhancements (Weeks 14+)

#### 7.1 Real-time updates
- [ ] WebSocket / SSE channel for live activity feed (replace 30s polling if present)
- [ ] Optimistic updates for task status changes with rollback on failure
- [ ] Presence indicators (who is viewing the same project)

#### 7.2 Collaboration
- [ ] Threaded comments on tasks with `@` mention autocomplete
- [ ] Inline task editing
- [ ] Drag-and-drop Kanban (already on project detail — audit accessibility)

#### 7.3 AI agent UX
- [ ] Streaming responses from `dispatchAgentSwarm` (Server-Sent Events)
- [ ] "Run swarm" button with progress modal showing per-agent steps
- [ ] Langfuse deep-link from each task to its trace

#### 7.4 SEO / Marketing surface
- [ ] Public landing page (currently only authenticated app routes)
- [ ] Metadata API for OG tags
- [ ] Sitemap + robots.txt

#### 7.5 Mobile
- [ ] Audit responsive layouts (most are `md:`+ targeted)
- [ ] Hamburger nav for `< md` viewports
- [ ] Touch-friendly drag handles for Kanban on tablets

#### 7.6 Internationalization
- [ ] `next-intl` setup
- [ ] Extract all user-facing strings
- [ ] Locale-aware date/number formatting (`Intl.DateTimeFormat`)

---

## 🔧 Recommended Library Upgrades

| Library | Current | Recommended | Why |
|---|---|---|---|
| Data fetching | `useEffect` | `@tanstack/react-query` v5 | Caching, retries, optimistic updates |
| Forms | (none / ad-hoc) | `react-hook-form` + `zod` | Type-safe, minimal re-renders |
| Validation | — | `zod` | Shared schemas with backend |
| Toasts | — | `sonner` | Tiny, themeable, promise-aware |
| Dialogs | — | `@radix-ui/react-dialog` | Accessible, unstyled, keyboard-first |
| DnD | (unknown) | `@dnd-kit/core` | Accessible drag-drop, modern |
| Virtualization | — | `react-virtuoso` | Variable-height lists |
| Testing | — | `vitest` + `@testing-library/react` + `playwright` | Fast, isolated, E2E |
| Visual regression | — | `chromatic` or `playwright` snapshots | Catch unintended UI drift |
| Date utils | (native) | `date-fns` | Tree-shakable, immutable |
| Logging | `console.*` | `pino` (browser build) or `@logtail/logger` | Structured, transportable |
| Error tracking | — | `@sentry/nextjs` | Source maps, replay, perf |

---

## ⚠️ Critical Reminders (from `frontend/AGENTS.md`)

> **This is NOT the Next.js you know**
> This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Before **any** upgrade that touches framework APIs (routing, data fetching, server components, image, font, metadata), consult the in-repo docs:

```bash
ls node_modules/next/dist/docs/
```

In particular, verify:
- App Router conventions (`layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, route groups)
- Server / Client component boundaries
- `fetch()` caching defaults
- `cookies()`, `headers()`, `draftMode()` access rules
- Image / font APIs
- Middleware and `instrumentation.ts` hooks

---

## 📈 Success Metrics

| Metric | Current | Target |
|---|---|---|
| Lighthouse Performance | — | ≥ 90 |
| Lighthouse Accessibility | — | ≥ 95 |
| LCP (p75) | — | ≤ 2.0s |
| CLS (p75) | — | ≤ 0.05 |
| TBT (p75) | — | ≤ 200ms |
| Bundle size (initial) | — | ≤ 200 KB gzipped |
| Unit test coverage | — | ≥ 80% on `lib/` |
| E2E critical path coverage | — | 100% of user journeys |
| Open critical/high bugs | — | 0 |
| Time to interactive (Dashboard) | — | ≤ 3s on 4G |

---

## 🧭 Decision Log

| Date | Decision | Rationale |
|---|---|---|
| — | Adopt TanStack Query over SWR | Better TS ergonomics, mutation story |
| — | Server Components for static reads | Faster TTFB, lower JS shipped |
| — | Keep dark theme as default | Aligns with `SuperDesign` identity |
| — | Prefer httpOnly cookies over localStorage | Eliminates XSS token theft vector |

---

## 📚 References

- `Virtual_Tech_Company_Blueprint.md` — Product & org spec
- `README.md` — Setup & quickstart
- `frontend/AGENTS.md` — Next.js 16 breaking-change guidance
- `node_modules/next/dist/docs/` — Framework docs (in-repo)
- Django backend: `backend/teamflow/urls.py` — API surface

---

**Owner:** Frontend Guild
**Review cadence:** Monthly milestone demo + retro
**Next review:** After Phase 1 completion
