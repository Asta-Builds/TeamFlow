"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Avatar, ROLE_COLORS, ROLE_LABELS } from "@/lib/ui";
import {
  User as UserIcon,
  Mail,
  Shield,
  Building2,
  RefreshCw,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

export default function UserProfilePage() {
  const { loading, refreshUser, user } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshSession = async () => {
    setRefreshing(true);
    try {
      const sessionValid = await refreshUser();
      if (!sessionValid) {
        toast.error("Failed to refresh session. Please log in again.");
        router.push("/login");
        return;
      }
      toast.success("Session refreshed successfully!");
    } catch {
      toast.error("An error occurred while refreshing session.");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400 text-sm">
          <RefreshCw className="h-5 w-5 animate-spin text-indigo-400" />
          <span>Loading user profile...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 max-w-md w-full">
          <Shield className="h-10 w-10 text-amber-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-white mb-2">Authentication Required</h2>
          <p className="text-sm text-slate-400 mb-6">
            Please log in to view your profile and workspace settings.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors shadow-sm"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  const roleLabel = ROLE_LABELS[user.role || "member"] || user.role;
  const roleColor = ROLE_COLORS[user.role || "member"] || "bg-slate-800 text-slate-300 border-slate-700";

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      {/* Back button */}
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Dashboard</span>
        </Link>
      </div>

      {/* Main Profile Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 sm:p-8 backdrop-blur-sm shadow-xl space-y-6">
        {/* Header with Avatar and Basic Info */}
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 pb-6 border-b border-slate-800 text-center sm:text-left">
          <Avatar name={user.name} email={user.email} size={72} showStatus status={user.user_status} />
          <div className="space-y-1.5 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-white">{user.name}</h1>
              <span className={`inline-flex self-center sm:self-auto items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${roleColor}`}>
                {roleLabel}
              </span>
            </div>
            <p className="text-sm text-slate-400 flex items-center justify-center sm:justify-start gap-1.5">
              <Mail className="h-3.5 w-3.5 text-slate-500" />
              <span>{user.email}</span>
            </p>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <Building2 className="h-4 w-4 text-indigo-400" />
              <span>Workspace</span>
            </div>
            <p className="text-sm font-bold text-white pl-6">
              {user.organization_name || "Default Workspace"}
            </p>
            {user.organization_tier && (
              <p className="text-[11px] text-slate-400 pl-6 capitalize">
                Plan: <span className="text-indigo-300 font-semibold">{user.organization_tier}</span>
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <Shield className="h-4 w-4 text-emerald-400" />
              <span>Account Status</span>
            </div>
            <p className="text-sm font-bold text-emerald-400 pl-6 capitalize flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{user.user_status || "Active"}</span>
            </p>
            <p className="text-[11px] text-slate-400 pl-6">
              User ID: #{user.id}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <UserIcon className="h-4 w-4 text-cyan-400" />
              <span>User Type</span>
            </div>
            <p className="text-sm font-bold text-white pl-6">
              {user.is_ai_agent ? "Autonomous AI Agent" : "Human Team Member"}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <RefreshCw className="h-4 w-4 text-purple-400" />
              <span>Session Management</span>
            </div>
            <p className="text-xs text-slate-400 pl-6">
              JWT Tokens active with PBKDF2 authentication
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleRefreshSession}
            disabled={refreshing}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-bold text-white border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-indigo-400 ${refreshing ? "animate-spin" : ""}`} />
            <span>{refreshing ? "Refreshing..." : "Refresh Session"}</span>
          </button>

          <Link
            href="/settings"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600/90 hover:bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-all"
          >
            Workspace Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
