"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paginated } from "@/lib/types";

interface AuditRecord {
  id: number;
  url: string;
  score: number;
  issues: { severity: string; message: string }[];
  created_at: string;
}

export default function CompliancePage() {
  const { user } = useAuth();
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState("https://teamflow.dev");
  const [error, setError] = useState<string | null>(null);

  const isPrivileged = user?.role === "admin";
  const tier = user?.organization_tier || "starter";

  function load() {
    apiFetch<Paginated<AuditRecord>>("/seo/audits/")
      .then((d) => setAudits(d.results))
      .catch((err) => console.error("Error loading SEO audits", err))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const handleRunAudit = async () => {
    if (tier !== "enterprise") {
      alert("❌ Technical SEO Audits require an active Enterprise subscription plan. Please upgrade your plan in the Billing portal.");
      return;
    }

    if (!url.trim()) return;

    setRunning(true);
    setError(null);
    try {
      const created = await apiFetch<AuditRecord>("/seo/audits/", {
        method: "POST",
        body: { url },
      });
      setAudits((prev) => [created, ...prev]);
    } catch (err: any) {
      setError(err.message || "Failed to run SEO audit.");
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div className="text-slate-400 flex h-64 items-center justify-center font-medium">Loading SEO audits…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">SEO Audits</h1>
          <p className="text-sm text-slate-500 mt-1">Audit landing pages, crawl metadata, and check technical SEO standards.</p>
        </div>
        {isPrivileged && (
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourwebsite.com"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500 w-64"
            />
            <button
              onClick={handleRunAudit}
              disabled={running}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 shadow-sm transition disabled:opacity-50 whitespace-nowrap"
            >
              {running ? "Crawling..." : "Run SEO Audit"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {tier !== "enterprise" && (
        <div className="bg-gradient-to-r from-indigo-700 to-violet-850 rounded-xl p-6 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-lg">Unlock Enterprise SEO Audits</h3>
            <p className="text-indigo-100 text-xs mt-1 max-w-xl">
              Automatic SEO audits crawl your production deployment links to verify HTTPS, title length, meta description, and image alt properties. Upgrade to Enterprise to start crawling.
            </p>
          </div>
          <Link
            href="/billing"
            className="px-4 py-2 bg-white text-indigo-700 rounded-lg text-sm font-bold shadow-sm hover:bg-indigo-50 transition text-center"
          >
            Upgrade Plan
          </Link>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {audits.map((a) => (
          <div key={a.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-800 truncate max-w-xs">{a.url}</h3>
                <span className="text-[11px] text-slate-400 font-semibold">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className={`text-2xl font-extrabold ${a.score >= 90 ? "text-emerald-600" : "text-amber-500"}`}>
                  {a.score}
                </span>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Score</span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Findings ({a.issues.length})</h4>
              {a.issues.length === 0 ? (
                <p className="text-xs text-emerald-600 font-semibold py-1">🟢 Page passes all SEO audit checks.</p>
              ) : (
                <ul className="space-y-2">
                  {a.issues.map((issue, idx) => (
                    <li key={idx} className="text-xs p-2.5 bg-slate-50 border border-slate-100 rounded-lg flex items-start gap-2">
                      <span className={`font-bold shrink-0 uppercase tracking-wider text-[8px] px-1 rounded-sm border ${
                        issue.severity === "high"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}>
                        {issue.severity}
                      </span>
                      <span className="text-slate-600 font-medium leading-relaxed">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {audits.length === 0 && (
          <div className="col-span-2 rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400 font-medium bg-white">
            No SEO audits recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}
