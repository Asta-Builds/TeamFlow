# Extractable Components

Menu of components worth extracting as reusable SuperDesign `DraftComponent`s so every generated page shares one shell. Full source lives in `layouts.md` / `components.md`.

## Layout Components

## AppSidebar
- Source: `src/app/(app)/layout.tsx` (the `<aside>` block)
- Category: layout
- Description: Fixed 240px left sidebar — BeneFlow `BF` teal brand mark, org name + subscription-tier pill, nav links (Dashboard, Benefits & Perks, Employees, Payroll Sync, HR-Admin-only Billing & Plans), sign-out.
- Extractable props: activeItem (string, default: "dashboard"), orgName (string, default: "Acme Corp"), tier (string, default: "growth"), isHrAdmin (boolean, default: true)
- Hardcoded: BF logo mark, nav labels + emoji icons, all Tailwind classes, teal active state (`bg-teal-50 text-teal-700`).

## AppTopbar
- Source: `src/app/(app)/layout.tsx` (the `<header>` block)
- Category: layout
- Description: 56px top bar — current section label (left) + user name/role + Avatar (right).
- Extractable props: sectionLabel (string, default: "Dashboard"), userName (string, default: "Sarah Jenkins"), roleLabel (string, default: "HR Admin")
- Hardcoded: layout, border, Avatar composition, all CSS.

## Basic Components

## Avatar
- Source: `src/lib/ui.tsx`
- Category: basic
- Description: Round initials avatar, deterministic color from a 7-color palette.
- Extractable props: name (string, default: "Sarah Jenkins"), size (number, default: 32)
- Hardcoded: color palette, initials logic, rounded-full styling.

## Badge
- Source: `src/lib/ui.tsx`
- Category: basic
- Description: Rounded pill; color supplied via className (priority/status/tier styles).
- Extractable props: label (string, default: "Approved"), variant (string, default: "teal")
- Hardcoded: pill shape, padding, text size.

> Recommendation: extract **AppSidebar** + **AppTopbar** first (they appear on all 7 authenticated pages). Skip Avatar/Badge for extraction — simple enough to inline in drafts.
