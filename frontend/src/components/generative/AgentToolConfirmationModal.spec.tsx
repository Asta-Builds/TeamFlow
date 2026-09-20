import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentToolConfirmationModal } from "./AgentToolConfirmationModal";
import type { ToolConfirmationRequest } from "@/lib/useAgentStream";

const request: ToolConfirmationRequest = {
  id: "approval-5",
  approvalId: 5,
  toolName: "release",
  title: "Release #12 to main",
  description: "Merge feat/ticket-12 at abc1234 into main, then request a staging deployment.",
  arguments: { branch: "feat/ticket-12", head_sha: "abc1234" },
  dangerLevel: "high",
};

function render(props: Partial<Parameters<typeof AgentToolConfirmationModal>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(AgentToolConfirmationModal, {
      request,
      onResolve: vi.fn(),
      onClose: vi.fn(),
      ...props,
    })
  );
}

describe("release approval modal", () => {
  it("shows the approve and reject actions to someone who may decide", () => {
    const html = render({ canDecide: true });
    expect(html).toContain("Approve Execution");
    expect(html).toContain("Reject Action");
    expect(html).not.toContain("Waiting for a workspace owner");
  });

  it("shows no buttons to someone who may not decide", () => {
    const html = render({ canDecide: false });
    expect(html).toContain("Waiting for a workspace owner or admin to approve this release.");
    expect(html).not.toContain("Approve Execution");
    expect(html).not.toContain("Reject Action");
  });

  it("keeps reject disabled until a reason is typed", () => {
    const html = render({ canDecide: true });
    // The reject button renders disabled while the reason field is empty.
    const rejectSegment = html.slice(0, html.indexOf("Reject Action"));
    expect(rejectSegment.lastIndexOf("disabled")).toBeGreaterThan(
      rejectSegment.lastIndexOf("<button")
    );
    expect(html).toContain("Reason (required to reject)");
  });

  it("says it is sending while a decision is in flight", () => {
    const html = render({ canDecide: true, busy: true });
    expect(html).toContain("Sending...");
  });

  it("describes the release being decided", () => {
    const html = render({ canDecide: true });
    expect(html).toContain("Release #12 to main");
    expect(html).toContain("abc1234");
  });
});
