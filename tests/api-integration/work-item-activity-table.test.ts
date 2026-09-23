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
import { deleteAccountData } from "../../apps/api/src/user/controllers/delete-account-data";
import {
  type DiffActivityContext,
  diffWorkItemFieldChanges,
  recordWorkItemActivity,
  resolveVisibility,
} from "../../apps/api/src/work-item/activity";
import deleteWorkspace from "../../apps/api/src/workspace/controllers/delete-workspace";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

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

/**
 * Every workspace-scoped row a work item needs, and one work item, inside an EXISTING
 * workspace -- factored out so S1's delete tests can reuse it against a workspace built
 * by the real `createWorkspaceMember` fixture (owner membership and all), not just the
 * bare workspace `makeWorkspace` inserts directly.
 */
async function makeWorkItemInWorkspace(workspaceId: string) {
  const project = await makeProject(workspaceId);
  const type = await makeWorkItemType(workspaceId);
  const stateTemplate = await makeStateTemplate(workspaceId);
  const state = await makeState(project.id, stateTemplate.id);
  const now = new Date();
  const workItem = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        projectId: project.id,
        workspaceId,
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
  return { project, type, stateTemplate, state, workItem };
}

/** A project plus every workspace-scoped row a work item needs, and one work item. */
async function makeWorkItemFixture() {
  const workspace = await makeWorkspace();
  const rest = await makeWorkItemInWorkspace(workspace.id);
  return { workspace, ...rest };
}

// Migration 0066's rename step: `ALTER TABLE "activity" RENAME TO "task_activity"` only
// renames the table itself -- every constraint and index name is an independent catalog
// string that survives untouched unless renamed explicitly. Left unrenamed, any of them
// collides with the new `activity` table's own auto-named objects below (e.g. the new
// table's primary key would want the name `activity_pkey`, which the OLD table's
// still-attached primary key already holds, so Postgres silently falls back to
// `activity_pkey1` for the new one -- a working-looking migration with a landmine name).
// This describe asserts the migration actually renamed every one of them, not just the
// ones an earlier draft of it happened to think of (a prior round of this migration
// missed the primary key and the per-column `NOT NULL` constraints Postgres 18
// catalogues, found only by querying `pg_constraint` against a database migrated to this
// migration's own parent head).
describe("migration 0066 -- no activity_-named catalog object survives on task_activity", () => {
  it("no constraint or index on task_activity starts with activity_", async () => {
    const constraintRows = await db.execute(sql`
      select conname from pg_constraint
      where conrelid = 'task_activity'::regclass
        and conname like 'activity\\_%'
    `);
    expect(constraintRows.rows).toHaveLength(0);

    const indexRows = await db.execute(sql`
      select indexname from pg_indexes
      where tablename = 'task_activity'
        and indexname like 'activity\\_%'
    `);
    expect(indexRows.rows).toHaveLength(0);
  });

  it("the new activity table's own primary key is exactly activity_pkey (no _1 collision suffix)", async () => {
    const pkeyRows = await db.execute(sql`
      select conname from pg_constraint
      where conrelid = 'activity'::regclass
        and contype = 'p'
    `);
    expect(pkeyRows.rows).toHaveLength(1);
    expect(pkeyRows.rows[0]).toMatchObject({ conname: "activity_pkey" });
  });
});

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

