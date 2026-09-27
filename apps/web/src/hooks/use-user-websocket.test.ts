import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@taskdesk/libs", () => ({
  windowId: "test-window-id",
}));

import { getUserWsUrl } from "./use-user-websocket";

describe("getUserWsUrl", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a ws:// URL from an http API base", () => {
    expect(getUserWsUrl()).toBe(
      "ws://localhost:1337/api/ws/user?windowId=test-window-id",
    );
  });

  it("builds a wss:// URL from an https API base", () => {
    vi.stubEnv("VITE_API_URL", "https://example.com");
    expect(getUserWsUrl()).toBe(
      "wss://example.com/api/ws/user?windowId=test-window-id",
    );
  });

  it("builds an absolute ws(s) URL from a relative (same-origin) API base, and does not throw constructing a WebSocket", () => {
    vi.stubEnv("VITE_API_URL", "");
    const expectedScheme =
      window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = getUserWsUrl();
    expect(url).toBe(
      `${expectedScheme}//${window.location.host}/api/ws/user?windowId=test-window-id`,
    );
    expect(() => new WebSocket(url)).not.toThrow();
  });
});
