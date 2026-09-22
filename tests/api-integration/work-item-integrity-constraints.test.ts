/**
 * Issue #189 — the bounded, no-design-decision half of PR #185's Opus-review backlog
 * (`docs/07-planning/security-reviews/185-work-item-schema.md`, findings S7 and S9). Same
 * shape as `work-item-schema.test.ts` / `work-item-schema-integrity.test.ts`: real
 * PostgreSQL 18 inserts, not mocks, because every one of these is a DB-level constraint
 * and a test that only asserts the happy path would pass with the constraint reverted.
 *
 * Every `describe` states the authority document text it enforces, and every constraint
 * has BOTH halves: the value it must reject, and the sibling value it must keep accepting
 * (`work-item-schema.test.ts`'s stated convention). Each negative case is otherwise a
 * fully-valid row, so a failure can only be the constraint under test.
 *
 * The `NaN` case is worth reading before changing: the issue proposed
 * `CHECK (position = position)`, which does NOT work on `numeric` — Postgres treats
 * `NaN = NaN` as TRUE for that type. `work_item_position_not_nan` uses
 * `<> 'NaN'::numeric` instead; see the column comment in `schema.ts`.
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

// ── Minimal fixture builders -- this schema still has no route/repository layer, so ──
// every row is a direct insert, matching work-item-schema.test.ts.

async function makeWorkspace() {
  const organisation = await makeOrganisation();
  return requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        name: "WI Integrity Constraints Workspace",
        slug: `wi-constraints-ws-${randomUUID()}`,
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
        slug: `wi-constraints-project-${randomUUID()}`,
        name: "WI Integrity Constraints Project",
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
        key: `wi-constraints-org-${randomUUID()}`,
        name: "WI Integrity Constraints Organisation",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeOrganisation",
  );
}

async function makePerson(organisationId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId,
        side: "staff",
        isPlaceholder: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makePerson",
  );
}

async function makeWorkItemType(workspaceId: string, category = "delivery") {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

async function makeStateTemplate(workspaceId: string, group = "backlog") {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeStateTemplate",
  );
}

async function makeState(
  projectId: string,
  stateTemplateId: string,
  isDefault = false,
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId,
        isDefault,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState",
  );
}

// #192: `work_item.workspace_id` is now NOT NULL -- derived here from `projectId`'s own
// `workspace_id` (the value the real #23 write path is specified to set), same pattern as
// `work-item-schema.test.ts` / `work-item-schema-integrity.test.ts`.
async function makeWorkItem(overrides: {
  projectId: string;
  typeId: string;
  stateId: string;
  key: string;
  number?: number;
  priority?: string | null;
  position?: string;
  customerVisibility?: string;
}) {
  const now = new Date();
  const [project] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, overrides.projectId));
  if (!project) {
    throw new Error("makeWorkItem: project workspaceId lookup found no row");
  }
  return requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        title: "A work item",
        number: 1,
        createdAt: now,
        updatedAt: now,
        ...overrides,
        workspaceId: project.workspaceId,
      })
      .returning(),
    "makeWorkItem",
  );
}

/** A project plus every workspace-scoped row a work item needs. */
async function makeProjectFixture() {
  const workspace = await makeWorkspace();
  const project = await makeProject(workspace.id);
  const type = await makeWorkItemType(workspace.id);
  const stateTemplate = await makeStateTemplate(workspace.id);
  const state = await makeState(project.id, stateTemplate.id);
  return { workspace, project, type, stateTemplate, state };
}

/**
 * Insert a work item through raw SQL, so a value Drizzle's typed insert path would refuse
 * to represent as a JS string (e.g. `'NaN'`) still reaches Postgres. `id` is supplied
 * explicitly for the reason #191's review recorded: `work_item.id` has no SQL-level
 * default, so an insert that omits it fails on `id`'s own NOT NULL and would "pass" for a
 * reason unrelated to the constraint under test.
 */
async function rawInsertWorkItem(params: {
  projectId: string;
  workspaceId: string;
  typeId: string;
  stateId: string;
  key: string;
  number: number;
  priority: string | null;
  position: string;
  customerVisibility: string;
}) {
  await db.execute(sql`
    INSERT INTO work_item (
      id, project_id, workspace_id, type_id, number, key, title, state_id,
      priority, position, customer_visibility
    ) VALUES (
      ${randomUUID()}, ${params.projectId}, ${params.workspaceId}, ${params.typeId},
      ${params.number}, ${params.key}, 'A work item', ${params.stateId}, ${params.priority},
      ${params.position}, ${params.customerVisibility}
    )
  `);
}

