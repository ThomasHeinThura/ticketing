import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const option = {
  key: "ACME",
  name: "A private project",
  kind: "project",
  status: "active",
  health: null,
  counts: { actionRequired: 0, outstanding: 0 },
};
const detail = {
  ...option,
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  supportLevel: null,
  serviceCalendarName: null,
  summary: {
    objective: null,
    inScope: null,
    outOfScope: null,
    successCriteria: null,
  },
  goLive: null,
  milestones: [],
  prerequisites: [],
  documents: [
    {
      id: "d",
      title: "A private document",
      url: "https://example.test/doc",
      kind: "other",
      description: null,
    },
  ],
  contacts: [
    { kind: "manager", role: null, name: "A private contact", email: null },
  ],
  contract: null,
};

class OfflineSocket {
  static OPEN = 1;
  readyState = 0;
  close() {}
  send() {}
}

let transportHandler: (input: RequestInfo | URL) => Promise<Response>;
const transport: typeof fetch = (input) => transportHandler(input);
beforeAll(async () => {
  vi.stubEnv("MODE", "portal");
  vi.stubGlobal("fetch", transport);
  await import("@/routeTree.portal.gen");
  await import("@/portal/portal-application-providers");
  await Promise.all([
    import("@/components/portal/portal-layout"),
    import("@/components/portal/portal-sidebar"),
    import("@/components/portal/portal-topbar"),
    import("@/components/portal/portal-project-selector"),
    import("@/components/portal/portal-notification-bell"),
    import("@/components/portal/announcements/portal-announcement-banner"),
    import("@/components/portal/portal-search-dialog"),
  ]);
});

