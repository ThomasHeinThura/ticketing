/**
 * Integration tests for issue #8 Slice 2's shadow-mode middleware.
 *
 * Four obligations from the brief, each its own describe block:
 *  1. Shadow off (the default) writes nothing — a true no-op.
 *  2. Responses are byte-identical with shadow on and off, for a representative route.
 *  3. A known disagreement — the instance-admin bypass (#315 S8) — is recorded, with shadow
 *     on, as `legacy_allow_policy_deny`.
 *  4. An evaluator exception is caught and logged as `evaluator_error`; the response is
 *     unaffected.
 *
 * `TASKDESK_POLICY_SHADOW` is read once, at module load
 * (`apps/api/src/permissions/shadow-config.ts`), so toggling it between cases needs a fresh
 * import of the whole `apps/api/src/index.ts` module graph — the same `vi.resetModules()` +
 * dynamic `import()` technique `tests/api/boot-policy-registry.test.ts` already uses to prove
 * a production boot failure. Each fresh module graph also carries its own `auth` module
 * instance, so the session mock (`mockAuthenticatedSession` in
 * `tests/api-integration/helpers/auth.ts`) is applied per dynamically-imported instance, not
 * the statically-imported one this file also uses for the "off" baseline.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "../../apps/api/src/database";
import type { createApp } from "../../apps/api/src/index";
import {
  policyShadowEventTable,
  policyShadowTallyTable,
} from "../../apps/api/src/permissions/shadow-schema";
import { seedInternalOrganisationAndStaffPersons } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

/**
 * `resolveIdentity` requires a `person` row (#315 S7 — the real backfill runs once, at
 * boot). `createWorkspaceMember()` only inserts `user`/`workspace_member` rows, so every
 * test below calls this immediately after creating its fixtures, the same way
 * `tests/api-integration/resolve-identity.test.ts` does — otherwise every shadow comparison
 * in this file would itself demonstrate S7's own "unevaluated: missing_identity" case
 * instead of the scenario each test is actually about.
 */
async function backfillPersons(): Promise<void> {
  await seedInternalOrganisationAndStaffPersons();
}

type App = ReturnType<typeof createApp>["app"];
type DbModule = typeof import("../../apps/api/src/database");
type AuthModule = typeof import("../../apps/api/src/auth");

type FreshApp = {
  readonly app: App;
  readonly db: DbModule["default"];
  readonly schema: DbModule["schema"];
  readonly mockUser: (user: { id: string; role?: string | null }) => void;
};

/**
 * A fresh module graph with `TASKDESK_POLICY_SHADOW` set to the given value, plus its own
 * `auth` module instance so the session mock applies to exactly this `app`.
 */
async function createAppWithShadow(value: "on" | "off"): Promise<FreshApp> {
  if (value === "on") {
    process.env.TASKDESK_POLICY_SHADOW = "on";
  } else {
    delete process.env.TASKDESK_POLICY_SHADOW;
  }
  vi.resetModules();
  const indexModule = await import("../../apps/api/src/index");
  const authModule: AuthModule = await import("../../apps/api/src/auth");
  const databaseModule: DbModule = await import("../../apps/api/src/database");

  return {
    app: indexModule.createApp().app,
    db: databaseModule.default,
    schema: databaseModule.schema,
    mockUser: (user) => {
      vi.spyOn(authModule.auth.api, "getSession").mockResolvedValue({
        session: {
          id: `session-${user.id}`,
          token: `token-${user.id}`,
          userId: user.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: null,
          userAgent: null,
        },
        // Mirrors mockAuthenticatedSession's own MockSessionUser widening
        // (tests/api-integration/helpers/auth.ts) — `role` is a plain userTable column, not
        // a better-auth additionalFields entry, so the library's own User type never carries it.
        // biome-ignore lint/suspicious/noExplicitAny: see above
        user: user as any,
      });
    },
  };
}

async function shadowEventsFor(
  routeKey: string,
  outcome: string,
): Promise<(typeof policyShadowEventTable.$inferSelect)[]> {
  return db
    .select()
    .from(policyShadowEventTable)
    .where(
      and(
        eq(policyShadowEventTable.routeKey, routeKey),
        eq(policyShadowEventTable.outcome, outcome as never),
      ),
    );
}

