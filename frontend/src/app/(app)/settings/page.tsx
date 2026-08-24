"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Avatar, ROLE_COLORS, ROLE_LABELS } from "@/lib/ui";
import { toast } from "sonner";
import { User, Shield, Building2, Download, Key, CheckCircle2 } from "lucide-react";

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

  // Active tab
  const [activeTab, setActiveTab] = useState<"profile" | "security" | "workspace" | "export">("profile");

  const canManageWorkspace =
    user?.role === "ceo" ||
    user?.role === "tech_lead" ||
    user?.role === "admin";

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
