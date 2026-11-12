import { describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
  setting: [] as Array<{ policy: unknown; setupCompletedAt: Date | null }>,
}));

vi.mock("../../../apps/api/src/auth/repository", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../apps/api/src/auth/repository")
  >()),
  getActiveLocalFactorIdentity: async () => [
    { id: "person-1", side: "staff", active: true, enabled: false },
  ],
  getLocalFactorMembershipRoles: async () => [],
  getLocalFactorPolicySetting: async () => rows.setting,
}));

import { loadLocalFactorState } from "../../../apps/api/src/auth/local-factor-service";

// The staff API guard trusts `setupCompleted` instead of querying the marker itself, so the
// mapping from the persisted column has to be exact. Unit-level; no database.
const policy = { mode: "off", requiredRoleId: null };

describe("loadLocalFactorState setup marker", () => {
  it("reports an unset marker as setup not completed, whatever the factor policy says", async () => {
    rows.setting = [{ policy, setupCompletedAt: null }];
    await expect(loadLocalFactorState("user-1")).resolves.toMatchObject({
      setupCompleted: false,
      required: false,
    });
  });

  it("reports a set marker as setup completed", async () => {
    rows.setting = [{ policy, setupCompletedAt: new Date() }];
    await expect(loadLocalFactorState("user-1")).resolves.toMatchObject({
      setupCompleted: true,
    });
  });

  it("fails when the instance setting row is missing rather than reading it as completed", async () => {
    rows.setting = [];
    await expect(loadLocalFactorState("user-1")).rejects.toThrow(
      "Instance factor policy is unavailable",
    );
  });
});
