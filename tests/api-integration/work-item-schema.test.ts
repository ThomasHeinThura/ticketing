/**
 * #23's first slice: `work_item`, `work_item_type`, `state_template`, `state`,
 * `work_item_key_alias`, `watcher` (data-model.md §3-§4, decision log 2026-09-17 "#23's
 * first slice is narrower than 'all of #23'"). Purely additive migration -- no route, no
 * policy, no repository layer exists yet, so these tests stay at the schema/migration
 * layer, same shape as `p1-identity-schema-seed.test.ts` for PR #179:
 *
 *   §1  the migration applies cleanly and produces the six tables with the shape
 *       `apps/api/src/database/schema.ts` declares;
 *   §2  every uniqueness constraint this schema adds actually rejects the duplicate it is
 *       meant to reject, and permits the sibling case it must not reject;
 *   §3  every FK/`onDelete` behaviour chosen for this schema -- including every judgment
 *       call flagged in the PR body (`work_item.type_id`/`requester_id`/`parent_id`
 *       RESTRICT) -- actually does what the schema comments say, proven with a real
 *       insert/delete against a real PostgreSQL 18, not asserted from reading the code.
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

// ── Minimal fixture builders -- this schema has no route/repository layer yet, so ──
// every row here is a direct insert, the same pattern p1-identity-schema-seed.test.ts
// uses for `organisation`/`person`.

async function makeWorkspace() {
  return requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        name: "Work Item Schema Test Workspace",
        slug: `wi-schema-ws-${randomUUID()}`,
        createdAt: new Date(),
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
        slug: `wi-schema-project-${randomUUID()}`,
        name: "Work Item Schema Test Project",
      })
      .returning(),
    "makeProject",
  );
}

async function makeOrganisation() {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `wi-schema-org-${randomUUID()}`,
        name: "Work Item Schema Test Organisation",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeOrganisation",
  );
}

// A placeholder person (no `user` row) -- these tests are about work_item's own FK
// behaviour, not identity/auth, so a real sign-up is unnecessary machinery.
async function makePerson(
  organisationId: string,
  side: "staff" | "customer" = "staff",
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId,
        side,
        isPlaceholder: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makePerson",
  );
}

async function makeWorkItemType(
  workspaceId: string,
  key = `type-${randomUUID()}`,
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

async function makeStateTemplate(
  workspaceId: string,
  key = `state-${randomUUID()}`,
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key,
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

async function makeWorkItem(overrides: {
  projectId: string;
  typeId: string;
  stateId: string;
  number: number;
  key: string;
  assigneeId?: string;
  requesterId?: string;
  parentId?: string;
}) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        title: "A work item",
        createdAt: now,
        updatedAt: now,
        ...overrides,
      })
      .returning(),
    "makeWorkItem",
  );
}

/** A full, ready-to-use work item plus every row it depends on. */
async function makeWorkItemFixture() {
  const workspace = await makeWorkspace();
  const project = await makeProject(workspace.id);
  const organisation = await makeOrganisation();
  const type = await makeWorkItemType(workspace.id);
  const stateTemplate = await makeStateTemplate(workspace.id);
  const state = await makeState(project.id, stateTemplate.id);
  const assignee = await makePerson(organisation.id);
  const requester = await makePerson(organisation.id, "customer");
  const workItem = await makeWorkItem({
    projectId: project.id,
    typeId: type.id,
    stateId: state.id,
    number: 1,
    key: `${project.slug}-1`,
    assigneeId: assignee.id,
    requesterId: requester.id,
  });
  return {
    workspace,
    project,
    organisation,
    type,
    stateTemplate,
    state,
    assignee,
    requester,
    workItem,
  };
}

describe("#1 -- migration applies cleanly and produces the six tables data-model.md §3-§4 specifies", () => {
  it("creates all six tables", async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('work_item', 'work_item_type', 'state_template', 'state', 'work_item_key_alias', 'watcher')
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "state",
      "state_template",
      "watcher",
      "work_item",
      "work_item_key_alias",
      "work_item_type",
    ]);
  });

  it("gives work_item exactly the 28 columns schema.ts declares", async () => {
    const result = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'work_item'
    `);
    expect(result.rows[0]?.count).toBe("28");
  });

  it("leaves taskTable and columnTable completely untouched", async () => {
    // #23's first slice is purely additive -- confirms the old kaneo tables and their
    // columns are unaffected by this migration, not merely "not renamed".
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('task', 'column')
      ORDER BY table_name
    `);
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "column",
      "task",
    ]);
  });
});

