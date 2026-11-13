/**
 * Automation actions `post_comment` and `transition`, and the `sla_state` condition, against the
 * database (`AM-3`, `AM-4`, `AM-5`, `AM-7`, `AM-11`). Every run goes through the real pipeline:
 * outbox event -> parent consumer -> claimed run -> executor.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueAutomationRuns } from "../../apps/api/src/automation/consumer";
import {
  abandonStaleRuns,
  claimNextAutomationEvent,
  processNextAutomationEvent,
} from "../../apps/api/src/automation/executor";
import {
  customerCommentFact,
  loadWorkItemsByKey,
} from "../../apps/api/src/automation/facts";
import {
  type AutomationActor,
  createAutomation,
  setAutomationEnabled,
} from "../../apps/api/src/automation/repository";
import { runAutomationSchedule } from "../../apps/api/src/automation/schedule";
import { validateRuleDefinition } from "../../apps/api/src/automation/validation";
import db, { schema } from "../../apps/api/src/database";
import {
  automationRunTable,
  automationTable,
  workspaceFeatureFlagTable,
} from "../../apps/api/src/database/schema";
import { enqueueOutboxEvent } from "../../apps/api/src/events/outbox";
import { parseParentEnvelope } from "../../apps/api/src/events/outbox-consumer";
import { createApp } from "../../apps/api/src/index";
import * as scheduler from "../../apps/api/src/scheduler";
import transitionWorkItem, {
  TransitionConflictError,
} from "../../apps/api/src/work-item/controllers/transition-work-item";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import { workItemWorld } from "./helpers/p4-closeout";
import { ensureCreationWorkflow } from "./helpers/workflow";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

async function world(capabilities: string[]) {
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
        capabilities,
      })
      .returning(),
    "role",
  );
  await db.insert(workspaceFeatureFlagTable).values({
    workspaceId: workspace.id,
    featureKey: "feature.automations",
    enabled: true,
  });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  const rows = await workItemWorld(workspace.id, project.id);
  const item = await rows.makeItem("Printer on fire");
  const actor: AutomationActor = {
    userId: user.id,
    personId: person.id,
    actorType: "person",
    apiKeyId: null,
  };

  async function rule(options: {
    name: string;
    trigger?: string;
    scheduleCron?: string;
    actions: unknown[];
    conditions?: unknown[];
  }) {
    const validated = validateRuleDefinition(
      {
        trigger: options.trigger ?? "work_item.created",
        scheduleCron: options.scheduleCron,
        conditions: options.conditions ?? [],
        actions: options.actions,
      },
      { scheduleAvailable: true },
    );
    if (!validated.ok) throw new Error(JSON.stringify(validated.problems));
    const created = await createAutomation({
      workspaceId: workspace.id,
      projectId: project.id,
      name: options.name,
      effectiveRoleId: role.id,
      stopProcessing: false,
      definition: validated.value,
      actor,
    });
    await setAutomationEnabled(created.id, true, actor);
    return created;
  }

  async function emit(
    kind = "work_item.created",
    origin: string | null = null,
  ) {
    const id = `evt_${randomUUID()}`;
    await db.transaction((tx) =>
      enqueueOutboxEvent(tx, {
        id,
        kind,
        occurredAt: new Date().toISOString(),
        actor: { type: "person", id: user.id, name: "Someone" },
        scope: { workspaceId: workspace.id, projectId: project.id },
        payload: { key: item.key },
        causationId: null,
        depth: 0,
        originAutomationId: origin,
      }),
    );
    const [row] = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.eventId, id));
    return parseParentEnvelope(requireRow(row ? [row] : [], "outbox"));
  }

  async function runOnce(envelope: Awaited<ReturnType<typeof emit>>) {
    await db.transaction((tx) => enqueueAutomationRuns(tx, envelope));
    return processNextAutomationEvent();
  }

  async function lastRun() {
    const all = await db.select().from(automationRunTable);
    return requireRow(all.slice(-1), "run");
  }

  return {
    user,
    workspace,
    project,
    person,
    role,
    rows,
    item,
    rule,
    emit,
    runOnce,
    lastRun,
  };
}

async function serviceWorld() {
  const w = await world(["work_item:read", "work_item:transition"]);
  await ensureCreationWorkflow({
    workspaceId: w.workspace.id,
    projectId: w.project.id,
    typeId: w.rows.type.id,
  });
  const edge = requireRow(
    await db
      .select()
      .from(schema.workflowTransitionTable)
      .where(
        eq(
          schema.workflowTransitionTable.fromStateTemplateId,
          w.rows.template.id,
        ),
      ),
    "edge",
  );
  const resolved = requireRow(
    await db
      .select()
      .from(schema.stateTable)
      .where(
        and(
          eq(schema.stateTable.projectId, w.project.id),
          eq(schema.stateTable.stateTemplateId, edge.toStateTemplateId),
        ),
      ),
    "resolved",
  );
  const closed = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: w.workspace.id,
        key: `closed-${randomUUID()}`,
        name: "Closed",
        group: "completed",
      })
      .returning(),
    "closed",
  );
  const closedState = requireRow(
    await db
      .insert(schema.stateTable)
      .values({ projectId: w.project.id, stateTemplateId: closed.id })
      .returning(),
    "closed state",
  );
  await db.insert(schema.workflowTransitionTable).values([
    {
      versionId: edge.versionId,
      fromStateTemplateId: resolved.stateTemplateId,
      toStateTemplateId: w.rows.template.id,
      isReopen: true,
    },
    {
      versionId: edge.versionId,
      fromStateTemplateId: resolved.stateTemplateId,
      toStateTemplateId: closed.id,
    },
  ]);
  async function resolve(days: number) {
    const when = new Date(Date.now() - days * 86400000);
    await db
      .update(schema.workItemTable)
      .set({ stateId: resolved.id })
      .where(eq(schema.workItemTable.id, w.item.id));
    await db.insert(schema.activityTable).values({
      workspaceId: w.workspace.id,
      workItemId: w.item.id,
      actorType: "system",
      verb: "transitioned",
      oldValue: w.rows.state.id,
      newValue: resolved.id,
      createdAt: when,
    });
  }
  async function currentState() {
    return requireRow(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, w.item.id)),
      "item",
    ).stateId;
  }
  async function closeRule() {
    return w.rule({
      name: "Close after three days",
      trigger: "schedule",
      scheduleCron: "*/5 * * * *",
      conditions: [
        { field: "state.group", op: "eq", value: "completed" },
        { field: "age", op: "gte", basis: "resolved_at", value: 4320 },
      ],
      actions: [{ type: "transition", toStateTemplateId: closed.id }],
    });
  }
  return {
    ...w,
    resolve,
    resolved,
    closed,
    closedState,
    currentState,
    closeRule,
  };
}

