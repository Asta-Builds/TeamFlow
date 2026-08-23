"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Avatar, ROLE_COLORS, ROLE_LABELS } from "@/lib/ui";

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();

  // Profile Form
  const [name, setName] = useState(user?.name || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Security / Password Form
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<"profile" | "security" | "workspace" | "export">("profile");

  const canManageWorkspace =
    user?.role === "ceo" ||
    user?.role === "tech_lead" ||
    user?.role === "admin";

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      await apiFetch("/auth/me/", {
        method: "PATCH",
        body: { name, avatar_url: avatarUrl, bio },
      });
      await refreshUser();
      setProfileMsg({ type: "success", text: "Profile updated successfully!" });
    } catch {
      setProfileMsg({ type: "error", text: "Failed to update profile." });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    setPasswordMsg(null);
    try {
      await apiFetch("/auth/change-password/", {
        method: "POST",
        body: { old_password: oldPassword, new_password: newPassword },
      });
      setPasswordMsg({ type: "success", text: "Password changed successfully!" });
      setOldPassword("");
      setNewPassword("");
    } catch {
      setPasswordMsg({ type: "error", text: "Failed to change password. Check old password." });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleExportData = async (format: "json" | "csv") => {
    try {
      const data = await apiFetch<any>(`/projects/`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `teamflow_workspace_export.${format}`;
      a.click();
    } catch {
      alert("Error exporting workspace data.");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
          Account & Workspace Settings
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your personal profile, authentication credentials, and workspace preferences.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("profile")}
          className={`pb-3 px-3 text-xs font-bold transition ${
            activeTab === "profile"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          👤 Profile
        </button>
        <button
          onClick={() => setActiveTab("security")}
          className={`pb-3 px-3 text-xs font-bold transition ${
            activeTab === "security"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          🔒 Security
        </button>
        <button
          onClick={() => setActiveTab("workspace")}
          className={`pb-3 px-3 text-xs font-bold transition ${
            activeTab === "workspace"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          🏢 Workspace
        </button>
        <button
          onClick={() => setActiveTab("export")}
          className={`pb-3 px-3 text-xs font-bold transition ${
            activeTab === "export"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          📦 Data Export
        </button>
      </div>

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <form onSubmit={handleSaveProfile} className="space-y-5">
            <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
              <Avatar name={user?.name || ""} email={user?.email} size={54} />
              <div>
                <h3 className="text-sm font-bold text-slate-900">{user?.name || user?.email}</h3>
                <span className={`inline-block text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border mt-1 ${ROLE_COLORS[user?.role || "member"]}`}>
                  {ROLE_LABELS[user?.role || "member"]}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="w-full max-w-md rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
              <input
                disabled
                value={user?.email || ""}
                className="w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 cursor-not-allowed"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Email is your primary workspace login identifier.</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Avatar Image URL</label>
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
                className="w-full max-w-md rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Bio / Mission</label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Brief description of your role responsibilities..."
                className="w-full max-w-md rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {profileMsg && (
              <p className={`text-xs font-bold ${profileMsg.type === "success" ? "text-emerald-600" : "text-rose-600"}`}>
                {profileMsg.text}
              </p>
            )}

            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>
          </form>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === "security" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
            <h3 className="text-sm font-bold text-slate-900 mb-2">Change Password</h3>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Current Password</label>
              <input
                type="password"
                required
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {passwordMsg && (
              <p className={`text-xs font-bold ${passwordMsg.type === "success" ? "text-emerald-600" : "text-rose-600"}`}>
                {passwordMsg.text}
              </p>
            )}

            <button
              type="submit"
              disabled={savingPassword}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              {savingPassword ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>
      )}

      {/* Workspace Tab */}
      {activeTab === "workspace" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4 max-w-md">
          <h3 className="text-sm font-bold text-slate-900">Workspace Details</h3>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Company / Workspace Name</label>
            <input
              disabled={!canManageWorkspace}
              defaultValue={user?.organization_name || "TeamFlow Workspace"}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Subscription Plan</label>
            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-xs flex items-center justify-between">
              <div>
                <span className="font-bold text-indigo-950 uppercase">{user?.organization_tier || "Growth"} Tier</span>
                <p className="text-indigo-800 text-[11px]">Active SaaS subscription</p>
              </div>
              <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Active
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Export Tab */}
      {activeTab === "export" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4 max-w-md">
          <h3 className="text-sm font-bold text-slate-900">Export Workspace Data</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Download your full project records, ticket logs, comments, and audit histories in standard portable formats.
          </p>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => handleExportData("json")}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
            >
              Export as JSON (.json)
            </button>
            <button
              onClick={() => handleExportData("csv")}
              className="rounded-xl bg-slate-100 border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 transition"
            >
              Export as CSV (.csv)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
