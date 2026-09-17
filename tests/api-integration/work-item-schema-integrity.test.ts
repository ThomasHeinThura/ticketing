/**
 * Issue #186 — three integrity gaps in #23's first-slice work-item schema (PR #185),
 * found by the mandatory Opus security review before any route/write-path exists against
 * it (`docs/07-planning/security-reviews/185-work-item-schema.md`). Same shape as
 * `work-item-schema.test.ts` and `p1-identity-schema-seed.test.ts`: real Postgres inserts
 * and updates, not mocks, since these are all DB-level constraints/triggers.
 *
 *   S1  `work_item.customer_visibility` is now `NOT NULL DEFAULT 'private'` — a bare
 *       insert defaults to the safe value, and the column genuinely refuses NULL even
 *       when a raw INSERT tries to force it (Drizzle's own insert path never sends NULL
 *       for a column with a JS-level default, so this is proven with `db.execute(sql\`...\`)`,
 *       not `db.insert()`).
 *   S2  `work_item.state_id` and `work_item.parent_id` are now pinned to the item's own
 *       `project_id` via composite FKs (`(project_id, state_id) -> state(project_id, id)`,
 *       `(project_id, parent_id) -> work_item(project_id, id)`) — a cross-project
 *       reference of either kind, previously accepted, is now rejected; the same-project
 *       case that must keep working still does.
 *   S5  A trigger on `work_item_key_alias` rejects an `old_key` that collides with any
 *       row currently present in `work_item.key` (regardless of `archived_at`/
 *       `deleted_at` — `work_item.key`'s own unique index does not exclude those either),
 *       on both INSERT and UPDATE OF old_key. A non-colliding alias still inserts fine.
 *
 * `work_item.type_id` vs `work_item_type.workspace_id` (the other half of S2) is
 * deliberately NOT covered here — it is an explicitly accepted, documented gap (see the
 * `typeId` column comment in `schema.ts` and the PR body's "Not done"), not a fix, so
 * there is nothing to regression-test yet.
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

// ── Minimal fixture builders -- same pattern as work-item-schema.test.ts (this ──
// schema still has no route/repository layer, so every row here is a direct insert).

async function makeWorkspace() {
  return requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        name: "WI Integrity Test Workspace",
        slug: `wi-integrity-ws-${randomUUID()}`,
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
        slug: `wi-integrity-project-${randomUUID()}`,
        name: "WI Integrity Test Project",
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

async function makeWorkItem(overrides: {
  projectId: string;
  typeId: string;
  stateId: string;
  number: number;
  key: string;
  parentId?: string;
  customerVisibility?: string;
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

/** A project plus every workspace-scoped row it needs to host a work item. */
async function makeProjectFixture() {
  const workspace = await makeWorkspace();
  const project = await makeProject(workspace.id);
  const type = await makeWorkItemType(workspace.id);
  const stateTemplate = await makeStateTemplate(workspace.id);
  const state = await makeState(project.id, stateTemplate.id);
  return { workspace, project, type, stateTemplate, state };
}

describe("#186 S1 -- work_item.customer_visibility is NOT NULL DEFAULT 'private'", () => {
  it("defaults to 'private' when not specified", async () => {
    const fixture = await makeProjectFixture();
    const workItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });
    expect(workItem.customerVisibility).toBe("private");
  });

  it("permits the explicit 'organisation' value", async () => {
    const fixture = await makeProjectFixture();
    const workItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
      customerVisibility: "organisation",
    });
    expect(workItem.customerVisibility).toBe("organisation");
  });

  it("rejects an explicit NULL even via a raw INSERT that bypasses Drizzle's own default", async () => {
    // db.insert() never sends NULL for a column with a JS-level `.default(...)` -- it
    // omits the column and lets Postgres apply the column default instead. To prove the
    // column itself refuses NULL (not just that the ORM happens not to send one), this
    // forces the value directly with a raw INSERT.
    const fixture = await makeProjectFixture();
    await expect(
      db.execute(sql`
        INSERT INTO work_item (
          project_id, type_id, number, key, title, state_id, customer_visibility
        ) VALUES (
          ${fixture.project.id}, ${fixture.type.id}, 1, ${`${fixture.project.slug}-1`},
          'A work item', ${fixture.state.id}, NULL
        )
      `),
    ).rejects.toThrow();
  });
});

