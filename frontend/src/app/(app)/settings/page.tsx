"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Avatar, ROLE_COLORS, ROLE_LABELS } from "@/lib/ui";
import { toast } from "sonner";
import { User, Shield, Building2, Download, Key, CheckCircle2, Send, MessageSquare } from "lucide-react";

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

  useEffect(() => {
    apiFetch<any>("/integrations/slack/")
      .then((data) => {
        if (data) {
          if (data.webhook_url) setSlackWebhook(data.webhook_url);
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
          webhook_url: slackWebhook,
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
      const res = await apiFetch<any>("/integrations/slack/test/", { method: "POST" });
      if (res.ok) {
        toast.success(res.message || "Test Slack message delivered!");
      } else {
        toast.error("Slack test failed: " + (res.detail || "Unable to deliver"));
      }
    } catch (err: any) {
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
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-4 max-w-md">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Building2 className="h-4 w-4 text-indigo-400" />
            <span>Workspace Details</span>
          </h3>
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Company / Workspace Name</label>
            <input
              disabled={!canManageWorkspace}
              defaultValue={user?.organization_name || "TeamFlow Workspace"}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Subscription Plan</label>
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs flex items-center justify-between">
              <div>
                <span className="font-bold text-white uppercase">{user?.organization_tier || "Growth"} Tier</span>
                <p className="text-slate-400 text-[11px]">Active SaaS subscription</p>
              </div>
              <span className="font-bold text-emerald-400 bg-emerald-950 border border-emerald-800/50 px-2 py-0.5 rounded-md text-[10px]">
                Active
              </span>
            </div>
          </div>
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
                placeholder="https://hooks.slack.com/services/T000/B000/XXXXXX"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Create an Incoming Webhook in your Slack App to receive notifications.
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
                disabled={testingSlack || !slackWebhook.trim()}
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
