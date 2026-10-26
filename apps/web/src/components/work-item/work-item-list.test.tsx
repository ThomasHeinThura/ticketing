import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkItemField } from "@/types/work-item";
import WorkItemList from "./work-item-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mocks = vi.hoisted(() => ({
  loadDetail: vi.fn().mockResolvedValue({ default: () => null }),
  getWorkItem: vi.fn().mockResolvedValue({}),
  preloadRoute: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  restore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    preloadRoute: mocks.preloadRoute,
    navigate: mocks.navigate,
  }),
}));
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: ((options: Parameters<typeof actual.useVirtualizer>[0]) => {
      const endIndex = Math.min(options.count - 1, 10);
      const indexes =
        endIndex < 0
          ? []
          : (options.rangeExtractor ?? actual.defaultRangeExtractor)({
              startIndex: 0,
              endIndex,
              overscan: 8,
              count: options.count,
              lanes: 1,
            });
      return {
        getVirtualItems: () =>
          indexes.map((index) => ({
            index,
            start: index * 42,
            end: (index + 1) * 42,
            key: options.getItemKey?.(index) ?? index,
            size: 42,
            lane: 0,
          })),
        getTotalSize: () => options.count * 42,
        scrollToIndex: vi.fn(),
        measureElement: vi.fn(),
        measure: vi.fn(),
      } as unknown as ReturnType<typeof actual.useVirtualizer>;
    }) as typeof actual.useVirtualizer,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) =>
      typeof options === "string"
        ? options
        : typeof options?.defaultValue === "string"
          ? options.defaultValue
          : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const baseProps = {
  hasPartialFailure: false,
  sort: "key" as const,
  dir: "asc" as const,
  onSortChange: vi.fn(),
  onRetry: vi.fn(),
};

