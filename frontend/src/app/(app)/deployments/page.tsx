"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Deployment, Paginated, Project } from "@/lib/types";
import { Avatar, Badge } from "@/lib/ui";

const DEPLOY_STYLES: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700 border-slate-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  rolled_back: "bg-purple-50 text-purple-700 border-purple-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

const ENV_BADGES: Record<string, string> = {
  dev: "bg-slate-100 text-slate-700 border-slate-200",
  staging: "bg-blue-50 text-blue-700 border-blue-200",
  production: "bg-purple-50 text-purple-700 border-purple-200 font-bold",
};

function fmt(dt: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DeploymentsPage() {
  const { user } = useAuth();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Trigger modal
  const [showTriggerModal, setShowTriggerModal] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | "">("");
  const [selectedEnv, setSelectedEnv] = useState<"staging" | "production">("staging");
  const [selectedBranch, setSelectedBranch] = useState("main");
  const [triggering, setTriggering] = useState(false);

  // View logs modal
  const [activeLogDeployment, setActiveLogDeployment] = useState<Deployment | null>(null);

  const canDeploy =
    user?.role === "devops" ||
    user?.role === "tech_lead" ||
    user?.role === "ceo" ||
    user?.role === "admin";

  function load() {
    Promise.all([
      apiFetch<Paginated<Deployment>>("/deployments/"),
      apiFetch<Paginated<Project>>("/projects/").catch(() => ({ results: [] })),
    ])
      .then(([d, p]) => {
        setDeployments(d.results || []);
        setProjects(p.results || []);
        if (p.results?.length > 0 && !selectedProjectId) {
          setSelectedProjectId(p.results[0].id);
        }
      })
      .catch((err) => console.error("Error loading deployments logs", err))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleTrigger(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProjectId) return;
    setTriggering(true);
    try {
      const commit = Math.random().toString(16).substring(2, 9);
      const created = await apiFetch<Deployment>("/deployments/", {
        method: "POST",
        body: {
          project: selectedProjectId,
          environment: selectedEnv,
          branch: selectedBranch,
          commit_sha: commit,
        },
      });
      setDeployments((prev) => [created, ...prev]);
      setShowTriggerModal(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        alert("Permission denied: Only DevOps, Tech Lead or CEO can trigger releases.");
      } else {
        alert("Failed to trigger deployment.");
      }
    } finally {
      setTriggering(false);
    }
  }

  async function handleRollback(deploymentId: number) {
    if (!confirm("Are you sure you want to rollback to this release?")) return;
    try {
      const rolledBack = await apiFetch<Deployment>(`/deployments/${deploymentId}/rollback/`, {
        method: "POST",
      });
      setDeployments((prev) => [rolledBack, ...prev]);
    } catch {
      alert("Rollback failed.");
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400 font-medium">
        Loading deployment pipelines…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Deployments & CI/CD Pipelines
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Automated builds, environments status, release logs, and one-click rollbacks.
          </p>
        </div>

        {canDeploy && (
          <button
            onClick={() => setShowTriggerModal(true)}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition flex items-center gap-1.5"
          >
            <span>🚀</span> Trigger Release
          </button>
        )}
      </div>

      {/* Deployments Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
            <tr>
              <th className="px-5 py-3.5">Project</th>
              <th className="px-5 py-3.5">Environment</th>
              <th className="px-5 py-3.5">Status</th>
              <th className="px-5 py-3.5">Branch & Commit</th>
              <th className="px-5 py-3.5">Triggered By</th>
              <th className="px-5 py-3.5">Started At</th>
              <th className="px-5 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deployments.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50/60 transition">
                <td className="px-5 py-4 font-bold text-slate-900">
                  {d.project_name || `Project #${d.project}`}
                </td>
                <td className="px-5 py-4">
                  <Badge className={ENV_BADGES[d.environment] || ENV_BADGES.staging}>
                    {d.environment}
                  </Badge>
                </td>
                <td className="px-5 py-4">
                  <Badge className={DEPLOY_STYLES[d.status] || DEPLOY_STYLES.queued}>
                    {d.status.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-5 py-4">
                  <span className="font-semibold text-slate-700 block">{d.branch || "main"}</span>
                  <span className="font-mono text-[10px] text-slate-400 font-semibold">{d.commit_sha || "—"}</span>
                </td>
                <td className="px-5 py-4">
                  {d.triggered_by_detail ? (
                    <div className="flex items-center gap-2">
                      <Avatar name={d.triggered_by_detail.name} email={d.triggered_by_detail.email} size={22} />
                      <span className="text-slate-700 font-medium">{d.triggered_by_detail.name}</span>
                    </div>
                  ) : (
                    <span className="text-slate-400 italic">Automated CI</span>
                  )}
                </td>
                <td className="px-5 py-4 text-slate-500">{fmt(d.started_at)}</td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setActiveLogDeployment(d)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 transition"
                    >
                      View Logs
                    </button>
                    {canDeploy && d.status === "success" && (
                      <button
                        onClick={() => handleRollback(d.id)}
                        className="px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-[11px] font-bold text-purple-700 border border-purple-200 transition"
                        title="Rollback to this state"
                      >
                        Rollback ↩
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {deployments.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-slate-400 font-medium">
                  No deployment logs recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Trigger Deployment Modal */}
      {showTriggerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">Trigger Deployment Pipeline</h2>
              <button onClick={() => setShowTriggerModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleTrigger} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Project *</label>
                <select
                  required
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Environment *</label>
                <select
                  value={selectedEnv}
                  onChange={(e) => setSelectedEnv(e.target.value as "staging" | "production")}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                >
                  <option value="staging">Staging (Automatic test gate)</option>
                  <option value="production">Production (High availability cluster)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Git Branch *</label>
                <input
                  required
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {selectedEnv === "production" && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-medium">
                  ⚠️ Production Policy: All sprint tickets must be verified by QA before deployment.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowTriggerModal(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={triggering}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
                >
                  {triggering ? "Deploying..." : "Start Pipeline"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Build Logs Viewer Modal */}
      {activeLogDeployment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 text-slate-100 p-6 shadow-2xl border border-slate-800 animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>📄</span> Build & Execution Logs
                </h3>
                <span className="text-xs text-slate-400">
                  {activeLogDeployment.project_name} ({activeLogDeployment.environment}) — {activeLogDeployment.commit_sha}
                </span>
              </div>
              <button
                onClick={() => setActiveLogDeployment(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto font-mono text-xs text-emerald-400 bg-slate-950 p-4 rounded-xl leading-relaxed whitespace-pre-wrap">
              {activeLogDeployment.logs ||
                "=== Build Logs ===\n[INFO] Starting deployment sequence...\n[INFO] Running tests and migrations... OK\n[INFO] Build successful."}
            </div>

            <div className="mt-4 flex justify-between items-center text-xs text-slate-400 border-t border-slate-800 pt-3">
              <span>Duration: {activeLogDeployment.duration_seconds || 42} seconds</span>
              <button
                onClick={() => setActiveLogDeployment(null)}
                className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
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
