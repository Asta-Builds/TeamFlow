"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paginated, Role, User, UserStatus } from "@/lib/types";
import {
  Avatar,
  Badge,
  ROLE_COLORS,
  ROLE_LABELS,
  USER_STATUS_STYLES,
} from "@/lib/ui";

export default function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingMember, setEditingMember] = useState<User | null>(null);

  // Invite Form state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<Role>("backend");
  const [newBio, setNewBio] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const canManage =
    user?.role === "ceo" ||
    user?.role === "tech_lead" ||
    user?.role === "admin";

  function load() {
    apiFetch<Paginated<User>>("/users/")
      .then((d) => setMembers(d.results || []))
      .catch((err) => console.error("Error loading team directory", err))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    try {
      const created = await apiFetch<User>("/users/", {
        method: "POST",
        body: {
          email: newEmail,
          name: newName,
          role: newRole,
          bio: newBio,
        },
      });
      setMembers((prev) => [...prev, created]);
      setShowInviteModal(false);
      setNewEmail("");
      setNewName("");
      setNewBio("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setInviteError("Only CEO, Tech Lead or Admin can add members.");
      } else {
        setInviteError("Failed to add member. Email may already exist.");
      }
    }
  }

  async function handleUpdateRole(memberId: number, role: Role, user_status: UserStatus) {
    try {
      const updated = await apiFetch<User>(`/users/${memberId}/`, {
        method: "PATCH",
        body: { role, user_status },
      });
      setMembers((prev) => prev.map((m) => (m.id === memberId ? updated : m)));
      setEditingMember(null);
    } catch (err) {
      alert("Error updating member role/status.");
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400 font-medium">
        Loading team members directory…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Virtual Tech Team Directory
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Organigram, autonomous agent seats, roles & workload balance.
          </p>
        </div>

        {canManage && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition flex items-center gap-1.5"
          >
            <span>+</span> Add Team Member
          </button>
        )}
      </div>

      {/* Team Cards Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => {
          const statusInfo = USER_STATUS_STYLES[m.user_status || "active"];
          return (
            <div
              key={m.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md hover:border-slate-300"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={m.name} email={m.email} size={42} />
                    <div className="min-w-0">
                      <div className="truncate font-bold text-slate-900 text-sm">{m.name || m.email}</div>
                      <div className="truncate text-xs text-slate-400">{m.email}</div>
                    </div>
                  </div>
                  <span className={`inline-block text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${ROLE_COLORS[m.role] || "bg-slate-100 text-slate-700"}`}>
                    {ROLE_LABELS[m.role] || m.role}
                  </span>
                </div>

                {m.bio && (
                  <p className="text-xs text-slate-500 line-clamp-2 mb-3 leading-relaxed">
                    {m.bio}
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${statusInfo.dot}`} />
                  <span className="text-[11px] font-semibold text-slate-600">{statusInfo.label}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 font-medium">
                    🎯 <strong>{m.open_tasks_count ?? 0}</strong> open
                  </span>
                  {canManage && (
                    <button
                      onClick={() => setEditingMember(m)}
                      className="text-[11px] text-indigo-600 hover:underline font-bold ml-1"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">Add Team Member</h2>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleInvite} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name *</label>
                <input
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Marcus Aurelius"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email Address *</label>
                <input
                  required
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="member@teamflow.dev"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Role *</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as Role)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                >
                  <option value="ceo">CEO</option>
                  <option value="tech_lead">Tech Lead</option>
                  <option value="backend">Senior Backend Engineer</option>
                  <option value="frontend">Senior Frontend Engineer</option>
                  <option value="devops">DevOps Engineer</option>
                  <option value="qa">QA Engineer</option>
                  <option value="designer">UI/UX Designer</option>
                  <option value="seo">SEO Specialist</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Mission / Bio</label>
                <input
                  value={newBio}
                  onChange={(e) => setNewBio(e.target.value)}
                  placeholder="e.g. Core API architecture and query performance"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>
              {inviteError && <p className="text-xs font-semibold text-rose-600">{inviteError}</p>}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
                >
                  Add Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Role & Status Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Edit Member: {editingMember.name}
            </h3>
            <p className="text-xs text-slate-400 mb-4">{editingMember.email}</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Assigned Role</label>
                <select
                  value={editingMember.role}
                  onChange={(e) =>
                    setEditingMember({ ...editingMember, role: e.target.value as Role })
                  }
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold"
                >
                  <option value="ceo">CEO</option>
                  <option value="tech_lead">Tech Lead</option>
                  <option value="backend">Senior Backend Engineer</option>
                  <option value="frontend">Senior Frontend Engineer</option>
                  <option value="devops">DevOps Engineer</option>
                  <option value="qa">QA Engineer</option>
                  <option value="designer">UI/UX Designer</option>
                  <option value="seo">SEO Specialist</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Account Status</label>
                <select
                  value={editingMember.user_status || "active"}
                  onChange={(e) =>
                    setEditingMember({
                      ...editingMember,
                      user_status: e.target.value as UserStatus,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold"
                >
                  <option value="active">Active</option>
                  <option value="offline">Offline</option>
                  <option value="pending">Pending Approval</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  onClick={() => setEditingMember(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-500"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    handleUpdateRole(
                      editingMember.id,
                      editingMember.role,
                      editingMember.user_status || "active"
                    )
                  }
                  className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
