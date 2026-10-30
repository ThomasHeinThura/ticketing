import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemField, WorkItemRow } from "@/types/work-item";
import WorkItemList from "./work-item-list";

const mocks = vi.hoisted(() => ({
  setAsync: vi.fn(),
  virtualMeasure: vi.fn(),
  preferenceValue: {} as Record<string, number>,
  preferenceValuesByProject: {} as Record<string, Record<string, number>>,
  preferenceCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    preloadRoute: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
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
        measure: mocks.virtualMeasure,
      } as unknown as ReturnType<typeof actual.useVirtualizer>;
    }) as typeof actual.useVirtualizer,
  };
});
vi.mock("@/hooks/use-project-view-preference-with-save", () => {
  return {
    useProjectViewPreferenceWithSave: (input: Record<string, unknown>) => {
      mocks.preferenceCalls.push(input);
      return {
        value:
          mocks.preferenceValuesByProject[String(input.projectId)] ??
          mocks.preferenceValue,
        setAsync: mocks.setAsync,
        settled: true,
      };
    },
  };
});
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canUpdateTasks: () => false,
    canAssignTasks: () => false,
    canTransitionTasks: () => false,
    canSetPriorityTasks: () => false,
  }),
}));
vi.mock("@/hooks/mutations/work-item/use-restore-work-item", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "workItems:list.resizeColumn")
        return `Resize ${String(options?.column ?? "column")} column`;
      return typeof options?.defaultValue === "string"
        ? options.defaultValue
        : key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const baseItem = {
  id: "wi_1",
  projectId: "project-row",
  workspaceId: "workspace-1",
  typeId: "type-1",
  number: 1,
  key: "PROJ-1",
  title: "A work item",
  description: null,
  stateId: "state-1",
  stateName: "To do",
  stateCategory: "unstarted",
  priority: "medium",
  assigneeId: null,
  assigneeName: null,
  requesterId: null,
  parentId: null,
  position: "1",
  customerVisibility: "private",
  startDate: null,
  dueDate: null,
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  unavailableFields: [] as WorkItemField[],
};

const commonProps = {
  projectId: "project-explicit",
  hasPartialFailure: false,
  isLoading: false,
  isError: false,
  sort: "key" as const,
  dir: "asc" as const,
  onSortChange: vi.fn(),
  onRetry: vi.fn(),
};

function mount(workItems: WorkItemRow[] = [baseItem as WorkItemRow]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkItemList {...commonProps} workItems={workItems} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.setAsync.mockReset().mockResolvedValue(undefined);
  mocks.virtualMeasure.mockReset();
  mocks.preferenceValue = { title: 120 };
  mocks.preferenceValuesByProject = {};
  mocks.preferenceCalls = [];
});
afterEach(() => vi.clearAllMocks());

