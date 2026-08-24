"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { createCheckoutSession, createPortalSession, mockConfirmSubscription } from "@/lib/api";

export default function BillingPage() {
  const { user, refreshUser } = useAuth();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentTier = user?.organization_tier || "growth";
  const currentStatus = user?.organization_status || "active";

  const handleSubscribe = async (tier: string) => {
    setLoadingTier(tier);
    setError(null);
    try {
      const session = await createCheckoutSession(
        tier,
        window.location.origin + "/billing?success=true",
        window.location.origin + "/billing?canceled=true"
      );

      if (session.mock) {
        await mockConfirmSubscription(tier);
        await refreshUser();
        alert(`Successfully upgraded to ${tier.toUpperCase()} plan (Developer Mock Mode).`);
      } else {
        window.location.href = session.url;
      }
    } catch (err: any) {
      setError(err.message || "Failed to initiate subscription.");
    } finally {
      setLoadingTier(null);
    }
  };

  const handleManagePortal = async () => {
    setLoadingTier("portal");
    setError(null);
    try {
      const session = await createPortalSession(window.location.href);
      if (session.mock) {
        alert("Redirecting to Mock Customer Portal (Stripe keys not set).");
      } else {
        window.location.href = session.url;
      }
    } catch (err: any) {
      setError(err.message || "Failed to load customer portal.");
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-6">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
          Billing & Subscription Plans
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage workspace quotas, autonomous agent seats, and Stripe billing information.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/50 text-xs font-semibold text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {/* Current Plan Overview Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-400">Current Workspace Plan</div>
            <div className="text-xl font-black text-white mt-1 flex items-center gap-2">
              <span className="capitalize">{currentTier} Tier</span>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border bg-emerald-950 text-emerald-400 border-emerald-800/50">
                {currentStatus}
              </span>
            </div>
            <p className="text-slate-400 text-xs mt-2 max-w-xl leading-relaxed">
              {currentTier === "starter" && "Your workspace is on the starter tier with basic quotas. Upgrade to unlock all 9 specialist agent seats, pgvector RAG, and production pipelines."}
              {currentTier === "growth" && "Your workspace has unlocked all 9 specialist agent seats, pgvector RAG store, and production rollbacks."}
              {currentTier === "enterprise" && "Your workspace has dedicated Keycloak SSO, unlimited Langfuse traces, and custom SLA support."}
            </p>
          </div>
          {currentTier !== "starter" && (
            <button
              onClick={handleManagePortal}
              disabled={loadingTier !== null}
              className="px-4 py-2 border border-slate-700 bg-slate-800 rounded-xl text-xs font-bold text-white hover:bg-slate-700 transition disabled:opacity-50 cursor-pointer shrink-0"
            >
              {loadingTier === "portal" ? "Loading Portal..." : "Manage Subscription"}
            </button>
          )}
        </div>
      </div>

      {/* Plan Selection Cards */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Starter Plan */}
        <div className={`bg-slate-900/90 border rounded-2xl p-6 flex flex-col justify-between shadow-sm relative ${currentTier === "starter" ? "ring-2 ring-indigo-500 border-indigo-500/80" : "border-slate-800"}`}>
          {currentTier === "starter" && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-0.5 rounded-full">
              Active Plan
            </span>
          )}
          <div>
            <h3 className="font-bold text-base text-white">Starter</h3>
            <p className="text-slate-400 text-xs mt-1">For small teams getting started with issue tracking.</p>
            <div className="my-5">
              <span className="text-4xl font-black text-white">$29</span>
              <span className="text-slate-500 text-xs"> / month</span>
            </div>
            <ul className="text-xs text-slate-300 space-y-2.5 mb-6">
              <li className="flex items-center gap-2">✓ 5 Workspace Projects</li>
              <li className="flex items-center gap-2">✓ 3 Autonomous Agent Seats</li>
              <li className="flex items-center gap-2">✓ 5-Stage Kanban Board</li>
              <li className="flex items-center gap-2 text-slate-600">✕ Custom RAG Indexing</li>
            </ul>
          </div>
          <button
            disabled
            className="w-full py-2 bg-slate-800 text-slate-500 rounded-xl text-xs font-semibold cursor-not-allowed"
          >
            {currentTier === "starter" ? "Current Plan" : "Downgrade"}
          </button>
        </div>

        {/* Growth Plan (Featured) */}
        <div className={`bg-slate-900 border-2 rounded-2xl p-6 flex flex-col justify-between shadow-xl relative ${currentTier === "growth" ? "border-indigo-500 ring-2 ring-indigo-500/50 shadow-indigo-600/20" : "border-slate-800"}`}>
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-0.5 rounded-full">
            {currentTier === "growth" ? "Active Plan" : "Recommended"}
          </span>
          <div>
            <h3 className="font-bold text-base text-white">Growth</h3>
            <p className="text-slate-400 text-xs mt-1">Full swarm power for fast-scaling engineering teams.</p>
            <div className="my-5">
              <span className="text-4xl font-black text-white">$79</span>
              <span className="text-slate-500 text-xs"> / month</span>
            </div>
            <ul className="text-xs text-slate-300 space-y-2.5 mb-6">
              <li className="flex items-center gap-2 font-bold text-white">✓ Unlimited Projects</li>
              <li className="flex items-center gap-2 font-bold text-white">✓ All 9 Specialist Agent Seats</li>
              <li className="flex items-center gap-2">✓ pgvector Codebase & ADR RAG</li>
              <li className="flex items-center gap-2">✓ Production Deploys & Rollback</li>
            </ul>
          </div>
          <button
            onClick={() => handleSubscribe("growth")}
            disabled={loadingTier !== null || currentTier === "growth"}
            className={`w-full py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              currentTier === "growth"
                ? "bg-slate-800 text-slate-400 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/30"
            } disabled:opacity-50`}
          >
            {loadingTier === "growth" ? "Processing..." : currentTier === "growth" ? "Current Plan" : "Upgrade to Growth"}
          </button>
        </div>

        {/* Enterprise Plan */}
        <div className={`bg-slate-900/90 border rounded-2xl p-6 flex flex-col justify-between shadow-sm relative ${currentTier === "enterprise" ? "ring-2 ring-indigo-500 border-indigo-500/80" : "border-slate-800"}`}>
          {currentTier === "enterprise" && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-0.5 rounded-full">
              Active Plan
            </span>
          )}
          <div>
            <h3 className="font-bold text-base text-white">Enterprise</h3>
            <p className="text-slate-400 text-xs mt-1">Dedicated Keycloak SSO and SLA support.</p>
            <div className="my-5">
              <span className="text-4xl font-black text-white">$199</span>
              <span className="text-slate-500 text-xs"> / month</span>
            </div>
            <ul className="text-xs text-slate-300 space-y-2.5 mb-6">
              <li className="flex items-center gap-2">✓ Everything in Growth</li>
              <li className="flex items-center gap-2">✓ Dedicated Keycloak Realm</li>
              <li className="flex items-center gap-2">✓ Unlimited Langfuse Tracing</li>
              <li className="flex items-center gap-2">✓ 99.9% Uptime SLA Guarantee</li>
            </ul>
          </div>
          <button
            onClick={() => handleSubscribe("enterprise")}
            disabled={loadingTier !== null || currentTier === "enterprise"}
            className={`w-full py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              currentTier === "enterprise"
                ? "bg-slate-800 text-slate-400 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-xs"
            } disabled:opacity-50`}
          >
            {loadingTier === "enterprise" ? "Processing..." : currentTier === "enterprise" ? "Current Plan" : "Upgrade to Enterprise"}
          </button>
        </div>
      </div>
    </div>
  );
}
