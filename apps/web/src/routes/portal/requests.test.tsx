import { expectNoA11yViolations } from "@taskdesk/ui/test/a11y";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const view = vi.hoisted(() => ({ value: undefined as "backlog" | undefined }));
const scope = vi.hoisted(() => ({ value: undefined as "all" | undefined }));
const projectsQuery = vi.hoisted(() => ({
  data: undefined as { data: { key: string }[] } | undefined,
}));
const rankBacklog = vi.hoisted(() => vi.fn());
const fakeSubmissionsQuery = vi.hoisted(() => ({
  data: {
    page: { hasMore: true, nextCursor: "older-50" },
    meta: { total: 30 },
    cases: [
      {
        ref: "SUB-101",
        source: "submission",
        title: "Replace my laptop",
        requestTypeName: "Laptop Request",
        priority: "high",
        customerStatus: "resolved",
        createdAt: "2026-10-21T12:00:00.000Z",
        updatedAt: "2026-10-22T12:00:00.000Z",
        project: { key: "CCY", name: "Customer Work" },
        createdBy: { name: null, isYou: true },
        isRequester: true,
        customerVisibility: "organisation",
        sla: null,
      },
      {
        ref: "CCY-9",
        source: "direct",
        title: "Raised by staff",
        requestTypeName: "Task",
        priority: null,
        customerStatus: "need_more_info",
        createdAt: "2026-10-20T12:00:00.000Z",
        updatedAt: "2026-10-20T12:00:00.000Z",
        project: null,
        createdBy: { name: "Bob Colleague", isYou: false },
        isRequester: false,
        customerVisibility: "organisation",
        sla: null,
      },
    ],
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));
const fakeBacklogQuery = vi.hoisted(() => ({
  items: [
    {
      id: "item-a",
      key: "CCY-1",
      title: "First accepted request",
      projectId: "project-a",
      projectKey: "CCY",
      projectName: "Customer Work",
      stateId: "state-a",
      stateName: "Backlog",
      statePosition: 0,
      position: "1",
      version: 1,
      sourceRef: "SUB-1",
    },
    {
      id: "item-b",
      key: "CCY-2",
      title: "Second accepted request",
      projectId: "project-a",
      projectKey: "CCY",
      projectName: "Customer Work",
      stateId: "state-a",
      stateName: "Backlog",
      statePosition: 0,
      position: "2",
      version: 1,
      sourceRef: "SUB-2",
    },
  ],
  page: { nextCursor: "older-items", hasMore: true },
}));
const initialBacklogItems = [...fakeBacklogQuery.items];

vi.mock("@/fetchers/portal/cases", () => ({
  getPortalCases: () => fakeSubmissionsQuery.data,
  portalCaseExportUrl: (query: Record<string, unknown>) =>
    `/api/portal/requests/export.csv?${new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    )}`,
}));
vi.mock("@/fetchers/portal-backlog", () => ({
  getPortalBacklog: () => fakeBacklogQuery,
  rankPortalBacklogItem: rankBacklog,
}));

vi.mock("@tanstack/react-query", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    keepPreviousData: (value: unknown) => value,
    useQuery: (options: { queryKey: readonly unknown[] }) =>
      options.queryKey[1] === "projects" ? projectsQuery : fakeSubmissionsQuery,
    useInfiniteQuery: () => ({
      data: { pages: [fakeBacklogQuery] },
      isLoading: false,
      isError: false,
      isFetching: false,
      isFetchingNextPage: false,
      dataUpdatedAt: 1,
      hasNextPage: true,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    }),
    useMutation: (options: {
      mutationFn: (input: unknown) => Promise<unknown>;
      onSuccess?: () => void;
    }) => {
      const [isPending, setIsPending] = React.useState(false);
      return {
        isPending,
        mutateAsync: async (input: unknown) => {
          setIsPending(true);
          try {
            const result = await options.mutationFn(input);
            await options.onSuccess?.();
            return result;
          } finally {
            setIsPending(false);
          }
        },
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    createFileRoute: () => (config: { component: React.ComponentType }) =>
      Object.assign(config.component, {
        useRouteContext: () => ({ portalUserId: "customer-a" }),
        useSearch: () => ({
          ...(view.value ? { view: view.value } : {}),
          ...(scope.value ? { scope: scope.value } : {}),
        }),
        fullPath: "/requests",
      }),
    useNavigate: () => navigate,
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.PropsWithChildren<{
        to: string;
        params?: unknown;
        search?: unknown;
        className?: string;
      }>
    >(({ children, to, params: _params, search: _search, ...props }, ref) => (
      <a href={to} ref={ref} {...props}>
        {children}
      </a>
    )),
  };
});

vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue || key,
  }),
}));

