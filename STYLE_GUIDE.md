# TeamFlow — SuperDesign System & Style Guide

**Version:** 2.0 (Modernized Next.js 16 + Tailwind v4 + Antigravity)  
**Target:** Dark theme-first, WCAG 2.1 AA accessible, ergonomic virtual workspace.

---

## 1. Design Principles & Guidelines

1. **Dark Canvas First (`#020617` / `slate-950`)**  
   Deep slate background reduces eye strain during prolonged development, pairing subtle card elevations (`slate-900/90`) and hairline borders (`slate-800`).
2. **Lucide React Vector Icons Only**  
   **Strict prohibition against raw emojis in production code or UI elements.** Every icon must be imported from `lucide-react` with descriptive vector graphics and `aria-hidden="true"` when accompanying text.
3. **Sonner Toasts for Interactive Feedback**  
   Replace browser `alert()` or raw dialogs with non-blocking Sonner toasts (`toast.success()`, `toast.error()`, `toast.promise()`).
4. **Accessible Landmarks & Keyboard Traversal**  
   Every interactive element provides visible focus rings (`focus-visible:ring-2 focus-visible:ring-indigo-500`), skip-to-content links, and ARIA landmarks. Respect `prefers-reduced-motion` with `motion-reduce:animate-none`.

---

## 2. Color Palette & WCAG AA Contrast Pairs

### Surface & Border Tokens

| Token | Class | Hex / Alpha | Usage |
|---|---|---|---|
| Background Root | `bg-slate-950` | `#020617` | Root application viewport |
| Surface Card | `bg-slate-900/90` | `#0f172a / 90%` | Cards, sidebars, modals |
| Surface Inset | `bg-slate-950/60` | `#020617 / 60%` | Nested panels, feed containers |
| Border Default | `border-slate-800` | `#1e293b` | Structural dividers, card borders |
| Border Subtle | `border-slate-800/80` | `#1e293b / 80%` | List item rows, sub-elements |
| Border Hover | `hover:border-slate-700` | `#334155` | Hover feedback |

### Text & Contrast Hierarchy

| Level | Class | Contrast on `bg-slate-950` | Notes |
|---|---|---|---|
| Primary Text | `text-white` / `text-slate-100` | > 15:1 (AAA) | Page headers, metric values |
| Secondary Text | `text-slate-300` | > 9:1 (AAA) | Body copy, card descriptions |
| Muted Text | `text-slate-400` | > 5.5:1 (AA) | Labels, timestamps, hints |
| Subdued Text | `text-slate-500` | > 3.5:1 (AA Large) | Non-essential metadata |

---

## 3. Role-Based Semantic Color Tokens

Every agent specialist in the virtual tech company has a signature semantic color token:

| Role | Label | Badge Style | Accent Color |
|---|---|---|---|
| `ceo` | Human Founder | `bg-purple-950/60 text-purple-300 border-purple-800/50` | Purple (`#a855f7`) |
| `pm` | AI Product Manager | `bg-violet-950/60 text-violet-300 border-violet-800/50` | Violet (`#8b5cf6`) |
| `tech_lead` | AI Tech Lead | `bg-indigo-950/60 text-indigo-300 border-indigo-800/50` | Indigo (`#6366f1`) |
| `backend` | AI Senior Backend | `bg-blue-950/60 text-blue-300 border-blue-800/50` | Blue (`#3b82f6`) |
| `frontend` | AI Senior Frontend | `bg-cyan-950/60 text-cyan-300 border-cyan-800/50` | Cyan (`#06b6d4`) |
| `qa` | AI QA Engineer | `bg-emerald-950/60 text-emerald-300 border-emerald-800/50` | Emerald (`#10b981`) |
| `devops` | AI DevOps Engineer | `bg-orange-950/60 text-orange-300 border-orange-800/50` | Orange (`#f97316`) |
| `designer` | AI UI/UX Designer | `bg-pink-950/60 text-pink-300 border-pink-800/50` | Pink (`#ec4899`) |
| `seo` | AI Technical SEO | `bg-teal-950/60 text-teal-300 border-teal-800/50` | Teal (`#14b8a6`) |

