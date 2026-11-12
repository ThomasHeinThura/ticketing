/**
 * Automation actions `post_comment` and `transition`, and the `sla_state` condition, against the
 * database (`AM-3`, `AM-4`, `AM-5`, `AM-7`, `AM-11`). Every run goes through the real pipeline:
 * outbox event -> parent consumer -> claimed run -> executor.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueueAutomationRuns } from "../../apps/api/src/automation/consumer";
import { processNextAutomationEvent } from "../../apps/api/src/automation/executor";
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
      scheduleCron: "* * * * *",
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
      expect(runs.filter((r) => r.workItemId === w.item.id)).toHaveLength(1);
      if (days === 3) {
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
    }
    await runAutomationSchedule();
    await processNextAutomationEvent();
    expect(await w.currentState()).toBe(w.resolved.id);
  });
  it("continues bounded sweeps on the next tick without duplicate candidates", async () => {
    const w = await serviceWorld();
    const rule = await w.closeRule();
    for (let i = 0; i < 54; i++) await w.rows.makeItem(`Candidate ${i}`);
    await runAutomationSchedule();
    let runs = await db
      .select()
      .from(automationRunTable)
      .where(eq(automationRunTable.automationId, rule.id));
    expect(runs.filter((r) => r.workItemId)).toHaveLength(50);
    await runAutomationSchedule();
    await runAutomationSchedule();
    runs = await db
      .select()
      .from(automationRunTable)
      .where(eq(automationRunTable.automationId, rule.id));
    expect(runs.filter((r) => r.workItemId)).toHaveLength(55);
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
  });
  it.each(["customer", "staff", "internal", "system", "automation", "api_key"])(
    "only a public customer-person comment reopens (%s)",
    async (kind) => {
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
            authorId: kind === "staff" ? w.person.id : customer.id,
            actorType: ["system", "automation", "api_key"].includes(kind)
              ? kind
              : "person",
            visibility: kind === "internal" ? "internal" : "public",
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
    },
  );
});
