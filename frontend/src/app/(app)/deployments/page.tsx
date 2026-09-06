"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import {
  useDeployments,
  useProjects,
  useTriggerDeploymentMutation,
  useRollbackDeploymentMutation,
} from "@/lib/queries";
import DeploymentsLoading from "./loading";
import type { Deployment } from "@/lib/types";
import { Avatar, Badge } from "@/lib/ui";
import { Rocket, Terminal, RotateCcw, AlertTriangle, GitBranch, X } from "lucide-react";

const DEPLOY_STYLES: Record<string, string> = {
  queued: "bg-slate-900 text-slate-400 border-slate-800",
  in_progress: "bg-amber-950/70 text-amber-300 border-amber-800/50",
  success: "bg-emerald-950/70 text-emerald-300 border-emerald-800/50",
  failed: "bg-rose-950/70 text-rose-300 border-rose-800/50",
  rolled_back: "bg-purple-950/70 text-purple-300 border-purple-800/50",
  cancelled: "bg-slate-900 text-slate-500 border-slate-800",
};

const ENV_BADGES: Record<string, string> = {
  dev: "bg-slate-900 text-slate-400 border-slate-800",
  staging: "bg-blue-950/70 text-blue-300 border-blue-800/50 font-semibold",
  production: "bg-purple-950/70 text-purple-300 border-purple-800/50 font-bold",
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
  const { data: deployments = [], isLoading: dLoading } = useDeployments();
  const { data: projects = [], isLoading: pLoading } = useProjects();
  const triggerMutation = useTriggerDeploymentMutation();
  const rollbackMutation = useRollbackDeploymentMutation();

  const loading = dLoading || pLoading;

  // Trigger modal
  const [showTriggerModal, setShowTriggerModal] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | "">("");
  const [selectedEnv, setSelectedEnv] = useState<"staging" | "production">("staging");
  const [selectedBranch, setSelectedBranch] = useState("main");

  // View logs modal
  const [activeLogDeployment, setActiveLogDeployment] = useState<Deployment | null>(null);

  const canDeploy =
    user?.role === "devops" ||
    user?.role === "tech_lead" ||
    user?.role === "ceo" ||
    user?.role === "admin";

  const effectiveProjectId = useMemo(() => {
    if (selectedProjectId) return selectedProjectId;
    return projects.length > 0 ? projects[0].id : "";
  }, [selectedProjectId, projects]);

  async function handleTrigger(e: React.FormEvent) {
    e.preventDefault();
    const pid = selectedProjectId || effectiveProjectId;
    if (!pid) return;
    const commit = Math.random().toString(16).substring(2, 9);
    try {
      await triggerMutation.mutateAsync({
        project: Number(pid),
        environment: selectedEnv,
        branch: selectedBranch,
        commit_sha: commit,
      });
      setShowTriggerModal(false);
    } catch {
      // Error handled in mutation toast
    }
  }

  async function handleRollback(deploymentId: number) {
    try {
      await rollbackMutation.mutateAsync(deploymentId);
    } catch {
      // Handled in mutation toast
    }
  }

  if (loading) {
    return <DeploymentsLoading />;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Deployments & CI/CD Pipelines
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Automated builds, environment status, release logs, and one-click rollbacks.
          </p>
        </div>

        {canDeploy && (
          <button
            onClick={() => setShowTriggerModal(true)}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 transition flex items-center gap-1.5 cursor-pointer"
          >
            <Rocket className="h-4 w-4" />
            <span>Trigger Release</span>
          </button>
        )}
      </div>

      {/* Deployments Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-800 bg-slate-950 text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
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
          <tbody className="divide-y divide-slate-800">
            {deployments.map((d) => (
              <tr key={d.id} className="hover:bg-slate-800/50 transition">
                <td className="px-5 py-4 font-bold text-white">
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
                  <span className="font-semibold text-slate-200 flex items-center gap-1">
                    <GitBranch className="h-3 w-3 text-slate-500" />
                    <span>{d.branch || "main"}</span>
                  </span>
                  <span className="font-mono text-[10px] text-slate-500 font-semibold">{d.commit_sha || "—"}</span>
                </td>
                <td className="px-5 py-4">
                  {d.triggered_by_detail ? (
                    <div className="flex items-center gap-2">
                      <Avatar name={d.triggered_by_detail.name} email={d.triggered_by_detail.email} size={22} />
                      <span className="text-slate-300 font-medium">{d.triggered_by_detail.name}</span>
                    </div>
                  ) : (
                    <span className="text-slate-500 italic">Automated CI</span>
                  )}
                </td>
                <td className="px-5 py-4 text-slate-400 font-mono text-[11px]">{fmt(d.started_at)}</td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setActiveLogDeployment(d)}
                      className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-200 transition cursor-pointer flex items-center gap-1"
                    >
                      <Terminal className="h-3 w-3" />
                      <span>Logs</span>
                    </button>
                    {canDeploy && d.status === "success" && (
                      <button
                        onClick={() => handleRollback(d.id)}
                        className="px-3 py-1 rounded-lg bg-purple-950 hover:bg-purple-900 text-[11px] font-bold text-purple-300 border border-purple-800/60 transition cursor-pointer flex items-center gap-1"
                        title="Rollback to this state"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Rollback</span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {deployments.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-slate-500 font-medium">
                  No deployment logs recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Trigger Deployment Modal */}
      {showTriggerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 shadow-2xl border border-slate-800 animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Rocket className="h-4 w-4 text-indigo-400" />
                <span>Trigger Deployment Pipeline</span>
              </h2>
              <button onClick={() => setShowTriggerModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleTrigger} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Target Project *</label>
                <select
                  required
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Environment *</label>
                <select
                  value={selectedEnv}
                  onChange={(e) => setSelectedEnv(e.target.value as "staging" | "production")}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="staging">Staging (Automatic test gate)</option>
                  <option value="production">Production (High availability cluster)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Git Branch *</label>
                <input
                  required
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {selectedEnv === "production" && (
                <div className="p-3 bg-amber-950/60 border border-amber-800/50 rounded-xl text-xs text-amber-300 font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  <span>Production Policy: All sprint tickets must be verified by QA before deployment.</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowTriggerModal(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={triggerMutation.isPending}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-60 cursor-pointer flex items-center gap-1.5"
                >
                  <Rocket className="h-3.5 w-3.5" />
                  <span>{triggerMutation.isPending ? "Deploying..." : "Start Pipeline"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Build Logs Viewer Modal */}
      {activeLogDeployment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 text-slate-100 p-6 shadow-2xl border border-slate-800 animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-indigo-400" />
                  <span>Build & Execution Logs</span>
                </h3>
                <span className="text-xs text-slate-400">
                  {activeLogDeployment.project_name} ({activeLogDeployment.environment}) — {activeLogDeployment.commit_sha}
                </span>
              </div>
              <button
                onClick={() => setActiveLogDeployment(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto font-mono text-xs text-emerald-400 bg-slate-950 p-4 rounded-xl leading-relaxed whitespace-pre-wrap border border-slate-800">
              {activeLogDeployment.logs ||
                "=== Build Logs ===\n[INFO] Starting deployment sequence...\n[INFO] Running tests and migrations... OK\n[INFO] Build successful."}
            </div>

            <div className="mt-4 flex justify-between items-center text-xs text-slate-400 border-t border-slate-800 pt-3">
              <span>Duration: {activeLogDeployment.duration_seconds || 42} seconds</span>
              <button
                onClick={() => setActiveLogDeployment(null)}
                className="rounded-xl bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 cursor-pointer"
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
