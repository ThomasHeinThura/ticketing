import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  assertNotificationHistorySession,
  captureNotificationHistoryRefresh,
  capturePersonalSelfHistoryRefresh,
  capturePreferencesHistoryRefresh,
  getNotificationHistory,
  getPersonalSelfHistory,
  getPreferencesHistory,
  getProfileHistory,
  notificationHistoryKey,
  personalSelfHistoryKey,
  preferencesHistoryKey,
} from "./personal-history";

it.each([
  [
    "security",
    "staff",
    "/api/me/settings/history?section=security",
    ["password", "mfa"],
  ],
  [
    "security",
    "portal",
    "/api/portal/account/settings-history?section=security",
    ["password"],
  ],
  [
    "apiKeys",
    "staff",
    "/api/me/settings/history?section=apiKeys",
    ["personalKey"],
  ],
] as const)(
  "reads closed %s %s history",
  async (section, audience, path, categories) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          section,
          lastChanged: {
            at: "2026-01-01T00:00:00Z",
            actor: "you",
            secret: "hidden",
          },
          rows: [
            {
              at: "2026-01-01T00:00:00Z",
              actor: "you",
              changedCategories: categories,
              keyId: "hidden",
              keyName: "hidden",
              capability: "hidden",
              ip: "hidden",
              secret: "hidden",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    const result = await getPersonalSelfHistory(section, audience, signal);
    expect(String(fetcher.mock.calls[0][0])).toContain(path);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      signal,
    });
    expect(result).toEqual({
      section,
      lastChanged: { at: "2026-01-01T00:00:00Z", actor: "you" },
      rows: [
        {
          at: "2026-01-01T00:00:00Z",
          actor: "you",
          changedCategories: [...categories],
        },
      ],
    });
  },
);

it("blocks portal API-key history and rejects foreign categories", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        section: "security",
        lastChanged: null,
        rows: [
          {
            at: "2026-01-01T00:00:00Z",
            actor: "you",
            changedCategories: ["personalKey"],
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  await expect(
    getPersonalSelfHistory("apiKeys", "portal", signal),
  ).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    getPersonalSelfHistory("security", "portal", signal),
  ).rejects.toThrow();
});

it("partitions P5 self history and marks only the captured key stale", async () => {
  const client = new QueryClient();
  const key = personalSelfHistoryKey(
    "security",
    "staff",
    "u",
    "s",
    "agent.example",
  );
  expect(key).not.toEqual(
    personalSelfHistoryKey("security", "portal", "u", "s", "agent.example"),
  );
  expect(key).not.toEqual(
    personalSelfHistoryKey("security", "staff", "u", "s2", "agent.example"),
  );
  expect(key).not.toEqual(
    personalSelfHistoryKey("security", "staff", "u", "s", "portal.example"),
  );
  expect(key).not.toEqual(
    personalSelfHistoryKey("apiKeys", "staff", "u", "s", "agent.example"),
  );
  const current = personalSelfHistoryKey("apiKeys", "staff", "u", "s");
  const other = personalSelfHistoryKey("apiKeys", "staff", "u", "s2");
  client.setQueryData(current, { rows: ["old"] });
  client.setQueryData(other, { rows: ["other session"] });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  auth.getSession.mockReset();
  capturePersonalSelfHistoryRefresh(client, "apiKeys", "staff", {
    user: { id: "u" },
    session: { id: "s" },
  })();
  // Only the exact captured key is cleared and marked for an active read; the read itself (and
  // its fresh session guard) belongs to the self query, so nothing is asked of the session here.
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({
    queryKey: current,
    exact: true,
    refetchType: "active",
  });
  expect(client.getQueryData(current)).toBeNull();
  expect(client.getQueryData(other)).toEqual({ rows: ["other session"] });
  expect(client.getQueryState(current)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  await Promise.resolve();
  expect(auth.getSession).not.toHaveBeenCalled();
  client.clear();
});

it("clears the captured self key after cancellation restores an in-flight query", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = personalSelfHistoryKey("security", "staff", "u", "s");
  const read = vi
    .fn()
    .mockResolvedValueOnce({ rows: ["old"] })
    // Every later read (the in-flight one, then the refresh's own) stays pending.
    .mockImplementation(() => new Promise(() => {}));
  const observer = new QueryObserver(client, { queryKey: key, queryFn: read });
  const stop = observer.subscribe(() => {});
  await vi.waitFor(() =>
    expect(client.getQueryData(key)).toEqual({ rows: ["old"] }),
  );
  void client.invalidateQueries({ queryKey: key });
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  auth.getSession.mockReset().mockImplementation(() => new Promise(() => {}));

  expect(
    capturePersonalSelfHistoryRefresh(client, "security", "staff", {
      user: { id: "u" },
      session: { id: "s" },
    })(),
  ).toBeUndefined();
  expect(client.getQueryData(key)).toBeNull();
  await Promise.resolve();
  expect(client.getQueryData(key)).toBeNull();
  stop();
  client.clear();
});

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { getSession: auth.getSession },
}));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: { getSession: auth.getSession },
}));

