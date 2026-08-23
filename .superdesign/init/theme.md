# Theme — Design Tokens

**Tailwind CSS v4.** No `tailwind.config.*` file. Tokens are declared with `@theme inline` inside `globals.css`; everything else uses Tailwind's default utility palette (slate / teal / emerald / amber / etc.). Font is **Inter** via `next/font` → CSS var `--font-inter`.

## `src/app/globals.css` (full)

```css
@import "tailwindcss";

:root {
  --background: #f9fafb;
  --foreground: #111827;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-inter);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}
```

## Effective design tokens (derived from utility usage across pages)

**Brand / primary — Teal**
- Primary action: `teal-600` (#0d9488); hover `teal-700` (#0f766e)
- Primary soft: `teal-50` / `teal-100` backgrounds, `teal-700` text, `teal-200/50` borders
- Brand mark shadow: `shadow-teal-600/30`
- Focus ring: `focus:border-teal-500 focus:ring-2 focus:ring-teal-100`

**Neutrals — Slate**
- App background: `slate-50` (#f8fafc) — note `globals.css --background` is `#f9fafb` (gray-50), pages use `bg-slate-50`
- Surface: `white`; borders `slate-200`; hover `slate-50` / `slate-100`
- Text: heading `slate-800`/`slate-900` (bold, `tracking-tight`); body `slate-600`; muted `slate-500`; subtle `slate-400`
- Table head: `bg-slate-50/75 text-slate-400 uppercase font-bold text-xs`

**Semantic colors**
- Success / paid / active: `emerald-600`, soft `emerald-50/700 border-emerald-200`
- Warning / pending / in-progress: `amber-500`/`amber-700`, soft `amber-50`
- Danger / high: `red-600`/`red-700`, soft `red-50 border-red-200`
- Info / medium priority: `blue-700`, soft `blue-50 border-blue-200/60`
- Rolled back: `purple-700`, soft `purple-100`

**Claim pipeline status dots**: todo `slate-400` · in_progress `amber-400` · in_review `teal-400` · done `emerald-500`

**Radii**: cards/inputs `rounded-lg` (8px) and `rounded-xl` (12px); pills `rounded-full`; brand mark `rounded-lg`.
**Shadow**: `shadow-sm` almost everywhere; `hover:shadow-md` on interactive cards.
**Spacing**: page content padded `p-6` (from `<main>`); card padding `p-5`/`p-6`; vertical rhythm `space-y-6`.
**Type scale**: page title `text-2xl font-bold tracking-tight`; section title `text-sm font-semibold`; stat value `text-2xl font-bold`; labels `text-xs uppercase tracking-wider font-semibold/bold`.
**Font weights** skew heavy: `font-semibold`/`font-bold`/`font-extrabold` used liberally for a crisp SaaS feel.

**Emoji accents**: the current UI uses emoji inline (🏢 💼 💵 💳 🟢 ❌ ⚠️) as lightweight icons. No icon library is installed. A redesign may replace these with an icon set (e.g. Lucide) — call that out as a change if used.
