"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { Notification } from "@/lib/types";
import { Avatar, AgentTypeBadge } from "@/lib/ui";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Kanban,
  Users,
  Rocket,
  SearchCheck,
  Settings,
  CreditCard,
  Bell,
  LogOut,
  Building2,
  Timer,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects & Kanban", icon: Kanban },
  { href: "/pulse", label: "Pulse", icon: Timer },
  { href: "/team", label: "Team & AI Seats", icon: Users },
  { href: "/deployments", label: "Deployments", icon: Rocket },
  { href: "/compliance", label: "SEO Audits", icon: SearchCheck },
  { href: "/settings", label: "Workspace Settings", icon: Settings },
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
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Failed to mark notifications as read");
    }
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
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400 font-medium">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white font-extrabold shadow-lg shadow-indigo-600/30 animate-pulse">
            TF
          </div>
          <span className="text-xs font-semibold tracking-wider uppercase text-slate-500">Loading Workspace…</span>
        </div>
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const isHuman = user.role === "ceo";

  const navItems = [...NAV];
  if (user.role === "admin" || user.role === "ceo") {
    navItems.push({ href: "/billing", label: "Billing & Plans", icon: CreditCard });
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white">
      {/* SuperDesign Dark Sidebar */}
      <aside aria-label="Workspace Sidebar" className="hidden w-64 shrink-0 flex-col border-r border-slate-800/80 bg-slate-950 p-4 md:flex justify-between">
        <div className="space-y-5">
          {/* Workspace Brand Header */}
          <div className="flex items-center gap-3 px-2 py-1">
            <Link
              href="/dashboard"
              className="flex items-center gap-2.5 group rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
              aria-label="TeamFlow Home"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-xs font-extrabold text-white shadow-md shadow-indigo-600/40 group-hover:scale-105 transition">
                TF
              </div>
              <div>
                <span className="text-sm font-extrabold tracking-tight text-white block leading-none">
                  TeamFlow
                </span>
                <span className="text-[10px] text-indigo-400 uppercase tracking-widest font-bold mt-0.5 block">
                  Virtual Tech Co.
                </span>
              </div>
            </Link>

            {user.organization_tier && (
              <span className="ml-auto rounded-md bg-indigo-950/80 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-indigo-300 border border-indigo-700/50">
                {user.organization_tier}
              </span>
            )}
          </div>

          {/* Active Workspace Selector Card */}
          <div className="px-3 py-2.5 rounded-xl border border-slate-800 bg-slate-900/70 text-xs text-slate-300 flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2 truncate">
              <Building2 className="h-4 w-4 text-indigo-400 shrink-0" aria-hidden="true" />
              <span className="font-semibold text-white truncate">{user.organization_name || "Workspace"}</span>
            </div>
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" title="System Online" aria-label="System Online"></span>
          </div>

          {/* Navigation Links */}
          <nav aria-label="Primary Navigation" className="space-y-1">
            <div className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Workspace Platform
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition duration-150 group cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                    active
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold"
                      : "text-slate-400 hover:bg-slate-900 hover:text-white"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </div>
                  {active && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="space-y-2 pt-4 border-t border-slate-800/80">
          <Link
            href="/profile"
            className="w-full flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:border-slate-700 transition focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
            aria-label="View My Profile"
          >
            <div className="flex items-center gap-2 truncate">
              <span className="truncate font-bold text-white">{user.name || user.email}</span>
            </div>
            <AgentTypeBadge role={user.role} isAi={!isHuman} />
          </Link>

          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-400 hover:bg-rose-950/40 hover:text-rose-400 transition cursor-pointer focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none"
            aria-label="Sign out of workspace"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main App Content Viewport */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-900">
        {/* App Header */}
        <header role="banner" className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-6 backdrop-blur-md">
          {/* Left: Breadcrumbs / Title */}
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-extrabold text-white tracking-tight">
              {navItems.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"))?.label ?? "TeamFlow"}
            </h1>

            {/* Live Swarm Status Pill */}
            <div className="hidden lg:inline-flex items-center gap-1.5 rounded-full border border-indigo-800/40 bg-indigo-950/40 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-300">
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
              <span>LangGraph Swarm Online (9 AI Agent Seats)</span>
            </div>
          </div>

          {/* Right Toolbar */}
          <div className="flex items-center gap-3">

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifMenu(!showNotifMenu)}
                className="relative p-2 rounded-xl text-slate-400 hover:bg-slate-900 hover:text-white transition cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
                aria-label={`Notifications, ${unreadCount} unread`}
                aria-expanded={showNotifMenu}
                aria-haspopup="true"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-xs">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifMenu && (
                <div
                  role="region"
                  aria-label="Notifications Panel"
                  className="absolute right-0 mt-2 w-80 rounded-2xl bg-slate-900 p-3.5 shadow-2xl border border-slate-800 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Notifications ({unreadCount} unread)
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-[11px] text-indigo-400 hover:underline font-semibold cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none rounded"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-2">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">No notifications yet</p>
                    ) : (
                      notifications.slice(0, 10).map((n) => (
                        <div
                          key={n.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            markSingleRead(n.id);
                            if (n.link) router.push(n.link);
                            setShowNotifMenu(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              markSingleRead(n.id);
                              if (n.link) router.push(n.link);
                              setShowNotifMenu(false);
                            }
                          }}
                          className={`p-2.5 rounded-xl text-xs cursor-pointer transition focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                            n.is_read
                              ? "bg-slate-950/60 text-slate-400 hover:bg-slate-800/60"
                              : "bg-indigo-950/60 text-indigo-200 font-medium border border-indigo-800/50 hover:bg-indigo-900/50"
                          }`}
                        >
                          <div className="font-semibold text-white">{n.title}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{n.message}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Pill */}
            <Link
              href="/profile"
              className="flex items-center gap-3 pl-3 border-l border-slate-800 rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none group cursor-pointer"
              aria-label="User profile settings"
            >
              <div className="text-right hidden sm:block">
                <div className="text-xs font-bold text-white leading-tight flex items-center justify-end gap-1.5 group-hover:text-indigo-300 transition">
                  <span>{user.name || user.email}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-end gap-1.5">
                  <AgentTypeBadge role={user.role} isAi={!isHuman} />
                </div>
              </div>
              <Avatar name={user.name} email={user.email} size={34} showStatus={true} status="active" />
            </Link>
          </div>
        </header>

        {/* Main Content Area */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-auto p-6 lg:p-8 bg-slate-900 text-slate-100 focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
