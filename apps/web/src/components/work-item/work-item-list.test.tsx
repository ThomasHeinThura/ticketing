import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkItemList from "./work-item-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const baseProps = {
  sort: "key" as const,
  dir: "asc" as const,
  onSortChange: vi.fn(),
  onRetry: vi.fn(),
};

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
  priority: "high",
  assigneeId: null,
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
  unavailableFields: [] as Array<"title" | "priority" | "dueDate">,
};

describe("WorkItemList", () => {
  it("renders the loading skeleton state", () => {
    render(
      <WorkItemList
        {...baseProps}
        workItems={undefined}
        isLoading={true}
        isError={false}
      />,
    );

    expect(screen.getByTestId("work-item-list-loading")).toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-list-populated"),
    ).not.toBeInTheDocument();
  });

  it("renders the error state, with a retry action", () => {
    render(
      <WorkItemList
        {...baseProps}
        workItems={undefined}
        isLoading={false}
        isError={true}
      />,
    );

    const errorState = screen.getByTestId("work-item-list-error");
    expect(errorState).toBeInTheDocument();
    screen.getByRole("button", { name: /retry/i }).click();
    expect(baseProps.onRetry).toHaveBeenCalled();
  });

  it("renders the empty state when there are no work items", () => {
    render(
      <WorkItemList
        {...baseProps}
        workItems={[]}
        isLoading={false}
        isError={false}
      />,
    );

    expect(screen.getByTestId("work-item-list-empty")).toBeInTheDocument();
  });

  it("renders the populated state with a table row per work item", () => {
    render(
      <WorkItemList
        {...baseProps}
        // biome-ignore lint/suspicious/noExplicitAny: partial fixture, full shape not needed
        workItems={[workItem] as any}
        isLoading={false}
        isError={false}
      />,
    );

    const table = screen.getByTestId("work-item-list-populated");
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("PROJ-123").length).toBeGreaterThan(0);
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    expect(screen.getByText("workItems:list.unassigned")).toBeInTheDocument();
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
      unavailableFields: ["title", "priority", "dueDate"] as Array<
        "title" | "priority" | "dueDate"
      >,
    };

    render(
      <WorkItemList
        {...baseProps}
        // biome-ignore lint/suspicious/noExplicitAny: partial fixture, full shape not needed
        workItems={[resolvedItem, partialItem] as any}
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

  it("calls onSortChange with the toggled direction when a header is clicked twice", () => {
    const onSortChange = vi.fn();
    render(
      <WorkItemList
        {...baseProps}
        onSortChange={onSortChange}
        // biome-ignore lint/suspicious/noExplicitAny: partial fixture, full shape not needed
        workItems={[workItem] as any}
        isLoading={false}
        isError={false}
      />,
    );

    const titleHeader = screen.getByRole("button", { name: /title/i });
    titleHeader.click();
    expect(onSortChange).toHaveBeenCalledWith("title", "asc");
  });
});