describe("work item list column resizing (VW-21)", () => {
  it("persists a keyboard resize only to the explicitly scoped project preference", async () => {
    mount();
    const handle = await screen.findByRole("separator", {
      name: "Resize workItems:list.columnTitle column",
    });
    expect(handle).toHaveAttribute("aria-valuenow", "120");
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    await waitFor(() =>
      expect(mocks.setAsync).toHaveBeenCalledWith({ title: 128 }),
    );
    expect(mocks.preferenceCalls).toContainEqual(
      expect.objectContaining({
        projectId: "project-explicit",
        name: "columnWidths",
      }),
    );
    const titleColumn = screen
      .getByRole("table")
      .querySelector("colgroup col:nth-child(2)");
    expect(titleColumn).toHaveStyle({ width: "128px" });
  });

  it("restores the last saved width and reports a refused preference write", async () => {
    mocks.setAsync.mockRejectedValue(new Error("settings refused"));
    mount();
    const handle = await screen.findByRole("separator", {
      name: "Resize workItems:list.columnTitle column",
    });
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(
      await screen.findByTestId("work-item-column-width-error"),
    ).toHaveTextContent("workItems:list.widthSaveFailed");
    await waitFor(() => expect(handle).toHaveAttribute("aria-valuenow", "120"));
    expect(
      screen.getByRole("table").querySelector("colgroup col:nth-child(2)"),
    ).toHaveStyle({ width: "120px" });
  });

  it("keeps full-table columns at pixel widths and reserves their intrinsic scroll width", () => {
    mocks.preferenceValue = { title: 381 };
    mount();

    const table = screen.getByRole("table");
    const columns = Array.from(
      table.querySelectorAll("colgroup col"),
    ) as HTMLTableColElement[];
    const widths = columns.map((column) =>
      Number.parseFloat(column.style.width),
    );

    expect(widths).toHaveLength(6);
    expect(widths.every((width) => width > 0)).toBe(true);
    expect(widths[0]).toBeCloseTo(105.6);
    expect(widths[1]).toBe(381);
    expect(Number.parseFloat(table.style.minWidth)).toBeCloseTo(
      widths.reduce((total, width) => total + width, 0),
    );
    expect(table.parentElement).toHaveAttribute("data-slot", "table-container");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
  });

  it("keeps intentionally narrow saved columns readable through truncation and tooltips", async () => {
    mocks.preferenceValue = {
      key: 64,
      title: 64,
      priority: 64,
      dueDate: 64,
      state: 64,
      assignee: 64,
    };
    mount();

    const table = screen.getByRole("table");
    const columns = Array.from(
      table.querySelectorAll("colgroup col"),
    ) as HTMLTableColElement[];
    expect(columns.map((column) => column.style.width)).toEqual(
      Array(6).fill("64px"),
    );
    const keyHeader = table.querySelector("thead th button") as HTMLElement;
    expect(keyHeader).not.toHaveAttribute("title");
    act(() => keyHeader.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "workItems:list.columnKey",
    );
    act(() => keyHeader.blur());

    const titleLink = screen.getByRole("link", { name: "A work item" });
    expect(titleLink).not.toHaveAttribute("title");
    // Focusing a title link scrolls its row into view; jsdom has no layout.
    Object.defineProperty(
      titleLink.closest("tr") as HTMLElement,
      "scrollIntoView",
      {
        configurable: true,
        value: vi.fn(),
      },
    );
    act(() => titleLink.focus());
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("tooltip")
          .some((tooltip) => tooltip.textContent === "A work item"),
      ).toBe(true),
    );
  });

  it("isolates a deferred old-project width save from the next project's widths", async () => {
    mocks.preferenceValuesByProject = {
      "project-one": { title: 120 },
      "project-two": { title: 240 },
    };
    let resolveFirstSave: (() => void) | undefined;
    mocks.setAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstSave = resolve;
        }),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const renderProject = (projectId: string) => (
      <QueryClientProvider client={client}>
        <WorkItemList
          {...commonProps}
          projectId={projectId}
          workItems={[baseItem as WorkItemRow]}
        />
      </QueryClientProvider>
    );
    const view = render(renderProject("project-one"));
    const firstHandle = await screen.findByRole("separator", {
      name: "Resize workItems:list.columnTitle column",
    });
    fireEvent.keyDown(firstHandle, { key: "ArrowRight" });
    await waitFor(() =>
      expect(mocks.setAsync).toHaveBeenCalledWith({ title: 128 }),
    );

    view.rerender(renderProject("project-two"));
    const secondHandle = await screen.findByRole("separator", {
      name: "Resize workItems:list.columnTitle column",
    });
    await waitFor(() =>
      expect(secondHandle).toHaveAttribute("aria-valuenow", "240"),
    );
    expect(
      screen.getByRole("table").querySelector("colgroup col:nth-child(2)"),
    ).toHaveStyle({ width: "240px" });

    await act(async () => {
      resolveFirstSave?.();
      await Promise.resolve();
    });
    expect(secondHandle).toHaveAttribute("aria-valuenow", "240");
    expect(
      screen.getByRole("table").querySelector("colgroup col:nth-child(2)"),
    ).toHaveStyle({ width: "240px" });
  });

  it("uses stored pixel widths for the virtual table and its header measurement", async () => {
    mocks.preferenceValue = { title: 360 };
    const rows = Array.from({ length: 125 }, (_, index) => ({
      ...baseItem,
      id: `wi_${index + 1}`,
      number: index + 1,
      key: `PROJ-${index + 1}`,
    })) as WorkItemRow[];
    mount(rows);

    await waitFor(() =>
      expect(screen.getByRole("table")).toHaveAttribute(
        "data-virtualized-table",
        "true",
      ),
    );
    const table = screen.getByRole("table");
    const titleHeader = table.querySelector(
      'th[data-virtual-column-index="1"]',
    );
    expect(titleHeader).toHaveStyle({ width: "360px" });
    expect(Number.parseFloat(table.style.width)).toBeCloseTo(
      Number.parseFloat(table.style.minWidth),
    );
    expect(
      Array.from(table.querySelectorAll("colgroup col")).every(
        (column) =>
          Number.parseFloat((column as HTMLTableColElement).style.width) > 0,
      ),
    ).toBe(true);
    expect(
      screen.getByRole("separator", {
        name: "Resize workItems:list.columnTitle column",
      }),
    ).toHaveAttribute("aria-valuenow", "360");
    const measureCalls = mocks.virtualMeasure.mock.calls.length;
    fireEvent.keyDown(
      screen.getByRole("separator", {
        name: "Resize workItems:list.columnTitle column",
      }),
      { key: "ArrowRight" },
    );
    await waitFor(() =>
      expect(mocks.virtualMeasure.mock.calls.length).toBeGreaterThan(
        measureCalls,
      ),
    );
  });
});