import { Route } from "./requests";

describe("PortalRequestsPage", () => {
  afterEach(() => {
    cleanup();
    view.value = undefined;
    scope.value = undefined;
    projectsQuery.data = undefined;
    rankBacklog.mockReset();
    fakeBacklogQuery.items = [...initialBacklogItems];
  });

  it("renders the customer's cases with severity, status and 'Your team'", () => {
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    expect(
      screen.getByRole("heading", { name: "cases.listTitle" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "SUB-101" })).toHaveAttribute(
      "href",
      "/submissions/$ref",
    );
    expect(screen.getByText("Replace my laptop")).toBeTruthy();
    // Each badge renders twice: in its column and, for narrow frames, under the title.
    expect(screen.getAllByText("request.priority.value.high")).toHaveLength(2);
    expect(screen.getAllByText("request.status.resolved")).toHaveLength(2);
    // CP-2: under My requests every row is "You" / "Your team", so those columns stay out.
    expect(screen.queryByText("request.author.you")).toBeNull();
    expect(screen.queryByText("cases.yourTeam")).toBeNull();
    // D6 / U-12: a request raised by staff opens its own portal page.
    expect(screen.getByRole("link", { name: "CCY-9" })).toHaveAttribute(
      "href",
      "/requests/$ref",
    );
    // A colleague's view names the requester; "raised for you" is the requester's only.
    expect(screen.getByText("cases.raisedByTeamFor")).toBeTruthy();
    expect(screen.queryByText("cases.raisedByTeam")).toBeNull();
    expect(screen.queryByText(/assignee/i)).toBeNull();
  });

  it("shows Created by and Assigned to only for All requests (CP-2)", () => {
    scope.value = "all";
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);
    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toContain("cases.columns.createdBy");
    expect(headers).toContain("cases.columns.assignedTo");
    expect(screen.getByText("request.author.you")).toBeTruthy();
    expect(screen.getByText("Bob Colleague")).toBeTruthy();
    expect(screen.getAllByText("cases.yourTeam")).toHaveLength(2);
  });

  it("hides the Project column when the customer has one project (CP-2)", () => {
    const Component = Route as unknown as React.ComponentType;
    const headers = () =>
      screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    projectsQuery.data = { data: [{ key: "CCY" }, { key: "OPS" }] };
    render(<Component />);
    expect(headers()).toContain("cases.columns.project");
    cleanup();
    projectsQuery.data = { data: [{ key: "CCY" }] };
    render(<Component />);
    expect(headers()).not.toContain("cases.columns.project");
  });

  it("has no serious or critical axe violations (G4)", async () => {
    const Component = Route as unknown as React.ComponentType;
    const { container } = render(<Component />);
    await expectNoA11yViolations(container, { impact: "serious-or-critical" });
  });

  it("exports with the current filters and follows the server cursor", () => {
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);
    expect(
      screen.getByRole("link", { name: "cases.export" }).getAttribute("href"),
    ).toContain("/api/portal/requests/export.csv?scope=mine");
    fireEvent.click(screen.getByRole("button", { name: "cases.nextPage" }));
    const call = navigate.mock.calls.at(-1)?.[0] as {
      search: (previous: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search({ scope: "all" })).toEqual({
      scope: "all",
      cursor: "older-50",
    });
    expect(
      screen
        .getByRole("link", { name: "requests.newRequest" })
        .querySelector("button"),
    ).toBeNull();
  });

  it("switches Requests and Backlog with view tabs beside My/All, with one primary action (CP-1, P5)", () => {
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    const views = screen.getByRole("tablist", { name: "requests.viewLabel" });
    const requestsTab = screen.getByRole("tab", { name: "cases.listTitle" });
    const backlogTab = screen.getByRole("tab", { name: "requests.backlog" });
    expect(views).toContainElement(requestsTab);
    expect(requestsTab).toHaveAttribute("aria-selected", "true");
    // The view tabs share one toolbar row with the My / All toggle.
    const scope = screen.getByRole("group", { name: "cases.scope.label" });
    expect(views.closest("[data-slot=portal-case-toolbar]")).toBe(
      scope.closest("[data-slot=portal-case-toolbar]"),
    );
    // The old button-links are gone.
    expect(
      screen.queryByRole("button", { name: "requests.backlog" }),
    ).toBeNull();

    fireEvent.click(backlogTab);
    const call = navigate.mock.calls.at(-1)?.[0] as {
      search: (previous: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search({ project: "CCY", scope: "all", q: "x" })).toEqual({
      project: "CCY",
      view: "backlog",
    });

    // Export is a quiet secondary; New Request is the one primary, icon-only below sm.
    const exportLink = screen.getByRole("link", { name: "cases.export" });
    expect(exportLink.className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
    expect(exportLink.className).toMatch(/(^|\s)hover:bg-accent(\s|$)/);
    const newRequest = screen.getByRole("link", {
      name: "requests.newRequest",
    });
    expect(newRequest.className).toMatch(/bg-primary/);
    expect(within(newRequest).getByText("requests.newRequest")).toHaveClass(
      "max-sm:sr-only",
    );
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => /(^|\s)bg-primary(\s|$)/.test(link.className)),
    ).toHaveLength(1);
  });

  it("keeps the view tabs in backlog mode and returns to the list with only the project kept", () => {
    view.value = "backlog";
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    expect(
      screen.getByRole("tab", { name: "requests.backlog" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.queryByRole("group", { name: "cases.scope.label" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "cases.export" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "cases.listTitle" }));
    const call = navigate.mock.calls.at(-1)?.[0] as {
      search: (previous: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search({ project: "CCY", view: "backlog" })).toEqual({
      project: "CCY",
    });
  });

  it("shows the accepted backlog only when the URL opts into backlog mode", () => {
    view.value = "backlog";
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    expect(
      screen.getByRole("heading", { name: "requests.backlog" }),
    ).toBeTruthy();
    expect(screen.getByText("CCY-1")).toBeTruthy();
    expect(screen.getByText("First accepted request")).toBeTruthy();
    expect(screen.getByText("CCY-2")).toBeTruthy();
    expect(screen.queryByText("SUB-101")).toBeNull();
  });

  it("ranks within the visible concrete backlog group with keyboard-accessible controls", async () => {
    view.value = "backlog";
    fakeBacklogQuery.items = [...fakeBacklogQuery.items];
    rankBacklog.mockImplementation(
      async (input: { key: string; beforeId?: string; afterId?: string }) => {
        const movingIndex = fakeBacklogQuery.items.findIndex(
          (item) => item.key === input.key,
        );
        const [moving] = fakeBacklogQuery.items.splice(movingIndex, 1);
        if (!moving) throw new Error("Missing ranked item");
        const neighbourId = input.afterId ?? input.beforeId;
        const neighbourIndex = fakeBacklogQuery.items.findIndex(
          (item) => item.id === neighbourId,
        );
        fakeBacklogQuery.items.splice(
          neighbourIndex + (input.beforeId ? 1 : 0),
          0,
          moving,
        );
        return { key: "CCY-2", position: "0", version: 2 };
      },
    );
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    const moveEarlier = screen.getByRole("button", {
      name: "Move SUB-2 earlier",
    });
    moveEarlier.focus();
    fireEvent.click(moveEarlier);
    await vi.waitFor(() => {
      expect(rankBacklog).toHaveBeenCalledWith({
        key: "CCY-2",
        afterId: "item-a",
      });
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Move SUB-2 later" }),
      );
      expect(
        screen.getByRole("button", { name: "Move SUB-2 earlier" }),
      ).toBeDisabled();
    });
  });
});
