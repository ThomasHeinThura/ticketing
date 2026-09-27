import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiUrl } from "./get-api-url";

describe("getApiUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats an explicitly empty VITE_API_URL as relative, not as unset", () => {
    vi.stubEnv("VITE_API_URL", "");
    expect(getApiUrl("workspaces")).toBe("/api/workspaces");
  });

  it("falls back to the dev default when VITE_API_URL is genuinely unset", () => {
    vi.stubEnv("VITE_API_URL", undefined);
    expect(getApiUrl("workspaces")).toBe(
      "http://localhost:1337/api/workspaces",
    );
  });
});