describe("#189 S7 -- work_item.priority is constrained to low/medium/high/urgent", () => {
  // data-model.md §2: "Enumerations are Postgres enums or CHECK constraints, never free
  // text. Priority is the ordered enum `low < medium < high < urgent` -- ordering is
  // load-bearing for the customer escalate-only rule and for every importer's mapping."
  it.each(["low", "medium", "high", "urgent"])(
    "accepts the in-vocabulary value %s",
    async (priority) => {
      const fixture = await makeProjectFixture();
      const item = await makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        key: `${fixture.project.slug}-1`,
        priority,
      });
      expect(item.priority).toBe(priority);
    },
  );

  it("rejects a value outside the four (the fifth literal kaneo's task table also carries)", async () => {
    const fixture = await makeProjectFixture();
    await expect(
      makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        key: `${fixture.project.slug}-1`,
        priority: "no-priority",
      }),
    ).rejects.toThrow();
  });

  it("still accepts NULL -- the column is nullable, and constraining it must not make it NOT NULL", async () => {
    const fixture = await makeProjectFixture();
    const item = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      key: `${fixture.project.slug}-1`,
      priority: null,
    });
    expect(item.priority).toBeNull();
  });
});

describe("#189 S7 -- state_template.group is constrained to the five lifecycle groups", () => {
  // data-model.md §3: "`group` (`backlog`|`unstarted`|`started`|`completed`|`cancelled`)";
  // ADR 0011: "The five `group` values are the only fixed lifecycle vocabulary."
  it("accepts `started` and rejects a sixth value", async () => {
    const workspace = await makeWorkspace();
    await expect(
      makeStateTemplate(workspace.id, "started"),
    ).resolves.toBeDefined();

    await expect(
      makeStateTemplate(workspace.id, "in_progress"),
    ).rejects.toThrow();
  });
});

describe("#189 S7 -- work_item_type.category is constrained to service/delivery", () => {
  // data-model.md §4: "`category` (`service`|`delivery`)".
  it("accepts `service` and rejects a value outside the pair", async () => {
    const workspace = await makeWorkspace();
    await expect(
      makeWorkItemType(workspace.id, "service"),
    ).resolves.toBeDefined();

    await expect(makeWorkItemType(workspace.id, "support")).rejects.toThrow();
  });
});

describe("#189 S7 -- work_item.customer_visibility is constrained to private/organisation", () => {
  // data-model.md §4: "`customer_visibility` (`private`|`organisation`)". The column's
  // NOT NULL DEFAULT 'private' was #186 S1; this closes the other half -- a garbage
  // string used to satisfy NOT NULL while reading as neither value.
  it("accepts `organisation` and rejects a value outside the pair", async () => {
    const fixture = await makeProjectFixture();
    await expect(
      makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        key: `${fixture.project.slug}-1`,
        number: 1,
        customerVisibility: "organisation",
      }),
    ).resolves.toBeDefined();

    // `number: 2`, not another `number: 1`: `work_item_project_number_unique` would
    // reject a second number 1 in the same project, so a re-used number would make this
    // assertion pass without the CHECK ever being consulted (verified by running this
    // file against the pre-#189 journal, where the first draft of this test passed for
    // exactly that reason).
    await expect(
      makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        key: `${fixture.project.slug}-2`,
        number: 2,
        customerVisibility: "internal",
      }),
    ).rejects.toThrow();
  });
});

describe("#189 S7 -- watcher.source is constrained to explicit/implicit", () => {
  // data-model.md §4: "`source` (`explicit`|`implicit`)".
  async function makeWatcherFixture() {
    const fixture = await makeProjectFixture();
    const organisation = await makeOrganisation();
    const person = await makePerson(organisation.id);
    const otherPerson = await makePerson(organisation.id);
    const workItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      key: `${fixture.project.slug}-1`,
    });
    return { ...fixture, person, otherPerson, workItem };
  }

  it("accepts `implicit` and rejects a value outside the pair", async () => {
    const fixture = await makeWatcherFixture();

    await expect(
      db.insert(schema.watcherTable).values({
        workItemId: fixture.workItem.id,
        personId: fixture.person.id,
        source: "implicit",
      }),
    ).resolves.toBeDefined();

    // A *second person*, not the same one: `watcher_workItemId_personId_unique` would
    // reject a duplicate watch row for the same pair, so re-using the person would make
    // this assertion pass without the CHECK ever being consulted.
    await expect(
      db.insert(schema.watcherTable).values({
        workItemId: fixture.workItem.id,
        personId: fixture.otherPerson.id,
        source: "auto",
      }),
    ).rejects.toThrow();
  });
});

