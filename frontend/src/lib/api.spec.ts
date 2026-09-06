import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage and window for Node test runner
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

Object.defineProperty(global, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

Object.defineProperty(global, "window", {
  value: { localStorage: mockLocalStorage },
  writable: true,
});

import { normalizeList, ApiError, getToken, setTokens, clearTokens, apiFetch, loginWithClerkSession } from "./api";

describe("Frontend API Client & Utilities", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.restoreAllMocks();
  });

  describe("normalizeList()", () => {
    it("returns empty array for null or undefined", () => {
      expect(normalizeList(null)).toEqual([]);
      expect(normalizeList(undefined)).toEqual([]);
    });

    it("returns the array untouched if input is already an array", () => {
      const items = [{ id: 1, name: "Task 1" }, { id: 2, name: "Task 2" }];
      expect(normalizeList(items)).toEqual(items);
    });

    it("unwraps DRF paginated responses containing a 'results' array", () => {
      const paginated = {
        count: 2,
        next: null,
        previous: null,
        results: [{ id: 1, title: "Bug" }, { id: 2, title: "Feature" }],
      };
      expect(normalizeList(paginated)).toEqual(paginated.results);
    });

    it("returns empty array for invalid object formats or primitives", () => {
      expect(normalizeList("not-an-array")).toEqual([]);
      expect(normalizeList(12345)).toEqual([]);
      expect(normalizeList({ error: "Failed" })).toEqual([]);
      expect(normalizeList({ results: "not-an-array" })).toEqual([]);
    });
  });

  describe("ApiError", () => {
    it("encapsulates HTTP status code, message, and error body data", () => {
      const payload = { detail: "Authentication credentials were not provided." };
      const err = new ApiError(401, payload);

      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("Error");
      expect(err.status).toBe(401);
      expect(err.message).toBe("API error 401");
      expect(err.data).toEqual(payload);
    });
  });

  describe("Token Management", () => {
    it("stores and retrieves access and refresh tokens in localStorage", () => {
      expect(getToken()).toBeNull();

      setTokens("mock_access_token", "mock_refresh_token");
      expect(getToken()).toBe("mock_access_token");
      expect(mockLocalStorage.getItem("teamflow_refresh")).toBe("mock_refresh_token");

      clearTokens();
      expect(getToken()).toBeNull();
      expect(mockLocalStorage.getItem("teamflow_refresh")).toBeNull();
    });

    it("updates only access token if refresh token is omitted", () => {
      setTokens("initial_access", "initial_refresh");
      setTokens("new_access");

      expect(getToken()).toBe("new_access");
      expect(mockLocalStorage.getItem("teamflow_refresh")).toBe("initial_refresh");
    });
  });

  describe("apiFetch()", () => {
    it("includes Authorization header when token is set and auth is true", async () => {
      setTokens("test_jwt_token");

      const mockResponse = { id: 101, name: "Alpha Project" };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });
      global.fetch = fetchMock;

      const result = await apiFetch("/projects/101/");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain("/projects/101/");
      expect(calledOptions.headers.Authorization).toBe("Bearer test_jwt_token");
      expect(result).toEqual(mockResponse);
    });

    it("omits Authorization header when auth is set to false", async () => {
      setTokens("test_jwt_token");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ token: "new" }),
      });
      global.fetch = fetchMock;

      await apiFetch("/auth/login/", { method: "POST", auth: false });

      const [, calledOptions] = fetchMock.mock.calls[0];
      expect(calledOptions.headers.Authorization).toBeUndefined();
    });

    it("throws ApiError when server returns non-2xx status code", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: "Permission denied for this organization." }),
      });
      global.fetch = fetchMock;

      await expect(apiFetch("/tasks/999/")).rejects.toThrow(ApiError);
    });
  });

  describe("loginWithClerkSession()", () => {
    it("exchanges Clerk credentials for TeamFlow JWT and persists tokens", async () => {
      const mockAuthResponse = {
        access: "teamflow_jwt_access_clerk",
        refresh: "teamflow_jwt_refresh_clerk",
        user: { id: 42, email: "clerk.dev@teamflow.dev", name: "Clerk Dev", role: "member" },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAuthResponse,
      });
      global.fetch = fetchMock;

      const payload = {
        token: "clerk_test_jwt",
        clerk_id: "user_2test123",
        email: "clerk.dev@teamflow.dev",
        name: "Clerk Dev",
        avatar_url: "https://img.clerk.com/test.png",
      };

      const result = await loginWithClerkSession(payload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain("/auth/clerk/");
      expect(calledOptions.method).toBe("POST");
      expect(calledOptions.headers.Authorization).toBeUndefined();
      expect(JSON.parse(calledOptions.body)).toEqual(payload);
      expect(result).toEqual(mockAuthResponse);
      expect(getToken()).toBe("teamflow_jwt_access_clerk");
    });
  });
});
