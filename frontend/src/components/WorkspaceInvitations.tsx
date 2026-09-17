"use client";

import { Loader2, MailPlus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  useLeaveOrganizationMutation,
  useOrganizations,
  useSwitchOrganizationMutation,
} from "@/lib/queries";
import { roleLabel } from "@/lib/ui";

/** Pending workspace invitations, which the person accepts or declines. */
export function WorkspaceInvitations() {
  const { refreshUser } = useAuth();
  const { data: workspaces = [] } = useOrganizations();
  const accept = useSwitchOrganizationMutation();
  const decline = useLeaveOrganizationMutation();
  const invitations = workspaces.filter((org) => org.membership_status === "invited");
  const busy = accept.isPending || decline.isPending;

  if (!invitations.length) return null;

  const respond = async (orgId: number, answer: "accept" | "decline") => {
    try {
      await (answer === "accept" ? accept : decline).mutateAsync(orgId);
      await refreshUser();
    } catch {
      // The mutation already reported the error.
    }
  };

  return (
    <section aria-label="Workspace invitations" className="mb-6 space-y-2">
      {invitations.map((org) => (
        <div
          key={org.id}
          className="flex flex-col gap-3 rounded-2xl border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50 dark:bg-indigo-950/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <MailPlus className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <p className="text-xs text-slate-700 dark:text-slate-300">
              {org.invited_by ? (
                <strong className="text-slate-900 dark:text-white">{org.invited_by}</strong>
              ) : (
                "You were"
              )}{" "}
              {org.invited_by ? "invited you to join " : "invited to join "}
              <strong className="text-slate-900 dark:text-white">{org.name}</strong> as{" "}
              {roleLabel(org.role)}.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => respond(org.id, "decline")}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-50 cursor-pointer"
            >
              Decline
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => respond(org.id, "accept")}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
            >
              {accept.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              <span>Accept and switch</span>
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
