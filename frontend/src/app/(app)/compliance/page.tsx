"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paginated, Project, SEOAudit } from "@/lib/types";
import { Badge } from "@/lib/ui";

const SEVERITY_BADGES: Record<string, string> = {
  critical: "bg-rose-100 text-rose-800 border-rose-200 font-bold",
  high: "bg-orange-100 text-orange-800 border-orange-200 font-bold",
  medium: "bg-amber-100 text-amber-800 border-amber-200 font-semibold",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function CompliancePage() {
  const { user } = useAuth();
  const [audits, setAudits] = useState<SEOAudit[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState("https://teamflow.dev");
  const [selectedAuditForTask, setSelectedAuditForTask] = useState<{ auditId: number; issueIdx: number } | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<number | "">("");

  const canAudit =
    user?.role === "seo" ||
    user?.role === "tech_lead" ||
    user?.role === "ceo" ||
    user?.role === "admin";

  function load() {
    Promise.all([
      apiFetch<Paginated<SEOAudit>>("/seo/audits/"),
      apiFetch<Paginated<Project>>("/projects/").catch(() => ({ results: [] })),
    ])
      .then(([a, p]) => {
        setAudits(a.results || []);
        setProjects(p.results || []);
        if (p.results?.length > 0 && !targetProjectId) {
          setTargetProjectId(p.results[0].id);
        }
      })
      .catch((err) => console.error("Error loading SEO audits", err))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const handleRunAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setRunning(true);
    try {
      const created = await apiFetch<SEOAudit>("/seo/audits/", {
        method: "POST",
        body: { url },
      });
      setAudits((prev) => [created, ...prev]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        alert("Only SEO Specialist, Tech Lead or CEO can run audits.");
      } else {
        alert("Failed to run SEO audit.");
      }
    } finally {
      setRunning(false);
    }
  };

  const handleCreateTaskFromIssue = async () => {
    if (!selectedAuditForTask || !targetProjectId) return;
    try {
      await apiFetch(`/seo/audits/${selectedAuditForTask.auditId}/create_task/`, {
        method: "POST",
        body: {
          project_id: targetProjectId,
          issue_index: selectedAuditForTask.issueIdx,
        },
      });
      alert("✓ Successfully created ticket from SEO issue!");
      setSelectedAuditForTask(null);
    } catch {
      alert("Error creating ticket from SEO issue.");
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400 font-medium">
        Loading SEO audits…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Technical SEO & Performance Audits
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Crawl metadata, check Core Web Vitals, and generate automated fix tickets.
          </p>
        </div>

        {canAudit && (
          <form onSubmit={handleRunAudit} className="flex gap-2 w-full md:w-auto">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourwebsite.com"
              className="rounded-xl border border-slate-300 px-3.5 py-2 text-xs bg-white text-slate-900 focus:border-indigo-500 focus:outline-none flex-1 md:w-64"
            />
            <button
              type="submit"
              disabled={running}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 transition shrink-0"
            >
              {running ? "Auditing..." : "⚡ Run Audit"}
            </button>
          </form>
        )}
      </div>

      {/* Audits Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {audits.map((a) => (
          <div
            key={a.id}
            className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5 hover:shadow-md transition"
          >
            {/* Top score banner */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-slate-900 hover:text-indigo-600 transition text-base block truncate max-w-xs"
                >
                  {a.url} ↗
                </a>
                <span className="text-xs text-slate-400 font-medium mt-0.5 block">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-xl">
                <span
                  className={`text-2xl font-black ${
                    a.score >= 90
                      ? "text-emerald-600"
                      : a.score >= 70
                      ? "text-amber-500"
                      : "text-rose-600"
                  }`}
                >
                  {a.score}
                </span>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-tight">
                  Health<br />Score
                </div>
              </div>
            </div>

            {/* Subscores */}
            <div className="grid grid-cols-3 gap-3 text-center bg-slate-50/80 p-3 rounded-xl border border-slate-100">
              <div>
                <div className="text-sm font-extrabold text-indigo-600">{a.performance_score ?? 94}</div>
                <div className="text-[10px] text-slate-500 font-bold uppercase">Performance</div>
              </div>
              <div>
                <div className="text-sm font-extrabold text-teal-600">{a.seo_score ?? 92}</div>
                <div className="text-[10px] text-slate-500 font-bold uppercase">SEO Tags</div>
              </div>
              <div>
                <div className="text-sm font-extrabold text-purple-600">{a.mobile_score ?? 95}</div>
                <div className="text-[10px] text-slate-500 font-bold uppercase">Mobile Speed</div>
              </div>
            </div>

            {/* Issues and Findings */}
            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">
                Audit Recommendations ({a.issues?.length || 0})
              </h4>
              {(!a.issues || a.issues.length === 0) ? (
                <p className="text-xs text-emerald-600 font-bold py-2">
                  🟢 Page passed all technical SEO and metadata standards!
                </p>
              ) : (
                <div className="space-y-2.5">
                  {a.issues.map((issue, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs flex flex-col justify-between gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-slate-800 leading-snug">
                          {issue.message}
                        </span>
                        <Badge className={SEVERITY_BADGES[issue.severity] || SEVERITY_BADGES.medium}>
                          {issue.severity}
                        </Badge>
                      </div>

                      {issue.recommendation && (
                        <p className="text-[11px] text-slate-500 bg-white p-2 rounded-lg border border-slate-100">
                          💡 <strong>Fix:</strong> {issue.recommendation}
                        </p>
                      )}

                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => setSelectedAuditForTask({ auditId: a.id, issueIdx: idx })}
                          className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                        >
                          + Create Fix Ticket →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {audits.length === 0 && (
          <div className="col-span-2 rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400 font-medium bg-white">
            <span className="text-3xl block mb-2">🔍</span>
            No technical SEO audits recorded yet. Run your first crawl above.
          </div>
        )}
      </div>

      {/* Convert Issue to Ticket Modal */}
      {selectedAuditForTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-1">Create SEO Task</h3>
            <p className="text-xs text-slate-500 mb-4">
              Select which project board to assign this fix ticket to.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Project</label>
                <select
                  value={targetProjectId}
                  onChange={(e) => setTargetProjectId(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedAuditForTask(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateTaskFromIssue}
                  className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700"
                >
                  Add to Board
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
