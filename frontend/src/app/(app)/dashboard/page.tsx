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
  STATUS_DOT,
  TASK_STATUS_LABELS,
  TASK_TYPE_STYLES,
} from "@/lib/ui";

function StatCard({
  label,
  value,
  subtitle,
  icon,
  color = "border-slate-200",
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  icon?: string;
  color?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-xs transition hover:shadow-md ${color}`}>
      <div className="flex items-center justify-between">
        <div className="text-3xl font-extrabold text-slate-900 tracking-tight">{value}</div>
        {icon && <span className="text-2xl">{icon}</span>}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-700">{label}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
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
      <div className="flex h-64 items-center justify-center text-slate-400 font-medium">
        Loading dashboard insights…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Welcome back, {user?.name?.split(" ")[0] || "Team Member"} 👋
            </h1>
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full border ${ROLE_COLORS[user?.role || "member"]}`}
            >
              {ROLE_LABELS[user?.role || "member"]} View
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Real-time operations summary for <span className="font-semibold text-slate-700">{user?.organization_name || "Workspace"}</span>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            Explore Projects →
          </Link>
        </div>
      </div>

      {/* Role-Specific Banner Insights */}
      {user?.role === "ceo" && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-blue-500/10 border border-purple-200/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-purple-950 flex items-center gap-2">
              <span>👑</span> Executive Overview — CEO Portal
            </h3>
            <p className="text-xs text-purple-900/80 mt-1">
              All {projects.length} workspace projects active. Overall completion rate is{" "}
              <strong>
                {tasks.length > 0 ? Math.round((tasks.filter((t) => t.status === "done").length / tasks.length) * 100) : 0}%
              </strong>. Zero critical blocker escalations pending.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-purple-100 text-purple-800 border-purple-200 font-semibold">
              SEO Health: {avgSeoScore}/100
            </Badge>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 font-semibold">
              Deployments: Healthy
            </Badge>
          </div>
        </div>
      )}

      {user?.role === "tech_lead" && (
        <div className="p-5 rounded-2xl bg-indigo-50 border border-indigo-200/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
              <span>🎯</span> Tech Lead Action Center
            </h3>
            <p className="text-xs text-indigo-900/80 mt-1">
              <strong>{inReviewTickets.length} tickets</strong> waiting for Code Review.{" "}
              <strong>{qaTickets.length} tickets</strong> ready for QA sign-off before release.
            </p>
          </div>
          <Link
            href="/projects"
            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition"
          >
            Review Code & PRs
          </Link>
        </div>
      )}

      {user?.role === "qa" && (
        <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-emerald-950 flex items-center gap-2">
              <span>🧪</span> QA Validation Queue
            </h3>
            <p className="text-xs text-emerald-900/80 mt-1">
              There are <strong>{qaTickets.length} tickets</strong> in the QA column waiting for verification & testing.
            </p>
          </div>
          <Link
            href="/projects"
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition"
          >
            Open QA Board
          </Link>
        </div>
      )}

      {user?.role === "devops" && (
        <div className="p-5 rounded-2xl bg-orange-50 border border-orange-200/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-orange-950 flex items-center gap-2">
              <span>🚀</span> DevOps Pipeline Monitor
            </h3>
            <p className="text-xs text-orange-900/80 mt-1">
              Latest release: {latestDeploy ? `${latestDeploy.project_name} (${latestDeploy.environment}) - ${latestDeploy.status.toUpperCase()}` : "No releases yet"}.
            </p>
          </div>
          <Link
            href="/deployments"
            className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 transition"
          >
            Manage Deployments
          </Link>
        </div>
      )}

      {/* Multi-Agent Orchestration & RAG Cluster Overview */}
      {agentCluster && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/90 via-purple-50/70 to-slate-50 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <h3 className="text-sm font-extrabold text-indigo-950 flex items-center gap-1.5">
                <span>🤖</span> LangGraph Multi-Agent Cluster Active
              </h3>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
                {agentCluster.total_agent_seats} Seats
              </span>
            </div>
            <p className="text-xs text-slate-600 font-medium">
              Orchestrator: <strong className="text-slate-800">Tech Lead</strong> · RAG: <strong className="text-slate-800">{agentCluster.vector_store} ({agentCluster.rag_embeddings_count} chunks)</strong> · Traces: <strong className="text-slate-800">{agentCluster.observability}</strong>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <span className="text-xs text-slate-500 block font-medium">Autonomous Swarms</span>
              <span className="text-sm font-extrabold text-indigo-900">
                {agentCluster.total_swarms_executed} Run{agentCluster.total_swarms_executed === 1 ? "" : "s"}
              </span>
            </div>

            <Link
              href="/projects"
              className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition flex items-center gap-1.5"
            >
              <span>⚡</span> Run Swarms
            </Link>
          </div>
        </div>
      )}

      {/* Main KPI Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active Projects" value={projects.length} icon="📁" subtitle="All workspace initiatives" />
        <StatCard label="Open Tickets" value={openTickets.length} icon="📌" subtitle={`${tasks.filter(t => t.status === 'done').length} completed`} />
        <StatCard label="Assigned to Me" value={myTickets.length} icon="👤" subtitle="Your active backlog" color="border-indigo-200" />
        <StatCard label="Deployments" value={deployments.length} icon="🚀" subtitle={latestDeploy ? `Last: ${latestDeploy.environment}` : "Staging & Prod"} />
      </div>

      {/* 2-Column Content Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left Column: Tickets Assigned to Me */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <span>📋</span> My Assigned Tickets
            </h2>
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
              {myTickets.length} Total
            </span>
          </div>

          {myTickets.length === 0 ? (
            <div className="py-12 text-center">
              <span className="text-4xl">🎉</span>
              <p className="text-sm font-semibold text-slate-700 mt-2">All caught up!</p>
              <p className="text-xs text-slate-400 mt-0.5">No open tickets assigned to you right now.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {myTickets.slice(0, 6).map((t) => {
                const typeInfo = TASK_TYPE_STYLES[t.task_type || "task"];
                const priorityInfo = PRIORITY_STYLES[t.priority || "medium"];
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 bg-slate-50/60 hover:bg-slate-100/80 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs" title={typeInfo.label}>{typeInfo.icon}</span>
                        <span className="truncate text-sm font-bold text-slate-800">{t.title}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-slate-400 font-medium">{t.project_name || "Project"}</span>
                        {t.due_date && (
                          <span className="text-[10px] text-amber-600 font-medium">📅 Due {t.due_date}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className={priorityInfo.style}>{priorityInfo.label}</Badge>
                      <Badge className="bg-white text-slate-700 border border-slate-200 font-medium">
                        {TASK_STATUS_LABELS[t.status]}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right Column: Active Projects with Progress Bars */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <span>🚀</span> Active Projects Progress
            </h2>
            <Link href="/projects" className="text-xs font-semibold text-indigo-600 hover:underline">
              View All →
            </Link>
          </div>

          {projects.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No projects in this workspace yet.</p>
          ) : (
            <div className="space-y-4">
              {projects.slice(0, 5).map((p) => {
                const progress = p.progress_percentage ?? 0;
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="block rounded-xl border border-slate-100 p-3.5 hover:bg-slate-50/80 transition"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-slate-900 truncate">{p.name}</span>
                      <span className="text-xs font-extrabold text-indigo-600">{progress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
                      <span>{p.task_count} total tickets</span>
                      {p.owner_detail && (
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Avatar name={p.owner_detail.name} email={p.owner_detail.email} size={18} />
                          <span className="text-[11px] font-medium">{p.owner_detail.name}</span>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Real-time Activity Feed / Audit Log (Module 4 Spec) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>⚡</span> Real-Time Activity Feed & Audit Trail
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Live workspace event stream</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedProjectFilter}
              onChange={(e) => setSelectedProjectFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredFeed.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            No recent activity recorded.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredFeed.slice(0, 10).map((act) => (
              <div key={act.id} className="py-3 flex items-start gap-3.5 text-xs">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 font-bold">
                  {act.action === "created" ? "✨" : act.action === "qa_validated" ? "✅" : act.action === "qa_rejected" ? "❌" : "📝"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <strong className="text-slate-900">{act.actor_name}</strong>
                    <span className="text-slate-500">
                      {act.action === "created"
                        ? "created ticket"
                        : act.action === "status_changed"
                        ? "updated status of"
                        : act.action === "qa_validated"
                        ? "validated QA for"
                        : act.action === "qa_rejected"
                        ? "rejected QA on"
                        : act.action === "commented"
                        ? "commented on"
                        : act.action}
                    </span>
                    <Link
                      href={`/projects/${act.project_id}`}
                      className="font-semibold text-indigo-600 hover:underline truncate"
                    >
                      {act.task_title}
                    </Link>
                    <span className="text-slate-400">in {act.project_name}</span>
                  </div>
                  {act.details && "reason" in act.details && (
                    <p className="mt-1 text-rose-600 font-medium bg-rose-50 px-2 py-1 rounded-md">
                      Reason: {String(act.details.reason)}
                    </p>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 shrink-0 whitespace-nowrap">
                  {new Date(act.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
