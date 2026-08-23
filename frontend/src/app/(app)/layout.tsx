"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { Notification } from "@/lib/types";
import { Avatar, ROLE_COLORS, ROLE_LABELS } from "@/lib/ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/projects", label: "Projects", icon: "▤" },
  { href: "/team", label: "Team", icon: "👥" },
  { href: "/deployments", label: "Deployments", icon: "🚀" },
  { href: "/compliance", label: "SEO Audits", icon: "🔍" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifMenu, setShowNotifMenu] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    apiFetch<Notification[]>("/notifications/")
      .then((data) => {
        if (Array.isArray(data)) setNotifications(data);
        else if (data && typeof data === "object" && "results" in data) {
          setNotifications((data as { results: Notification[] }).results || []);
        }
      })
      .catch(() => {});
  }, [user]);

  const markAllRead = async () => {
    try {
      await apiFetch("/notifications/read_all/", { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {}
  };

  const markSingleRead = async (id: number) => {
    try {
      await apiFetch(`/notifications/${id}/read/`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch {}
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400 bg-slate-900">
        Loading…
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const navItems = [...NAV];
  if (user.role === "admin" || user.role === "ceo") {
    navItems.push({ href: "/billing", label: "Billing & Plans", icon: "💳" });
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex shadow-xs">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-md shadow-indigo-600/30">
            TF
          </div>
          <div>
            <span className="text-base font-bold tracking-tight text-slate-900 block leading-none">
              TeamFlow
            </span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
              Virtual Tech Co.
            </span>
          </div>
          {user.organization_tier && (
            <span className="ml-auto rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700 border border-indigo-200/60">
              {user.organization_tier}
            </span>
          )}
        </div>

        <div className="mb-4 px-3 py-2 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600 font-medium flex items-center justify-between">
          <span className="truncate">🏢 {user.organization_name || "Workspace"}</span>
          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Active"></span>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition duration-150 ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30 font-semibold"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="pt-4 border-t border-slate-100">
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 rounded-xl px-3.5 py-2 text-left text-sm font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition"
          >
            <span>🚪</span>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main Header & Body */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-slate-800">
              {navItems.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"))?.label ?? "TeamFlow"}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifMenu(!showNotifMenu)}
                className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition"
                title="Notifications"
              >
                <span className="text-lg">🔔</span>
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-xs">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifMenu && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-white p-3 shadow-xl border border-slate-200 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Notifications ({unreadCount} unread)
                    </span>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-[11px] text-indigo-600 hover:underline font-semibold"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-2">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">No notifications yet</p>
                    ) : (
                      notifications.slice(0, 10).map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            markSingleRead(n.id);
                            if (n.link) router.push(n.link);
                            setShowNotifMenu(false);
                          }}
                          className={`p-2.5 rounded-xl text-xs cursor-pointer transition ${
                            n.is_read
                              ? "bg-slate-50 text-slate-600 hover:bg-slate-100"
                              : "bg-indigo-50/70 text-indigo-950 font-medium border border-indigo-100 hover:bg-indigo-100/60"
                          }`}
                        >
                          <div className="font-semibold text-slate-900">{n.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{n.message}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Info */}
            <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-bold text-slate-900 leading-tight">
                  {user.name || user.email}
                </div>
                <div className="mt-0.5">
                  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${ROLE_COLORS[user.role] || "bg-slate-100 text-slate-700"}`}>
                    {ROLE_LABELS[user.role] || user.role}
                  </span>
                </div>
              </div>
              <Avatar name={user.name} email={user.email} size={36} />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