vi.mock("@/components/work-item/load-work-item-detail", () => ({
  default: mocks.loadDetail,
}));
vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: mocks.getWorkItem,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canUpdateTasks: () => true,
    canAssignTasks: () => false,
    canTransitionTasks: () => false,
    canSetPriorityTasks: () => false,
  }),
}));
vi.mock("@/hooks/mutations/work-item/use-restore-work-item", () => ({
  default: () => ({ mutateAsync: mocks.restore, isPending: false }),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const workItem = {
  id: "wi_1",
  projectId: "proj_1",
  workspaceId: "ws_1",
  typeId: "type_1",
  number: 123,
  key: "PROJ-123",
  title: "Fix the thing",
  description: null,
  stateId: "state_1",
  stateName: "Backlog",
  stateCategory: "backlog",
  priority: "high",
  assigneeId: null,
  assigneeName: null,
  requesterId: null,
  parentId: null,
  position: "1.0000000000",
  customerVisibility: "private",
  startDate: null,
  dueDate: "2026-10-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  unavailableFields: [] as WorkItemField[],
};

describe("WorkItemList", () => {
  it("keeps real detail URLs and uses client navigation for an unmodified click", () => {
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={[workItem]}
        isLoading={false}
        isError={false}
      />,
    );

    const link = screen.getByRole("link", { name: "PROJ-123" });
    expect(link).toHaveAttribute("href", "/agent/work-items/PROJ-123");

    fireEvent.click(link, { button: 0 });

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/agent/work-items/$key",
      params: { key: "PROJ-123" },
    });

    mocks.navigate.mockClear();
    fireEvent.click(link, { button: 0, metaKey: true });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("renders selected custom-field values with envelope names and hides inherited values", async () => {
    const row = {
      ...workItem,
      archivedAt: "2026-10-01T00:00:00.000Z",
      customFieldValues: { constructor: "asset-42", empty_value: null },
    };
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={[row]}
        isLoading={false}
        isError={false}
        columns={["cf.constructor", "cf.empty_value"]}
        customFieldColumns={[
          {
            key: "constructor",
            name: "Asset tag",
            format: "text",
            options: [],
          },
          {
            key: "empty_value",
            name: "Optional value",
            format: "text",
            options: [],
          },
        ]}
      />,
    );
    expect(await screen.findByText("Asset tag")).toBeInTheDocument();
    expect(screen.getByText("asset-42")).toBeInTheDocument();
    expect(
      screen.getByText("workItems:list.customFieldNotSet"),
    ).toBeInTheDocument();
  });

  it("resolves custom user values only from the row's project and never renders raw person IDs", () => {
    const row = {
      ...workItem,
      archivedAt: "2026-10-01T00:00:00.000Z",
      customFieldValues: { owner: "person-secret-id" },
    };
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={[row]}
        isLoading={false}
        isError={false}
        columns={["cf.owner"]}
        customFieldColumns={[
          {
            key: "owner",
            name: "Owner",
            format: "user",
            options: [],
          },
        ]}
        customFieldPeople={[
          {
            projectId: "other-project",
            personId: "person-secret-id",
            name: "Wrong project name",
          },
        ]}
      />,
    );
    expect(
      screen.getByText("workItems:list.customFieldPersonUnavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText("person-secret-id")).toBeNull();
    expect(screen.queryByText("Wrong project name")).toBeNull();
  });

  it("preloads detail code and data when a reachable row receives pointer intent", async () => {
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={[workItem]}
        isLoading={false}
        isError={false}
      />,
    );

    expect(mocks.preloadRoute).not.toHaveBeenCalled();

    fireEvent.mouseOver(
      screen.getByText("PROJ-123").closest("a") as HTMLElement,
    );

    await waitFor(() =>
      expect(mocks.preloadRoute).toHaveBeenCalledWith({
        to: "/agent/work-items/$key",
        params: { key: "PROJ-123" },
      }),
    );
    await waitFor(() => expect(mocks.loadDetail).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.getWorkItem).toHaveBeenCalledOnce());

    const focusedLink = screen
      .getByText("Fix the thing")
      .closest<HTMLAnchorElement>("a");
    if (!focusedLink) throw new Error("Expected the work item title link.");
    const focusedRow = focusedLink.closest("tr");
    if (!focusedRow) throw new Error("Expected the link's table row.");
    const scrollIntoView = vi.fn();
    Object.defineProperty(focusedRow, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    fireEvent.focus(focusedLink);

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.contexts[0]).toBe(focusedRow);

    await waitFor(() => expect(mocks.loadDetail).toHaveBeenCalledTimes(2));
    expect(mocks.getWorkItem).toHaveBeenCalledOnce();
  });

  it("does not preload detail code for the first row before navigation intent", () => {
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={[workItem]}
        isLoading={false}
        isError={false}
      />,
    );

    expect(mocks.preloadRoute).not.toHaveBeenCalled();
    expect(mocks.loadDetail).not.toHaveBeenCalled();
    expect(mocks.getWorkItem).not.toHaveBeenCalled();
  });

  it("shows deleted rows as read-only with a restore action for update-capable viewers", async () => {
    const deleted = {
      ...workItem,
      deletedAt: "2026-10-20T00:00:00.000Z",
      version: 4,
    };
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={[deleted]}
        isLoading={false}
        isError={false}
        canBulkAssign
      />,
    );

    expect(screen.queryByRole("link", { name: "PROJ-123" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Fix the thing" })).toBeNull();
    expect(screen.getByText("Deleted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(mocks.restore).toHaveBeenCalledWith({
        key: "PROJ-123",
        version: 4,
        projectId: "proj_1",
      }),
    );
    expect(mocks.preloadRoute).not.toHaveBeenCalled();
  });

  it("renders the loading skeleton state", () => {
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={undefined}
        isLoading={true}
        isError={false}
      />,
    );

    const loading = screen.getByTestId("work-item-list-loading");
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveAttribute("aria-live", "polite");
    expect(
      document.querySelector("[data-primary-content-ready='true']"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-list-populated"),
    ).not.toBeInTheDocument();
  });

  it("renders the error state, with a retry action", () => {
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={undefined}
        isLoading={false}
        isError={true}
      />,
    );

    const errorState = screen.getByTestId("work-item-list-error");
    expect(errorState).toBeInTheDocument();
    expect(errorState).toHaveAttribute("data-primary-content-ready", "true");
    screen.getByRole("button", { name: /retry/i }).click();
    expect(baseProps.onRetry).toHaveBeenCalled();
  });

  it("renders the empty state when there are no work items", () => {
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={[]}
        isLoading={false}
        isError={false}
      />,
    );

    const emptyState = screen.getByTestId("work-item-list-empty");
    expect(emptyState).toBeInTheDocument();
    expect(emptyState).toHaveAttribute("data-primary-content-ready", "true");
  });

  it("renders the populated state with a table row per work item", () => {
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        // biome-ignore lint/suspicious/noExplicitAny: partial fixture, full shape not needed
        workItems={[workItem] as any}
        isLoading={false}
        isError={false}
      />,
    );

    const table = screen.getByTestId("work-item-list-populated");
    expect(table).toHaveAttribute("data-primary-content-ready", "true");
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("PROJ-123").length).toBeGreaterThan(0);
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("workItems:list.unassigned")).toBeInTheDocument();
  });

  it("bounds the rendered rows for a large result while keeping the table data available", async () => {
    const workItems = Array.from({ length: 500 }, (_, index) => ({
      ...workItem,
      id: `wi_${index + 1}`,
      number: index + 1,
      key: `PROJ-${index + 1}`,
      priority: (index + 1) % 4 === 0 ? null : "medium",
      dueDate: null,
    }));

    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        // biome-ignore lint/suspicious/noExplicitAny: generated list uses the valid fixture shape
        workItems={workItems as any}
        isLoading={false}
        isError={false}
      />,
    );

    let table = await screen.findByTestId("work-item-list-populated");
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await waitFor(() =>
      expect(screen.getByTestId("work-item-list-populated")).toHaveAttribute(
        "data-virtualized-table",
        "true",
      ),
    );
    table = screen.getByTestId("work-item-list-populated");
    expect(table.tagName).toBe("TABLE");
    const renderedRows = table.querySelectorAll(
      "tbody tr[data-virtual-row-id]",
    );
    console.info(
      "virtual rows",
      renderedRows.length,
      renderedRows[0]?.getAttribute("data-index"),
      renderedRows[renderedRows.length - 1]?.getAttribute("data-index"),
    );
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(100);
    expect(
      table.querySelector('[data-virtual-row-id="wi_1"]'),
    ).toBeInTheDocument();
    expect(table.querySelector('[data-virtual-row-id="wi_500"]')).toBeNull();
  }, 15_000);

  it("#310: renders the resolved assignee name when present", () => {
    const assignedItem = {
      ...workItem,
      assigneeId: "person_1",
      assigneeName: "Jane Agent",
    };

    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        // biome-ignore lint/suspicious/noExplicitAny: partial fixture, full shape not needed
        workItems={[assignedItem] as any}
        isLoading={false}
        isError={false}
      />,
    );

    expect(screen.getByText("Jane Agent")).toBeInTheDocument();
    expect(
      screen.queryByText("workItems:list.unassigned"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("workItems:list.assigneeInactive"),
    ).not.toBeInTheDocument();
  });

  it("#310: renders '(inactive)' when assigneeId is set but assigneeName cannot be resolved (work-items.md's 'Assignee leaves' case) -- not the Partial mechanism", () => {
    const inactiveAssigneeItem = {
      ...workItem,
      assigneeId: "person_1",
      assigneeName: null,
    };

    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        // biome-ignore lint/suspicious/noExplicitAny: partial fixture, full shape not needed
        workItems={[inactiveAssigneeItem] as any}
        isLoading={false}
        isError={false}
      />,
    );

    expect(
      screen.getByText("workItems:list.assigneeInactive"),
    ).toBeInTheDocument();
    // Not silently unassigned, and not routed through the "Unavailable" Partial badge.
    expect(
      screen.queryByText("workItems:list.unassigned"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("workItems:list.unavailable"),
    ).not.toBeInTheDocument();
  });

  it("renders the partial state: resolved rows render, missing parts are marked, and the notice shows instead of the error state", () => {
    const resolvedItem = { ...workItem, id: "wi_1", key: "PROJ-123" };
    const partialItem = {
      ...workItem,
      id: "wi_2",
      key: "PROJ-124",
      title: "",
      priority: "not-a-real-priority",
      dueDate: "not-a-real-date",
      unavailableFields: ["title", "priority", "dueDate"] as WorkItemField[],
    };

    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        // biome-ignore lint/suspicious/noExplicitAny: partial fixture, full shape not needed
        workItems={[resolvedItem, partialItem] as any}
        hasPartialFailure={true}
        isLoading={false}
        isError={false}
      />,
    );

    // The resolved row renders normally.
    expect(screen.getAllByText("PROJ-123").length).toBeGreaterThan(0);
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();

    // The partial row still renders (its key), with its missing fields marked rather
    // than the row being dropped.
    expect(screen.getAllByText("PROJ-124").length).toBeGreaterThan(0);
    const unavailableBadges = screen.getAllByText("workItems:list.unavailable");
    expect(unavailableBadges).toHaveLength(3);

    // The non-blocking notice is shown.
    expect(
      screen.getByTestId("work-item-list-partial-notice"),
    ).toBeInTheDocument();

    // Never falls back to the error state for a partial failure.
    expect(
      screen.queryByTestId("work-item-list-error"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("work-item-list-populated")).toBeInTheDocument();
  });

  it("renders an invalid key as unavailable text with no link, and does not link the title either", () => {
    const badKeyItem = {
      ...workItem,
      id: "wi_3",
      key: "not-a-real-key",
      unavailableFields: ["key"] as WorkItemField[],
    };

    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        // biome-ignore lint/suspicious/noExplicitAny: partial fixture, full shape not needed
        workItems={[badKeyItem] as any}
        isLoading={false}
        isError={false}
      />,
    );

    // The raw (untrustworthy) key is never rendered or used as a link target.
    expect(screen.queryByText("not-a-real-key")).not.toBeInTheDocument();
    expect(screen.getByText("workItems:list.unavailable")).toBeInTheDocument();

    // The valid title still renders, but as plain text, not a link (it would otherwise
    // link using the same bad key).
    const title = screen.getByText("Fix the thing");
    expect(title.closest("a")).toBeNull();

    // No link renders anywhere in this row -- both the Key and Title cells would
    // otherwise navigate using the same invalid key.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("calls onSortChange with the toggled direction when a header is clicked twice", () => {
    const onSortChange = vi.fn();
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        onSortChange={onSortChange}
        // biome-ignore lint/suspicious/noExplicitAny: partial fixture, full shape not needed
        workItems={[workItem] as any}
        isLoading={false}
        isError={false}
      />,
    );

    const titleColumn = screen
      .getAllByRole("columnheader")
      .find((header) =>
        header.textContent?.includes("workItems:list.columnTitle"),
      );
    if (!titleColumn) throw new Error("Expected the Title column header.");
    within(titleColumn).getByRole("button").click();
    expect(onSortChange).toHaveBeenCalledWith("title", "asc");
  });

  describe("VW-19 chosen columns", () => {
    const headerNames = () =>
      screen
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim());

    it("renders every column in the default order when none are chosen", () => {
      renderWithQueryClient(
        <WorkItemList
          {...baseProps}
          workItems={[workItem]}
          isLoading={false}
          isError={false}
        />,
      );
      expect(headerNames()).toEqual([
        "workItems:list.columnKey",
        "workItems:list.columnTitle",
        "workItems:list.columnPriority",
        "workItems:list.columnDueDate",
        "workItems:list.columnState",
        "workItems:list.columnAssignee",
      ]);
    });

    it("renders only the chosen columns, in the chosen order, for headers and cells", () => {
      renderWithQueryClient(
        <WorkItemList
          {...baseProps}
          columns={["assignee", "key", "state"]}
          workItems={[workItem]}
          isLoading={false}
          isError={false}
        />,
      );
      expect(headerNames()).toEqual([
        "workItems:list.columnAssignee",
        "workItems:list.columnKey",
        "workItems:list.columnState",
      ]);
      const cells = screen
        .getAllByRole("cell")
        .map((cell) => cell.textContent?.trim());
      expect(cells).toEqual([
        "workItems:list.unassigned",
        "PROJ-123",
        "Backlog",
      ]);
      expect(screen.queryByText("Fix the thing")).toBeNull();
    });

    it("only gives sortable columns a sort control and aria-sort", () => {
      renderWithQueryClient(
        <WorkItemList
          {...baseProps}
          columns={["state", "priority"]}
          sort="priority"
          dir="desc"
          workItems={[workItem]}
          isLoading={false}
          isError={false}
        />,
      );
      const [state, priority] = screen.getAllByRole("columnheader");
      expect(state).toHaveAttribute("aria-sort", "none");
      expect(state?.querySelector("button")).not.toBeNull();
      expect(priority).toHaveAttribute("aria-sort", "descending");
    });

    it("appends and toggles secondary sorts with a modifier click", () => {
      const onSortsChange = vi.fn();
      const { rerender } = renderWithQueryClient(
        <WorkItemList
          {...baseProps}
          columns={["priority", "state"]}
          sort="priority"
          dir="desc"
          sorts={[{ field: "priority", order: "desc" }]}
          onSortsChange={onSortsChange}
          workItems={[workItem]}
          isLoading={false}
          isError={false}
        />,
      );
      const stateHeader = screen.getByRole("columnheader", {
        name: /workItems:list.columnState/u,
      });
      const stateButton = within(stateHeader).getByRole("button");
      fireEvent.click(stateButton, { shiftKey: true });
      expect(onSortsChange).toHaveBeenLastCalledWith([
        { field: "priority", order: "desc" },
        { field: "state", order: "asc" },
      ]);
      rerender(
        <WorkItemList
          {...baseProps}
          columns={["priority", "state"]}
          sort="priority"
          dir="desc"
          sorts={[
            { field: "priority", order: "desc" },
            { field: "state", order: "asc" },
          ]}
          onSortsChange={onSortsChange}
          workItems={[workItem]}
          isLoading={false}
          isError={false}
        />,
      );
      const updatedStateHeader = screen.getByRole("columnheader", {
        name: /workItems:list.columnState/u,
      });
      fireEvent.click(within(updatedStateHeader).getByRole("button"), {
        metaKey: true,
      });
      expect(onSortsChange).toHaveBeenLastCalledWith([
        { field: "priority", order: "desc" },
        { field: "state", order: "desc" },
      ]);
    });

    it("marks a malformed state or assignee name as unavailable instead of blank", () => {
      renderWithQueryClient(
        <WorkItemList
          {...baseProps}
          columns={["key", "state", "assignee"]}
          workItems={[
            {
              ...workItem,
              stateName: "",
              assigneeName: null,
              unavailableFields: ["stateName", "assigneeName"],
            },
          ]}
          isLoading={false}
          isError={false}
        />,
      );
      expect(screen.getAllByText("workItems:list.unavailable")).toHaveLength(2);
    });
  });

  it("says no item matches when a structured filter yields nothing, not that the project is empty", () => {
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        isFiltered
        workItems={[]}
        isLoading={false}
        isError={false}
      />,
    );
    expect(
      screen.getByText("workItems:list.emptyFilteredTitle"),
    ).toBeInTheDocument();
    expect(screen.queryByText("workItems:list.emptyTitle")).toBeNull();
  });

  it("uses caller-supplied empty copy on cross-project pages such as My work", () => {
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        isFiltered
        emptyTitle="Nothing assigned to you"
        emptyDescription="Items assigned to you show up here."
        workItems={[]}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.getByText("Nothing assigned to you")).toBeInTheDocument();
    expect(screen.queryByText("workItems:list.emptyFilteredTitle")).toBeNull();
    expect(
      screen.queryByText("workItems:list.emptyFilteredDescription"),
    ).toBeNull();
  });
});

