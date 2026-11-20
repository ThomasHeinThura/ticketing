import { notifyManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./index";

describe("query client notification scheduling", () => {
  it("delivers observer notifications in a microtask, before any timer", async () => {
    const order: string[] = [];
    setTimeout(() => order.push("timer"), 0);
    notifyManager.schedule(() => order.push("notify"));
    await Promise.resolve();
    expect(order).toEqual(["notify"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(["notify", "timer"]);
  });
});

describe("query retry policy (A-04, A-11)", () => {
  it("never retries a final refusal, but still retries server and transient errors", async () => {
    const { shouldRetryQuery } = await import("./index");
    const { HttpError } = await import("@/lib/http-error");
    for (const status of [400, 401, 403, 404, 409, 422])
      expect(shouldRetryQuery(0, new HttpError(status, "refused"))).toBe(false);
    for (const status of [408, 429, 500, 503])
      expect(shouldRetryQuery(0, new HttpError(status, "transient"))).toBe(
        true,
      );
    expect(shouldRetryQuery(2, new HttpError(500, "still down"))).toBe(false);
    expect(shouldRetryQuery(0, new Error("unexpected"))).toBe(true);
  });

  it("retries a dropped request twice while online, never while offline", async () => {
    const { shouldRetryQuery } = await import("./index");
    const dropped = new TypeError("Failed to fetch");
    expect(shouldRetryQuery(0, dropped)).toBe(true);
    expect(shouldRetryQuery(1, dropped)).toBe(true);
    expect(shouldRetryQuery(2, dropped)).toBe(false);
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      expect(shouldRetryQuery(0, dropped)).toBe(false);
    } finally {
      onLine.mockRestore();
    }
  });
});

describe("query cache error log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not log a module that is switched off (feature_disabled), but logs other failures", async () => {
    const { default: queryClient } = await import("./index");
    const { HttpError } = await import("@/lib/http-error");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    class ReportsDisabledError extends HttpError {
      constructor() {
        super(409, "feature_disabled");
        this.name = "ReportsDisabledError";
      }
    }
    await expect(
      queryClient.fetchQuery({
        queryKey: ["test", "reports-off"],
        queryFn: () => Promise.reject(new ReportsDisabledError()),
        retry: false,
      }),
    ).rejects.toThrow("feature_disabled");
    await expect(
      queryClient.fetchQuery({
        queryKey: ["test", "pages-off"],
        queryFn: () => Promise.reject(new HttpError(404, "feature_disabled")),
        retry: false,
      }),
    ).rejects.toThrow("feature_disabled");
    for (const status of [403, 404])
      await expect(
        queryClient.fetchQuery({
          queryKey: ["settings-history", `refused-${status}`],
          queryFn: () => Promise.reject(new HttpError(status, "refused")),
          retry: false,
        }),
      ).rejects.toThrow("refused");
    expect(log).not.toHaveBeenCalled();

    await expect(
      queryClient.fetchQuery({
        queryKey: ["test", "conflict"],
        queryFn: () => Promise.reject(new HttpError(409, "version_conflict")),
        retry: false,
      }),
    ).rejects.toThrow("version_conflict");
    expect(log).toHaveBeenCalledWith("[api.query]", expect.any(HttpError));

    // The silence is History-only and refusal-only.
    log.mockClear();
    await expect(
      queryClient.fetchQuery({
        queryKey: ["test", "forbidden"],
        queryFn: () => Promise.reject(new HttpError(403, "forbidden")),
        retry: false,
      }),
    ).rejects.toThrow("forbidden");
    await expect(
      queryClient.fetchQuery({
        queryKey: ["settings-history", "server-error"],
        queryFn: () => Promise.reject(new HttpError(500, "server_error")),
        retry: false,
      }),
    ).rejects.toThrow("server_error");
    expect(log).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });
});

it("keeps the agent 401 redirect when a query is refused", async () => {
  const { default: client } = await import("./index");
  const { HttpError } = await import("@/lib/http-error");
  const actualWindow = window;
  const replace = vi.fn();
  vi.stubEnv("MODE", "agent");
  vi.stubGlobal(
    "window",
    new Proxy(actualWindow, {
      get(target, key) {
        return key === "location"
          ? {
              pathname: "/agent/projects/ABC",
              search: "?view=board",
              hash: "#item",
              replace,
            }
          : Reflect.get(target, key, target);
      },
    }),
  );
  try {
    await expect(
      client.fetchQuery({
        queryKey: ["agent-401-test"],
        queryFn: async () => {
          throw new HttpError(401, "refused");
        },
        retry: false,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(replace).toHaveBeenCalledWith(
      "/auth/sign-in?redirect=%2Fagent%2Fprojects%2FABC%3Fview%3Dboard%23item",
    );
  } finally {
    client.clear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it("removes portal data when a session read returns a user without a session", async () => {
  const { default: client, portalSessionQueryKey } = await import("./index");
  try {
    await client.fetchQuery({
      queryKey: portalSessionQueryKey,
      queryFn: async () => ({ session: { id: "s-a" }, user: { id: "a" } }),
      staleTime: 0,
    });
    client.setQueryData(["portal", "notifications"], { private: "a" });
    await client.fetchQuery({
      queryKey: portalSessionQueryKey,
      queryFn: async () => ({ user: { id: "b" } }),
      staleTime: 0,
    });
    expect(client.getQueryData(["portal", "notifications"])).toBeUndefined();
  } finally {
    client.clear();
  }
});
