import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../apps/api/src/database/executor";
import { assertMayAssignRole } from "../../../apps/api/src/workspace/role-assignment-guard";

const { resolveRole, findRole } = vi.hoisted(() => ({
  resolveRole: vi.fn(),
  findRole: vi.fn(),
}));
vi.mock("../../../apps/api/src/utils/workspace-member-roles", () => ({
  resolveMembershipRole: resolveRole,
}));
vi.mock(
  "../../../apps/api/src/permissions/workspace-role-authority.repository",
  () => ({
    findWorkspaceRoleByKey: findRole,
    expandedRoleCapabilities: (values: string[]) => new Set(values),
  }),
);
const executor = {} as Executor;
beforeEach(() => {
  resolveRole.mockResolvedValue({ ok: true, role: "lead" });
  findRole.mockImplementation(async (_db, _workspace, key: string) => ({
    rank: key === "admin" ? 80 : 50,
    capabilities: [],
  }));
});
describe("invitation role rank", () => {
  it("refuses a lead granting admin", async () => {
    await expect(
      assertMayAssignRole(executor, {
        workspaceId: "ws",
        actorUserId: "lead",
        targetRoleKey: "admin",
      }),
    ).rejects.toThrow("above your own");
  });
});
