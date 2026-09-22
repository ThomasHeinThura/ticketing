/**
 * Issue #192 (decision log 2026-09-22 "#192's tenant-attribution decision: Option A+D") --
 * the schema/migration slice only (migration `0062_fast_blob.sql`), no write path (#23's,
 * not built yet):
 *
 *   1. `work_item.workspace_id` -- a new, denormalised, NOT NULL `text` column, meant to be
 *      set from `project.workspace_id` at row-creation time. Anchored to the TRUE
 *      workspace of the item's own `project_id` via a composite FK
 *      `(workspace_id, project_id) -> project(workspace_id, id)`, so the denormalised
 *      value can never drift from the project it was copied from.
 *   2. `work_item_type` gets a new `UNIQUE (workspace_id, id)` constraint (it already had
 *      `UNIQUE (workspace_id, key)`), the composite-FK target for (3).
 *   3. `work_item.type_id`'s FK is rescoped from a plain single-column reference to a
 *      composite `(workspace_id, type_id) -> work_item_type(workspace_id, id)` -- the fix
 *      #192 itself asks for, closing the cross-TENANT half of #186 S2 (#191 O5): a
 *      `wsA`-scoped work item can no longer reference a `wsB`-scoped `work_item_type`.
 *   4. `workspace.organisation_id` -- a new, NOT NULL foreign key to `organisation`,
 *      backfilled in the migration's own SQL (see that file's comments for why a real
 *      backfill was needed here but not for `work_item.workspace_id`).
 *
 * Both new composite FKs on `work_item` use `ON UPDATE NO ACTION`, never `CASCADE` --
 * PR #191's own O1 finding (see `work-item-schema-integrity.test.ts`'s "#191 O1" describe
 * block for the original incident) proved that a composite FK whose referenced column set
 * includes a mutable, non-PK column can silently move a work item across a tenant boundary
 * if that keyword is `CASCADE`. Both FKs here reference `project.workspace_id` /
 * `work_item_type.workspace_id`, exactly that shape of column, so this file proves the same
 * defensive property for both, the same way "#191 O1" proved it for `state.project_id`.
 *
 * Kept in its own file rather than added to `work-item-schema-integrity.test.ts` or
 * `work-item-schema.test.ts`: this issue spans two tables (`workspace`, `work_item`)
 * neither of those files' names describe.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

// ── Minimal fixture builders -- same pattern as work-item-schema-integrity.test.ts ──

async function makeOrganisation(isInternal = false) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `tenant-attr-org-${randomUUID()}`,
        name: "Tenant Attribution Test Organisation",
        isInternal,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeOrganisation",
  );
}

async function makeWorkspace(organisationId?: string) {
  const organisation = organisationId
    ? { id: organisationId }
    : await makeOrganisation();
  return requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        name: "Tenant Attribution Test Workspace",
        slug: `tenant-attr-ws-${randomUUID()}`,
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
        slug: `tenant-attr-project-${randomUUID()}`,
        name: "Tenant Attribution Test Project",
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
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState",
  );
}

/** A project plus every workspace-scoped row it needs to host a work item. */
async function makeProjectFixture() {
  const workspace = await makeWorkspace();
  const project = await makeProject(workspace.id);
  const type = await makeWorkItemType(workspace.id);
  const stateTemplate = await makeStateTemplate(workspace.id);
  const state = await makeState(project.id, stateTemplate.id);
  return { workspace, project, type, stateTemplate, state };
}

/** Raw-SQL work_item insert -- lets a test supply a workspace_id/type_id combination
 * Drizzle's own `.insert()` helper (which infers `workspaceId` from the project the same
 * way #23's real write path is specified to) cannot easily be made to send. */
async function rawInsertWorkItem(values: {
  projectId: string;
  workspaceId: string;
  typeId: string;
  stateId: string;
  number: number;
  key: string;
}) {
  return db.execute(sql`
    INSERT INTO work_item (
      id, project_id, workspace_id, type_id, number, key, title, state_id,
      created_at, updated_at
    ) VALUES (
      ${randomUUID()}, ${values.projectId}, ${values.workspaceId}, ${values.typeId},
      ${values.number}, ${values.key}, 'A work item', ${values.stateId}, now(), now()
    )
  `);
}

