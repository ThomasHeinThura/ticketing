/**
 * Issue #295 -- migration 0056's own documented obligation (issue #196, OS3): the
 * `work_item_claim_key` and `work_item_reject_parent_cycle` triggers can deadlock EACH
 * OTHER (`40P01`) "in the narrow case where one transaction hits a real key collision
 * while another concurrently runs a cycle check that locks the same rows in the opposite
 * order." This test constructs exactly that interleaving -- a genuine key collision on
 * `work_item_key_claim` racing a `parent_id` cycle-check's ancestor lock, in reversed
 * order across two sessions -- against the real triggers (migration 0056, unchanged), and
 * proves `runWithParentWriteDeadlockRetry` (the fix for #295, wired into
 * `set-work-item-parent.ts`/`detach-work-item-parent.ts`) turns the resulting `40P01` into
 * a transparent retry-then-success, never a raw error.
 *
 * TWO ACTORS, each its own Postgres session (a real concurrent reproduction, same pattern
 * `work-item-parent-cycle-guard.test.ts` uses for the same-trigger swap/ring deadlocks):
 *
 *   T1: claims a brand-new key (`work_item_claim_key` fires, no collision yet), then
 *       reparents an existing item under `root` (`work_item_reject_parent_cycle` fires,
 *       takes `FOR NO KEY UPDATE` on `root`).
 *   T2: reparents a DIFFERENT existing item under `root` FIRST (locks `root`), then
 *       attempts to claim the SAME key T1 just claimed (a genuine collision).
 *
 * T1 ends up waiting on `root` (held by T2's first step); T2 ends up waiting on the key
 * claim (held by T1's first step) -- a real circular wait, resolved only by Postgres's own
 * deadlock detector aborting one side with `40P01`. Both actors are wrapped in the SAME
 * production retry helper, symmetrically -- which side Postgres picks as the victim is not
 * something this test controls or needs to: whichever one is aborted, its ENTIRE
 * transaction (including its one-time setup step) rolls back, so its retry re-does only
 * its real, idempotent goal write against fresh state, and both actors are asserted to
 * finish successfully with no raw `40P01`/500 ever reaching either caller.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { isPostgresDeadlockError } from "../../apps/api/src/work-item/controllers/transition-work-item";
import { runWithParentWriteDeadlockRetry } from "../../apps/api/src/work-item/parent-write-deadlock-retry";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function openRawClient(): Promise<Client> {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  await client.connect();
  return client;
}

async function backendPid(client: Client): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "SELECT pg_backend_pid() AS pid",
  );
  const pid = result.rows[0]?.pid;
  if (pid === undefined)
    throw new Error("Could not read PostgreSQL backend PID");
  return pid;
}

async function waitForBackendLockWait(
  observer: Client,
  waitingPid: number,
  blockingPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await observer.query("SELECT pg_stat_clear_snapshot()");
    const result = await observer.query<{ waiting: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE pid = $1
            AND wait_event_type = 'Lock'
            AND $2 = ANY(pg_blocking_pids(pid))
        ) AS waiting
      `,
      [waitingPid, blockingPid],
    );
    if (result.rows[0]?.waiting === true) return;
    await sleep(25);
  }
  throw new Error("Timed out waiting for the expected PostgreSQL lock wait");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A resolved/rejected-free "signal" one async actor can wait on for another. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ── Minimal fixture builders -- same shape as work-item-parent-cycle-guard.test.ts ──

async function makeWorkspace() {
  const organisation = await ensureInternalOrganisation();
  return requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        name: "Parent Write Deadlock Retry Test Workspace",
        slug: `pwdr-ws-${randomUUID()}`,
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
        slug: `pwdr-project-${randomUUID()}`,
        name: "Parent Write Deadlock Retry Test Project",
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
        key: `pwdr-item-${randomUUID()}`,
        title: "A work item",
        parentId,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItem",
  );
}

describe("issue #295 -- runWithParentWriteDeadlockRetry against a REAL cross-trigger 40P01", () => {
  it("retries the genuine work_item_claim_key <-> work_item_reject_parent_cycle deadlock and both writers succeed", async () => {
    const fixture = await makeProjectFixture();
    const root = await makeWorkItem(fixture, 1);
    // T2's own "real" goal write -- reparent this item under root.
    const itemA = await makeWorkItem(fixture, 2);
    // T1's own "real" goal write -- reparent this item under root.
    const itemB = await makeWorkItem(fixture, 3);

    const sharedKey = `pwdr-collision-${randomUUID()}`;

    const t1Client = await openRawClient();
    const t2Client = await openRawClient();
    const observer = await openRawClient();
    const t1Db = drizzle(t1Client, { schema });
    const t2Db = drizzle(t2Client, { schema });
    const t1Pid = await backendPid(t1Client);
    const t2Pid = await backendPid(t2Client);

    const t1ClaimedKey = deferred();
    const t2LockedRoot = deferred();

    let t1Attempts = 0;
    let t2Attempts = 0;

    async function runT1(): Promise<void> {
      t1Attempts += 1;
      await t1Client.query("BEGIN");
      try {
        if (t1Attempts === 1) {
          // Claims `sharedKey` -- no collision yet, T2 hasn't tried it.
          await t1Db.insert(schema.workItemTable).values({
            projectId: fixture.project.id,
            workspaceId: fixture.workspace.id,
            typeId: fixture.type.id,
            stateId: fixture.state.id,
            number: 100,
            key: sharedKey,
            title: "T1's own new item (claims the shared key)",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          t1ClaimedKey.resolve();
          // Only wait for T2 to be mid-hold on THIS, the first, attempt -- a retry
          // re-reads/re-writes against whatever the DB actually looks like by then.
          await t2LockedRoot.promise;
        }

        // T1's real goal write, every attempt: reparent itemB under root -- fires
        // `work_item_reject_parent_cycle`, which takes `FOR NO KEY UPDATE` on root.
        await t1Db
          .update(schema.workItemTable)
          .set({ parentId: root.id })
          .where(eq(schema.workItemTable.id, itemB.id));

        await t1Client.query("COMMIT");
      } catch (error) {
        await t1Client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }

    async function runT2(): Promise<void> {
      t2Attempts += 1;
      await t2Client.query("BEGIN");
      try {
        // T2's real goal write, every attempt: reparent itemA under root.
        await t2Db
          .update(schema.workItemTable)
          .set({ parentId: root.id })
          .where(eq(schema.workItemTable.id, itemA.id));
        t2LockedRoot.resolve();

        if (t2Attempts === 1) {
          // Wait for T1 to actually hold the key claim, then give T1's own reparent
          // to reach Postgres and start waiting on root. Observe the real lock wait
          // rather than relying on scheduler timing; only needed on the FIRST attempt.
          await t1ClaimedKey.promise;
          await waitForBackendLockWait(observer, t1Pid, t2Pid);
          // Genuine collision: same key, different work_item_id.
          await t2Db.insert(schema.workItemTable).values({
            projectId: fixture.project.id,
            workspaceId: fixture.workspace.id,
            typeId: fixture.type.id,
            stateId: fixture.state.id,
            number: 101,
            key: sharedKey,
            title: "T2's own new item (collides on the shared key)",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        await t2Client.query("COMMIT");
      } catch (error) {
        await t2Client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }

    try {
      const [t1Result, t2Result] = await Promise.allSettled([
        runWithParentWriteDeadlockRetry(runT1),
        runWithParentWriteDeadlockRetry(runT2),
      ]);

      // The whole point of #295: neither caller ever sees the raw 40P01 (or any other
      // error) -- both operations end up committed.
      expect(t1Result.status).toBe("fulfilled");
      expect(t2Result.status).toBe("fulfilled");

      // A genuine deadlock -- and therefore a genuine retry -- actually happened on (at
      // least) one side. Without this, the test could pass "by accident" on an
      // interleaving that never actually contended.
      const totalAttempts = t1Attempts + t2Attempts;
      expect(totalAttempts).toBeGreaterThan(2);
      expect(t1Attempts).toBeLessThanOrEqual(2);
      expect(t2Attempts).toBeLessThanOrEqual(2);
    } finally {
      await t1Client.end();
      await t2Client.end();
      await observer.end();
    }

    // Final state: both reparents actually landed.
    const [reloadedA] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, itemA.id));
    const [reloadedB] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, itemB.id));
    expect(reloadedA?.parentId).toBe(root.id);
    expect(reloadedB?.parentId).toBe(root.id);

    // Exactly one work item ever ended up permanently holding `sharedKey` -- whichever
    // attempt was the deadlock victim rolled its own claim back, so the collision never
    // actually persisted twice.
    const claims = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM work_item_key_claim WHERE key = ${sharedKey}`,
    );
    expect(claims.rows[0]?.count).toBe("1");
  }, 20_000);

  it("sanity check: the interleaving above really does produce a raw 40P01 when nothing retries it", async () => {
    // Same race, unwrapped -- proves the deadlock itself (not just the retry helper's
    // own unit behaviour) is the real, live condition migration 0056 documents, and
    // that it is specifically 40P01 (a deadlock), never confused with the unrelated
    // P0001 cycle-rejection `set-work-item-parent.ts`'s own `isRaiseException` catch
    // handles.
    const fixture = await makeProjectFixture();
    const root = await makeWorkItem(fixture, 1);
    const itemA = await makeWorkItem(fixture, 2);
    const itemB = await makeWorkItem(fixture, 3);
    const sharedKey = `pwdr-collision-raw-${randomUUID()}`;

    const t1Client = await openRawClient();
    const t2Client = await openRawClient();
    const observer = await openRawClient();
    const t1Db = drizzle(t1Client, { schema });
    const t2Db = drizzle(t2Client, { schema });
    const t1Pid = await backendPid(t1Client);
    const t2Pid = await backendPid(t2Client);

    const t1ClaimedKey = deferred();
    const t2LockedRoot = deferred();

    async function runT1Once(): Promise<void> {
      await t1Client.query("BEGIN");
      await t1Db.insert(schema.workItemTable).values({
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number: 100,
        key: sharedKey,
        title: "T1's own new item",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      t1ClaimedKey.resolve();
      await t2LockedRoot.promise;
      await t1Db
        .update(schema.workItemTable)
        .set({ parentId: root.id })
        .where(eq(schema.workItemTable.id, itemB.id));
      await t1Client.query("COMMIT");
    }

    async function runT2Once(): Promise<void> {
      await t2Client.query("BEGIN");
      await t2Db
        .update(schema.workItemTable)
        .set({ parentId: root.id })
        .where(eq(schema.workItemTable.id, itemA.id));
      t2LockedRoot.resolve();
      await t1ClaimedKey.promise;
      await waitForBackendLockWait(observer, t1Pid, t2Pid);
      await t2Db.insert(schema.workItemTable).values({
        projectId: fixture.project.id,
        workspaceId: fixture.workspace.id,
        typeId: fixture.type.id,
        stateId: fixture.state.id,
        number: 101,
        key: sharedKey,
        title: "T2's own new item",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await t2Client.query("COMMIT");
    }

    try {
      const results = await Promise.allSettled([runT1Once(), runT2Once()]);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );

      expect(rejected).toHaveLength(1);
      const deadlockError = rejected[0]?.reason as
        | { code?: unknown; name?: unknown }
        | undefined;
      expect(
        isPostgresDeadlockError(rejected[0]?.reason),
        `Expected PostgreSQL 40P01; received name=${String(deadlockError?.name)} code=${String(deadlockError?.code)}`,
      ).toBe(true);
    } finally {
      await t1Client.query("ROLLBACK").catch(() => {});
      await t2Client.query("ROLLBACK").catch(() => {});
      await t1Client.end();
      await t2Client.end();
      await observer.end();
    }
  }, 20_000);
});
