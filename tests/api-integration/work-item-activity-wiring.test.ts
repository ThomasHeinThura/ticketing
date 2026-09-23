/**
 * Issue #23's third slice, `WI-6` (`docs/03-features/work-items.md`): "Every field
 * change writes an `activity` row with the old and new value." This wires
 * `apps/api/src/work-item/activity.ts` (PR #275) into the create and update write
 * paths (`create-work-item.ts`, `update-work-item.ts`) and asserts on the resulting
 * `activity` rows through real Postgres -- not mocks, except for the one forced-failure
 * test that mocks `recordWorkItemActivity` itself to prove the transaction rolls back.
 *
 * Field-name mapping, checked against CA-7 (`docs/03-features/comments-and-activity.md`)
 * directly, not assumed: `priority` -> `priority` (public, `updated`/`priority` is in
 * `PUBLIC_PAIRS`), `dueDate` -> `due_date` (public, `updated`/`due_date` is in
 * `PUBLIC_PAIRS`), `startDate` -> `start_date` (CA-7's four named public `updated`
 * fields are exactly `priority`, `due_date`, `title`, `description` -- `start_date` is
 * not one of them, so it resolves `internal` by CA-7's own fail-closed default).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as activityModule from "../../apps/api/src/work-item/activity";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [stateTemplate] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!stateTemplate) {
    throw new Error("makeDefaultState: state_template insert returned no row");
  }

  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: state insert returned no row");
  return state;
}

async function setupProjectWithDefaultState(
  role: "member" | "admin" | "viewer" = "member",
) {
  const creator = await createWorkspaceMember({ role });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  const state = await makeDefaultState(creator.workspace.id, project.id);
  return { creator, project, type, state };
}

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function updateWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
  ifMatch: string | number,
) {
  return app.request(`/api/work-items/${key}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": `"${ifMatch}"`,
    },
    body: JSON.stringify(body),
  });
}

async function activityRowsFor(workItemId: string) {
  return db
    .select()
    .from(schema.activityTable)
    .where(eq(schema.activityTable.workItemId, workItemId))
    .orderBy(schema.activityTable.seq);
}

describe("API integration: work-item activity wiring (#23 third slice, WI-6)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("create writes exactly one `created` row with the correct actor and workspace", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Wired create",
    });
    expect(response.status).toBe(200);
    const created = (await response.json()) as { id: string; key: string };

    const rows = await activityRowsFor(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verb).toBe("created");
    expect(rows[0]?.field).toBeNull();
    expect(rows[0]?.actorId).toBe(creator.user.id);
    expect(rows[0]?.actorType).toBe("person");
    expect(rows[0]?.workspaceId).toBe(creator.workspace.id);
    expect(rows[0]?.visibility).toBe("public");
    // CA-7's own "CALLER OBLIGATION": a public row's payload must never carry internal
    // data such as assignee/requester -- only key/title here.
    expect(rows[0]?.payload).toEqual({
      key: created.key,
      title: "Wired create",
    });
  });

  it("an update of two fields writes exactly two rows with the correct old/new values and visibility", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Original title",
      priority: "low",
    });
    const createdBody = (await created.json()) as {
      id: string;
      key: string;
      version: number;
    };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { priority: "high", dueDate: "2026-02-01T00:00:00.000Z" },
      createdBody.version,
    );
    expect(response.status).toBe(200);

    const rows = await activityRowsFor(createdBody.id);
    // One `created` row from the insert above, plus two `updated` rows from this PATCH.
    expect(rows).toHaveLength(3);
    const updates = rows.filter((row) => row.verb === "updated");
    expect(updates).toHaveLength(2);

    const priorityRow = updates.find((row) => row.field === "priority");
    expect(priorityRow).toBeDefined();
    expect(priorityRow?.oldValue).toBe("low");
    expect(priorityRow?.newValue).toBe("high");
    expect(priorityRow?.visibility).toBe("public");

    const dueDateRow = updates.find((row) => row.field === "due_date");
    expect(dueDateRow).toBeDefined();
    expect(new Date(dueDateRow?.newValue as string).toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
    expect(dueDateRow?.visibility).toBe("public");
  });

  it("a startDate change writes an internal row (start_date is not one of CA-7's public `updated` fields)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Start date item",
    });
    const createdBody = (await created.json()) as {
      id: string;
      key: string;
      version: number;
    };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { startDate: "2026-01-01T00:00:00.000Z" },
      createdBody.version,
    );
    expect(response.status).toBe(200);

    const rows = await activityRowsFor(createdBody.id);
    const startDateRow = rows.find((row) => row.field === "start_date");
    expect(startDateRow).toBeDefined();
    expect(startDateRow?.verb).toBe("updated");
    expect(startDateRow?.visibility).toBe("internal");
  });

  it("an unchanged-value PATCH writes zero new rows", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "No-op patch",
      priority: "medium",
    });
    const createdBody = (await created.json()) as {
      id: string;
      key: string;
      version: number;
    };

    const beforeRows = await activityRowsFor(createdBody.id);
    expect(beforeRows).toHaveLength(1); // the `created` row only

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { priority: "medium" },
      createdBody.version,
    );
    expect(response.status).toBe(200);

    const afterRows = await activityRowsFor(createdBody.id);
    expect(afterRows).toHaveLength(1);
  });

  it("a stale If-Match (409) writes zero rows and leaves the version unchanged", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Stale If-Match",
    });
    const createdBody = (await created.json()) as {
      id: string;
      key: string;
      version: number;
    };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should not land" },
      createdBody.version + 1,
    );
    expect(response.status).toBe(409);

    const rows = await activityRowsFor(createdBody.id);
    expect(rows).toHaveLength(1); // the `created` row only

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, createdBody.id));
    expect(row?.version).toBe(1);
    expect(row?.title).toBe("Stale If-Match");
  });

  it("a soft-deleted project (404) writes zero rows", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Project will be deleted",
    });
    const createdBody = (await created.json()) as {
      id: string;
      key: string;
      version: number;
    };

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should not land" },
      createdBody.version,
    );
    expect(response.status).toBe(404);

    const rows = await activityRowsFor(createdBody.id);
    expect(rows).toHaveLength(1); // the `created` row only
  });

  it("a forced failure of the activity insert rolls back the field update", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Rollback probe",
      priority: "low",
    });
    const createdBody = (await created.json()) as {
      id: string;
      key: string;
      version: number;
    };

    const spy = vi
      .spyOn(activityModule, "recordWorkItemActivity")
      .mockRejectedValueOnce(new Error("forced activity-insert failure"));

    let caught: unknown;
    try {
      const response = await updateWorkItemRequest(
        app,
        createdBody.key,
        { priority: "high" },
        createdBody.version,
      );
      // If the route's own error handling swallows a 500 into a response instead of
      // throwing, still assert on the response rather than losing the signal.
      expect(response.status).toBeGreaterThanOrEqual(500);
    } catch (error) {
      caught = error;
    }
    spy.mockRestore();

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, createdBody.id));
    // The field update rolled back with the failed activity insert: version and
    // priority are both unchanged.
    expect(row?.version).toBe(1);
    expect(row?.priority).toBe("low");

    const rows = await activityRowsFor(createdBody.id);
    expect(rows).toHaveLength(1); // the original `created` row only -- nothing else committed
    void caught;
  });

  it("cross-workspace check: activity rows always carry the work item's own workspace_id", async () => {
    const {
      creator: creatorA,
      project: projectA,
      type: typeA,
    } = await setupProjectWithDefaultState();
    const {
      creator: creatorB,
      project: projectB,
      type: typeB,
    } = await setupProjectWithDefaultState();

    mockAuthenticatedSession(creatorA.user);
    const appA = createApp().app;
    const createdA = await createWorkItemRequest(appA, projectA.id, {
      typeId: typeA.id,
      title: "Workspace A item",
    });
    const bodyA = (await createdA.json()) as { id: string };

    mockAuthenticatedSession(creatorB.user);
    const appB = createApp().app;
    const createdB = await createWorkItemRequest(appB, projectB.id, {
      typeId: typeB.id,
      title: "Workspace B item",
    });
    const bodyB = (await createdB.json()) as { id: string };

    const rowsA = await activityRowsFor(bodyA.id);
    const rowsB = await activityRowsFor(bodyB.id);
    expect(
      rowsA.every((row) => row.workspaceId === creatorA.workspace.id),
    ).toBe(true);
    expect(
      rowsB.every((row) => row.workspaceId === creatorB.workspace.id),
    ).toBe(true);
    expect(creatorA.workspace.id).not.toBe(creatorB.workspace.id);

    // Directly confirm the composite (workspace_id, work_item_id) pairing the schema's
    // own FK enforces: no row for A's work item carries B's workspace_id or vice versa.
    const crossRows = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, bodyA.id),
          eq(schema.activityTable.workspaceId, creatorB.workspace.id),
        ),
      );
    expect(crossRows).toHaveLength(0);
  });
});
