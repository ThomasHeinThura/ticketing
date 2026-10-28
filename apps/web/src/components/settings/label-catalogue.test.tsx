import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LabelCatalogueSearch } from "@/lib/routes";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  workspaceLabels: [] as Array<{
    id: string;
    name: string;
    color: string;
    key: string | null;
    taskId: string | null;
  }>,
  createWorkspaceLabel: vi.fn(),
  createProjectLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
  projectLabels: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) =>
      translate(key, options),
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    workspace: { id: "workspace-1" },
    canManageLabels: () => true,
    canCreateLabels: () => true,
    canUpdateLabels: () => true,
    canDeleteLabels: () => true,
  }),
}));
vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({
    data: mocks.workspaceLabels,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/mutations/label/use-create-label", () => ({
  default: () => ({
    mutateAsync: mocks.createWorkspaceLabel,
    isPending: false,
  }),
}));
vi.mock("@/hooks/mutations/label/use-update-label", () => ({
  default: () => ({ mutateAsync: mocks.updateLabel, isPending: false }),
}));
vi.mock("@/hooks/mutations/label/use-delete-label", () => ({
  default: () => ({ mutateAsync: mocks.deleteLabel, isPending: false }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/fetchers/label/project-labels", () => ({
  createProjectLabel: (...args: unknown[]) => mocks.createProjectLabel(...args),
  deleteProjectLabel: vi.fn(),
  getProjectLabels: (...args: unknown[]) => mocks.projectLabels(...args),
  updateProjectLabel: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { LabelCatalogue } from "./label-catalogue";

function TestCatalogue({ projectId }: { projectId?: string }) {
  const [search, setSearch] = useState<LabelCatalogueSearch>({});
  return (
    <LabelCatalogue
      projectId={projectId}
      search={search}
      onSearchChange={setSearch}
    />
  );
}

function renderCatalogue(projectId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TestCatalogue projectId={projectId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.workspaceLabels = [];
  mocks.createWorkspaceLabel.mockReset().mockResolvedValue({
    id: "label-1",
    name: "Support",
    color: "blue",
    key: "support",
    taskId: null,
  });
  mocks.createProjectLabel.mockReset().mockResolvedValue({
    id: "project-label-1",
    name: "Local",
    color: "blue",
    key: null,
    taskId: null,
  });
  mocks.updateLabel.mockReset();
  mocks.deleteLabel.mockReset();
  mocks.projectLabels.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe("LabelCatalogue stable keys", () => {
  it("requires and sends a stable key for workspace labels", async () => {
    renderCatalogue();
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:workspaceLabels.createLabel"),
      }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: translate("settings:workspaceLabels.nameLabel"),
      }),
      { target: { value: "Support" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: translate("settings:workspaceLabels.stableKeyLabel"),
      }),
      { target: { value: "Invalid_Key" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:workspaceLabels.createLabel"),
      }),
    );
    expect(
      await screen.findByText(
        translate("settings:workspaceLabels.stableKeyInvalid"),
      ),
    ).toBeInTheDocument();
    expect(mocks.createWorkspaceLabel).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByRole("textbox", {
        name: translate("settings:workspaceLabels.stableKeyLabel"),
      }),
      { target: { value: "support_enterprise" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:workspaceLabels.createLabel"),
      }),
    );
    await waitFor(() =>
      expect(mocks.createWorkspaceLabel).toHaveBeenCalledWith({
        name: "Support",
        color: "gray",
        workspaceId: "workspace-1",
        key: "support_enterprise",
      }),
    );
  });

  it("does not offer stable keys for project catalogue labels", async () => {
    renderCatalogue("project-1");
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:workspaceLabels.createLabel"),
      }),
    );

    expect(
      screen.queryByRole("textbox", {
        name: translate("settings:workspaceLabels.stableKeyLabel"),
      }),
    ).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: translate("settings:workspaceLabels.nameLabel"),
      }),
      { target: { value: "Local" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:workspaceLabels.createLabel"),
      }),
    );
    await waitFor(() =>
      expect(mocks.createProjectLabel).toHaveBeenCalledWith("project-1", {
        name: "Local",
        color: "gray",
      }),
    );
  });

  it("shows an existing workspace key read-only and excludes it from updates", async () => {
    mocks.workspaceLabels = [
      {
        id: "label-1",
        name: "Support",
        color: "blue",
        key: "support",
        taskId: null,
      },
    ];
    mocks.updateLabel.mockResolvedValue({
      id: "label-1",
      name: "Support renamed",
      color: "blue",
      key: "support",
      taskId: null,
    });
    renderCatalogue();
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:workspaceLabels.editLabel"),
      }),
    );

    const keyInput = await screen.findByRole("textbox", {
      name: translate("settings:workspaceLabels.stableKeyReadOnlyLabel"),
    });
    expect(keyInput).toHaveValue("support");
    expect(keyInput).toHaveAttribute("readonly");
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:workspaceLabels.saveLabel"),
      }),
    );
    await waitFor(() =>
      expect(mocks.updateLabel).toHaveBeenCalledWith({
        id: "label-1",
        name: "Support",
        color: "blue",
      }),
    );
    expect(mocks.updateLabel.mock.calls[0]?.[0]).not.toHaveProperty("key");
  });
});
