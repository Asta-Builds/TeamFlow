"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Deployment, Paginated, Project, Task } from "@/lib/types";
import { Avatar, Badge, PRIORITY_STYLES, TASK_STATUS_LABELS } from "@/lib/ui";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-3xl font-semibold text-slate-900 tracking-tight">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<Paginated<Project>>("/projects/"),
      apiFetch<Paginated<Task>>("/tasks/"),
      apiFetch<Paginated<Deployment>>("/deployments/"),
    ])
      .then(([p, t, d]) => {
        setProjects(p.results);
        setTasks(t.results);
        setDeployments(d.results);
      })
      .catch((err) => console.error("Error loading dashboard data", err))
      .finally(() => setLoading(false));
  }, []);

  const openTickets = tasks.filter((t) => t.status !== "done");
  const myTickets = tasks.filter((t) => t.assignee === user?.id);
  const orgStatus = user?.organization_status || "active";

  if (loading) return <div className="text-slate-400 flex h-64 items-center justify-center font-medium">Loading dashboard…</div>;

  return (
    <div className="space-y-6">
      {orgStatus !== "active" && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center justify-between shadow-sm">
          <span>
            ⚠️ Your organization subscription status is <strong>{orgStatus.toUpperCase()}</strong>. Please upgrade or update your payment credentials.
          </span>
          <Link
            href="/billing"
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold transition"
          >
            Manage Billing
          </Link>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">
          Welcome back, {user?.name?.split(" ")[0] || "there"} 👋
        </h1>
        <p className="text-sm text-slate-500">Here is an overview of your workspaces.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active projects" value={projects.length} />
        <StatCard label="Open tickets" value={openTickets.length} />
        <StatCard label="Assigned to me" value={myTickets.length} />
        <StatCard label="Deployments" value={deployments.length} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            Tickets assigned to me
          </h2>
          {myTickets.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">Nothing on your plate. 🎉</p>
          ) : (
            <ul className="space-y-2">
              {myTickets.slice(0, 6).map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 bg-slate-50/50 hover:bg-slate-50 transition"
                >
                  <span className="truncate text-sm font-medium text-slate-700">{t.title}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className={PRIORITY_STYLES[t.priority]}>
                      {t.priority}
                    </Badge>
                    <Badge className="bg-slate-100 text-slate-600 border border-slate-200">
                      {TASK_STATUS_LABELS[t.status]}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            Active projects
          </h2>
          {projects.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">No projects yet.</p>
          ) : (
            <ul className="space-y-2">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50 transition"
                  >
                    <span className="truncate text-sm font-medium text-slate-800">{p.name}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.owner_detail && (
                        <Avatar
                          name={p.owner_detail.name}
                          email={p.owner_detail.email}
                          size={22}
                        />
                      )}
                      <Badge className="bg-indigo-50 text-indigo-700 border border-indigo-200/50">
                        {p.task_count} tickets
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
