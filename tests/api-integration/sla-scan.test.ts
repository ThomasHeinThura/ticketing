import { randomUUID } from "node:crypto";
import { eq, like, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { slaPauseTable } from "../../apps/api/src/database/migration-schema";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import {
  scanSla,
  scanWorkItemSla,
} from "../../apps/api/src/scheduler/sla-scan";
import { getWorkItemSla } from "../../apps/api/src/work-item/controllers/get-work-item-sla";
import { transitionWorkItem } from "../../apps/api/src/work-item/controllers/transition-work-item";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
async function fixture(elapsed = 85) {
  const owner = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  await grantWorkItemProjectAccess(owner.user.id, project.id);
  const state = async (group: string) => {
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: owner.workspace.id,
          key: randomUUID(),
          name: group,
          group,
        })
        .returning(),
      "template",
    );
    const adopted = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: template.id,
          isDefault: group === "started",
        })
        .returning(),
      "state",
    );
    return { template, adopted };
  };
  const open = await state("started");
  const done = await state("completed");
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({
        workspaceId: owner.workspace.id,
        key: randomUUID(),
        name: "SLA lifecycle",
      })
      .returning(),
    "workflow",
  );
  const workflowVersion = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "workflow version",
  );
  await db.insert(schema.workflowTransitionTable).values({
    versionId: workflowVersion.id,
    fromStateTemplateId: open.template.id,
    toStateTemplateId: done.template.id,
    guards: [],
    effects: [],
  });
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: workflowVersion.id })
    .where(eq(schema.workflowTable.id, workflow.id));
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: owner.workspace.id,
        key: randomUUID(),
        name: "Incident",
        category: "service",
        workflowId: workflow.id,
      })
      .returning(),
    "type",
  );
  const calendar = requireRow(
    await db
      .insert(schema.serviceCalendarTable)
      .values({
        workspaceId: owner.workspace.id,
        name: "Always",
        timezone: "UTC",
        windows: Object.fromEntries(
          ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
            day,
            [{ from: 0, to: 1440 }],
          ]),
        ),
        holidays: [],
      })
      .returning(),
    "calendar",
  );
  const policy = requireRow(
    await db
      .insert(schema.slaPolicyTable)
      .values({ workspaceId: owner.workspace.id, name: "100 minutes" })
      .returning(),
    "policy",
  );
  const version = requireRow(
    await db
      .insert(schema.slaPolicyVersionTable)
      .values({
        workspaceId: owner.workspace.id,
        policyId: policy.id,
        calendarId: calendar.id,
        number: 1,
        atRiskThresholdPct: 75,
      })
      .returning(),
    "version",
  );
  await db.insert(schema.slaGoalTable).values(
    (["first_response", "resolution"] as const).flatMap((metric) =>
      (["low", "medium", "high", "urgent"] as const).map((priority) => ({
        workspaceId: owner.workspace.id,
        versionId: version.id,
        metric,
        priority,
        workItemTypeId: type.id,
        targetMinutes: 100,
      })),
    ),
  );
  await db
    .update(schema.slaPolicyVersionTable)
    .set({ effectiveFrom: ago(24 * 60) })
    .where(eq(schema.slaPolicyVersionTable.id, version.id));
  await db
    .update(schema.slaPolicyTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.slaPolicyTable.id, policy.id));
  const item = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId: owner.workspace.id,
        projectId: project.id,
        typeId: type.id,
        stateId: open.adopted.id,
        number: 1,
        key: `${project.slug}-1`,
        title: "Persisted SLA",
        priority: "high",
        slaPolicyVersionId: version.id,
        slaStartedAt: ago(elapsed),
      })
      .returning(),
    "item",
  );
  const identity = await resolveRequestIdentity({ userId: owner.user.id });
  if (!identity) throw new Error("Fixture identity missing");
  return { owner, project, type, item, done, identity };
}
async function events() {
  return db
    .select()
    .from(schema.outboxTable)
    .where(like(schema.outboxTable.kind, "sla.%"));
}
async function complete(f: Awaited<ReturnType<typeof fixture>>) {
  return transitionWorkItem(
    f.item.id,
    f.identity,
    f.identity.personId,
    f.owner.user.id,
    "person",
    { toStateTemplateId: f.done.template.id },
  );
}