describe("#189 S9 -- work_item.position rejects NaN", () => {
  // The constraint is `position <> 'NaN'::numeric`, NOT the issue's suggested
  // `position = position`: Postgres deliberately makes `NaN = NaN` TRUE for `numeric`,
  // so a self-comparison CHECK accepts NaN and constrains nothing. Both facts are
  // asserted below, so a future change back to `= position` fails this test rather than
  // silently reopening the gap.
  it("rejects a NaN position written by raw SQL", async () => {
    const fixture = await makeProjectFixture();
    await expect(
      rawInsertWorkItem({
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        key: `${fixture.project.slug}-1`,
        number: 1,
        priority: "low",
        position: "NaN",
        customerVisibility: "private",
      }),
    ).rejects.toThrow();
  });

  it("still accepts ordinary and fractional positions", async () => {
    const fixture = await makeProjectFixture();
    await expect(
      rawInsertWorkItem({
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        key: `${fixture.project.slug}-1`,
        number: 1,
        priority: "low",
        position: "1.5000000000",
        customerVisibility: "private",
      }),
    ).resolves.toBeUndefined();
    await expect(
      rawInsertWorkItem({
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        key: `${fixture.project.slug}-2`,
        number: 2,
        priority: "low",
        position: "-2.2500000000",
        customerVisibility: "private",
      }),
    ).resolves.toBeUndefined();
  });

  it("records why the issue's `position = position` form would not work: NaN = NaN is TRUE for numeric", async () => {
    // A direct assertion on Postgres's own semantics, so the reason the CHECK is written
    // the way it is survives as evidence rather than only as a comment.
    const result = await db.execute<{ nan_eq: boolean }>(
      sql`select ('NaN'::numeric = 'NaN'::numeric) as nan_eq`,
    );
    expect(result.rows[0]?.nan_eq).toBe(true);
  });
});

describe("#189 S9 -- work_item.number is positive", () => {
  it("rejects 0", async () => {
    const fixture = await makeProjectFixture();
    await expect(
      makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        key: `${fixture.project.slug}-0`,
        number: 0,
      }),
    ).rejects.toThrow();
  });

  it("rejects a negative number", async () => {
    const fixture = await makeProjectFixture();
    await expect(
      makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        key: `${fixture.project.slug}--1`,
        number: -1,
      }),
    ).rejects.toThrow();
  });

  it("still accepts the first number a project assigns (1)", async () => {
    const fixture = await makeProjectFixture();
    const item = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      key: `${fixture.project.slug}-1`,
      number: 1,
    });
    expect(item.number).toBe(1);
  });
});

describe("#189 S9 -- at most one default state per project", () => {
  // Authorised by the singular definite in projects-and-engagements.md `PR-17` ("their own
  // order and default") and work-items.md `WI-4` ("the project's own default state").
  it("rejects a second default state in the same project", async () => {
    const workspace = await makeWorkspace();
    const project = await makeProject(workspace.id);
    const templateA = await makeStateTemplate(workspace.id);
    const templateB = await makeStateTemplate(workspace.id);

    await expect(
      makeState(project.id, templateA.id, true),
    ).resolves.toBeDefined();

    await expect(makeState(project.id, templateB.id, true)).rejects.toThrow();
  });

  it("permits a non-default state in a project that already has a default", async () => {
    const workspace = await makeWorkspace();
    const project = await makeProject(workspace.id);
    const templateA = await makeStateTemplate(workspace.id);
    const templateB = await makeStateTemplate(workspace.id);

    await makeState(project.id, templateA.id, true);
    await expect(
      makeState(project.id, templateB.id, false),
    ).resolves.toBeDefined();
  });

  it("permits each project to have its own default state", async () => {
    const workspace = await makeWorkspace();
    const projectA = await makeProject(workspace.id);
    const projectB = await makeProject(workspace.id);
    const templateA = await makeStateTemplate(workspace.id);
    const templateB = await makeStateTemplate(workspace.id);

    await expect(
      makeState(projectA.id, templateA.id, true),
    ).resolves.toBeDefined();
    await expect(
      makeState(projectB.id, templateB.id, true),
    ).resolves.toBeDefined();
  });

  it("permits many non-default states in one project", async () => {
    const workspace = await makeWorkspace();
    const project = await makeProject(workspace.id);
    const templateA = await makeStateTemplate(workspace.id);
    const templateB = await makeStateTemplate(workspace.id);
    const templateC = await makeStateTemplate(workspace.id);

    await makeState(project.id, templateA.id, false);
    await makeState(project.id, templateB.id, false);
    await expect(
      makeState(project.id, templateC.id, false),
    ).resolves.toBeDefined();
  });

  it("is enforced by a partial index, so it does not apply to `is_default = false` rows", async () => {
    const indexes = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes
          where tablename = 'state' and indexname = 'state_project_default_unique'`,
    );
    expect(indexes.rows[0]?.indexdef).toContain("WHERE");
    expect(indexes.rows[0]?.indexdef).toContain("is_default");
  });
});