async function shadowTalliesFor(
  routeKey: string,
): Promise<(typeof policyShadowTallyTable.$inferSelect)[]> {
  return db
    .select()
    .from(policyShadowTallyTable)
    .where(eq(policyShadowTallyTable.routeKey, routeKey));
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterEach(async () => {
  // Shadow writes are fire-and-forget (see shadow-middleware.ts) -- deliberately not
  // awaited by the response path. Without this, a write still in flight when the NEXT
  // test's beforeEach truncates can land immediately after, leaking one test's row into
  // the next test's (now-empty) table under its own, unrelated workspace id.
  await new Promise((resolve) => setTimeout(resolve, 300));
  delete process.env.TASKDESK_POLICY_SHADOW;
  vi.resetModules();
  vi.restoreAllMocks();
});

const UPDATE_LABEL_ROUTE_KEY = "PUT /api/label/{id}";
const LIST_PROJECTS_ROUTE_KEY = "GET /api/project";

async function createLabelFixture(
  fresh: FreshApp,
  workspaceId: string,
): Promise<string> {
  const [row] = await fresh.db
    .insert(fresh.schema.labelTable)
    .values({ workspaceId, name: "Bug", color: "#ef4444" })
    .returning();
  if (!row) throw new Error("createLabelFixture: insert returned no row");
  return row.id;
}

describe("shadow mode off (default): true no-op", () => {
  it("writes nothing to either evidence table", {
    timeout: 30_000,
  }, async () => {
    const fresh = await createAppWithShadow("off");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);
    const labelId = await createLabelFixture(fresh, member.workspace.id);

    const response = await fresh.app.request(`/api/label/${labelId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed", color: "#00ff00" }),
    });
    expect(response.status).toBe(200);

    const events = await shadowEventsFor(
      UPDATE_LABEL_ROUTE_KEY,
      "legacy_allow_policy_deny",
    );
    expect(events).toHaveLength(0);
    const tallies = await shadowTalliesFor(UPDATE_LABEL_ROUTE_KEY);
    expect(tallies).toHaveLength(0);
  });
});

describe("byte-identical responses with shadow on and off", () => {
  it("an ordinary member updating their own label gets the same response either way", {
    timeout: 60_000,
  }, async () => {
    // Two independent fixtures (own workspace/member/label each), not one shared between
    // both app instances: `label_workspace_name_unique` would otherwise make the second
    // rename collide with the first inside the same workspace, which is a fixture
    // artefact, not a shadow-mode behaviour difference.
    const offMember = await createWorkspaceMember();
    const onMember = await createWorkspaceMember();
    await backfillPersons();

    const off = await createAppWithShadow("off");
    off.mockUser(offMember.user);
    const offLabelId = await createLabelFixture(off, offMember.workspace.id);
    const offResponse = await off.app.request(`/api/label/${offLabelId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Parity", color: "#00ff00" }),
    });
    const offStatus = offResponse.status;
    const offBody = (await offResponse.json()) as Record<string, unknown>;

    const on = await createAppWithShadow("on");
    on.mockUser(onMember.user);
    const onLabelId = await createLabelFixture(on, onMember.workspace.id);
    const onResponse = await on.app.request(`/api/label/${onLabelId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Parity", color: "#00ff00" }),
    });
    const onStatus = onResponse.status;
    const onBody = (await onResponse.json()) as Record<string, unknown>;

    expect(onStatus).toBe(offStatus);
    // `id`, `workspaceId`, `createdAt`/`updatedAt` genuinely differ — independent
    // fixtures. Every field that actually reflects the request (name, color, taskId) must
    // be byte-identical, and the response shape (same key set) must match exactly.
    expect(Object.keys(onBody).sort()).toEqual(Object.keys(offBody).sort());
    expect(onBody.name).toEqual(offBody.name);
    expect(onBody.color).toEqual(offBody.color);
    expect(onBody.taskId).toEqual(offBody.taskId);
  });
});

describe("request-sourced scope is evaluated with request provenance", () => {
  it("records agreement for a workspace member listing projects", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);

    const response = await fresh.app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const tallies = await shadowTalliesFor(LIST_PROJECTS_ROUTE_KEY);
    expect(tallies.find((row) => row.outcome === "agree")?.count).toBe(1);
    expect(
      tallies.some(
        (row) =>
          row.outcome === "legacy_allow_policy_deny" &&
          row.reasonCode === "scope_source_mismatch",
      ),
    ).toBe(false);
  });
});

describe("a known disagreement: the instance-admin bypass (#315 S8)", () => {
  it("legacy allows (requireWorkspacePermission's isInstanceAdmin bypass), the registry denies (instance:* only) — recorded as legacy_allow_policy_deny", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");

    // A label in a workspace the "instance admin" below is NOT a member of at all —
    // `PUT /api/label/{id}` is gated by `requireWorkspacePermission({ label: ["update"] })`
    // alone (no `requireWorkspaceRoleAuthority` follow-up, unlike `PATCH /api/workspace/
    // {workspaceId}`, which closes this exact bypass for itself — see that route's own
    // policy.ts comment). `isInstanceAdmin()` short-circuits `requireWorkspacePermission`
    // to `true` regardless of membership (apps/api/src/utils/require-workspace-permission.ts).
    const owner = await createWorkspaceMember();
    const labelId = await createLabelFixture(fresh, owner.workspace.id);
    await backfillPersons();

    const instanceAdminUser = {
      id: "user-instance-admin-shadow-test",
      email: "instance-admin-shadow-test@example.com",
      name: "Instance Admin",
      emailVerified: true,
      role: "admin",
    };
    await fresh.db.insert(fresh.schema.userTable).values(instanceAdminUser);
    // The instance admin user is inserted AFTER the first backfill pass above, so it
    // needs its own -- `seedInternalOrganisationAndStaffPersons` is the same idempotent
    // get-or-create the real boot path uses (see createWorkspaceMember's own comment on
    // ensureInternalOrganisation for the identical reasoning).
    await backfillPersons();
    fresh.mockUser(instanceAdminUser);

    const response = await fresh.app.request(`/api/label/${labelId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Hijacked by admin bypass",
        color: "#00ff00",
      }),
    });

    // Legacy path: allowed, via the instance-admin bypass.
    expect(response.status).toBe(200);

    // Shadow write happens after the response, off the request's own promise chain
    // (see shadow-middleware.ts) — give it a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const events = await shadowEventsFor(
      UPDATE_LABEL_ROUTE_KEY,
      "legacy_allow_policy_deny",
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    const event = events.at(-1);
    expect(event?.legacyAllowed).toBe(true);
    expect(event?.legacyStatus).toBe(200);
    expect(event?.policyAllowed).toBe(false);
    expect(event?.workspaceId).toBe(owner.workspace.id);
    expect(event?.identityKind).toBe("session");

    const tallies = await shadowTalliesFor(UPDATE_LABEL_ROUTE_KEY);
    const disagreeTally = tallies.find(
      (row) => row.outcome === "legacy_allow_policy_deny",
    );
    expect(disagreeTally?.count).toBeGreaterThanOrEqual(1);
  });

  it("records a controller-level bulk membership denial after earlier gates allowed", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await fresh.db
      .insert(fresh.schema.taskTable)
      .values({
        projectId: project.id,
        userId: member.user.id,
        title: "Bulk authorization evidence",
        description: "",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();
    if (!task) throw new Error("task fixture insert returned no row");

    const instanceAdmin = {
      id: "user-instance-admin-bulk-shadow-test",
      email: "instance-admin-bulk-shadow-test@example.com",
      name: "Instance Admin",
      emailVerified: true,
      role: "admin",
    };
    await fresh.db.insert(fresh.schema.userTable).values(instanceAdmin);
    await backfillPersons();
    fresh.mockUser(instanceAdmin);

    const response = await fresh.app.request("/api/task/bulk", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskIds: [task.id], operation: "delete" }),
    });
    expect(response.status).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const falseAllowEvents = await shadowEventsFor(
      "PATCH /api/task/bulk",
      "legacy_allow_policy_deny",
    );
    expect(falseAllowEvents).toHaveLength(0);
    const tallies = await shadowTalliesFor("PATCH /api/task/bulk");
    expect(tallies.find((row) => row.outcome === "agree")?.count).toBe(1);
  });
});

describe("an evaluator exception never affects the response", () => {
  it("the request still succeeds, and the shadow record is evaluator_error", {
    timeout: 60_000,
  }, async () => {
    vi.doMock("@taskdesk/permissions", async () => {
      const actual = await vi.importActual<
        typeof import("@taskdesk/permissions")
      >("@taskdesk/permissions");
      return {
        ...actual,
        evaluatePolicy: () => {
          throw new Error("injected failure for the shadow evaluator test");
        },
      };
    });

    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);
    const labelId = await createLabelFixture(fresh, member.workspace.id);

    const response = await fresh.app.request(`/api/label/${labelId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Still fine", color: "#00ff00" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string };
    expect(body.name).toBe("Still fine");

    await new Promise((resolve) => setTimeout(resolve, 300));

    const events = await shadowEventsFor(
      UPDATE_LABEL_ROUTE_KEY,
      "evaluator_error",
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)?.reasonCode).toBe("evaluator_threw");

    vi.doUnmock("@taskdesk/permissions");
  });
});

const LABEL_WORKSPACE_ROUTE_KEY = "GET /api/label/workspace/{workspaceId}";
const WORKSPACE_DETAIL_ROUTE_KEY = "GET /api/workspace/{workspaceId}";
const PROJECT_REORDER_ROUTE_KEY = "PUT /api/project/reorder";
const PROJECT_UPDATE_ROUTE_KEY = "PUT /api/project/{id}";
const INVITATION_PENDING_ROUTE_KEY = "GET /api/invitation/pending";
const INVITATION_BY_ID_ROUTE_KEY = "GET /api/invitation/{id}";
const WS_USER_ROUTE_KEY = "GET /api/ws/user";
const WS_PROJECT_ROUTE_KEY = "GET /api/ws/{projectId}";

describe("#323 Opus S1 — a request-sourced workspace route fully evaluates to agree", () => {
  it("an allowed member on GET /api/label/workspace/{workspaceId} records agree, never legacy_allow_policy_deny", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);

    const response = await fresh.app.request(
      `/api/label/workspace/${member.workspace.id}`,
    );
    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 300));

    // THE S1 BUG, as its inverse: before the fix every allowed request on this route
    // was filed `legacy_allow_policy_deny` (the row/request source mismatch refused
    // the capability comparison). Now it must be a real `agree`…
    const agreeTallies = (
      await shadowTalliesFor(LABEL_WORKSPACE_ROUTE_KEY)
    ).filter((row) => row.outcome === "agree");
    expect(
      agreeTallies.reduce((sum, row) => sum + row.count, 0),
    ).toBeGreaterThanOrEqual(1);
    // …and the false-disagreement bucket must stay empty.
    const disagreeTallies = (
      await shadowTalliesFor(LABEL_WORKSPACE_ROUTE_KEY)
    ).filter((row) => row.outcome === "legacy_allow_policy_deny");
    expect(disagreeTallies).toEqual([]);
  });
});

