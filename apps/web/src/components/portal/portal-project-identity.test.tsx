import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { portalProjectKeys } from "@/fetchers/portal/projects";
import { HttpError } from "@/lib/http-error";

describe("portal project identity cache", () => {
  it("does not expose A's list when B's request is pending or refused", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = portalProjectKeys.list as (
      userId: string,
    ) => readonly unknown[];
    client.setQueryData(key("a"), { data: [{ name: "A private project" }] });
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_, fail) => {
      reject = fail;
    });
    const observer = new QueryObserver(client, {
      queryKey: key("b"),
      queryFn: () => pending,
    });
    const unsubscribe = observer.subscribe(() => {});
    expect(observer.getCurrentResult().data).toBeUndefined();
    reject(new Error("Forbidden"));
    await expect(pending).rejects.toThrow("Forbidden");
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isError).toBe(true),
    );
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
    client.clear();
  });
});

const fake = vi.hoisted(() => ({
  session: vi.fn(),
  projects: vi.fn(),
  detail: vi.fn(),
  unauthorized: vi.fn(),
}));
vi.mock("@/lib/http-error", async (original) => ({
  ...(await original<typeof import("@/lib/http-error")>()),
  handleUnauthorized: fake.unauthorized,
}));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: { getSession: fake.session },
}));
vi.mock("@/fetchers/feature-flags", () => ({
  getPortalFeatureState: async () => "on",
}));
vi.mock("@/fetchers/portal/projects", async (original) => ({
  ...(await original<typeof import("@/fetchers/portal/projects")>()),
  getPortalProjects: fake.projects,
  getPortalProject: fake.detail,
}));
vi.mock("@/fetchers/portal/cases", async (original) => ({
  ...(await original<typeof import("@/fetchers/portal/cases")>()),
  getPortalHome: vi.fn().mockResolvedValue({
    actionRequired: { total: 0, cases: 0, approvals: 0 },
    outstanding: 0,
    closedLast30Days: 0,
    averageFirstResponse: null,
  }),
  getPortalCases: vi.fn().mockResolvedValue({
    cases: [],
    page: { nextCursor: null, hasMore: false },
  }),
}));
vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({ t: (key: string) => key, i18n: {} }),
}));

import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import client, { portalSessionQueryKey } from "@/query-client";
import { Route as realRoot } from "@/routes/portal/__root";
import PortalProjectSelector from "./portal-project-selector";
import { PortalProjectDetails } from "./projects/portal-project-details";

const session = (id: string) => ({
  data: { user: { id }, session: { id: `s-${id}` } },
  error: null,
});
afterEach(() => {
  client.clear();
  fake.session.mockReset();
  fake.projects.mockReset();
  fake.detail.mockReset();
  fake.unauthorized.mockReset();
});

