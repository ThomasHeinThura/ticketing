import en from "@i18n/en-US.json";
import { Button } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";
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

vi.mock("@/hooks/queries/work-item/use-get-work-item", () => ({
  default: () => ({
    data: makeItem(),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("./work-item-actions", () => ({ default: () => null }));

const network = vi.hoisted(() => ({ offline: false, requests: 0 }));
vi.mock("@/lib/i18n/after-first-paint", () => ({
  afterFirstPaint: () => new Promise(() => {}),
}));
vi.mock("@/lib/i18n/group-loaders-rest", async () => {
  const actual = await vi.importActual<{
    default: Record<string, () => Promise<unknown>>;
  }>("@/lib/i18n/group-loaders-rest");
  return {
    default: new Proxy(actual.default, {
      get(target, locale: string) {
        return () => {
          network.requests++;
          return network.offline
            ? Promise.reject(new Error("offline"))
            : target[locale]();
        };
      },
    }),
  };
});
vi.mock("@i18n/resources", async () => {
  const actual =
    await vi.importActual<typeof import("@i18n/resources")>("@i18n/resources");
  return {
    ...actual,
    loadLocale: (...args: Parameters<typeof actual.loadLocale>) =>
      network.offline
        ? Promise.reject(new Error("offline"))
        : actual.loadLocale(...args),
  };
});

it.each(["page", "pane"] as const)(
  "real %s detail waits for the real namespace loader and recovers after network failure",
  async (variant) => {
    window.history.replaceState(
      {},
      "",
      "/agent/projects/PROJ/work?item=PROJ-123",
    );
    vi.resetModules();
    network.offline = true;
    network.requests = 0;
    const { i18n, areAllNamespacesLoaded } = await import("@/lib/i18n");
    await vi.waitFor(() =>
      expect(i18n.hasLoadedNamespace("workItems")).toBe(true),
    );
    expect(i18n.hasLoadedNamespace("workItemExtras")).toBe(false);
    const { default: Boundary } = await import(
      "./work-item-namespace-boundary"
    );
    const { QueryClient, QueryClientProvider } = await import(
      "@tanstack/react-query"
    );
    const { default: SidePaneBody } = await import(
      "./work-item-side-pane-body"
    );
    const content = (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <I18nextProvider i18n={i18n}>
          {variant === "pane" ? (
            <SidePaneBody itemKey="PROJ-123" onClose={() => {}} />
          ) : (
            <Boundary>
              <WorkItemDetail
                {...baseProps}
                item={makeItem()}
                variant={variant}
              />
            </Boundary>
          )}
        </I18nextProvider>
      </QueryClientProvider>
    );
    render(content);
    expect(screen.getByTestId("work-item-detail-loading")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.common.error.messages.unknown,
    );
    expect(screen.queryByText("Attachments")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[A-Za-z]+:[A-Za-z_][\w.]+/);
    network.offline = false;
    fireEvent.click(
      screen.getByRole("button", { name: en.common.actions.retry }),
    );
    await waitFor(() => expect(screen.getByText("Attachments")).toBeVisible());
    expect(screen.getByText("SLA")).toBeVisible();
    expect(areAllNamespacesLoaded()).toBe(true);
    expect(network.requests).toBeGreaterThan(1);
    expect(document.body.textContent).not.toMatch(/[A-Za-z]+:[A-Za-z_][\w.]+/);
    cleanup();
    render(content);
    expect(
      screen.queryByTestId("work-item-detail-loading"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Attachments")).toBeVisible();
    window.history.replaceState({}, "", "/");
  },
);
