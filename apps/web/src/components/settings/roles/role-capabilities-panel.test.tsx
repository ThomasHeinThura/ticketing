import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceRoleDetail } from "@/fetchers/workspace-roles";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({ update: vi.fn(), prove: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (rawKey: string, options: Record<string, unknown> = {}) => {
      // A hook bound to a namespace (`useTranslation("identityConnections")`) resolves bare keys in it.
      const key =
        namespace && !rawKey.includes(":") ? `${namespace}:${rawKey}` : rawKey;
      if (typeof options.count === "number") {
        const plural = `${key}_${options.count === 1 ? "one" : "other"}`;
        try {
          return translate(plural, options);
        } catch {
          // fall through to the singular key
        }
      }
      return translate(key, options);
    },
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Saving a role is elevated: the real verification endpoints are replaced by one token.
vi.mock("@/fetchers/god-mode/identity-step-up", () => ({
  proveIdentityOperation: (...args: unknown[]) => mocks.prove(...args),
}));
vi.mock("@/fetchers/god-mode/instance-users", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fetchers/god-mode/instance-users")>();
  return {
    ...actual,
    getCurrentFactorStatus: async () => ({
      enabled: false,
      required: false,
      availableMethods: ["password"],
    }),
  };
});
vi.mock("@/fetchers/workspace-roles", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fetchers/workspace-roles")>();
  return {
    ...actual,
    updateRole: (...args: unknown[]) => mocks.update(...args),
  };
});

import {
  RoleCapabilitiesPanel,
  type RoleEditAuthority,
} from "./role-capabilities-panel";
import { useRoleDraft } from "./role-draft";

const role = (
  over: Partial<WorkspaceRoleDetail> = {},
): WorkspaceRoleDetail => ({
  id: "role-1",
  workspaceId: "ws-1",
  role: "support-lead",
  name: "Support Lead",
  description: "Triages",
  rank: 30,
  capabilities: ["work_item:read"],
  isSystem: false,
  isEditable: true,
  holderCount: 3,
  version: "100",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const authority = (
  over: Partial<RoleEditAuthority> = {},
): RoleEditAuthority => ({
  roleKey: "owner",
  rank: 100,
  held: new Set([
    "work_item:read",
    "work_item:update",
    "work_item:assign",
    "label:manage",
  ]),
  canManageRoles: true,
  ...over,
});

function Harness({
  current,
  who,
}: {
  current: WorkspaceRoleDetail;
  who: RoleEditAuthority;
}) {
  const state = useRoleDraft(current);
  return (
    <RoleCapabilitiesPanel
      workspaceId="ws-1"
      role={current}
      authority={who}
      state={state}
      onReload={vi.fn()}
    />
  );
}

function renderPanel(current = role(), who = authority()) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness current={current} who={who} />
    </QueryClientProvider>,
  );
}

const box = (name: string) => screen.getByRole("checkbox", { name });
// Base UI's checkbox is a `role=checkbox` span: its disabled state is `aria-disabled`.
const isDisabled = (element: HTMLElement) =>
  element.getAttribute("aria-disabled") === "true";

beforeEach(() => {
  mocks.update.mockReset().mockImplementation((...args: unknown[]) =>
    (args[4] as { dryRun?: boolean } | undefined)?.dryRun
      ? Promise.resolve({
          affected: { people: 3, workItems: 12, projects: 2 },
        })
      : Promise.resolve(role()),
  );
  mocks.prove.mockReset().mockResolvedValue("step-up-token");
});
afterEach(cleanup);

