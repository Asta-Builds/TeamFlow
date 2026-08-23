# BeneFlow — Design System

## Product context
**BeneFlow** is a multi-tenant SaaS for **employee benefits & perks administration**. HR Admins define benefit categories & plans, review employee perk **claims** (reimbursements) on a Kanban pipeline, sync approved deductions to payroll, run compliance audits, and manage the org's subscription. Employees browse offerings, submit claims, and track their monthly stipend balance.

**Primary users:** HR Admin (privileged), Employee, Benefits Partner.
**Key pages:** Login, Dashboard (role-split), Benefits & Perks (categories), Claims Kanban board + claim detail, Employee Directory, Payroll Sync, Compliance Audits, Billing & Plans.
**JTBD:** "Give employees great perks with minimal HR overhead, stay compliant, and push it all to payroll automatically."

## Brand & tone
Trustworthy, calm, financial-grade but friendly. Clean SaaS — generous whitespace, soft shadows, rounded corners, crisp bold headings. Not playful, not enterprise-drab.

## Color
Built on Tailwind v4 default palette (no custom config). Brand accent = **teal**.

| Token | Value | Use |
|---|---|---|
| Primary | `teal-600` #0d9488 | buttons, brand mark, active nav, links, key figures |
| Primary hover | `teal-700` #0f766e | hover states |
| Primary soft | `teal-50` bg / `teal-700` text / `teal-200` border | badges, active nav, pills |
| App background | `slate-50` #f8fafc | page canvas |
| Surface | `white` | cards, sidebar, top bar, tables |
| Border | `slate-200` | dividers, card borders |
| Heading text | `slate-800` / `slate-900` | titles (bold, tracking-tight) |
| Body text | `slate-600` | paragraphs |
| Muted / subtle | `slate-500` / `slate-400` | secondary, captions |
| Success / Paid | `emerald-600` (+ `emerald-50/700`) | approved, paid, active, high scores |
| Warning / Pending | `amber-500` (+ `amber-50/700`) | pending, in-progress, mid scores |
| Danger / High | `red-600` (+ `red-50/700`) | failed, high-severity |
| Info / Medium | `blue-700` (+ `blue-50`) | medium priority |

**Claim status colors:** Pending `slate-400` · In Review `amber-400` · Approved `teal-400` · Paid `emerald-500`.
Do NOT introduce colors outside this set (no purple gradients except existing `rolled_back` purple, no pink/neon).

## Typography
- Family: **Inter** (`--font-inter`), system-ui fallback. Single family — no serif, no display face.
- Page title: `text-2xl font-bold tracking-tight` slate-800/900
- Section title: `text-sm font-semibold` slate-700
- Stat value: `text-2xl`–`text-3xl font-bold`/`font-extrabold`
- Labels/eyebrows: `text-xs uppercase tracking-wider font-semibold`/`font-bold` slate-400
- Body: `text-sm` slate-600, `leading-relaxed`
- Weights skew heavy (semibold/bold/extrabold) for a crisp, confident SaaS feel.

## Layout
- **App shell:** fixed 240px (`w-60`) white left sidebar + 56px white top bar; content area `p-6` on `slate-50`, `space-y-6` vertical rhythm. Sidebar hidden below `md`.
- **Cards:** `rounded-xl border border-slate-200 bg-white p-5 shadow-sm`; interactive cards add `hover:shadow-md hover:border-slate-300`.
- **Grids:** stat rows `grid-cols-2 lg:grid-cols-4`; card grids `sm:grid-cols-2 lg:grid-cols-3`; Kanban `md:grid-cols-2 xl:grid-cols-4`.
- **Kanban column:** `rounded-xl bg-slate-100 p-3 min-h-[400px]`, header with status dot + count chip.
- **Tables:** wrapped in `overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm`; head `bg-slate-50/75 uppercase text-xs font-bold text-slate-400`; rows `divide-y divide-slate-100 hover:bg-slate-50/50`.
- **Detail panel:** right-side sheet `max-w-md` over `bg-slate-900/40 backdrop-blur-xs`.

## Components
- **Button (primary):** `rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 shadow-sm`
- **Button (secondary):** `rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50`
- **Input:** `rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100`
- **Badge/pill:** `rounded-full px-2 py-0.5 text-xs font-medium` + semantic color set
- **Avatar:** round initials, deterministic teal/emerald/rose/amber/sky/violet/indigo
- **StatCard:** card with big bold value + label + `text-xs slate-400` description
- **Brand mark:** `BF` in `rounded-lg bg-teal-600 text-white font-bold` + `shadow-teal-600/30`

## Radii, shadow, spacing
- Radius: `rounded-lg` (8px) controls/inputs, `rounded-xl` (12px) cards/columns, `rounded-full` pills/avatars.
- Shadow: `shadow-sm` default, `shadow-md` on hover. No heavy/dramatic shadows.
- Spacing scale: Tailwind default; card pad 5–6, gaps 4–6.

## Iconography
Current UI uses inline emoji (🏢 💼 💵 💳 🟢 ❌ ⚠️) as lightweight glyphs; no icon library installed. If a redesign adopts a real icon set, use **Lucide** (thin line, matches the calm aesthetic) and keep it monochrome slate/teal — treat that as an explicit, called-out change.

## Motion
Subtle only: `transition` on hover for buttons/cards/nav; no elaborate entrance animation. Respect reduced-motion.

## Fidelity constraint (append to every design prompt)
"Use ONLY the fonts, colors, spacing, and component styles defined in this design system (Inter font; teal-600 primary; slate neutrals; emerald/amber/red/blue semantic colors; rounded-lg/xl; soft shadow-sm). Do not introduce any fonts, colors, gradients, or visual styles not in the design system."
