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
 *   S5  `work_item_key_alias.old_key` cannot collide with any key ever claimed in
 *       `work_item_key_claim` — a non-colliding alias still inserts fine.
 *
 * Issue #191 — PR #185's own Opus review found a mandatory follow-up round with three
 * BLOCKING findings against #186's first attempt at S2/S5, all closed here:
 *
 *   O1  The composite FKs' `onUpdate` is now `"no action"`, not `"cascade"`: cascading on
 *       a mutable scoping column (`state.project_id`) let `UPDATE state SET project_id =
 *       …` silently move every work item on that state across a workspace boundary.
 *   O2  S5's original mechanism (a `BEFORE INSERT OR UPDATE` trigger doing a plain
 *       `EXISTS` check against `work_item`) had an unlocked TOCTOU race — proven under
 *       plain READ COMMITTED AND under SERIALIZABLE (only one rw-antidependency edge, so
 *       Postgres's SSI has nothing to detect). It is replaced entirely by
 *       `work_item_key_claim`, a shared registry table both `work_item.key` and
 *       `work_item_key_alias.old_key` are composite-FK'd into, so a real PRIMARY KEY
 *       index — race-free by construction — is what rejects a collision, not a trigger
 *       racing another table's uncommitted writes. See that table's own comment in
 *       `schema.ts` for the full design.
 *   O3  The one trigger that remains (`work_item_claim_key`, on `work_item` itself, whose
 *       job is populating the claim registry — never checking it) pins
 *       `search_path = pg_catalog, public` and fully qualifies its table reference, so a
 *       session-local `CREATE TEMP TABLE work_item_key_claim (...)` cannot shadow it the
 *       way #186 S5's original trigger was shadowable.
 *
 * `work_item.type_id` vs `work_item_type.workspace_id` (the other half of S2) is
 * deliberately NOT covered here — it is an explicitly accepted, documented gap (see the
 * `typeId` column comment in `schema.ts`, the PR body's "Not done", and #191 O5), not a
 * fix, so there is nothing to regression-test yet.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

/**
 * A second, independent raw connection — for #191 O2's concurrency reproductions, which
 * need two genuinely separate database sessions (two uncommitted transactions racing each
 * other), not two calls through the same pooled `db` instance. Same connection-string
 * source `tests/api-integration/helpers/database.ts` already uses for raw `pg` access.
 */
async function openRawClient(): Promise<Client> {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  await client.connect();
  return client;
}

/** Raw-SQL `work_item` insert, for driving a second connection `db.insert()` can't reach. */
async function rawInsertWorkItem(
  client: Client,
  values: {
    id: string;
    projectId: string;
    typeId: string;
    number: number;
    key: string;
    stateId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO work_item (id, project_id, type_id, number, key, title, state_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'A work item', $6, now(), now())`,
    [
      values.id,
      values.projectId,
      values.typeId,
      values.number,
      values.key,
      values.stateId,
    ],
  );
}

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
    //
    // #191 (ordinary review, test-genuineness finding): `work_item.id` has NO SQL-level
    // default -- `.$defaultFn(() => createId())` is JS-side, applied only by
    // `db.insert()`, never by a raw `db.execute()`. The original version of this test
    // omitted `id` from the column list, so it failed on `id`'s own NOT NULL constraint
    // identically whether or not `customer_visibility` was NOT NULL -- passing today for
    // a reason unrelated to the fix it claims to prove, and would have kept passing even
    // if that fix were reverted. Confirmed directly (both against this head and against
    // the pre-fix schema) that adding a real `id` isolates the assertion to
    // `customer_visibility` alone, which now correctly throws post-fix and did not
    // pre-fix.
    const fixture = await makeProjectFixture();
    await expect(
      db.execute(sql`
        INSERT INTO work_item (
          id, project_id, type_id, number, key, title, state_id, customer_visibility
        ) VALUES (
          ${randomUUID()}, ${fixture.project.id}, ${fixture.type.id}, 1,
          ${`${fixture.project.slug}-1`}, 'A work item', ${fixture.state.id}, NULL
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

describe("#191 O1 -- the composite FKs' ON UPDATE NO ACTION closes the cross-tenant cascade", () => {
  it("rejects UPDATE state SET project_id -- it must not silently move the state's work items to another project/workspace", async () => {
    // The exact reproduction from the Opus review: with `onUpdate: "cascade"` (this
    // PR's O1 fix removes it), re-projecting a `state` row cascaded `project_id` onto
    // every `work_item` referencing it -- moving work items across a WORKSPACE
    // boundary with no check, since every other constraint still validated afterwards
    // (the state moved with them). `"no action"` must make Postgres refuse the UPDATE
    // outright instead, because the state is still referenced by a work item in its
    // OLD project.
    const fixtureA = await makeProjectFixture();
    const fixtureB = await makeProjectFixture();
    const workItem = await makeWorkItem({
      projectId: fixtureA.project.id,
      typeId: fixtureA.type.id,
      stateId: fixtureA.state.id,
      number: 1,
      key: `${fixtureA.project.slug}-1`,
    });

    await expect(
      db
        .update(schema.stateTable)
        .set({ projectId: fixtureB.project.id })
        .where(eq(schema.stateTable.id, fixtureA.state.id)),
    ).rejects.toThrow();

    // The work item must NOT have moved -- the rejected UPDATE must not have partially
    // applied, and nothing else must have silently reassigned it either.
    const reloaded = requireRow(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, workItem.id)),
      "reloaded work item",
    );
    expect(reloaded.projectId).toBe(fixtureA.project.id);
  });

  it("still permits UPDATE state SET project_id when no work_item references that state", async () => {
    // Confirms the fix is the composite FK's onUpdate action specifically, not some
    // broader (and wrong) refusal to ever move a state at all.
    const fixtureA = await makeProjectFixture();
    const fixtureB = await makeProjectFixture();

    await expect(
      db
        .update(schema.stateTable)
        .set({ projectId: fixtureB.project.id })
        .where(eq(schema.stateTable.id, fixtureA.state.id)),
    ).resolves.toBeDefined();
  });

  it("rejects UPDATE work_item SET project_id on a parent whose child still references the old project's state", async () => {
    // The self-referencing parent_id composite FK carries the identical O1 fix. Opus's
    // own probe found this direction already self-limiting in practice (the child's
    // OWN state_id FK trips first), but the rejection must still be a real one, not a
    // silent partial move.
    const fixture = await makeProjectFixture();
    const otherFixture = await makeProjectFixture();
    const parent = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });
    await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 2,
      key: `${fixture.project.slug}-2`,
      parentId: parent.id,
    });

    await expect(
      db
        .update(schema.workItemTable)
        .set({ projectId: otherFixture.project.id })
        .where(eq(schema.workItemTable.id, parent.id)),
    ).rejects.toThrow();
  });
});

