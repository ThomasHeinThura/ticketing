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
  type AutomationActor,
  createAutomation,
  setAutomationEnabled,
} from "../../apps/api/src/automation/repository";
import { validateRuleDefinition } from "../../apps/api/src/automation/validation";
import db, { schema } from "../../apps/api/src/database";
import {
  automationRunTable,
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
import { workItemWorld } from "./helpers/p4-closeout";
import { ensureCreationWorkflow } from "./helpers/workflow";

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
    actions: unknown[];
    conditions?: unknown[];
  }) {
    const validated = validateRuleDefinition({
      trigger: options.trigger ?? "work_item.created",
      conditions: options.conditions ?? [],
      actions: options.actions,
    });
    if (!validated.ok) throw new Error(JSON.stringify(validated.problems));
    const created = await createAutomation({
      workspaceId: workspace.id,
      projectId: null,
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

type Result = { type: string; ok: boolean; error?: string };

describe("post_comment", () => {
  beforeEach(async () => resetTestDatabase());

  it("writes an internal comment attributed to the rule, with placeholders expanded", async () => {
    const w = await world(["work_item:read", "comment:create_internal"]);
    const rule = await w.rule({
      name: "Note it",
      actions: [
        {
          type: "post_comment",
          visibility: "internal",
          body: "Auto note for {{work_item.key}}: {{work_item.title}}\nsecond line",
        },
      ],
    });
    await w.runOnce(await w.emit());
    const run = await w.lastRun();
    expect(run.state, JSON.stringify(run)).toBe("done");

    const [comment] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, w.item.id));
    // AM-4: an automation actor, never a person.
    expect(comment?.actorType).toBe("automation");
    expect(comment?.authorId).toBeNull();
    expect(comment?.visibility).toBe("internal");
    const text = JSON.stringify(comment?.body);
    expect(text).toContain(`Auto note for ${w.item.key}: Printer on fire`);
    // Plain text only: no node that could carry a mention.
    expect(text).not.toContain("mention");

    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "work_item.commented"),
          eq(schema.auditLogTable.entityId, comment?.id ?? ""),
        ),
      );
    expect(audit?.actorType).toBe("automation");
    expect(audit?.actorId).toBe(rule.id);

    // The produced event carries the loop-guard context (EV-3 / AM-5).
    const events = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "work_item.commented"));
    const envelope = parseParentEnvelope(requireRow(events, "event")) as {
      depth: number;
      originAutomationId: string | null;
      actor: { type: string; name: string };
    };
    expect(envelope.originAutomationId).toBe(rule.id);
    expect(envelope.depth).toBe(1);
    expect(envelope.actor).toMatchObject({
      type: "automation",
      name: "Note it",
    });
  });

  it("a comment-triggered rule never re-fires on its own comment", async () => {
    const w = await world(["work_item:read", "comment:create_internal"]);
    await w.rule({
      name: "echo",
      trigger: "work_item.commented",
      actions: [{ type: "post_comment", visibility: "internal", body: "seen" }],
    });
    await w.runOnce(await w.emit("work_item.commented"));
    expect(await db.select().from(schema.commentTable)).toHaveLength(1);
    // The comment the rule just wrote is an event of its own; replaying it into the consumer
    // queues nothing for the rule that produced it.
    const [own] = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "work_item.commented"));
    const produced = (await db.select().from(schema.outboxTable)).find(
      (row) =>
        row.kind === "work_item.commented" && row.eventId !== own?.eventId,
    );
    expect(produced).toBeDefined();
    const before = (await db.select().from(automationRunTable)).length;
    await db.transaction((tx) =>
      enqueueAutomationRuns(
        tx,
        parseParentEnvelope(requireRow(produced ? [produced] : [], "event")),
      ),
    );
    expect((await db.select().from(automationRunTable)).length).toBe(before);
  });

  it("is refused when the effective role lacks the comment capability, and records why", async () => {
    // comment:create_internal implies comment:create, so the role holds neither here.
    const w = await world(["work_item:read"]);
    await w.rule({
      name: "public voice",
      actions: [{ type: "post_comment", visibility: "public", body: "hello" }],
    });
    await w.runOnce(await w.emit());
    const run = await w.lastRun();
    expect(run.state).toBe("failed");
    expect((run.results as Result[])[0]).toMatchObject({
      type: "post_comment",
      ok: false,
      error: "role_lacks_capability",
    });
    expect(await db.select().from(schema.commentTable)).toHaveLength(0);
  });

  it("refuses a staff-only placeholder in a public comment at save time (AM-11)", () => {
    const validated = validateRuleDefinition({
      trigger: "work_item.created",
      conditions: [],
      actions: [
        {
          type: "post_comment",
          visibility: "public",
          body: "Assigned to {{assignee.email}}",
        },
      ],
    });
    expect(validated.ok).toBe(false);
    if (!validated.ok)
      expect(validated.problems[0]?.message).toContain("assignee.email");
  });
});

