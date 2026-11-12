import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * Regression for the stale dashboard: the app's QueryClient does not refetch on mount, so the
 * portal's home figures and case lists must refetch themselves after a customer action.
 */
const fake = vi.hoisted(() => ({
  getHome: vi.fn(),
  getCases: vi.fn(),
  getApprovals: vi.fn(),
  decide: vi.fn(),
  getProjects: vi.fn(),
  getProjectDetail: vi.fn(),
}));

vi.mock("@/components/portal/portal-orientation", () => ({
  PortalOrientation: () => null,
}));
vi.mock("@/fetchers/portal/cases", () => ({
  getPortalHome: fake.getHome,
  getPortalCases: fake.getCases,
}));
vi.mock("@/fetchers/portal/projects", async () => ({
  ...(await vi.importActual<typeof import("@/fetchers/portal/projects")>(
    "@/fetchers/portal/projects",
  )),
  getPortalProjects: fake.getProjects,
}));
vi.mock("@/fetchers/approval/portal-approvals", () => ({
  getPortalApprovals: fake.getApprovals,
  decidePortalApproval: fake.decide,
}));
vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    createFileRoute: (path: string) => (config: { component: ComponentType }) =>
      Object.assign(config.component, {
        useRouteContext: () => ({ portalUserId: "customer-a" }),
        useSearch: () =>
          path === "/approvals" ? { approval: "approval-1" } : {},
        fullPath: path,
      }),
    useNavigate: () => vi.fn(async () => undefined),
    Link: React.forwardRef<
      HTMLAnchorElement,
      PropsWithChildren<{ to: string }>
    >(({ children, to }, ref) => (
      <a href={to} ref={ref}>
        {children}
      </a>
    )),
  };
});
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "en-US",
      resolvedLanguage: "en-US",
      t: (key: string) => key,
    },
  }),
}));

import { portalProjectKeys } from "@/fetchers/portal/projects";
import { Route as ApprovalsRoute } from "./approvals";
import { Route as DashboardRoute } from "./index";

const Dashboard = DashboardRoute as unknown as ComponentType;
const Approvals = ApprovalsRoute as unknown as ComponentType;

/** The app's defaults (`query-client/index.ts`): no refetch on mount or focus. */
function appClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        retry: false,
      },
      mutations: { retry: false },
    },
  });
}

const homeBefore = {
  actionRequired: { total: 1, cases: 0, approvals: 1 },
  outstanding: 0,
  closedLast30Days: 0,
  averageFirstResponse: null,
};
const homeAfter = {
  ...homeBefore,
  actionRequired: { total: 0, cases: 0, approvals: 0 },
};

beforeEach(() => {
  fake.getHome
    .mockReset()
    .mockResolvedValueOnce(homeBefore)
    .mockResolvedValue(homeAfter);
  fake.getCases.mockReset().mockResolvedValue({
    cases: [],
    page: { nextCursor: null, hasMore: false },
    meta: { total: 0 },
  });
  fake.getApprovals.mockReset().mockResolvedValue({
    approvals: [
      {
        id: "approval-1",
        workItemKey: "HELP-1",
        workItemTitle: "Customer approval",
        state: "pending",
        expiresAt: "2026-10-24T12:00:00Z",
        approverReachLost: false,
      },
    ],
  });
  fake.decide.mockReset().mockResolvedValue({});
  fake.getProjects.mockReset().mockResolvedValue({ data: [] });
  fake.getProjectDetail.mockReset().mockResolvedValue({ key: "HELP" });
});
afterEach(cleanup);

it("refetches the dashboard figures and cases after an approval decision", async () => {
  const client = appClient();
  const dashboard = render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(fake.getHome).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(fake.getCases).toHaveBeenCalledTimes(1));
  dashboard.unmount();

  const approvals = render(
    <QueryClientProvider client={client}>
      <Approvals />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "approvals.approve" }),
  );
  await waitFor(() => expect(fake.decide).toHaveBeenCalledTimes(1));
  await screen.findByText("approvals.recorded");
  // The decision refetches the cached (unmounted) dashboard reads at once (`refetchType: "all"`).
  await waitFor(() => expect(fake.getHome).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(fake.getCases).toHaveBeenCalledTimes(2));
  approvals.unmount();

  // Returning to the dashboard starts the same reads from its route loader.
  const { prefetchPortalHome } = await import(
    "@/hooks/queries/portal/prefetch-portal-home"
  );
  prefetchPortalHome(client, "customer-a", {});
  render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(fake.getHome).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(fake.getCases).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(client.getQueryData(["portal", "customer-a", "home", null])).toEqual(
      homeAfter,
    ),
  );
});

it("refreshes figures already on screen when a case view is invalidated", async () => {
  const { invalidatePortalCaseViews } = await import(
    "@/hooks/queries/portal/use-portal-cases"
  );
  const client = appClient();
  render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(fake.getHome).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(fake.getCases).toHaveBeenCalledTimes(1));
  await invalidatePortalCaseViews(client, "customer-a");
  expect(fake.getHome).toHaveBeenCalledTimes(2);
  expect(fake.getCases).toHaveBeenCalledTimes(2);
});

it("refetches cached figures for a dashboard that is not mounted (refetchType all)", async () => {
  const { invalidatePortalCaseViews } = await import(
    "@/hooks/queries/portal/use-portal-cases"
  );
  const client = appClient();
  const dashboard = render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(fake.getHome).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(fake.getCases).toHaveBeenCalledTimes(1));
  dashboard.unmount();

  await invalidatePortalCaseViews(client, "customer-a");
  expect(fake.getHome).toHaveBeenCalledTimes(2);
  expect(fake.getCases).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(["portal", "customer-a", "home", null])).toEqual(
    homeAfter,
  );
});

it("refetches the per-project counts (list and detail) after an approval decision", async () => {
  const client = appClient();
  const dashboard = render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
  // The dashboard project cards read the shared projects list (`staleTime: 60_000`).
  await waitFor(() => expect(fake.getProjects).toHaveBeenCalledTimes(1));
  dashboard.unmount();
  // A Project Details page visited earlier is cached but no longer mounted.
  await client.fetchQuery({
    queryKey: portalProjectKeys.detail("HELP"),
    queryFn: fake.getProjectDetail,
  });
  expect(fake.getProjectDetail).toHaveBeenCalledTimes(1);

  render(
    <QueryClientProvider client={client}>
      <Approvals />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "approvals.approve" }),
  );
  await waitFor(() => expect(fake.decide).toHaveBeenCalledTimes(1));
  await screen.findByText("approvals.recorded");
  // Without this the project cards, the Projects list and Project Details keep the pre-decision
  // "action required" count for up to a minute while the KPI already shows the new figure.
  await waitFor(() => expect(fake.getProjects).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(fake.getProjectDetail).toHaveBeenCalledTimes(2));
});