describe("#186 S5 / #191 O2 -- work_item_key_alias.old_key cannot collide with a currently-live work_item.key", () => {
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
    // A legitimate alias: otherWorkItem's OWN original key, retired by rekeying away
    // from it (which is what actually claims it -- see the registry's design comment in
    // schema.ts; a fabricated, never-claimed old_key is no longer insertable at all
    // under #191's design, covered by its own test above).
    const otherWorkItemOriginalKey = otherWorkItem.key;
    await db
      .update(schema.workItemTable)
      .set({ key: `${fixture.project.slug}-2-moved` })
      .where(eq(schema.workItemTable.id, otherWorkItem.id));
    const alias = requireRow(
      await db
        .insert(schema.workItemKeyAliasTable)
        .values({
          oldKey: otherWorkItemOriginalKey,
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

  it("permits an alias for a key THIS SAME work item actually held and has since moved away from", async () => {
    // #191 O2's registry closes #186's own already-documented reverse-direction gap
    // (Opus's O4) as a side effect of the same mechanism: a key is claimed EXACTLY ONCE,
    // ever, in `work_item_key_claim`, so an alias can only ever reference a claim that
    // already exists -- which means a "genuinely never-used-by-anyone" string (this
    // test's ORIGINAL form, pre-#191) can no longer become an alias at all; only a
    // string that was truly once this SAME work item's own live `key` can. This is the
    // legitimate rekey flow a future write path performs: rekey away from the old value
    // (which is what actually inserts its claim row), then alias it.
    const fixture = await makeProjectFixture();
    const workItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });
    const retiredKey = workItem.key;

    // Simulates the rekey step of a cross-project move: the item's own `key` changes,
    // which is what claims the NEW value and leaves the OLD value's claim row (already
    // made at creation) available for `retiredKey`'s alias to reference.
    await db
      .update(schema.workItemTable)
      .set({ key: `${fixture.project.slug}-1-moved` })
      .where(eq(schema.workItemTable.id, workItem.id));

    await expect(
      db.insert(schema.workItemKeyAliasTable).values({
        oldKey: retiredKey,
        workItemId: workItem.id,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects an alias for a string that was NEVER any work item's own live key", async () => {
    // The registry's actual invariant, made explicit: an alias can only ever reference a
    // claim that already exists. A fabricated string with no claim row -- one that was
    // never really live for anyone -- has nothing to reference and is rejected, unlike
    // the old trigger (which only ever checked "is this CURRENTLY live", so any never-
    // used string passed freely).
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
        oldKey: `never-claimed-by-anyone-${randomUUID()}`,
        workItemId: workItem.id,
      }),
    ).rejects.toThrow();
  });

  it("a brand-new work item cannot reuse a key that is now only an alias's old_key (#191 O4, closed as a side effect)", async () => {
    // Opus's O4 -- flagged non-blocking, "needs its own tracked issue" -- is the reverse
    // of S5: a NEW work_item.key colliding with an EXISTING alias's old_key. The
    // registry's PRIMARY KEY on `key` alone makes this impossible without a second fix:
    // claiming an already-claimed string fails regardless of which table is doing the
    // claiming.
    const fixture = await makeProjectFixture();
    const workItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });
    const retiredKey = workItem.key;
    await db
      .update(schema.workItemTable)
      .set({ key: `${fixture.project.slug}-1-moved` })
      .where(eq(schema.workItemTable.id, workItem.id));
    await db.insert(schema.workItemKeyAliasTable).values({
      oldKey: retiredKey,
      workItemId: workItem.id,
    });

    await expect(
      makeWorkItem({
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number: 2,
        key: retiredKey, // reusing a key that is now only an alias's old_key
      }),
    ).rejects.toThrow();
  });
});