describe("#192 -- work_item.workspace_id is anchored to its own project's TRUE workspace_id", () => {
  it("rejects a workspace_id that does not match project_id's own workspace", async () => {
    const fixture = await makeProjectFixture();
    const otherWorkspace = await makeWorkspace();

    await expect(
      rawInsertWorkItem({
        projectId: fixture.project.id, // belongs to fixture.workspace...
        workspaceId: otherWorkspace.id, // ...but this claims a DIFFERENT workspace
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number: 1,
        key: `${fixture.project.slug}-1`,
      }),
    ).rejects.toThrow();
  });

  it("permits a workspace_id that matches project_id's own workspace", async () => {
    const fixture = await makeProjectFixture();

    await expect(
      rawInsertWorkItem({
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id, // the TRUE workspace of this project
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number: 1,
        key: `${fixture.project.slug}-1`,
      }),
    ).resolves.toBeDefined();
  });
});

describe("#192 -- work_item.type_id is pinned to a work_item_type in THIS item's own workspace (closes #186 S2's cross-tenant half, #191 O5)", () => {
  it("rejects a type_id belonging to a DIFFERENT workspace, even with a correctly-matching workspace_id", async () => {
    const fixture = await makeProjectFixture();
    const otherWorkspace = await makeWorkspace();
    const otherType = await makeWorkItemType(otherWorkspace.id);

    // Proves the fix is specifically about type_id's OWN workspace, not merely about
    // work_item.workspace_id being internally consistent with project_id (the previous
    // describe block's own concern): workspace_id here correctly names this item's real
    // workspace, and type_id is otherwise a perfectly real, existing work_item_type row --
    // just one that belongs to a DIFFERENT workspace's catalogue. Before #192, nothing in
    // the schema could see this at all (`work_item` carried no `workspace_id` of its own to
    // compare against `work_item_type.workspace_id`).
    await expect(
      rawInsertWorkItem({
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id, // correct for this item's own project
        typeId: otherType.id, // ...but this type belongs to a DIFFERENT workspace
        stateId: fixture.state.id,
        number: 1,
        key: `${fixture.project.slug}-1`,
      }),
    ).rejects.toThrow();
  });

  it("permits a type_id belonging to the SAME workspace", async () => {
    const fixture = await makeProjectFixture();
    const secondType = await makeWorkItemType(fixture.workspace.id);

    await expect(
      rawInsertWorkItem({
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id,
        typeId: secondType.id, // a second, but same-workspace, type
        stateId: fixture.state.id,
        number: 1,
        key: `${fixture.project.slug}-1`,
      }),
    ).resolves.toBeDefined();
  });
});

describe("#192 -- the two new composite FKs are ON UPDATE NO ACTION, never CASCADE (#191 O1's precedent applied here)", () => {
  it("rejects UPDATE work_item_type SET workspace_id -- it must not silently re-scope a type still referenced by a work item in its OLD workspace", async () => {
    // The exact #191 O1 shape, replayed against THIS migration's own new FK: the
    // referenced column set of `work_item(workspace_id, type_id) -> work_item_type
    // (workspace_id, id)` includes `work_item_type.workspace_id`, which is mutable (no
    // route changes it today, but nothing at the DB level prevents a direct UPDATE
    // either). If `onUpdate` here were `"cascade"` instead of `"no action"`, this
    // statement would silently rewrite the referencing work_item's own `workspace_id`
    // too -- moving it across a tenant boundary with no check, the identical failure
    // mode O1 found and fixed for `state.project_id`.
    const fixture = await makeProjectFixture();
    await rawInsertWorkItem({
      projectId: fixture.project.id,
      workspaceId: fixture.workspace.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });
    const otherWorkspace = await makeWorkspace();

    await expect(
      db
        .update(schema.workItemTypeTable)
        .set({ workspaceId: otherWorkspace.id })
        .where(eq(schema.workItemTypeTable.id, fixture.type.id)),
    ).rejects.toThrow();

    // The work item's own workspace_id/type_id must be completely unchanged -- the
    // rejected UPDATE must not have partially applied anywhere.
    const [reloadedType] = await db
      .select()
      .from(schema.workItemTypeTable)
      .where(eq(schema.workItemTypeTable.id, fixture.type.id));
    expect(reloadedType?.workspaceId).toBe(fixture.workspace.id);
  });

  it("rejects UPDATE project SET workspace_id -- it must not silently re-project a project still referenced by a work item in its OLD workspace", async () => {
    // Same shape again, this time against `work_item(workspace_id, project_id) ->
    // project(workspace_id, id)` -- the FK that anchors the denormalised `workspace_id`
    // column to the truth. `project.workspace_id` is genuinely mutable at the DB level.
    const fixture = await makeProjectFixture();
    await rawInsertWorkItem({
      projectId: fixture.project.id,
      workspaceId: fixture.workspace.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });
    const otherWorkspace = await makeWorkspace();

    await expect(
      db
        .update(schema.projectTable)
        .set({ workspaceId: otherWorkspace.id })
        .where(eq(schema.projectTable.id, fixture.project.id)),
    ).rejects.toThrow();

    const [reloadedProject] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, fixture.project.id));
    expect(reloadedProject?.workspaceId).toBe(fixture.workspace.id);
  });
});