// S1 (BLOCKING), PR #275's mandatory Opus 5.5 review: the composite FK used to be
// `ON DELETE RESTRICT`, on the false premise that work items are never hard-deleted.
// They ARE, by cascade, on every real tenant-deletion path -- so a single activity row
// made the workspace/account that owns it permanently undeletable. Fixed to
// `ON DELETE CASCADE` (decision log 2026-09-23, "Activity addendum"). These tests run
// through the REAL controllers (`deleteWorkspace`, `deleteAccountData`), not raw SQL --
// exactly what the review's own reproduction did, and what would still fail if `RESTRICT`
// were still in place.
describe("activity -- ON DELETE CASCADE (S1): real tenant-deletion paths succeed with activity rows present", () => {
  it("deleteWorkspace() succeeds on a workspace with work items that have activity rows, and removes those rows", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { workItem } = await makeWorkItemInWorkspace(owner.workspace.id);
    await recordWorkItemActivity(db, [
      {
        workspaceId: owner.workspace.id,
        workItemId: workItem.id,
        actorId: null,
        actorType: "system",
        verb: "created",
      },
    ]);

    const deleted = await deleteWorkspace(owner.workspace.id, randomUUID());
    expect(deleted?.id).toBe(owner.workspace.id);

    const remainingWorkspaces = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, owner.workspace.id));
    expect(remainingWorkspaces).toHaveLength(0);

    const remainingActivity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, workItem.id));
    expect(remainingActivity).toHaveLength(0);
  });

  it("deleteAccountData() succeeds for a sole owner whose workspace has work items with activity rows", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { workItem } = await makeWorkItemInWorkspace(owner.workspace.id);
    await recordWorkItemActivity(db, [
      {
        workspaceId: owner.workspace.id,
        workItemId: workItem.id,
        actorId: null,
        actorType: "system",
        verb: "created",
      },
    ]);

    await expect(deleteAccountData(owner.user.id)).resolves.not.toThrow();

    const remainingWorkspaces = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, owner.workspace.id));
    expect(remainingWorkspaces).toHaveLength(0);

    const remainingActivity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, workItem.id));
    expect(remainingActivity).toHaveLength(0);
  });

  it("activity in a DIFFERENT workspace is untouched by deleting the first one", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { workItem } = await makeWorkItemInWorkspace(owner.workspace.id);
    await recordWorkItemActivity(db, [
      {
        workspaceId: owner.workspace.id,
        workItemId: workItem.id,
        actorId: null,
        actorType: "system",
        verb: "created",
      },
    ]);

    const otherFixture = await makeWorkItemFixture();
    await recordWorkItemActivity(db, [
      {
        workspaceId: otherFixture.workspace.id,
        workItemId: otherFixture.workItem.id,
        actorId: null,
        actorType: "system",
        verb: "created",
      },
    ]);

    await deleteWorkspace(owner.workspace.id, randomUUID());

    const untouchedActivity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, otherFixture.workItem.id));
    expect(untouchedActivity).toHaveLength(1);

    const untouchedWorkItem = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, otherFixture.workItem.id));
    expect(untouchedWorkItem).toHaveLength(1);
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
        verb: "updated",
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
        verb: "updated",
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

  it("an explicit visibility: 'internal' always wins over the CA-7 default resolution", async () => {
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

// D1 (BLOCKING regression at 635fd29), PR #275's mandatory Opus 5.5 delta-confirmation
// review: the S2 fix's own last line -- `return CA7_PUBLIC_VERBS.has(input.verb) ?
// "public" : "internal"` -- ignored `field` for every verb except `updated`, so a PUBLIC
// verb with an INTERNAL field (e.g. `{verb: "created", field: "assignee"}`) resolved
// `public`. Per AGENTS.md's "stop patching and change altitude" (this is the third round
// finding the same class of fault -- fail-open, ad-hoc branching -- in this one
// function): this test is EXHAUSTIVE and TABLE-DRIVEN over the full `(verb, field)`
// cross product CA-7 names, and computes its own expected result INDEPENDENTLY of
// `activity.ts`'s internals -- it never imports `PUBLIC_PAIRS` or
// `CONDITIONAL_PUBLIC_PAIRS`, only `resolveVisibility` itself, so a future change that
// adds a public pair to the allowlist without a matching update HERE fails this test,
// rather than passing vacuously because both sides agree by construction.
describe("resolveVisibility -- D1: exhaustive (verb, field) cross product, computed independently of the allowlist", () => {
  // CA-7's own vocabulary (`docs/03-features/comments-and-activity.md`), transcribed a
  // SECOND time, independently of `activity.ts`'s allowlist -- see `resolveVisibility`'s
  // own comment for the verbatim CA-7 quote both this list and that allowlist are
  // checked against.
  const VERBS_NAMED_BY_CA7 = [
    "created",
    "transitioned",
    "reopened",
    "resolved",
    "escalated",
    "attachment.added",
    "updated",
  ];
  const FIELDS_NAMED_BY_CA7 = [
    "priority",
    "due_date",
    "title",
    "description",
    "assignee",
    "watcher",
    "label",
    "custom_field",
    "estimate",
    "cycle",
    "module",
    "relation",
    "parent",
    "time_entry",
    "sla_pause",
  ];
  // A few verbs/fields CA-7 does NOT name at all, plus case/space variants of ones it
  // does -- every one of these must resolve `internal` (CA-7: "an unmapped verb or field
  // is `internal`"; a case/space variant is a DIFFERENT string, hence also unmapped).
  const UNKNOWN_VERBS = [
    "deleted",
    "watcher.added",
    "custom_field.updated",
    "Created",
    "UPDATED",
    " updated",
  ];
  const UNKNOWN_FIELDS = [
    "unknown_field",
    "Priority",
    "priority ",
    " title",
    "Assignee",
  ];

  /**
   * CA-7's UNCONDITIONAL rule, re-derived independently here (never calling into
   * `activity.ts`): a bare named verb with NO field is public; `updated` with one of the
   * four named public fields is public; everything else is internal for this
   * derivation -- `attachment.added` is deliberately excluded here even with a null
   * field, because CA-7 makes it CONDITIONAL, not unconditional (its own conditional
   * override path is exercised separately, in the describe below).
   */
  function expectedUnconditionalVisibility(
    verb: string,
    field: string | null,
  ): "public" | "internal" {
    const BARE_PUBLIC_VERBS = [
      "created",
      "transitioned",
      "reopened",
      "resolved",
      "escalated",
    ];
    const PUBLIC_UPDATED_FIELDS = [
      "priority",
      "due_date",
      "title",
      "description",
    ];
    if (field === null) {
      return BARE_PUBLIC_VERBS.includes(verb) ? "public" : "internal";
    }
    return verb === "updated" && PUBLIC_UPDATED_FIELDS.includes(field)
      ? "public"
      : "internal";
  }

  const allVerbs = [...VERBS_NAMED_BY_CA7, ...UNKNOWN_VERBS];
  const allFieldsIncludingNull: Array<string | null> = [
    null,
    ...FIELDS_NAMED_BY_CA7,
    ...UNKNOWN_FIELDS,
  ];

  const cases = allVerbs.flatMap((verb) =>
    allFieldsIncludingNull.map((field) => ({ verb, field })),
  );

  it.each(cases)(
    "resolves { verb: $verb, field: $field } to exactly what CA-7 says, no more and no less",
    ({ verb, field }) => {
      const expected = expectedUnconditionalVisibility(verb, field);
      expect(
        resolveVisibility({
          workspaceId: "ws-1",
          workItemId: "wi-1",
          actorId: null,
          actorType: "system",
          verb,
          field: field ?? undefined,
        }),
      ).toBe(expected);
    },
  );

  // Opus's own four D1 reproduction inputs, named explicitly rather than left to be
  // found only inside the cross product above -- each was `public` at 635fd29 and must
  // be `internal`.
  it.each([
    { verb: "created", field: "assignee" },
    { verb: "escalated", field: "assignee" },
    { verb: "resolved", field: "custom_field" },
    { verb: "transitioned", field: "watcher" },
  ])(
    "D1's own reproduction case { verb: $verb, field: $field } resolves internal",
    ({ verb, field }) => {
      expect(
        resolveVisibility({
          workspaceId: "ws-1",
          workItemId: "wi-1",
          actorId: null,
          actorType: "system",
          verb,
          field,
        }),
      ).toBe("internal");
    },
  );
});

// D2/D3 (NON-BLOCKING, same delta-confirmation review), the override half of the same
// model: "internal" may always be requested. "public" may be requested only when the
// pair is already public (D2 -- a no-op, no longer throws) or is one of the two
// CONDITIONAL pairs CA-7 itself names (D3 -- tightened from the previous round's
// verb-only/field-only check, which also wrongly accepted `{attachment.added, assignee}`
// and `{deleted, custom_field}`). Anything else asking for `public` still throws.
describe("resolveVisibility -- override: D2 (no-op public is accepted) and D3 (conditional allowlist tightened)", () => {
  it("D2: visibility: 'public' on an already-public bare verb is a no-op, not a throw", () => {
    expect(
      resolveVisibility({
        workspaceId: "ws-1",
        workItemId: "wi-1",
        actorId: null,
        actorType: "system",
        verb: "created",
        visibility: "public",
      }),
    ).toBe("public");
  });

  it("D2: visibility: 'public' on an already-public updated/field pair is a no-op, not a throw", () => {
    expect(
      resolveVisibility({
        workspaceId: "ws-1",
        workItemId: "wi-1",
        actorId: null,
        actorType: "system",
        verb: "updated",
        field: "priority",
        visibility: "public",
      }),
    ).toBe("public");
  });

  it("D3: attachment.added WITH a field no longer qualifies for the conditional override", () => {
    expect(() =>
      resolveVisibility({
        workspaceId: "ws-1",
        workItemId: "wi-1",
        actorId: null,
        actorType: "person",
        verb: "attachment.added",
        field: "assignee",
        visibility: "public",
      }),
    ).toThrow(/not allowed/);
  });

  it("D3: a non-'updated' verb carrying field 'custom_field' no longer qualifies for the conditional override", () => {
    expect(() =>
      resolveVisibility({
        workspaceId: "ws-1",
        workItemId: "wi-1",
        actorId: null,
        actorType: "person",
        verb: "deleted",
        field: "custom_field",
        visibility: "public",
      }),
    ).toThrow(/not allowed/);
  });

  it("attachment.added with NO field still qualifies for the conditional override", () => {
    expect(
      resolveVisibility({
        workspaceId: "ws-1",
        workItemId: "wi-1",
        actorId: null,
        actorType: "person",
        verb: "attachment.added",
        visibility: "public",
      }),
    ).toBe("public");
  });

  it("updated/custom_field still qualifies for the conditional override", () => {
    expect(
      resolveVisibility({
        workspaceId: "ws-1",
        workItemId: "wi-1",
        actorId: null,
        actorType: "person",
        verb: "updated",
        field: "custom_field",
        visibility: "public",
      }),
    ).toBe("public");
  });

  it("throws for a genuine escalation attempt (an internal pair asking for public)", () => {
    expect(() =>
      resolveVisibility({
        workspaceId: "ws-1",
        workItemId: "wi-1",
        actorId: null,
        actorType: "person",
        verb: "updated",
        field: "assignee",
        visibility: "public",
      }),
    ).toThrow(/not allowed/);
  });

  it("visibility: 'internal' is always honoured, regardless of verb/field", () => {
    expect(
      resolveVisibility({
        workspaceId: "ws-1",
        workItemId: "wi-1",
        actorId: null,
        actorType: "system",
        verb: "attachment.added",
        visibility: "internal",
      }),
    ).toBe("internal");
  });
});

describe("activity.seq -- monotonic tiebreak within one transaction", () => {
  it("assigns strictly increasing seq values, in insert order, for rows sharing one created_at", async () => {
    const fixture = await makeWorkItemFixture();
    // Queried straight from the table with `db.select`, deliberately NOT via
    // `recordWorkItemActivity`'s own return value -- S6 (PR #275's mandatory Opus 5.5
    // review) made the writer's `.returning()` list stop including `seq`, on purpose, so
    // this test would fail to compile against it if it tried (see that finding's own
    // regression check, in the "no seq in the returned shape" describe below). `seq`
    // still exists and is still monotonic in the TABLE; only the writer's return value
    // excludes it.
    await recordWorkItemActivity(db, [
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
        verb: "updated",
        field: "title",
        oldValue: "A work item",
        newValue: "A renamed work item",
      },
      {
        workspaceId: fixture.workspace.id,
        workItemId: fixture.workItem.id,
        actorId: null,
        actorType: "system",
        verb: "updated",
        field: "priority",
        oldValue: null,
        newValue: "low",
      },
    ]);

    const persisted = await db
      .select({
        seq: schema.activityTable.seq,
        createdAt: schema.activityTable.createdAt,
      })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, fixture.workItem.id))
      .orderBy(schema.activityTable.seq);

    const seqs = persisted.map((r) => BigInt(r.seq));
    expect(seqs).toHaveLength(3);
    const [first, second, third] = seqs;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("expected exactly three seq values");
    }
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
  });
});