describe("#191 O2 -- work_item_key_claim closes the race, not just the sequential case", () => {
  it("rejects (deterministically, no race window) an alias against another transaction's still-UNCOMMITTED work_item.key", async () => {
    // The exact interleaving BOTH reviewers proved broke the old trigger: T1 inserts a
    // work_item with a given key and does not commit yet; T2, concurrently, tries to
    // alias that SAME key to a different work item. Under the old trigger, T2's EXISTS
    // check could not see T1's uncommitted row, so it passed -- both committed, and the
    // forbidden state (a live key and a colliding alias, both real) existed. Under the
    // registry, T2 needs a claim row matching ITS OWN work_item_id, which cannot exist
    // yet no matter how the two transactions are timed relative to each other -- this
    // is REJECTED unconditionally, not merely "usually wins the race."
    const fixture = await makeProjectFixture();
    const otherWorkItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });
    const raceKey = `${fixture.project.slug}-race-${randomUUID()}`;

    const t1 = await openRawClient();
    const t2 = await openRawClient();
    try {
      await t1.query("BEGIN");
      await rawInsertWorkItem(t1, {
        id: randomUUID(),
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        number: 900,
        key: raceKey,
        stateId: fixture.state.id,
      }); // executed, but NOT committed -- t1's transaction is still open

      await t2.query("BEGIN");
      await expect(
        t2.query(
          `INSERT INTO work_item_key_alias (id, old_key, work_item_id, created_at, updated_at)
           VALUES ($1, $2, $3, now(), now())`,
          [randomUUID(), raceKey, otherWorkItem.id],
        ),
      ).rejects.toThrow();
      await t2.query("ROLLBACK");

      await t1.query("COMMIT");
    } finally {
      await t1.end();
      await t2.end();
    }
  });

  it("resolves a genuine concurrent collision for the identical NEW key via the claim table's real unique index", async () => {
    // Two truly concurrent transactions each creating a DIFFERENT work item with the
    // SAME brand-new key -- the shape a real UNIQUE index (not a check-then-act
    // trigger) is needed to arbitrate. T2's claiming insert cannot see T1's uncommitted
    // claim, so it also attempts to insert the same registry row; Postgres blocks T2's
    // insert until T1's transaction resolves, then correctly reports the conflict.
    // Exactly one of the two work items must exist afterwards, never both, and never
    // neither.
    const fixture = await makeProjectFixture();
    const raceKey = `${fixture.project.slug}-race-${randomUUID()}`;
    const t1Id = randomUUID();
    const t2Id = randomUUID();

    const t1 = await openRawClient();
    const t2 = await openRawClient();
    try {
      await t1.query("BEGIN");
      await rawInsertWorkItem(t1, {
        id: t1Id,
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        number: 901,
        key: raceKey,
        stateId: fixture.state.id,
      });

      await t2.query("BEGIN");
      const t2Promise = rawInsertWorkItem(t2, {
        id: t2Id,
        projectId: fixture.project.id,
        typeId: fixture.type.id,
        number: 902,
        key: raceKey,
        stateId: fixture.state.id,
      });

      // T2's insert blocks at the database level behind T1's uncommitted claim on the
      // identical key -- this pause is just giving that dispatch time to actually reach
      // Postgres and start blocking before T1 commits; the correctness being proven
      // (Postgres, not this test, arbitrates the winner) does not depend on its length.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await t1.query("COMMIT");

      await expect(t2Promise).rejects.toThrow();
      await t2.query("ROLLBACK").catch(() => {});
    } finally {
      await t1.end();
      await t2.end();
    }

    const rows = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, raceKey));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(t1Id);
  });
});

