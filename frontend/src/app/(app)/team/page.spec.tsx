import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Organization, User } from "@/lib/types";

const state = vi.hoisted(() => ({
  user: null as unknown as User,
  members: [] as User[],
  workspaces: [] as Organization[],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: state.user, refreshUser: vi.fn() }),
}));

vi.mock("@/lib/queries", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useTeamMembers: () => ({ data: state.members, isLoading: false }),
    useOrganizations: () => ({ data: state.workspaces }),
    useInviteMemberMutation: mutation,
    useUpdateMemberRoleMutation: mutation,
    useRemoveMemberMutation: mutation,
    useSwitchOrganizationMutation: mutation,
    useLeaveOrganizationMutation: mutation,
  };
});

import TeamPage from "./page";
import { WorkspaceInvitations } from "@/components/WorkspaceInvitations";

function person(id: number, name: string, role: User["role"], extra: Partial<User> = {}): User {
  return {
    id,
    name,
    email: `${name.split(" ")[0].toLowerCase()}@acme.test`,
    role,
    avatar_url: "",
    is_active: true,
    is_ai_agent: false,
    membership_status: "active",
    user_status: "active",
    ...extra,
  };
}

const owner = person(1, "Ada Owner", "ceo");
const admin = person(2, "Ari Admin", "admin");
const member = person(3, "Ben Builder", "member");
const invitee = person(4, "Cleo Designer", "member", { membership_status: "invited", user_status: "pending" });
const athena = person(5, "Athena", "pm", { is_ai_agent: true, agent_key: "pm", membership_status: null });

function text(markup: string) {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/** Manage buttons, not words such as Manager. */
function manageButtons(markup: string) {
  return text(markup).split(" ").filter((word) => word === "Manage").length;
}

const CARD = "flex flex-col justify-between rounded-2xl";

function cardFor(markup: string, name: string) {
  const start = markup.indexOf(`>${name}<`);
  expect(start).toBeGreaterThan(-1);
  const next = markup.indexOf(CARD, start);
  return text(markup.slice(start, next === -1 ? undefined : next));
}

describe("Team page", () => {
  beforeEach(() => {
    state.members = [owner, admin, member, invitee, athena];
  });

  it("tells people and AI agents apart by the agent flag", () => {
    state.user = owner;
    const markup = renderToStaticMarkup(createElement(TeamPage));
    const page = text(markup);

    expect(page).toContain("4 People · 1 AI Agent");
    expect(cardFor(markup, "Ben Builder")).toContain("Human");
    expect(cardFor(markup, "Ben Builder")).toContain("Member");
    expect(cardFor(markup, "Ben Builder")).not.toContain("AI");
    expect(cardFor(markup, "Ari Admin")).toContain("Admin");
    expect(cardFor(markup, "Ada Owner")).toContain("Human · CEO");
    expect(cardFor(markup, "Athena")).toContain("AI Agent");
    expect(cardFor(markup, "Athena")).toContain("AI Product Manager");
    expect(cardFor(markup, "Cleo Designer")).toContain("Invitation pending");
  });

  it("lets the CEO manage every other person but no AI agent", () => {
    state.user = owner;
    const markup = renderToStaticMarkup(createElement(TeamPage));
    expect(manageButtons(markup)).toBe(3);
    expect(manageButtons(cardFor(markup, "Athena"))).toBe(0);
    expect(text(markup)).toContain("Invite a Person");
  });

  it("lets admins manage members only", () => {
    state.user = admin;
    const markup = renderToStaticMarkup(createElement(TeamPage));
    expect(manageButtons(markup)).toBe(2);
    expect(manageButtons(cardFor(markup, "Ada Owner"))).toBe(0);
  });

  it("hides management from members", () => {
    state.user = member;
    const page = text(renderToStaticMarkup(createElement(TeamPage)));
    expect(manageButtons(page)).toBe(0);
    expect(page).not.toContain("Invite a Person");
  });
});

describe("Workspace invitations", () => {
  it("shows pending invitations with accept and decline", () => {
    state.workspaces = [
      { id: 1, name: "Home", subscription_tier: "starter", subscription_status: "active", created_at: "", role: "ceo", membership_status: "active" },
      { id: 2, name: "Acme Robotics", subscription_tier: "starter", subscription_status: "active", created_at: "", role: "admin", membership_status: "invited", invited_by: "Ada Owner" },
    ];
    const page = text(renderToStaticMarkup(createElement(WorkspaceInvitations)));
    expect(page).toContain("Ada Owner invited you to join Acme Robotics as Admin.");
    expect(page).toContain("Accept and switch");
    expect(page).toContain("Decline");
    expect(page).not.toContain("Home");
  });

  it("renders nothing without invitations", () => {
    state.workspaces = [
      { id: 1, name: "Home", subscription_tier: "starter", subscription_status: "active", created_at: "", role: "ceo", membership_status: "active" },
    ];
    expect(renderToStaticMarkup(createElement(WorkspaceInvitations))).toBe("");
  });
});
