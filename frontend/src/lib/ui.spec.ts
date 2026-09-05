import { describe, it, expect } from "vitest";
import {
  initials,
  ROLE_LABELS,
  ROLE_COLORS,
  TASK_STATUS_LABELS,
  STATUS_DOT,
  PRIORITY_STYLES,
  TASK_TYPE_STYLES,
  TASK_COLUMNS,
  USER_STATUS_STYLES,
} from "./ui";

describe("Frontend UI Primitives & Mappings", () => {
  describe("initials()", () => {
    it("extracts first two initials for two-word names", () => {
      expect(initials("Marcus Aurelius")).toBe("MA");
      expect(initials("Sarah Jenkins")).toBe("SJ");
    });

    it("extracts first two letters for single-word names", () => {
      expect(initials("Antigravity")).toBe("AN");
      expect(initials("Cleopatra")).toBe("CL");
    });

    it("falls back to email prefix when name is empty", () => {
      expect(initials("", "devops@teamflow.dev")).toBe("DT");
      expect(initials("   ", "qa.lead@teamflow.dev")).toBe("QL");
    });

    it("returns '?' when both name and email are empty", () => {
      expect(initials("", "")).toBe("?");
      expect(initials("   ")).toBe("?");
    });
  });

  describe("Role Mappings", () => {
    it("defines distinct labels for all system roles", () => {
      expect(ROLE_LABELS.ceo).toContain("CEO");
      expect(ROLE_LABELS.tech_lead).toContain("Tech Lead");
      expect(ROLE_LABELS.backend).toContain("Backend");
      expect(ROLE_LABELS.frontend).toContain("Frontend");
      expect(ROLE_LABELS.qa).toContain("QA");
      expect(ROLE_LABELS.devops).toContain("DevOps");
      expect(ROLE_LABELS.seo).toContain("SEO");
    });

    it("defines distinct styling classes for all roles", () => {
      expect(ROLE_COLORS.ceo).toContain("purple");
      expect(ROLE_COLORS.tech_lead).toContain("indigo");
      expect(ROLE_COLORS.backend).toContain("blue");
      expect(ROLE_COLORS.frontend).toContain("cyan");
      expect(ROLE_COLORS.qa).toContain("emerald");
      expect(ROLE_COLORS.devops).toContain("orange");
    });
  });

  describe("Task & Kanban Columns", () => {
    it("defines the 5-stage Kanban flow in correct sequential order", () => {
      expect(TASK_COLUMNS).toEqual([
        "todo",
        "in_progress",
        "in_review",
        "qa",
        "done",
      ]);
    });

    it("maps all statuses to readable human labels", () => {
      expect(TASK_STATUS_LABELS.todo).toBe("To Do");
      expect(TASK_STATUS_LABELS.in_progress).toBe("In Progress");
      expect(TASK_STATUS_LABELS.in_review).toBe("In Review");
      expect(TASK_STATUS_LABELS.qa).toBe("QA / Ready for Test");
      expect(TASK_STATUS_LABELS.done).toBe("Done");
    });

    it("provides status dot colors for all states", () => {
      expect(STATUS_DOT.todo).toBe("bg-slate-500");
      expect(STATUS_DOT.done).toBe("bg-emerald-400");
    });
  });

  describe("Task Types and Priorities", () => {
    it("defines feature, bug, and task type styles", () => {
      expect(TASK_TYPE_STYLES.feature.label).toBe("Feature");
      expect(TASK_TYPE_STYLES.bug.label).toBe("Bug");
      expect(TASK_TYPE_STYLES.task.label).toBe("Task");
    });

    it("defines priority levels with appropriate styling", () => {
      expect(PRIORITY_STYLES.urgent.style).toContain("rose");
      expect(PRIORITY_STYLES.high.style).toContain("amber");
      expect(PRIORITY_STYLES.medium.style).toContain("blue");
      expect(PRIORITY_STYLES.low.style).toContain("slate");
    });
  });

  describe("User Status Styles", () => {
    it("provides status styles for active, offline, pending, disabled", () => {
      expect(USER_STATUS_STYLES.active.dot).toContain("emerald");
      expect(USER_STATUS_STYLES.offline.dot).toContain("slate");
      expect(USER_STATUS_STYLES.pending.dot).toContain("amber");
      expect(USER_STATUS_STYLES.disabled.dot).toContain("rose");
    });
  });
});
