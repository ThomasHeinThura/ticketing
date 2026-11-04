import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UAT re-audit: `useWorkspacePermission` keeps `isCheckingPermissions` true after the
 * `/api/capabilities` read fails (404 for an unknown or unreachable project, 5xx, network), so
 * every settings screen behind the access gate showed "Checking your access" forever with no
 * Retry. These run the real permission hook against a failing capabilities response.
 */
const mocks = vi.hoisted(() => ({
  capabilitiesGet: vi.fn(),
  getStateTemplates: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@taskdesk/libs", () => ({
  client: { capabilities: { $get: mocks.capabilitiesGet } },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" }, isLoading: false }),
}));
vi.mock("@/hooks/queries/workspace-users/use-active-workspace-user", () => ({
  useGetActiveWorkspaceUser: () => ({
    data: { role: "admin" },
    isLoading: false,
  }),
}));
vi.mock("@/fetchers/project-settings-inheritance", () => ({
  getWorkspaceStateTemplates: mocks.getStateTemplates,
  createWorkspaceStateTemplate: vi.fn(),
  patchWorkspaceStateTemplate: vi.fn(),
  WorkspaceSettingsError: class extends Error {},
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));

import { SettingsAccessGate, useSettingsAccess } from "./settings-access";
import { WorkspaceStateTemplatesPanel } from "./workspace-state-templates-panel";

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

function SettingsScreen({ projectId }: { projectId?: string }) {
  const access = useSettingsAccess(
    (permission) => permission.canManageProjectSettings(),
    projectId,
  );
  return (
    <SettingsAccessGate access={access}>
      <p data-testid="settings-content">content</p>
    </SettingsAccessGate>
  );
}

beforeEach(() => {
  mocks.capabilitiesGet.mockReset();
  mocks.getStateTemplates.mockReset();
});
afterEach(cleanup);

describe("settings access when the capability read fails", () => {
  it("offers Retry on a 500 instead of checking forever, then recovers", async () => {
    mocks.capabilitiesGet
      .mockResolvedValueOnce(respond(500))
      .mockResolvedValueOnce(respond(200, { manageProjectSettings: true }));
    renderWithClient(<SettingsScreen />);

    expect(
      await screen.findByTestId("settings-access-error"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "settings:accessDenied.loadErrorTitle",
    );
    expect(screen.queryByRole("status")).toBeNull();
    // Fails closed: the screen's own content (and so its queries) never renders.
    expect(screen.queryByTestId("settings-content")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.retry" }),
    );
    expect(await screen.findByTestId("settings-content")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-access-error")).toBeNull();
    expect(mocks.capabilitiesGet).toHaveBeenCalledTimes(2);
  });

  it("ends the check on a 404 for an unknown or unreachable project", async () => {
    mocks.capabilitiesGet.mockResolvedValue(respond(404));
    renderWithClient(<SettingsScreen projectId="bogus" />);

    expect(
      await screen.findByTestId("settings-access-error"),
    ).toBeInTheDocument();
    expect(mocks.capabilitiesGet).toHaveBeenCalledWith({
      query: { workspaceId: "ws-1", projectId: "bogus" },
    });
    expect(screen.queryByTestId("settings-content")).toBeNull();
  });

  it("still shows the denial when the read succeeds without the capability", async () => {
    mocks.capabilitiesGet.mockResolvedValue(
      respond(200, { manageProjectSettings: false }),
    );
    renderWithClient(<SettingsScreen projectId="p-1" />);
    expect(
      await screen.findByTestId("settings-access-denied"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-access-error")).toBeNull();
  });

  it("does not report a failure for another project's capability read", async () => {
    mocks.capabilitiesGet.mockImplementation(
      async ({ query }: { query: { projectId?: string } }) =>
        query.projectId === "other"
          ? respond(500)
          : new Promise(() => {
              // This project's read never settles: it must stay "checking".
            }),
    );
    renderWithClient(
      <>
        <SettingsScreen projectId="other" />
        <SettingsScreen projectId="p-1" />
      </>,
    );
    expect(
      await screen.findByTestId("settings-access-error"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("settings-access-error")).toHaveLength(1);
    expect(
      screen.getByRole("status", { name: "settings:accessDenied.checking" }),
    ).toBeInTheDocument();
  });
});

describe("WorkspaceStateTemplatesPanel when the capability read fails", () => {
  it("shows the access error with Retry, not a permanent skeleton", async () => {
    mocks.capabilitiesGet.mockResolvedValue(respond(503));
    renderWithClient(<WorkspaceStateTemplatesPanel workspaceId="ws-1" />);

    expect(
      await screen.findByTestId("settings-access-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-state-templates-loading"),
    ).toBeNull();
    expect(mocks.getStateTemplates).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "common:actions.retry" }),
      ).toBeEnabled(),
    );
  });
});
