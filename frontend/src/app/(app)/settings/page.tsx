"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Avatar, ROLE_COLORS, ROLE_LABELS } from "@/lib/ui";
import { toast } from "sonner";
import {
  User,
  Shield,
  Building2,
  Download,
  Key,
  CheckCircle2,
  Send,
  MessageSquare,
  Plus,
  ArrowRightLeft,
  Users,
  FolderGit2,
  CheckSquare,
  Rocket,
  SearchCheck,
  Sparkles,
  UserPlus,
  CreditCard,
  Layers,
  ChevronRight,
  Loader2,
} from "lucide-react";
import {
  useCurrentOrganization,
  useOrganizations,
  useUpdateOrganizationMutation,
  useCreateOrganizationMutation,
  useSwitchOrganizationMutation,
  useInviteMemberMutation,
} from "@/lib/queries";

interface SlackIntegrationResponse {
  webhook_configured?: boolean;
  default_channel?: string;
  devops_channel?: string;
  qa_channel?: string;
  seo_channel?: string;
  notify_on_ticket_assigned?: boolean;
  notify_on_deployment?: boolean;
  notify_on_qa_rejection?: boolean;
  notify_on_seo_drop?: boolean;
}

interface SlackTestResponse {
  ok: boolean;
  message?: string;
  detail?: string;
}

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();

  // Profile Form
  const [name, setName] = useState(user?.name || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Security / Password Form
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Slack Integration Form
  const [slackWebhook, setSlackWebhook] = useState("");
  const [slackWebhookConfigured, setSlackWebhookConfigured] = useState(false);
  const [slackDefaultChannel, setSlackDefaultChannel] = useState("#general");
  const [slackDevopsChannel, setSlackDevopsChannel] = useState("#devops");
  const [slackQaChannel, setSlackQaChannel] = useState("#qa");
  const [slackSeoChannel, setSlackSeoChannel] = useState("#seo");
  const [notifyTicket, setNotifyTicket] = useState(true);
  const [notifyDeploy, setNotifyDeploy] = useState(true);
  const [notifyQa, setNotifyQa] = useState(true);
  const [notifySeo, setNotifySeo] = useState(true);
  const [savingSlack, setSavingSlack] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState<"profile" | "security" | "workspace" | "integrations" | "export">("profile");

  const canManageWorkspace =
    user?.role === "ceo" ||
    user?.role === "tech_lead" ||
    user?.role === "admin";

  // Multi-Tenant Organization Queries & State
  const { data: currentOrg } = useCurrentOrganization();
  const { data: orgsList = [], isLoading: orgsLoading } = useOrganizations();
  const updateOrgMutation = useUpdateOrganizationMutation();
  const createOrgMutation = useCreateOrganizationMutation();
  const switchOrgMutation = useSwitchOrganizationMutation();
  const inviteMemberMutation = useInviteMemberMutation();

  const [workspaceName, setWorkspaceName] = useState("");
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgTier, setNewOrgTier] = useState("growth");

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("lead");

  useEffect(() => {
    if (currentOrg?.name) {
      setWorkspaceName(currentOrg.name);
    } else if (user?.organization_name) {
      setWorkspaceName(user.organization_name);
    }
  }, [currentOrg?.name, user?.organization_name]);

  const handleUpdateWorkspaceName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceName.trim()) return;
    try {
      await updateOrgMutation.mutateAsync({ name: workspaceName.trim() });
      await refreshUser();
    } catch {}
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    try {
      await createOrgMutation.mutateAsync({ name: newOrgName.trim(), tier: newOrgTier });
      setNewOrgName("");
      setShowCreateOrg(false);
      await refreshUser();
    } catch {}
  };

  const handleSwitchOrg = async (orgId: number) => {
    try {
      await switchOrgMutation.mutateAsync(orgId);
      await refreshUser();
    } catch {}
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    try {
      await inviteMemberMutation.mutateAsync({
        email: inviteEmail.trim(),
        name: inviteName.trim() || undefined,
        role: inviteRole,
      });
      setInviteEmail("");
      setInviteName("");
      setShowInviteForm(false);
    } catch {}
  };

  useEffect(() => {
    apiFetch<SlackIntegrationResponse>("/integrations/slack/")
      .then((data) => {
        if (data) {
          setSlackWebhookConfigured(Boolean(data.webhook_configured));
          if (data.default_channel) setSlackDefaultChannel(data.default_channel);
          if (data.devops_channel) setSlackDevopsChannel(data.devops_channel);
          if (data.qa_channel) setSlackQaChannel(data.qa_channel);
          if (data.seo_channel) setSlackSeoChannel(data.seo_channel);
          if (data.notify_on_ticket_assigned !== undefined) setNotifyTicket(data.notify_on_ticket_assigned);
          if (data.notify_on_deployment !== undefined) setNotifyDeploy(data.notify_on_deployment);
          if (data.notify_on_qa_rejection !== undefined) setNotifyQa(data.notify_on_qa_rejection);
          if (data.notify_on_seo_drop !== undefined) setNotifySeo(data.notify_on_seo_drop);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await apiFetch("/auth/me/", {
        method: "PATCH",
        body: { name, avatar_url: avatarUrl, bio },
      });
      await refreshUser();
      toast.success("Profile updated successfully!");
    } catch {
      toast.error("Failed to update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    try {
      await apiFetch("/auth/change-password/", {
        method: "POST",
        body: { old_password: oldPassword, new_password: newPassword },
      });
      toast.success("Password changed successfully!");
      setOldPassword("");
      setNewPassword("");
    } catch {
      toast.error("Failed to change password. Please check your current password.");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSaveSlack = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSlack(true);
    try {
      await apiFetch("/integrations/slack/connect/", {
        method: "POST",
        body: {
          ...(slackWebhook.trim() ? { webhook_url: slackWebhook.trim() } : {}),
          default_channel: slackDefaultChannel,
          devops_channel: slackDevopsChannel,
          qa_channel: slackQaChannel,
          seo_channel: slackSeoChannel,
          notify_on_ticket_assigned: notifyTicket,
          notify_on_deployment: notifyDeploy,
          notify_on_qa_rejection: notifyQa,
          notify_on_seo_drop: notifySeo,
          is_enabled: true,
        },
      });
      setSlackWebhookConfigured(Boolean(slackWebhook.trim()) || slackWebhookConfigured);
      setSlackWebhook("");
      toast.success("Slack integration settings saved!");
    } catch {
      toast.error("Failed to save Slack settings.");
    } finally {
      setSavingSlack(false);
    }
  };

  const handleTestSlack = async () => {
    setTestingSlack(true);
    try {
      const res = await apiFetch<SlackTestResponse>("/integrations/slack/test/", { method: "POST" });
      if (res.ok) {
        toast.success(res.message || "Test Slack message delivered!");
      } else {
        toast.error("Slack test failed: " + (res.detail || "Unable to deliver"));
      }
    } catch (err) {
      toast.error("Slack test error: " + String(err));
    } finally {
      setTestingSlack(false);
    }
  };

  const handleExportData = async (format: "json" | "csv") => {
    try {
      const data = await apiFetch<unknown>(`/projects/`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `teamflow_workspace_export.${format}`;
      a.click();
      toast.success(`Exported workspace records as .${format}`);
    } catch {
      toast.error("Error exporting workspace data.");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="border-b border-slate-800 pb-6">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
          Account & Workspace Settings
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your personal profile, authentication credentials, and workspace preferences.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800">
        <button
          onClick={() => setActiveTab("profile")}
          className={`pb-3 px-3 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === "profile"
              ? "border-b-2 border-indigo-500 text-indigo-400 font-extrabold"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <User className="h-3.5 w-3.5" />
          <span>Profile</span>
        </button>
        <button
          onClick={() => setActiveTab("security")}
          className={`pb-3 px-3 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === "security"
              ? "border-b-2 border-indigo-500 text-indigo-400 font-extrabold"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Shield className="h-3.5 w-3.5" />
          <span>Security</span>
        </button>
        <button
          onClick={() => setActiveTab("workspace")}
          className={`pb-3 px-3 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === "workspace"
              ? "border-b-2 border-indigo-500 text-indigo-400 font-extrabold"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span>Workspace</span>
        </button>
        <button
          onClick={() => setActiveTab("integrations")}
          className={`pb-3 px-3 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === "integrations"
              ? "border-b-2 border-indigo-500 text-indigo-400 font-extrabold"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>Slack & Integrations</span>
        </button>
        <button
          onClick={() => setActiveTab("export")}
          className={`pb-3 px-3 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
            activeTab === "export"
              ? "border-b-2 border-indigo-500 text-indigo-400 font-extrabold"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Download className="h-3.5 w-3.5" />
          <span>Data Export</span>
        </button>
      </div>

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm">
          <form onSubmit={handleSaveProfile} className="space-y-5">
            <div className="flex items-center gap-4 pb-4 border-b border-slate-800">
              <Avatar name={user?.name || ""} email={user?.email} size={54} showStatus={true} status="active" />
              <div>
                <h3 className="text-sm font-bold text-white">{user?.name || user?.email}</h3>
                <span className={`inline-block text-[10px] font-extrabold px-2.5 py-0.5 rounded-md border mt-1 ${ROLE_COLORS[user?.role || "member"]}`}>
                  {ROLE_LABELS[user?.role || "member"]}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Full Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Email Address</label>
              <input
                disabled
                value={user?.email || ""}
                className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500 cursor-not-allowed font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Email is your primary workspace login identifier.</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Avatar Image URL</label>
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
                className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Bio / Mission</label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Brief description of your role responsibilities..."
                className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-60 transition cursor-pointer"
            >
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>
          </form>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === "security" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm">
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <Key className="h-4 w-4 text-indigo-400" />
              <span>Change Password</span>
            </h3>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Current Password</label>
              <input
                type="password"
                required
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={savingPassword}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-60 transition cursor-pointer"
            >
              {savingPassword ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>
      )}

      {/* Workspace Tab */}
      {activeTab === "workspace" && (
        <div className="space-y-6">
          {/* Workspace Info & Rename Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      {currentOrg?.name || user?.organization_name || "TeamFlow Workspace"}
                    </h3>
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800/50">
                      Active Workspace
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Tenant ID #{currentOrg?.id || user?.organization_id || "1"} • Created on{" "}
                    {currentOrg?.created_at ? new Date(currentOrg.created_at).toLocaleDateString() : "Active"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href="/billing"
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition flex items-center gap-1.5"
                >
                  <CreditCard className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Manage Subscription</span>
                </Link>
              </div>
            </div>

            <form onSubmit={handleUpdateWorkspaceName} className="mt-5 space-y-4 max-w-md">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Company / Workspace Name</label>
                <div className="flex items-center gap-2">
                  <input
                    disabled={!canManageWorkspace || updateOrgMutation.isPending}
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="Enter workspace name"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none disabled:opacity-60"
                  />
                  {canManageWorkspace && (
                    <button
                      type="submit"
                      disabled={updateOrgMutation.isPending || !workspaceName.trim() || workspaceName === (currentOrg?.name || user?.organization_name)}
                      className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
                    >
                      {updateOrgMutation.isPending ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <span>Rename</span>
                      )}
                    </button>
                  )}
                </div>
                {!canManageWorkspace && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Only CEO, Tech Lead, or Admin can rename this workspace.
                  </p>
                )}
              </div>
            </form>
          </div>

          {/* Live Quotas & Resource Usage Grid */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-400" />
                  <span>Tenant Resources & Quotas</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Live resource consumption for <span className="text-white font-medium">{currentOrg?.name || user?.organization_name}</span>.
                </p>
              </div>
              <span className="text-[11px] font-extrabold uppercase px-2.5 py-1 rounded-md bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                {currentOrg?.subscription_tier || user?.organization_tier || "growth"} Plan
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Seats Metric */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Users className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Team Seats</span>
                  </span>
                  <span className="font-mono text-slate-300">
                    {currentOrg?.metrics?.members_count ?? 1} / {currentOrg?.limits?.max_seats ?? 10}
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((currentOrg?.metrics?.members_count ?? 1) /
                            (currentOrg?.limits?.max_seats || 10)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Projects Metric */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 font-bold">
                    <FolderGit2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Projects</span>
                  </span>
                  <span className="font-mono text-slate-300">
                    {currentOrg?.metrics?.projects_count ?? 0} / {currentOrg?.limits?.max_projects ?? 20}
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((currentOrg?.metrics?.projects_count ?? 0) /
                            (currentOrg?.limits?.max_projects || 20)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Tasks Metric */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 font-bold">
                    <CheckSquare className="h-3.5 w-3.5 text-amber-400" />
                    <span>Tasks in Flight</span>
                  </span>
                  <span className="font-mono text-slate-300">
                    {currentOrg?.metrics?.open_tasks_count ?? 0} open
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {currentOrg?.metrics?.tasks_count ?? 0} total tickets tracked
                </p>
              </div>

              {/* Deployments & SEO */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Rocket className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Deployments</span>
                  </span>
                  <span className="font-mono text-slate-300">
                    {currentOrg?.metrics?.deployments_count ?? 0}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {currentOrg?.metrics?.seo_audits_count ?? 0} automated SEO audits
                </p>
              </div>
            </div>

            {/* Plan Feature Badges */}
            <div className="pt-2 border-t border-slate-800 flex flex-wrap gap-2 text-xs">
              <span className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${
                currentOrg?.limits?.ai_agent_swarm
                  ? "bg-indigo-950/40 border-indigo-800/60 text-indigo-300"
                  : "bg-slate-950 border-slate-800 text-slate-500"
              }`}>
                <Sparkles className="h-3 w-3" />
                <span>AI Agent Swarm: {currentOrg?.limits?.ai_agent_swarm ? "Enabled" : "Upgrade Required"}</span>
              </span>

              <span className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${
                currentOrg?.limits?.dedicated_clerk_sso
                  ? "bg-purple-950/40 border-purple-800/60 text-purple-300"
                  : "bg-slate-950 border-slate-800 text-slate-500"
              }`}>
                <Shield className="h-3 w-3" />
                <span>SSO Identity Sync: {currentOrg?.limits?.dedicated_clerk_sso ? "Active" : "Disabled"}</span>
              </span>

              <span className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${
                currentOrg?.limits?.unlimited_traces
                  ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                  : "bg-slate-950 border-slate-800 text-slate-500"
              }`}>
                <CheckCircle2 className="h-3 w-3" />
                <span>Langfuse Tracing: {currentOrg?.limits?.unlimited_traces ? "Unlimited" : "Standard"}</span>
              </span>
            </div>
          </div>

          {/* Multi-Tenant Switcher (All Workspaces) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-indigo-400" />
                  <span>Workspaces & Tenant Switching</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Switch context between different client or team workspaces without logging out.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowCreateOrg(!showCreateOrg)}
                className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 transition cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Workspace</span>
              </button>
            </div>

            {/* Create Workspace Form (Toggleable) */}
            {showCreateOrg && (
              <form onSubmit={handleCreateOrg} className="p-4 rounded-xl border border-indigo-800/50 bg-indigo-950/20 space-y-4 animate-in fade-in duration-200">
                <h4 className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create a New Multi-Tenant Workspace</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-300 mb-1">Workspace Name</label>
                    <input
                      required
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      placeholder="e.g. Acme Studio, Beta Launch, etc."
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Subscription Tier</label>
                    <select
                      value={newOrgTier}
                      onChange={(e) => setNewOrgTier(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none cursor-pointer"
                    >
                      <option value="growth">Growth Tier</option>
                      <option value="starter">Starter Tier</option>
                      <option value="enterprise">Enterprise Tier</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowCreateOrg(false)}
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createOrgMutation.isPending || !newOrgName.trim()}
                    className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
                  >
                    {createOrgMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    <span>Create & Switch</span>
                  </button>
                </div>
              </form>
            )}

            {/* Organizations List */}
            <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
              {orgsLoading ? (
                <div className="p-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                  <span>Loading available workspaces…</span>
                </div>
              ) : orgsList.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No other workspaces found.
                </div>
              ) : (
                orgsList.map((org) => {
                  const isCurrent = org.id === (currentOrg?.id || user?.organization_id) || Boolean(org.is_current);
                  return (
                    <div
                      key={org.id}
                      className="p-3.5 flex items-center justify-between hover:bg-slate-900/50 transition gap-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-black shrink-0 ${
                          isCurrent
                            ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-400"
                            : "bg-slate-900 border-slate-800 text-slate-400"
                        }`}>
                          {org.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">{org.name}</span>
                            <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                              {org.subscription_tier}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500">Tenant #{org.id}</span>
                        </div>
                      </div>

                      <div>
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-3 py-1 rounded-xl">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Current</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSwitchOrg(org.id)}
                            disabled={switchOrgMutation.isPending}
                            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5 text-indigo-400" />
                            <span>Switch</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Invite Team Member Form */}
          {canManageWorkspace && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-indigo-400" />
                    <span>Invite Team Member</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Add human or AI teammates to <span className="text-white font-medium">{currentOrg?.name || user?.organization_name}</span>.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowInviteForm(!showInviteForm)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer flex items-center gap-1.5"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>{showInviteForm ? "Close Form" : "Invite"}</span>
                </button>
              </div>

              {showInviteForm && (
                <form onSubmit={handleInviteMember} className="space-y-4 pt-1 animate-in fade-in duration-200 max-w-xl">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Email Address</label>
                      <input
                        required
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="colleague@teamflow.dev"
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Full Name</label>
                      <input
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        placeholder="e.g. Alex Morgan"
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Role / Seat Assignment</label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none cursor-pointer"
                    >
                      <option value="lead">Tech Lead</option>
                      <option value="backend">Senior Backend Engineer</option>
                      <option value="frontend">Senior Frontend Engineer</option>
                      <option value="qa">QA Engineer</option>
                      <option value="devops">DevOps Engineer</option>
                      <option value="design">UI/UX Designer</option>
                      <option value="seo">Technical SEO</option>
                      <option value="admin">Administrator</option>
                      <option value="member">General Member</option>
                    </select>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={inviteMemberMutation.isPending || !inviteEmail.trim()}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
                    >
                      {inviteMemberMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span>Send Invitation</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {/* Integrations / Slack Tab */}
      {activeTab === "integrations" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-6 max-w-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-950/60 border border-purple-800/40 text-purple-400">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Slack Workspace Integration</h3>
                <p className="text-xs text-slate-400">
                  Receive live alerts in Slack channels for ticket assignments, deployments, QA gates, and SEO drops.
                </p>
              </div>
            </div>
            <span className="text-[11px] font-bold text-indigo-400 bg-indigo-950/60 border border-indigo-800/40 px-2.5 py-0.5 rounded-full">
              Incoming Webhooks & Events API
            </span>
          </div>

          <form onSubmit={handleSaveSlack} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Slack Incoming Webhook URL
              </label>
              <input
                type="url"
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
                placeholder={slackWebhookConfigured ? "Webhook configured — enter a new URL to replace it" : "https://hooks.slack.com/services/T000/B000/XXXXXX"}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                {slackWebhookConfigured
                  ? "A webhook is configured. Enter a new URL only when you need to rotate it."
                  : "Create an Incoming Webhook in your Slack App to receive notifications."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Default Channel
                </label>
                <input
                  type="text"
                  value={slackDefaultChannel}
                  onChange={(e) => setSlackDefaultChannel(e.target.value)}
                  placeholder="#general"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  DevOps / Deployments Channel
                </label>
                <input
                  type="text"
                  value={slackDevopsChannel}
                  onChange={(e) => setSlackDevopsChannel(e.target.value)}
                  placeholder="#devops"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  QA Alerts Channel
                </label>
                <input
                  type="text"
                  value={slackQaChannel}
                  onChange={(e) => setSlackQaChannel(e.target.value)}
                  placeholder="#qa"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  SEO & Performance Channel
                </label>
                <input
                  type="text"
                  value={slackSeoChannel}
                  onChange={(e) => setSlackSeoChannel(e.target.value)}
                  placeholder="#seo"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4 space-y-2.5">
              <label className="block text-xs font-bold text-slate-300 mb-2">Notification Triggers</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
                <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={notifyTicket}
                    onChange={(e) => setNotifyTicket(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Ticket Assigned</span>
                </label>
                <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={notifyDeploy}
                    onChange={(e) => setNotifyDeploy(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Deployments & Releases</span>
                </label>
                <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={notifyQa}
                    onChange={(e) => setNotifyQa(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>QA Decision Gate Rejections</span>
                </label>
                <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={notifySeo}
                    onChange={(e) => setNotifySeo(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>SEO Score Anomalies</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={handleTestSlack}
                disabled={testingSlack || (!slackWebhook.trim() && !slackWebhookConfigured)}
                className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700 hover:text-white disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
              >
                <Send className="h-3.5 w-3.5 text-indigo-400" />
                <span>{testingSlack ? "Sending…" : "Send Test Notification"}</span>
              </button>

              <button
                type="submit"
                disabled={savingSlack}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{savingSlack ? "Saving…" : "Save Slack Settings"}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Export Tab */}
      {activeTab === "export" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-4 max-w-md">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Download className="h-4 w-4 text-indigo-400" />
            <span>Export Workspace Data</span>
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Download your full project records, ticket logs, comments, and audit histories in standard portable formats.
          </p>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => handleExportData("json")}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition cursor-pointer flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export as JSON</span>
            </button>
            <button
              onClick={() => handleExportData("csv")}
              className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export as CSV</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
