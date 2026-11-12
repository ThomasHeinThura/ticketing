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
import { toast } from "@/lib/toast";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  move: vi.fn(),
  remove: vi.fn(),
  pending: vi.fn(),
  holders: [] as unknown[],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) => {
      if (typeof options.count === "number") {
        try {
          return translate(
            `${key}_${options.count === 1 ? "one" : "other"}`,
            options,
          );
        } catch {
          /* non-plural key */
        }
      }
      return translate(key, options);
    },
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/fetchers/workspace-roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/workspace-roles")>()),
  reassignRole: (...args: unknown[]) => mocks.move(...args),
  requestRoleDeletion: (...args: unknown[]) => mocks.remove(...args),
}));
vi.mock("@/hooks/queries/workspace-roles/use-role-queries", () => ({
  roleDetailKey: () => ["role"],
  roleHoldersKey: () => ["holders"],
  useRoleHolders: () => ({
    data: { holders: mocks.holders },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  workspaceRolesKey: () => ["roles"],
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.pending,
}));

import { RoleApiError } from "@/fetchers/workspace-roles";
import { RolePeoplePanel } from "./role-people-panel";

const role: WorkspaceRoleDetail = {
  id: "role",
  workspaceId: "ws",
  role: "support",
  name: "Support",
  description: null,
  rank: 20,
  capabilities: [],
  isSystem: false,
  isEditable: true,
  holderCount: 1,
  version: "1",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const target = { ...role, id: "target", role: "staff", name: "Staff" };
function setup(current = role) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RolePeoplePanel
        workspaceId="ws"
        role={current}
        roles={[current, target]}
        callerRank={100}
        canManageMembers
        canManageRoles
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  mocks.move.mockReset();
  mocks.remove.mockReset();
  mocks.pending.mockReset();
  mocks.holders = [
    {
      userId: "user",
      personId: null,
      name: "Alex",
      email: "alex@example.test",
      image: null,
      active: true,
      suspended: false,
      joinedAt: "2026-01-01",
    },
  ];
});
afterEach(cleanup);

describe("role people errors", () => {
  it("translates a reassignment failure and retains the structured refusal code", async () => {
    mocks.move.mockRejectedValue(
      new RoleApiError(403, "raw server refusal", "rank_guard", null),
    );
    setup();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Staff" }));
    fireEvent.click(screen.getByRole("button", { name: "Move everyone" }));
    fireEvent.click(screen.getByRole("button", { name: "Move people" }));
    expect(
      await screen.findByText(translate("roles:people.moveFailed")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(translate("roles:errors.rank_guard")),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw server refusal")).not.toBeInTheDocument();
  });

  it("shows a translated reassignment error for a non-HTTP failure", async () => {
    mocks.move.mockRejectedValue(new Error("raw network error"));
    setup();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Staff" }));
    fireEvent.click(screen.getByRole("button", { name: "Move everyone" }));
    fireEvent.click(screen.getByRole("button", { name: "Move people" }));
    expect(
      await screen.findByText(translate("roles:people.moveFailed")),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw network error")).not.toBeInTheDocument();
  });

  it("shows the translated deletion failure without opening a pending action", async () => {
    mocks.holders = [];
    mocks.remove.mockRejectedValue(new Error("raw server refusal"));
    setup({ ...role, holderCount: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Delete role" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        translate("roles:delete.failed"),
      ),
    );
    expect(mocks.pending).not.toHaveBeenCalled();
  });
});