describe("G-1 service desk automations", () => {
  beforeEach(async () => resetTestDatabase());
  it("creates and enables both target definitions through the authenticated API", async () => {
    const catalog = vi
      .spyOn(scheduler, "liveRegisteredJobCatalog")
      .mockReturnValue([
        { name: "automation-schedule", enabled: true } as ReturnType<
          typeof scheduler.liveRegisteredJobCatalog
        >[number],
      ]);
    const { app } = createApp();
    const owner = await signUpUser(app);
    const response = await createWorkspaceNative(app, owner.cookie, {
      name: "Service automations",
    });
    const workspace = (await response.json()) as { id: string };
    await db.insert(workspaceFeatureFlagTable).values({
      workspaceId: workspace.id,
      featureKey: "feature.automations",
      enabled: true,
    });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const role = requireRow(
      await db
        .select()
        .from(schema.roleTable)
        .where(
          and(
            eq(schema.roleTable.workspaceId, workspace.id),
            eq(schema.roleTable.key, "member"),
          ),
        ),
      "role",
    );
    const rows = await workItemWorld(workspace.id, project.id);
    const definitions = [
      {
        name: "Reopen",
        trigger: "work_item.commented",
        conditions: [
          { field: "actor_role", op: "eq", value: "customer" },
          { field: "state.group", op: "eq", value: "completed" },
        ],
      },
      {
        name: "Close",
        trigger: "schedule",
        scheduleCron: "0 * * * *",
        conditions: [
          { field: "state.group", op: "eq", value: "completed" },
          { field: "age", op: "gte", value: 4320, basis: "resolved_at" },
        ],
      },
    ];
    for (const definition of definitions) {
      const created = await csrfRequest(
        app,
        `/api/projects/${project.slug}/automations`,
        {
          method: "POST",
          headers: { cookie: owner.cookie, "content-type": "application/json" },
          body: JSON.stringify({
            ...definition,
            effectiveRoleId: role.id,
            actions: [
              { type: "transition", toStateTemplateId: rows.template.id },
            ],
          }),
        },
        owner.cookie,
      );
      expect(created.status, await created.clone().text()).toBe(201);
      const rule = (await created.json()) as { id: string };
      const enabled = await csrfRequest(
        app,
        `/api/automations/${rule.id}/enable`,
        {
          method: "POST",
          headers: { cookie: owner.cookie, "content-type": "application/json" },
          body: "{}",
        },
        owner.cookie,
      );
      expect(enabled.status, await enabled.clone().text()).toBe(200);
    }
    catalog.mockRestore();
  });
  it.each([2, 3])(
    "closes at three days, age=%i; a later note does not reset age",
    async (days) => {
      const w = await serviceWorld();
      await w.resolve(days);
      const rule = await w.closeRule();
      await db.insert(schema.activityTable).values({
        workspaceId: w.workspace.id,
        workItemId: w.item.id,
        actorType: "person",
        actorId: w.person.id,
        verb: "commented",
        visibility: "internal",
      });
      await Promise.all([runAutomationSchedule(), runAutomationSchedule()]);
      await processNextAutomationEvent();
      expect(await w.currentState()).toBe(
        days === 3 ? w.closedState.id : w.resolved.id,
      );
      const runs = await db
        .select()
        .from(automationRunTable)
        .where(eq(automationRunTable.automationId, rule.id));
      expect(runs.filter((r) => r.workItemId === w.item.id)).toHaveLength(
        days === 3 ? 1 : 0,
      );
      if (days === 3) {
        const before = await db.select().from(schema.outboxTable);
        await runAutomationSchedule(new Date(Date.now() + 3600000));
        await runAutomationSchedule(new Date(Date.now() + 7200000));
        await processNextAutomationEvent();
        const after = await db
          .select()
          .from(automationRunTable)
          .where(
            and(
              eq(automationRunTable.automationId, rule.id),
              eq(automationRunTable.workItemId, w.item.id),
            ),
          );
        expect(after).toHaveLength(1);
        expect(after.some((r) => r.state === "failed")).toBe(false);
        expect(await db.select().from(schema.outboxTable)).toHaveLength(
          before.length,
        );
        expect(
          await db
            .select()
            .from(schema.auditLogTable)
            .where(eq(schema.auditLogTable.actorId, rule.id)),
        ).not.toHaveLength(0);
        const facts = (
          await loadWorkItemsByKey(w.workspace.id, [w.item.key])
        ).get(w.item.key);
        expect(facts?.facts.resolvedAt?.getTime()).toBeLessThan(
          Date.now() - 2.9 * 86400000,
        );
      }
    },
  );
  it("a second resolution restarts the clock", async () => {
    const w = await serviceWorld();
    await w.resolve(4);
    await w.resolve(2);
    await w.closeRule();
    await runAutomationSchedule();
    await processNextAutomationEvent();
    expect(await w.currentState()).toBe(w.resolved.id);
  });
  it.each([
    "disabled",
    "archived",
    "deleted",
    "feature_off",
    "other_project",
    "other_workspace",
    "archived_item",
    "deleted_item",
    "edited",
    "filter",
  ])("does not act when %s", async (mode) => {
    const w = await serviceWorld();
    await w.resolve(4);
    const rule = await w.closeRule();
    if (mode === "disabled")
      await setAutomationEnabled(rule.id, false, {
        userId: w.user.id,
        personId: w.person.id,
        actorType: "person",
        apiKeyId: null,
      });
    if (mode === "archived_item" || mode === "deleted_item")
      await db
        .update(schema.workItemTable)
        .set(
          mode === "archived_item"
            ? { archivedAt: new Date() }
            : { deletedAt: new Date() },
        )
        .where(eq(schema.workItemTable.id, w.item.id));
    if (mode === "filter")
      await db
        .update(automationTable)
        .set({ projectId: null, projectFilter: ["excluded-project"] })
        .where(eq(automationTable.id, rule.id));
    if (mode === "edited") {
      await runAutomationSchedule();
      await db
        .update(automationTable)
        .set({
          version: 99,
          conditions: [{ field: "state.group", op: "eq", value: "cancelled" }],
        })
        .where(eq(automationTable.id, rule.id));
    }
    if (mode === "archived")
      await db
        .update(schema.projectTable)
        .set({ archivedAt: new Date() })
        .where(eq(schema.projectTable.id, w.project.id));
    if (mode === "deleted")
      await db
        .update(schema.projectTable)
        .set({ deletedAt: new Date() })
        .where(eq(schema.projectTable.id, w.project.id));
    if (mode === "feature_off")
      await db
        .update(workspaceFeatureFlagTable)
        .set({ enabled: false })
        .where(eq(workspaceFeatureFlagTable.workspaceId, w.workspace.id));
    if (mode === "other_project") {
      const { project } = await createProjectFixture({
        workspaceId: w.workspace.id,
      });
      await db
        .update(automationTable)
        .set({ projectId: project.id })
        .where(eq(automationTable.id, rule.id));
    }
    if (mode === "other_workspace") {
      const other = await serviceWorld();
      await other.resolve(4);
      await db
        .update(automationTable)
        .set({ enabled: false })
        .where(eq(automationTable.id, rule.id));
      await other.closeRule();
      await runAutomationSchedule();
      await processNextAutomationEvent();
      expect(await other.currentState()).toBe(other.closedState.id);
    }
    await runAutomationSchedule();
    await processNextAutomationEvent();
    expect(await w.currentState()).toBe(w.resolved.id);
    if (
      [
        "other_workspace",
        "filter",
        "archived_item",
        "deleted_item",
        "other_project",
      ].includes(mode)
    )
      expect(
        await db
          .select()
          .from(automationRunTable)
          .where(and(eq(automationRunTable.workItemId, w.item.id))),
      ).toHaveLength(0);
    if (mode === "edited") {
      const runs = await db
        .select()
        .from(automationRunTable)
        .where(
          and(
            eq(automationRunTable.automationId, rule.id),
            eq(automationRunTable.workItemId, w.item.id),
          ),
        );
      expect(runs[0]?.error).toBe("candidate_unavailable");
    }
  });
  it("pins both tenant predicates in candidate SQL", () => {
    // Composite FKs prohibit inconsistent workspace fixtures; pin each defence
    // separately as well as testing the valid cross-tenant matrix above.
    const source = readFileSync(
      new URL("../../apps/api/src/automation/schedule.ts", import.meta.url),
      "utf8",
    );
    const candidateSql = source.slice(
      source.indexOf("const items = await tx"),
      source.indexOf("const facts = await loadWorkItemsByKey"),
    );
    expect(candidateSql).toContain(
      "eq(projectTable.workspaceId, rule.workspaceId)",
    );
    expect(candidateSql).toContain(
      "eq(workItemTable.workspaceId, rule.workspaceId)",
    );
  });
  it("does not enqueue nonmatching items", async () => {
    const w = await serviceWorld();
    const rule = await w.closeRule();
    for (let i = 0; i < 54; i++) await w.rows.makeItem(`Candidate ${i}`);
    await runAutomationSchedule();
    const runs = await db
      .select()
      .from(automationRunTable)
      .where(eq(automationRunTable.automationId, rule.id));
    expect(runs.filter((r) => r.workItemId)).toHaveLength(0);
  });
  it.each([1, 2, 5])(
    "sweeps 250 daily rules once with %i-minute off-grid ticks",
    async (cadence) => {
      const w = await serviceWorld();
      const original = await w.closeRule();
      const source = requireRow(
        await db
          .select()
          .from(automationTable)
          .where(eq(automationTable.id, original.id)),
        "source rule",
      );
      const { id: _id, ...definition } = source;
      await db
        .update(automationTable)
        .set({ enabled: false })
        .where(eq(automationTable.id, original.id));
      const rules = await db
        .insert(automationTable)
        .values(
          Array.from({ length: 250 }, (_, i) => ({
            ...definition,
            name: `Daily ${i}`,
            scheduleCron: "0 0 * * *",
          })),
        )
        .returning({ id: automationTable.id });
      const ids = new Set(rules.map((r) => r.id));
      for (let tick = 0; tick < 9; tick++)
        await runAutomationSchedule(
          new Date(Date.UTC(2026, 10, 12, 0, 1 + tick * cadence)),
        );
      let summaries = (
        await db
          .select()
          .from(automationRunTable)
          .where(eq(automationRunTable.workspaceId, w.workspace.id))
      ).filter(
        (r) =>
          ids.has(r.automationId) && r.eventId?.startsWith("schedule-summary:"),
      );
      expect(summaries).toHaveLength(250);
      // Downtime across the next daily window catches up once, at an off-grid time.
      for (let tick = 0; tick < 9; tick++)
        await runAutomationSchedule(
          new Date(Date.UTC(2026, 10, 14, 7, 1 + tick * cadence)),
        );
      summaries = (
        await db
          .select()
          .from(automationRunTable)
          .where(eq(automationRunTable.workspaceId, w.workspace.id))
      ).filter(
        (r) =>
          ids.has(r.automationId) && r.eventId?.startsWith("schedule-summary:"),
      );
      expect(summaries).toHaveLength(500);
      for (const id of ids)
        expect(summaries.filter((r) => r.automationId === id)).toHaveLength(2);
    },
  );
  it("caps a rule backlog at 50 pending candidates", async () => {
    const w = await serviceWorld();
    await w.resolve(4);
    const rule = await w.closeRule();
    for (let i = 0; i < 59; i++) {
      const item = await w.rows.makeItem(`Matching ${i}`);
      await db
        .update(schema.workItemTable)
        .set({ stateId: w.resolved.id })
        .where(eq(schema.workItemTable.id, item.id));
      await db.insert(schema.activityTable).values({
        workspaceId: w.workspace.id,
        workItemId: item.id,
        actorType: "system",
        verb: "transitioned",
        oldValue: w.rows.state.id,
        newValue: w.resolved.id,
        createdAt: new Date(Date.now() - 4 * 86400000),
      });
    }
    await runAutomationSchedule();
    await runAutomationSchedule();
    const pending = await db
      .select()
      .from(automationRunTable)
      .where(
        and(
          eq(automationRunTable.automationId, rule.id),
          eq(automationRunTable.state, "pending"),
        ),
      );
    expect(pending).toHaveLength(50);
  });
  it("reserves one in five claims for schedules and preserves event FIFO", async () => {
    const w = await serviceWorld();
    const rule = await w.closeRule();
    await db.insert(automationRunTable).values([
      {
        automationId: rule.id,
        workspaceId: w.workspace.id,
        eventId: "waiting-schedule",
        origin: "schedule",
        triggeredAt: new Date(0),
      },
      ...Array.from({ length: 20 }, (_, i) => ({
        automationId: rule.id,
        workspaceId: w.workspace.id,
        eventId: `fifo-${i}`,
        origin: "event",
        triggeredAt: new Date(1000 + i),
      })),
    ]);
    const claimed = [];
    for (let i = 0; i < 5; i++)
      claimed.push((await claimNextAutomationEvent())[0]);
    expect(claimed.some((r) => r?.origin === "schedule")).toBe(true);
    expect(
      claimed.filter((r) => r?.origin === "event").map((r) => r?.eventId),
    ).toEqual(["fifo-0", "fifo-1", "fifo-2", "fifo-3"]);
  });
  it.each(["missing_edge", "abandoned", "capability", "permanent", "approval"])(
    "retries with bounded history: %s",
    async (mode) => {
      const w = await serviceWorld();
      await w.resolve(4);
      const rule = await w.closeRule();
      const now = new Date();
      const edge = requireRow(
        await db
          .select()
          .from(schema.workflowTransitionTable)
          .where(
            and(
              eq(
                schema.workflowTransitionTable.fromStateTemplateId,
                w.resolved.stateTemplateId,
              ),
              eq(schema.workflowTransitionTable.toStateTemplateId, w.closed.id),
            ),
          ),
        "close edge",
      );
      if (mode === "missing_edge" || mode === "permanent")
        await db
          .delete(schema.workflowTransitionTable)
          .where(eq(schema.workflowTransitionTable.id, edge.id));
      if (mode === "approval")
        await db
          .update(schema.workflowTransitionTable)
          .set({ requiresApproval: true, approvalPolicy: "any" })
          .where(eq(schema.workflowTransitionTable.id, edge.id));
      if (mode === "capability")
        await db
          .update(schema.roleTable)
          .set({ capabilities: ["work_item:read"] })
          .where(eq(schema.roleTable.id, w.role.id));
      await runAutomationSchedule(now);
      if (mode === "abandoned") {
        const claimed = await claimNextAutomationEvent();
        expect(claimed[0]?.workItemId).toBe(w.item.id);
        await db
          .update(automationRunTable)
          .set({ leaseExpiresAt: new Date(0) })
          .where(
            eq(automationRunTable.id, requireRow(claimed, "claimed run").id),
          );
      } else await processNextAutomationEvent();
      const events = await db.select().from(schema.outboxTable);
      for (let i = 1; i <= 10; i++) {
        await runAutomationSchedule(new Date(now.getTime() + i * 3600000));
        await processNextAutomationEvent();
      }
      const runs = () =>
        db
          .select()
          .from(automationRunTable)
          .where(
            and(
              eq(automationRunTable.automationId, rule.id),
              eq(automationRunTable.workItemId, w.item.id),
            ),
          );
      expect(await runs()).toHaveLength(1);
      expect(await db.select().from(schema.outboxTable)).toHaveLength(
        events.length,
      );
      if (mode === "missing_edge")
        await db.insert(schema.workflowTransitionTable).values(edge);
      if (mode === "capability")
        await db
          .update(schema.roleTable)
          .set({ capabilities: ["work_item:read", "work_item:transition"] })
          .where(eq(schema.roleTable.id, w.role.id));
      await runAutomationSchedule(new Date(now.getTime() + 25 * 3600000));
      await processNextAutomationEvent();
      const retried = await runs();
      expect(retried).toHaveLength(2);
      expect(new Set(retried.map((r) => r.eventId)).size).toBe(2);
      expect(await w.currentState()).toBe(
        ["permanent", "approval"].includes(mode)
          ? w.resolved.id
          : w.closedState.id,
      );
      expect(retried.filter((r) => r.state === "failed")).toHaveLength(
        ["permanent", "approval"].includes(mode)
          ? 2
          : mode === "abandoned"
            ? 0
            : 1,
      );
      expect(await abandonStaleRuns()).toBe(0);
      const progress = requireRow(
        await db
          .select()
          .from(automationRunTable)
          .where(eq(automationRunTable.id, `schedule-progress:${rule.id}`)),
        "progress",
      );
      expect(JSON.stringify(progress.results)).not.toContain("evaluated");
    },
  );
  it.each(["customer", "manual", "no_change_needed"])(
    "re-arms completed stays after %s reopen",
    async (mode) => {
      const w = await serviceWorld();
      await w.resolve(4);
      const rule = await w.closeRule();
      const runs = () =>
        db
          .select()
          .from(automationRunTable)
          .where(
            and(
              eq(automationRunTable.automationId, rule.id),
              eq(automationRunTable.workItemId, w.item.id),
            ),
          );
      // A workflow version has exactly one reopen edge; point it at Closed for this journey.
      await db
        .update(schema.workflowTransitionTable)
        .set({ fromStateTemplateId: w.closed.id })
        .where(
          and(
            eq(
              schema.workflowTransitionTable.fromStateTemplateId,
              w.resolved.stateTemplateId,
            ),
            eq(schema.workflowTransitionTable.isReopen, true),
          ),
        );
      await runAutomationSchedule();
      if (mode === "no_change_needed")
        await transitionWorkItem(
          w.item.id,
          null,
          w.person.id,
          w.user.id,
          "person",
          { toStateTemplateId: w.closed.id },
        );
      await processNextAutomationEvent();
      expect(await w.currentState()).toBe(w.closedState.id);
      expect((await runs())[0]?.state).toBe("done");
      if (mode === "no_change_needed")
        expect(JSON.stringify((await runs())[0]?.results)).toContain(
          "no_change_needed",
        );
      // Move within completed to a non-target state: the SQL run suppression, rather
      // than target exclusion, must preserve this stay's successful/no-change run.
      const closeEdge = requireRow(
        await db
          .select()
          .from(schema.workflowTransitionTable)
          .where(
            and(
              eq(
                schema.workflowTransitionTable.fromStateTemplateId,
                w.resolved.stateTemplateId,
              ),
              eq(schema.workflowTransitionTable.toStateTemplateId, w.closed.id),
            ),
          ),
        "close edge",
      );
      await db.insert(schema.workflowTransitionTable).values({
        versionId: closeEdge.versionId,
        fromStateTemplateId: w.closed.id,
        toStateTemplateId: w.resolved.stateTemplateId,
      });
      await transitionWorkItem(
        w.item.id,
        null,
        w.person.id,
        w.user.id,
        "person",
        { toStateTemplateId: w.resolved.stateTemplateId },
      );
      await runAutomationSchedule(new Date(Date.now() + 86400000));
      expect(await runs()).toHaveLength(1);
      expect(await w.currentState()).toBe(w.resolved.id);
      await transitionWorkItem(
        w.item.id,
        null,
        w.person.id,
        w.user.id,
        "person",
        { toStateTemplateId: w.closed.id },
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(Date.now() + 2 * 86400000);
        if (mode === "customer") {
          const customer = requireRow(
            await db
              .insert(schema.personTable)
              .values({
                organisationId: w.person.organisationId,
                side: "customer",
              })
              .returning(),
            "customer",
          );
          const comment = requireRow(
            await db
              .insert(schema.commentTable)
              .values({
                workspaceId: w.workspace.id,
                workItemId: w.item.id,
                authorId: customer.id,
                actorType: "person",
                visibility: "public",
                body: {},
              })
              .returning(),
            "comment",
          );
          await w.rule({
            name: "Reopen on customer reply",
            trigger: "work_item.commented",
            conditions: [
              { field: "actor_role", op: "eq", value: "customer" },
              { field: "state.group", op: "eq", value: "completed" },
            ],
            actions: [
              { type: "transition", toStateTemplateId: w.rows.template.id },
            ],
          });
          const envelope = await w.emit("work_item.commented");
          envelope.payload.commentId = comment.id;
          await db
            .update(schema.outboxTable)
            .set({ payload: envelope })
            .where(eq(schema.outboxTable.eventId, envelope.id));
          await w.runOnce(envelope);
        } else {
          await transitionWorkItem(
            w.item.id,
            null,
            w.person.id,
            w.user.id,
            "person",
            { toStateTemplateId: w.rows.template.id },
          );
        }
        expect(await w.currentState()).toBe(w.rows.state.id);
        // Persist a new completed entry at the controlled clock, as in the existing age fixtures.
        await w.resolve(0);
        const entered = Date.now();
        vi.setSystemTime(entered + 2 * 86400000);
        await runAutomationSchedule();
        await processNextAutomationEvent();
        expect(await w.currentState()).toBe(w.resolved.id);
        expect(await runs()).toHaveLength(1);
        vi.setSystemTime(entered + 3 * 86400000);
        await runAutomationSchedule();
        await processNextAutomationEvent();
        expect(await w.currentState()).toBe(w.closedState.id);
        expect(await runs()).toHaveLength(2);
        expect((await runs()).every((r) => r.state === "done")).toBe(true);
        vi.setSystemTime(entered + 4 * 86400000);
        await runAutomationSchedule();
        expect(await runs()).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("posts only one comment over five sweeps without recorded completed entry", async () => {
    const w = await serviceWorld();
    // Imports can set the completed state directly, without transitioned activity.
    await db
      .update(schema.workItemTable)
      .set({ stateId: w.resolved.id })
      .where(eq(schema.workItemTable.id, w.item.id));
    expect(
      (await loadWorkItemsByKey(w.workspace.id, [w.item.key])).get(w.item.key)
        ?.facts.resolvedAt,
    ).toBeNull();
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["work_item:read", "comment:create_internal"] })
      .where(eq(schema.roleTable.id, w.role.id));
    const rule = await w.rule({
      name: "Comment on completed items",
      trigger: "schedule",
      scheduleCron: "*/5 * * * *",
      conditions: [{ field: "state.group", op: "eq", value: "completed" }],
      actions: [
        {
          type: "post_comment",
          visibility: "internal",
          body: "Completed item",
        },
      ],
    });
    const now = Date.now();
    for (let sweep = 0; sweep < 5; sweep++) {
      await runAutomationSchedule(new Date(now + sweep * 5 * 60000));
      await processNextAutomationEvent();
    }
    const runs = await db
      .select()
      .from(automationRunTable)
      .where(
        and(
          eq(automationRunTable.automationId, rule.id),
          eq(automationRunTable.workItemId, w.item.id),
        ),
      );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.state).toBe("done");
    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(
        and(
          eq(schema.commentTable.workspaceId, w.workspace.id),
          eq(schema.commentTable.workItemId, w.item.id),
        ),
      );
    expect(comments).toHaveLength(1);
    expect(comments[0]?.actorType).toBe("automation");
    expect(await w.currentState()).toBe(w.resolved.id);
  });
  it("backs off a refused transition for 24 hours without recorded completed entry", async () => {
    const w = await serviceWorld();
    await db
      .update(schema.workItemTable)
      .set({ stateId: w.resolved.id })
      .where(eq(schema.workItemTable.id, w.item.id));
    expect(
      (await loadWorkItemsByKey(w.workspace.id, [w.item.key])).get(w.item.key)
        ?.facts.resolvedAt,
    ).toBeNull();
    await db
      .delete(schema.workflowTransitionTable)
      .where(
        and(
          eq(
            schema.workflowTransitionTable.fromStateTemplateId,
            w.resolved.stateTemplateId,
          ),
          eq(schema.workflowTransitionTable.toStateTemplateId, w.closed.id),
        ),
      );
    const rule = await w.rule({
      name: "Refused close on completed items",
      trigger: "schedule",
      scheduleCron: "*/5 * * * *",
      conditions: [{ field: "state.group", op: "eq", value: "completed" }],
      actions: [{ type: "transition", toStateTemplateId: w.closed.id }],
    });
    const runs = () =>
      db
        .select()
        .from(automationRunTable)
        .where(
          and(
            eq(automationRunTable.automationId, rule.id),
            eq(automationRunTable.workItemId, w.item.id),
          ),
        );
    const now = Date.now();
    await runAutomationSchedule(new Date(now));
    await processNextAutomationEvent();
    const first = requireRow(await runs(), "refused run");
    expect(first.state).toBe("failed");
    expect(JSON.stringify(first.results)).toContain("no_matching_transition");
    const events = await db.select().from(schema.outboxTable);
    for (const minutes of [5, 10, 15, 20, 1435]) {
      await runAutomationSchedule(new Date(now + minutes * 60000));
      await processNextAutomationEvent();
      expect(await runs()).toHaveLength(1);
    }
    expect(await db.select().from(schema.outboxTable)).toHaveLength(
      events.length,
    );
    await runAutomationSchedule(new Date(now + 24 * 3600000));
    await processNextAutomationEvent();
    const retried = await runs();
    expect(retried).toHaveLength(2);
    expect(retried.every((r) => r.state === "failed")).toBe(true);
    expect(new Set(retried.map((r) => r.eventId)).size).toBe(2);
    await runAutomationSchedule(new Date(now + 24 * 3600000 + 5 * 60000));
    expect(await runs()).toHaveLength(2);
    expect(await w.currentState()).toBe(w.resolved.id);
  });
  it.each(["failed", "skipped", "abandoned", "pending", "running"])(
    "handles %s run suppression across completed stays",
    async (state) => {
      const w = await serviceWorld();
      await w.resolve(4);
      const rule = await w.rule({
        name: "Close after five minutes",
        trigger: "schedule",
        scheduleCron: "*/5 * * * *",
        conditions: [
          { field: "state.group", op: "eq", value: "completed" },
          { field: "age", op: "gte", basis: "resolved_at", value: 5 },
        ],
        actions: [{ type: "transition", toStateTemplateId: w.closed.id }],
      });
      const runs = () =>
        db
          .select()
          .from(automationRunTable)
          .where(
            and(
              eq(automationRunTable.automationId, rule.id),
              eq(automationRunTable.workItemId, w.item.id),
            ),
          );
      // Begin with a real refused attempt, then cover every other retained outcome.
      await db
        .update(schema.roleTable)
        .set({ capabilities: ["work_item:read"] })
        .where(eq(schema.roleTable.id, w.role.id));
      await runAutomationSchedule();
      await processNextAutomationEvent();
      const prior = requireRow(await runs(), "failed run");
      expect(prior.state).toBe("failed");
      await db
        .update(automationRunTable)
        .set({
          state,
          leaseExpiresAt:
            state === "running" ? new Date(Date.now() + 86400000) : null,
        })
        .where(eq(automationRunTable.id, prior.id));
      await db
        .update(schema.roleTable)
        .set({ capabilities: ["work_item:read", "work_item:transition"] })
        .where(eq(schema.roleTable.id, w.role.id));
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        // Even repaired failures and nonterminal runs suppress within this stay.
        vi.setSystemTime(Date.now() + 5 * 60000);
        await runAutomationSchedule();
        expect(await runs()).toHaveLength(1);
        await transitionWorkItem(
          w.item.id,
          null,
          w.person.id,
          w.user.id,
          "person",
          { toStateTemplateId: w.rows.template.id },
        );
        await w.resolve(0);
        vi.setSystemTime(Date.now() + 5 * 60000);
        await runAutomationSchedule();
        if (state === "pending" || state === "running") {
          // An unfinished run blocks across stays, preventing duplicate side effects.
          expect(await runs()).toHaveLength(1);
          expect((await runs())[0]?.state).toBe(state);
          expect(await w.currentState()).toBe(w.resolved.id);
        } else {
          // Finished failures from an earlier stay do not delay the new stay.
          expect(await runs()).toHaveLength(2);
          await processNextAutomationEvent();
          expect(await w.currentState()).toBe(w.closedState.id);
        }
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("an unchanged day-two candidate closes on day three", async () => {
    const w = await serviceWorld();
    await w.resolve(2);
    const rule = await w.closeRule();
    await runAutomationSchedule();
    expect(await w.currentState()).toBe(w.resolved.id);
    // Advance the clock for both the sweep and executor without changing item/rule facts.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 86400000 + 60000);
      await runAutomationSchedule();
      await processNextAutomationEvent();
      expect(await w.currentState()).toBe(w.closedState.id);
      expect(
        (
          await db
            .select()
            .from(automationRunTable)
            .where(eq(automationRunTable.automationId, rule.id))
        ).filter((r) => r.workItemId),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("refuses a transition when the evaluated snapshot changed", async () => {
    const w = await serviceWorld();
    await w.resolve(4);
    await expect(
      transitionWorkItem(
        w.item.id,
        null,
        null,
        "automation-test",
        "automation",
        { toStateTemplateId: w.closed.id },
        undefined,
        { roleId: w.role.id, expectedStateId: "stale-state" },
      ),
    ).rejects.toBeInstanceOf(TransitionConflictError);
    const facts = (await loadWorkItemsByKey(w.workspace.id, [w.item.key])).get(
      w.item.key,
    );
    await expect(
      transitionWorkItem(
        w.item.id,
        null,
        null,
        "automation-test",
        "automation",
        { toStateTemplateId: w.closed.id },
        undefined,
        {
          roleId: w.role.id,
          expectedStateId: w.resolved.id,
          expectedResolvedAt: new Date(0),
        },
      ),
    ).rejects.toBeInstanceOf(TransitionConflictError);
    expect(facts?.facts.resolvedAt).toBeTruthy();
    expect(await w.currentState()).toBe(w.resolved.id);
  });
  it("refreshes the snapshot between scheduled transitions", async () => {
    const w = await serviceWorld();
    await w.resolve(4);
    const rule = await w.closeRule();
    const edge = requireRow(
      await db
        .select()
        .from(schema.workflowTransitionTable)
        .where(
          and(
            eq(
              schema.workflowTransitionTable.fromStateTemplateId,
              w.resolved.stateTemplateId,
            ),
            eq(schema.workflowTransitionTable.toStateTemplateId, w.closed.id),
          ),
        ),
      "edge",
    );
    await db
      .update(schema.workflowTransitionTable)
      .set({ isReopen: false })
      .where(
        and(
          eq(schema.workflowTransitionTable.versionId, edge.versionId),
          eq(schema.workflowTransitionTable.isReopen, true),
        ),
      );
    await db.insert(schema.workflowTransitionTable).values({
      versionId: edge.versionId,
      fromStateTemplateId: w.closed.id,
      toStateTemplateId: w.rows.template.id,
      isReopen: true,
    });
    await db
      .update(automationTable)
      .set({
        actions: [
          { type: "transition", toStateTemplateId: w.closed.id },
          { type: "transition", toStateTemplateId: w.rows.template.id },
        ],
      })
      .where(eq(automationTable.id, rule.id));
    await runAutomationSchedule();
    await processNextAutomationEvent();
    expect(await w.currentState()).toBe(w.rows.state.id);
    const run = requireRow(
      await db
        .select()
        .from(automationRunTable)
        .where(eq(automationRunTable.workItemId, w.item.id)),
      "run",
    );
    expect(run.state).toBe("done");
    expect(run.results).toHaveLength(2);
  });
  it("records a refused transition without forcing it", async () => {
    const w = await serviceWorld();
    await w.resolve(4);
    const rule = await w.closeRule();
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["work_item:read"] })
      .where(eq(schema.roleTable.id, w.role.id));
    await runAutomationSchedule();
    await processNextAutomationEvent();
    expect(await w.currentState()).toBe(w.resolved.id);
    const run = requireRow(
      await db
        .select()
        .from(automationRunTable)
        .where(
          and(
            eq(automationRunTable.automationId, rule.id),
            eq(automationRunTable.workItemId, w.item.id),
          ),
        ),
      "run",
    );
    expect(run.state).toBe("failed");
    expect(JSON.stringify(run.results)).toContain("role_lacks_capability");
    const events = await db.select().from(schema.outboxTable);
    await runAutomationSchedule(new Date(Date.now() + 3600000));
    await runAutomationSchedule(new Date(Date.now() + 7200000));
    const repeated = await db
      .select()
      .from(automationRunTable)
      .where(
        and(
          eq(automationRunTable.automationId, rule.id),
          eq(automationRunTable.workItemId, w.item.id),
        ),
      );
    expect(repeated).toHaveLength(1);
    expect(await db.select().from(schema.outboxTable)).toHaveLength(
      events.length,
    );
  });
  it.each([
    "customer",
    "staff",
    "internal",
    "system",
    "automation",
    "api_key",
    "deleted",
  ])("only a public customer-person comment reopens (%s)", async (kind) => {
    const w = await serviceWorld();
    await w.resolve(4);
    const customer = requireRow(
      await db
        .insert(schema.personTable)
        .values({ organisationId: w.person.organisationId, side: "customer" })
        .returning(),
      "customer",
    );
    const comment = requireRow(
      await db
        .insert(schema.commentTable)
        .values({
          workspaceId: w.workspace.id,
          workItemId: w.item.id,
          authorId:
            kind === "staff"
              ? requireRow(
                  await db
                    .insert(schema.personTable)
                    .values({
                      organisationId: w.person.organisationId,
                      side: "staff",
                    })
                    .returning(),
                  "distinct staff",
                ).id
              : customer.id,
          actorType: ["system", "automation", "api_key"].includes(kind)
            ? kind
            : "person",
          visibility: kind === "internal" ? "internal" : "public",
          deletedAt: kind === "deleted" ? new Date() : null,
          body: {},
        })
        .returning(),
      "comment",
    );
    const rule = await w.rule({
      name: "Reopen on customer reply",
      trigger: "work_item.commented",
      conditions: [
        { field: "actor_role", op: "eq", value: "customer" },
        { field: "state.group", op: "eq", value: "completed" },
      ],
      actions: [{ type: "transition", toStateTemplateId: w.rows.template.id }],
    });
    const envelope = await w.emit("work_item.commented");
    envelope.payload.commentId = comment.id;
    await db
      .update(schema.outboxTable)
      .set({ payload: envelope })
      .where(eq(schema.outboxTable.eventId, envelope.id));
    expect(
      await customerCommentFact(
        w.workspace.id,
        w.item.id,
        envelope.kind,
        envelope.payload,
      ),
    ).toBe(kind === "customer");
    await w.runOnce(envelope);
    expect(await w.currentState()).toBe(
      kind === "customer" ? w.rows.state.id : w.resolved.id,
    );
    envelope.id = `loop-${randomUUID()}`;
    envelope.originAutomationId = rule.id;
    expect(
      await db.transaction((tx) => enqueueAutomationRuns(tx, envelope)),
    ).toBe(0);
  });
});
