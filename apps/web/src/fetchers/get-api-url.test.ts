import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiUrl, toWebSocketBase } from "./get-api-url";

describe("getApiUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

  it("uses wss when the same-origin API is served from a secure page", () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:", host: "tickets.example" },
    });

    expect(toWebSocketBase("/api/ws")).toBe("wss://tickets.example/api/ws");
  });
});
