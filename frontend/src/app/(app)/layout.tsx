"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { Notification, Role } from "@/lib/types";
import { Avatar, ROLE_COLORS, ROLE_LABELS } from "@/lib/ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "📊", shortcut: "G D" },
  { href: "/projects", label: "Projects & Kanban", icon: "📋", shortcut: "G P" },
  { href: "/team", label: "Team & Seats", icon: "👥", shortcut: "G T" },
  { href: "/deployments", label: "Deployments", icon: "🚀", shortcut: "G E" },
  { href: "/compliance", label: "SEO Audits", icon: "🔍", shortcut: "G S" },
  { href: "/settings", label: "Workspace Settings", icon: "⚙️", shortcut: "G W" },
];

const DEMO_PERSONAS: Array<{ email: string; label: string; role: Role; desc: string }> = [
  { email: "lead@teamflow.dev", label: "Tech Lead", role: "tech_lead", desc: "PR Reviews & Swarm Dispatch" },
  { email: "ceo@teamflow.dev", label: "CEO / Executive", role: "ceo", desc: "Executive KPI & Budget Oversight" },
  { email: "qa@teamflow.dev", label: "QA Engineer", role: "qa", desc: "Decision Gate & Rejection Loop" },
  { email: "devops@teamflow.dev", label: "DevOps Engineer", role: "devops", desc: "Releases & 1-Click Rollback" },
  { email: "seo@teamflow.dev", label: "SEO Specialist", role: "seo", desc: "Core Web Vitals & Audit Tickets" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, login } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);
  const [switchingRole, setSwitchingRole] = useState(false);

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

  async function handleSwitchPersona(email: string) {
    setSwitchingRole(true);
    try {
      await login(email, "teamflow-demo-pw");
      setShowRoleSwitcher(false);
      router.refresh();
    } catch (err) {
      alert("Error switching persona: " + String(err));
    } finally {
      setSwitchingRole(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400 font-medium">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white font-extrabold shadow-lg shadow-indigo-600/30 animate-pulse">
            TF
          </div>
          <span className="text-xs font-semibold tracking-wider uppercase text-slate-500">Initializing SuperDesign Workspace…</span>
        </div>
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const navItems = [...NAV];
  if (user.role === "admin" || user.role === "ceo") {
    navItems.push({ href: "/billing", label: "Billing & Plans", icon: "💳", shortcut: "G B" });
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white">
      {/* 🧭 SuperDesign Sleek Dark Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/80 bg-slate-950 p-4 md:flex justify-between">
        <div className="space-y-5">
          {/* Workspace Brand Header */}
          <div className="flex items-center gap-3 px-2 py-1">
            <Link href="/dashboard" className="flex items-center gap-2.5 group">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-extrabold text-white shadow-md shadow-indigo-600/40 group-hover:scale-105 transition">
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
              <span className="text-sm">🏢</span>
              <span className="font-semibold text-white truncate">{user.organization_name || "Workspace"}</span>
            </div>
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="System Online"></span>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <div className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Workspace Platform
            </div>
            {navItems.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition duration-150 group cursor-pointer ${
                    active
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold"
                      : "text-slate-400 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  {active && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer & Role Switcher Trigger */}
        <div className="space-y-2 pt-4 border-t border-slate-800/80">
          <button
            onClick={() => setShowRoleSwitcher(true)}
            className="w-full flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span>🎭</span>
              <span>Switch Persona</span>
            </div>
            <span className="text-[10px] text-indigo-400 font-bold uppercase">{ROLE_LABELS[user.role]?.split(" ")[0]}</span>
          </button>

          <button
            onClick={logout}
            className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-400 hover:bg-rose-950/40 hover:text-rose-400 transition cursor-pointer"
          >
            <span>🚪</span>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main App Content Viewport */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-900">
        {/* 🌟 SuperDesign App Header */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-6 backdrop-blur-md">
          {/* Left: Breadcrumbs / Title */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-extrabold text-white tracking-tight">
              {navItems.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"))?.label ?? "TeamFlow"}
            </span>

            {/* Live Swarm Status Pill */}
            <div className="hidden lg:inline-flex items-center gap-1.5 rounded-full border border-indigo-800/40 bg-indigo-950/40 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-300">
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>LangGraph Swarm Online</span>
            </div>
          </div>

          {/* Right Toolbar */}
          <div className="flex items-center gap-3">
            {/* Quick Switch Persona Button */}
            <button
              onClick={() => setShowRoleSwitcher(true)}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition cursor-pointer"
              title="Test the app from different role perspectives"
            >
              <span>🎭</span>
              <span>Switch Role</span>
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifMenu(!showNotifMenu)}
                className="relative p-2 rounded-xl text-slate-400 hover:bg-slate-900 hover:text-white transition cursor-pointer"
                title="Notifications"
              >
                <span className="text-base">🔔</span>
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-xs">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifMenu && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-slate-900 p-3.5 shadow-2xl border border-slate-800 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Notifications ({unreadCount} unread)
                    </span>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-[11px] text-indigo-400 hover:underline font-semibold cursor-pointer"
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
                          onClick={() => {
                            markSingleRead(n.id);
                            if (n.link) router.push(n.link);
                            setShowNotifMenu(false);
                          }}
                          className={`p-2.5 rounded-xl text-xs cursor-pointer transition ${
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
            <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-bold text-white leading-tight">
                  {user.name || user.email}
                </div>
                <div className="mt-0.5">
                  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ${ROLE_COLORS[user.role] || "bg-slate-800 text-slate-300"}`}>
                    {ROLE_LABELS[user.role] || user.role}
                  </span>
                </div>
              </div>
              <Avatar name={user.name} email={user.email} size={34} showStatus={true} status="active" />
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto p-6 lg:p-8 bg-slate-900 text-slate-100">{children}</main>
      </div>

      {/* 🎭 Quick Role Impersonator Modal */}
      {showRoleSwitcher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4" onClick={() => setShowRoleSwitcher(false)}>
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>🎭</span> Quick Role Switcher
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Test the SuperDesign UI instantly from different organizational perspectives.
                </p>
              </div>
              <button onClick={() => setShowRoleSwitcher(false)} className="text-slate-400 hover:text-white text-base cursor-pointer">✕</button>
            </div>

            <div className="space-y-2">
              {DEMO_PERSONAS.map((p) => (
                <button
                  key={p.email}
                  onClick={() => handleSwitchPersona(p.email)}
                  disabled={switchingRole || user.email === p.email}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition cursor-pointer ${
                    user.email === p.email
                      ? "border-indigo-500 bg-indigo-950/50 shadow-xs cursor-default"
                      : "border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{p.label}</span>
                      {user.email === p.email && (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded-md">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">{p.desc}</div>
                  </div>

                  <span className="text-xs font-mono text-slate-500">{p.email}</span>
                </button>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowRoleSwitcher(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
