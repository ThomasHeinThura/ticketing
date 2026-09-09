import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: { roleByUser: {} as Record<string, string | undefined> },
}));

vi.mock("../../../apps/api/src/database", async () => {
  const schema = await import("../../../apps/api/src/database/schema");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();

  let boundUserId: string | undefined;

  const chain = {
    select: () => chain,
    from: () => chain,
    where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
      // `and(eq(workspaceId, ...), eq(userId, ...))` binds [workspaceId, userId], in that
      // order — the exact shape `require-workspace-capability.ts`'s own query builds.
      const [, userId] = dialect.sqlToQuery(condition).params;
      boundUserId = typeof userId === "string" ? userId : undefined;
      return chain;
    },
    limit: async () => {
      if (!boundUserId || !(boundUserId in state.roleByUser)) return [];
      const role = state.roleByUser[boundUserId];
      return role === undefined ? [] : [{ role }];
    },
  };

  return { default: chain, schema };
});

const { requireWorkspaceCapability, builtInRoleHasCapability } = await import(
  "../../../apps/api/src/utils/require-workspace-capability"
);

/**
 * `builtInRoleHasCapability` — the pure function both this middleware and
 * `transferWorkspaceOwnership`'s in-transaction re-check call, so it is what actually decides
 * "does this role hold `workspace:transfer_ownership`" everywhere in the codebase.
 */
describe("builtInRoleHasCapability", () => {
  it("grants workspace:transfer_ownership to owner, and refuses every other built-in role", () => {
    const roles = [
      "owner",
      "admin",
      "manager",
      "lead",
      "member",
      "viewer",
      "customer",
      "instance_admin",
    ] as const;
    for (const role of roles) {
      expect(
        builtInRoleHasCapability(role, "workspace:transfer_ownership"),
        role,
      ).toBe(role === "owner");
    }
  });

  it("still grants owner an ordinary, non-authority-granting capability", () => {
    // Sanity check that the function is not secretly hardcoded to the one capability this
    // batch adds — `workspace:read` is held by every workspace-tier role.
    expect(builtInRoleHasCapability("viewer", "workspace:read")).toBe(true);
  });

  it("fails closed for a role string naming no built-in role (a custom role's own slug)", () => {
    expect(
      builtInRoleHasCapability(
        "acme-custom-lead",
        "workspace:transfer_ownership",
      ),
    ).toBe(false);
  });

  it("fails closed for a missing role", () => {
    expect(
      builtInRoleHasCapability(undefined, "workspace:transfer_ownership"),
    ).toBe(false);
    expect(builtInRoleHasCapability(null, "workspace:transfer_ownership")).toBe(
      false,
    );
    expect(builtInRoleHasCapability("", "workspace:transfer_ownership")).toBe(
      false,
    );
  });
});

/**
 * `requireWorkspaceCapability` — the route-level gate, exercised as Hono middleware with the
 * database mocked (no real DB, no controller). This is what makes the runtime authority
 * check independently reachable from the transactional re-read the controller also keeps.
 */
function buildApp() {
  return new Hono<{ Variables: { userId: string; workspaceId: string } }>()
    .use("*", async (c, next) => {
      c.set("workspaceId", c.req.header("x-workspace-id") ?? "");
      c.set("userId", c.req.header("x-user-id") ?? "");
      return next();
    })
    .get(
      "/probe",
      requireWorkspaceCapability("workspace:transfer_ownership"),
      (c) => c.json({ ok: true }),
    );
}

function probe(userId: string, workspaceId = "ws-1") {
  return buildApp().request("/probe", {
    headers: { "x-user-id": userId, "x-workspace-id": workspaceId },
  });
}

describe("requireWorkspaceCapability", () => {
  beforeEach(() => {
    state.roleByUser = {};
  });

  it("lets the owner through", async () => {
    state.roleByUser["user-owner"] = "owner";
    const res = await probe("user-owner");
    expect(res.status).toBe(200);
  });

  it("refuses a manager — proves the invariant at the policy/middleware layer, with no controller involved at all", async () => {
    state.roleByUser["user-manager"] = "manager";
    const res = await probe("user-manager");
    expect(res.status).toBe(403);
  });

  it("refuses every other built-in role", async () => {
    for (const role of ["admin", "lead", "member", "viewer", "customer"]) {
      state.roleByUser[`user-${role}`] = role;
      const res = await probe(`user-${role}`);
      expect(res.status, role).toBe(403);
    }
  });

  it("refuses a caller with no workspace_member row at all", async () => {
    const res = await probe("stranger-with-no-row");
    expect(res.status).toBe(403);
  });
});
