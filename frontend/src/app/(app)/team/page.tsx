"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paginated, User } from "@/lib/types";
import { Avatar, Badge, ROLE_LABELS } from "@/lib/ui";

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-indigo-100 text-indigo-700 border border-indigo-200/50",
  member: "bg-slate-100 text-slate-700 border border-slate-200/60",
};

export default function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Paginated<User>>("/users/")
      .then((d) => setMembers(d.results))
      .catch((err) => console.error("Error loading team directory", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400 flex h-64 items-center justify-center font-medium">Loading team members…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">Team Members</h1>
        <p className="text-sm text-slate-500 mt-1">Manage team members, view roles, and collaborate on active workspaces.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-3.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <Avatar name={m.name} email={m.email} size={44} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-slate-800">
                {m.name || m.email}
              </div>
              <div className="truncate text-xs text-slate-400">{m.email}</div>
            </div>
            <div className="flex flex-col gap-1 items-end">
              <Badge className={ROLE_STYLES[m.role] || ROLE_STYLES.member}>{ROLE_LABELS[m.role] || m.role}</Badge>
            </div>
          </div>
        ))}
      </div>
      {members.length === 1 && (
        <p className="text-sm text-slate-400">
          Only you are visible — register additional members to see the list.
        </p>
      )}
    </div>
  );
}