let usedClient: { clear: () => void } | undefined;
afterEach(() => {
  cleanup();
  usedClient?.clear();
  usedClient = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([401, 403, 404, 200])(
  "generated portal routes isolate customer data after a verified session switch and %s response",
  async (status) => {
    vi.stubEnv("MODE", "portal");
    window.history.replaceState({}, "", "/projects/ACME");
    let identity = "a";
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const seen: string[] = [];
    let releaseLate401!: (value: Response) => void;
    const late401 = new Promise<Response>((resolve) => {
      releaseLate401 = resolve;
    });
    let releaseARequest!: (value: Response) => void;
    const lateARequest = new Promise<Response>((resolve) => {
      releaseARequest = resolve;
    });
    let releaseFeatureB!: (value: Response) => void;
    const featureB = new Promise<Response>((resolve) => {
      releaseFeatureB = resolve;
    });
    let releaseB!: (value: Response) => void;
    let releaseListB!: (value: Response) => void;
    const bDetail = new Promise<Response>((resolve) => {
      releaseB = resolve;
    });
    const bList = new Promise<Response>((resolve) => {
      releaseListB = resolve;
    });
    vi.stubGlobal("WebSocket", OfflineSocket);
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })),
    );
    transportHandler = async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        "http://localhost",
      );
      const path = url.pathname;
      seen.push(`${identity}:${path}`);
      if (path.endsWith("/api/auth/get-session"))
        return json({
          session: { id: `s-${identity}` },
          user: {
            id: identity,
            name: `Customer ${identity}`,
            email: `${identity}@example.test`,
          },
        });
      if (path.endsWith("/api/portal/catalogue"))
        return json({ requestTypes: [] });
      if (path.endsWith("/api/portal/feature-state"))
        return identity === "b" ? featureB : json({ state: "on" });
      if (path.endsWith("/api/portal/projects/LATE")) return late401;
      if (path.endsWith("/api/portal/projects/ACME"))
        return identity === "a" ? json(detail) : bDetail;
      if (path.endsWith("/api/portal/projects"))
        return identity === "a"
          ? json({
              data: [option, { ...option, key: "TWO", name: "A other" }],
            })
          : bList;
      if (path.endsWith("/api/portal/home"))
        return json({
          actionRequired: { total: 0, cases: 0, approvals: 0 },
          outstanding: 0,
          closedLast30Days: 0,
          averageFirstResponse: null,
        });
      if (path.endsWith("/api/portal/requests"))
        return identity === "a"
          ? lateARequest
          : json({
              cases: [],
              page: { nextCursor: null, hasMore: false },
              meta: { total: 0 },
            });
      if (path.endsWith("/api/portal/notification/inbox"))
        return json({
          data: [],
          unreadCount: 0,
          hasMore: false,
          nextCursor: null,
        });
      if (path.endsWith("/api/portal/kb")) return json({ data: [], total: 0 });
      if (path.endsWith("/api/portal/announcements"))
        return json({ data: [], nextCursor: null });
      if (
        path.endsWith("/api/portal/terminology") ||
        path.endsWith("/api/public/terminology")
      )
        return json({ terms: {} });
      return json({ message: `unmatched ${path}` }, 503);
    };
    vi.stubGlobal("fetch", transport);
    const { routeTree } = await import("@/routeTree.portal.gen");
    const { PortalApplicationProviders } = await import(
      "@/portal/portal-application-providers"
    );
    const { default: queryClient, portalSessionQueryKey } = await import(
      "@/query-client"
    );
    usedClient = queryClient;
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/projects/ACME"] }),
      defaultPreloadStaleTime: 0,
    });
    const view = render(
      <PortalApplicationProviders>
        <RouterProvider router={router} />
      </PortalApplicationProviders>,
    );
    expect(await screen.findByText("A private contact")).toBeVisible();
    expect(screen.getByText("A private document")).toBeVisible();
    await waitFor(() => expect(document.title).toContain("A private project"));
    await waitFor(() => expect(seen).toContain("a:/api/portal/requests"));
    const { getPortalProject } = await import("@/fetchers/portal/projects");
    const old401 = queryClient
      .fetchQuery({
        queryKey: ["portal", "a", "projects", "detail", "LATE"],
        queryFn: () => getPortalProject("LATE"),
        retry: false,
      })
      .catch(() => undefined);
    await waitFor(() => expect(seen).toContain("a:/api/portal/projects/LATE"));
    act(() => {
      queryClient.setQueryData(["portal", "auth-methods"], { public: true });
      queryClient.setQueryData(["portal", "session", "private"], {
        secret: "A",
      });
      queryClient.setQueryData(
        [
          "terminology-runtime",
          "customer",
          "en-US",
          null,
          { requestTypeKey: "a" },
        ],
        { terms: { secret: "A" } },
      );
      queryClient.setQueryData(["portal", "announcement-banner"], {
        data: [
          {
            id: "a1",
            title: "A private announcement",
            severity: "incident",
            publishedAt: "2026-01-01",
            body: "",
            startsAt: "2026-01-01",
            endsAt: null,
          },
        ],
        nextCursor: null,
      });
      queryClient.setQueryData(["portal", "notifications"], {
        data: [],
        unreadCount: 27,
        hasMore: false,
        nextCursor: null,
      });
      queryClient.setQueryData(["portal", "notifications", "all"], {
        pages: [
          {
            data: [
              {
                id: "a1",
                kind: "submission.replied",
                isRead: false,
                createdAt: "2026-01-01T00:00:00Z",
                targetKind: "submission",
                requestRef: "A-PRIVATE",
                commentId: null,
              },
            ],
            unreadCount: 27,
            hasMore: false,
            nextCursor: null,
          },
        ],
        pageParams: [undefined],
      });
      queryClient.setQueryData(["portal", "help-search", "cases", "secret"], {
        cases: [{ ref: "A-SECRET", title: "A search private" }],
      });
      queryClient.setQueryData(["portal", "kb-navigation"], {
        articles: [{ id: "A-KB" }],
        total: 1,
      });
    });
    expect(await screen.findByText("A private announcement")).toBeVisible();
    expect(await screen.findByText("27")).toBeVisible();
    if (status === 200) {
      await act(async () => {
        await router.navigate({ to: "/notifications" });
      });
      expect(await screen.findByText(/A-PRIVATE/)).toBeVisible();
      await act(async () => {
        await router.navigate({
          to: "/projects/$projectKey",
          params: { projectKey: "ACME" },
        });
      });
      expect(await screen.findByText("A private contact")).toBeVisible();
    }
    if (status === 200) {
      now += 31_000;
      await act(async () => {
        await router.invalidate();
      });
      expect(
        queryClient.getQueryData(["portal", "help-search", "cases", "secret"]),
      ).toBeDefined();
      expect(screen.getByText("A private announcement")).toBeVisible();
      expect(document.title).toContain("A private project");
    }
    identity = "b";
    // Within the documented 30-second cache window the cookie alone is unverified by root.
    await act(async () => {
      await router.invalidate();
    });
    expect(
      queryClient.getQueryData<{ user: { id: string } }>(portalSessionQueryKey)
        ?.user.id,
    ).toBe("a");
    expect(screen.getByText("A private contact")).toBeVisible();
    expect(
      queryClient.getQueryData(["portal", "help-search", "cases", "secret"]),
    ).toBeDefined();
    let transition: Promise<unknown> = Promise.resolve();
    if (status === 200) {
      const { portalAuthClient } = await import("@/lib/portal-auth-client");
      await act(async () => {
        await queryClient.fetchQuery({
          queryKey: portalSessionQueryKey,
          staleTime: 0,
          queryFn: async () => {
            const result = await portalAuthClient.getSession();
            if (result.error) throw new Error("session failed");
            return result.data;
          },
        });
      });
    } else {
      now += 31_000;
      act(() => {
        transition = router.invalidate();
      });
    }
    await waitFor(() => expect(seen).toContain("b:/api/portal/feature-state"));
    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ user: { id: string } }>(
          portalSessionQueryKey,
        )?.user.id,
      ).toBe("b"),
    );
    await waitFor(() =>
      expect(screen.queryByText("A private contact")).toBeNull(),
    );
    expect(screen.queryByText("A private announcement")).toBeNull();
    await waitFor(() =>
      expect(document.title).not.toContain("A private project"),
    );
    const oldWindow = window;
    const oldRedirect = vi.fn();
    const oldLocation = {
      pathname: oldWindow.location.pathname,
      search: oldWindow.location.search,
      hash: oldWindow.location.hash,
      replace: oldRedirect,
    };
    vi.stubGlobal(
      "window",
      new Proxy(oldWindow, {
        get(target, key) {
          return key === "location"
            ? oldLocation
            : Reflect.get(target, key, target);
        },
      }),
    );
    const oldResponse = json({ message: "old session" }, 401);
    const oldBodyRead = vi.spyOn(oldResponse, "text");
    await act(async () => {
      releaseLate401(oldResponse);
      await old401;
    });
    await waitFor(() => expect(oldBodyRead).toHaveBeenCalled());
    expect(oldRedirect).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{ user: { id: string } }>(portalSessionQueryKey)
        ?.user.id,
    ).toBe("b");
    vi.stubGlobal("window", oldWindow);
    await act(async () => {
      releaseFeatureB(
        status === 404
          ? json({ message: "unavailable" }, 503)
          : json({ state: "on" }),
      );
      await transition;
    });
    await waitFor(() =>
      expect(screen.queryByText("A private contact")).toBeNull(),
    );
    expect(screen.queryByText("A private document")).toBeNull();
    expect(screen.queryByText("A private project")).toBeNull();
    expect(screen.queryByText("A private announcement")).toBeNull();
    expect(
      queryClient.getQueryData(["portal", "session", "private"]),
    ).toBeUndefined();
    expect(queryClient.getQueryData(["portal", "auth-methods"])).toEqual({
      public: true,
    });
    expect(
      queryClient.getQueryData([
        "terminology-runtime",
        "customer",
        "en-US",
        null,
        { requestTypeKey: "a" },
      ]),
    ).toBeUndefined();
    expect(screen.queryByText("27")).toBeNull();
    expect(
      queryClient.getQueryData(["portal", "notifications", "all"]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(["portal", "help-search", "cases", "secret"]),
    ).toBeUndefined();
    expect(queryClient.getQueryData(["portal", "kb-navigation"])).not.toEqual({
      articles: [{ id: "A-KB" }],
      total: 1,
    });
    const lateSuccess = json({
      cases: [
        {
          ref: "A-1",
          source: "submission",
          title: "A private request",
          requestTypeName: "Incident",
          priority: null,
          customerStatus: "received",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          project: { key: "ACME", name: "A private project" },
          createdBy: { name: null, isYou: true },
          isRequester: true,
          raisedBySupport: false,
          customerVisibility: "private",
          sla: null,
        },
      ],
      page: { nextCursor: null, hasMore: false },
      meta: { total: 1 },
    });
    const lateBodyRead = vi.spyOn(lateSuccess, "json");
    await act(async () => {
      releaseARequest(lateSuccess);
    });
    await waitFor(() => expect(lateBodyRead).toHaveBeenCalled());
    expect(
      queryClient.getQueriesData({ queryKey: ["portal", "a", "cases"] }),
    ).toEqual([]);
    expect(screen.queryByText("A private request")).toBeNull();
    expect(document.title).not.toContain("A private project");
    const originalWindow = window;
    const replace = vi.fn();
    if (status === 401) {
      const location = {
        pathname: originalWindow.location.pathname,
        search: originalWindow.location.search,
        hash: originalWindow.location.hash,
        replace,
      };
      vi.stubGlobal(
        "window",
        new Proxy(originalWindow, {
          get(target, key) {
            return key === "location"
              ? location
              : Reflect.get(target, key, target);
          },
        }),
      );
    }
    await act(async () => {
      releaseB(
        status === 200
          ? json({
              ...detail,
              name: "B project",
              contacts: [
                { kind: "manager", role: null, name: "B contact", email: null },
              ],
              documents: [],
            })
          : json({ message: "refused" }, status),
      );
      releaseListB(
        status === 200
          ? json({ data: [{ ...option, name: "B project" }] })
          : json({ message: "refused" }, status),
      );
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["portal", "b", "projects", "detail", "ACME"])
          ?.status,
      ).toBe(status === 200 ? "success" : "error"),
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["portal", "b", "projects", "list"])?.status,
      ).toBe(status === 200 ? "success" : "error"),
    );
    expect(screen.queryByText("A private contact")).toBeNull();
    expect(screen.queryByText("A private project")).toBeNull();
    expect(document.title).not.toContain("A private project");
    if (status === 200) {
      expect(await screen.findByText("B contact")).toBeVisible();
      await waitFor(() => expect(document.title).toContain("B project"));
      const search = screen.getByRole("searchbox", { name: "Search" });
      fireEvent.change(search, { target: { value: "secret" } });
      const form = search.closest("form");
      expect(form).not.toBeNull();
      if (!form) throw new Error("Search form missing");
      fireEvent.submit(form);
      const dialog = await screen.findByRole("dialog", { name: "Search" });
      await waitFor(() =>
        expect(
          queryClient.getQueryState([
            "portal",
            "help-search",
            "cases",
            "secret",
          ])?.status,
        ).toBe("success"),
      );
      expect(within(dialog).queryByText("A search private")).toBeNull();
      fireEvent.keyDown(dialog, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull(),
      );
      await act(async () => {
        await router.navigate({ to: "/notifications" });
      });
      expect(screen.queryByText(/A-PRIVATE/)).toBeNull();
    }
    if (status === 401) {
      expect(replace).toHaveBeenCalledWith(
        "/sign-in?redirect=%2Fprojects%2FACME",
      );
      vi.stubGlobal("window", originalWindow);
    }
    view.unmount();
    queryClient.clear();
  },
);