it.each([401, 403, 404])(
  "uses verified portal identity across delayed A to B and a %s refusal",
  async (status) => {
    fake.session.mockResolvedValueOnce(session("a"));
    fake.projects.mockResolvedValueOnce({
      data: [
        { key: "A", name: "A private" },
        { key: "X", name: "A other" },
      ],
    });
    fake.detail.mockResolvedValueOnce({
      key: "A",
      name: "A private",
      kind: "project",
      status: "active",
      health: null,
      counts: { actionRequired: 0, outstanding: 0 },
      description: null,
      createdAt: "2026-01-01",
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
          title: "A document",
          url: "https://example.test",
          kind: "other",
          description: null,
        },
      ],
      contacts: [
        { kind: "manager", role: null, name: "A contact", email: null },
      ],
      contract: null,
    });
    let rejectDetail!: (reason: Error) => void;
    fake.detail.mockReturnValueOnce(
      new Promise<never>((_, reject) => {
        rejectDetail = reject;
      }),
    );
    let finishSession!: (value: ReturnType<typeof session>) => void;
    let rejectB!: (reason: Error) => void;
    const nextSession = new Promise<ReturnType<typeof session>>((resolve) => {
      finishSession = resolve;
    });
    const nextProjects = new Promise<never>((_, reject) => {
      rejectB = reject;
    });
    fake.session.mockReturnValueOnce(nextSession);
    fake.projects.mockReturnValueOnce(nextProjects);
    const root = createRootRoute({
      beforeLoad: realRoot.options.beforeLoad,
      component: () => {
        const { portalUserId } = root.useRouteContext() as {
          portalUserId: string;
        };
        return (
          <>
            <PortalProjectSelector portalUserId={portalUserId} />
            <PortalProjectDetails
              projectKey="A"
              portalUserId={portalUserId}
              caseFilters={{}}
              onCaseFiltersChange={() => {}}
            />
          </>
        );
      },
    });
    const page = createRoute({
      getParentRoute: () => root,
      path: "/requests",
      component: () => null,
    });
    const router = createRouter({
      routeTree: root.addChildren([page]),
      history: createMemoryHistory({ initialEntries: ["/requests?project=A"] }),
    });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("A contact")).toBeVisible();
    expect(await screen.findByText("A document")).toBeVisible();
    await client.invalidateQueries({ queryKey: portalSessionQueryKey });
    const transition = router.invalidate();
    await waitFor(() => expect(fake.session).toHaveBeenCalledTimes(2));
    expect(screen.getByText("A contact")).toBeVisible();
    finishSession(session("b"));
    await transition;
    await waitFor(() => expect(screen.queryByText("A contact")).toBeNull());
    expect(screen.queryByText("A document")).toBeNull();
    expect(document.title).not.toContain("A private");
    expect(fake.projects).toHaveBeenCalledTimes(2);
    rejectB(new HttpError(status, "refused"));
    rejectDetail(new HttpError(status, "refused"));
    await waitFor(() =>
      expect(client.getQueryState(portalProjectKeys.list("b"))?.status).toBe(
        "error",
      ),
    );
    expect(screen.queryByText("A private")).toBeNull();
    await waitFor(() =>
      expect(
        client.getQueryState(portalProjectKeys.detail("b", "A"))?.status,
      ).toBe("error"),
    );
    expect(fake.unauthorized).toHaveBeenCalledTimes(status === 401 ? 2 : 0);
  },
);

it.each([401, 403, 404])(
  "keeps a late A detail out of B after a %s refusal",
  async (status) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let finishA!: (value: object) => void;
    const lateA = new Promise<object>((resolve) => {
      finishA = resolve;
    });
    const a = new QueryObserver(queryClient, {
      queryKey: portalProjectKeys.detail("a", "P"),
      queryFn: () => lateA,
    });
    const stopA = a.subscribe(() => {});
    const b = new QueryObserver(queryClient, {
      queryKey: portalProjectKeys.detail("b", "P"),
      queryFn: async () => {
        throw new HttpError(status, "refused");
      },
    });
    const stopB = b.subscribe(() => {});
    expect(b.getCurrentResult().data).toBeUndefined();
    finishA({
      name: "A private",
      contacts: ["A contact"],
      documents: ["A document"],
    });
    await vi.waitFor(() => expect(a.getCurrentResult().isSuccess).toBe(true));
    await vi.waitFor(() => expect(b.getCurrentResult().isError).toBe(true));
    expect(b.getCurrentResult().data).toBeUndefined();
    stopA();
    stopB();
    queryClient.clear();
  },
);

it("invalidates list and detail only for the acting customer", async () => {
  const { invalidatePortalCaseViews } = await import(
    "@/hooks/queries/portal/use-portal-cases"
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const aList = vi.fn().mockResolvedValue({ data: [] });
  const aDetail = vi.fn().mockResolvedValue({ name: "A" });
  const bList = vi.fn().mockResolvedValue({ data: [] });
  await queryClient.fetchQuery({
    queryKey: portalProjectKeys.list("a"),
    queryFn: aList,
  });
  await queryClient.fetchQuery({
    queryKey: portalProjectKeys.detail("a", "P"),
    queryFn: aDetail,
  });
  await queryClient.fetchQuery({
    queryKey: portalProjectKeys.list("b"),
    queryFn: bList,
  });
  await invalidatePortalCaseViews(queryClient, "a");
  expect(aList).toHaveBeenCalledTimes(2);
  expect(aDetail).toHaveBeenCalledTimes(2);
  expect(bList).toHaveBeenCalledTimes(1);
  queryClient.clear();
});
