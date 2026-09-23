import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roleGrantsOwner } from "../../../apps/api/src/utils/workspace-member-roles";
import { CallerNotOwnerError } from "../../../apps/api/src/workspace/controllers/workspace-membership-errors";

const { state } = vi.hoisted(() => ({
  state: {
    roleByUser: {} as Record<string, string | undefined>,
    // Issue #318 (security): `"workspaceId\u0000role"` -> `is_system`. Read by
    // `isGenuineBuiltInRoleAssignment`'s `workspace_role` query. Absent from this map
    // means "no row" (not genuine), exactly like a real, empty query result.
    systemRoleByWorkspaceRole: {} as Record<string, boolean>,
  },
}));

vi.mock("../../../apps/api/src/database", async () => {
  const schema = await import("../../../apps/api/src/database/schema");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();

  let boundUserId: string | undefined;
  let boundWorkspaceRoleKey: string | undefined;
  // Which table the in-flight `.from(...)` call named -- `where()`'s params mean something
  // different for `workspace_member` (issue #318 note preserved below) than for
  // `workspace_role` (`[workspaceId, role]`, no `userId` at all).
  let boundTable: "member" | "role" | undefined;

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

  // Issue #318 (security): the `workspace_role` twin of `rowsForBoundUser`, for
  // `isGenuineBuiltInRoleAssignment`'s `.select({ isSystem }).from(workspaceRoleTable)
  // .where(and(eq(workspaceId,...), eq(role,...))).limit(1)`.
  async function rowsForBoundWorkspaceRole() {
    if (
      !boundWorkspaceRoleKey ||
      !(boundWorkspaceRoleKey in state.systemRoleByWorkspaceRole)
    ) {
      return [];
    }
    return [
      { isSystem: state.systemRoleByWorkspaceRole[boundWorkspaceRoleKey] },
    ];
  }

  const chain = {
    select: () => chain,
    from: (table: unknown) => {
      boundTable = table === schema.workspaceRoleTable ? "role" : "member";
      return chain;
    },
    where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const params = dialect.sqlToQuery(condition).params;
      if (boundTable === "role") {
        // `and(eq(workspaceId, ...), eq(role, ...))` — both params identify the row.
        const [workspaceId, role] = params;
        boundWorkspaceRoleKey =
          typeof workspaceId === "string" && typeof role === "string"
            ? `${workspaceId}\u0000${role}`
            : undefined;
      } else {
        // `and(eq(workspaceId, ...), eq(userId, ...))` binds [workspaceId, userId], in
        // that order — the exact shape `workspaceMemberRoles`'s own query builds.
        const [, userId] = params;
        boundUserId = typeof userId === "string" ? userId : undefined;
      }
      return chain;
    },
    limit: () => chain,
    // This mock stands in for Drizzle's own query builder, which is itself thenable --
    // awaiting `.select()...where()` directly, with no terminal `.limit()`/`.execute()` call,
    // is exactly what real Drizzle supports and what `workspaceMemberRoles` relies on.
    // The two query shapes this mock stands in for return differently-shaped rows, so
    // `onFulfilled` is left untyped rather than fighting Drizzle's own overloaded
    // `.then()` signature for no safety benefit in a test-only mock.
    // biome-ignore lint/suspicious/noThenProperty: intentionally thenable, matching Drizzle
    then: (
      // biome-ignore lint/suspicious/noExplicitAny: see comment above `then:`
      onFulfilled: (rows: any) => unknown,
      onRejected?: (error: unknown) => unknown,
    ) =>
      (boundTable === "role"
        ? rowsForBoundWorkspaceRole()
        : rowsForBoundUser()
      ).then(onFulfilled, onRejected),
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
  beforeEach(() => {
    state.roleByUser = {};
    state.systemRoleByWorkspaceRole = {};
  });

  it("grants workspace:transfer_ownership to owner, and refuses every other built-in role", async () => {
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
      // None of these reach the issue #318 genuine-row DB check: `owner` short-circuits to
      // `true` without querying, and no OTHER built-in holds `workspace:transfer_ownership`
      // at all, so the capability check itself returns `false` first. No `workspace_role`
      // fixture is needed for this test to be meaningful.
      expect(
        await builtInRoleHasCapability(
          "ws-1",
          role,
          "workspace:transfer_ownership",
        ),
        role,
      ).toBe(role === "owner");
    }
  });

  it("still grants owner an ordinary, non-authority-granting capability", async () => {
    // Sanity check that the function is not secretly hardcoded to the one capability this
    // batch adds — `workspace:read` is held by every workspace-tier role.
    expect(
      await builtInRoleHasCapability("ws-1", "owner", "workspace:read"),
    ).toBe(true);
  });

  it("fails closed for a role string naming no built-in role (a custom role's own slug)", async () => {
    expect(
      await builtInRoleHasCapability(
        "ws-1",
        "acme-custom-lead",
        "workspace:transfer_ownership",
      ),
    ).toBe(false);
  });

  it("fails closed for a missing role", async () => {
    expect(
      await builtInRoleHasCapability(
        "ws-1",
        undefined,
        "workspace:transfer_ownership",
      ),
    ).toBe(false);
    expect(
      await builtInRoleHasCapability(
        "ws-1",
        null,
        "workspace:transfer_ownership",
      ),
    ).toBe(false);
    expect(
      await builtInRoleHasCapability(
        "ws-1",
        "",
        "workspace:transfer_ownership",
      ),
    ).toBe(false);
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
  it("fails closed, without throwing, for role strings that only match Object.prototype members", async () => {
    for (const role of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "isPrototypeOf",
    ]) {
      await expect(
        builtInRoleHasCapability("ws-1", role, "workspace:transfer_ownership"),
      ).resolves.not.toThrow();
      expect(
        await builtInRoleHasCapability(
          "ws-1",
          role,
          "workspace:transfer_ownership",
        ),
        role,
      ).toBe(false);
    }
  });
});

