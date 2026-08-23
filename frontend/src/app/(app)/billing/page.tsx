"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { createCheckoutSession, createPortalSession, mockConfirmSubscription } from "@/lib/api";

export default function BillingPage() {
  const { user, refreshUser } = useAuth();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentTier = user?.organization_tier || "starter";
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
    <div className="max-w-4xl mx-auto py-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Billing & Subscriptions</h1>
        <p className="text-slate-500 mt-1">Manage your workspace plans, pricing tiers, and Stripe billing information.</p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Current Plan Overview Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Current Plan</div>
            <div className="text-xl font-bold text-slate-800 mt-1 flex items-center gap-2">
              <span className="capitalize">{currentTier} Plan</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                currentStatus === "active" 
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}>
                {currentStatus}
              </span>
            </div>
            <p className="text-slate-500 text-sm mt-2">
              {currentTier === "starter" && "Your workspace is on the free tier. Upgrade to unlock more projects, team collaborators, and automated technical SEO audits."}
              {currentTier === "growth" && "Your workspace has unlock limits for scaling teams."}
              {currentTier === "enterprise" && "Your workspace has fully unlimited seats and custom audits."}
            </p>
          </div>
          {currentTier !== "starter" && (
            <button
              onClick={handleManagePortal}
              disabled={loadingTier !== null}
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition disabled:opacity-50"
            >
              {loadingTier === "portal" ? "Loading Portal..." : "Manage Subscription"}
            </button>
          )}
        </div>
      </div>

      {/* Plan Selection Cards */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Starter Plan */}
        <div className={`bg-white border rounded-xl p-6 flex flex-col justify-between shadow-sm relative ${currentTier === "starter" ? "ring-2 ring-indigo-600 border-indigo-200" : "border-slate-200"}`}>
          {currentTier === "starter" && (
            <span className="absolute top-0 right-6 transform -translate-y-1/2 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
          <div>
            <h3 className="font-bold text-lg text-slate-800">Starter</h3>
            <p className="text-slate-500 text-xs mt-1">For small teams getting started with issue tracking.</p>
            <div className="my-6">
              <span className="text-3xl font-extrabold text-slate-800">$0</span>
              <span className="text-slate-400 text-sm"> / month</span>
            </div>
            <ul className="text-sm text-slate-600 space-y-3 mb-6">
              <li className="flex items-center gap-2">🟢 Up to 3 projects</li>
              <li className="flex items-center gap-2">🟢 Up to 5 members</li>
              <li className="flex items-center gap-2">🟢 Manual deployments</li>
              <li className="flex items-center gap-2 text-slate-300">❌ SEO website audits</li>
            </ul>
          </div>
          <button
            disabled
            className="w-full py-2 bg-slate-100 text-slate-400 rounded-lg text-sm font-semibold cursor-not-allowed"
          >
            {currentTier === "starter" ? "Your Plan" : "Downgrade"}
          </button>
        </div>

        {/* Growth Plan */}
        <div className={`bg-white border rounded-xl p-6 flex flex-col justify-between shadow-sm relative ${currentTier === "growth" ? "ring-2 ring-indigo-600 border-indigo-200" : "border-slate-200"}`}>
          {currentTier === "growth" && (
            <span className="absolute top-0 right-6 transform -translate-y-1/2 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
          <div>
            <h3 className="font-bold text-lg text-slate-800">Growth</h3>
            <p className="text-slate-500 text-xs mt-1">Full collaboration capabilities for scaling teams.</p>
            <div className="my-6">
              <span className="text-3xl font-extrabold text-slate-800">$49</span>
              <span className="text-slate-400 text-sm"> / month</span>
            </div>
            <ul className="text-sm text-slate-600 space-y-3 mb-6">
              <li className="flex items-center gap-2">🟢 Up to 20 projects</li>
              <li className="flex items-center gap-2">🟢 Up to 30 members</li>
              <li className="flex items-center gap-2">🟢 Unlimited deployments</li>
              <li className="flex items-center gap-2">🟢 Priority support</li>
            </ul>
          </div>
          <button
            onClick={() => handleSubscribe("growth")}
            disabled={loadingTier !== null || currentTier === "growth"}
            className={`w-full py-2 rounded-lg text-sm font-semibold transition ${
              currentTier === "growth"
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-600/20"
            } disabled:opacity-50`}
          >
            {loadingTier === "growth" ? "Processing..." : currentTier === "growth" ? "Your Plan" : "Upgrade to Growth"}
          </button>
        </div>

        {/* Enterprise Plan */}
        <div className={`bg-white border rounded-xl p-6 flex flex-col justify-between shadow-sm relative ${currentTier === "enterprise" ? "ring-2 ring-indigo-600 border-indigo-200" : "border-slate-200"}`}>
          {currentTier === "enterprise" && (
            <span className="absolute top-0 right-6 transform -translate-y-1/2 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
          <div>
            <h3 className="font-bold text-lg text-slate-800">Enterprise</h3>
            <p className="text-slate-500 text-xs mt-1">Custom audits, unlimited seats, and API integrations.</p>
            <div className="my-6">
              <span className="text-3xl font-extrabold text-slate-800">$199</span>
              <span className="text-slate-400 text-sm"> / month</span>
            </div>
            <ul className="text-sm text-slate-600 space-y-3 mb-6">
              <li className="flex items-center gap-2">🟢 Unlimited projects</li>
              <li className="flex items-center gap-2">🟢 Unlimited members</li>
              <li className="flex items-center gap-2">🟢 Automated SEO audits</li>
              <li className="flex items-center gap-2">🟢 Custom integrations</li>
            </ul>
          </div>
          <button
            onClick={() => handleSubscribe("enterprise")}
            disabled={loadingTier !== null || currentTier === "enterprise"}
            className={`w-full py-2 rounded-lg text-sm font-semibold transition ${
              currentTier === "enterprise"
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-600/20"
            } disabled:opacity-50`}
          >
            {loadingTier === "enterprise" ? "Processing..." : currentTier === "enterprise" ? "Your Plan" : "Upgrade to Enterprise"}
          </button>
        </div>
      </div>
    </div>
  );
}
