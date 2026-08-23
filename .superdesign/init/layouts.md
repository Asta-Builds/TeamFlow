# Layouts — Shared Layout Components (full source)

Two layouts. Every authenticated page renders inside `AppLayout` (sidebar + top bar). Login and the root redirect render bare.

---

## Root layout — `src/app/layout.tsx`

Loads Inter (via `next/font/google` → CSS var `--font-inter`), wraps everything in `AuthProvider`.

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TeamFlow — Project & Ticket Management",
  description: "Internal project & ticket management platform for the virtual tech company.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```
> NOTE: `metadata.title` still says "TeamFlow" but the product is now **BeneFlow** (HR benefits). The visible brand in the sidebar/login is "BeneFlow" with a teal `BF` mark.

---

## Authenticated app shell — `src/app/(app)/layout.tsx`

Left sidebar (fixed 240px, `w-60`, hidden on mobile) + top bar. Brand mark `BF` in a teal rounded square, org name + subscription-tier pill, nav items, HR-Admin-only "Billing & Plans" item, sign-out. Top bar shows current section name + user name/role + Avatar.

Brand color = **teal-600**. Active nav item = `bg-teal-50 text-teal-700 border border-teal-100`.

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Avatar, ROLE_LABELS } from "@/lib/ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/projects", label: "Benefits & Perks", icon: "▤" },
  { href: "/team", label: "Employees", icon: "☺" },
  { href: "/deployments", label: "Payroll Sync", icon: "⇗" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400 bg-slate-900">Loading…</div>;
  }

  const navItems = [...NAV];
  if (user.role === "hr_admin") {
    navItems.push({ href: "/billing", label: "Billing & Plans", icon: "💳" });
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white shadow-sm shadow-teal-600/30">BF</div>
          <span className="text-lg font-semibold tracking-tight text-slate-800">BeneFlow</span>
          {user.organization_tier && (
            <span className="ml-auto rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-700 border border-teal-200/50">{user.organization_tier}</span>
          )}
        </div>
        <div className="mb-4 px-2 py-1.5 bg-slate-50 border border-slate-200/60 rounded-lg text-xs text-slate-500 font-medium">🏢 {user.organization_name || "Workspace"}</div>
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition duration-150 ${active ? "bg-teal-50 text-teal-700 border border-teal-100" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
                <span className="text-base text-slate-400 group-hover:text-slate-600">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={logout} className="mt-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition">Sign out</button>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="text-sm font-medium text-slate-500">{navItems.find((n) => pathname.startsWith(n.href))?.label ?? "BeneFlow"}</div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-800 leading-tight">{user.name || user.email}</div>
              <div className="text-xs font-medium text-slate-400 mt-0.5">{ROLE_LABELS[user.role]}</div>
            </div>
            <Avatar name={user.name} email={user.email} />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

**Note (compliance page):** the sidebar nav labels list Dashboard / Benefits & Perks / Employees / Payroll Sync / Billing & Plans, but there is also a `/compliance` route not yet in the nav array.
