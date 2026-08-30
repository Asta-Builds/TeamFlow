"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { Notification, Role } from "@/lib/types";
import { Avatar, ROLE_COLORS, ROLE_LABELS, AgentTypeBadge } from "@/lib/ui";
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
  UserCog,
  Building2,
  Crown,
  Bot,
  X,
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

const DEMO_PERSONAS: Array<{ email: string; label: string; role: Role; desc: string; isAi: boolean }> = [
  { email: "ceo@teamflow.dev", label: "CEO (Human Founder)", role: "ceo", desc: "Human Executive, KPI & Budget Control", isAi: false },
  { email: "lead@teamflow.dev", label: "AI Tech Lead", role: "tech_lead", desc: "Autonomous Swarm Orchestration & Code Review", isAi: true },
  { email: "backend1@teamflow.dev", label: "AI Backend Engineer", role: "backend", desc: "Autonomous PR Generation & Mutex Fixes", isAi: true },
  { email: "qa@teamflow.dev", label: "AI QA Engineer", role: "qa", desc: "Autonomous Decision Gate & Regression Tests", isAi: true },
  { email: "devops@teamflow.dev", label: "AI DevOps Engineer", role: "devops", desc: "Autonomous Staging Releases & 1-Click Rollback", isAi: true },
  { email: "seo@teamflow.dev", label: "AI SEO Specialist", role: "seo", desc: "Autonomous Core Web Vitals Audits", isAi: true },
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

  async function handleSwitchPersona(email: string) {
    setSwitchingRole(true);
    try {
      await login(email, "teamflow-demo-pw");
      setShowRoleSwitcher(false);
      toast.success(`Switched to ${email}`);
      router.refresh();
    } catch (err) {
      toast.error("Error switching persona: " + String(err));
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
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/80 bg-slate-950 p-4 md:flex justify-between">
        <div className="space-y-5">
          {/* Workspace Brand Header */}
          <div className="flex items-center gap-3 px-2 py-1">
            <Link href="/dashboard" className="flex items-center gap-2.5 group">
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
              <Building2 className="h-4 w-4 text-indigo-400 shrink-0" />
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
              const Icon = item.icon;
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
                    <Icon className="h-4 w-4 shrink-0" />
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
              <UserCog className="h-3.5 w-3.5 text-indigo-400" />
              <span>Switch Persona</span>
            </div>
            <AgentTypeBadge role={user.role} isAi={!isHuman} />
          </button>

          <button
            onClick={logout}
            className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-400 hover:bg-rose-950/40 hover:text-rose-400 transition cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main App Content Viewport */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-900">
        {/* App Header */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-6 backdrop-blur-md">
          {/* Left: Breadcrumbs / Title */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-extrabold text-white tracking-tight">
              {navItems.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"))?.label ?? "TeamFlow"}
            </span>

            {/* Live Swarm Status Pill */}
            <div className="hidden lg:inline-flex items-center gap-1.5 rounded-full border border-indigo-800/40 bg-indigo-950/40 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-300">
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>LangGraph Swarm Online (9 AI Agent Seats)</span>
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
              <UserCog className="h-3.5 w-3.5 text-indigo-400" />
              <span>Switch Role</span>
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifMenu(!showNotifMenu)}
                className="relative p-2 rounded-xl text-slate-400 hover:bg-slate-900 hover:text-white transition cursor-pointer"
                title="Notifications"
              >
                <Bell className="h-4 w-4" />
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
                <div className="text-xs font-bold text-white leading-tight flex items-center justify-end gap-1.5">
                  <span>{user.name || user.email}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-end gap-1.5">
                  <AgentTypeBadge role={user.role} isAi={!isHuman} />
                </div>
              </div>
              <Avatar name={user.name} email={user.email} size={34} showStatus={true} status="active" />
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto p-6 lg:p-8 bg-slate-900 text-slate-100">{children}</main>
      </div>

      {/* Quick Role Impersonator Modal */}
      {showRoleSwitcher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4" onClick={() => setShowRoleSwitcher(false)}>
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <UserCog className="h-4 w-4 text-indigo-400" />
                  <span>Switch Active Persona</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Experience TeamFlow as the <strong>Human CEO Founder</strong> or any <strong>Autonomous AI Agent</strong>.
                </p>
              </div>
              <button onClick={() => setShowRoleSwitcher(false)} className="text-slate-400 hover:text-white text-base cursor-pointer">
                <X className="h-4 w-4" />
              </button>
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
                      {p.isAi ? (
                        <Bot className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      ) : (
                        <Crown className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                      )}
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
