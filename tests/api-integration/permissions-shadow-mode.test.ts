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
import { randomUUID } from "node:crypto";
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

describe("#8 notification self-read shadow evidence", () => {
  it("returns only the caller's notifications and records the self-policy agreement", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const caller = await createWorkspaceMember();
    const other = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(caller.user);

    const [ownNotification] = await fresh.db
      .insert(fresh.schema.notificationTable)
      .values({ userId: caller.user.id, type: "info", title: "Own" })
      .returning();
    await fresh.db.insert(fresh.schema.notificationTable).values({
      userId: other.user.id,
      type: "info",
      title: "Other user's private notification",
    });
    if (!ownNotification)
      throw new Error("notification insert returned no row");

    const response = await fresh.app.request("/api/notification");
    expect(response.status).toBe(200);
    const notifications = (await response.json()) as Array<{
      id: string;
      title: string | null;
    }>;
    expect(notifications).toEqual([
      expect.objectContaining({ id: ownNotification.id, title: "Own" }),
    ]);

    const agreeTally = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor("GET /api/notification");
      return rows.find((row) => row.outcome === "agree");
    });
    expect(agreeTally.count).toBe(1);
    expect(
      await shadowEventsFor(
        "GET /api/notification",
        "legacy_deny_policy_allow",
      ),
    ).toEqual([]);
    expect(
      await shadowEventsFor(
        "GET /api/notification",
        "legacy_allow_policy_deny",
      ),
    ).toEqual([]);
  });

  it("keeps only reachable task links and metadata in a caller's own notifications", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("on");
    const caller = await createWorkspaceMember();
    const other = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(caller.user);

    async function createTask(workspaceId: string, title: string) {
      const { project, columns } = await createProjectFixture({ workspaceId });
      const task = await fresh.db
        .insert(fresh.schema.taskTable)
        .values({
          projectId: project.id,
          title,
          description: title,
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning();
      if (!task[0]) throw new Error("createTask: insert returned no row");
      return { task: task[0], project };
    }

    async function createOwnNotification(
      taskId: string,
      title: string,
      eventData: Record<string, unknown> = { taskTitle: title },
      content = `Sensitive content for ${title}`,
    ) {
      const response = await fresh.app.request("/api/notification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          message: content,
          type: "info",
          eventData,
          relatedEntityId: taskId,
          relatedEntityType: "task",
        }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { id: string };
    }

    const { task: privateTask, project: privateProject } = await createTask(
      other.workspace.id,
      "Other workspace task",
    );
    const { task: ownTask, project: ownProject } = await createTask(
      caller.workspace.id,
      "Caller workspace task",
    );
    const { task: deletedTask, project: deletedProject } = await createTask(
      caller.workspace.id,
      "Deleted task",
    );
    const [privateNotification] = await fresh.db
      .insert(fresh.schema.notificationTable)
      .values({
        userId: caller.user.id,
        title: "Private task notification",
        content: "Sensitive private task content",
        type: "info",
        eventData: {
          taskTitle: "Private task notification",
          projectId: privateProject.id,
          workspaceId: other.workspace.id,
          marker: "must-not-leak",
        },
        resourceId: privateTask.id,
        resourceType: "task",
      })
      .returning();
    if (!privateNotification)
      throw new Error("notification insert returned no row");
    const unreachableCreateResponse = await fresh.app.request(
      "/api/notification",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Unreachable task attempt",
          message: "Must not be stored",
          type: "info",
          relatedEntityId: privateTask.id,
          relatedEntityType: "task",
        }),
      },
    );
    expect(unreachableCreateResponse.status).toBe(200);
    expect(await unreachableCreateResponse.json()).toBeNull();
    const ownNotification = await createOwnNotification(
      ownTask.id,
      "Own task notification",
    );
    const deletedTaskNotification = await createOwnNotification(
      deletedTask.id,
      "Deleted task notification",
      {
        taskTitle: "Deleted task notification",
        projectId: deletedProject.id,
        workspaceId: caller.workspace.id,
      },
    );
    await fresh.db
      .delete(fresh.schema.taskTable)
      .where(eq(fresh.schema.taskTable.id, deletedTask.id));

    const response = await fresh.app.request("/api/notification");
    expect(response.status).toBe(200);
    const notifications = (await response.json()) as Array<{
      id: string;
      resourceId: string | null;
      resourceType: string | null;
      eventData: Record<string, unknown> | null;
    }>;

    expect(notifications).toHaveLength(3);
    expect(notifications).toContainEqual(
      expect.objectContaining({
        id: privateNotification.id,
        title: null,
        content: null,
        resourceId: null,
        resourceType: null,
        eventData: null,
      }),
    );

    const readResponse = await fresh.app.request(
      `/api/notification/${privateNotification.id}/read`,
      { method: "PATCH" },
    );
    expect(readResponse.status).toBe(200);
    expect(await readResponse.json()).toEqual(
      expect.objectContaining({
        id: privateNotification.id,
        isRead: true,
        title: null,
        content: null,
        eventData: null,
        resourceId: null,
        resourceType: null,
      }),
    );
    const reachableReadResponse = await fresh.app.request(
      `/api/notification/${ownNotification.id}/read`,
      { method: "PATCH" },
    );
    expect(reachableReadResponse.status).toBe(200);
    expect(await reachableReadResponse.json()).toEqual(
      expect.objectContaining({
        id: ownNotification.id,
        title: "Own task notification",
        content: "Sensitive content for Own task notification",
        eventData: {
          taskTitle: "Own task notification",
        },
        resourceId: ownTask.id,
        resourceType: "task",
      }),
    );
    expect(notifications).toContainEqual(
      expect.objectContaining({
        id: ownNotification.id,
        title: "Own task notification",
        content: "Sensitive content for Own task notification",
        resourceId: ownTask.id,
        resourceType: "task",
        eventData: {
          taskTitle: "Own task notification",
          projectId: ownProject.id,
          workspaceId: caller.workspace.id,
        },
      }),
    );
    expect(notifications).toContainEqual(
      expect.objectContaining({
        id: deletedTaskNotification.id,
        title: null,
        content: null,
        resourceId: null,
        resourceType: null,
        eventData: null,
      }),
    );

    const agreeTally = await waitForShadowEvidence(async () => {
      const rows = await shadowTalliesFor("GET /api/notification");
      return rows.find((row) => row.outcome === "agree");
    });
    expect(agreeTally.count).toBe(1);
    expect(
      await shadowEventsFor(
        "GET /api/notification",
        "legacy_allow_policy_deny",
      ),
    ).toEqual([]);
    expect(
      await shadowEventsFor(
        "GET /api/notification",
        "legacy_deny_policy_allow",
      ),
    ).toEqual([]);
  });

  it("rechecks task reach at notification creation, read, delivery, and preference read", {
    timeout: 60_000,
  }, async () => {
    const fresh = await createAppWithShadow("off");
    const recipient = await createWorkspaceMember();
    const actor = await createWorkspaceMember();
    await backfillPersons();
    fresh.mockUser(recipient.user);

    const { project, columns } = await createProjectFixture({
      workspaceId: recipient.workspace.id,
    });
    const [task] = await fresh.db
      .insert(fresh.schema.taskTable)
      .values({
        projectId: project.id,
        title: "Reach-gated task",
        description: "Reach-gated task",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();
    if (!task) throw new Error("task insert returned no row");

    await fresh.db.insert(fresh.schema.userNotificationPreferenceTable).values({
      userId: recipient.user.id,
      webhookEnabled: false,
    });
    await fresh.db
      .insert(fresh.schema.userNotificationWorkspaceRuleTable)
      .values({
        userId: recipient.user.id,
        workspaceId: recipient.workspace.id,
        isActive: true,
        webhookEnabled: false,
      });

    const { publishEvent } = await import("../../apps/api/src/events");
    await publishEvent("task.status_changed", {
      taskId: task.id,
      userId: actor.user.id,
      assigneeId: recipient.user.id,
      oldStatus: "to-do",
      newStatus: "in-progress",
      title: task.title,
      projectId: project.id,
      type: "status_changed",
    });

    const findTaskNotifications = () =>
      fresh.db
        .select()
        .from(fresh.schema.notificationTable)
        .where(
          and(
            eq(fresh.schema.notificationTable.userId, recipient.user.id),
            eq(fresh.schema.notificationTable.resourceId, task.id),
            eq(fresh.schema.notificationTable.resourceType, "task"),
          ),
        );
    const initialDeadline = Date.now() + 5_000;
    let taskNotifications = await findTaskNotifications();
    while (taskNotifications.length === 0 && Date.now() < initialDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      taskNotifications = await findTaskNotifications();
    }
    expect(taskNotifications).toHaveLength(1);
    const queuedNotification = taskNotifications[0];
    if (!queuedNotification)
      throw new Error("status notification insert returned no row");

    // Let the fire-and-forget first delivery observe the disabled preference.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fresh.db
      .update(fresh.schema.userNotificationPreferenceTable)
      .set({
        webhookEnabled: true,
        webhookUrl: "https://8.8.8.8/notifications",
      })
      .where(
        eq(
          fresh.schema.userNotificationPreferenceTable.userId,
          recipient.user.id,
        ),
      );
    await fresh.db
      .update(fresh.schema.userNotificationWorkspaceRuleTable)
      .set({ webhookEnabled: true })
      .where(
        and(
          eq(
            fresh.schema.userNotificationWorkspaceRuleTable.userId,
            recipient.user.id,
          ),
          eq(
            fresh.schema.userNotificationWorkspaceRuleTable.workspaceId,
            recipient.workspace.id,
          ),
        ),
      );

    await fresh.db
      .delete(fresh.schema.workspaceUserTable)
      .where(
        and(
          eq(fresh.schema.workspaceUserTable.userId, recipient.user.id),
          eq(
            fresh.schema.workspaceUserTable.workspaceId,
            recipient.workspace.id,
          ),
        ),
      );

    await publishEvent("task.status_changed", {
      taskId: task.id,
      userId: actor.user.id,
      assigneeId: recipient.user.id,
      oldStatus: "in-progress",
      newStatus: "done",
      title: task.title,
      projectId: project.id,
      type: "status_changed",
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    taskNotifications = await findTaskNotifications();
    expect(taskNotifications.map((notification) => notification.id)).toEqual([
      queuedNotification.id,
    ]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { deliverNotification } = await import(
      "../../apps/api/src/notification-preferences/delivery"
    );
    await deliverNotification(queuedNotification.id);
    expect(fetchSpy).not.toHaveBeenCalled();

    const listResponse = await fresh.app.request("/api/notification");
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([
      expect.objectContaining({
        id: queuedNotification.id,
        title: null,
        content: null,
        eventData: null,
        resourceId: null,
        resourceType: null,
      }),
    ]);

    const readResponse = await fresh.app.request(
      `/api/notification/${queuedNotification.id}/read`,
      { method: "PATCH" },
    );
    expect(readResponse.status).toBe(200);
    expect(await readResponse.json()).toEqual(
      expect.objectContaining({
        id: queuedNotification.id,
        isRead: true,
        title: null,
        content: null,
        eventData: null,
        resourceId: null,
        resourceType: null,
      }),
    );

    expect(
      await fresh.db.query.userNotificationWorkspaceRuleTable.findFirst({
        where: eq(
          fresh.schema.userNotificationWorkspaceRuleTable.workspaceId,
          recipient.workspace.id,
        ),
      }),
    ).toBeDefined();

    const { getNotificationPreferences } = await import(
      "../../apps/api/src/notification-preferences/service"
    );
    const directPreferences = await getNotificationPreferences(
      recipient.user.id,
      recipient.user.email,
    );
    expect(directPreferences.workspaces).toEqual([]);

    const preferenceResponse = await fresh.app.request(
      "/api/notification-preferences",
    );
    const preferenceText = await preferenceResponse.text();
    expect(preferenceResponse.status, preferenceText).toBe(200);
    const preferences = JSON.parse(preferenceText) as {
      workspaces: Array<{ workspaceId: string; workspaceName: string }>;
    };
    expect(preferences.workspaces).toEqual([]);
  });
});

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

  it("tracks project request-scope separately from row-derived workspace scope", {
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
    expect(
      tallies.some(
        (row) =>
          row.outcome === "unevaluated" &&
          row.reasonCode === "reach_unavailable",
      ),
    ).toBe(true);
    expect(
      tallies.some(
        (row) =>
          row.outcome === "unevaluated" &&
          row.reasonCode === "scope_source_unavailable",
      ),
    ).toBe(false);
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
