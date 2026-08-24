"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paginated, Project, ProjectStatus } from "@/lib/types";
import { Avatar, Badge } from "@/lib/ui";

const STATUS_STYLES: Record<ProjectStatus, string> = {
  active: "bg-emerald-950/70 text-emerald-300 border-emerald-800/50",
  on_hold: "bg-amber-950/70 text-amber-300 border-amber-800/50",
  completed: "bg-indigo-950/70 text-indigo-300 border-indigo-800/50",
  archived: "bg-slate-900 text-slate-400 border-slate-800",
};

export default function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [error, setError] = useState<string | null>(null);

  const canCreate =
    user?.role === "ceo" ||
    user?.role === "tech_lead" ||
    user?.role === "admin";

  function load() {
    apiFetch<Paginated<Project>>("/projects/")
      .then((d) => setProjects(d.results || []))
      .catch((err) => console.error("Error loading projects", err))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await apiFetch<Project>("/projects/", {
        method: "POST",
        body: { name, description, status },
      });
      setProjects((prev) => [created, ...prev]);
      setName("");
      setDescription("");
      setCreating(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only CEO, Tech Lead or Admin can create projects.");
      } else {
        setError("Could not create project.");
      }
    }
  }

  const filteredProjects = statusFilter
    ? projects.filter((p) => p.status === statusFilter)
    : projects;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* SuperDesign Projects Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Projects Portfolio
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Track initiatives, sprint deliverables, and team task boards.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                viewMode === "grid" ? "bg-slate-800 text-white shadow-xs" : "text-slate-400 hover:text-white"
              }`}
            >
              ▦ Grid
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                viewMode === "table" ? "bg-slate-800 text-white shadow-xs" : "text-slate-400 hover:text-white"
              }`}
            >
              ☰ Table
            </button>
          </div>

          {canCreate && (
            <button
              onClick={() => setCreating((c) => !c)}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 transition cursor-pointer"
            >
              {creating ? "Cancel" : "+ New Project"}
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 focus:outline-none focus:border-indigo-500 shadow-xs"
        >
          <option value="">All Project Statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
        <span className="text-xs text-slate-500 font-medium">
          Showing {filteredProjects.length} of {projects.length} projects
        </span>
      </div>

      {/* Create Project Form Modal */}
      {creating && (
        <form
          onSubmit={createProject}
          className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl animate-in fade-in duration-150"
        >
          <h3 className="font-bold text-white text-sm">Create New Project</h3>
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Project Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Next-Gen Mobile App"
              required
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Goals, target deliverables, tech scope..."
              rows={2}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          {error && <p className="text-xs font-semibold text-rose-400">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 cursor-pointer"
            >
              Create Project
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center text-slate-500 font-semibold text-xs tracking-wider uppercase">
          Loading projects…
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center text-slate-500 bg-slate-900/50">
          <span className="text-3xl block mb-2">📂</span>
          No projects matching your criteria.
        </div>
      ) : viewMode === "grid" ? (
        /* Grid Mode */
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((p) => {
            const progress = p.progress_percentage ?? 0;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm transition hover:border-slate-700 hover:-translate-y-0.5 flex flex-col justify-between"
              >
                <div>
                  <div className="mb-2.5 flex items-start justify-between gap-2">
                    <h3 className="font-bold text-white tracking-tight text-base hover:text-indigo-400 transition">
                      {p.name}
                    </h3>
                    <Badge className={STATUS_STYLES[p.status] || STATUS_STYLES.active}>
                      {p.status}
                    </Badge>
                  </div>
                  <p className="mb-4 line-clamp-2 text-xs text-slate-400 leading-relaxed">
                    {p.description || "No description provided."}
                  </p>
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-800/80">
                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-1">
                      <span>Progress</span>
                      <span className="text-indigo-400">{progress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-950">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <div className="flex items-center gap-1.5">
                      {p.owner_detail && (
                        <>
                          <Avatar name={p.owner_detail.name} email={p.owner_detail.email} size={20} />
                          <span className="text-[11px] font-semibold text-slate-300">
                            {p.owner_detail.name.split(" ")[0]}
                          </span>
                        </>
                      )}
                    </div>
                    <Badge className="bg-indigo-950 text-indigo-300 border-indigo-800/50 font-semibold">
                      {p.task_count ?? 0} tickets
                    </Badge>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        /* Table Mode */
        <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-extrabold text-[10px] tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Project Name</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Progress</th>
                <th className="px-5 py-3.5">Owner</th>
                <th className="px-5 py-3.5 text-right">Tickets</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredProjects.map((p) => {
                const progress = p.progress_percentage ?? 0;
                return (
                  <tr key={p.id} className="hover:bg-slate-800/50 transition">
                    <td className="px-5 py-4">
                      <Link href={`/projects/${p.id}`} className="font-bold text-white hover:text-indigo-400">
                        {p.name}
                      </Link>
                      <p className="text-slate-500 text-[11px] truncate max-w-xs">{p.description}</p>
                    </td>
                    <td className="px-5 py-4">
                      <Badge className={STATUS_STYLES[p.status]}>{p.status}</Badge>
                    </td>
                    <td className="px-5 py-4 w-48">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-950">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${progress}%` }}></div>
                        </div>
                        <span className="font-bold text-indigo-400 text-[11px] w-8 text-right">{progress}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {p.owner_detail ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={p.owner_detail.name} email={p.owner_detail.email} size={22} />
                          <span className="font-medium text-slate-300">{p.owner_detail.name}</span>
                        </div>
                      ) : (
                        <span className="text-slate-600 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-slate-300">
                      {p.task_count ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