describe("persisted SLA scan and completion", () => {
  beforeEach(async () => resetTestDatabase());
  it("registers real edge cache and emits exactly once across duplicate/concurrent scans", async () => {
    const f = await fixture();
    expect(
      (
        await Promise.all([
          scanWorkItemSla(f.item.id),
          scanWorkItemSla(f.item.id),
        ])
      ).sort(),
    ).toEqual([0, 2]);
    expect(await scanWorkItemSla(f.item.id)).toBe(0);
    expect((await events()).map((event) => event.kind)).toEqual([
      "sla.at_risk",
      "sla.at_risk",
    ]);
    const cached = await db.select().from(schema.workItemSlaCacheTable);
    expect(cached).toHaveLength(2);
    expect(
      cached.every(
        (row) => row.state === "at_risk" && row.computedAt instanceof Date,
      ),
    ).toBe(true);
  });
  it("paused time freezes alerts; resume emits only the genuine later edge", async () => {
    const f = await fixture(130);
    const pauses = await db
      .insert(slaPauseTable)
      .values(
        (["first_response", "resolution"] as const).map((metric) => ({
          workItemId: f.item.id,
          metric,
          startedAt: ago(80),
          reason: "manual",
        })),
      )
      .returning();
    expect(await scanWorkItemSla(f.item.id)).toBe(0);
    expect(
      (await db.select().from(schema.workItemSlaCacheTable)).every(
        (row) => row.state === "ok" && row.dueAt === null,
      ),
    ).toBe(true);
    await db
      .update(slaPauseTable)
      .set({ endedAt: ago(40) })
      .where(eq(slaPauseTable.workItemId, f.item.id));
    expect(await scanWorkItemSla(f.item.id)).toBe(2);
    expect(
      (await events()).every((event) => event.kind === "sla.at_risk"),
    ).toBe(true);
    expect(pauses).toHaveLength(2);
    await db
      .update(schema.workItemTable)
      .set({ slaStartedAt: ago(180) })
      .where(eq(schema.workItemTable.id, f.item.id));
    expect(await scanWorkItemSla(f.item.id)).toBe(2);
    expect(
      (await events()).filter((event) => event.kind === "sla.breached"),
    ).toHaveLength(2);
  });
  it("uses each tenant's pinned policy and skips deleted, archived and resolved items", async () => {
    const a = await fixture(85);
    const b = await fixture(120);
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, b.project.id));
    expect(await scanSla()).toMatchObject({
      scanned: 2,
      emitted: 2,
      degraded: false,
    });
    expect(
      (await events()).every(
        (event) => event.workspaceId === a.owner.workspace.id,
      ),
    ).toBe(true);
    await db
      .update(schema.workItemTable)
      .set({ resolvedAt: new Date() })
      .where(eq(schema.workItemTable.id, a.item.id));
    expect(await scanWorkItemSla(a.item.id)).toBe(0);
    expect(await scanWorkItemSla(b.item.id)).toBe(0);
  });
  it("completion emits met/missed in the actual transition transaction and scanner never settles outcomes", async () => {
    const met = await fixture(20);
    await db
      .update(schema.workItemTable)
      .set({ firstResponseAt: ago(10) })
      .where(eq(schema.workItemTable.id, met.item.id));
    await complete(met);
    const missed = await fixture(130);
    await complete(missed);
    expect((await events()).map((event) => event.kind).sort()).toEqual([
      "sla.met",
      "sla.met",
      "sla.missed",
    ]);
    expect(await scanWorkItemSla(met.item.id)).toBe(0);
    expect(await scanWorkItemSla(missed.item.id)).toBe(0);
    const detail = await getWorkItemSla(
      missed.item.key,
      missed.owner.workspace.id,
    );
    expect(
      detail.metrics.find((metric) => metric.metric === "resolution")?.state,
    ).toBe("missed");
  });
  it("rolls back cache with outbox failure instead of swallowing or consuming an edge", async () => {
    const f = await fixture();
    await db.execute(
      sql`CREATE FUNCTION sla_outbox_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind LIKE 'sla.%' THEN RAISE EXCEPTION 'probe'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER sla_outbox_probe BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION sla_outbox_probe()`,
    );
    try {
      await expect(scanWorkItemSla(f.item.id)).rejects.toThrow();
      expect(await db.select().from(schema.workItemSlaCacheTable)).toHaveLength(
        0,
      );
      expect(await events()).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER sla_outbox_probe ON outbox`);
      await db.execute(sql`DROP FUNCTION sla_outbox_probe()`);
    }
    expect(await scanWorkItemSla(f.item.id)).toBe(2);
  });
  it("honours another replica's live lease and leaves work available after release", async () => {
    await fixture();
    await db.insert(schema.jobLeaseTable).values({
      name: "sla-scan",
      owner: "another-replica",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await scanSla()).toEqual({
      scanned: 0,
      emitted: 0,
      degraded: false,
    });
    expect(await events()).toHaveLength(0);
    await db
      .delete(schema.jobLeaseTable)
      .where(eq(schema.jobLeaseTable.name, "sla-scan"));
    expect(await scanSla()).toMatchObject({
      scanned: 1,
      emitted: 2,
      degraded: false,
    });
  });
  it("detail recomputes instead of trusting cache, and binding edits do not repin an item", async () => {
    const f = await fixture();
    await db
      .update(schema.workItemTypeTable)
      .set({ slaPolicyId: null })
      .where(eq(schema.workItemTypeTable.id, f.type.id));
    expect(await scanWorkItemSla(f.item.id)).toBe(2);
    await db
      .update(schema.workItemSlaCacheTable)
      .set({ state: "ok" })
      .where(eq(schema.workItemSlaCacheTable.workItemId, f.item.id));
    const detail = await getWorkItemSla(f.item.key, f.owner.workspace.id);
    expect(detail.metrics.every((metric) => metric.state === "at_risk")).toBe(
      true,
    );
    await expect(
      db
        .update(schema.workItemSlaCacheTable)
        .set({ state: "invented" })
        .where(eq(schema.workItemSlaCacheTable.workItemId, f.item.id)),
    ).rejects.toThrow();
  });
  it("rolls back the actual completed transition when its SLA outcome cannot persist", async () => {
    const f = await fixture(130);
    await db.execute(
      sql`CREATE FUNCTION sla_outcome_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'sla.missed' THEN RAISE EXCEPTION 'probe'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER sla_outcome_probe BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION sla_outcome_probe()`,
    );
    try {
      await expect(complete(f)).rejects.toThrow();
      const [item] = await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, f.item.id));
      expect(item?.stateId).toBe(f.item.stateId);
      expect(item?.resolvedAt).toBeNull();
      expect(await db.select().from(schema.workItemSlaCacheTable)).toHaveLength(
        0,
      );
      expect(await events()).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER sla_outcome_probe ON outbox`);
      await db.execute(sql`DROP FUNCTION sla_outcome_probe()`);
    }
    await complete(f);
    expect((await events()).map((event) => event.kind)).toEqual(["sla.missed"]);
  });
  it("waits for the actual completing transition and emits no posthumous alerts", async () => {
    const f = await fixture(130);
    const raw = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await raw.connect();
    await raw.query("BEGIN");
    await raw.query("SELECT pg_advisory_xact_lock(782021, 1)");
    await db.execute(
      sql`CREATE FUNCTION sla_completion_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'sla.missed' THEN PERFORM pg_advisory_xact_lock(782021, 1); END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER sla_completion_gate BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION sla_completion_gate()`,
    );
    const completion = complete(f);
    let scan: Promise<number> | undefined;
    const waitForLocks = async (count: number) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        await raw.query("SELECT pg_stat_clear_snapshot()");
        const status = await raw.query(
          "SELECT count(*)::integer AS blocked FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'",
        );
        if (status.rows[0].blocked >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Expected PostgreSQL lock wait did not occur");
    };
    try {
      // The real transition owns the item and waits inside its outcome write.
      await waitForLocks(1);
      scan = scanWorkItemSla(f.item.id);
      await waitForLocks(2);
      await raw.query("COMMIT");
      await completion;
      expect(await scan).toBe(0);
      expect((await events()).map((event) => event.kind)).toEqual([
        "sla.missed",
      ]);
    } finally {
      await raw.query("ROLLBACK");
      await Promise.allSettled([completion, ...(scan ? [scan] : [])]);
      await db.execute(sql`DROP TRIGGER sla_completion_gate ON outbox`);
      await db.execute(sql`DROP FUNCTION sla_completion_gate()`);
      await raw.end();
    }
  });
});
