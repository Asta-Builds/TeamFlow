import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/api", () => ({
  getQueueMetrics: vi.fn().mockResolvedValue({
    broker: { connected: true, broker_type: "RabbitMQ 3.13", broker_url: "amqp://test", error: null },
    queues: [{ name: "teamflow.tasks", messages: 5, consumers: 2, state: "running" }],
    dlq_summary: { total: 1, pending: 1, replayed: 0, purged: 0 },
    timestamp: "2026-09-18T18:00:00Z",
  }),
  getDeadLetterMessages: vi.fn().mockResolvedValue({
    results: [
      {
        id: 1,
        task_id: "task-uuid-test",
        task_name: "agents.execute_graph_run",
        queue_name: "teamflow.tasks",
        routing_key: "tasks",
        exchange: "teamflow.direct",
        payload: { task_id: 1 },
        args: [],
        kwargs: {},
        status: "pending",
        exception_class: "OperationalError",
        exception_message: "Connection timeout",
        traceback: "Traceback...",
        retry_count: 2,
        created_at: "2026-09-18T18:00:00Z",
        last_replayed_at: null,
      },
    ],
    count: 1,
  }),
  replayDeadLetterMessage: vi.fn().mockResolvedValue({ success: true, message: "Replayed" }),
  replayAllDeadLetters: vi.fn().mockResolvedValue({ message: "Replayed all", replayed_count: 1 }),
  purgeAllDeadLetters: vi.fn().mockResolvedValue({ message: "Purged", purged_count: 1 }),
  simulateTaskFailure: vi.fn().mockResolvedValue({ message: "Simulated", task_id: "sim-id" }),
}));

import QueuesPage from "./page";

describe("QueuesPage Component", () => {
  it("renders the RabbitMQ & DLQ dashboard structure", () => {
    const html = renderToStaticMarkup(createElement(QueuesPage));
    expect(html).toContain("RabbitMQ &amp; Dead Letter Queue");
    expect(html).toContain("Broker Topology");
    expect(html).toContain("teamflow.tasks");
    expect(html).toContain("AMQP 0-9-1");
    expect(html).toContain("Simulate Failure");
    expect(html).toContain("Replay All");
  });
});