---

## 4. UI Primitives (`src/components/ui/`)

### 4.1 Button (`src/components/ui/button.tsx`)

Constructed with `class-variance-authority` (CVA) and `cn`:

```tsx
import { Button } from "@/components/ui";
import { Sparkles, Trash2 } from "lucide-react";

// Primary Action
<Button variant="default" size="md" onClick={handleDispatch}>
  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
  <span>Run AI PM</span>
</Button>

// Secondary / Cancel
<Button variant="secondary" size="md" onClick={onClose}>
  Cancel
</Button>

// Danger
<Button variant="danger" size="sm" onClick={handleDelete}>
  <Trash2 className="h-3 w-3" aria-hidden="true" />
  <span>Delete</span>
</Button>

// Loading State
<Button isLoading disabled>
  Submitting...
</Button>
```

### 4.2 Badge (`src/components/ui/badge.tsx`)

```tsx
import { Badge } from "@/components/ui";

<Badge variant="indigo">Tech Lead</Badge>
<Badge variant="success">Passed Gate</Badge>
<Badge variant="warning">In Review</Badge>
<Badge variant="danger">High Priority</Badge>
```

### 4.3 Card (`src/components/ui/card.tsx`)

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui";

<Card>
  <CardHeader>
    <CardTitle>Autonomous Pipeline</CardTitle>
    <CardDescription>Continuous delivery to AWS ECS / Staging</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-xs text-slate-300">Container health: 100%</p>
  </CardContent>
  <CardFooter>
    <Button size="sm">Deploy</Button>
  </CardFooter>
</Card>
```

### 4.4 Modal Dialog (`src/components/ui/modal.tsx`)

Accessible dialog with backdrop, escape key support, scroll lock, and Lucide close icon:

```tsx
import { Modal, Button } from "@/components/ui";

<Modal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Ingest Codebase into pgvector"
  description="Ground multi-agent decisions in repository architecture"
  maxWidth="lg"
>
  <div className="space-y-4">
    <p className="text-xs text-slate-300">Select documents to ingest...</p>
    <div className="flex justify-end gap-2 pt-4">
      <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
      <Button variant="default" onClick={handleConfirm}>Ingest Knowledge</Button>
    </div>
  </div>
</Modal>
```

### 4.5 StatCard (`src/components/ui/stat-card.tsx`)

Memoized KPI metric card with icon container, trend tag, and hover animation:

```tsx
import { StatCard } from "@/components/ui";
import { Rocket } from "lucide-react";

<StatCard
  label="Deployments"
  value={42}
  subtitle="Staging & Prod"
  trend="+12%"
  icon={Rocket}
/>
```

### 4.6 Avatar (`src/components/ui/avatar.tsx`)

Deterministic color gradient based on user/agent name seed, with live status indicator dot:

```tsx
import { Avatar } from "@/components/ui";

<Avatar
  name="Marcus Aurelius"
  email="ceo@teamflow.dev"
  size={36}
  showStatus={true}
  status="active"
/>
```

---

## 5. Spacing & Typography Scale

- **Base Font**: Inter (`var(--font-inter)`), font smoothing `antialiased`.
- **Headers**:
  - `h1`: `text-2xl sm:text-3xl font-black tracking-tight text-white`
  - `h2`: `text-lg sm:text-xl font-bold tracking-tight text-white`
  - `h3`: `text-base sm:text-lg font-bold text-white`
- **Body**: `text-xs sm:text-sm text-slate-300 leading-relaxed`
- **Microcopy**: `text-[11px] text-slate-400 font-medium`
- **Badges/Tags**: `text-[10px] uppercase font-bold tracking-wider`
- **Radii Tokens**:
  - Cards & Modals: `rounded-2xl`
  - Buttons & Inputs: `rounded-xl`
  - Badges & Micro-tags: `rounded-md` or `rounded-full`
