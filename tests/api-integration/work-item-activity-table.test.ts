/**
 * Migration 0066 / decision log 2026-09-23 ("Work-item activity gets its own `activity`
 * table; kaneo's becomes `task_activity`"). Real PostgreSQL 18 inserts against the new
 * `activity` table and its writer (`apps/api/src/work-item/activity.ts`) -- not mocks --
 * because every assertion here is a DB-level constraint (the composite tenant-scoping
 * FK, a CHECK, an identity column) or the writer's own transactional atomicity, and a
 * happy-path-only test would pass with any of them reverted.
 *
 * Legacy `task_activity` (formerly `activity`) keeping its own routes working is covered
 * separately by the pre-existing `comment.test.ts` / `task-title-activity.test.ts` /
 * `account-deletion.test.ts` suites, which this migration's rename left otherwise
 * unchanged -- they still pass after the rename (verified as part of this PR, not
 * re-asserted here).
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  diffWorkItemFieldChanges,
  recordWorkItemActivity,
} from "../../apps/api/src/work-item/activity";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

// ── Minimal fixture builders -- same idiom as work-item-integrity-constraints.test.ts: ──
// this schema still has no work-item create/update route wired to `activity` yet (that
// lands with #271), so every row is a direct insert.

async function makeOrganisation() {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `wi-activity-org-${randomUUID()}`,
        name: "WI Activity Organisation",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeOrganisation",
  );
}

async function makeWorkspace() {
  const organisation = await makeOrganisation();
  return requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        name: "WI Activity Workspace",
        slug: `wi-activity-ws-${randomUUID()}`,
        createdAt: new Date(),
        organisationId: organisation.id,
      })
      .returning(),
    "makeWorkspace",
  );
}

async function makeProject(workspaceId: string) {
  return requireRow(
    await db
      .insert(schema.projectTable)
      .values({
        workspaceId,
        slug: `wi-activity-project-${randomUUID()}`,
        name: "WI Activity Project",
      })
      .returning(),
    "makeProject",
  );
}

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

async function makeStateTemplate(workspaceId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeStateTemplate",
  );
}

async function makeState(projectId: string, stateTemplateId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState",
  );
}

/** A project plus every workspace-scoped row a work item needs, and one work item. */
async function makeWorkItemFixture() {
  const workspace = await makeWorkspace();
  const project = await makeProject(workspace.id);
  const type = await makeWorkItemType(workspace.id);
  const stateTemplate = await makeStateTemplate(workspace.id);
  const state = await makeState(project.id, stateTemplate.id);
  const now = new Date();
  const workItem = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        projectId: project.id,
        workspaceId: workspace.id,
        typeId: type.id,
        stateId: state.id,
        number: 1,
        key: `${project.slug}-1`,
        title: "A work item",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItem",
  );
  return { workspace, project, type, stateTemplate, state, workItem };
}

describe("activity -- composite FK (workspace_id, work_item_id) -> work_item (workspace_id, id)", () => {
  it("accepts a (workspace_id, work_item_id) pair that matches a real work item", async () => {
    const fixture = await makeWorkItemFixture();
    const [row] = await recordWorkItemActivity(db, [
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "system",
        verb: "created",
      },
    ]);
    expect(row?.workItemId).toBe(fixture.workItem.id);
  });

  it("rejects a work_item_id that does not exist at all", async () => {
    const fixture = await makeWorkItemFixture();
    await expect(
      recordWorkItemActivity(db, [
        {
          workspaceId: fixture.workspace.id,
          workItemId: randomUUID(),
          actorId: null,
          actorType: "system",
          verb: "created",
        },
      ]),
    ).rejects.toThrow();
  });

  // Decision log 2026-09-23, detail 1: this is the whole point of the composite FK over
  // a plain single-column one -- a `work_item_id` that IS real, but paired with a
  // `workspace_id` that is NOT that work item's own, must still be refused by the
  // database itself, not just by application code.
  it("rejects a real work_item_id paired with a workspace_id that is NOT that work item's own", async () => {
    const fixture = await makeWorkItemFixture();
    const otherWorkspace = await makeWorkspace();

    await expect(
      recordWorkItemActivity(db, [
        {
          workspaceId: otherWorkspace.id,
          workItemId: fixture.workItem.id,
          actorId: null,
          actorType: "system",
          verb: "created",
        },
      ]),
    ).rejects.toThrow();

    // Sanity: the real work item, with its OWN workspace, still succeeds -- proves the
    // rejection above is the composite FK's workspace/work-item mismatch, not some
    // unrelated NOT NULL/type error.
    await expect(
      recordWorkItemActivity(db, [
        {
          workspaceId: fixture.workspace.id,
          workItemId: fixture.workItem.id,
          actorId: null,
          actorType: "system",
          verb: "created",
        },
      ]),
    ).resolves.not.toThrow();
  });
});

describe("activity.visibility -- CHECK constraint, CA-7's fail-closed default", () => {
  it("accepts 'public' and 'internal'", async () => {
    const fixture = await makeWorkItemFixture();
    for (const visibility of ["public", "internal"] as const) {
      await db.execute(sql`
        INSERT INTO activity (id, workspace_id, work_item_id, actor_type, verb, visibility)
        VALUES (${randomUUID()}, ${fixture.workspace.id}, ${fixture.workItem.id}, 'system', 'created', ${visibility})
      `);
    }
    const rows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, fixture.workItem.id));
    expect(rows.map((r) => r.visibility).sort()).toEqual([
      "internal",
      "public",
    ]);
  });

  it("rejects a value outside public/internal", async () => {
    const fixture = await makeWorkItemFixture();
    await expect(
      db.execute(sql`
        INSERT INTO activity (id, workspace_id, work_item_id, actor_type, verb, visibility)
        VALUES (${randomUUID()}, ${fixture.workspace.id}, ${fixture.workItem.id}, 'system', 'created', 'draft')
      `),
    ).rejects.toThrow();
  });

  it("defaults to 'internal' when omitted (fails closed, CA-7)", async () => {
    const fixture = await makeWorkItemFixture();
    await db.execute(sql`
      INSERT INTO activity (id, workspace_id, work_item_id, actor_type, verb)
      VALUES (${randomUUID()}, ${fixture.workspace.id}, ${fixture.workItem.id}, 'system', 'a-completely-unmapped-verb')
    `);
    const [row] = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, fixture.workItem.id));
    expect(row?.visibility).toBe("internal");
  });
});