describe("#186 S2 -- work_item.state_id is pinned to the item's own project_id", () => {
  it("rejects a state_id belonging to a DIFFERENT project", async () => {
    const fixture = await makeProjectFixture();
    const otherProject = await makeProject(fixture.workspace.id);
    const otherState = await makeState(
      otherProject.id,
      fixture.stateTemplate.id,
    );

    await expect(
      makeWorkItem({
        projectId: fixture.project.id, // this item's OWN project...
        typeId: fixture.type.id,
        stateId: otherState.id, // ...but a state that belongs to a DIFFERENT project
        number: 1,
        key: `${fixture.project.slug}-1`,
      }),
    ).rejects.toThrow();
  });

  it("permits a state_id belonging to the SAME project", async () => {
    const fixture = await makeProjectFixture();
    await expect(
      makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id, // same project as the work item
        number: 1,
        key: `${fixture.project.slug}-1`,
      }),
    ).resolves.toBeDefined();
  });
});

describe("#186 S2 -- work_item.parent_id is pinned to the item's own project_id", () => {
  it("rejects a parent_id belonging to a DIFFERENT project", async () => {
    const fixture = await makeProjectFixture();
    const otherProject = await makeProject(fixture.workspace.id);
    const otherState = await makeState(
      otherProject.id,
      fixture.stateTemplate.id,
    );
    const otherProjectParent = await makeWorkItem({
      projectId: otherProject.id,
      typeId: fixture.type.id,
      stateId: otherState.id,
      number: 1,
      key: `${otherProject.slug}-1`,
    });

    await expect(
      makeWorkItem({
        projectId: fixture.project.id, // this item's OWN project...
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number: 1,
        key: `${fixture.project.slug}-1`,
        parentId: otherProjectParent.id, // ...but a parent in a DIFFERENT project
      }),
    ).rejects.toThrow();
  });

  it("permits a parent_id belonging to the SAME project", async () => {
    const fixture = await makeProjectFixture();
    const parent = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });

    await expect(
      makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number: 2,
        key: `${fixture.project.slug}-2`,
        parentId: parent.id, // same project as the child
      }),
    ).resolves.toBeDefined();
  });
});

describe("#186 S5 -- work_item_key_alias.old_key cannot collide with a currently-live work_item.key", () => {
  it("rejects an INSERT whose old_key equals a live work_item.key", async () => {
    const fixture = await makeProjectFixture();
    const workItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });

    // A different work item's alias claims the FIRST item's live key as its old_key.
    const otherWorkItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 2,
      key: `${fixture.project.slug}-2`,
    });

    await expect(
      db.insert(schema.workItemKeyAliasTable).values({
        oldKey: workItem.key, // collides with a LIVE work_item.key
        workItemId: otherWorkItem.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects an UPDATE that changes old_key to collide with a live work_item.key", async () => {
    const fixture = await makeProjectFixture();
    const workItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });
    const otherWorkItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 2,
      key: `${fixture.project.slug}-2`,
    });
    const alias = requireRow(
      await db
        .insert(schema.workItemKeyAliasTable)
        .values({
          oldKey: `non-colliding-${randomUUID()}`,
          workItemId: otherWorkItem.id,
        })
        .returning(),
      "alias",
    );

    await expect(
      db
        .update(schema.workItemKeyAliasTable)
        .set({ oldKey: workItem.key })
        .where(eq(schema.workItemKeyAliasTable.id, alias.id)),
    ).rejects.toThrow();
  });

  it("still rejects a collision against a SOFT-DELETED work item's key (deleted_at set, row still present)", async () => {
    // #186 S5's own reasoning: work_item.key's unique index does not exclude
    // archived/soft-deleted rows, so "currently-live" here means "any row present in
    // work_item.key" -- exactly the case a cross-project move + key reuse produces.
    const fixture = await makeProjectFixture();
    const deletedWorkItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, deletedWorkItem.id));

    const otherWorkItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 2,
      key: `${fixture.project.slug}-2`,
    });

    await expect(
      db.insert(schema.workItemKeyAliasTable).values({
        oldKey: deletedWorkItem.key,
        workItemId: otherWorkItem.id,
      }),
    ).rejects.toThrow();
  });

  it("permits an INSERT whose old_key does not collide with any live work_item.key", async () => {
    const fixture = await makeProjectFixture();
    const workItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });

    await expect(
      db.insert(schema.workItemKeyAliasTable).values({
        oldKey: `genuinely-retired-${randomUUID()}`,
        workItemId: workItem.id,
      }),
    ).resolves.toBeDefined();
  });
});