describe("RoleCapabilitiesPanel", () => {
  it("shows the stored capabilities ticked, each with its plain-English line (RL-1, RL-2)", () => {
    renderPanel();
    expect(box("Work item: read")).toBeChecked();
    expect(box("Work item: update")).not.toBeChecked();
    expect(
      screen.getAllByText("See work items in reach").length,
    ).toBeGreaterThan(0);
  });

  it("RL-3: disables a capability the caller does not hold, with the reason", () => {
    renderPanel();
    // The caller holds `work_item:update` but not `work_item:delete`.
    expect(isDisabled(box("Work item: update"))).toBe(false);
    expect(isDisabled(box("Work item: delete"))).toBe(true);
    expect(
      screen.getAllByText(/You do not hold this capability yourself/).length,
    ).toBeGreaterThan(0);
  });

  it("RL-5: ticking one capability ticks what it implies, says so, and locks the implied one", () => {
    renderPanel(role({ capabilities: [] }));
    fireEvent.click(box("Work item: update"));
    expect(box("Work item: update")).toBeChecked();
    expect(box("Work item: read")).toBeChecked();
    expect(screen.getByText(/Also added: Work item: read/)).toBeInTheDocument();
    // `read` is now needed by `update`, so it cannot be unticked on its own.
    expect(isDisabled(box("Work item: read"))).toBe(true);
    expect(
      screen.getByText(/Needed by Work item: update\. Remove that first\./),
    ).toBeInTheDocument();
    fireEvent.click(box("Work item: update"));
    expect(box("Work item: update")).not.toBeChecked();
  });

  it("is read-only, with the reason and no save bar, when the role is not editable by this caller", () => {
    renderPanel(role(), authority({ canManageRoles: false }));
    expect(screen.getByText("This role is read-only")).toBeInTheDocument();
    expect(isDisabled(box("Work item: read"))).toBe(true);
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
  });

  it("RL-4: a role ranked at or above the caller's own is read-only, except the role they hold", () => {
    const { unmount } = renderPanel(
      role({ rank: 80 }),
      authority({ roleKey: "admin", rank: 80 }),
    );
    expect(screen.getByText("This role is read-only")).toBeInTheDocument();
    unmount();
    renderPanel(
      role({ rank: 80, role: "admin" }),
      authority({ roleKey: "admin", rank: 80 }),
    );
    expect(
      screen.queryByText("This role is read-only"),
    ).not.toBeInTheDocument();
  });

  it("RL-9/ST-7: previews current impact before confirming, then sends the loaded version", async () => {
    renderPanel(role({ capabilities: ["work_item:read"], holderCount: 3 }));
    fireEvent.click(box("Work item: update"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(
        "Potential impact — people: 3; projects: 2; work items: 12.",
      ),
    ).toBeInTheDocument();
    expect(mocks.update).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      "role-1",
      expect.objectContaining({ expectedVersion: "100" }),
      undefined,
      { dryRun: true },
    );
    // The save is elevated: it cannot be applied until a fresh verification is entered.
    const apply = screen.getByRole("button", { name: "Save and apply now" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update).toHaveBeenCalledWith(
      "ws-1",
      "role-1",
      expect.objectContaining({
        capabilities: ["work_item:read", "work_item:update"],
        expectedVersion: "100",
        name: "Support Lead",
        rank: 30,
      }),
      "step-up-token",
    );
    // The proof is bound to the same change, never to a looser one.
    expect(mocks.prove).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "workspace_role_update",
        workspaceId: "ws-1",
        roleId: "role-1",
        capabilities: ["work_item:read", "work_item:update"],
        expectedVersion: "100",
      }),
      { method: "password", secret: "correct horse" },
    );
  });

  it("keeps the role unchanged and says so when the fresh verification fails", async () => {
    mocks.prove.mockRejectedValue(new Error("refused"));
    renderPanel(role({ capabilities: ["work_item:read"] }));
    fireEvent.click(box("Work item: update"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply now" }));
    expect(
      await screen.findAllByText(
        "Fresh verification failed. Nothing was changed.",
      ),
    ).not.toHaveLength(0);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]?.[4]).toEqual({ dryRun: true });
  });

  it("asks for a typed confirmation before removing capabilities from your own role", async () => {
    renderPanel(
      role({ role: "ops", name: "Ops", capabilities: ["work_item:update"] }),
      authority({ roleKey: "ops", rank: 60 }),
    );
    fireEvent.click(box("Work item: update"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("You are editing your own role"),
    ).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Save and apply now" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type Ops to confirm"), {
      target: { value: "Ops" },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1]?.[2]).toMatchObject({
      confirmSelfEdit: true,
    });
  });

  it("a built-in role keeps its name and rank fixed", () => {
    renderPanel(
      role({ isSystem: true, role: "manager", name: "Manager", rank: 60 }),
    );
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Rank")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeEnabled();
  });
});
