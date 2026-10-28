import { Button } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemDetail, { type WorkItemDetailProps } from "./work-item-detail";

const device = vi.hoisted(() => ({ mobile: false }));
const locationState = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  searchStr: "",
  pathname: "/agent/work-items/PROJ-123",
  hash: "",
}));
const navigate = vi.hoisted(() => vi.fn());
const timeFeature = vi.hoisted(() => ({ on: false, logTime: true }));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canLogTime: () => timeFeature.logTime }),
}));
vi.mock("@/hooks/queries/time-tracking/use-time-tracking", () => ({
  useTimeTrackingFeatures: () => ({
    time: timeFeature.on,
    cost: false,
    isLoading: false,
  }),
}));
vi.mock("@/components/time-tracking/work-item-time", () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => (
    <div
      data-testid="time-section"
      data-read-only={String(Boolean(readOnly))}
    />
  ),
}));
vi.mock("@taskdesk/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/ui")>()),
  useIsMobile: () => device.mobile,
}));

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (media: string) =>
    ({
      matches:
        window.innerWidth <= Number(media.match(/max-width:\s*(\d+)px/)?.[1]),
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }) as MediaQueryList,
});

afterEach(() => {
  timeFeature.on = false;
  timeFeature.logTime = true;
  device.mobile = false;
  locationState.search = {};
  locationState.searchStr = "";
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => locationState,
  useNavigate: () => navigate,
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

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1", role: "user" } }),
}));

vi.mock("@/hooks/queries/approval/use-get-work-item-approvals", () => ({
  default: () => ({
    data: { approvals: [] },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/approval/use-get-my-approvals", () => ({
  default: () => ({ data: { approvals: [] } }),
}));

vi.mock("@/hooks/mutations/approval/use-decide-approval", () => ({
  default: () => ({ mutate: () => {}, isPending: false, isError: false }),
}));

vi.mock("@/hooks/mutations/approval/use-withdraw-approval", () => ({
  default: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock("./work-item-approval-request", () => ({ default: () => null }));

vi.mock("./work-item-hierarchy", () => ({
  default: () => <div data-testid="work-item-hierarchy" />,
}));
vi.mock("./work-item-relations", () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => (
    <div
      data-testid="work-item-relations"
      data-read-only={String(Boolean(readOnly))}
    />
  ),
}));
vi.mock("./work-item-sla", () => ({
  default: () => <div data-testid="sla-section" />,
}));
vi.mock("./work-item-attachments", () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => (
    <div
      data-testid="work-item-attachments"
      data-read-only={String(Boolean(readOnly))}
    />
  ),
}));
vi.mock("@/components/service-management/change-section", () => ({
  default: () => null,
  useChangeSectionVisible: () => false,
}));
vi.mock("./work-item-audit-history", () => ({ default: () => null }));
vi.mock("./work-item-activity", () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => (
    <div
      data-testid="work-item-activity"
      data-read-only={String(Boolean(readOnly))}
    />
  ),
}));