describe("#192 -- work_item_type now has UNIQUE (workspace_id, id) alongside its existing UNIQUE (workspace_id, key)", () => {
  it("both unique constraints exist in the catalog", async () => {
    // `work_item_type_workspace_key_unique` is a `uniqueIndex()` in schema.ts (a plain
    // unique index, no `pg_constraint` row), while the new `work_item_type_workspace_id_id_
    // unique` is a `unique()` table constraint (which Postgres backs with an index too) --
    // `pg_indexes` covers both forms, `pg_constraint` alone would miss the first.
    const result = await db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'work_item_type'
      ORDER BY indexname
    `);
    const names = result.rows.map((row) => row.indexname);
    expect(names).toContain("work_item_type_workspace_key_unique");
    expect(names).toContain("work_item_type_workspace_id_id_unique");
  });
});

describe("#192 -- workspace.organisation_id is NOT NULL and foreign-keys to a real organisation row", () => {
  it("rejects an explicit NULL even via a raw INSERT that bypasses Drizzle's own required-field typing", async () => {
    await expect(
      db.execute(sql`
        INSERT INTO workspace (id, name, slug, organisation_id, created_at)
        VALUES (${randomUUID()}, 'No Org Workspace', ${`no-org-${randomUUID()}`}, NULL, now())
      `),
    ).rejects.toThrow();
  });

  it("rejects an organisation_id that names no real organisation row", async () => {
    await expect(
      db.execute(sql`
        INSERT INTO workspace (id, name, slug, organisation_id, created_at)
        VALUES (${randomUUID()}, 'Fake Org Workspace', ${`fake-org-${randomUUID()}`}, ${randomUUID()}, now())
      `),
    ).rejects.toThrow();
  });

  it("permits an organisation_id that names a real organisation row", async () => {
    const organisation = await makeOrganisation();
    const workspace = await makeWorkspace(organisation.id);
    expect(workspace.organisationId).toBe(organisation.id);
  });

  it("ON DELETE RESTRICT: an organisation with a workspace still on it cannot be deleted", async () => {
    const organisation = await makeOrganisation();
    await makeWorkspace(organisation.id);

    await expect(
      db
        .delete(schema.organisationTable)
        .where(eq(schema.organisationTable.id, organisation.id)),
    ).rejects.toThrow();
  });
});

describe("#192 -- the migration's own internal-organisation backfill is idempotent", () => {
  it("does not create a second is_internal row when one already exists", async () => {
    // The migration's backfill statement (0062_fast_blob.sql) is `WHERE NOT EXISTS
    // (SELECT 1 FROM organisation WHERE is_internal = true)` -- re-running the exact same
    // statement here (simulating a second migration application, or a concurrent replica)
    // must stay a no-op against an already-seeded internal organisation, the same
    // guarantee `organisation_is_internal_unique` (PR #179) gives the application-level
    // seed in `seed-internal-organisation.ts`.
    await makeOrganisation(true); // an internal organisation already exists

    await expect(
      db.execute(sql`
        INSERT INTO organisation (id, key, name, is_internal, created_at, updated_at)
        SELECT gen_random_uuid()::text, 'internal', 'Internal', true, now(), now()
        WHERE NOT EXISTS (SELECT 1 FROM organisation WHERE is_internal = true)
      `),
    ).resolves.toBeDefined();

    const result = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM organisation WHERE is_internal = true
    `);
    expect(result.rows[0]?.count).toBe("1");
  });
});
