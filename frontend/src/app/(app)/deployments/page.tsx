"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Deployment, Paginated } from "@/lib/types";
import { Avatar, Badge } from "@/lib/ui";

const DEPLOY_STYLES: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600 border border-slate-200",
  in_progress: "bg-amber-100 text-amber-700 border border-amber-200/50",
  success: "bg-green-100 text-green-700 border border-green-200/50",
  failed: "bg-red-100 text-red-700 border border-red-200/50",
  rolled_back: "bg-purple-100 text-purple-700 border border-purple-200/50",
};

const ENV_LABELS: Record<string, string> = {
  dev: "Development",
  staging: "Staging",
  production: "Production",
};

function fmt(dt: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString();
}

export default function DeploymentsPage() {
  const { user } = useAuth();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPrivileged = user?.role === "admin";
  const tier = user?.organization_tier || "starter";

  function load() {
    apiFetch<Paginated<Deployment>>("/deployments/")
      .then((d) => setDeployments(d.results))
      .catch((err) => console.error("Error loading deployments logs", err))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const handleTriggerDeploy = async () => {
    if (tier === "starter") {
      alert("❌ Production Deployment triggers are only available on Growth or Enterprise plans. Please upgrade your subscription.");
      return;
    }

    setTriggering(true);
    setError(null);
    try {
      const commit = Math.random().toString(16).substring(3, 10);
      const created = await apiFetch<Deployment>("/deployments/", {
        method: "POST",
        body: {
          environment: "production",
          commit_sha: commit,
          project: deployments[0]?.project || 1 // Fallback project reference
        },
      });
      setDeployments((prev) => [created, ...prev]);
      
      // Simulate deployment completion
      setTimeout(async () => {
        const updated = await apiFetch<Deployment>(`/deployments/${created.id}/`);
        setDeployments((prev) => prev.map((item) => item.id === created.id ? updated : item));
      }, 2000);
    } catch (err: any) {
      setError(err.message || "Failed to trigger deployment.");
    } finally {
      setTriggering(false);
    }
  };

  if (loading) return <div className="text-slate-400 flex h-64 items-center justify-center font-medium">Loading deployments…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Deployments</h1>
          <p className="text-sm text-slate-500 mt-1">Monitor release logs and deploy active commits to staging and production.</p>
        </div>
        {isPrivileged && (
          <button
            onClick={handleTriggerDeploy}
            disabled={triggering}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 shadow-sm transition disabled:opacity-50"
          >
            {triggering ? "Deploying..." : "Trigger Deployment"}
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/75 text-xs uppercase font-bold text-slate-400">
            <tr>
              <th className="px-4 py-3">Environment</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Commit</th>
              <th className="px-4 py-3">Triggered by</th>
              <th className="px-4 py-3">Date Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deployments.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50/50 transition">
                <td className="px-4 py-3 font-semibold text-slate-800">
                  {ENV_LABELS[d.environment] || d.environment}
                </td>
                <td className="px-4 py-3">
                  <Badge className={DEPLOY_STYLES[d.status] || DEPLOY_STYLES.queued}>
                    {d.status.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500 font-semibold">
                  {d.commit_sha || "—"}
                </td>
                <td className="px-4 py-3">
                  {d.triggered_by_detail ? (
                    <span className="flex items-center gap-2 text-slate-600 font-semibold text-xs">
                      <Avatar
                        name={d.triggered_by_detail.name}
                        email={d.triggered_by_detail.email}
                        size={22}
                      />
                      {d.triggered_by_detail.name}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{fmt(d.started_at)}</td>
              </tr>
            ))}
            {deployments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400 font-medium">
                  No deployment logs recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