describe("WorkItemList: canonical and filtered pagination", () => {
  it("offers Load more only when the search has more pages, and calls it", () => {
    const onLoadMore = vi.fn();
    const { rerender } = renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        isFiltered
        hasMore
        onLoadMore={onLoadMore}
        workItems={[workItem]}
        isLoading={false}
        isError={false}
      />,
    );
    fireEvent.click(screen.getByTestId("work-item-list-load-more"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <WorkItemList
        {...baseProps}
        isFiltered
        hasMore
        isLoadingMore
        onLoadMore={onLoadMore}
        workItems={[workItem]}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.getByTestId("work-item-list-load-more")).toBeDisabled();
  });

  it("retains rows and refetches after an unusable cursor instead of silently claiming completion", () => {
    const onRetry = vi.fn();
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={[workItem]}
        isLoading={false}
        isError={false}
        hasMore={false}
        isLoadMoreError
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId("work-item-list-populated")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId("work-item-list-page-error")).getByRole(
        "button",
      ),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it("restarts from the first page when a compact sort cursor has changed", () => {
    const onRestartFromFirstPage = vi.fn();
    renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        workItems={[workItem]}
        isLoading={false}
        isError={false}
        hasMore
        isLoadMoreError
        isCursorChanged
        onRestartFromFirstPage={onRestartFromFirstPage}
        onLoadMore={vi.fn()}
      />,
    );
    expect(
      screen.getByText("workItems:list.cursorChanged"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("work-item-list-load-more")).toBeNull();
    fireEvent.click(
      within(screen.getByTestId("work-item-list-page-error")).getByRole(
        "button",
        { name: "workItems:list.reload" },
      ),
    );
    expect(onRestartFromFirstPage).toHaveBeenCalledOnce();
  });
  it("shows nothing extra when there is no further page or no way to load one", () => {
    const { rerender } = renderWithQueryClient(
      <WorkItemList
        {...baseProps}
        hasMore={false}
        onLoadMore={vi.fn()}
        workItems={[workItem]}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.queryByTestId("work-item-list-load-more")).toBeNull();
    rerender(
      <WorkItemList
        {...baseProps}
        hasMore
        workItems={[workItem]}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.queryByTestId("work-item-list-load-more")).toBeNull();
  });
});
