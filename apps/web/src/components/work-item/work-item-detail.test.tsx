import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDateMedium } from "@/lib/format";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemDetail, { type WorkItemDetailProps } from "./work-item-detail";

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

function makeItem(
  overrides: Partial<WorkItemDetailRow> = {},
): WorkItemDetailRow {
  return {
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
    unavailableFields: [],
    ...overrides,
  } as WorkItemDetailRow;
}

const baseProps: WorkItemDetailProps = {
  item: undefined,
  workItemKey: "PROJ-123",
  project: undefined,
  isLoading: false,
  isNotFound: false,
  isError: false,
  onRetry: vi.fn(),
};

describe("WorkItemDetail", () => {
  it("renders the loading skeleton state", () => {
    render(<WorkItemDetail {...baseProps} isLoading={true} />);
    expect(screen.getByTestId("work-item-detail-loading")).toBeInTheDocument();
  });

  it("renders the error state and retries on click", () => {
    const onRetry = vi.fn();
    render(<WorkItemDetail {...baseProps} isError={true} onRetry={onRetry} />);

    expect(screen.getByTestId("work-item-detail-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the not-found state with the URL's key when the item 404s", () => {
    render(<WorkItemDetail {...baseProps} isNotFound={true} />);

    expect(
      screen.getByTestId("work-item-detail-not-found"),
    ).toBeInTheDocument();
    expect(screen.getByText("PROJ-123")).toBeInTheDocument();
    expect(
      screen.getByText("workItems:detail.notFoundDescription"),
    ).toBeInTheDocument();
  });

  it("renders the header, description and details for a ready item", () => {
    const item = makeItem({
      description: "Investigate the login bug",
      assigneeId: "person_1",
      assigneeName: "Real Teammate",
      startDate: "2026-09-15T00:00:00.000Z",
    });
    render(
      <WorkItemDetail
        {...baseProps}
        item={item}
        project={{ name: "Worklist", slug: "WLP" }}
      />,
    );

    expect(screen.getByTestId("work-item-detail")).toBeInTheDocument();
    expect(screen.getByText("PROJ-123")).toBeInTheDocument();
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(
      screen.getByText(formatDateMedium("2026-10-01T00:00:00.000Z")),
    ).toBeInTheDocument();
    expect(screen.getByText("Real Teammate")).toBeInTheDocument();
    expect(screen.getByText("Investigate the login bug")).toBeInTheDocument();
    expect(screen.queryByTestId("work-item-detail-partial-notice")).toBeNull();

    // The details section is a real disclosure: closed, then openable.
    const detailsTrigger = screen.getByRole("button", {
      name: /workItems:detail.detailsHeading/,
    });
    expect(detailsTrigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(detailsTrigger);
    expect(detailsTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Worklist")).toBeInTheDocument();
  });

  it("renders Unassigned for an unassigned item, and (inactive) when the assignee has no resolvable name", () => {
    render(<WorkItemDetail {...baseProps} item={makeItem()} />);
    expect(screen.getByText("workItems:detail.unassigned")).toBeInTheDocument();
  });

  it("renders (inactive) rather than a name when the assignee's name is not resolvable", () => {
    render(
      <WorkItemDetail
        {...baseProps}
        item={makeItem({ assigneeId: "person_1", assigneeName: null })}
      />,
    );
    expect(
      screen.getByText("workItems:detail.inactiveAssignee"),
    ).toBeInTheDocument();
  });

  it("renders 'No description' for an empty description, and never a fake description", () => {
    render(<WorkItemDetail {...baseProps} item={makeItem()} />);
    expect(
      screen.getByText("workItems:detail.noDescription"),
    ).toBeInTheDocument();
  });

  it("renders an Unavailable badge when the description is a shape it cannot read", () => {
    render(
      <WorkItemDetail
        {...baseProps}
        item={makeItem({ description: { unexpected: "shape" } })}
      />,
    );
    expect(
      screen.getByText("workItems:detail.unavailable"),
    ).toBeInTheDocument();
  });

  it("renders the partial state: a field failing validation is marked unavailable and flagged, while the rest still renders", () => {
    render(
      <WorkItemDetail
        {...baseProps}
        item={makeItem({
          stateName: "",
          unavailableFields: ["stateName"],
          title: "Still shown",
        })}
      />,
    );

    expect(
      screen.getByTestId("work-item-detail-partial-notice"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workItems:detail.unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Still shown")).toBeInTheDocument();
  });

  it("marks an unparseable start date unavailable in the details instead of crashing", () => {
    render(
      <WorkItemDetail
        {...baseProps}
        item={makeItem({
          startDate: "not-a-date",
          unavailableFields: ["startDate"],
        })}
      />,
    );

    expect(
      screen.getByTestId("work-item-detail-partial-notice"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /workItems:detail.detailsHeading/,
      }),
    );
    expect(
      screen.getByText("workItems:detail.unavailable"),
    ).toBeInTheDocument();
  });
});