/**
 * Issue #318 (security), Opus review of PR #315 finding S2 — the genuine-row check itself
 * (`isGenuineBuiltInRoleAssignment`, private to `require-workspace-capability.ts`, exercised
 * here through `builtInRoleHasCapability` since it is the only exported surface). Every case
 * uses `workspace:read` against `owner`/`admin`/`manager`/`lead`/`member`/`viewer` — the six
 * workspace-tier roles that hold it (`instance_admin` and `customer` do not, rbac.md § Built-in
 * roles) — so a `false` result can only come from the genuine-row check, never from the
 * capability implication.
 */
describe("builtInRoleHasCapability — issue #318, the genuine-row check", () => {
  beforeEach(() => {
    state.roleByUser = {};
    state.systemRoleByWorkspaceRole = {};
  });

  it("'owner' is genuine with no workspace_role row at all -- it is never checked against one", async () => {
    // No entry in `state.systemRoleByWorkspaceRole` at all -- if the implementation ever
    // queried the DB for "owner", this would come back "no row" and (wrongly) deny.
    expect(
      await builtInRoleHasCapability("ws-1", "owner", "workspace:read"),
    ).toBe(true);
  });

  it("a non-owner built-in role is denied when no workspace_role row exists for it", async () => {
    expect(
      await builtInRoleHasCapability("ws-1", "manager", "workspace:read"),
    ).toBe(false);
  });

  it("a non-owner built-in role is denied when a workspace_role row exists but is_system is false -- a CUSTOM row that merely shares the name (the escalation this issue closes)", async () => {
    state.systemRoleByWorkspaceRole["ws-1\u0000manager"] = false;
    expect(
      await builtInRoleHasCapability("ws-1", "manager", "workspace:read"),
    ).toBe(false);
  });

  it("a non-owner built-in role is granted when a GENUINE (is_system = true) workspace_role row exists", async () => {
    state.systemRoleByWorkspaceRole["ws-1\u0000manager"] = true;
    expect(
      await builtInRoleHasCapability("ws-1", "manager", "workspace:read"),
    ).toBe(true);
  });

  it("a genuine row in a DIFFERENT workspace does not leak authority into this one", async () => {
    state.systemRoleByWorkspaceRole["ws-OTHER\u0000manager"] = true;
    expect(
      await builtInRoleHasCapability("ws-1", "manager", "workspace:read"),
    ).toBe(false);
  });

  it("every non-owner built-in role independently requires its own genuine row", async () => {
    const nonOwnerRoles = [
      "admin",
      "manager",
      "lead",
      "member",
      "viewer",
    ] as const;
    for (const role of nonOwnerRoles) {
      expect(
        await builtInRoleHasCapability("ws-1", role, "workspace:read"),
        `${role} without a row`,
      ).toBe(false);
      state.systemRoleByWorkspaceRole[`ws-1\u0000${role}`] = true;
      expect(
        await builtInRoleHasCapability("ws-1", role, "workspace:read"),
        `${role} with a genuine row`,
      ).toBe(true);
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
  it("L1 the gate's refusal message differs from the transfer controller's, which is what R4 relies on", async () => {
    const gateMessage = "Insufficient permissions";
    const controllerMessage = new CallerNotOwnerError().message;

    expect(controllerMessage).not.toBe(gateMessage);
    // And the gate really does emit that literal — asserted behaviourally,
    // through the real middleware (`probe()`'s 403 response body), not pinned
    // to the source text of `require-workspace-capability.ts`, which any
    // behaviour-preserving refactor (hoisting the string to a shared constant,
    // extracting a `forbidden()` helper) used to turn red while the behaviour
    // was fine. If this drifts, R4's assertion is distinguishing two bodies
    // that no longer differ, or asserting a string nothing produces.
    state.roleByUser["user-manager"] = "manager";
    const res = await probe("user-manager");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe(gateMessage);
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
