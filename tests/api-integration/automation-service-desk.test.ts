/**
 * Automation actions `post_comment` and `transition`, and the `sla_state` condition, against the
 * database (`AM-3`, `AM-4`, `AM-5`, `AM-7`, `AM-11`). Every run goes through the real pipeline:
 * outbox event -> parent consumer -> claimed run -> executor.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueAutomationRuns } from "../../apps/api/src/automation/consumer";
import {
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
    if (mode === "other_workspace")
      expect(
        await db
          .select()
          .from(automationRunTable)
          .where(
            and(
              eq(automationRunTable.workspaceId, w.workspace.id),
              eq(automationRunTable.workItemId, w.item.id),
            ),
          ),
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
  it("prioritises event runs and rotates workspaces within the lane", async () => {
    const a = await serviceWorld();
    const b = await serviceWorld();
    const ar = await a.closeRule();
    const br = await b.closeRule();
    await db.insert(automationRunTable).values([
      {
        automationId: ar.id,
        workspaceId: a.workspace.id,
        eventId: "old-schedule",
        origin: "schedule",
        triggeredAt: new Date(0),
      },
      ...Array.from({ length: 4 }, (_, i) => ({
        automationId: ar.id,
        workspaceId: a.workspace.id,
        eventId: `a-event-${i}`,
        origin: "event",
      })),
      {
        automationId: br.id,
        workspaceId: b.workspace.id,
        eventId: "b-event",
        origin: "event",
      },
    ]);
    const first = await claimNextAutomationEvent();
    const second = await claimNextAutomationEvent();
    expect(first[0]?.origin).toBe("event");
    expect(second[0]?.origin).toBe("event");
    expect(new Set([first[0]?.workspaceId, second[0]?.workspaceId]).size).toBe(
      2,
    );
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
