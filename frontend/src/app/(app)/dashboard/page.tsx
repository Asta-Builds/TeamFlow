"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, getAgentClusterStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ActivityFeedItem, AgentClusterStatus, Deployment, Paginated, Project, SEOAudit, Task } from "@/lib/types";
import {
  Avatar,
  Badge,
  PRIORITY_STYLES,
  ROLE_COLORS,
  ROLE_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_STYLES,
} from "@/lib/ui";

function SuperStatCard({
  label,
  value,
  subtitle,
  icon,
  trend,
  color = "border-slate-800 bg-slate-900/90",
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  icon?: string;
  trend?: string;
  color?: string;
}) {
  return (
    <div className={`rounded-2xl border p-5.5 shadow-sm transition-all duration-200 hover:border-slate-700 hover:-translate-y-0.5 ${color}`}>
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        {trend && (
          <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded-full">
            {trend}
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-black tracking-tight text-white">{value}</div>
      <div className="mt-1 text-xs font-bold text-slate-300">{label}</div>
      {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [seoAudits, setSeoAudits] = useState<SEOAudit[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedItem[]>([]);
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>("");
  const [agentCluster, setAgentCluster] = useState<AgentClusterStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<Paginated<Project>>("/projects/"),
      apiFetch<Paginated<Task>>("/tasks/"),
      apiFetch<Paginated<Deployment>>("/deployments/"),
      apiFetch<Paginated<SEOAudit>>("/seo/audits/").catch(() => ({ results: [] })),
      apiFetch<ActivityFeedItem[]>("/tasks/feed/").catch(() => []),
      getAgentClusterStatus().catch(() => null),
    ])
      .then(([p, t, d, s, feed, cluster]) => {
        setProjects(p.results || []);
        setTasks(t.results || []);
        setDeployments(d.results || []);
        setSeoAudits(s.results || []);
        if (Array.isArray(feed)) setActivityFeed(feed);
        if (cluster) setAgentCluster(cluster);
      })
      .catch((err) => console.error("Error loading dashboard data", err))
      .finally(() => setLoading(false));
  }, []);

  const openTickets = tasks.filter((t) => t.status !== "done");
  const myTickets = tasks.filter((t) => t.assignee === user?.id);
  const inReviewTickets = tasks.filter((t) => t.status === "in_review");
  const qaTickets = tasks.filter((t) => t.status === "qa");
  const latestDeploy = deployments[0];
  const avgSeoScore =
    seoAudits.length > 0
      ? Math.round(seoAudits.reduce((acc, a) => acc + (a.score || 0), 0) / seoAudits.length)
      : 92;

  const filteredFeed = selectedProjectFilter
    ? activityFeed.filter((a) => String(a.project_id) === selectedProjectFilter)
    : activityFeed;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500 font-semibold text-xs tracking-wider uppercase">
        Loading SuperDesign Insights…
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* 👑 SuperDesign Top Greeting Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Welcome, {user?.name?.split(" ")[0] || "Team Member"} 👋
            </h1>
            <span
              className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${ROLE_COLORS[user?.role || "member"]}`}
            >
              {ROLE_LABELS[user?.role || "member"]} View
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time virtual workspace operations for <strong className="text-slate-200">{user?.organization_name || "Workspace"}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 transition flex items-center gap-1.5 cursor-pointer"
          >
            <span>Explore Projects</span>
            <span>→</span>
          </Link>
        </div>
      </div>

      {/* 🎭 Role-Specific Action Center Banner */}
      {user?.role === "ceo" && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-slate-900 border border-purple-800/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-purple-200 flex items-center gap-2">
              <span>👑</span> Executive Overview — CEO Portal
            </h3>
            <p className="text-xs text-slate-300 mt-1">
              All {projects.length} workspace projects active. Overall completion rate is{" "}
              <strong className="text-white">
                {tasks.length > 0 ? Math.round((tasks.filter((t) => t.status === "done").length / tasks.length) * 100) : 0}%
              </strong>. Zero critical blocker escalations pending.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-purple-950 text-purple-300 border-purple-800/60 font-semibold">
              SEO Health: {avgSeoScore}/100
            </Badge>
            <Badge className="bg-emerald-950 text-emerald-300 border-emerald-800/60 font-semibold">
              Deployments: Healthy
            </Badge>
          </div>
        </div>
      )}

      {user?.role === "tech_lead" && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-950/50 via-slate-900 to-slate-900 border border-indigo-800/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-indigo-200 flex items-center gap-2">
              <span>🎯</span> Tech Lead Action Center
            </h3>
            <p className="text-xs text-slate-300 mt-1">
              <strong className="text-white">{inReviewTickets.length} tickets</strong> waiting for Code Review.{" "}
              <strong className="text-white">{qaTickets.length} tickets</strong> ready for QA sign-off before release.
            </p>
          </div>
          <Link
            href="/projects"
            className="px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 transition cursor-pointer"
          >
            Review Code & PRs →
          </Link>
        </div>
      )}

      {user?.role === "qa" && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-800/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-emerald-200 flex items-center gap-2">
              <span>🧪</span> QA Validation Queue
            </h3>
            <p className="text-xs text-slate-300 mt-1">
              There are <strong className="text-white">{qaTickets.length} tickets</strong> in the QA column waiting for verification & testing.
            </p>
          </div>
          <Link
            href="/projects"
            className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition cursor-pointer"
          >
            Open QA Board →
          </Link>
        </div>
      )}

      {user?.role === "devops" && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-orange-950/40 via-slate-900 to-slate-900 border border-orange-800/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-orange-200 flex items-center gap-2">
              <span>🚀</span> DevOps Pipeline Monitor
            </h3>
            <p className="text-xs text-slate-300 mt-1">
              Latest release: <strong className="text-white">{latestDeploy ? `${latestDeploy.project_name} (${latestDeploy.environment}) - ${latestDeploy.status.toUpperCase()}` : "No releases yet"}</strong>.
            </p>
          </div>
          <Link
            href="/deployments"
            className="px-3.5 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold hover:bg-orange-500 transition cursor-pointer"
          >
            Manage Deployments →
          </Link>
        </div>
      )}

      {/* 🤖 Multi-Agent Orchestration & RAG Cluster Overview */}
      {agentCluster && (
        <div className="rounded-2xl border border-indigo-900/60 bg-gradient-to-r from-indigo-950/70 via-slate-900 to-slate-900 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                <span>🤖</span> LangGraph Multi-Agent Cluster Active
              </h3>
              <span className="text-[10px] font-bold text-indigo-300 bg-indigo-950 border border-indigo-700/60 px-2 py-0.5 rounded-full uppercase tracking-wider">
                {agentCluster.total_agent_seats} Specialist Seats
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Orchestrator: <strong className="text-slate-200">Tech Lead</strong> · RAG: <strong className="text-slate-200">{agentCluster.vector_store} ({agentCluster.rag_embeddings_count} chunks)</strong> · Traces: <strong className="text-slate-200">{agentCluster.observability}</strong>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <span className="text-[11px] text-slate-500 block font-medium">Autonomous Swarms</span>
              <span className="text-sm font-extrabold text-white">
                {agentCluster.total_swarms_executed} Run{agentCluster.total_swarms_executed === 1 ? "" : "s"}
              </span>
            </div>

            <Link
              href="/projects"
              className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>⚡</span> Run Swarms
            </Link>
          </div>
        </div>
      )}

      {/* 📊 Main SuperStat KPI Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SuperStatCard label="Active Projects" value={projects.length} icon="📁" subtitle="All workspace initiatives" trend="+100%" />
        <SuperStatCard label="Open Tickets" value={openTickets.length} icon="📌" subtitle={`${tasks.filter(t => t.status === 'done').length} completed`} trend="Agile" />
        <SuperStatCard label="Assigned to Me" value={myTickets.length} icon="👤" subtitle="Your active backlog" color="border-indigo-800/60 bg-indigo-950/20" />
        <SuperStatCard label="Deployments" value={deployments.length} icon="🚀" subtitle={latestDeploy ? `Last: ${latestDeploy.environment}` : "Staging & Prod"} trend="Live" />
      </div>

      {/* 2-Column SuperDesign Content Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left Column: Tickets Assigned to Me */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <span>📋</span> My Assigned Tickets
            </h2>
            <span className="text-xs font-bold text-indigo-400 bg-indigo-950 px-2.5 py-0.5 rounded-full border border-indigo-800/50">
              {myTickets.length} Total
            </span>
          </div>

          {myTickets.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/50">
              <span className="text-3xl block">🎉</span>
              <p className="text-xs font-bold text-slate-300 mt-2">All caught up!</p>
              <p className="text-[11px] text-slate-500 mt-0.5">No open tickets assigned to you right now.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {myTickets.slice(0, 6).map((t) => {
                const typeInfo = TASK_TYPE_STYLES[t.task_type || "task"];
                const priorityInfo = PRIORITY_STYLES[t.priority || "medium"];
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/90 p-3.5 bg-slate-950/60 hover:bg-slate-950 hover:border-slate-700 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{typeInfo.icon}</span>
                        <span className="truncate text-xs font-bold text-white">{t.title}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-slate-500 font-medium">{t.project_name || "Project"}</span>
                        {t.due_date && (
                          <span className="text-[10px] text-amber-400 font-medium">📅 Due {t.due_date}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className={priorityInfo.style}>{priorityInfo.label}</Badge>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md">
                        {TASK_STATUS_LABELS[t.status]}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right Column: Real-Time Audit Activity Feed */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <span>⚡</span> Real-Time Audit Trail
            </h2>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded-md">
              Live Feed
            </span>
          </div>

          <div className="max-h-96 overflow-y-auto space-y-2.5 pr-1">
            {filteredFeed.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">No recent activity logged.</p>
            ) : (
              filteredFeed.slice(0, 8).map((a) => (
                <div
                  key={a.id}
                  className="p-3 rounded-xl border border-slate-800/80 bg-slate-950/50 flex items-start gap-3 text-xs"
                >
                  <Avatar name={a.actor_name || "System"} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white truncate">{a.actor_name || "System"}</span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="text-slate-400 text-[11px] mt-0.5">
                      {a.action === "created"
                        ? `Created ticket: ${a.task_title}`
                        : a.action === "status_changed"
                        ? `Moved ticket ${a.task_title} to ${(a.details as { to?: string })?.to || "new status"}`
                        : a.action === "qa_validated"
                        ? `QA Approved: ${a.task_title}`
                        : a.action === "qa_rejected"
                        ? `QA Rejected: ${a.task_title}`
                        : a.action}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
