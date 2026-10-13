import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  type AuthenticatedApiKey,
  resolveRequestIdentity,
} from "../../apps/api/src/permissions/resolve-request-identity";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

function key(
  userId: string,
  overrides: Partial<AuthenticatedApiKey> = {},
): AuthenticatedApiKey {
  return {
    id: "key-1",
    userId,
    enabled: true,
    permissions: { project: ["read"] },
    ...overrides,
  };
}

describe("resolveRequestIdentity", () => {
  it("builds a session identity with no key capability subset", async () => {
    const { user } = await createWorkspaceMember({ role: "admin" });
    const identity = await resolveRequestIdentity({ userId: user.id });
    expect(identity?.credential).toBe("session");
    expect(identity?.keyCapabilities).toBeUndefined();
  });

  it("builds an impersonation identity from the session's impersonatedBy", async () => {
    const { user } = await createWorkspaceMember({ role: "admin" });
    const identity = await resolveRequestIdentity({
      userId: user.id,
      impersonatedBy: "acting-admin",
    });
    expect(identity?.credential).toBe("impersonation");
    expect(identity?.keyCapabilities).toBeUndefined();
  });

  it("projects only registered resource/action pairs from the stored key scope", async () => {
    const { user } = await createWorkspaceMember({ role: "admin" });
    const identity = await resolveRequestIdentity({
      userId: user.id,
      apiKey: key(user.id, {
        permissions: {
          project: ["read"],
          bogus: ["x"],
          work_item: ["not_an_action"],
        },
      }),
    });
    expect(identity?.credential).toBe("api_key");
    expect(identity?.keyCapabilities).toEqual(["project:read"]);
  });

  it.each([
    ["unscoped (null)", null],
    ["malformed", { project: "read" as never }],
    ["empty", {}],
  ])(
    "gives a %s key an empty subset, never the owner's RBAC",
    async (_label, permissions) => {
      const { user } = await createWorkspaceMember({ role: "owner" });
      const identity = await resolveRequestIdentity({
        userId: user.id,
        apiKey: key(user.id, { permissions }),
      });
      expect(identity?.credential).toBe("api_key");
      expect(identity?.keyCapabilities).toEqual([]);
    },
  );

  it("lets the key win over impersonation while keeping the subset", async () => {
    const { user } = await createWorkspaceMember({ role: "admin" });
    const identity = await resolveRequestIdentity({
      userId: user.id,
      apiKey: key(user.id),
      impersonatedBy: "acting-admin",
    });
    expect(identity?.credential).toBe("api_key");
    expect(identity?.keyCapabilities).toEqual(["project:read"]);
  });

  it("refuses a disabled key, a key owned by another user and an inactive owner", async () => {
    const { user } = await createWorkspaceMember({ role: "admin" });
    expect(
      await resolveRequestIdentity({
        userId: user.id,
        apiKey: key(user.id, { enabled: false }),
      }),
    ).toBeNull();
    expect(
      await resolveRequestIdentity({
        userId: user.id,
        apiKey: key("someone-else"),
      }),
    ).toBeNull();
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, user.id));
    expect(
      await resolveRequestIdentity({ userId: user.id, apiKey: key(user.id) }),
    ).toBeNull();
    expect(await resolveRequestIdentity({ userId: user.id })).toBeNull();
  });
});
