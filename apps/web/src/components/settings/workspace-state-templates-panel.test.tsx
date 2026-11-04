import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canEdit: true,
  stateTemplates: {
    workspaceId: "ws-1",
    version: 4,
    templates: [
      {
        id: "template-1",
        key: "in_progress",
        name: "In progress",
        group: "started",
        enabled: true,
      },
      {
        id: "template-2",
        key: "done",
        name: "Done",
        group: "completed",
        enabled: false,
      },
    ],
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () => mocks.canEdit,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/fetchers/project-settings-inheritance", () => ({
  getWorkspaceStateTemplates: vi.fn(async () => mocks.stateTemplates),
  createWorkspaceStateTemplate: vi.fn(),
  patchWorkspaceStateTemplate: vi.fn(),
  WorkspaceSettingsError: class extends Error {
    status: number;
    code?: string;
    affectedItems: unknown[] = [];
    hasHiddenAffectedItems = false;
    constructor(status: number) {
      super();
      this.status = status;
    }
  },
}));

import { WorkspaceStateTemplatesPanel } from "./workspace-state-templates-panel";

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceStateTemplatesPanel workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.canEdit = true;
});

describe("WorkspaceStateTemplatesPanel", () => {
  it("shows stable keys and keeps disabled templates visible", async () => {
    renderPanel();
    expect(
      await screen.findByTestId("workspace-state-templates"),
    ).toBeInTheDocument();
    expect(screen.getByText("in_progress")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(
      screen.getAllByText("settings:workspaceStateTemplates.disabled"),
    ).toHaveLength(1);
  });

  it("shows one access notice and never asks for the catalog without workspace settings capability (UAT re-audit)", async () => {
    // `GET /api/workspace/{id}/state-templates` requires `workspace:manage_settings`, so a role
    // without it could never load a read-only catalog; it used to meet a 403 and a Retry.
    const { getWorkspaceStateTemplates } = await import(
      "@/fetchers/project-settings-inheritance"
    );
    vi.mocked(getWorkspaceStateTemplates).mockClear();
    mocks.canEdit = false;
    renderPanel();
    expect(
      await screen.findByTestId("settings-access-denied"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-state-templates")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "settings:workspaceStateTemplates.retry",
      }),
    ).toBeNull();
    expect(getWorkspaceStateTemplates).not.toHaveBeenCalled();
  });
});
