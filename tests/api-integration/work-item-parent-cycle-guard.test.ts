/**
 * Issue #188 -- `work_item.parent_id` had no guard against a work item becoming its own
 * ancestor: neither a direct self-parent (`parent_id = id`) nor a multi-row cycle (A's
 * parent is B, B's parent is A; or any longer loop) was rejected. Found during the
 * mandatory Opus security review of PR #185 (finding S3); matters because roll-up
 * computation (`docs/03-features/work-items.md` `WI-19`,
 * `docs/03-features/relations-and-hierarchy.md` `RH-9`/`RH-14`) walks the parent chain
 * recursively -- a cycle would make that walk infinite.
 *
 * Two guards close this, added in this same migration:
 *
 *   - `work_item_parent_not_self`, a CHECK constraint (`parent_id IS DISTINCT FROM id`)
 *     for direct self-parenting -- real, atomic, race-free by construction, since both
 *     columns it compares live on the one row being written.
 *   - `work_item_reject_parent_cycle`, a `BEFORE INSERT OR UPDATE OF parent_id` trigger
 *     for multi-row cycles -- a CHECK/FK cannot express "no cycle exists in this graph."
 *     It walks from the proposed new parent upward, rejecting if the walk ever reaches
 *     `NEW.id`.
 *
 * The trigger's own race analysis (see its comment in the migration SQL and on the
 * `parentId` column in `schema.ts`) is proven here, not just asserted: a NAIVE version of
 * this walk (plain, unlocked `SELECT`s) would let two concurrent transactions, each
 * changing a DIFFERENT row's `parent_id`, each see the OTHER's PRE-transaction value and
 * each conclude "no cycle" -- together forming a cycle neither created alone. The trigger
 * actually shipped here closes this by taking a `SELECT ... FOR NO KEY UPDATE` row lock on
 * every ancestor visited during the walk, so a concurrent transaction that is itself
 * changing that ancestor blocks (or is resolved by Postgres's own deadlock detector, for a
 * longer ring) instead of being read mid-flight. Both concurrency tests below reproduce
 * this live, under plain READ COMMITTED -- no reliance on the application choosing
 * SERIALIZABLE.
 *
 * PR #195 remediation (mandatory Opus review, findings OS1/OS2 -- see the migration SQL
 * and `parentId`'s comment in `schema.ts` for the full analysis) added two more regression
 * tests below:
 *
 *   - OS1: the walk's lock was `FOR UPDATE`, strictly stronger than the race analysis
 *     needs -- it also conflicts with `FOR KEY SHARE`, the lock an unrelated foreign key
 *     check against one of the locked ancestors takes (e.g. a new `watcher` row), so
 *     unrelated work blocked on a reparent for no reason. Changed to `FOR NO KEY UPDATE`,
 *     which is sufficient for every interleaving above and does not conflict with
 *     `FOR KEY SHARE`.
 *   - OS2: `BEFORE UPDATE OF parent_id` fires on column MENTION, not value CHANGE (the
 *     same class of bug #191 N2 found on the sibling `work_item_claim_key` trigger), so an
 *     ordinary whole-row ORM update that re-sends `parent_id`'s own unchanged value would
 *     otherwise re-run the entire locking walk. Fixed by returning immediately, before the
 *     walk, when `TG_OP = 'UPDATE'` and `NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id`.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

/**
 * A second (and third), independent raw connection -- needed for the concurrency
 * reproductions below, which require genuinely separate database sessions (uncommitted,
 * overlapping transactions), not two calls through the same pooled `db` instance. Same
 * pattern `work-item-schema-integrity.test.ts` uses for #191 O2's races.
 */
async function openRawClient(): Promise<Client> {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  await client.connect();
  return client;
}

async function setParentId(
  client: Client,
  workItemId: string,
  parentId: string | null,
): Promise<void> {
  await client.query("UPDATE work_item SET parent_id = $1 WHERE id = $2", [
    parentId,
    workItemId,
  ]);
}

