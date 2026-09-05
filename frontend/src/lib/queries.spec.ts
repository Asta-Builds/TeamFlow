import { describe, it, expect } from "vitest";
import { queryKeys } from "./queries";

describe("TanStack Query Keys Configuration", () => {
  it("generates deterministic query keys for collections", () => {
    expect(queryKeys.projects).toEqual(["projects"]);
    expect(queryKeys.deployments).toEqual(["deployments"]);
    expect(queryKeys.seoAudits).toEqual(["seo-audits"]);
    expect(queryKeys.notifications).toEqual(["notifications"]);
    expect(queryKeys.team).toEqual(["team"]);
    expect(queryKeys.activityFeed).toEqual(["activity-feed"]);
  });

  it("generates scoped keys for individual entities by ID", () => {
    expect(queryKeys.project(42)).toEqual(["projects", 42]);
    expect(queryKeys.task(108)).toEqual(["tasks", "detail", 108]);
  });

  it("generates conditional task filter query keys", () => {
    expect(queryKeys.tasks()).toEqual(["tasks"]);
    expect(queryKeys.tasks(99)).toEqual(["tasks", { projectId: 99 }]);
  });

  it("generates date-scoped pulse dashboard keys", () => {
    const today = "2026-09-05";
    expect(queryKeys.pulseDashboard(today)).toEqual(["pulse", "dashboard", today]);
  });
});