afterEach(() => vi.unstubAllGlobals());

it("rejects a changed host before requesting session data", async () => {
  auth.getSession.mockClear();
  await expect(
    assertNotificationHistorySession("portal", "u", "s", "another-host"),
  ).rejects.toMatchObject({ status: 403 });
  expect(auth.getSession).not.toHaveBeenCalled();
});

it.each(["staff", "portal"] as const)(
  "marks the captured %s session stale immediately and guards refresh",
  async (audience) => {
    const client = new QueryClient();
    const key = notificationHistoryKey(audience, "u", "s");
    client.setQueryData(key, { rows: [] });
    auth.getSession.mockReset().mockResolvedValue({
      data: { user: { id: "other" }, session: { id: "new" } },
      error: null,
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const refresh = captureNotificationHistoryRefresh(client, audience, {
      user: { id: "u" },
      session: { id: "s" },
    });
    refresh();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: key,
      exact: true,
      refetchType: "none",
    });
    await vi.waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: key,
      exact: true,
      refetchType: "active",
    });
    client.clear();
  },
);

it("does not wait for a stalled session check after a save", () => {
  const client = new QueryClient();
  auth.getSession.mockReset().mockImplementation(() => new Promise(() => {}));
  expect(
    captureNotificationHistoryRefresh(client, "staff", {
      user: { id: "u" },
      session: { id: "s" },
    })(),
  ).toBeUndefined();
  client.clear();
});

it("replaces an active initial read after a successful save", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = notificationHistoryKey("staff", "u", "s");
  auth.getSession.mockReset().mockResolvedValue({
    data: { user: { id: "u" }, session: { id: "s" } },
    error: null,
  });
  const read = vi
    .fn()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce({ rows: ["new"] });
  const observer = new QueryObserver(client, { queryKey: key, queryFn: read });
  const stop = observer.subscribe(() => {});
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  captureNotificationHistoryRefresh(client, "staff", {
    user: { id: "u" },
    session: { id: "s" },
  })();
  await vi.waitFor(() =>
    expect(client.getQueryData(key)).toEqual({ rows: ["new"] }),
  );
  stop();
  client.clear();
});

it.each([
  ["staff", "/api/me/settings/history?section=notifications"],
  ["portal", "/api/portal/account/settings-history?section=notifications"],
] as const)("reads the %s notification projection", async (audience, path) => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        section: "notifications",
        lastChanged: null,
        rows: [
          {
            at: "2026-01-01T00:00:00Z",
            actor: "you",
            changedCategories: [
              "delivery",
              "digest",
              "quietHours",
              "workspaceRule",
            ],
            value: "private",
            actorId: "private",
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  const result = await getNotificationHistory(audience, signal);
  expect(String(fetcher.mock.calls[0][0])).toContain(path);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: "include",
    signal,
  });
  expect(result.rows[0]).toEqual({
    at: "2026-01-01T00:00:00Z",
    actor: "you",
    changedCategories: ["delivery", "digest", "quietHours", "workspaceRule"],
  });
});