/**
 * Races `promise` against a plain timer, used below (PR #195 OS1/OS2 remediation) to
 * prove a concurrent statement did NOT block behind another, still-open transaction's
 * locks: if it were genuinely blocked, it cannot possibly settle before the timeout while
 * the blocking transaction is deliberately kept open across the whole race. Resolves
 * `"resolved"` if `promise` settles first, `"timeout"` if the timer wins.
 */
async function raceAgainstTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<"resolved" | "timeout"> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([
    promise.then((): "resolved" => "resolved"),
    timeout,
  ]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  return result;
}

// ── Minimal fixture builders -- same pattern as work-item-schema-integrity.test.ts ──

async function makeWorkspace() {
  const organisation = await ensureInternalOrganisation();
  return requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        name: "Parent Cycle Guard Test Workspace",
        slug: `pcg-ws-${randomUUID()}`,
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
        slug: `pcg-project-${randomUUID()}`,
        name: "Parent Cycle Guard Test Project",
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

async function makeWorkItem(
  fixture: Awaited<ReturnType<typeof makeProjectFixture>>,
  number: number,
  parentId?: string,
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number,
        key: `${fixture.project.slug}-${number}`,
        title: "A work item",
        parentId,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItem",
  );
}

describe("#188 -- direct self-parenting is rejected (work_item_parent_not_self CHECK)", () => {
  it("rejects INSERT with parent_id = id", async () => {
    const fixture = await makeProjectFixture();
    const id = randomUUID();
    await expect(
      db.insert(schema.workItemTable).values({
        id,
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number: 1,
        key: `${fixture.project.slug}-1`,
        title: "Self-parented from birth",
        parentId: id,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("rejects UPDATE that sets parent_id = id on an existing row", async () => {
    const fixture = await makeProjectFixture();
    const item = await makeWorkItem(fixture, 1);

    await expect(
      db
        .update(schema.workItemTable)
        .set({ parentId: item.id })
        .where(eq(schema.workItemTable.id, item.id)),
    ).rejects.toThrow();
  });

  it("still permits a NULL parent_id (root item) -- IS DISTINCT FROM must not misfire on NULL", async () => {
    const fixture = await makeProjectFixture();
    await expect(makeWorkItem(fixture, 1)).resolves.toBeDefined();
  });
});

describe("#188 -- multi-row cycles are rejected (work_item_reject_parent_cycle trigger)", () => {
  it("rejects a direct 2-node cycle (A's parent is B, then B's parent set to A)", async () => {
    const fixture = await makeProjectFixture();
    const a = await makeWorkItem(fixture, 1);
    const b = await makeWorkItem(fixture, 2, a.id); // b.parent_id = a

    await expect(
      db
        .update(schema.workItemTable)
        .set({ parentId: b.id }) // a.parent_id := b -- would close A<->B
        .where(eq(schema.workItemTable.id, a.id)),
    ).rejects.toThrow();

    // Must not have partially applied.
    const [reloadedA] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, a.id));
    expect(reloadedA?.parentId).toBeNull();
  });

  it("rejects a 3-node cycle (A <- B <- C, then A's parent set to C)", async () => {
    const fixture = await makeProjectFixture();
    const a = await makeWorkItem(fixture, 1);
    const b = await makeWorkItem(fixture, 2, a.id); // b.parent_id = a
    const c = await makeWorkItem(fixture, 3, b.id); // c.parent_id = b -- chain: a <- b <- c

    await expect(
      db
        .update(schema.workItemTable)
        .set({ parentId: c.id }) // a.parent_id := c -- would close a->c->b->a
        .where(eq(schema.workItemTable.id, a.id)),
    ).rejects.toThrow();

    const [reloadedA] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, a.id));
    expect(reloadedA?.parentId).toBeNull();
  });

  it("rejects a longer, 6-node cycle formed by closing a deep chain back on itself", async () => {
    const fixture = await makeProjectFixture();
    const n1 = await makeWorkItem(fixture, 1);
    const n2 = await makeWorkItem(fixture, 2, n1.id);
    const n3 = await makeWorkItem(fixture, 3, n2.id);
    const n4 = await makeWorkItem(fixture, 4, n3.id);
    const n5 = await makeWorkItem(fixture, 5, n4.id);
    const n6 = await makeWorkItem(fixture, 6, n5.id);
    // chain: n1 <- n2 <- n3 <- n4 <- n5 <- n6

    await expect(
      db
        .update(schema.workItemTable)
        .set({ parentId: n6.id }) // n1.parent_id := n6 -- closes the whole chain into a ring
        .where(eq(schema.workItemTable.id, n1.id)),
    ).rejects.toThrow();
  });

  it("permits a legitimate deep-but-acyclic chain (well past RH-7's application-level depth-5 cap -- this DB guard only rejects CYCLES, not depth; depth is a separate, out-of-scope concern)", async () => {
    const fixture = await makeProjectFixture();
    let parentId: string | undefined;
    const items: Awaited<ReturnType<typeof makeWorkItem>>[] = [];
    for (let i = 1; i <= 8; i++) {
      const item = await makeWorkItem(fixture, i, parentId);
      items.push(item);
      parentId = item.id;
    }
    expect(items).toHaveLength(8);
    // The last item's chain walks all the way to the root without incident.
    expect(items[7]?.parentId).toBe(items[6]?.id);
  });

  it("permits re-parenting to an unrelated item (no cycle) and to null (detach)", async () => {
    const fixture = await makeProjectFixture();
    const a = await makeWorkItem(fixture, 1);
    const b = await makeWorkItem(fixture, 2);
    const child = await makeWorkItem(fixture, 3, a.id);

    await expect(
      db
        .update(schema.workItemTable)
        .set({ parentId: b.id })
        .where(eq(schema.workItemTable.id, child.id)),
    ).resolves.toBeDefined();

    await expect(
      db
        .update(schema.workItemTable)
        .set({ parentId: null })
        .where(eq(schema.workItemTable.id, child.id)),
    ).resolves.toBeDefined();
  });
});

describe("#188 -- the trigger's row-locking walk is race-free under concurrency (not merely sequentially correct)", () => {
  it("rejects a concurrent two-row swap that would each individually look acyclic (T1: A.parent:=B, T2, concurrently: B.parent:=A)", async () => {
    // The exact hazard a NAIVE (unlocked-SELECT) version of this trigger would have:
    // T1 checks B's chain and sees it as it was BEFORE T2's write; T2 checks A's chain
    // and sees it as it was BEFORE T1's write. Both would conclude "no cycle" and both
    // commit, producing a cycle neither created alone. The shipped trigger closes this
    // with a `SELECT ... FOR UPDATE` on every ancestor visited: T2's own UPDATE of B
    // cannot proceed until T1 either commits or rolls back, because T1's trigger already
    // holds a FOR UPDATE lock on B (acquired while walking B's chain to check A's
    // proposed parent). This test proves the outcome is always "the second transaction
    // observes the first's real, committed edge and correctly rejects the cycle it would
    // complete" -- not "usually wins the race."
    const fixture = await makeProjectFixture();
    const a = await makeWorkItem(fixture, 1);
    const b = await makeWorkItem(fixture, 2);

    const t1 = await openRawClient();
    const t2 = await openRawClient();
    try {
      await t1.query("BEGIN");
      await setParentId(t1, a.id, b.id); // T1: a.parent_id := b -- NOT yet committed

      await t2.query("BEGIN");
      const t2Promise = setParentId(t2, b.id, a.id); // T2: b.parent_id := a, concurrently
      // See work-item-schema-integrity.test.ts's identical rationale: attach a no-op
      // catch immediately so an unhandled-rejection warning can never fire depending on
      // exact microtask timing, while the real assertion below is a second, independent
      // handler on the same promise.
      t2Promise.catch(() => {});

      // T2's UPDATE is expected to BLOCK at the database level (it needs a row lock on
      // `b` that T1's trigger already holds) until T1 resolves -- this pause just gives
      // T2's query time to actually reach Postgres and start blocking before T1 commits.
      // The correctness being proven (Postgres's own row locking arbitrates the
      // interleaving, not this test) does not depend on the pause's exact length.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await t1.query("COMMIT");

      // T1 committed first (a.parent_id = b, a real, acyclic edge). T2 must now see
      // that committed edge during its own walk (from a, T2's proposed new parent,
      // reaching b, which resolves to a -- wait, walk from a: a.parent_id is now b,
      // continue to b, which is T2's own NEW.id) and reject the cycle it would close.
      await expect(t2Promise).rejects.toThrow();
      await t2.query("ROLLBACK").catch(() => {});
    } finally {
      await t1.end();
      await t2.end();
    }

    const [reloadedA] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, a.id));
    const [reloadedB] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, b.id));
    // Exactly the acyclic half of the attempted swap survives -- never both edges.
    expect(reloadedA?.parentId).toBe(b.id);
    expect(reloadedB?.parentId).toBeNull();
  });

  it("resolves a concurrent 3-way ring attempt (T1: A.parent:=B, T2: B.parent:=C, T3: C.parent:=A) via Postgres's own deadlock detection, and the final state is always acyclic", async () => {
    // Three fully independent root items; three transactions each try to close one edge
    // of a ring simultaneously. Every transaction holds its own target row's lock (from
    // its own UPDATE) and needs the NEXT row's lock (to walk that row's chain) -- which
    // is held by the NEXT transaction in the ring. This is an unconditional 3-way
    // circular wait once all three reach their trigger's walk, regardless of exact
    // timing, so Postgres's deadlock detector (not either transaction's own logic) is
    // what resolves it, by aborting exactly one transaction after `deadlock_timeout`
    // (default 1s). Whichever one loses, the ring can never fully close: the survivors'
    // walks see the aborted transaction's row as UNCHANGED (never committed), so their
    // own walks terminate at a NULL parent instead of finding a cycle back to
    // themselves -- the final state is always a valid acyclic chain, never a closed
    // ring, and never all three commits.
    const fixture = await makeProjectFixture();
    const a = await makeWorkItem(fixture, 1);
    const b = await makeWorkItem(fixture, 2);
    const c = await makeWorkItem(fixture, 3);

    // Each leg commits (or rolls back) itself the moment ITS OWN update settles --
    // deliberately NOT synchronized with the other two. A first attempt at this test
    // waited for all three updates to settle before sending ANY commit, which produced a
    // hang indistinguishable from a real deadlock but was actually a bug in the TEST, not
    // the trigger: whichever leg wins its lock uncontested finishes and sits
    // "idle in transaction" holding its locks -- Postgres has no reason to ever abort a
    // transaction that isn't itself waiting on anything, so an artificial wait can
    // persist forever with no deadlock for the detector to find. Committing/rolling back
    // each leg the instant it personally finishes is what a real caller would do, and is
    // what lets a GENUINE 3-way circular wait -- if the interleaving actually produces
    // one -- surface to Postgres's deadlock detector at all.
    async function runLeg(
      client: Client,
      workItemId: string,
      parentId: string,
    ): Promise<void> {
      try {
        await setParentId(client, workItemId, parentId);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }

    const t1 = await openRawClient();
    const t2 = await openRawClient();
    const t3 = await openRawClient();
    try {
      await t1.query("BEGIN");
      await t2.query("BEGIN");
      await t3.query("BEGIN");

      const p1 = runLeg(t1, a.id, b.id); // T1: a.parent_id := b
      const p2 = runLeg(t2, b.id, c.id); // T2: b.parent_id := c
      const p3 = runLeg(t3, c.id, a.id); // T3: c.parent_id := a -- attempted ring close
      p1.catch(() => {});
      p2.catch(() => {});
      p3.catch(() => {});

      const results = await Promise.allSettled([p1, p2, p3]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // At least one of the three must lose. Depending on exactly how the three legs'
      // lock requests interleave, either a single pairwise conflict resolves without
      // ever forming a full 3-way wait (one loser), or all three become mutually
      // dependent and Postgres's deadlock detector picks one victim (also one loser) --
      // either way, all three succeeding would mean the ring actually closed, which must
      // never happen.
      expect(rejected.length).toBeGreaterThanOrEqual(1);
      expect(fulfilled.length).toBeLessThanOrEqual(2);
    } finally {
      await t1.end();
      await t2.end();
      await t3.end();
    }

    // Whatever the outcome, the persisted graph must be acyclic: walk from each item
    // and confirm the walk terminates (reaches a null parent) within 3 hops.
    const rows = await db
      .select({
        id: schema.workItemTable.id,
        parentId: schema.workItemTable.parentId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, fixture.project.id));
    const byId = new Map(rows.map((row) => [row.id, row.parentId]));
    for (const item of [a, b, c]) {
      let current: string | null | undefined = item.id;
      let hops = 0;
      while (current) {
        current = byId.get(current) ?? null;
        hops += 1;
        expect(hops).toBeLessThanOrEqual(3);
      }
    }
  }, 20_000);
});

