import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider, toastManager } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  prove: vi.fn(),
  openPending: vi.fn(),
  factorStatus: {
    enabled: false,
    required: false,
    availableMethods: ["password"] as string[],
  },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: (namespace?: string) => ({
    t: (rawKey: string, options: Record<string, unknown> = {}) =>
      translate(
        namespace && !rawKey.includes(":") ? `${namespace}:${rawKey}` : rawKey,
        options,
      ),
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    onClick,
    ...rest
  }: {
    children: ReactNode;
    params: { projectId: string };
    onClick?: () => void;
  } & Record<string, unknown>) => (
    <a
      href={`/dashboard/settings/projects/${params.projectId}/members`}
      onClick={onClick}
      aria-label={rest["aria-label"] as string}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));
vi.mock("@/fetchers/god-mode/identity-step-up", () => ({
  proveIdentityOperation: (...args: unknown[]) => mocks.prove(...args),
}));
vi.mock("@/fetchers/god-mode/instance-users", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/god-mode/instance-users")
  >()),
  getCurrentFactorStatus: async () => mocks.factorStatus,
}));
vi.mock("@/fetchers/workspace-roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/workspace-roles")>()),
  listRoles: (...args: unknown[]) => mocks.list(...args),
  updateRole: (...args: unknown[]) => mocks.update(...args),
  requestRoleDeletion: (...args: unknown[]) => mocks.remove(...args),
}));

import { RoleApiError } from "@/fetchers/workspace-roles";
import { ProjectRolesView } from "./project-roles-view";

function role(overrides: Record<string, unknown> = {}) {
  return {
    id: "role-custom",
    workspaceId: "ws-1",
    role: "service-desk",
    name: "Service desk",
    description: "Answers customers",
    rank: 1,
    capabilities: [],
    isSystem: false,
    isEditable: true,
    holderCount: 3,
    projectCount: 2,
    scope: "project",
    version: "100",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}
const builtIn = role({
  id: "role-lead",
  role: "project-lead",
  name: "Project lead",
  description: null,
  isSystem: true,
  isEditable: false,
  holderCount: 0,
  projectCount: 0,
});

function setup(canManage = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["god-mode", "step-up-factor"], mocks.factorStatus);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProjectRolesView workspaceId="ws-1" canManage={canManage} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([builtIn, role()]);
  mocks.update.mockReset().mockResolvedValue(role({ name: "Desk" }));
  mocks.remove.mockReset().mockResolvedValue({ pendingActionId: "pa-1" });
  mocks.prove.mockReset().mockResolvedValue("step-up-token");
  mocks.openPending.mockReset();
});
afterEach(() => {
  cleanup();
  toastManager.close();
});

describe("ProjectRolesView", () => {
  it("lists project roles under their own cache key, built-ins read-only", async () => {
    const { client } = setup();
    expect(await screen.findByText("Service desk")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith("ws-1", "project");
    expect(
      client.getQueryData(["workspace-roles", "ws-1", "project"]),
    ).toBeDefined();
    expect(client.getQueryData(["workspace-roles", "ws-1"])).toBeUndefined();
    expect(screen.getByText("Project lead")).toBeInTheDocument();
    expect(screen.getByText(/3 people · 2 projects/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit details of Service desk" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Project lead/ }),
    ).not.toBeInTheDocument();
  });

  it("shows no actions without permission to manage roles", async () => {
    setup(false);
    await screen.findByText("Service desk");
    expect(screen.queryByRole("button", { name: /Edit details/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("shows empty and error states", async () => {
    mocks.list.mockResolvedValue([]);
    setup();
    expect(await screen.findByText("No project roles yet")).toBeVisible();
    cleanup();
    mocks.list.mockRejectedValue(new Error("boom"));
    setup();
    expect(
      await screen.findByText("Could not load project roles"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("renames with a fresh verification and refreshes the project queries", async () => {
    const { invalidate } = setup();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Edit details of Service desk",
      }),
    );
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Desk" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.prove).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "workspace_role_update",
        workspaceId: "ws-1",
        roleId: "role-custom",
        name: "Desk",
        expectedVersion: "100",
      }),
      { method: "password", secret: "correct horse" },
    );
    expect(mocks.update).toHaveBeenCalledWith(
      "ws-1",
      "role-custom",
      {
        name: "Desk",
        description: "Answers customers",
        expectedVersion: "100",
      },
      "step-up-token",
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["workspace-roles", "ws-1", "project"],
      }),
    );
  });

  it("offers a reload when someone else changed the role", async () => {
    mocks.update.mockRejectedValue(
      new RoleApiError(409, "changed", "role_changed", {}),
    );
    setup();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Edit details of Service desk",
      }),
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Desk" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const reload = await screen.findByRole("button", { name: "Reload" });
    fireEvent.click(reload);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("opens the approval after a delete request is accepted", async () => {
    setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Service desk" }),
    );
    await waitFor(() =>
      expect(mocks.openPending).toHaveBeenCalledWith({
        pendingActionId: "pa-1",
      }),
    );
    expect(mocks.remove).toHaveBeenCalledWith("ws-1", "role-custom");
  });

  it("explains an in-use role with counts and links to each project's members", async () => {
    mocks.remove.mockRejectedValue(
      new RoleApiError(409, "in use", "role_in_use", {
        holderCount: 3,
        projectCount: 22,
        projects: [
          { id: "p-1", name: "Alpha" },
          { id: "p-2", name: "Beta" },
        ],
      }),
    );
    setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Service desk" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("This role is still in use")).toBeVisible();
    expect(within(dialog).getByText(/3 people still hold/)).toBeVisible();
    expect(within(dialog).getByText("Used in 22 projects")).toBeVisible();
    expect(
      within(dialog).getByRole("link", {
        name: "Open the Members page of Alpha",
      }),
    ).toHaveAttribute("href", "/dashboard/settings/projects/p-1/members");
    expect(within(dialog).getByText("and 20 more projects")).toBeVisible();
    expect(mocks.openPending).not.toHaveBeenCalled();
  });

  it("explains revoked grants and built-in refusals in plain words", async () => {
    mocks.remove.mockRejectedValueOnce(
      new RoleApiError(409, "x", "role_has_revoked_grants", {
        revokedGrantCount: 2,
      }),
    );
    setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Service desk" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Kept for history")).toBeVisible();
    expect(
      within(dialog).getByText(/2 past assignments from removed members/),
    ).toBeVisible();
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Close" })[0],
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    mocks.remove.mockRejectedValueOnce(
      new RoleApiError(400, "x", "role_not_deletable", {}),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Service desk" }),
    );
    expect(await screen.findByText("Built-in roles stay")).toBeVisible();
  });
});
