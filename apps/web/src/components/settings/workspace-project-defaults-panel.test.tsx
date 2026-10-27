import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canEdit: true,
  defaults: {
    workspaceId: "ws-1",
    defaultSlaPolicyId: null as string | null,
    defaultServiceCalendarId: null as string | null,
    enabledStateTemplateIds: [],
    version: 3,
  },
  getCalendars: vi.fn(async () => ({
    data: [{ id: "cal-1", name: "Support hours" }],
    page: { nextCursor: null },
  })),
  getPolicies: vi.fn(async () => ({
    data: [{ id: "sla-1", name: "Standard" }],
    page: { nextCursor: null },
  })),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () => mocks.canEdit,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/fetchers/project-settings-inheritance", () => ({
  getWorkspaceProjectSettings: vi.fn(async () => mocks.defaults),
  patchWorkspaceProjectSettings: vi.fn(),
  WorkspaceSettingsError: class extends Error {
    status: number;
    constructor(status: number) {
      super();
      this.status = status;
    }
  },
}));
vi.mock("@/fetchers/service-calendar", () => ({
  getServiceCalendars: mocks.getCalendars,
}));
vi.mock("@/fetchers/sla-policy", () => ({ getSlaPolicies: mocks.getPolicies }));
// P4R2-M1: the SLA areas follow the workspace's resolved `feature.sla`.
const workspaceFeatureState = vi.hoisted(() => ({ sla: true, loading: false }));
vi.mock("@/hooks/queries/feature-flag/use-workspace-features", () => ({
  default: () => ({
    isOn: (key: string) => key === "feature.sla" && workspaceFeatureState.sla,
    isLoading: workspaceFeatureState.loading,
  }),
}));

import { WorkspaceProjectDefaultsPanel } from "./workspace-project-defaults-panel";

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceProjectDefaultsPanel workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.canEdit = true;
  workspaceFeatureState.sla = true;
  workspaceFeatureState.loading = false;
  mocks.getPolicies.mockClear();
  mocks.getCalendars.mockClear();
});

describe("WorkspaceProjectDefaultsPanel", () => {
  it("loads actual SLA/calendar choices and renders the saved defaults", async () => {
    renderPanel();
    expect(
      await screen.findByTestId("workspace-project-defaults"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "settings:workspaceProjectDefaults.defaultSlaPolicy",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "settings:workspaceProjectDefaults.defaultServiceCalendar",
      ),
    ).toBeInTheDocument();
    expect(mocks.getPolicies).toHaveBeenCalledWith("ws-1", undefined);
    expect(mocks.getCalendars).toHaveBeenCalledWith("ws-1", undefined);
  });

  it("does not expose editing when workspace settings capability is absent", async () => {
    mocks.canEdit = false;
    renderPanel();
    expect(
      await screen.findByTestId("workspace-project-defaults"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "settings:workspaceProjectDefaults.defaultSlaPolicy",
      ),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(
        "settings:workspaceProjectDefaults.defaultServiceCalendar",
      ),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", {
        name: "settings:workspaceProjectDefaults.save",
      }),
    ).not.toBeInTheDocument();
  });

  it("is not offered and loads no SLA lists while feature.sla is off (P4R2-M1)", async () => {
    workspaceFeatureState.sla = false;
    const { container } = renderPanel();
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.getPolicies).not.toHaveBeenCalled();
    expect(mocks.getCalendars).not.toHaveBeenCalled();
  });
});
