import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roleGrantsOwner } from "../../../apps/api/src/utils/workspace-member-roles";
import { CallerNotOwnerError } from "../../../apps/api/src/workspace/controllers/workspace-membership-errors";

const { state } = vi.hoisted(() => ({
  state: { roleByUser: {} as Record<string, string | undefined> },
}));

vi.mock("../../../apps/api/src/database", async () => {
  const schema = await import("../../../apps/api/src/database/schema");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();

  let boundUserId: string | undefined;

  // `require-workspace-capability.ts` now reads every row for the pair via
  // `workspaceMemberRoles` (`.select().from().where()`, no `.limit()` call
  // -- see that helper's doc comment for why), so the terminal await point
  // is `.then()` on the chain itself, not a `.limit()` call. `limit` is kept
  // as a harmless passthrough in case any other call site still chains it.
  async function rowsForBoundUser() {
    if (!boundUserId || !(boundUserId in state.roleByUser)) return [];
    const role = state.roleByUser[boundUserId];
    return role === undefined ? [] : [{ role }];
  }

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
    limit: () => chain,
    // This mock stands in for Drizzle's own query builder, which is itself thenable --
    // awaiting `.select()...where()` directly, with no terminal `.limit()`/`.execute()` call,
    // is exactly what real Drizzle supports and what `workspaceMemberRoles` relies on.
    // biome-ignore lint/suspicious/noThenProperty: intentionally thenable, matching Drizzle
    then: (
      onFulfilled: (rows: Array<{ role: string }>) => unknown,
      onRejected?: (error: unknown) => unknown,
    ) => rowsForBoundUser().then(onFulfilled, onRejected),
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

  /**
   * `role in BUILT_IN_ROLES` also matches `Object.prototype` members, so a role string of
   * `"constructor"` or `"__proto__"` would pass that check with
   * `BUILT_IN_ROLES[key].capabilities === undefined`, and
   * `expandCapabilities(undefined)` throws `TypeError: stored is not iterable` rather than
   * returning `false`. `role` is not reachable through the API today (no role-create route
   * exists; `workspace_role` rows come only from seeding) -- it becomes reachable once the
   * roles CRUD (#40) ships a role-create route that lets a caller choose a role's `key`.
   */
  it("fails closed, without throwing, for role strings that only match Object.prototype members", () => {
    for (const role of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "isPrototypeOf",
    ]) {
      expect(() =>
        builtInRoleHasCapability(role, "workspace:transfer_ownership"),
      ).not.toThrow();
      expect(
        builtInRoleHasCapability(role, "workspace:transfer_ownership"),
        role,
      ).toBe(false);
    }
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

  /**
   * L1 from the independent Opus delta review of #77.
   *
   * The integration probe R4 distinguishes the capability GATE's refusal from
   * the transfer CONTROLLER's by asserting the gate's message body exactly,
   * because both layers return 403 and only the body differs. That makes R4
   * silently depend on the two messages NOT coinciding — reword
   * `CallerNotOwnerError` to "Insufficient permissions" and R4 goes green again
   * while testing nothing, restoring the exact vacuity it was written to fix.
   *
   * This pins the dependency where it lives, so the reword fails HERE rather
   * than quietly disarming a probe three files away.
   */
  it("L1 the gate's refusal message differs from the transfer controller's, which is what R4 relies on", () => {
    const gateMessage = "Insufficient permissions";
    const controllerMessage = new CallerNotOwnerError().message;

    expect(controllerMessage).not.toBe(gateMessage);
    // And the gate really does use that literal — if this drifts, R4's
    // assertion is asserting a string nothing produces.
    expect(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../apps/api/src/utils/require-workspace-capability.ts",
        ),
        "utf8",
      ),
    ).toContain(`message: "${gateMessage}"`);
  });

  /**
   * L2 from the independent Opus delta review of #77.
   *
   * `roleGrantsOwner` splits on comma and compares whole pieces. A
   * "simplification" to `role.includes("owner")` — a substring test — would
   * pass the entire rest of the suite while silently making every
   * legitimately-named custom role containing those five letters unassignable
   * and un-removable. Nothing pinned that, so this does.
   *
   * The false-positive direction matters as much as the false-negative one: the
   * comma-aware widening exists to REFUSE destructive actions on a corrupt
   * owner value, and refusing them on `"co-owner"` instead would be a
   * regression wearing a security fix's clothes.
   */
  it("L2 roleGrantsOwner matches a comma-separated PIECE, never a substring", () => {
    const grants = [
      "owner",
      "owner,admin",
      "admin,owner",
      "OWNER",
      " owner ",
      "owner, admin",
      "owner,owner",
    ];
    const allowed = [
      "co-owner",
      "ownership-admin",
      "downer",
      "co-owner,viewer",
      "viewer",
      "",
      "   ",
    ];

    for (const role of grants) {
      expect(
        roleGrantsOwner(role),
        `${JSON.stringify(role)} must GRANT owner`,
      ).toBe(true);
    }
    for (const role of allowed) {
      expect(
        roleGrantsOwner(role),
        `${JSON.stringify(role)} must NOT grant owner`,
      ).toBe(false);
    }
  });
});
