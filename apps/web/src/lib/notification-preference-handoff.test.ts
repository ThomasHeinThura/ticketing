import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeNotificationPreferenceHandoff } from "./notification-preference-handoff";

const entry = "/dashboard/settings/account/notifications";
/** Emails sent before L-03 link to the old profile URL. */
const legacyEntry = "/agent/settings/profile/notifications";
const capability = "signed_payload.signature";
const response = (status: number, body?: unknown) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

beforeEach(() => {
  window.history.replaceState({ previous: "retained" }, "", entry);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("notification preference email handoff", () => {
  it("does nothing without a capability fragment", async () => {
    const fetcher = vi.fn();
    await initializeNotificationPreferenceHandoff(window, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("synchronously removes the fragment before issuing same-origin requests", async () => {
    window.history.replaceState(
      { previous: "retained" },
      "",
      `${entry}?keep=yes#preference_token=${capability}`,
    );
    const fetcher = vi.fn().mockImplementation(() => {
      expect(window.location.hash).toBe("");
      return Promise.resolve(response(401));
    });
    const promise = initializeNotificationPreferenceHandoff(window, fetcher);
    expect(window.location.href).not.toContain(capability);
    expect(window.location.search).toBe("?keep=yes");
    expect(window.history.state).toEqual({ previous: "retained" });
    await promise;
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/me/csrf-token",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/public/agent/notification-preference-handoffs",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        referrerPolicy: "no-referrer",
        body: JSON.stringify({ token: capability }),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }),
    );
  });

  it("uses an authenticated session's issued CSRF token and never reads the generic handoff body", async () => {
    window.history.replaceState(
      null,
      "",
      `${entry}#preference_token=${capability}`,
    );
    const handedOff = response(202, { accepted: true });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          token: "session-csrf",
          expiresAt: "2026-10-22T12:00:00Z",
        }),
      )
      .mockResolvedValueOnce(handedOff);
    await initializeNotificationPreferenceHandoff(window, fetcher);
    expect(fetcher.mock.calls[1][1].headers["x-taskdesk-csrf"]).toBe(
      "session-csrf",
    );
    expect(handedOff.json).not.toHaveBeenCalled();
  });

  it("exchanges a portal capability through the customer origin-specific routes", async () => {
    window.history.replaceState(
      null,
      "",
      `/account#preference_token=${capability}`,
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          token: "portal-csrf",
          expiresAt: "2026-10-22T12:00:00Z",
        }),
      )
      .mockResolvedValueOnce(response(202, { accepted: true }));
    await initializeNotificationPreferenceHandoff(window, fetcher);
    expect(window.location.hash).toBe("");
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/portal/csrf-token",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/public/portal/notification-preference-handoffs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: capability }),
        headers: expect.objectContaining({ "x-taskdesk-csrf": "portal-csrf" }),
      }),
    );
  });

  it.each([403, 404, 429, 500])(
    "does not POST when CSRF bootstrap returns %i",
    async (status) => {
      window.history.replaceState(
        null,
        "",
        `${entry}#preference_token=${capability}`,
      );
      const fetcher = vi.fn().mockResolvedValue(response(status));
      await initializeNotificationPreferenceHandoff(window, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe("");
    },
  );

  it.each([
    {},
    { token: "" },
    { token: "csrf" },
    { token: 1, expiresAt: "time" },
  ])("fails closed for a malformed issuer payload %j", async (payload) => {
    window.history.replaceState(
      null,
      "",
      `${entry}#preference_token=${capability}`,
    );
    const fetcher = vi.fn().mockResolvedValue(response(200, payload));
    await initializeNotificationPreferenceHandoff(window, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    "",
    "invalid",
    `${capability}&preference_token=another.signature`,
    "a".repeat(4097),
  ])(
    "removes invalid or duplicate capabilities without a request",
    async (fragment) => {
      window.history.replaceState(
        null,
        "",
        `${entry}#preference_token=${fragment}`,
      );
      const fetcher = vi.fn();
      await initializeNotificationPreferenceHandoff(window, fetcher);
      expect(window.location.hash).toBe("");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("strips but does not exchange a capability from another agent route", async () => {
    window.history.replaceState(
      null,
      "",
      `/agent/my-work#preference_token=${capability}`,
    );
    const fetcher = vi.fn();
    await initializeNotificationPreferenceHandoff(window, fetcher);
    expect(window.location.hash).toBe("");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps auth continuation waiting until the POST completes", async () => {
    window.history.replaceState(
      null,
      "",
      `${entry}#preference_token=${capability}`,
    );
    let complete!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockReturnValueOnce(pending);
    const authContinuation = vi.fn();
    const initialized = initializeNotificationPreferenceHandoff(
      window,
      fetcher,
    ).then(authContinuation);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(authContinuation).not.toHaveBeenCalled();
    complete(response(202));
    await initialized;
    expect(authContinuation).toHaveBeenCalledOnce();
  });

  it("aborts a stalled issuer at the deadline and never starts a late POST", async () => {
    vi.useFakeTimers();
    window.history.replaceState(
      null,
      "",
      `${entry}#preference_token=${capability}`,
    );
    let complete!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const continuation = vi.fn();
    const initialized = initializeNotificationPreferenceHandoff(
      window,
      fetcher,
      100,
    ).then(continuation);
    await vi.advanceTimersByTimeAsync(100);
    await initialized;
    expect(continuation).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    complete(response(401));
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled POST at the deadline without blocking login indefinitely", async () => {
    vi.useFakeTimers();
    window.history.replaceState(
      null,
      "",
      `${entry}#preference_token=${capability}`,
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockImplementationOnce(() => new Promise(() => {}));
    const initialized = initializeNotificationPreferenceHandoff(
      window,
      fetcher,
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    await initialized;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it("does not persist capabilities or log transport errors", async () => {
    window.history.replaceState(
      null,
      "",
      `${entry}#preference_token=${capability}`,
    );
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "error");
    const fetcher = vi.fn().mockRejectedValue(new Error(capability));
    await expect(
      initializeNotificationPreferenceHandoff(window, fetcher),
    ).resolves.toBeUndefined();
    expect(storage).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("prevents auth continuation if safe fragment removal is unavailable", async () => {
    window.history.replaceState(
      null,
      "",
      `${entry}#preference_token=${capability}`,
    );
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new Error(capability);
    });
    const fetcher = vi.fn();
    const continuation = vi.fn();
    await expect(
      initializeNotificationPreferenceHandoff(window, fetcher).then(
        continuation,
      ),
    ).rejects.toThrow("Unable to initialize notification preferences");
    expect(continuation).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("still exchanges the capability on the pre-L-03 agent email link", async () => {
    window.history.replaceState(
      null,
      "",
      `${legacyEntry}#preference_token=${capability}`,
    );
    const fetcher = vi.fn().mockResolvedValue(response(401));
    await initializeNotificationPreferenceHandoff(window, fetcher);
    expect(window.location.hash).toBe("");
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/public/agent/notification-preference-handoffs",
      expect.objectContaining({ body: JSON.stringify({ token: capability }) }),
    );
  });
});
