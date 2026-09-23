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
import { createWorkspaceMember } from "./helpers/fixtures";

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