vi.mock("./work-item-title", () => ({
  default: ({
    item,
    readOnly,
  }: {
    item: { title: string };
    readOnly?: boolean;
  }) => (
    <p data-testid="work-item-title" data-read-only={String(Boolean(readOnly))}>
      {item.title}
    </p>
  ),
}));
vi.mock("./work-item-description", () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => (
    <div
      data-testid="work-item-description"
      data-read-only={String(Boolean(readOnly))}
    />
  ),
}));
vi.mock("./work-item-properties", () => ({
  default: ({
    compact,
    readOnly,
    onAccessLost,
    children,
  }: React.PropsWithChildren<{
    compact?: boolean;
    readOnly?: boolean;
    onAccessLost: () => void;
  }>) => (
    <div
      data-testid="work-item-properties"
      data-compact={String(!!compact)}
      data-read-only={String(Boolean(readOnly))}
    >
      <Button type="button" onClick={onAccessLost}>
        properties
      </Button>
      {children}
    </div>
  ),
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
    defaultCommentVisibility: "internal",
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
  activityFilter: "everything",
  onActivityFilterChange: vi.fn(),
  project: undefined,
  isLoading: false,
  isNotFound: false,
  isError: false,
  onRetry: vi.fn(),
  onAccessLost: vi.fn(),
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

  it("renders kaneo's task layout: key, title, description, activity, and the Properties column", () => {
    render(
      <WorkItemDetail
        {...baseProps}
        item={makeItem()}
        project={{ name: "Platform", slug: "PROJ" }}
      />,
    );
    expect(screen.getByText("PROJ-123")).toBeInTheDocument();
    expect(screen.getByTestId("work-item-title")).toHaveTextContent(
      "Fix the thing",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Fix the thing",
    );
    expect(screen.getByTestId("work-item-description")).toBeInTheDocument();
    expect(screen.getByTestId("work-item-activity")).toBeInTheDocument();
    const properties = screen.getByTestId("work-item-properties");
    expect(properties).toHaveAttribute("data-compact", "false");
    expect(screen.getByTestId("work-item-metadata")).toHaveTextContent(
      "Platform",
    );
    const propertiesScroll = screen.getByTestId("work-item-properties-scroll");
    expect(propertiesScroll).toHaveClass(
      "min-h-0",
      "overflow-y-auto",
      "overscroll-contain",
    );
    expect(propertiesScroll).toContainElement(properties);
    expect(
      screen.getByRole("separator", {
        name: "workItems:detail.resizeProperties",
      }),
    ).toHaveAttribute("aria-valuemin", "260");
  });

  it("keeps the task-page-frame Properties panel independently scrollable and resizable", () => {
    render(
      <WorkItemDetail
        {...baseProps}
        item={makeItem()}
        pageHeader={<div data-testid="task-page-header" />}
      />,
    );
    const scroll = screen.getByTestId("work-item-properties-scroll");
    expect(screen.getByTestId("task-page-header")).toBeInTheDocument();
    expect(scroll).toHaveClass("min-h-0", "overflow-y-auto");
    expect(
      screen.getByRole("separator", {
        name: "workItems:detail.resizeProperties",
      }),
    ).toBeInTheDocument();
    expect(scroll).toContainElement(screen.getByTestId("work-item-properties"));
  });

  it("keeps compact properties scrollable without offering the desktop resize handle", () => {
    device.mobile = true;
    render(<WorkItemDetail {...baseProps} item={makeItem()} />);
    expect(screen.getByTestId("work-item-properties-scroll")).toHaveClass(
      "max-h-[40vh]",
      "overflow-y-auto",
    );
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("keeps archived details visible while marking every editable surface read-only", () => {
    timeFeature.on = true;
    locationState.search = {
      sections: { itemKey: "PROJ-123", open: ["time", "attachments"] },
    };
    render(
      <WorkItemDetail
        {...baseProps}
        item={makeItem({ archivedAt: "2026-10-20T00:00:00.000Z" })}
      />,
    );

    expect(screen.getByText("workItems:list.archived")).toBeInTheDocument();
    for (const id of [
      "work-item-title",
      "work-item-description",
      "work-item-activity",
      "work-item-properties",
      "work-item-relations",
      "work-item-attachments",
      "time-section",
    ]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-read-only", "true");
    }
  });

  it("keeps an explicitly opened SLA disclosure below the title on narrow screens and mounts it once", () => {
    device.mobile = true;
    locationState.search = { sections: { itemKey: "PROJ-123", open: ["sla"] } };
    render(<WorkItemDetail {...baseProps} item={makeItem()} />);
    const title = screen.getByTestId("work-item-title");
    const sla = screen.getByTestId("sla-section");
    expect(
      title.compareDocumentPosition(sla) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("work-item-properties")).not.toContainElement(
      sla,
    );
    expect(screen.getAllByTestId("sla-section")).toHaveLength(1);
  });

  it("keeps empty supporting panels collapsed and stores disclosure changes without losing URL state", () => {
    locationState.searchStr = "?activity=comments&comment=comment-id";
    locationState.hash = "activity";
    render(<WorkItemDetail {...baseProps} item={makeItem()} variant="pane" />);
    expect(screen.queryByTestId("sla-section")).toBeNull();
    expect(screen.queryByTestId("work-item-approvals")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:detail.sla.heading" }),
    );
    const call = navigate.mock.calls.at(-1)?.[0] as {
      href: string;
      replace: boolean;
    };
    const url = new URL(call.href, "https://taskdesk.example");
    expect(url.searchParams.get("activity")).toBe("comments");
    expect(url.searchParams.get("comment")).toBe("comment-id");
    expect(JSON.parse(url.searchParams.get("sections") ?? "null")).toEqual({
      itemKey: "PROJ-123",
      open: ["sla"],
    });
    expect(url.hash).toBe("#activity");
    expect(call.replace).toBe(true);
  });

  it("offers the Time section only where feature.time_tracking is on, collapsed until opened", () => {
    render(<WorkItemDetail {...baseProps} item={makeItem()} variant="pane" />);
    expect(
      screen.queryByRole("button", { name: "workItems:detail.time.heading" }),
    ).toBeNull();
    cleanup();
    timeFeature.on = true;
    render(<WorkItemDetail {...baseProps} item={makeItem()} variant="pane" />);
    expect(screen.queryByTestId("time-section")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:detail.time.heading" }),
    );
    const call = navigate.mock.calls.at(-1)?.[0] as { href: string };
    const url = new URL(call.href, "https://taskdesk.example");
    expect(JSON.parse(url.searchParams.get("sections") ?? "null")).toEqual({
      itemKey: "PROJ-123",
      open: ["time"],
    });
  });

  it("hides the Time section from a caller without time_entry:create even with the flag on (R6-02)", () => {
    timeFeature.on = true;
    timeFeature.logTime = false;
    render(<WorkItemDetail {...baseProps} item={makeItem()} variant="pane" />);
    expect(
      screen.queryByRole("button", { name: "workItems:detail.time.heading" }),
    ).toBeNull();
  });

  it("uses kaneo's compact properties strip in the side pane", () => {
    render(<WorkItemDetail {...baseProps} item={makeItem()} variant="pane" />);
    expect(screen.getByTestId("work-item-properties")).toHaveAttribute(
      "data-compact",
      "true",
    );
    expect(screen.queryByTestId("work-item-metadata")).toBeNull();
  });

  it("keeps the pane's properties strip fixed while the content scrolls, as kaneo's sheet does", () => {
    render(<WorkItemDetail {...baseProps} item={makeItem()} variant="pane" />);
    const strip = screen.getByTestId("work-item-properties-strip");
    expect(strip).toHaveClass("shrink-0");
    expect(strip).toContainElement(screen.getByTestId("work-item-properties"));
    const content = screen.getByTestId("work-item-pane-content");
    expect(content).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    expect(content).toContainElement(screen.getByTestId("work-item-title"));
    expect(strip).not.toContainElement(screen.getByTestId("work-item-title"));
  });

  it("mounts one polite status region for save announcements", () => {
    render(<WorkItemDetail {...baseProps} item={makeItem()} />);
    expect(screen.getByTestId("work-item-status")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("reports access loss from a property control", () => {
    const onAccessLost = vi.fn();
    render(
      <WorkItemDetail
        {...baseProps}
        item={makeItem()}
        onAccessLost={onAccessLost}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "properties" }));
    expect(onAccessLost).toHaveBeenCalledTimes(1);
  });

  it("shows the partial notice and an unavailable badge for a field that failed validation", () => {
    render(
      <WorkItemDetail
        {...baseProps}
        item={makeItem({ unavailableFields: ["title"] })}
      />,
    );
    expect(
      screen.getByTestId("work-item-detail-partial-notice"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("work-item-title")).toBeNull();
    expect(
      screen.getByText("workItems:detail.unavailable"),
    ).toBeInTheDocument();
  });

  it("does not open an editor over a description it cannot read", () => {
    render(
      <WorkItemDetail {...baseProps} item={makeItem({ description: 42 })} />,
    );
    expect(screen.queryByTestId("work-item-description")).toBeNull();
    expect(
      screen.getByText("workItems:detail.unavailable"),
    ).toBeInTheDocument();
  });
});
