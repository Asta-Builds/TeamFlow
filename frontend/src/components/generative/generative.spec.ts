import { describe, it, expect } from "vitest";
import type { ValidationContractData } from "./ValidationContractCard";
import type { PullRequestData } from "./PullRequestCard";
import type { LangfuseSessionData } from "./LangfuseSessionCard";
import type { DeploymentCardData } from "./DeploymentStatusCard";

describe("Generative UI Components & Data Contracts", () => {
  describe("ValidationContractCard Logic", () => {
    it("computes verification criteria score correctly", () => {
      const contract: ValidationContractData = {
        title: "Test Contract",
        qa_status: "pending",
        items: [
          { id: "1", label: "Requirement 1", passed: true },
          { id: "2", label: "Requirement 2", passed: false, blocker: true },
          { id: "3", label: "Requirement 3", passed: true },
          { id: "4", label: "Requirement 4", passed: false },
        ],
      };

      const passed = contract.items.filter((i) => i.passed).length;
      const total = contract.items.length;
      const score = Math.round((passed / total) * 100);

      expect(passed).toBe(2);
      expect(total).toBe(4);
      expect(score).toBe(50);
      expect(contract.items.some((i) => !i.passed && i.blocker)).toBe(true);
    });

    it("identifies fully passed contracts with no blockers", () => {
      const contract: ValidationContractData = {
        qa_status: "passed",
        items: [
          { id: "1", label: "Auth check", passed: true },
          { id: "2", label: "Rate limiting", passed: true },
        ],
      };

      const isFullyPassed = contract.items.every((i) => i.passed);
      expect(isFullyPassed).toBe(true);
    });
  });

  describe("PullRequestCard Data Structure", () => {
    it("structures branch routing and diff counters", () => {
      const prData: PullRequestData = {
        title: "feat(auth): add JWT rotation",
        branch: "feat/frontend-12-auth",
        target_branch: "main",
        status: "open",
        additions: 142,
        deletions: 18,
        changed_files_count: 5,
      };

      expect(prData.branch).toBe("feat/frontend-12-auth");
      expect(prData.target_branch).toBe("main");
      expect(prData.additions).toBeGreaterThan(prData.deletions!);
      expect(prData.status).toBe("open");
    });
  });

  describe("LangfuseSessionCard Observability", () => {
    it("constructs deep-link search URI when langfuse_url is absent", () => {
      const sessionData: LangfuseSessionData = {
        session_id: "ticket-101-9a8b7c",
        total_tokens: 3420,
        cost_usd: 0.0042,
        duration_seconds: 2.15,
      };

      const hostUrl =
        sessionData.langfuse_url ||
        `http://localhost:3001/project/teamflow/traces?search=${encodeURIComponent(
          sessionData.session_id
        )}`;

      expect(hostUrl).toContain("http://localhost:3001/project/teamflow/traces");
      expect(hostUrl).toContain("ticket-101-9a8b7c");
      expect(typeof sessionData.cost_usd).toBe("number");
    });
  });

  describe("DeploymentStatusCard Logic", () => {
    it("manages environment targets and pipeline stages", () => {
      const deployData: DeploymentCardData = {
        environment: "production",
        status: "deployed",
        version: "v1.4.2",
        commit_hash: "a1b2c3d4e5f6",
        stages: [
          { name: "Lint", status: "success", duration_seconds: 8 },
          { name: "Test", status: "success", duration_seconds: 14 },
          { name: "Docker Build", status: "success", duration_seconds: 35 },
        ],
      };

      expect(deployData.environment).toBe("production");
      expect(deployData.status).toBe("deployed");
      expect(deployData.stages?.length).toBe(3);
      expect(deployData.commit_hash?.slice(0, 7)).toBe("a1b2c3d");
    });
  });
});