// Round-2 H1: a failed session refetch keeps the verified B data but flips the query status to
// error. The root's mismatch guard follows the still-valid session data, not the latest fetch
// status, so A's shell can never come back while B's feature state is pending.
async function startAsA() {
  vi.stubEnv("MODE", "portal");
  window.history.replaceState({}, "", "/projects/ACME");
  const state = {
    identity: "a",
    now: Date.now(),
    session: "ok" as "ok" | "down" | "signed-out",
    featureB: undefined as Promise<Response> | undefined,
    seen: [] as string[],
  };
  vi.spyOn(Date, "now").mockImplementation(() => state.now);
  vi.stubGlobal("WebSocket", OfflineSocket);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
  transportHandler = async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      "http://localhost",
    );
    const path = url.pathname;
    state.seen.push(`${state.identity}:${path}`);
    if (path.endsWith("/api/auth/get-session")) {
      if (state.session === "down") return json({ message: "down" }, 503);
      if (state.session === "signed-out") return json(null);
      return json({
        session: { id: `s-${state.identity}` },
        user: {
          id: state.identity,
          name: `Customer ${state.identity}`,
          email: `${state.identity}@example.test`,
        },
      });
    }
    if (path.endsWith("/api/portal/feature-state"))
      return state.identity === "b" && state.featureB
        ? state.featureB
        : json({ state: "on" });
    if (path.endsWith("/api/portal/projects/ACME"))
      return json(
        state.identity === "a"
          ? detail
          : {
              ...detail,
              name: "B project",
              contacts: [
                { kind: "manager", role: null, name: "B contact", email: null },
              ],
              documents: [],
            },
      );
    if (path.endsWith("/api/portal/projects"))
      return json({
        data: [
          {
            ...option,
            name: state.identity === "a" ? "A private project" : "B project",
          },
        ],
      });
    if (path.endsWith("/api/portal/announcements"))
      return json({
        data:
          state.identity === "a"
            ? [
                {
                  id: "a1",
                  title: "A private announcement",
                  severity: "incident",
                  publishedAt: "2026-01-01",
                  body: "",
                  startsAt: "2026-01-01",
                  endsAt: null,
                },
              ]
            : [],
        nextCursor: null,
      });
    if (path.endsWith("/api/portal/catalogue"))
      return json({ requestTypes: [] });
    if (path.endsWith("/api/portal/home"))
      return json({
        actionRequired: { total: 0, cases: 0, approvals: 0 },
        outstanding: 0,
        closedLast30Days: 0,
        averageFirstResponse: null,
      });
    if (path.endsWith("/api/portal/requests"))
      return json({
        cases: [],
        page: { nextCursor: null, hasMore: false },
        meta: { total: 0 },
      });
    if (path.endsWith("/api/portal/notification/inbox"))
      return json({
        data: [],
        unreadCount: 0,
        hasMore: false,
        nextCursor: null,
      });
    if (path.endsWith("/api/portal/kb")) return json({ data: [], total: 0 });
    if (
      path.endsWith("/api/portal/terminology") ||
      path.endsWith("/api/public/terminology")
    )
      return json({ terms: {} });
    return json({ message: `unmatched ${path}` }, 503);
  };
  vi.stubGlobal("fetch", transport);
  const { routeTree } = await import("@/routeTree.portal.gen");
  const { PortalApplicationProviders } = await import(
    "@/portal/portal-application-providers"
  );
  const { default: queryClient, portalSessionQueryKey } = await import(
    "@/query-client"
  );
  usedClient = queryClient;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/projects/ACME"] }),
    defaultPreloadStaleTime: 0,
  });
  const view = render(
    <PortalApplicationProviders>
      <RouterProvider router={router} />
    </PortalApplicationProviders>,
  );
  expect(await screen.findByText("A private contact")).toBeVisible();
  expect(await screen.findByText("A private announcement")).toBeVisible();
  expect(screen.getByRole("button", { name: /Customer a/ })).toBeVisible();
  await waitFor(() => expect(document.title).toContain("A private project"));
  return { state, router, queryClient, portalSessionQueryKey, view };
}

