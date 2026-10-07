/**
 * Integration tests for issue #8 Slice 2's shadow-mode middleware.
 *
 * Four obligations from the brief, each its own describe block:
 *  1. Shadow off (the default) writes nothing — a true no-op.
 *  2. Responses are byte-identical with shadow on and off, for a representative route.
 *  3. Instance-admin reach does not bypass workspace capability authority; an assigned role
 *     still permits the operation.
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
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import type { createApp } from "../../apps/api/src/index";
import {
  policyShadowEventTable,
  policyShadowTallyTable,
} from "../../apps/api/src/permissions/shadow-schema";
import { seedInternalOrganisationAndStaffPersons } from "../../apps/api/src/utils/seed-internal-organisation";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  prepareAuthenticatedApiFixture,
} from "./helpers/fixtures";

// This file resets the complete app module graph to test the import-time shadow
// switch. Avoid the shared createApp mock here so each fresh graph retains its
// own auth module instance; adapt only the app's in-process request boundary.
vi.unmock("../../apps/api/src/index");

/**
 * `resolveIdentity` requires a `person` row (#315 S7 — the real backfill runs once, at
 * boot). `createWorkspaceMember()` now provisions an ordinary active identity; this
 * backfill remains for direct user rows this file creates so shadow comparisons exercise
 * their intended scenario instead of S7's `missing_identity` case.
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
  const app = indexModule.createApp().app;
  const request = app.request.bind(app);
  app.request = (input, init, env, executionCtx) => {
    if (typeof input === "string") {
      const normalized = withConfiguredAgentAuthority(input, init);
      return request(normalized.input, normalized.init, env, executionCtx);
    }
    return request(input, init, env, executionCtx);
  };

  return {
    app,
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
          portal: "agent",
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

async function waitForShadowEvidence<T>(
  read: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("shadow evidence was not written within 5 seconds");
}

function hashApiKey(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
const LIST_NOTIFICATIONS_ROUTE_KEY = "GET /api/notification";
const GET_NOTIFICATION_PREFERENCES_ROUTE_KEY =
  "GET /api/notification-preferences";
const GET_TASK_ROUTE_KEY = "GET /api/task/{id}";
const DELETE_NOTIFICATION_WORKSPACE_RULE_ROUTE_KEY =
  "DELETE /api/notification-preferences/workspaces/{workspaceId}";

function postgresStatement(query: unknown): string {
  if (typeof query === "string") return query;
  if (
    typeof query === "object" &&
    query !== null &&
    "text" in query &&
    typeof query.text === "string"
  ) {
    return query.text;
  }
  return "";
}

describe("successful authentication is recorded as the legacy self-policy decision", () => {
  it("compares notification and preference reads as authenticated self routes", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);

    const notifications = await fresh.app.request("/api/notification");
    const preferences = await fresh.app.request(
      "/api/notification-preferences",
    );
    expect(notifications.status).toBe(200);
    expect(preferences.status).toBe(200);

    const notificationRows = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor(LIST_NOTIFICATIONS_ROUTE_KEY);
      return rows.length ? rows : undefined;
    });
    const preferenceRows = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor(
        GET_NOTIFICATION_PREFERENCES_ROUTE_KEY,
      );
      return rows.length ? rows : undefined;
    });

    expect(notificationRows).toContainEqual(
      expect.objectContaining({ outcome: "agree", reasonCode: null }),
    );
    expect(preferenceRows).toContainEqual(
      expect.objectContaining({ outcome: "agree", reasonCode: null }),
    );
  });

  it("does not shadow an authentication denial as an allowed request", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const response = await fresh.app.request("/api/notification");

    expect(response.status).toBe(401);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await shadowTalliesFor(LIST_NOTIFICATIONS_ROUTE_KEY)).toEqual([]);
  });

  it("keeps an authenticated comparison when a handler fails", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);
    vi.spyOn(
      fresh.db.query.userNotificationPreferenceTable,
      "findFirst",
    ).mockRejectedValueOnce(new Error("injected preference read failure"));

    const response = await fresh.app.request("/api/notification-preferences");
    expect(response.status).toBe(500);

    const rows = await waitForShadowEvidence(async () => {
      const tallies = await shadowTalliesFor(
        GET_NOTIFICATION_PREFERENCES_ROUTE_KEY,
      );
      return tallies.length ? tallies : undefined;
    });
    expect(rows).toContainEqual(
      expect.objectContaining({
        outcome: "unevaluated",
        reasonCode: "legacy_outcome_unknown",
      }),
    );
  });

  it("leaves an unrelated inline workspace denial unknown", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const caller = await createWorkspaceMember();
    const other = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(caller.user);

    const response = await fresh.app.request(
      `/api/notification-preferences/workspaces/${other.workspace.id}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(403);

    const rows = await waitForShadowEvidence(async () => {
      const tallies = await shadowTalliesFor(
        DELETE_NOTIFICATION_WORKSPACE_RULE_ROUTE_KEY,
      );
      return tallies.length ? tallies : undefined;
    });
    expect(rows).toContainEqual(
      expect.objectContaining({
        outcome: "unevaluated",
        reasonCode: "legacy_outcome_unknown",
      }),
    );
  });
});

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

describe("API-key work-item export identity in shadow mode", () => {
  it("records agreement for a scoped key exporting only currently reachable rows", {
    timeout: 60_000,
  }, async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const reachable = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const unreachable = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    for (const project of [reachable.project, unreachable.project]) {
      await grantProjectRole(owner.user.id, project.id, [
        "work_item:create",
        "work_item:export",
        "project:read",
      ]);
    }
    const now = new Date();
    const [type] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const [template] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `state-${randomUUID()}`,
        name: "Started",
        group: "started",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!type || !template)
      throw new Error("Shadow export fixture setup failed");
    await db.insert(schema.stateTable).values([
      ...[reachable.project.id, unreachable.project.id].map((projectId) => ({
        projectId,
        stateTemplateId: template.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })),
    ]);

    const fresh = await createAppWithShadow("on");
    fresh.mockUser(owner.user);
    for (const [project, title] of [
      [reachable.project, "Shadow reached export"],
      [unreachable.project, "Shadow hidden export"],
    ] as const) {
      const created = await fresh.app.request(
        `/api/projects/${project.id}/work-items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ typeId: type.id, title }),
        },
      );
      expect(created.status, await created.clone().text()).toBe(200);
    }
    const personRows = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id))
      .limit(1);
    const person = personRows[0];
    if (!person) throw new Error("Shadow export owner person is missing");
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, unreachable.project.id),
        ),
      );
    const rawKey = `taskdesk_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: owner.user.id,
      userId: owner.user.id,
      key: hashApiKey(rawKey),
      name: "shadow work-item export key",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ work_item: ["export"] }),
      createdAt: now,
      updatedAt: now,
    });

    const response = await fresh.app.request("/api/work-items/export", {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        query: { entity: "work_item", columns: ["key", "title"] },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const csv = await response.text();
    expect(csv).toContain("Shadow reached export");
    expect(csv).not.toContain("Shadow hidden export");

    const tally = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor("POST /api/work-items/export");
      return rows.find((row) => row.outcome === "agree");
    });
    expect(tally).toMatchObject({
      routeKey: "POST /api/work-items/export",
      outcome: "agree",
      reasonCode: null,
    });
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

describe("observer-only provenance for masked native read denials", () => {
  it("agrees for an active workspace member with persisted project read authority", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await fresh.db.insert(fresh.schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: caller.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const [task] = await fresh.db
      .insert(fresh.schema.taskTable)
      .values({
        projectId: project.id,
        title: "Independent project reach fixture",
        description: "",
        status: "to-do",
        priority: "medium",
        columnId: columns.todo.id,
        number: 1,
        position: 1,
      })
      .returning();
    if (!task)
      throw new Error("observer project reach task insert returned no row");

    const [person] = await fresh.db
      .select({ id: fresh.schema.personTable.id })
      .from(fresh.schema.personTable)
      .where(eq(fresh.schema.personTable.userId, caller.user.id))
      .limit(1);
    if (!person)
      throw new Error("observer caller has no active person fixture");
    const [role] = await fresh.db
      .insert(fresh.schema.roleTable)
      .values({
        scope: "project",
        workspaceId: owner.workspace.id,
        key: `observer-${randomUUID()}`,
        name: "Observer project reader",
        rank: 1,
        capabilities: ["work_item:read"],
      })
      .returning();
    if (!role) throw new Error("observer project role insert returned no row");
    await fresh.db.insert(fresh.schema.membershipTable).values({
      personId: person.id,
      scope: "project",
      scopeId: project.id,
      roleId: role.id,
    });

    await backfillPersons();
    fresh.mockUser(caller.user);

    // Both the native handler and independent policy evaluation use the active
    // workspace membership and persisted project role. The project role may override
    // a workspace role that lacks the selected read capability.
    const response = await fresh.app.request(`/api/task/${task.id}`);
    expect(response.status).toBe(200);

    const tally = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor(GET_TASK_ROUTE_KEY);
      return rows.find(
        (row) => row.outcome === "agree" && row.reasonCode === null,
      );
    });
    expect(tally).toMatchObject({
      outcome: "agree",
      reasonCode: null,
    });
    // Shadow events are intentionally stored only for non-agree outcomes; the tally is
    // the complete request counter and is the evidence for this successful comparison.
    expect(await shadowEventsFor(GET_TASK_ROUTE_KEY, "agree")).toHaveLength(0);
  });

  it("records policy denial when a workspace member has no project reach", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await fresh.db.insert(fresh.schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: caller.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const [task] = await fresh.db
      .insert(fresh.schema.taskTable)
      .values({
        projectId: project.id,
        title: "Resolved project reach fixture",
        description: "",
        status: "to-do",
        priority: "medium",
        columnId: columns.todo.id,
        number: 1,
        position: 1,
      })
      .returning();
    if (!task)
      throw new Error("resolved project reach task insert returned no row");
    await backfillPersons();
    fresh.mockUser(caller.user);

    const response = await fresh.app.request(`/api/task/${task.id}`);
    expect(response.status).toBe(404);
    const tally = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor(GET_TASK_ROUTE_KEY);
      return rows.length ? rows : undefined;
    });
    expect(tally).toContainEqual(
      expect.objectContaining({
        outcome: "agree",
        reasonCode: null,
      }),
    );
  });

  it("compares a real foreign work item using its persisted row scope while preserving the masked 404", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [task] = await fresh.db
      .insert(fresh.schema.taskTable)
      .values({
        projectId: project.id,
        title: "Observer scope fixture",
        description: "",
        status: "to-do",
        priority: "medium",
        columnId: columns.todo.id,
        number: 1,
        position: 1,
      })
      .returning();
    if (!task) throw new Error("observer fixture task insert returned no row");
    await backfillPersons();
    fresh.mockUser(caller.user);

    const response = await fresh.app.request(`/api/task/${task.id}`);
    expect(response.status).toBe(404);

    const tally = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor(GET_TASK_ROUTE_KEY);
      return rows.length ? rows : undefined;
    });
    expect(tally).toMatchObject([{ outcome: "agree", reasonCode: null }]);
    expect(
      await shadowEventsFor(GET_TASK_ROUTE_KEY, "legacy_allow_policy_deny"),
    ).toEqual([]);
  });

  it("keeps a missing work-item id unevaluated instead of manufacturing row scope", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const caller = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(caller.user);

    const response = await fresh.app.request(
      "/api/task/missing-shadow-row?workspaceId=caller-controlled",
    );
    expect(response.status).toBe(404);
    const rows = await waitForShadowEvidence(async () => {
      const events = await shadowEventsFor(GET_TASK_ROUTE_KEY, "unevaluated");
      return events.length ? events : undefined;
    });
    expect(rows).toContainEqual(
      expect.objectContaining({
        outcome: "unevaluated",
        reasonCode: "row_scope_unavailable",
        workspaceId: null,
      }),
    );
  });

  it("records successful native self reads and the instance audit gate explicitly", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember({ role: "owner" });
    await fresh.db
      .update(fresh.schema.userTable)
      .set({ role: "admin" })
      .where(eq(fresh.schema.userTable.id, member.user.id));
    await backfillPersons();
    fresh.mockUser({ ...member.user, role: "admin" });

    const audit = await fresh.app.request("/api/instance/audit");
    expect(audit.status).toBe(200);
    const token = await fresh.app.request("/api/oauth/id-token");
    expect(token.status).toBe(200);
    const pending = await fresh.app.request("/api/me/pending-actions");
    expect(pending.status).toBe(200);
    const avatar = await fresh.app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentType: "image/png",
        data: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02,
        ]).toString("base64"),
      }),
    });
    expect(avatar.status).toBe(200);
    const deleted = await fresh.app.request("/api/user/avatar", {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);

    const routes = [
      "GET /api/instance/audit",
      "GET /api/oauth/id-token",
      "GET /api/me/pending-actions",
      "PUT /api/user/avatar",
      "DELETE /api/user/avatar",
    ];
    for (const routeKey of routes) {
      const rows = await waitForShadowEvidence(async () => {
        const tallies = await shadowTalliesFor(routeKey);
        return tallies.length === 0 ? undefined : tallies;
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: "agree", count: 1 });
    }
  });

  it("compares a two-actor persisted work-item mutation denial using loaded reach facts", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const owner = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await backfillPersons();
    fresh.mockUser(owner.user);

    const now = new Date();
    const [type] = await fresh.db
      .insert(fresh.schema.workItemTypeTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `shadow-mutation-${randomUUID()}`,
        name: "Shadow mutation item",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!type) throw new Error("work item type fixture insert failed");
    const [template] = await fresh.db
      .insert(fresh.schema.stateTemplateTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `shadow-mutation-state-${randomUUID()}`,
        name: "Shadow mutation backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!template) throw new Error("state template fixture insert failed");
    await fresh.db.insert(fresh.schema.stateTable).values({
      projectId: project.id,
      stateTemplateId: template.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    const created = await fresh.app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typeId: type.id, title: "Persisted original" }),
      },
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };
    const [before] = await fresh.db
      .select({
        title: fresh.schema.workItemTable.title,
        version: fresh.schema.workItemTable.version,
      })
      .from(fresh.schema.workItemTable)
      .where(eq(fresh.schema.workItemTable.key, createdBody.key));
    expect(before).toEqual({ title: "Persisted original", version: 1 });

    fresh.mockUser(outsider.user);
    const denied = await fresh.app.request(
      `/api/work-items/${createdBody.key}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": `"${createdBody.version}"`,
        },
        body: JSON.stringify({ title: "Unauthorized replacement" }),
      },
    );
    expect(denied.status).toBe(404);

    const [after] = await fresh.db
      .select({
        title: fresh.schema.workItemTable.title,
        version: fresh.schema.workItemTable.version,
      })
      .from(fresh.schema.workItemTable)
      .where(eq(fresh.schema.workItemTable.key, createdBody.key));
    expect(after).toEqual(before);
    const tally = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor("PATCH /api/work-items/{key}");
      return rows.find((row) => row.outcome === "agree");
    });
    expect(tally).toMatchObject({
      outcome: "agree",
      reasonCode: null,
      count: 1,
    });
  });

  it("keeps a soft-deleted containing project unknown for a nonmember read", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [task] = await fresh.db
      .insert(fresh.schema.taskTable)
      .values({
        projectId: project.id,
        title: "Soft-deleted project fixture",
        description: "",
        status: "to-do",
        priority: "medium",
        columnId: columns.todo.id,
        number: 1,
        position: 1,
      })
      .returning();
    if (!task) throw new Error("observer fixture task insert returned no row");
    await fresh.db
      .update(fresh.schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(fresh.schema.projectTable.id, project.id));
    await backfillPersons();
    fresh.mockUser(caller.user);

    const response = await fresh.app.request(`/api/task/${task.id}`);
    expect(response.status).toBe(404);
    const rows = await waitForShadowEvidence(async () => {
      const events = await shadowEventsFor(GET_TASK_ROUTE_KEY, "unevaluated");
      return events.length ? events : undefined;
    });
    expect(rows).toContainEqual(
      expect.objectContaining({
        outcome: "unevaluated",
        reasonCode: "row_scope_unavailable",
        workspaceId: null,
      }),
    );
  });

  it("preserves the masked response and records unknown when the observer query fails", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [task] = await fresh.db
      .insert(fresh.schema.taskTable)
      .values({
        projectId: project.id,
        title: "Observer failure fixture",
        description: "",
        status: "to-do",
        priority: "medium",
        columnId: columns.todo.id,
        number: 1,
        position: 1,
      })
      .returning();
    if (!task)
      throw new Error("observer failure fixture insert returned no row");
    await backfillPersons();
    fresh.mockUser(caller.user);

    const pool = fresh.db.$client;
    const originalQuery = pool.query.bind(pool);
    let taskQueries = 0;
    const selectSpy = vi.spyOn(pool, "query").mockImplementation((...args) => {
      const statement = postgresStatement(args[0]);
      if (/from\s+"task"/i.test(statement) && ++taskQueries === 2) {
        return Promise.reject(new Error("observer read unavailable"));
      }
      return originalQuery(...args);
    });
    const response = await fresh.app.request(`/api/task/${task.id}`);
    selectSpy.mockRestore();
    expect(response.status).toBe(404);
    const rows = await waitForShadowEvidence(async () => {
      const events = await shadowEventsFor(GET_TASK_ROUTE_KEY, "unevaluated");
      return events.length ? events : undefined;
    });
    expect(rows).toContainEqual(
      expect.objectContaining({
        outcome: "unevaluated",
        reasonCode: "row_scope_unavailable",
        workspaceId: null,
      }),
    );
  });

  it("does not issue an observer read when shadow mode is off", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("off");
    const caller = await createWorkspaceMember();
    const owner = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [task] = await fresh.db
      .insert(fresh.schema.taskTable)
      .values({
        projectId: project.id,
        title: "Shadow off observer fixture",
        description: "",
        status: "to-do",
        priority: "medium",
        columnId: columns.todo.id,
        number: 1,
        position: 1,
      })
      .returning();
    if (!task) throw new Error("shadow-off fixture insert returned no row");
    fresh.mockUser(caller.user);
    const querySpy = vi.spyOn(fresh.db.$client, "query");
    const response = await fresh.app.request(`/api/task/${task.id}`);
    const taskQueries = querySpy.mock.calls.filter(([query]) => {
      const statement = postgresStatement(query);
      return /from\s+"task"/i.test(statement);
    });
    querySpy.mockRestore();
    expect(response.status).toBe(404);
    expect(taskQueries).toHaveLength(1);
  });
});

describe("instance-admin reach does not bypass workspace capability authority", () => {
  it("refuses a nonmember instance admin and records agreement with the declared capability", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");

    // The admin has global reach but no role in this workspace.
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

    expect(response.status).toBe(403);

    // Shadow write happens after the response, off the request's own promise chain
    // (see shadow-middleware.ts) — give it a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const tallies = await shadowTalliesFor(UPDATE_LABEL_ROUTE_KEY);
    expect(tallies).toContainEqual(
      expect.objectContaining({ outcome: "agree", reasonCode: null }),
    );
    expect(tallies).not.toContainEqual(
      expect.objectContaining({ outcome: "legacy_allow_policy_deny" }),
    );
  });

  it("allows an instance admin whose workspace role grants the required capability", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember({ role: "admin" });
    const labelId = await createLabelFixture(fresh, member.workspace.id);
    await fresh.db
      .update(fresh.schema.userTable)
      .set({ role: "admin" })
      .where(eq(fresh.schema.userTable.id, member.user.id));
    fresh.mockUser({ ...member.user, role: "admin" });

    const response = await fresh.app.request(`/api/label/${labelId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Updated by assigned admin",
        color: "#00ff00",
      }),
    });
    expect(response.status).toBe(200);

    const tally = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor(UPDATE_LABEL_ROUTE_KEY);
      return rows.find((row) => row.outcome === "agree");
    });
    expect(tally.outcome).toBe("agree");
  });

  it("keeps workspace-read routes denied without a role and available to assigned roles", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await backfillPersons();

    const outsiderAdmin = {
      id: "user-instance-admin-read-boundary-test",
      email: "instance-admin-read-boundary-test@example.com",
      name: "Instance Admin Without Workspace Role",
      emailVerified: true,
      role: "admin",
    };
    await fresh.db.insert(fresh.schema.userTable).values(outsiderAdmin);
    await backfillPersons();
    fresh.mockUser(outsiderAdmin);

    const denied = await Promise.all([
      fresh.app.request(`/api/project?workspaceId=${owner.workspace.id}`),
      fresh.app.request(`/api/column/${project.id}`),
      fresh.app.request(`/api/workflow-rule/${project.id}`),
      fresh.app.request(`/api/label/workspace/${owner.workspace.id}`),
      fresh.app.request(`/api/workspace/${owner.workspace.id}`),
      fresh.app.request(`/api/capabilities?workspaceId=${owner.workspace.id}`),
    ]);
    expect(denied.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403, 403,
    ]);

    const assignedAdmin = await createWorkspaceMember({
      role: "admin",
      workspaceName: "Instance Admin With Read Role",
    });
    await fresh.db
      .update(fresh.schema.userTable)
      .set({ role: "admin" })
      .where(eq(fresh.schema.userTable.id, assignedAdmin.user.id));
    fresh.mockUser({ ...assignedAdmin.user, role: "admin" });
    const { project: assignedProject } = await createProjectFixture({
      workspaceId: assignedAdmin.workspace.id,
    });

    const allowed = await Promise.all([
      fresh.app.request(
        `/api/project?workspaceId=${assignedAdmin.workspace.id}`,
      ),
      fresh.app.request(`/api/column/${assignedProject.id}`),
      fresh.app.request(`/api/workflow-rule/${assignedProject.id}`),
      fresh.app.request(`/api/label/workspace/${assignedAdmin.workspace.id}`),
      fresh.app.request(`/api/workspace/${assignedAdmin.workspace.id}`),
      fresh.app.request(
        `/api/capabilities?workspaceId=${assignedAdmin.workspace.id}`,
      ),
    ]);
    expect(allowed.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200, 200,
    ]);
  });

  it("lets a member inspect an unknown role as an all-false map without granting access", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember({ role: "viewer" });
    await fresh.db
      .update(fresh.schema.workspaceUserTable)
      .set({ role: "toString" })
      .where(
        and(
          eq(fresh.schema.workspaceUserTable.workspaceId, member.workspace.id),
          eq(fresh.schema.workspaceUserTable.userId, member.user.id),
        ),
      );
    await backfillPersons();
    fresh.mockUser(member.user);

    const response = await fresh.app.request(
      `/api/capabilities?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const capabilityMap = (await response.json()) as Record<string, boolean>;
    expect(Object.values(capabilityMap).every((allowed) => !allowed)).toBe(
      true,
    );

    const tally = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor("GET /api/capabilities");
      return rows.find((row) => row.outcome === "agree");
    });
    expect(tally.outcome).toBe("agree");
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

    const tallies = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor(WORKSPACE_DETAIL_ROUTE_KEY);
      return rows.some((row) => row.outcome === "agree") ? rows : undefined;
    });
    expect(tallies.some((row) => row.outcome === "agree")).toBe(true);
    expect(
      tallies.some((row) => row.outcome === "legacy_deny_policy_allow"),
    ).toBe(false);
  });

  it("does not persist an unverified caller-supplied id in a denied event", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);
    const untrustedWorkspaceId = `attacker-${"x".repeat(6_000)}`;
    expect(untrustedWorkspaceId).toHaveLength(6_009);

    const response = await fresh.app.request(
      `/api/workspace/${untrustedWorkspaceId}`,
    );
    expect(response.status).toBe(403);

    const event = await waitForShadowEvidence(async () => {
      const rows = await shadowEventsFor(
        WORKSPACE_DETAIL_ROUTE_KEY,
        "unevaluated",
      );
      return rows.find(
        (row) =>
          row.reasonCode === "scope_source_unavailable" &&
          row.legacyAllowed === false,
      );
    });
    expect(event.workspaceId).toBeNull();
  });

  it("does not persist an unverified caller-supplied id when the caller is an instance admin (#400, Opus R1 on #381)", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const instanceAdminUser = {
      id: "user-instance-admin-workspace-id-shadow-test",
      email: "instance-admin-workspace-id-shadow-test@example.com",
      name: "Instance Admin",
      emailVerified: true,
      role: "admin",
    };
    await fresh.db.insert(fresh.schema.userTable).values(instanceAdminUser);
    await prepareAuthenticatedApiFixture(instanceAdminUser.id);
    await backfillPersons();
    fresh.mockUser(instanceAdminUser);
    const untrustedWorkspaceId = `attacker-${"x".repeat(6_000)}`;
    expect(untrustedWorkspaceId).toHaveLength(6_009);

    // `validateWorkspaceAccess` returns early for `role === "admin"` (never checking the
    // workspace exists), so legacy authorization here is "allowed" purely from the admin
    // bypass — the exact case #381's own fix (relying on `legacyAllowed === true` as proof
    // of verification) missed.
    const response = await fresh.app.request(
      `/api/workspace/${untrustedWorkspaceId}`,
    );
    expect(response.status).toBe(404);

    const event = await waitForShadowEvidence(async () => {
      const rows = await shadowEventsFor(
        WORKSPACE_DETAIL_ROUTE_KEY,
        "unevaluated",
      );
      return rows.find((row) => row.reasonCode === "scope_source_unavailable");
    });
    expect(event.legacyAllowed).toBe(true);
    expect(event.workspaceId).toBeNull();
  });

  it("preserves a request-sourced workspace id when legacy authorization allowed it", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const member = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(member.user);

    const registry = await import("../../apps/api/src/policy-registry");
    const originalGet = registry.policyRegistry.get.bind(
      registry.policyRegistry,
    );
    vi.spyOn(registry.policyRegistry, "get").mockImplementation((routeKey) => {
      const entry = originalGet(routeKey);
      if (routeKey !== LABEL_WORKSPACE_ROUTE_KEY || !entry) return entry;
      return {
        routeKey: entry.routeKey,
        kind: "capability",
        source: entry.source,
        policy: {
          capability: "workspace:manage_roles",
          scope: "workspace",
          reach: "required",
          scopeSource: "request",
        },
      };
    });

    const response = await fresh.app.request(
      `/api/label/workspace/${member.workspace.id}`,
    );
    expect(response.status).toBe(200);

    const event = await waitForShadowEvidence(async () => {
      const rows = await shadowEventsFor(
        LABEL_WORKSPACE_ROUTE_KEY,
        "legacy_allow_policy_deny",
      );
      return rows.at(-1);
    });
    expect(event.workspaceId).toBe(member.workspace.id);
  });

  it("records a deliberately permissive shadow policy against a legacy-denied request", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const owner = await createWorkspaceMember();
    const other = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(other.user);

    const registry = await import("../../apps/api/src/policy-registry");
    const originalGet = registry.policyRegistry.get.bind(
      registry.policyRegistry,
    );
    vi.spyOn(registry.policyRegistry, "get").mockImplementation((routeKey) => {
      const entry = originalGet(routeKey);
      if (routeKey !== WORKSPACE_DETAIL_ROUTE_KEY || !entry) return entry;
      return {
        routeKey: entry.routeKey,
        kind: "public",
        source: entry.source,
        policy: {
          public: true,
          reason:
            "Deliberately permissive shadow fixture for deny-path coverage",
        },
      };
    });

    const response = await fresh.app.request(
      `/api/workspace/${owner.workspace.id}`,
    );
    expect(response.status).toBe(403);

    const disagreements = await waitForShadowEvidence(async () => {
      const rows = await shadowEventsFor(
        WORKSPACE_DETAIL_ROUTE_KEY,
        "legacy_deny_policy_allow",
      );
      return rows.length > 0 ? rows : undefined;
    });
    expect(disagreements).toHaveLength(1);
  });

  it("tracks request-sourced project scope and independently denies missing project reach", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const owner = await createWorkspaceMember({ role: "owner" });
    await backfillPersons();
    fresh.mockUser(owner.user);
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const now = new Date();
    const [type] = await fresh.db
      .insert(fresh.schema.workItemTypeTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `shadow-${randomUUID()}`,
        name: "Shadow test item",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!type) throw new Error("work item type fixture insert failed");
    const [template] = await fresh.db
      .insert(fresh.schema.stateTemplateTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `shadow-state-${randomUUID()}`,
        name: "Shadow test backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!template) throw new Error("state template fixture insert failed");
    await fresh.db.insert(fresh.schema.stateTable).values({
      projectId: project.id,
      stateTemplateId: template.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    const response = await fresh.app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typeId: type.id, title: "Shadow scope probe" }),
      },
    );
    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const tallies = await shadowTalliesFor(
      "POST /api/projects/{projectId}/work-items",
    );
    expect(tallies).toContainEqual(
      expect.objectContaining({
        outcome: "legacy_allow_policy_deny",
        reasonCode: "not_found",
      }),
    );
  });
});

describe("#400 F1 (Opus review) — a row-derived id with no source label is still attributed", () => {
  it("PATCH /api/canned-responses/{id} keeps its real workspace id on a non-agree event", {
    timeout: 60_000,
  }, async () => {
    // `requireCannedResponseReach` resolves `workspaceId` from the canned response's own
    // row -- a genuine database lookup, exactly like `requireWorkItemReach` and
    // `requireAttachmentReach` -- but (before #400's F1 fix) never labelled it
    // `workspaceIdSource: "row"` the way those two do. `workspaceIdForShadowEvidence`'s
    // widened lookup (#400) only runs for `source === "request"`, so an unlabelled id
    // (`source === null`) was never promoted either -- it was always recorded as `NULL`
    // on any non-`agree` event, real id or not. #400 labels this middleware's id `"row"`
    // so it is trusted like every other row-derived source.
    const fresh = await createAppWithShadow("on");
    const owner = await createWorkspaceMember({ role: "owner" });
    await backfillPersons();
    fresh.mockUser(owner.user);
    const [cannedResponse] = await fresh.db
      .insert(fresh.schema.cannedResponseTable)
      .values({
        workspaceId: owner.workspace.id,
        name: "Greeting",
        body: { type: "doc", content: [] },
      })
      .returning();
    if (!cannedResponse)
      throw new Error("canned response fixture insert failed");

    // Force a shadow disagreement independent of the caller's real capability, the same
    // mocked-registry technique the sibling tests above use: the route's real policy is
    // workspace-scoped, so declaring `scope: "project"` here can never resolve (this
    // route carries no project id at all), landing reliably on an `unevaluated` outcome
    // -- any non-`agree` outcome writes an event row and exercises the same
    // `evidenceWorkspaceId()` gate a real disagreement would.
    const registry = await import("../../apps/api/src/policy-registry");
    const originalGet = registry.policyRegistry.get.bind(
      registry.policyRegistry,
    );
    const CANNED_RESPONSE_UPDATE_ROUTE_KEY = "PATCH /api/canned-responses/{id}";
    vi.spyOn(registry.policyRegistry, "get").mockImplementation((routeKey) => {
      const entry = originalGet(routeKey);
      if (routeKey !== CANNED_RESPONSE_UPDATE_ROUTE_KEY || !entry) return entry;
      return {
        routeKey: entry.routeKey,
        kind: "capability",
        source: entry.source,
        policy: {
          capability: "workspace:manage_settings",
          scope: "project",
          reach: "required",
          scopeSource: "row",
        },
      };
    });

    const response = await fresh.app.request(
      `/api/canned-responses/${cannedResponse.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Greeting v2" }),
      },
    );
    expect(response.status).toBe(200);

    const events = await waitForShadowEvidence(async () => {
      const rows = await shadowEventsFor(
        CANNED_RESPONSE_UPDATE_ROUTE_KEY,
        "unevaluated",
      );
      return rows.length > 0 ? rows : undefined;
    });
    expect(events.length).toBeGreaterThan(0);
    expect(
      events.every((event) => event.workspaceId === owner.workspace.id),
    ).toBe(true);
  });
});

describe("#324 — controller-level leave denial replaces an earlier allowed marker", () => {
  it("records the controller's membership recheck as a real denial", {
    timeout: 60_000,
  }, async () => {
    vi.doMock(
      "../../apps/api/src/workspace/controllers/leave-workspace",
      async () => {
        const { NotAMemberError } = await import(
          "../../apps/api/src/workspace/controllers/workspace-membership-errors"
        );
        return {
          default: async () => {
            throw new NotAMemberError();
          },
        };
      },
    );
    try {
      const fresh = await createAppWithShadow("on");
      const member = await createWorkspaceMember();
      await backfillPersons();
      fresh.mockUser(member.user);

      const response = await fresh.app.request(
        `/api/workspace/${member.workspace.id}/leave`,
        { method: "POST" },
      );
      expect(response.status).toBe(404);

      await new Promise((resolve) => setTimeout(resolve, 300));
      const events = await shadowEventsFor(
        "POST /api/workspace/{workspaceId}/leave",
        "legacy_deny_policy_allow",
      );
      expect(events).toHaveLength(1);
    } finally {
      vi.doUnmock("../../apps/api/src/workspace/controllers/leave-workspace");
    }
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
