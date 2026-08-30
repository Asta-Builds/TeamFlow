# TeamFlow Design System

## Product character

TeamFlow is a dark, high-signal control room for a virtual technology company. It should feel calm under pressure, concise, and operationally trustworthy. Pulse is its personal execution layer: it helps a teammate turn the shared plan into a focused working day.

## Brand and typography

- Use the existing `TF` lettermark in a rounded indigo square. Do not invent or substitute a logo.
- Use the existing Inter font (`--font-inter`) throughout. No new font families.
- Titles are tight, bold, and readable. Supporting labels are small, semibold, and often uppercase with restrained tracking.

## Palette

- App shell: `slate-950` (`#020617`). Content surface: `slate-900` (`#0f172a`). Raised cards: `slate-900`/`slate-800` with `slate-800` borders.
- Primary action and active state: indigo `#4f46e5` / `#6366f1` with pale indigo supporting text.
- Completion and healthy status: emerald. Attention: amber. Urgent or blocked: rose. Use purple only for executive/CEO context.
- Keep contrast high: primary copy `slate-100`/white; secondary copy `slate-400`; muted metadata `slate-500`.

## Layout and components

- Desktop workspace uses the existing persistent 256px sidebar and 64px sticky top bar. New pages sit in the established content viewport.
- Use a responsive content width around `max-w-7xl`, 24px on desktop, and a predictable 16/24px spacing rhythm.
- Cards use 12–16px rounded corners, thin `slate-800` borders, and subtle indigo shadows only for active elements. Avoid large gradients, floating glass effects, or decorative noise.
- Primary controls are compact indigo buttons; secondary controls are dark outlined controls. Icons come from Lucide and accompany meaningful actions.
- Tables and lists need visible headings, status badges, whitespace, hover states, empty states, and loading/error states.

## Pulse signature: the focus rail

Pulse adds one distinctive but native pattern: a vertical day-focus rail. Morning, afternoon, and evening appear as clear consecutive segments with a single active marker, task count, and completion state. On mobile it becomes a horizontal segmented control. It should read as an actionable schedule, not a decorative timeline.

## Accessibility and motion

- Preserve keyboard focus visibility, semantic controls, descriptive icon labels, and at least WCAG AA contrast.
- Motion is limited to short opacity/position transitions and status pulses already used in TeamFlow. Respect `prefers-reduced-motion`.
- Do not convey task state through color alone; pair color with copy, iconography, or a badge.
