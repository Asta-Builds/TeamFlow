"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paginated, Project } from "@/lib/types";
import { Avatar, Badge } from "@/lib/ui";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-50 text-green-700 border border-green-200/60",
  on_hold: "bg-amber-50 text-amber-700 border border-amber-200/60",
  completed: "bg-indigo-50 text-indigo-700 border border-indigo-200/60",
  archived: "bg-slate-100 text-slate-500 border border-slate-200/60",
};

export default function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isPrivileged = user?.role === "admin";
  const tier = user?.organization_tier || "starter";

  function load() {
    apiFetch<Paginated<Project>>("/projects/")
      .then((d) => setProjects(d.results))
      .catch((err) => console.error("Error loading projects", err))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // SaaS Plan Restrictions Check
    if (tier === "starter" && projects.length >= 3) {
      setError("❌ Project limit reached. Free workspaces are limited to 3 projects. Please upgrade your plan in Billing.");
      return;
    }
    if (tier === "growth" && projects.length >= 20) {
      setError("❌ Project limit reached. Growth workspaces are limited to 20 projects. Please upgrade to Enterprise.");
      return;
    }

    try {
      const created = await apiFetch<Project>("/projects/", {
        method: "POST",
        body: { name, description, status: "active" },
      });
      setProjects((prev) => [created, ...prev]);
      setName("");
      setDescription("");
      setCreating(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only Admin/Managers can create projects.");
      } else {
        setError("Could not create project.");
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Projects</h1>
          <p className="text-sm text-slate-500 mt-1">Manage workspaces, tasks, and development boards.</p>
        </div>
        {isPrivileged && (
          <button
            onClick={() => setCreating((c) => !c)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 shadow-sm transition"
          >
            {creating ? "Cancel" : "New Project"}
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={createProject}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h3 className="font-bold text-slate-800 text-sm">Add New Project</h3>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description..."
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
          >
            Create Project
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center text-slate-400 font-medium">
          Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
          No projects yet. Create your first one to begin.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-slate-300 flex flex-col justify-between"
            >
              <div>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-bold text-slate-800 tracking-tight text-base hover:text-indigo-600 transition">{p.name}</h3>
                  <Badge className={STATUS_STYLES[p.status] || STATUS_STYLES.active}>{p.status}</Badge>
                </div>
                <p className="mb-4 line-clamp-2 text-sm text-slate-500">
                  {p.description || "No description."}
                </p>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <div className="flex items-center gap-2">
                  {p.owner_detail && (
                    <Avatar
                      name={p.owner_detail.name}
                      email={p.owner_detail.email}
                      size={24}
                    />
                  )}
                  <span className="text-xs text-slate-500 font-medium">
                    {p.owner_detail?.name || "Unassigned"}
                  </span>
                </div>
                <Badge className="bg-indigo-50 text-indigo-700 border border-indigo-200/50">
                  {p.task_count ?? 0} tickets
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
