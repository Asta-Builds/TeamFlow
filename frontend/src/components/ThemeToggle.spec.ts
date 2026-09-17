import { describe, it, expect } from "vitest";
import { ThemeToggle } from "./ThemeToggle";
import { ThemeProvider } from "@/lib/providers/theme-provider";
import { AppToaster } from "./AppToaster";
import {
  ROLE_COLORS,
  USER_STATUS_STYLES,
  TASK_TYPE_STYLES,
  PRIORITY_STYLES,
} from "@/lib/ui";
import { buttonVariants } from "./ui/button";
import { badgeVariants } from "./ui/badge";
import { selectVariants } from "./ui/select";
import { tabsTriggerVariants } from "./ui/tabs";

describe("Theme System & Light Mode (Mode Clair) Tokens", () => {
  describe("Component Exports", () => {
    it("exports ThemeToggle and ThemeProvider as valid React components", () => {
      expect(ThemeToggle).toBeDefined();
      expect(typeof ThemeToggle).toBe("function");
      expect(ThemeProvider).toBeDefined();
      expect(typeof ThemeProvider).toBe("function");
      expect(AppToaster).toBeDefined();
      expect(typeof AppToaster).toBe("function");
    });
  });

  describe("Dual Mode Design Tokens", () => {
    it("includes light mode and dark mode classes in buttonVariants", () => {
      const secondary = buttonVariants({ variant: "secondary" });
      expect(secondary).toContain("bg-slate-100");
      expect(secondary).toContain("dark:bg-slate-800");

      const outline = buttonVariants({ variant: "outline" });
      expect(outline).toContain("border-slate-300");
      expect(outline).toContain("dark:border-slate-800");

      const ghost = buttonVariants({ variant: "ghost" });
      expect(ghost).toContain("text-slate-600");
      expect(ghost).toContain("dark:text-slate-400");
    });

    it("includes light mode and dark mode classes in selectVariants", () => {
      const select = selectVariants();
      expect(select).toContain("bg-white");
      expect(select).toContain("dark:bg-slate-900/90");
      expect(select).toContain("text-slate-900");
      expect(select).toContain("dark:text-white");
    });

    it("includes light mode and dark mode classes in tabsTriggerVariants", () => {
      const activeTab = tabsTriggerVariants({ active: true });
      expect(activeTab).toContain("bg-white");
      expect(activeTab).toContain("dark:bg-slate-800");
      expect(activeTab).toContain("text-slate-900");
      expect(activeTab).toContain("dark:text-white");

      const inactiveTab = tabsTriggerVariants({ active: false });
      expect(inactiveTab).toContain("text-slate-600");
      expect(inactiveTab).toContain("dark:text-slate-400");
    });

    it("provides accessible light and dark contrast classes for all roles", () => {
      Object.entries(ROLE_COLORS).forEach(([role, classes]) => {
        expect(classes).toContain("dark:");
        expect(classes).toContain("border-");
        expect(classes).toContain("text-");
      });
    });

    it("provides dual-mode colors for user statuses and task types", () => {
      expect(USER_STATUS_STYLES.active.badge).toContain("dark:");
      expect(USER_STATUS_STYLES.offline.badge).toContain("dark:");
      expect(TASK_TYPE_STYLES.feature.style).toContain("dark:");
      expect(TASK_TYPE_STYLES.bug.style).toContain("dark:");
      expect(PRIORITY_STYLES.urgent.style).toContain("dark:");
    });
  });
});