describe("#324 — denied param workspace scope is checked against a verified row", () => {
  it("records a nonmember's 403 as agree on GET /api/workspace/{workspaceId}", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const owner = await createWorkspaceMember();
    const other = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(other.user);

    const response = await fresh.app.request(
      `/api/workspace/${owner.workspace.id}`,
    );
    expect(response.status).toBe(403);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const tallies = await shadowTalliesFor(WORKSPACE_DETAIL_ROUTE_KEY);
    expect(tallies.some((row) => row.outcome === "agree")).toBe(true);
    expect(
      tallies.some((row) => row.outcome === "legacy_deny_policy_allow"),
    ).toBe(false);
  });
});

describe("#323 Opus S2 — evidence is attributed to the route that actually ran", () => {
  it("PUT /api/project/reorder attributes to ITS OWN key, not to PUT /api/project/{id}", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const owner = await createWorkspaceMember({ role: "owner" });
    await backfillPersons();
    fresh.mockUser(owner.user);
    const fixture = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });

    // `workspaceAccess.fromQuery()` — the workspace id rides the query string, the same
    // shape the registry declares for this route (`scopeSource: "request"`).
    const response = await fresh.app.request(
      `/api/project/reorder?workspaceId=${owner.workspace.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projects: [{ id: fixture.project.id, position: 0 }],
        }),
      },
    );
    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const ownBucket = await shadowTalliesFor(PROJECT_REORDER_ROUTE_KEY);
    expect(ownBucket.length).toBeGreaterThanOrEqual(1);
    // The old `at(-1)` answer put reorder traffic in {id}'s bucket; {id} must be untouched.
    expect(await shadowTalliesFor(PROJECT_UPDATE_ROUTE_KEY)).toEqual([]);
  });

  it("GET /api/invitation/pending attributes to ITS OWN key, not to GET /api/invitation/{id}", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);

    const response = await fresh.app.request("/api/invitation/pending");
    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(
      (await shadowTalliesFor(INVITATION_PENDING_ROUTE_KEY)).length,
    ).toBeGreaterThanOrEqual(1);
    // Before the fix this unregistered sibling bucket absorbed pending traffic as
    // `no_policy_registered` (readable as "that route has no traffic" rather than "never measured").
    expect(await shadowTalliesFor(INVITATION_BY_ID_ROUTE_KEY)).toEqual([]);
  });

  it("GET /api/ws/user attributes to ITS OWN key, not to GET /api/ws/{projectId}", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);

    // No websocket upgrade headers: the handler's own non-upgrade response is fine —
    // this test is about WHERE the evidence lands, not what the socket does.
    const response = await fresh.app.request("/api/ws/user");
    void response;

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(
      (await shadowTalliesFor(WS_USER_ROUTE_KEY)).length,
    ).toBeGreaterThanOrEqual(1);
    const delegated = await shadowTalliesFor(WS_USER_ROUTE_KEY);
    expect(
      delegated.some(
        (row) =>
          row.outcome === "unevaluated" &&
          row.reasonCode === "delegated_to_handler",
      ),
    ).toBe(true);
    expect(await shadowTalliesFor(WS_PROJECT_ROUTE_KEY)).toEqual([]);
  });
});

describe("#323 Opus S5 — saturated evaluations are dropped AND counted", () => {
  it("with both bounded queues full, the request is unaffected and the drop is flushed as unevaluated: shadow_saturated", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const middleware = await import(
      "../../apps/api/src/permissions/shadow-middleware"
    );
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);

    middleware.setShadowLimitsForTests({ maxInflight: 0, maxPending: 0 });
    try {
      const response = await fresh.app.request(
        `/api/label/workspace/${member.workspace.id}`,
      );
      // The response is untouched — shadow saturation can never change it.
      expect(response.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(
        middleware.shadowConcurrencySnapshot().dropped,
      ).toBeGreaterThanOrEqual(1);

      await middleware.flushShadowDropsForTests();
      const dropTallies = (
        await shadowTalliesFor(LABEL_WORKSPACE_ROUTE_KEY)
      ).filter((row) => row.reasonCode === "shadow_saturated");
      expect(
        dropTallies.reduce((sum, row) => sum + row.count, 0),
      ).toBeGreaterThanOrEqual(1);
      // Unevaluated means the router is NOT clean — coverage stays honest when saturated.
      expect(dropTallies.every((row) => row.outcome === "unevaluated")).toBe(
        true,
      );
      // D1 (Opus delta): the drop row files under the route's REAL registry source,
      // never a fake group — otherwise this saturated router reads clean in the
      // per-router summary the cut-over PR cites.
      expect(
        dropTallies.every(
          (row) => row.routerGroup === "apps/api/src/label/policy.ts",
        ),
      ).toBe(true);
    } finally {
      middleware.setShadowLimitsForTests({});
    }
  });
});
