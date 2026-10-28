/**
 * P5 round-2 review, snapshot invalidation:
 *  - P5-R2-01: events that cannot move a closed day (a new project, state, state template or KB
 *    article; a person's first user link) leave every closed-day marker trusted, while a genuine
 *    historical change still invalidates the day it touches.
 *  - P5-R2-05: a SERIALIZABLE source transaction that took its snapshot before the hourly writer
 *    certified a past day, and then writes a fact into that day, leaves the day untrusted, so it is
 *    recomputed with the fact.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import {
  costEntryTable,
  costTypeTable,
} from "../../apps/api/src/database/schema-p5-time";
import { dayKey, utcDayStart } from "../../apps/api/src/report/snapshot.logic";
import {
  workspaceDaysToWrite,
  writeWorkspaceDays,
} from "../../apps/api/src/report/snapshot.repository";
import { runMetricsSnapshot } from "../../apps/api/src/scheduler/report-jobs";
import { resetTestDatabase } from "./helpers/database";
import { workItemWorld } from "./helpers/p4-closeout";
import { insertArticle } from "./helpers/p5-kb";
import { daysAgo, type ReportsWorld, reportsWorld } from "./helpers/p5-reports";

let w: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
});

/** The closed days of a workspace whose marker is trusted now (current epoch and generation). */
async function trusted(workspaceId: string): Promise<Set<string>> {
  const rows = await db.execute<{ day: string }>(sql`SELECT
      to_char(d.period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
    FROM metric_snapshot_day d
    WHERE d.workspace_id = ${workspaceId}
      AND d.epoch = COALESCE((SELECT e.epoch FROM metric_snapshot_epoch e
        WHERE e.workspace_id = d.workspace_id), 0)
      AND d.gen = COALESCE((SELECT g.gen FROM metric_snapshot_day_gen g
        WHERE g.workspace_id = d.workspace_id AND g.period_start = d.period_start), 0)`);
  return new Set(rows.rows.map((row) => row.day));
}

const keyOf = (date: Date) => dayKey(utcDayStart(date));

async function newUser() {
  const id = `r2-user-${randomUUID()}`;
  await db
    .insert(schema.userTable)
    .values({ id, name: "Linked later", email: `${id}@example.test` });
  return id;
}

async function placeholderPerson(organisationId: string) {
  const [row] = await db
    .insert(schema.personTable)
    .values({
      organisationId,
      side: "customer",
      displayName: "Imported requester",
      isPlaceholder: true,
    })
    .returning();
  if (!row) throw new Error("person missing");
  return row;
}

async function seedHistory() {
  await w.addItem({
    createdDaysAgo: 21,
    resolvedDaysAgo: 18,
    priority: "high",
  });
  await w.addItem({ createdDaysAgo: 11, resolvedDaysAgo: 9, priority: "low" });
  // The other workspace has history of its own, so its markers can be watched too.
  const theirs = await workItemWorld(
    w.stranger.workspace.id,
    w.strangerProject.id,
  );
  const item = await theirs.makeItem("Stranger item");
  await db
    .update(schema.workItemTable)
    .set({ createdAt: daysAgo(15) })
    .where(eq(schema.workItemTable.id, item.id));
}