describe("recordWorkItemActivity -- S6: never returns seq", () => {
  it("the returned row shape has no seq property at runtime", async () => {
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
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("seq");
    // Type-level half of the same regression: `recordWorkItemActivity`'s return type has
    // no `seq` field at all, so `row?.seq` below is a compile error, not merely
    // `undefined` at runtime -- proven by `pnpm typecheck` failing on this exact line
    // when S6 is reverted (`Property 'seq' does not exist on type '{ id: string; ... }'`).
    // Left commented out because a *type* regression test that must not compile cannot
    // also be a runtime assertion the suite runs:
    // const _typeCheck: undefined = row?.seq;
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
      verb: "updated",
      oldValue: "Old title",
      newValue: "New title",
    });
    expect(byField.get("assignee")).toMatchObject({
      verb: "updated",
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

  // S4 (NON-BLOCKING, fixed anyway), PR #275's mandatory Opus 5.5 review: rows used to
  // be built with `...context`, so any EXTRA property a wider object happened to carry
  // (here, a stray `visibility`) flowed straight into every emitted row and then S3's
  // override handling would honour it. `DiffActivityContext`'s own type only declares
  // four fields, but TypeScript's excess-property check is an object-LITERAL-only
  // feature -- assigning to a typed variable first, as this test does, bypasses it, the
  // same way a value built by spreading a loaded row or a request body would in real
  // code. Only explicit field-by-field construction (this PR's actual fix) closes it.
  it("a stray extra property on the context object (e.g. visibility) does not leak into the emitted rows (S4)", () => {
    const widerContext: DiffActivityContext & { visibility: "public" } = {
      ...context,
      visibility: "public",
    };
    const rows = diffWorkItemFieldChanges(
      { assigneeId: null },
      { assigneeId: "person-2" },
      widerContext,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("visibility");
    // Sanity: with no `visibility` forwarded, CA-7's own table resolves this row --
    // `assignee` is internal -- rather than the stray `public` the spread used to leak.
    const [row] = rows;
    if (!row) {
      throw new Error("expected exactly one row");
    }
    expect(resolveVisibility(row)).toBe("internal");
  });
});