describe("#191 O3 -- the claim trigger's pinned search_path cannot be shadowed by a temp table", () => {
  it("still rejects a colliding key when a session-local temp table shadows work_item_key_claim", async () => {
    const fixture = await makeProjectFixture();
    const workItem = await makeWorkItem({
      projectId: fixture.project.id,
      typeId: fixture.type.id,
      stateId: fixture.state.id,
      number: 1,
      key: `${fixture.project.slug}-1`,
    });

    // `db.transaction()` guarantees the whole callback runs on ONE connection (the same
    // requirement O3's actual attack needs: the temp table and the insert must share a
    // session). Without `SET search_path = pg_catalog, public` and the fully-qualified
    // `public.work_item_key_claim` reference in the trigger function, this temp table
    // would shadow the real one on an unqualified reference, and the colliding insert
    // below would succeed silently instead of being rejected.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          sql`CREATE TEMP TABLE work_item_key_claim ("key" text, work_item_id text, created_at timestamp)`,
        );
        await tx.insert(schema.workItemTable).values({
          projectId: fixture.project.id,
          typeId: fixture.type.id,
          stateId: fixture.state.id,
          number: 2,
          key: workItem.key, // collides with an EXISTING claim
          title: "Attempted bypass via a shadowing temp table",
        });
      }),
    ).rejects.toThrow();
  });
});