describe("only changes that can move a closed day invalidate it (P5-R2-01)", () => {
  it("creating a project, a state, a state template and a KB article leaves every marker trusted", async () => {
    await seedHistory();
    await runMetricsSnapshot(new Date());
    const ours = await trusted(w.workspaceId);
    const theirs = await trusted(w.stranger.workspace.id);
    expect(ours.size).toBeGreaterThan(10);
    expect(theirs.size).toBeGreaterThan(5);

    // A new project, copied from an existing one under a new id and slug.
    await db.execute(sql`INSERT INTO project
      SELECT (jsonb_populate_record(NULL::project, to_jsonb(p) || jsonb_build_object(
        'id', 'r2-new-project', 'slug', 'RTWO', 'name', 'Brand new project'))).*
      FROM project p WHERE p.id = ${w.projectA.id}`);
    const [template] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: w.workspaceId,
        key: `st-${randomUUID()}`,
        name: "Brand new state",
        group: "started",
      })
      .returning();
    if (!template) throw new Error("template missing");
    await db
      .insert(schema.stateTable)
      .values({ projectId: "r2-new-project", stateTemplateId: template.id });
    await insertArticle(w.workspaceId, {
      authorId: w.ownerPersonId,
      title: "Brand new article",
    });

    expect(await trusted(w.workspaceId)).toEqual(ours);
    expect(await trusted(w.stranger.workspace.id)).toEqual(theirs);
  });

  it("a placeholder person's first user link invalidates nothing when that user created no cost entry", async () => {
    await seedHistory();
    await runMetricsSnapshot(new Date());
    const ours = await trusted(w.workspaceId);
    const theirs = await trusted(w.stranger.workspace.id);
    const person = await placeholderPerson(w.customer.orgId);
    await db
      .update(schema.personTable)
      .set({ userId: await newUser() })
      .where(eq(schema.personTable.id, person.id));
    expect(await trusted(w.workspaceId)).toEqual(ours);
    expect(await trusted(w.stranger.workspace.id)).toEqual(theirs);
  });

  it("a user link invalidates exactly the days of the cost entries that user created, in that workspace only", async () => {
    await seedHistory();
    const creator = await newUser();
    const [type] = await db
      .insert(costTypeTable)
      .values({
        workspaceId: w.workspaceId,
        name: "Licence",
        unit: "seat",
        defaultRateMinor: 100,
        currency: "EUR",
      })
      .returning();
    if (!type) throw new Error("cost type missing");
    const entryDay = daysAgo(14);
    await db.insert(costEntryTable).values({
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      costTypeId: type.id,
      personId: w.ownerPersonId,
      date: keyOf(entryDay),
      units: 2,
      rateMinor: 100,
      amountMinor: 200,
      currency: "EUR",
      billable: true,
      createdBy: creator,
    });
    await runMetricsSnapshot(new Date());
    const ours = await trusted(w.workspaceId);
    const theirs = await trusted(w.stranger.workspace.id);
    expect(ours.has(keyOf(entryDay))).toBe(true);

    const person = await placeholderPerson(w.customer.orgId);
    await db
      .update(schema.personTable)
      .set({ userId: creator })
      .where(eq(schema.personTable.id, person.id));

    const after = await trusted(w.workspaceId);
    expect([...ours].filter((day) => !after.has(day))).toEqual([
      keyOf(entryDay),
    ]);
    expect(await trusted(w.stranger.workspace.id)).toEqual(theirs);
    // The creator dimension is computed again with the new link on the next run.
    await runMetricsSnapshot(new Date());
    expect(await trusted(w.workspaceId)).toEqual(ours);
    const facts = await db.execute<{ creator: string | null }>(sql`SELECT
        dimensions ->> 'creatorId' AS creator FROM metric_snapshot
      WHERE workspace_id = ${w.workspaceId} AND metric_key = 'cost_entry'
        AND period_start = ${utcDayStart(entryDay).toISOString()}::timestamptz`);
    expect(facts.rows.map((row) => row.creator)).toEqual([person.id]);
  });

  it("a genuine historical change still invalidates the day it touches", async () => {
    await seedHistory();
    const item = await w.addItem({ createdDaysAgo: 30, resolvedDaysAgo: 25 });
    await runMetricsSnapshot(new Date());
    const before = await trusted(w.workspaceId);
    const moved = daysAgo(20);
    expect(before.has(keyOf(moved))).toBe(true);
    await db
      .update(schema.workItemTable)
      .set({ resolvedAt: moved })
      .where(eq(schema.workItemTable.id, item.id));
    const after = await trusted(w.workspaceId);
    expect(after.has(keyOf(moved))).toBe(false);
    expect(after.has(keyOf(daysAgo(25)))).toBe(false);
    expect(await workspaceDaysToWrite(w.workspaceId)).toContain(keyOf(moved));
  });
});

describe("a backdated fact write in a SERIALIZABLE transaction is never hidden by a fresh marker (P5-R2-05)", () => {
  it("the writer certifies a past day after the transaction's snapshot; the day is recomputed with the fact", async () => {
    const item = await w.addItem({ createdDaysAgo: 30, resolvedDaysAgo: 2 });
    const target = daysAgo(20);
    const targetDay = keyOf(target);
    const throughput = async () => {
      const rows = await db.execute<{ completed: string | null }>(sql`SELECT
          sum((measures ->> 'completed')::numeric)::text AS completed
        FROM metric_snapshot
        WHERE workspace_id = ${w.workspaceId} AND metric_key = 'throughput'
          AND period_start = ${utcDayStart(target).toISOString()}::timestamptz`);
      return Number(rows.rows[0]?.completed ?? 0);
    };
    // No marker for the day yet: the writer's next run is a missing-day backfill (an INSERT).
    expect(await trusted(w.workspaceId)).not.toContain(targetDay);

    const client = await getDatabasePool().connect();
    try {
      // 1. An import-like transaction takes its snapshot before the writer runs.
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query("SELECT count(*) FROM work_item");
      // 2. The hourly writer certifies the past day without the transaction's change.
      const written = await writeWorkspaceDays(w.workspaceId, [targetDay]);
      expect(written.days).toBe(1);
      expect(await throughput()).toBe(0);
      expect(await trusted(w.workspaceId)).toContain(targetDay);
      // 3. The transaction backdates a resolution into that day and commits.
      await client.query(
        "UPDATE work_item SET resolved_at = $1 WHERE id = $2",
        [target.toISOString(), item.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    // The fresh marker is not trusted: the day is due again although it is outside the lookback.
    expect(await trusted(w.workspaceId)).not.toContain(targetDay);
    expect(await workspaceDaysToWrite(w.workspaceId)).toContain(targetDay);
    await writeWorkspaceDays(w.workspaceId, [targetDay]);
    expect(await trusted(w.workspaceId)).toContain(targetDay);
    expect(await throughput()).toBe(1);
  });

  it("a day held by an open source write is still skipped, never waited for", async () => {
    const item = await w.addItem({ createdDaysAgo: 30, resolvedDaysAgo: 20 });
    const day = keyOf(daysAgo(20));
    const client = await getDatabasePool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query(
        "UPDATE work_item SET priority = 'urgent' WHERE id = $1",
        [item.id],
      );
      const skipped = await Promise.race([
        writeWorkspaceDays(w.workspaceId, [day]),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
      ]);
      expect(skipped).toEqual({ days: 0, rows: 0 });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect((await writeWorkspaceDays(w.workspaceId, [day])).days).toBe(1);
    expect(await trusted(w.workspaceId)).toContain(day);
  });
});
