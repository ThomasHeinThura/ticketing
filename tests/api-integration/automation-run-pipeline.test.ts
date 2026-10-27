/**
 * Automation pipeline against the database (`AM-2`, `AM-5`, `AM-6`, `AM-7`, `AM-8`, `AM-10`,
 * `EV-3`): the parent consumer records one pending run per matching enabled rule in position
 * order, the loop guards decide before a run exists, and the executor records every outcome and
 * never re-runs an interrupted run.
 *
 * No work item is needed: the events here carry none, which is exactly the case where an action
 * that needs an item must fail with a recorded reason and the next rule must still be handled.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueueAutomationRuns } from "../../apps/api/src/automation/consumer";
import {
  abandonStaleRuns,
  processNextAutomationEvent,
} from "../../apps/api/src/automation/executor";
import {
  type AutomationActor,
  createAutomation,
  setAutomationEnabled,
} from "../../apps/api/src/automation/repository";
import { validateRuleDefinition } from "../../apps/api/src/automation/validation";
import db, { schema } from "../../apps/api/src/database";
import {
  automationRunTable,
  automationTable,
  workspaceFeatureFlagTable,
} from "../../apps/api/src/database/schema";
import { enqueueOutboxEvent } from "../../apps/api/src/events/outbox";
import { parseParentEnvelope } from "../../apps/api/src/events/outbox-consumer";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

type RuleOptions = {
  name: string;
  trigger?: string;
  projectId?: string | null;
  projectFilter?: string[];
  stopProcessing?: boolean;
  enabled?: boolean;
  conditions?: unknown[];
};

async function world() {
  const { user, workspace } = await createWorkspaceMember();
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id))
      .limit(1),
    "person",
  );
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "workspace",
        workspaceId: workspace.id,
        key: `automation-agent-${randomUUID()}`,
        name: "Automation agent",
        rank: 50,
        capabilities: ["work_item:read", "work_item:assign"],
      })
      .returning(),
    "role",
  );
  await db.insert(workspaceFeatureFlagTable).values({
    workspaceId: workspace.id,
    featureKey: "feature.automations",
    enabled: true,
  });
  const actor: AutomationActor = {
    userId: user.id,
    personId: person.id,
    actorType: "person",
    apiKeyId: null,
  };

  async function rule(options: RuleOptions) {
    const validated = validateRuleDefinition({
      trigger: options.trigger ?? "work_item.created",
      conditions: options.conditions ?? [],
      actions: [{ type: "assign", assigneeId: person.id }],
      projectFilter: options.projectFilter ?? null,
    });
    if (!validated.ok) throw new Error(JSON.stringify(validated.problems));
    const created = await createAutomation({
      workspaceId: workspace.id,
      projectId: options.projectId ?? null,
      name: options.name,
      effectiveRoleId: role.id,
      stopProcessing: options.stopProcessing ?? false,
      definition: validated.value,
      actor,
    });
    // AM-10: created disabled, enabled by a deliberate act.
    expect(created.enabled).toBe(false);
    if (options.enabled !== false)
      await setAutomationEnabled(created.id, true, actor);
    return created;
  }

  async function emit(
    over: {
      kind?: string;
      depth?: number;
      origin?: string | null;
      projectId?: string;
    } = {},
  ) {
    const id = `evt_${randomUUID()}`;
    await db.transaction((tx) =>
      enqueueOutboxEvent(tx, {
        id,
        kind: over.kind ?? "work_item.created",
        occurredAt: new Date().toISOString(),
        actor: { type: "person", id: user.id, name: "Someone" },
        scope: {
          workspaceId: workspace.id,
          ...(over.projectId ? { projectId: over.projectId } : {}),
        },
        payload: {},
        causationId: null,
        depth: over.depth ?? 0,
        originAutomationId: over.origin ?? null,
      }),
    );
    const [row] = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.eventId, id));
    return {
      id,
      envelope: parseParentEnvelope(requireRow(row ? [row] : [], "outbox")),
    };
  }

  return { user, workspace, person, role, rule, emit };
}

async function runs(automationId?: string) {
  const rows = await db.select().from(automationRunTable);
  return automationId
    ? rows.filter((row) => row.automationId === automationId)
    : rows;
}

describe("automation pipeline", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("records one pending run per matching enabled rule in position order, and a replay adds none (AM-2, AM-6, EV-2)", async () => {
    const w = await world();
    const first = await w.rule({ name: "first" });
    const second = await w.rule({ name: "second" });
    await w.rule({ name: "disabled", enabled: false });
    await w.rule({ name: "other trigger", trigger: "work_item.assigned" });
    const { envelope } = await w.emit();

    for (let replay = 0; replay < 2; replay++)
      await db.transaction((tx) => enqueueAutomationRuns(tx, envelope));

    const all = await runs();
    expect(all).toHaveLength(2);
    expect(all.map((run) => run.state)).toEqual(["pending", "pending"]);
    const byPosition = [...all].sort((a, b) => a.position - b.position);
    expect(byPosition.map((run) => run.automationId)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("queues nothing while feature.automations is off for the workspace", async () => {
    const w = await world();
    await w.rule({ name: "rule" });
    await db
      .update(workspaceFeatureFlagTable)
      .set({ enabled: false })
      .where(eq(workspaceFeatureFlagTable.workspaceId, w.workspace.id));
    const { envelope } = await w.emit();
    await db.transaction((tx) => enqueueAutomationRuns(tx, envelope));
    expect(await runs()).toHaveLength(0);
  });

  it("scopes a project rule to its project and a workspace rule to its project filter", async () => {
    const w = await world();
    const { project: a } = await createProjectFixture({
      workspaceId: w.workspace.id,
    });
    const { project: b } = await createProjectFixture({
      workspaceId: w.workspace.id,
    });
    const projectRule = await w.rule({ name: "A only", projectId: a.id });
    const filtered = await w.rule({ name: "B only", projectFilter: [b.id] });
    const everywhere = await w.rule({ name: "everywhere" });

    const inA = await w.emit({ projectId: a.id });
    await db.transaction((tx) => enqueueAutomationRuns(tx, inA.envelope));
    expect((await runs()).map((run) => run.automationId).sort()).toEqual(
      [projectRule.id, everywhere.id].sort(),
    );

    const inB = await w.emit({ projectId: b.id });
    await db.transaction((tx) => enqueueAutomationRuns(tx, inB.envelope));
    const forB = (await runs()).filter((run) => run.eventId === inB.id);
    expect(forB.map((run) => run.automationId).sort()).toEqual(
      [filtered.id, everywhere.id].sort(),
    );
  });

  it("does not re-trigger a rule on the event its own action produced (AM-5)", async () => {
    const w = await world();
    const rule = await w.rule({ name: "self" });
    const { envelope } = await w.emit({ depth: 1, origin: rule.id });
    await db.transaction((tx) => enqueueAutomationRuns(tx, envelope));
    expect(await runs()).toHaveLength(0);
  });

  it("abandons a chain at depth 5, records the error, flags the rule and emits automation.run_failed (EV-3)", async () => {
    const w = await world();
    const rule = await w.rule({ name: "loop" });
    const other = await w.rule({ name: "partner" });
    const { envelope } = await w.emit({ depth: 5, origin: other.id });
    await db.transaction((tx) => enqueueAutomationRuns(tx, envelope));

    const forRule = await runs(rule.id);
    expect(forRule).toHaveLength(1);
    expect(forRule[0]).toMatchObject({ state: "failed", depth: 5 });
    expect(forRule[0]?.error).toContain("loop_depth_limit");
    const [flagged] = await db
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, rule.id));
    expect(flagged?.flaggedReason).toBe("loop_depth_limit");
    const failedEvents = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "automation.run_failed"));
    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
    // The other half of the pair is surfaced too: flagged, with a failed run of its own.
    const [partner] = await db
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, other.id));
    expect(partner?.flaggedReason).toBe("loop_depth_limit");
    const partnerRuns = await runs(other.id);
    expect(partnerRuns).toHaveLength(1);
    expect(partnerRuns[0]).toMatchObject({ state: "failed" });
  });

  it("records a failing action, still finishes the rule, and a stop_processing rule skips the rest (AM-6, AM-7, AM-8)", async () => {
    const w = await world();
    const first = await w.rule({ name: "stops", stopProcessing: true });
    const second = await w.rule({ name: "never runs" });
    const { envelope } = await w.emit();
    await db.transaction((tx) => enqueueAutomationRuns(tx, envelope));

    expect(await processNextAutomationEvent()).toEqual({
      kind: "ran",
      runs: 2,
    });
    const [ran] = await runs(first.id);
    expect(ran).toMatchObject({ state: "failed", matched: true });
    expect(ran?.results).toEqual([
      expect.objectContaining({
        type: "assign",
        ok: false,
        error: "no_work_item",
      }),
    ]);
    const [skipped] = await runs(second.id);
    expect(skipped).toMatchObject({
      state: "skipped",
      error: "stopped_by_earlier_rule",
    });
    const [counted] = await db
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, first.id));
    expect(counted?.fireCount).toBe(1);
    expect(counted?.lastRunAt).not.toBeNull();
    // Nothing is left to claim, and nothing runs twice.
    expect(await processNextAutomationEvent()).toEqual({ kind: "idle" });
    const failedEvents = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "automation.run_failed"));
    expect(
      failedEvents.some(
        (event) =>
          (event.payload as { payload?: { runId?: string } }).payload?.runId ===
          ran?.id,
      ),
    ).toBe(true);
  });

  it("commits a failed run and its automation.run_failed event together (P0R1-05)", async () => {
    const w = await world();
    const rule = await w.rule({ name: "fails atomically" });
    const { envelope } = await w.emit();
    await db.transaction((tx) => enqueueAutomationRuns(tx, envelope));
    await db.execute(sql`
      CREATE FUNCTION p0_fail_run_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.kind = 'automation.run_failed' THEN
          RAISE EXCEPTION 'simulated failure while recording the event';
        END IF;
        RETURN NEW;
      END $$`);
    await db.execute(sql`
      CREATE TRIGGER p0_fail_run_event BEFORE INSERT ON outbox
      FOR EACH ROW EXECUTE FUNCTION p0_fail_run_event()`);
    try {
      await expect(processNextAutomationEvent()).rejects.toThrow();
    } finally {
      await db.execute(sql`DROP TRIGGER p0_fail_run_event ON outbox`);
      await db.execute(sql`DROP FUNCTION p0_fail_run_event()`);
    }
    // The run was not left `failed` without its event: it is still running (and is later
    // abandoned by the stale-run sweep), and no event was written.
    const [run] = await runs(rule.id);
    expect(run?.state).toBe("running");
    const events = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "automation.run_failed"));
    expect(events).toHaveLength(0);
  });

  it("records a rule that does not match without running its actions (AM-1)", async () => {
    const w = await world();
    const rule = await w.rule({
      name: "needs an urgent item",
      conditions: [{ field: "priority", op: "eq", value: "urgent" }],
    });
    const { envelope } = await w.emit();
    await db.transaction((tx) => enqueueAutomationRuns(tx, envelope));
    await processNextAutomationEvent();
    const [run] = await runs(rule.id);
    expect(run).toMatchObject({ state: "done", matched: false });
    const [live] = await db
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, rule.id));
    expect(live?.fireCount).toBe(0);
  });

  it("marks an interrupted run abandoned and never runs it again", async () => {
    const w = await world();
    const rule = await w.rule({ name: "interrupted" });
    const { envelope } = await w.emit();
    await db.transaction((tx) => enqueueAutomationRuns(tx, envelope));
    await db
      .update(automationRunTable)
      .set({
        state: "running",
        leaseExpiresAt: new Date(Date.now() - 60_000),
      })
      .where(eq(automationRunTable.automationId, rule.id));

    expect(await abandonStaleRuns()).toBe(1);
    const [run] = await runs(rule.id);
    expect(run).toMatchObject({ state: "abandoned" });
    expect(await processNextAutomationEvent()).toEqual({ kind: "idle" });
  });
});