describe("recordWorkItemActivity -- CA-7 visibility resolution", () => {
  it("resolves known public verbs and fields to 'public'", async () => {
    const fixture = await makeWorkItemFixture();
    const rows = await recordWorkItemActivity(db, [
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "system",
        verb: "created",
      },
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "person",
        verb: "field_changed",
        field: "priority",
        oldValue: "low",
        newValue: "high",
      },
    ]);
    expect(rows.every((r) => r.visibility === "public")).toBe(true);
  });

  it("resolves an internal field (assignee) and an unmapped verb/field to 'internal'", async () => {
    const fixture = await makeWorkItemFixture();
    const rows = await recordWorkItemActivity(db, [
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "person",
        verb: "field_changed",
        field: "assignee",
        oldValue: null,
        newValue: "person-1",
      },
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "automation",
        verb: "something_not_in_ca7",
      },
    ]);
    expect(rows.every((r) => r.visibility === "internal")).toBe(true);
  });

  it("an explicit visibility always wins over the CA-7 default resolution", async () => {
    const fixture = await makeWorkItemFixture();
    const [row] = await recordWorkItemActivity(db, [
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "system",
        verb: "created", // normally public
        visibility: "internal",
      },
    ]);
    expect(row?.visibility).toBe("internal");
  });
});

describe("activity.seq -- monotonic tiebreak within one transaction", () => {
  it("assigns strictly increasing seq values, in insert order, for rows sharing one created_at", async () => {
    const fixture = await makeWorkItemFixture();
    const rows = await recordWorkItemActivity(db, [
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "system",
        verb: "created",
      },
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "system",
        verb: "field_changed",
        field: "title",
        oldValue: "A work item",
        newValue: "A renamed work item",
      },
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "system",
        verb: "field_changed",
        field: "priority",
        oldValue: null,
        newValue: "low",
      },
    ]);
    const seqs = rows.map((r) => BigInt(r.seq));
    expect(seqs).toHaveLength(3);
    const [first, second, third] = seqs;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("expected exactly three seq values");
    }
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
  });
});

describe("recordWorkItemActivity -- atomic with the caller's transaction", () => {
  it("a rolled-back transaction leaves no activity rows", async () => {
    const fixture = await makeWorkItemFixture();
    await expect(
      db.transaction(async (tx) => {
        await recordWorkItemActivity(tx, [
          {
            workspaceId: fixture.workspace.id,
            workItemId: fixture.workItem.id,
            actorId: null,
            actorType: "system",
            verb: "created",
          },
        ]);
        throw new Error("simulated failure after the activity insert");
      }),
    ).rejects.toThrow("simulated failure");

    const rows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, fixture.workItem.id));
    expect(rows).toHaveLength(0);
  });

  it("a committed transaction's activity rows are visible afterwards", async () => {
    const fixture = await makeWorkItemFixture();
    await db.transaction(async (tx) => {
      await recordWorkItemActivity(tx, [
        {
          workspaceId: fixture.workspace.id,
          workItemId: fixture.workItem.id,
          actorId: null,
          actorType: "system",
          verb: "created",
        },
      ]);
    });

    const rows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, fixture.workItem.id));
    expect(rows).toHaveLength(1);
  });
});

describe("diffWorkItemFieldChanges", () => {
  const context = {
    workspaceId: "ws-1",
    workItemId: "wi-1",
    actorId: "person-1",
    actorType: "person" as const,
  };

  it("emits one row per changed field named in the snapshot, and none for unchanged fields", () => {
    const rows = diffWorkItemFieldChanges(
      { title: "Old title", priority: "low", assigneeId: null },
      { title: "New title", priority: "low", assigneeId: "person-2" },
      context,
    );
    expect(rows).toHaveLength(2);
    const byField = new Map(rows.map((r) => [r.field, r]));
    expect(byField.get("title")).toMatchObject({
      verb: "field_changed",
      oldValue: "Old title",
      newValue: "New title",
    });
    expect(byField.get("assignee")).toMatchObject({
      verb: "field_changed",
      oldValue: null,
      newValue: "person-2",
    });
  });

  it("emits a 'transitioned' row (no field) when stateId changes, in addition to field diffs", () => {
    const rows = diffWorkItemFieldChanges(
      { stateId: "state-a" },
      { stateId: "state-b", priority: "high" },
      context,
    );
    const transitioned = rows.find((r) => r.verb === "transitioned");
    expect(transitioned).toMatchObject({
      oldValue: "state-a",
      newValue: "state-b",
    });
    expect(transitioned?.field).toBeUndefined();
    expect(rows.some((r) => r.field === "priority")).toBe(true);
  });

  it("skips a field absent from 'after' entirely, rather than treating it as cleared", () => {
    const rows = diffWorkItemFieldChanges(
      { title: "Unchanged elsewhere", priority: "low" },
      { priority: "high" },
      context,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "priority" });
  });
});