const sessionUserId = (
  queryClient: { getQueryData: (key: readonly unknown[]) => unknown },
  key: readonly unknown[],
) => (queryClient.getQueryData(key) as { user?: { id: string } })?.user?.id;

it("never restores A's shell while B's feature state is pending and a later session refetch fails", async () => {
  const { state, router, queryClient, portalSessionQueryKey, view } =
    await startAsA();
  // B is verified after the 30-second window; B's feature state is held, so the route context
  // stays A's while A's private queries are already purged.
  let releaseFeatureB!: (value: Response) => void;
  state.featureB = new Promise<Response>((resolve) => {
    releaseFeatureB = resolve;
  });
  state.identity = "b";
  state.now += 31_000;
  let transition: Promise<unknown> = Promise.resolve();
  act(() => {
    transition = router.invalidate();
  });
  await waitFor(() =>
    expect(sessionUserId(queryClient, portalSessionQueryKey)).toBe("b"),
  );
  await waitFor(() =>
    expect(state.seen).toContain("b:/api/portal/feature-state"),
  );
  await waitFor(() =>
    expect(screen.queryByText("A private contact")).toBeNull(),
  );
  expect(screen.queryByText("A private announcement")).toBeNull();

  // Past another window, a further navigation's session read fails with a retryable 5xx until
  // the retries are spent: the query keeps B's data but reports status "error".
  state.session = "down";
  state.now += 31_000;
  await act(async () => {
    await router.preloadRoute({ to: "/notifications" }).catch(() => undefined);
  });
  const sessionState = queryClient.getQueryState(portalSessionQueryKey);
  expect(sessionState?.status).toBe("error");
  expect(sessionUserId(queryClient, portalSessionQueryKey)).toBe("b");
  // A's shell, detail, banner and title never come back while the query is in error.
  expect(screen.queryByText("A private contact")).toBeNull();
  expect(screen.queryByText("A private document")).toBeNull();
  expect(screen.queryByText("A private announcement")).toBeNull();
  // The shell's avatar menu belongs to the route context's user: A's name and initials stay gone.
  expect(screen.queryByRole("button", { name: /Customer a/ })).toBeNull();
  expect(screen.queryByText("CA")).toBeNull();
  expect(document.title).not.toContain("A private project");

  // B's feature state resolves and the session is reachable again: B renders, A never does.
  state.session = "ok";
  await act(async () => {
    releaseFeatureB(json({ state: "on" }));
    await transition;
  });
  expect(await screen.findByText("B contact")).toBeVisible();
  expect(screen.getByRole("button", { name: /Customer b/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Customer a/ })).toBeNull();
  expect(screen.queryByText("A private contact")).toBeNull();
  expect(screen.queryByText("A private announcement")).toBeNull();
  await waitFor(() => expect(document.title).toContain("B project"));
  view.unmount();
  queryClient.clear();
});

it("a successful signed-out session still hides A's shell and follows the existing sign-in", async () => {
  const { state, router, queryClient, view } = await startAsA();
  state.session = "signed-out";
  state.now += 31_000;
  await act(async () => {
    await router.invalidate();
  });
  await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  expect(screen.queryByText("A private contact")).toBeNull();
  expect(screen.queryByText("A private announcement")).toBeNull();
  view.unmount();
  queryClient.clear();
});
