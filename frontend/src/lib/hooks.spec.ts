import { describe, it, expect } from "vitest";
import { useDebounce, useMounted, useMediaQuery, useLocalStorage } from "./hooks";

describe("Custom React Hooks (Phase 1.4)", () => {
  it("exports all expected hook functions", () => {
    expect(typeof useDebounce).toBe("function");
    expect(typeof useMounted).toBe("function");
    expect(typeof useMediaQuery).toBe("function");
    expect(typeof useLocalStorage).toBe("function");
  });
});
