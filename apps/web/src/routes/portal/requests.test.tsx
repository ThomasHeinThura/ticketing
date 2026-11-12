import { expectNoA11yViolations } from "@taskdesk/ui/test/a11y";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const view = vi.hoisted(() => ({ value: undefined as "backlog" | undefined }));
const rankBacklog = vi.hoisted(() => vi.fn());
const project = vi.hoisted(() => ({ value: undefined as string | undefined }));
const backlogOptions = vi.hoisted(() => vi.fn());
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
        raisedBySupport: false,
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
        raisedBySupport: true,
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
    useQuery: () => fakeSubmissionsQuery,
    useInfiniteQuery: (options: unknown) => {
      backlogOptions(options);
      return {
        data: { pages: [fakeBacklogQuery] },
        isLoading: false,
        isError: false,
        isFetching: false,
        isFetchingNextPage: false,
        dataUpdatedAt: 1,
        hasNextPage: true,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    },
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
          ...(project.value ? { project: project.value } : {}),
        }),
        fullPath: "/requests",
      }),
    useNavigate: () => navigate,
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.PropsWithChildren<{ to: string }>
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
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue || key,
  }),
}));

import { Route } from "./requests";

describe("PortalRequestsPage", () => {
  afterEach(() => {
    cleanup();
    view.value = undefined;
    project.value = undefined;
    backlogOptions.mockClear();
    rankBacklog.mockReset();
    fakeBacklogQuery.items = [...initialBacklogItems];
  });

  it("starts a separate backlog query when the project changes", () => {
    view.value = "backlog";
    project.value = "FIRST";
    const Component = Route as unknown as React.ComponentType;
    const rendered = render(<Component />);
    expect(backlogOptions.mock.lastCall?.[0]).toMatchObject({
      queryKey: ["portal", "customer-a", "backlog", "FIRST"],
      initialPageParam: undefined,
    });
    project.value = "SECOND";
    rendered.rerender(<Component />);
    expect(backlogOptions.mock.lastCall?.[0]).toMatchObject({
      queryKey: ["portal", "customer-a", "backlog", "SECOND"],
      initialPageParam: undefined,
    });
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
    expect(screen.getByText("request.author.you")).toBeTruthy();
    expect(screen.getByText("Bob Colleague")).toBeTruthy();
    expect(screen.getAllByText("cases.yourTeam")).toHaveLength(2);
    // D6 / U-12: a request raised by staff opens its own portal page.
    expect(screen.getByRole("link", { name: "CCY-9" })).toHaveAttribute(
      "href",
      "/requests/$ref",
    );
    expect(screen.getByText("cases.raisedBy: cases.supportTeam")).toBeTruthy();
    expect(screen.queryByText(/assignee/i)).toBeNull();
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
