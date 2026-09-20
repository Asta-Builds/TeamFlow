import { describe, it, expect, beforeEach, vi } from "vitest";

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => storage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storage[key] = String(value);
  }),
  removeItem: vi.fn((key: string) => {
    delete storage[key];
  }),
  clear: vi.fn(() => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  }),
};

Object.defineProperty(global, "localStorage", { value: mockLocalStorage, writable: true });
Object.defineProperty(global, "window", { value: { localStorage: mockLocalStorage }, writable: true });

import { listApprovals, approveRelease, rejectRelease, ApiError } from "./api";

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: { get: () => "application/json" },
  } as unknown as Response;
}

describe("release approval API client", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.restoreAllMocks();
  });

  it("asks only for the pending approvals of one ticket", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await listApprovals({ taskId: 12, status: "pending" });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/agents/approvals?task=12&status=pending");
  });

  it("approves by id and sends the reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 5, status: "approved" }));
    vi.stubGlobal("fetch", fetchMock);

    await approveRelease(5, "ship it");

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/agents/approvals/5/approve");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ reason: "ship it" });
  });

  it("rejects by id with the typed reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 5, status: "rejected" }));
    vi.stubGlobal("fetch", fetchMock);

    await rejectRelease(5, "needs a migration plan");

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/agents/approvals/5/reject");
    expect(JSON.parse(options.body)).toEqual({ reason: "needs a migration plan" });
  });

  it("surfaces a conflict instead of pretending the decision landed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: "This approval was already decided." }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(approveRelease(5)).rejects.toBeInstanceOf(ApiError);
  });
});