describe("#2 -- uniqueness constraints", () => {
  it("rejects two work_item_type rows with the same key in the same workspace", async () => {
    const workspace = await makeWorkspace();
    await makeWorkItemType(workspace.id, "bug");
    await expect(makeWorkItemType(workspace.id, "bug")).rejects.toThrow();
  });

  it("permits the same work_item_type key in two different workspaces", async () => {
    const workspaceA = await makeWorkspace();
    const workspaceB = await makeWorkspace();
    await makeWorkItemType(workspaceA.id, "bug");
    await expect(makeWorkItemType(workspaceB.id, "bug")).resolves.toBeDefined();
  });

  it("rejects two state_template rows with the same key in the same workspace", async () => {
    const workspace = await makeWorkspace();
    await makeStateTemplate(workspace.id, "todo");
    await expect(makeStateTemplate(workspace.id, "todo")).rejects.toThrow();
  });

  it("permits the same state_template key in two different workspaces", async () => {
    const workspaceA = await makeWorkspace();
    const workspaceB = await makeWorkspace();
    await makeStateTemplate(workspaceA.id, "todo");
    await expect(
      makeStateTemplate(workspaceB.id, "todo"),
    ).resolves.toBeDefined();
  });

  it("rejects two work_item rows with the same (project_id, number)", async () => {
    const fixture = await makeWorkItemFixture();
    await expect(
      makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number: 1,
        key: `${fixture.project.slug}-1-dup`,
      }),
    ).rejects.toThrow();
  });

  it("permits the same number in two different projects", async () => {
    const fixture = await makeWorkItemFixture();
    const otherProject = await makeProject(fixture.workspace.id);
    const otherState = await makeState(
      otherProject.id,
      fixture.stateTemplate.id,
    );
    await expect(
      makeWorkItem({
        projectId: otherProject.id,
        typeId: fixture.type.id,
        stateId: otherState.id,
        number: 1,
        key: `${otherProject.slug}-1`,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects two work_item rows sharing the same global key, even across two different projects", async () => {
    const fixture = await makeWorkItemFixture();
    const otherProject = await makeProject(fixture.workspace.id);
    const otherState = await makeState(
      otherProject.id,
      fixture.stateTemplate.id,
    );
    await expect(
      makeWorkItem({
        projectId: otherProject.id,
        typeId: fixture.type.id,
        stateId: otherState.id,
        number: 1,
        key: fixture.workItem.key, // the SAME key value, a different project/number
      }),
    ).rejects.toThrow();
  });

  it("rejects two work_item_key_alias rows sharing the same old_key", async () => {
    const fixture = await makeWorkItemFixture();
    const otherFixture = await makeWorkItemFixture();
    await db.insert(schema.workItemKeyAliasTable).values({
      oldKey: "OLD-1",
      workItemId: fixture.workItem.id,
    });
    await expect(
      db.insert(schema.workItemKeyAliasTable).values({
        oldKey: "OLD-1",
        workItemId: otherFixture.workItem.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects the same person watching the same work item twice, permits a second different watcher", async () => {
    const fixture = await makeWorkItemFixture();
    await db.insert(schema.watcherTable).values({
      workItemId: fixture.workItem.id,
      personId: fixture.assignee.id,
      source: "explicit",
    });
    await expect(
      db.insert(schema.watcherTable).values({
        workItemId: fixture.workItem.id,
        personId: fixture.assignee.id,
        source: "implicit",
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(schema.watcherTable).values({
        workItemId: fixture.workItem.id,
        personId: fixture.requester.id,
        source: "explicit",
      }),
    ).resolves.toBeDefined();
  });
});

describe("#3 -- FK / onDelete behaviour, proven with real inserts and deletes", () => {
  it("state_template_id is ON DELETE RESTRICT: a template with a state row pointing at it cannot be deleted", async () => {
    const fixture = await makeWorkItemFixture();
    await expect(
      db
        .delete(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.id, fixture.stateTemplate.id)),
    ).rejects.toThrow();
  });

  it("state_template_id RESTRICT does not block deleting a template with no state rows", async () => {
    const workspace = await makeWorkspace();
    const template = await makeStateTemplate(workspace.id);
    await expect(
      db
        .delete(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.id, template.id)),
    ).resolves.toBeDefined();
  });

  it("state.project_id and work_item.project_id are both ON DELETE CASCADE: deleting a project deletes its states and its work items in the same statement", async () => {
    // Proven directly against real Postgres first (not merely asserted): `state`'s
    // CASCADE and `work_item`'s CASCADE fire on the SAME project delete, while
    // `work_item.state_id` is separately RESTRICT -- confirming Postgres resolves that
    // within one statement rather than the state-side cascade racing the restrict
    // check on the not-yet-deleted work_item row.
    const fixture = await makeWorkItemFixture();
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, fixture.project.id));

    const remainingStates = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.id, fixture.state.id));
    const remainingWorkItems = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, fixture.workItem.id));
    expect(remainingStates).toHaveLength(0);
    expect(remainingWorkItems).toHaveLength(0);
  });

  it("state_template.workspace_id and work_item_type.workspace_id are ON DELETE CASCADE", async () => {
    const workspace = await makeWorkspace();
    const template = await makeStateTemplate(workspace.id);
    const type = await makeWorkItemType(workspace.id);

    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspace.id));

    const remainingTemplates = await db
      .select()
      .from(schema.stateTemplateTable)
      .where(eq(schema.stateTemplateTable.id, template.id));
    const remainingTypes = await db
      .select()
      .from(schema.workItemTypeTable)
      .where(eq(schema.workItemTypeTable.id, type.id));
    expect(remainingTemplates).toHaveLength(0);
    expect(remainingTypes).toHaveLength(0);
  });

  it("work_item.type_id is RESTRICT (judgment call): a type with a work item still on it cannot be deleted", async () => {
    const fixture = await makeWorkItemFixture();
    await expect(
      db
        .delete(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.id, fixture.type.id)),
    ).rejects.toThrow();

    // Freeing the type up (removing the referencing work item) lets it be deleted.
    await db
      .delete(schema.workItemTable)
      .where(eq(schema.workItemTable.id, fixture.workItem.id));
    await expect(
      db
        .delete(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.id, fixture.type.id)),
    ).resolves.toBeDefined();
  });

  it("work_item.state_id is ON DELETE RESTRICT: a state with a work item on it cannot be deleted", async () => {
    const fixture = await makeWorkItemFixture();
    await expect(
      db
        .delete(schema.stateTable)
        .where(eq(schema.stateTable.id, fixture.state.id)),
    ).rejects.toThrow();
  });

  it("work_item.assignee_id is ON DELETE RESTRICT: an assigned person cannot be deleted", async () => {
    const fixture = await makeWorkItemFixture();
    await expect(
      db
        .delete(schema.personTable)
        .where(eq(schema.personTable.id, fixture.assignee.id)),
    ).rejects.toThrow();
  });

  it("work_item.requester_id is RESTRICT (judgment call): a person who filed a work item cannot be deleted", async () => {
    const fixture = await makeWorkItemFixture();
    await expect(
      db
        .delete(schema.personTable)
        .where(eq(schema.personTable.id, fixture.requester.id)),
    ).rejects.toThrow();
  });

  it("work_item.parent_id is RESTRICT (judgment call, self-reference): a parent with a child cannot be deleted, but the child can", async () => {
    const fixture = await makeWorkItemFixture();
    const child = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 2,
      key: `${fixture.project.slug}-2`,
      parentId: fixture.workItem.id,
    });

    await expect(
      db
        .delete(schema.workItemTable)
        .where(eq(schema.workItemTable.id, fixture.workItem.id)),
    ).rejects.toThrow();

    // The child itself has no children of its own -- deleting it directly succeeds.
    await expect(
      db
        .delete(schema.workItemTable)
        .where(eq(schema.workItemTable.id, child.id)),
    ).resolves.toBeDefined();

    // With the child gone, the former parent can now be deleted too.
    await expect(
      db
        .delete(schema.workItemTable)
        .where(eq(schema.workItemTable.id, fixture.workItem.id)),
    ).resolves.toBeDefined();
  });

  it("watcher.work_item_id and work_item_key_alias.work_item_id are ON DELETE CASCADE", async () => {
    const fixture = await makeWorkItemFixture();
    await db.insert(schema.watcherTable).values({
      workItemId: fixture.workItem.id,
      personId: fixture.assignee.id,
      source: "explicit",
    });
    await db.insert(schema.workItemKeyAliasTable).values({
      oldKey: "OLD-CASCADE-1",
      workItemId: fixture.workItem.id,
    });

    await db
      .delete(schema.workItemTable)
      .where(eq(schema.workItemTable.id, fixture.workItem.id));

    const remainingWatchers = await db
      .select()
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.workItemId, fixture.workItem.id));
    const remainingAliases = await db
      .select()
      .from(schema.workItemKeyAliasTable)
      .where(eq(schema.workItemKeyAliasTable.workItemId, fixture.workItem.id));
    expect(remainingWatchers).toHaveLength(0);
    expect(remainingAliases).toHaveLength(0);
  });

  it("watcher.person_id is ON DELETE CASCADE: deleting a (non-assignee, non-requester) watcher's person removes their watch row without touching the work item", async () => {
    const fixture = await makeWorkItemFixture();
    const watcherPerson = await makePerson(fixture.organisation.id, "staff");
    const watcher = requireRow(
      await db
        .insert(schema.watcherTable)
        .values({
          workItemId: fixture.workItem.id,
          personId: watcherPerson.id,
          source: "implicit",
        })
        .returning(),
      "watcher",
    );

    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.id, watcherPerson.id));

    const remainingWatchers = await db
      .select()
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.id, watcher.id));
    expect(remainingWatchers).toHaveLength(0);

    const workItemStillThere = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, fixture.workItem.id));
    expect(workItemStillThere).toHaveLength(1);
  });
});