it("isolates notification cache keys by audience, host and session", () => {
  const key = notificationHistoryKey("staff", "u", "s", "agent.example");
  expect(key).not.toEqual(
    notificationHistoryKey("portal", "u", "s", "agent.example"),
  );
  expect(key).not.toEqual(
    notificationHistoryKey("staff", "u", "s2", "agent.example"),
  );
  expect(key).not.toEqual(
    notificationHistoryKey("staff", "u", "s", "portal.example"),
  );
});

it("rejects unknown notification categories and propagates refusals", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          section: "notifications",
          lastChanged: null,
          rows: [
            {
              at: "2026-01-01T00:00:00Z",
              actor: "you",
              changedCategories: ["private"],
            },
          ],
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  await expect(getNotificationHistory("staff", signal)).rejects.toThrow();
  await expect(getNotificationHistory("portal", signal)).rejects.toMatchObject({
    status: 403,
  });
});
it("accepts only the profile projection and strips unrelated data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          section: "profile",
          lastChanged: null,
          rows: [
            {
              at: "2026-01-01T00:00:00Z",
              actor: "you",
              changedFields: ["name"],
              value: "private",
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  const result = await getProfileHistory(new AbortController().signal);
  expect(result.rows[0]).toEqual({
    at: "2026-01-01T00:00:00Z",
    actor: "you",
    changedFields: ["name"],
  });
});
it("rejects other sections and unapproved fields", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          section: "profile",
          lastChanged: null,
          rows: [
            {
              at: "2026-01-01T00:00:00Z",
              actor: "you",
              changedFields: ["password"],
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  await expect(
    getProfileHistory(new AbortController().signal),
  ).rejects.toThrow();
});
it("loads only the closed preference field projection without values or project ids", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          section: "preferences",
          lastChanged: null,
          rows: [
            {
              at: "2026-01-01T00:00:00Z",
              actor: "you",
              changedFields: [
                "density",
                "layout",
                "listGroups",
                "columns",
                "columnWidths",
              ],
              projectId: "private",
              value: "private",
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  const signal = new AbortController().signal;
  const result = await getPreferencesHistory(signal);
  expect(result.rows[0]).not.toHaveProperty("projectId");
  expect(result.rows[0]).not.toHaveProperty("value");
  expect(result.rows[0].changedFields).toEqual([
    "density",
    "layout",
    "listGroups",
    "columns",
    "columnWidths",
  ]);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("me/settings/history?section=preferences"),
    { credentials: "include", signal },
  );
});
it("rejects unapproved preference fields", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          section: "preferences",
          lastChanged: null,
          rows: [
            {
              at: "2026-01-01T00:00:00Z",
              actor: "you",
              changedFields: ["theme"],
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  await expect(
    getPreferencesHistory(new AbortController().signal),
  ).rejects.toThrow();
});
it("marks captured preference session stale without refreshing a different identity", async () => {
  const client = new QueryClient();
  const oldKey = preferencesHistoryKey("u1", "s1");
  const newKey = preferencesHistoryKey("u2", "s2");
  client.setQueryData(oldKey, { rows: [] });
  client.setQueryData(newKey, { rows: [] });
  auth.getSession.mockResolvedValue({
    data: { user: { id: "u2" }, session: { id: "s2" } },
    error: null,
  });
  const captured = capturePreferencesHistoryRefresh(client, {
    user: { id: "u1" },
    session: { id: "s1" },
  });
  captured();
  expect(client.getQueryState(oldKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(newKey)?.isInvalidated).toBe(false);
});