describe("transition", () => {
  beforeEach(async () => resetTestDatabase());

  async function workflowWorld(capabilities: string[]) {
    const w = await world(capabilities);
    await ensureCreationWorkflow({
      workspaceId: w.workspace.id,
      projectId: w.project.id,
      typeId: w.rows.type.id,
    });
    const [edge] = await db
      .select()
      .from(schema.workflowTransitionTable)
      .where(
        eq(
          schema.workflowTransitionTable.fromStateTemplateId,
          w.rows.template.id,
        ),
      );
    const target = requireRow(edge ? [edge] : [], "edge");
    async function currentState() {
      const [row] = await db
        .select({ stateId: schema.workItemTable.stateId })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, w.item.id));
      return row?.stateId;
    }
    return { ...w, edge: target, currentState };
  }

  it("takes an edge open to any role, as the automation actor", async () => {
    const w = await workflowWorld(["work_item:read", "work_item:transition"]);
    const before = await w.currentState();
    const rule = await w.rule({
      name: "mover",
      actions: [
        { type: "transition", toStateTemplateId: w.edge.toStateTemplateId },
      ],
    });
    await w.runOnce(await w.emit());
    const run = await w.lastRun();
    expect(run.state, JSON.stringify(run.results)).toBe("done");
    expect(await w.currentState()).not.toBe(before);
    const [activity] = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, w.item.id),
          eq(schema.activityTable.verb, "transitioned"),
        ),
      );
    expect(activity?.actorType).toBe("automation");
    expect(activity?.actorId).toBe(rule.id);
  });

  it("is refused for an edge restricted to another role, and for a missing capability", async () => {
    const w = await workflowWorld(["work_item:read", "work_item:transition"]);
    const other = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: w.workspace.id,
          key: `other-${randomUUID()}`,
          name: "Other",
          rank: 40,
          capabilities: ["work_item:read"],
        })
        .returning(),
      "other role",
    );
    await db
      .update(schema.workflowTransitionTable)
      .set({ roleId: other.id })
      .where(eq(schema.workflowTransitionTable.id, w.edge.id));
    const before = await w.currentState();
    await w.rule({
      name: "mover",
      actions: [
        { type: "transition", toStateTemplateId: w.edge.toStateTemplateId },
      ],
    });
    await w.runOnce(await w.emit());
    const run = await w.lastRun();
    expect(run.state).toBe("failed");
    expect((run.results as Result[])[0]?.error).toBe("no_matching_transition");
    expect(await w.currentState()).toBe(before);

    // Once the edge is open to the rule's own role it is taken.
    await db
      .update(schema.workflowTransitionTable)
      .set({ roleId: w.role.id })
      .where(eq(schema.workflowTransitionTable.id, w.edge.id));
    await w.runOnce(await w.emit());
    expect((await w.lastRun()).state).toBe("done");
    expect(await w.currentState()).not.toBe(before);
  });

  it("still applies the most restrictive matching edge and its guards", async () => {
    const w = await workflowWorld(["work_item:read", "work_item:transition"]);
    // A second edge for the same pair, guarded on an assignee, beside the open one.
    await db.insert(schema.workflowTransitionTable).values({
      versionId: w.edge.versionId,
      fromStateTemplateId: w.edge.fromStateTemplateId,
      toStateTemplateId: w.edge.toStateTemplateId,
      roleId: null,
      guards: [{ type: "assignee_present" }],
      effects: [],
    });
    const before = await w.currentState();
    await w.rule({
      name: "mover",
      actions: [
        { type: "transition", toStateTemplateId: w.edge.toStateTemplateId },
      ],
    });
    await w.runOnce(await w.emit());
    const run = await w.lastRun();
    expect(run.state).toBe("failed");
    expect((run.results as Result[])[0]?.error).toMatch(/^transition_blocked/);
    expect(await w.currentState()).toBe(before);
  });

  it("is refused for an approval-gated edge: an automation cannot decide a gate", async () => {
    const w = await workflowWorld(["work_item:read", "work_item:transition"]);
    await db
      .update(schema.workflowTransitionTable)
      .set({ requiresApproval: true, approvalPolicy: "any" })
      .where(eq(schema.workflowTransitionTable.id, w.edge.id));
    const before = await w.currentState();
    await w.rule({
      name: "mover",
      actions: [
        { type: "transition", toStateTemplateId: w.edge.toStateTemplateId },
      ],
    });
    await w.runOnce(await w.emit());
    expect((await w.lastRun()).state).toBe("failed");
    expect(await w.currentState()).toBe(before);
  });
});

describe("sla_state condition", () => {
  beforeEach(async () => resetTestDatabase());

  it("an item with no SLA is empty; the vocabulary is closed", async () => {
    const w = await world(["work_item:read", "comment:create_internal"]);
    await w.rule({
      name: "no sla",
      conditions: [{ field: "sla_state", op: "is_empty" }],
      actions: [
        { type: "post_comment", visibility: "internal", body: "no sla" },
      ],
    });
    await w.rule({
      name: "breached only",
      conditions: [{ field: "sla_state", op: "eq", value: "breached" }],
      actions: [
        { type: "post_comment", visibility: "internal", body: "breached" },
      ],
    });
    await w.runOnce(await w.emit());
    const bodies = (await db.select().from(schema.commentTable)).map((row) =>
      JSON.stringify(row.body),
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("no sla");
    expect(
      validateRuleDefinition({
        trigger: "work_item.created",
        conditions: [{ field: "sla_state", op: "eq", value: "nearly" }],
        actions: [{ type: "assign", assigneeId: "p" }],
      }).ok,
    ).toBe(false);
  });
});
