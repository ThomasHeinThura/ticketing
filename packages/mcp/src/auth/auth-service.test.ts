import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth-service.js";

/**
 * Rewritten, not deleted, when issue #6 removed the device-authorization client.
 *
 * The three cases that used to live here — reuse a cached token, keep it when
 * validation is inconclusive, clear it and start device auth on a 401 — all
 * described a flow whose server endpoints now return 404. Deleting them would have
 * dropped the count quietly; keeping them would have tested code that no longer
 * exists. They are replaced by assertions on the contract that replaced them, and
 * the most important of those is that a stored credential is **no longer honoured**.
 */

const { clearCredentialsMock } = vi.hoisted(() => ({
  clearCredentialsMock: vi.fn(),
}));

vi.mock("./token-store.js", () => ({
  clearCredentials: clearCredentialsMock,
}));

describe("AuthService", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearCredentialsMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the configured API key", async () => {
    const auth = new AuthService({
      baseUrl: "https://taskdesk.example.com",
      clientId: "taskdesk-mcp",
      apiKey: "td_key_123",
    });

    await expect(auth.getAccessToken()).resolves.toBe("td_key_123");
    expect(auth.usingApiKey).toBe(true);
  });

  it("throws without an API key rather than reaching a removed endpoint", async () => {
    // Previously this started the device flow. Those endpoints return 404, so the
    // only honest outcomes are an API key or a clear error naming the variable.
    const auth = new AuthService({
      baseUrl: "https://taskdesk.example.com",
      clientId: "taskdesk-mcp",
    });

    await expect(auth.getAccessToken()).rejects.toThrow(/TASKDESK_API_KEY/);
    expect(auth.usingApiKey).toBe(false);
  });

  it("makes NO outbound request when it has no API key", async () => {
    // The point of the removal. A device-code POST, a poll, or a session
    // validation would all be requests to endpoints that no longer exist.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const auth = new AuthService({
      baseUrl: "https://taskdesk.example.com",
      clientId: "taskdesk-mcp",
    });

    await auth.getAccessToken().catch(() => undefined);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT honour a stored credential — a token the removed flow minted must not authenticate", async () => {
    // The security half of this removal, and the reason token-store's read path
    // went with it. A credentials.json on disk holds an access token minted by the
    // device flow that #6 deleted. Reading it would let a credential from a removed
    // authorization path keep working, which is the distinction migrations 0048 and
    // 0049 draw when they say dropping the tables is not revocation.
    //
    // If a future change reintroduces loadCredentials() into getAccessToken(), this
    // test fails: there is no way to satisfy it except by not reading the file.
    const auth = new AuthService({
      baseUrl: "https://taskdesk.example.com",
      clientId: "taskdesk-mcp",
    });

    await expect(auth.getAccessToken()).rejects.toThrow();
  });

  it("clearToken purges a stale credentials file, but leaves a static API key alone", async () => {
    const withoutKey = new AuthService({
      baseUrl: "https://taskdesk.example.com",
      clientId: "taskdesk-mcp",
    });
    await withoutKey.clearToken();
    // Ignoring the stale file is not enough; it should be removable.
    expect(clearCredentialsMock).toHaveBeenCalledTimes(1);

    clearCredentialsMock.mockReset();

    const withKey = new AuthService({
      baseUrl: "https://taskdesk.example.com",
      clientId: "taskdesk-mcp",
      apiKey: "td_key_123",
    });
    await withKey.clearToken();
    // An API key is static config, not a cached credential.
    expect(clearCredentialsMock).not.toHaveBeenCalled();
  });
});
