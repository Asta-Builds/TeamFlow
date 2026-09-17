"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { createCheckoutSession, createPortalSession, mockConfirmSubscription } from "@/lib/api";
import { useBillingPlans } from "@/lib/queries";
import { toast } from "sonner";
import { CreditCard, CheckCircle2, XCircle } from "lucide-react";

export default function BillingPage() {
  const { user, refreshUser } = useAuth();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const { data: plans } = useBillingPlans();

  const currentTier = user?.organization_tier || "starter";
  const currentStatus = user?.organization_status || "active";

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("success") === "true") {
        void refreshUser();
        toast.success("Subscription updated! Your workspace limits have been upgraded.");
      } else if (params.get("canceled") === "true") {
        toast.info("Checkout process cancelled.");
      }
    }
  }, [refreshUser]);

  const handleSubscribe = async (tier: string) => {
    setLoadingTier(tier);
    try {
      const session = await createCheckoutSession(
        tier,
        window.location.origin + "/billing?success=true",
        window.location.origin + "/billing?canceled=true"
      );

      if (session.mock) {
        await mockConfirmSubscription(tier);
        await refreshUser();
        toast.success(`Successfully upgraded to ${tier.toUpperCase()} plan (Developer Mock Mode).`);
      } else {
        window.location.assign(session.url);
      }
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to initiate subscription.");
    } finally {
      setLoadingTier(null);
    }
  };

  const handleManagePortal = async () => {
    setLoadingTier("portal");
    try {
      const session = await createPortalSession(window.location.href);
      if (session.mock) {
        toast.info("Redirecting to Customer Portal (Stripe test mode).");
      } else {
        window.location.assign(session.url);
      }
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to load customer portal.");
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-6">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
          Billing & Subscription Plans
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Manage workspace quotas, autonomous agent seats, and Stripe billing information.
        </p>
      </div>

      {/* Current Plan Overview Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">Current Workspace Plan</div>
            <div className="text-xl font-black text-slate-900 dark:text-white mt-1 flex items-center gap-2">
              <span className="capitalize">{currentTier} Tier</span>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 dark:border-emerald-800/50">
                {currentStatus}
              </span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 text-xs mt-2 max-w-xl leading-relaxed">
              {currentTier === "starter" && "Your workspace is on the starter tier with basic quotas. Upgrade to unlock more features."}
              {currentTier === "growth" && "Your workspace has unlocked advanced capabilities."}
              {currentTier === "enterprise" && "Your workspace has dedicated Clerk SSO, unlimited traces, and SLA support."}
            </p>
          </div>
          {currentTier !== "starter" && (
            <button
              onClick={handleManagePortal}
              disabled={loadingTier !== null}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-white transition disabled:opacity-50 cursor-pointer shrink-0 flex items-center gap-1.5"
            >
              <CreditCard className="h-3.5 w-3.5" />
              <span>{loadingTier === "portal" ? "Loading Portal..." : "Manage Subscription"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Plan Selection Cards */}
      <div className="grid md:grid-cols-3 gap-6">
        {plans?.map((plan) => (
          <div key={plan.tier} className={`bg-white dark:bg-slate-900/90 border rounded-2xl p-6 flex flex-col justify-between shadow-xs relative ${currentTier === plan.tier ? (plan.tier === "growth" ? "border-indigo-500 ring-2 ring-indigo-500/50 shadow-indigo-600/20" : "ring-2 ring-indigo-500 border-indigo-500") : "border-slate-200 dark:border-slate-800"}`}>
            {currentTier === plan.tier && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-0.5 rounded-full">
                Active Plan
              </span>
            )}
            {currentTier !== "growth" && plan.tier === "growth" && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-0.5 rounded-full">
                Recommended
              </span>
            )}
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">{plan.name}</h3>
              <div className="my-5">
                {plan.price_label ? (
                  <span className="text-4xl font-black text-slate-900 dark:text-white">{plan.price_label}</span>
                ) : plan.tier === "enterprise" ? (
                  <span className="text-2xl font-black text-slate-900 dark:text-white">Contact sales</span>
                ) : null}
              </div>
              <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-2.5 mb-6">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{plan.limits.max_projects === -1 ? "Unlimited" : plan.limits.max_projects} Workspace Projects</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{plan.limits.max_seats === -1 ? "Unlimited" : plan.limits.max_seats} Seats</span>
                </li>
                <li className={`flex items-center gap-2 ${plan.limits.ai_agent_swarm ? "" : "text-slate-400 dark:text-slate-600"}`}>
                  {plan.limits.ai_agent_swarm ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-slate-400 dark:text-slate-700 shrink-0" />
                  )}
                  <span>AI Agent Swarm</span>
                </li>
                <li className={`flex items-center gap-2 ${plan.limits.unlimited_traces ? "" : "text-slate-400 dark:text-slate-600"}`}>
                  {plan.limits.unlimited_traces ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-slate-400 dark:text-slate-700 shrink-0" />
                  )}
                  <span>Unlimited Traces</span>
                </li>
                <li className={`flex items-center gap-2 ${plan.limits.dedicated_clerk_sso ? "" : "text-slate-400 dark:text-slate-600"}`}>
                  {plan.limits.dedicated_clerk_sso ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-slate-400 dark:text-slate-700 shrink-0" />
                  )}
                  <span>Dedicated Clerk SSO</span>
                </li>
                <li className={`flex items-center gap-2 ${plan.limits.sla_support ? "" : "text-slate-400 dark:text-slate-600"}`}>
                  {plan.limits.sla_support ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-slate-400 dark:text-slate-700 shrink-0" />
                  )}
                  <span>SLA Support</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => handleSubscribe(plan.tier)}
              disabled={loadingTier !== null || currentTier === plan.tier || !plan.checkout_available}
              className={`w-full py-2.5 rounded-xl text-xs font-bold transition ${
                currentTier === plan.tier
                  ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed"
                  : !plan.checkout_available
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/30 cursor-pointer"
              } disabled:opacity-50`}
            >
              {loadingTier === plan.tier ? "Processing..." : currentTier === plan.tier ? "Current Plan" : (plan.tier === "starter" ? "Downgrade" : `Upgrade to ${plan.name}`)}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
