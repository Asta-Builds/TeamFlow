import { describe, it, expect } from "vitest";
import { buttonVariants } from "./button";
import { badgeVariants } from "./badge";
import { getInitials } from "./avatar";
import { cn } from "@/lib/utils";

describe("Component Library Primitives (Phase 6 Design Tokens)", () => {
  describe("cn utility", () => {
    it("merges conditional and conflicting Tailwind classes", () => {
      expect(cn("px-2 py-1", "bg-indigo-600")).toContain("px-2 py-1 bg-indigo-600");
      expect(cn("px-2", true && "px-4")).toBe("px-4"); // twMerge resolves conflict
      expect(cn("text-sm", false && "text-lg")).toBe("text-sm");
    });
  });

  describe("buttonVariants (CVA)", () => {
    it("generates default button variant classes", () => {
      const classes = buttonVariants();
      expect(classes).toContain("bg-indigo-600");
      expect(classes).toContain("h-9");
      expect(classes).toContain("focus-visible:ring-2");
    });

    it("generates secondary button variant classes", () => {
      const classes = buttonVariants({ variant: "secondary" });
      expect(classes).toContain("bg-slate-800");
      expect(classes).toContain("border-slate-700");
    });

    it("generates danger button variant classes", () => {
      const classes = buttonVariants({ variant: "danger" });
      expect(classes).toContain("text-rose-300");
    });

    it("supports various size options", () => {
      expect(buttonVariants({ size: "sm" })).toContain("h-8");
      expect(buttonVariants({ size: "lg" })).toContain("h-11");
      expect(buttonVariants({ size: "icon" })).toContain("w-8 p-0");
    });
  });

  describe("badgeVariants (CVA)", () => {
    it("generates default and semantic variants", () => {
      expect(badgeVariants({ variant: "default" })).toContain("bg-slate-900");
      expect(badgeVariants({ variant: "indigo" })).toContain("indigo");
      expect(badgeVariants({ variant: "success" })).toContain("emerald");
      expect(badgeVariants({ variant: "warning" })).toContain("amber");
      expect(badgeVariants({ variant: "danger" })).toContain("rose");
    });

    it("supports size variations", () => {
      expect(badgeVariants({ size: "sm" })).toContain("text-[10px]");
      expect(badgeVariants({ size: "lg" })).toContain("text-xs");
    });
  });

  describe("Avatar getInitials()", () => {
    it("formats two-word names", () => {
      expect(getInitials("DevOps Engineer")).toBe("DE");
      expect(getInitials("Ada Lovelace")).toBe("AL");
    });

    it("formats single-word names", () => {
      expect(getInitials("TeamFlow")).toBe("TE");
    });

    it("falls back to email address when name is missing", () => {
      expect(getInitials("", "tech_lead@teamflow.dev")).toBe("TL");
    });

    it("returns '?' when both inputs are blank", () => {
      expect(getInitials("", "")).toBe("?");
    });
  });
});