describe("PR #195 remediation OS1 -- the ancestor walk locks with FOR NO KEY UPDATE, not FOR UPDATE", () => {
  it("does not block an unrelated concurrent insert whose foreign key references a locked ancestor", async () => {
    // Chain: root <- mid <- leaf (mid.parent_id = root, leaf.parent_id = mid), plus a
    // fourth, unrelated item ("other") that T1 reparents under `leaf` below -- forcing
    // the trigger to walk (and lock) leaf, then mid, then root, in that order, and to
    // hold all three locks until T1 commits.
    const fixture = await makeProjectFixture();
    const root = await makeWorkItem(fixture, 1);
    const mid = await makeWorkItem(fixture, 2, root.id);
    const leaf = await makeWorkItem(fixture, 3, mid.id);
    const other = await makeWorkItem(fixture, 4);

    const t1 = await openRawClient();
    const t2 = await openRawClient();
    try {
      await t1.query("BEGIN");
      // Walks leaf -> mid -> root, taking FOR NO KEY UPDATE on all three -- and does NOT
      // commit for the rest of this test, so anything that would conflict with that lock
      // has the whole test to prove it (it does not merely "usually" not block).
      await setParentId(t1, other.id, leaf.id);

      // A `work_item_key_alias` row whose single-column FK to `work_item.id` needs only a
      // `FOR KEY SHARE` lock on `root` to insert -- the same lock shape an unrelated new
      // `watcher` row referencing an ancestor would need, and entirely unrelated to the
      // reparent above. `old_key` is set to `root`'s own current key so the composite FK
      // to `work_item_key_claim` (which requires the exact (key, work_item_id) pair to
      // already be claimed) is satisfied by the claim `work_item_claim_key` made when
      // `root` itself was created -- this is a pure lock-contention fixture, not a
      // realistic alias.
      const t2Promise = t2.query(
        `INSERT INTO work_item_key_alias (id, old_key, work_item_id, created_at, updated_at)
         VALUES ($1, $2, $3, now(), now())`,
        [randomUUID(), root.key, root.id],
      );
      t2Promise.catch(() => {});

      // Must resolve well before T1 ever commits. `FOR UPDATE` (pre-fix) conflicts with
      // `FOR KEY SHARE`, so this would still be pending after the timeout, with T1 still
      // open, under the bug this regression test targets. `FOR NO KEY UPDATE` does not
      // conflict with `FOR KEY SHARE`, so it must resolve immediately.
      const outcome = await raceAgainstTimeout(t2Promise, 2000);
      expect(outcome).toBe("resolved");
      await expect(t2Promise).resolves.toBeDefined();

      await t1.query("COMMIT");
    } finally {
      await t1.end();
      await t2.end();
    }

    const [reloadedOther] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, other.id));
    expect(reloadedOther?.parentId).toBe(leaf.id);
  });
});

