"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  useInviteMemberMutation,
  useRemoveMemberMutation,
  useTeamMembers,
  useUpdateMemberRoleMutation,
} from "@/lib/queries";
import TeamLoading from "./loading";
import type { HumanRole, User } from "@/lib/types";
import {
  Avatar,
  ROLE_COLORS,
  USER_STATUS_STYLES,
  AgentTypeBadge,
  HUMAN_ROLE_OPTIONS,
  roleLabel,
} from "@/lib/ui";
import { UserPlus, Target, Edit2, X, Loader2, MailPlus } from "lucide-react";

export default function TeamPage() {
  const { user } = useAuth();
  const { data: members = [], isLoading: loading } = useTeamMembers();
  const inviteMember = useInviteMemberMutation();
  const updateRole = useUpdateMemberRoleMutation();
  const removeMember = useRemoveMemberMutation();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingMember, setEditingMember] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<HumanRole>("member");
  const [confirmRemoval, setConfirmRemoval] = useState(false);

  // Invite Form state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<HumanRole>("member");

  const isOwner = user?.role === "ceo";
  const canManage = isOwner || user?.role === "admin";

  // Admins manage members; only the CEO manages CEO and Admin seats.
  const canEdit = (m: User) =>
    canManage && !m.is_ai_agent && m.id !== user?.id && (isOwner || m.role === "member");

  function openEditor(m: User) {
    setEditingMember(m);
    setEditRole((m.role as HumanRole) || "member");
    setConfirmRemoval(false);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    try {
      await inviteMember.mutateAsync({
        email: newEmail.trim(),
        name: newName.trim() || undefined,
        role: newRole,
      });
      setShowInviteModal(false);
      setNewEmail("");
      setNewName("");
      setNewRole("member");
    } catch {
      // The mutation already reported the error.
    }
  }

  async function handleUpdateRole() {
    if (!editingMember) return;
    try {
      await updateRole.mutateAsync({ userId: editingMember.id, role: editRole });
      setEditingMember(null);
    } catch {
      // The mutation already reported the error.
    }
  }

  async function handleRemove() {
    if (!editingMember) return;
    if (!confirmRemoval) {
      setConfirmRemoval(true);
      return;
    }
    try {
      await removeMember.mutateAsync(editingMember.id);
      setEditingMember(null);
    } catch {
      // The mutation already reported the error.
    }
  }

  if (loading) {
    return <TeamLoading />;
  }

  const peopleCount = members.filter((m) => !m.is_ai_agent).length;
  const aiAgentsCount = members.length - peopleCount;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
              People & AI Agents
            </h1>
            <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-2.5 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800/50">
              {peopleCount} {peopleCount === 1 ? "Person" : "People"} · {aiAgentsCount} AI Agent{aiAgentsCount !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            People join this workspace by invitation. AI agents are provided by the workspace and pick up dispatched work.
          </p>
        </div>

        {canManage && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 transition flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            <span>Invite a Person</span>
          </button>
        )}
      </div>

      {/* Team Cards Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => {
          const isAi = Boolean(m.is_ai_agent);
          const isInvited = m.membership_status === "invited";
          const statusInfo = USER_STATUS_STYLES[m.user_status || "active"];

          return (
            <div
              key={m.id}
              className={`flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition hover:-translate-y-0.5 ${
                isAi
                  ? "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 hover:border-slate-300 dark:hover:border-slate-700"
                  : "border-purple-200 dark:border-purple-800/60 bg-gradient-to-b from-purple-50 to-white dark:from-purple-950/30 dark:to-slate-900"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={m.name} email={m.email} size={42} showStatus={!isInvited} status={m.user_status} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-bold text-slate-900 dark:text-white text-sm">{m.name || m.email}</span>
                      </div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400 font-mono">{m.email}</div>
                    </div>
                  </div>
                  <AgentTypeBadge role={m.role} isAi={isAi} />
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className={`inline-block text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${ROLE_COLORS[m.role] || "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"}`}>
                    {roleLabel(m.role, isAi)}
                  </span>
                  {isInvited && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800/50">
                      <MailPlus className="h-3 w-3" aria-hidden="true" />
                      Invitation pending
                    </span>
                  )}
                </div>

                {m.bio && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mb-3 leading-relaxed">
                    {m.bio}
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  {isInvited ? (
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Not joined yet</span>
                  ) : (
                    <>
                      <span className={`h-2 w-2 rounded-full ${statusInfo.dot}`} />
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">{statusInfo.label}</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
                    <Target className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                    <span><strong className="text-slate-900 dark:text-white">{m.open_tasks_count ?? 0}</strong> open</span>
                  </span>
                  {canEdit(m) && (
                    <button
                      onClick={() => openEditor(m)}
                      className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline font-bold ml-1 cursor-pointer flex items-center gap-1"
                    >
                      <Edit2 className="h-2.5 w-2.5" />
                      <span>Manage</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 dark:bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span>Invite a Person</span>
              </h2>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Email Address *</label>
                <input
                  required
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="member@company.com"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Full Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Sarah Connor"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Workspace Role *</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as HumanRole)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none cursor-pointer"
                >
                  {HUMAN_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.value !== "member" && !isOwner}>
                      {option.label} — {option.description}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  They see the invitation after signing in with this email, and join once they accept it.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteMember.isPending}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {inviteMember.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Send Invitation</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Member Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 dark:bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingMember.name || editingMember.email}
              </h3>
              <button onClick={() => setEditingMember(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{editingMember.email}</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Role in this workspace</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as HumanRole)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-white font-semibold focus:outline-none cursor-pointer"
                >
                  {HUMAN_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.value !== "member" && !isOwner}>
                      {option.label} — {option.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={handleRemove}
                  disabled={removeMember.isPending}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-50 ${
                    confirmRemoval
                      ? "bg-rose-600 text-white hover:bg-rose-500"
                      : "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  }`}
                >
                  {confirmRemoval
                    ? "Confirm removal"
                    : editingMember.membership_status === "invited"
                      ? "Cancel invitation"
                      : "Remove from workspace"}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingMember(null)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateRole}
                    disabled={updateRole.isPending || editRole === editingMember.role}
                    className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
                  >
                    Save Role
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
