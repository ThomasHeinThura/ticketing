import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ commits: 0, rollbacks: 0 }));
vi.mock("../../apps/api/src/database", async (original) => {
  const actual = await original<typeof import("../../apps/api/src/database")>();
  return {
    ...actual,
    default: {
      transaction: async (callback: (tx: object) => Promise<unknown>) => {
        try {
          const value = await callback({});
          fixtures.commits += 1;
          return value;
        } catch (error) {
          fixtures.rollbacks += 1;
          throw error;
        }
      },
    },
  };
});
vi.mock("../../apps/api/src/pending-action/lifecycle-invalidation", () => ({
  lockPendingActionLifecycle: vi.fn(async () => {}),
  reportPendingActionAuditFailures: vi.fn(async () => {}),
}));

import {
  getPasswordSessionSource,
  setPasswordSessionSource,
  withExplicitCredentialMutation,
} from "../../apps/api/src/pending-action/credential-invalidation";

const source = {
  id: "old",
  userId: "caller",
  portal: "agent" as const,
  identityConnectionId: "oidc",
  activeOrganizationId: "workspace",
  activeTeamId: null,
};
beforeEach(() => {
  fixtures.commits = 0;
  fixtures.rollbacks = 0;
});
describe("password change transaction context", () => {
  it("holds the server-owned source only within the rotation and commits success", async () => {
    expect(getPasswordSessionSource()).toBeUndefined();
    const outcome = await withExplicitCredentialMutation(
      { kind: "session", route: "/change-password" },
      async () => {
        setPasswordSessionSource(source);
        expect(getPasswordSessionSource()).toEqual(source);
        return new Response(null, { status: 200 });
      },
    );
    expect(outcome.result.status).toBe(200);
    expect(getPasswordSessionSource()).toBeUndefined();
    expect(fixtures.commits).toBe(1);
  });
  it("rolls back and returns a refused response without retaining provenance", async () => {
    const outcome = await withExplicitCredentialMutation(
      { kind: "session", route: "/change-password" },
      async () => {
        setPasswordSessionSource(source);
        return new Response(null, { status: 403 });
      },
    );
    expect(outcome.result.status).toBe(403);
    expect(fixtures.rollbacks).toBe(1);
    expect(fixtures.commits).toBe(0);
    expect(getPasswordSessionSource()).toBeUndefined();
  });
  it("rolls back when replacement binding throws", async () => {
    await expect(
      withExplicitCredentialMutation(
        { kind: "session", route: "/change-password" },
        async () => {
          setPasswordSessionSource(source);
          throw new Error("binding failed");
        },
      ),
    ).rejects.toThrow("binding failed");
    expect(fixtures.rollbacks).toBe(1);
    expect(fixtures.commits).toBe(0);
    expect(getPasswordSessionSource()).toBeUndefined();
  });
  it("cannot set replacement provenance outside an admitted rotation", () => {
    expect(() => setPasswordSessionSource(source)).toThrow();
  });
});
