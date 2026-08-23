"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Avatar, ROLE_LABELS } from "@/lib/ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/projects", label: "Projects", icon: "▤" },
  { href: "/team", label: "Team", icon: "☺" },
  { href: "/deployments", label: "Deployments", icon: "⇗" },
  { href: "/compliance", label: "SEO Audits", icon: "⚖" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400 bg-slate-900">
        Loading…
      </div>
    );
  }

  // Add Billing route for Admins
  const navItems = [...NAV];
  if (user.role === "admin") {
    navItems.push({ href: "/billing", label: "Billing & Plans", icon: "💳" });
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/30">
            TF
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-800">TeamFlow</span>
          {user.organization_tier && (
            <span className="ml-auto rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 border border-indigo-200/50">
              {user.organization_tier}
            </span>
          )}
        </div>
        <div className="mb-4 px-2 py-1.5 bg-slate-50 border border-slate-200/60 rounded-lg text-xs text-slate-500 font-medium">
          🏢 {user.organization_name || "Workspace"}
        </div>
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition duration-150 ${
                  active
                    ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className="text-base text-slate-400 group-hover:text-slate-600">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="mt-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition"
        >
          Sign out
        </button>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="text-sm font-medium text-slate-500">
            {navItems.find((n) => pathname.startsWith(n.href))?.label ?? "TeamFlow"}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-800 leading-tight">
                {user.name || user.email}
              </div>
              <div className="text-xs font-medium text-slate-400 mt-0.5">
                {ROLE_LABELS[user.role]}
              </div>
            </div>
            <Avatar name={user.name} email={user.email} />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
