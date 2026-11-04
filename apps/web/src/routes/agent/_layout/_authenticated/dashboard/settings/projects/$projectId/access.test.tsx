import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** UAT re-audit: project features and budget opened by URL without access logged 403s. */
const mocks = vi.hoisted(() => ({
  canManageProjectSettings: false,
  canReadBudgets: false,
  canLogTime: false,
  checking: false,
  featuresPanel: vi.fn(),
  budget: vi.fn(),
  billable: vi.fn(),
  permissionArgs: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ projectId: "project-1" }),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (...args: unknown[]) => {
    mocks.permissionArgs(...args);
    return {
      canManageProjectSettings: () => mocks.canManageProjectSettings,
      canReadBudgets: () => mocks.canReadBudgets,
      canLogTime: () => mocks.canLogTime,
      isCheckingPermissions: mocks.checking,
    };
  },
}));
vi.mock("@/components/settings/feature-flags-panel", () => ({
  FeatureFlagsPanel: () => {
    mocks.featuresPanel();
    return null;
  },
}));
vi.mock("@/components/time-tracking/project-budget", () => ({
  ProjectBudget: () => {
    mocks.budget();
    return null;
  },
}));
vi.mock("@/components/time-tracking/time-settings", () => ({
  ProjectBillableSetting: () => {
    mocks.billable();
    return null;
  },
}));

import { Route as BudgetRoute } from "./budget";
import { Route as FeaturesRoute } from "./features";

const Features = (FeaturesRoute as unknown as { component: ComponentType })
  .component;
const Budget = (BudgetRoute as unknown as { component: ComponentType })
  .component;

/** A client whose `/api/capabilities` read for this scope has failed and settled. */
function failedCapabilities(queryKey: readonly unknown[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client
    .getQueryCache()
    .build(client, { queryKey: [...queryKey] })
    .setState({
      status: "error",
      fetchStatus: "idle",
      error: new Error("Failed to get capabilities"),
    });
  return client;
}

function renderWithClient(node: ReactNode, client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.canManageProjectSettings = false;
  mocks.canReadBudgets = false;
  mocks.canLogTime = false;
  mocks.checking = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Project features access", () => {
  it("shows the access notice and never reads features without project:manage_settings", () => {
    renderWithClient(<Features />);
    expect(screen.getByTestId("settings-access-denied")).toBeInTheDocument();
    expect(mocks.featuresPanel).not.toHaveBeenCalled();
    // Decided at this project, so a project-only grant still counts.
    expect(mocks.permissionArgs).toHaveBeenCalledWith("ws-1", "project-1");
  });

  it("shows the panel to a project settings manager", () => {
    mocks.canManageProjectSettings = true;
    renderWithClient(<Features />);
    expect(mocks.featuresPanel).toHaveBeenCalled();
  });
});

describe("Project budget access", () => {
  it("shows one access notice and reads nothing without budget:read or time_entry:create", () => {
    renderWithClient(<Budget />);
    expect(screen.getAllByTestId("settings-access-denied")).toHaveLength(1);
    expect(mocks.budget).not.toHaveBeenCalled();
    expect(mocks.billable).not.toHaveBeenCalled();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows only the budget to a budget reader who does not log time", () => {
    mocks.canReadBudgets = true;
    renderWithClient(<Budget />);
    expect(mocks.budget).toHaveBeenCalled();
    expect(mocks.billable).not.toHaveBeenCalled();
  });

  it("shows both sections to a role with both capabilities", () => {
    mocks.canReadBudgets = true;
    mocks.canLogTime = true;
    renderWithClient(<Budget />);
    expect(mocks.budget).toHaveBeenCalled();
    expect(mocks.billable).toHaveBeenCalled();
    expect(screen.queryByTestId("settings-access-denied")).toBeNull();
  });
});

describe("Project settings access when the capability read fails (UAT re-audit)", () => {
  const projectRead = [
    "workspace-capabilities",
    "ws-1",
    "work-item-target",
    "project-1",
  ];

  it("features: offers Retry for an unknown or unreachable project instead of checking forever", () => {
    mocks.checking = true;
    renderWithClient(<Features />, failedCapabilities(projectRead));
    expect(screen.getByTestId("settings-access-error")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "settings:accessDenied.checking" }),
    ).toBeNull();
    expect(mocks.featuresPanel).not.toHaveBeenCalled();
  });

  it("budget: offers Retry and reads neither section", () => {
    mocks.checking = true;
    renderWithClient(<Budget />, failedCapabilities(projectRead));
    expect(screen.getByTestId("settings-access-error")).toBeInTheDocument();
    expect(mocks.budget).not.toHaveBeenCalled();
    expect(mocks.billable).not.toHaveBeenCalled();
  });
});