describe("PR #195 remediation OS2 -- the trigger is a no-op when parent_id hasn't actually changed", () => {
  it("takes no ancestor lock at all for a whole-row-style update that re-sends parent_id unchanged", async () => {
    // Chain: root <- mid <- leaf. `leaf` is updated below the same way a generic ORM
    // whole-row update would: every column re-sent, including `parent_id` at its own
    // current, unchanged value -- which still MENTIONS the column, so
    // `BEFORE UPDATE OF parent_id` still fires, but nothing about parent_id actually
    // changed.
    const fixture = await makeProjectFixture();
    const root = await makeWorkItem(fixture, 1);
    const mid = await makeWorkItem(fixture, 2, root.id);
    const leaf = await makeWorkItem(fixture, 3, mid.id);

    const t1 = await openRawClient();
    const t2 = await openRawClient();
    try {
      await t1.query("BEGIN");
      await t1.query(
        "UPDATE work_item SET title = $1, parent_id = $2 WHERE id = $3",
        ["Retitled via whole-row update", mid.id, leaf.id],
      );

      // An ordinary write to `mid`, an ANCESTOR of `leaf`. Before this fix, the trigger
      // would have re-walked leaf -> mid -> root above and would still be holding a
      // `FOR NO KEY UPDATE` lock on `mid` -- which conflicts with this UPDATE's own row
      // lock -- for as long as T1 stays open.
      const t2Promise = t2.query(
        "UPDATE work_item SET title = $1 WHERE id = $2",
        ["Touched concurrently", mid.id],
      );
      t2Promise.catch(() => {});

      const outcome = await raceAgainstTimeout(t2Promise, 2000);
      expect(outcome).toBe("resolved");
      await expect(t2Promise).resolves.toBeDefined();

      await t1.query("COMMIT");
    } finally {
      await t1.end();
      await t2.end();
    }

    const [reloadedLeaf] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, leaf.id));
    expect(reloadedLeaf?.title).toBe("Retitled via whole-row update");
    expect(reloadedLeaf?.parentId).toBe(mid.id);

    const [reloadedMid] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, mid.id));
    expect(reloadedMid?.title).toBe("Touched concurrently");
  });

  it("control: a whole-row-style update that DOES change parent_id still walks and still rejects a cycle", async () => {
    // Same chain as above: root <- mid <- leaf. Setting root's parent to leaf would close
    // leaf -> mid -> root -> leaf -- the walk must still run and still reject this, proving
    // the OS2 no-op guard only skips the walk when parent_id is UNCHANGED, never when it
    // genuinely changes.
    const fixture = await makeProjectFixture();
    const root = await makeWorkItem(fixture, 1);
    const mid = await makeWorkItem(fixture, 2, root.id);
    const leaf = await makeWorkItem(fixture, 3, mid.id);

    await expect(
      db
        .update(schema.workItemTable)
        .set({ title: "Retitled AND reparented", parentId: leaf.id })
        .where(eq(schema.workItemTable.id, root.id)),
    ).rejects.toThrow();

    const [reloadedRoot] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, root.id));
    // Rejected transaction -- neither the title nor parent_id change applied.
    expect(reloadedRoot?.parentId).toBeNull();
    expect(reloadedRoot?.title).not.toBe("Retitled AND reparented");
  });
});
