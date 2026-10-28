import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardDetail } from "@/fetchers/report";

const mocks = vi.hoisted(() => ({
  updateDashboard: vi.fn(),
  createDashboard: vi.fn(),
  requestDashboardDeletion: vi.fn(),
  openPending: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
  dashboard: undefined as unknown,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "title" in options ? `${key} ${options.title}` : key,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: string) => String(value).slice(0, 10),
  formatDateTime: (value: string) => String(value).slice(0, 16),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" }, isLoading: false }),
}));
vi.mock("@/fetchers/saved-views", () => ({
  getSavedViews: async () => [],
}));
vi.mock("@/fetchers/report", () => {
  class ReportRuleError extends Error {
    code: string;
    constructor(_status: number, code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    ReportRuleError,
    updateDashboard: (...args: unknown[]) => mocks.updateDashboard(...args),
    createDashboard: (...args: unknown[]) => mocks.createDashboard(...args),
    requestDashboardDeletion: (...args: unknown[]) =>
      mocks.requestDashboardDeletion(...args),
  };
});
vi.mock("@/hooks/queries/report", () => ({
  reportKeys: {
    all: (workspaceId: string) => ["reports", workspaceId],
    dashboards: (workspaceId: string) => ["reports", workspaceId, "dashboards"],
  },
  useReportCatalogue: () => ({
    data: {
      data: [
        {
          key: "throughput",
          title: "Throughput",
          category: "delivery",
          tier: 1,
          live: false,
          available: true,
          options: [],
        },
      ],
      meta: {
        canExport: true,
        canSeeRates: false,
        canManageWorkspaceDashboards: true,
      },
    },
  }),
  useDashboards: () => ({
    isLoading: false,
    isError: false,
    data: {
      data: [(mocks.dashboard as DashboardDetail) ?? null].filter(Boolean),
      meta: { canManageWorkspaceDashboards: true },
    },
  }),
  useDashboard: () => ({
    isLoading: false,
    isError: false,
    data: mocks.dashboard,
  }),
  useWidgetData: () => ({ isLoading: true, isError: false, data: undefined }),
}));

import { DashboardEditor } from "./dashboard-editor";

function dashboard(overrides: Partial<DashboardDetail> = {}): DashboardDetail {
  return {
    id: "d1",
    workspaceId: "w1",
    ownerId: "p1",
    name: "Mine",
    scope: "personal",
    isDefault: false,
    version: 4,
    canEdit: true,
    widgetCount: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    widgets: [
      {
        id: "a",
        reportKey: "throughput",
        savedViewId: null,
        chartType: "bar",
        filters: { window: "30" },
        x: 0,
        y: 0,
        w: 6,
        h: 4,
      },
      {
        id: "b",
        reportKey: "ageing",
        savedViewId: null,
        chartType: "bar",
        filters: {},
        x: 6,
        y: 0,
        w: 6,
        h: 4,
      },
    ],
    ...overrides,
  };
}

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardEditor search={{}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.dashboard = dashboard();
  mocks.updateDashboard.mockResolvedValue(mocks.dashboard);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("dashboard editor (RP-15)", () => {
  it("refuses a resize that would overlap a neighbour and says why", () => {
    renderEditor();
    fireEvent.click(
      screen.getByRole("button", {
        name: "reports:editor.wider reports:catalogue.throughput.title",
      }),
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "reports:editor.refused.overlap",
    );
    expect(
      screen
        .getByRole("button", { name: "reports:editor.save" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("saves the whole layout in one call with the version it edited, keeping widget ids", async () => {
    renderEditor();
    fireEvent.click(
      screen.getByRole("button", {
        name: "reports:editor.shorter reports:catalogue.throughput.title",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "reports:editor.save" }),
    );
    await waitFor(() => expect(mocks.updateDashboard).toHaveBeenCalledTimes(1));
    const [id, body] = mocks.updateDashboard.mock.calls[0] as [
      string,
      { version: number; widgets: Array<{ id?: string; h: number }> },
    ];
    expect(id).toBe("d1");
    expect(body.version).toBe(4);
    expect(body.widgets.map((widget) => widget.id)).toEqual(["a", "b"]);
    expect(body.widgets[0]?.h).toBe(3);
    expect(body.widgets[1]?.h).toBe(4);
  });

  it("removes a widget from the saved layout", async () => {
    renderEditor();
    fireEvent.click(
      screen.getByRole("button", {
        name: "reports:editor.remove reports:catalogue.ageing.title",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "reports:editor.save" }),
    );
    await waitFor(() => expect(mocks.updateDashboard).toHaveBeenCalled());
    const body = mocks.updateDashboard.mock.calls[0]?.[1] as {
      widgets: Array<{ id?: string }>;
    };
    expect(body.widgets.map((widget) => widget.id)).toEqual(["a"]);
  });

  it("gives every control a name a keyboard user can reach", () => {
    renderEditor();
    for (const verb of [
      "move",
      "narrower",
      "wider",
      "shorter",
      "taller",
      "remove",
    ])
      expect(
        screen.getByRole("button", {
          name: `reports:editor.${verb} reports:catalogue.throughput.title`,
        }),
      ).toBeTruthy();
  });

  it("is read-only for someone who cannot change the dashboard, who can copy it instead", () => {
    mocks.dashboard = dashboard({
      canEdit: false,
      scope: "workspace",
      ownerId: null,
    });
    renderEditor();
    expect(
      screen.queryByRole("button", { name: /reports:editor.move/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "reports:editor.save" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "reports:editor.copy" }),
    ).toBeTruthy();
    expect(screen.getByText("reports:editor.readOnly")).toBeTruthy();
  });

  it("requests deletion and opens the approval, deleting nothing itself", async () => {
    mocks.requestDashboardDeletion.mockResolvedValue({
      pendingActionId: "pa1",
    });
    renderEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "reports:editor.delete" }),
    );
    await waitFor(() =>
      expect(mocks.openPending).toHaveBeenCalledWith({
        pendingActionId: "pa1",
      }),
    );
    expect(mocks.requestDashboardDeletion).toHaveBeenCalledWith("d1");
  });
});
