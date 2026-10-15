import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@taskdesk/libs", () => ({
  windowId: "test-window-id",
}));

import { getWsUrl, reconnectDelay } from "./use-project-websocket";

describe("getWsUrl", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a ws:// URL from an http API base", () => {
    expect(getWsUrl("project-123")).toBe(
      "ws://localhost:1337/api/ws/project-123?windowId=test-window-id",
    );
  });

  it("builds a wss:// URL from an https API base", () => {
    vi.stubEnv("VITE_API_URL", "https://example.com");
    expect(getWsUrl("project-123")).toBe(
      "wss://example.com/api/ws/project-123?windowId=test-window-id",
    );
  });

  it("does not append /api when the base already ends with /api", () => {
    vi.stubEnv("VITE_API_URL", "https://example.com/api");
    expect(getWsUrl("p1")).toBe(
      "wss://example.com/api/ws/p1?windowId=test-window-id",
    );
  });

  it("trims trailing slashes from the API base", () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1337///");
    expect(getWsUrl("p1")).toBe(
      "ws://localhost:1337/api/ws/p1?windowId=test-window-id",
    );
  });

  it("URL-encodes the projectId", () => {
    expect(getWsUrl("a b/c?d")).toBe(
      "ws://localhost:1337/api/ws/a%20b%2Fc%3Fd?windowId=test-window-id",
    );
  });

  it("builds an absolute ws(s) URL from a relative (same-origin) API base, and does not throw constructing a WebSocket", () => {
    vi.stubEnv("VITE_API_URL", "");
    const expectedScheme =
      window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = getWsUrl("project-123");
    expect(url).toBe(
      `${expectedScheme}//${window.location.host}/api/ws/project-123?windowId=test-window-id`,
    );
    expect(() => new WebSocket(url)).not.toThrow();
  });
});

describe("reconnectDelay", () => {
  it("backs off exponentially for ordinary closes", () => {
    const close = { code: 1006, reason: "" };
    expect([0, 1, 2, 3, 4].map((n) => reconnectDelay(close, n))).toEqual([
      1000, 2000, 4000, 8000, 16000,
    ]);
  });

  it("gives up after the retry budget", () => {
    expect(reconnectDelay({ code: 1006, reason: "" }, 5)).toBeNull();
  });

  it("retries a 1008 that is not the connection limit (for example lost authorization)", () => {
    expect(
      reconnectDelay({ code: 1008, reason: "authorization unavailable" }, 0),
    ).toBe(1000);
  });

  it("never retries a connection-limit close, whatever the retry count", () => {
    for (const retries of [0, 1, 4]) {
      expect(
        reconnectDelay({ code: 1008, reason: "connection limit" }, retries),
      ).toBeNull();
    }
  });

  it("does not treat the same reason under another code as terminal", () => {
    expect(reconnectDelay({ code: 1011, reason: "connection limit" }, 0)).toBe(
      1000,
    );
  });
});
