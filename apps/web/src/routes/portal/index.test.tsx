import { expectNoA11yViolations } from "@taskdesk/ui/test/a11y";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  search: {} as Record<string, string>,
  home: {
    actionRequired: { total: 3, cases: 2, approvals: 1 },
    outstanding: 7,
    closedLast30Days: 4,
    averageFirstResponse: { seconds: 5400, sampleSize: 2 } as {
      seconds: number;
      sampleSize: number;
    } | null,
  },
  caseQueries: [] as unknown[],
}));

vi.mock("@/components/portal/portal-orientation", () => ({
  PortalOrientation: () => null,
}));
vi.mock("@/fetchers/portal/cases", () => ({
  getPortalHome: vi.fn(),
  getPortalCases: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: (value: unknown) => value,
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[2] === "home")
      return { data: state.home, isError: false, refetch: vi.fn() };
    state.caseQueries.push(queryKey[3]);
    return {
      data: {
        cases: [
          {
            ref: "SUB-1",
            source: "submission",
            title: "Printer jammed",
            requestTypeName: "Hardware",
            priority: "high",
            customerStatus: "received",
            createdAt: "2026-10-20T09:00:00.000Z",
            updatedAt: "2026-10-21T09:00:00.000Z",
            project: null,
            createdBy: { name: null, isYou: true },
            isRequester: true,
            customerVisibility: "private",
            sla: null,
          },
        ],
        page: { nextCursor: null, hasMore: true },
        meta: { total: 12 },
      },
      isError: false,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    createFileRoute: () => (config: { component: React.ComponentType }) =>
      Object.assign(config.component, {
        useRouteContext: () => ({ portalUserId: "customer-a" }),
        useSearch: () => state.search,
        fullPath: "/",
      }),
    useNavigate: () => navigate,
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.PropsWithChildren<{
        to: string;
        params?: { ref: string };
        search?: Record<string, string>;
      }>
    >(({ children, to, params, search, ...props }, ref) => (
      <a
        href={`${to.replace("$ref", params?.ref ?? "")}${
          search ? `?${new URLSearchParams(search)}` : ""
        }`}
        ref={ref}
        {...props}
      >
        {children}
      </a>
    )),
  };
});
vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(key.includes(":") ? key : `${namespace}:${key}`, options),
      i18n: {
        language: "en-US",
        resolvedLanguage: "en-US",
        t: (_key: string, options?: { count?: number }) =>
          translate(
            `term:customer.request_${options?.count === 1 ? "one" : "other"}`,
          ),
      },
    }),
  };
});

import { Route } from "./index";

afterEach(() => {
  cleanup();
  navigate.mockReset();
  state.search = {};
  state.caseQueries = [];
  state.home.averageFirstResponse = { seconds: 5400, sampleSize: 2 };
  state.home.actionRequired = { total: 3, cases: 2, approvals: 1 };
});

describe("Portal dashboard", () => {
  it("shows the KPI cards, each linking to the list it counts", () => {
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);
    // Both figures are non-zero: the card is not one link; each half of the hint links to the
    // list it counts.
    expect(screen.queryByRole("link", { name: /Action required/ })).toBeNull();
    expect(screen.getByText("Action required")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "2 need information" }),
    ).toHaveAttribute("href", "/requests?scope=all&status=need_more_info");
    expect(screen.getByRole("link", { name: "1 to approve" })).toHaveAttribute(
      "href",
      "/approvals",
    );
    expect(screen.getByRole("link", { name: /Outstanding7/ })).toHaveAttribute(
      "href",
      "/requests?scope=all&status=received%2Cneed_more_info%2Cin_progress",
    );
    // The 30-day figure has no list that matches it, so it is not a link.
    expect(screen.queryByRole("link", { name: /Closed/ })).toBeNull();
    expect(screen.getByText("In the last 30 days")).toBeVisible();
    expect(screen.getByText("1.5 hr")).toBeVisible();
  });

  it("links the action card to the readable need-more-information list", () => {
    state.home.actionRequired = { total: 2, cases: 2, approvals: 0 };
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);
    const action = screen.getByRole("link", { name: /Action required/ });
    expect(action).toHaveTextContent("2 need information · 0 to approve");
    expect(action).toHaveAttribute(
      "href",
      "/requests?scope=all&status=need_more_info",
    );
  });

  it("links the action card to approvals when only approvals wait", () => {
    state.home.actionRequired = { total: 1, cases: 0, approvals: 1 };
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);
    expect(
      screen.getByRole("link", { name: /Action required/ }),
    ).toHaveAttribute("href", "/approvals");
  });

  it("hides the response time without data and lists my outstanding cases", () => {
    state.home.averageFirstResponse = null;
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);
    expect(screen.queryByText("Average first response")).toBeNull();
    expect(state.caseQueries.at(-1)).toEqual({
      scope: "mine",
      status: "received,need_more_info,in_progress",
      limit: 10,
    });
    expect(screen.getByText("Printer jammed")).toBeVisible();
    expect(screen.getByText("Your team")).toBeVisible();
    expect(screen.getByText(/Showing 1 of 12/)).toBeVisible();
  });

  it("writes the My / All toggle to the URL", () => {
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);
    fireEvent.click(screen.getByRole("button", { name: /^All / }));
    const call = navigate.mock.calls.at(-1)?.[0] as {
      search: (previous: Record<string, unknown>) => Record<string, unknown>;
      replace: boolean;
    };
    expect(call.replace).toBe(true);
    expect(call.search({ project: "ACME" })).toEqual({
      project: "ACME",
      scope: "all",
    });
  });

  it("has no serious or critical axe violations (G4)", async () => {
    const Component = Route as unknown as React.ComponentType;
    const { container } = render(<Component />);
    await expectNoA11yViolations(container, { impact: "serious-or-critical" });
  });
});
