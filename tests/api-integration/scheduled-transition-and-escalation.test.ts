/** WF-19 executor job and SLA-17 escalation walk (written, not yet run; needs the integration DB). */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { slaEscalationTable } from "../../apps/api/src/database/schema";
import {
  cancelStaleScheduledTransitions,
  runScheduledTransitions,
} from "../../apps/api/src/scheduler/scheduled-transition";
import { advanceDueEscalations } from "../../apps/api/src/scheduler/sla-escalation";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function fixture() {
  const owner = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const mkState = async (group: string) => {
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
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({ projectId: project.id, stateTemplateId: template.id })
        .returning(),
      "state",
    );
    return state;
  };
  const waiting = await mkState("started");
  const target = await mkState("completed");
  const other = await mkState("unstarted");
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: owner.workspace.id,
        key: randomUUID(),
        name: "T",
        category: "service",
      })
      .returning(),
    "type",
  );
  const item = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId: owner.workspace.id,
        projectId: project.id,
        typeId: type.id,
        stateId: waiting.id,
        number: 1,
        key: `${project.slug}-1`,
        title: "Scheduled",
      })
      .returning(),
    "item",
  );
  return { owner, project, waiting, target, other, type, item };
}

async function scheduledRow(
  f: Awaited<ReturnType<typeof fixture>>,
  dueMinutes: number,
) {
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({
        workspaceId: f.owner.workspace.id,
        key: randomUUID(),
        name: "W",
      })
      .returning(),
    "workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "version",
  );
  const transition = requireRow(
    await db
      .insert(schema.workflowTransitionTable)
      .values({
        versionId: version.id,
        fromStateTemplateId: null,
        toStateTemplateId: (
          await db
            .select()
            .from(schema.stateTable)
            .where(eq(schema.stateTable.id, f.waiting.id))
        )[0]?.stateTemplateId as string,
        guards: [],
        effects: [],
      })
      .returning(),
    "transition",
  );
  return requireRow(
    await db
      .insert(schema.scheduledTransitionTable)
      .values({
        projectId: f.project.id,
        workItemId: f.item.id,
        transitionId: transition.id,
        fromStateId: f.waiting.id,
        toStateId: f.target.id,
        dueAt: new Date(Date.now() + dueMinutes * 60_000),
      })
      .returning(),
    "scheduled row",
  );
}

describe("WF-19 scheduled-transition job", () => {
  beforeEach(async () => resetTestDatabase());

  it("fires a due row exactly once through the executor and ignores a future row", async () => {
    const f = await fixture();
    const due = await scheduledRow(f, -5);
    let calls = 0;
    const executor = async (request: {
      kind: string;
      claim?: (tx: never) => Promise<boolean>;
    }) => {
      calls++;
      const claimed = await db.transaction(async (tx) =>
        request.claim ? await request.claim(tx as never) : false,
      );
      return claimed
        ? { kind: "applied" as const }
        : { kind: "left_state" as const };
    };
    const first = await runScheduledTransitions(executor as never);
    expect(first.fired).toBe(1);
    const second = await runScheduledTransitions(executor as never);
    expect(second.fired).toBe(0);
    expect(calls).toBe(1);
    const [row] = await db
      .select()
      .from(schema.scheduledTransitionTable)
      .where(eq(schema.scheduledTransitionTable.id, due.id));
    expect(row?.state).toBe("fired");
  });

  it("cancels a row whose item already left from_state_id", async () => {
    const f = await fixture();
    const row = await scheduledRow(f, -5);
    await db
      .update(schema.workItemTable)
      .set({ stateId: f.other.id })
      .where(eq(schema.workItemTable.id, f.item.id));
    expect(await cancelStaleScheduledTransitions()).toBe(1);
    const [after] = await db
      .select()
      .from(schema.scheduledTransitionTable)
      .where(eq(schema.scheduledTransitionTable.id, row.id));
    expect(after?.state).toBe("cancelled");
  });

  it("fails closed without an executor: the row stays pending and the run is degraded", async () => {
    const f = await fixture();
    const row = await scheduledRow(f, -5);
    const outcome = await runScheduledTransitions(null);
    expect(outcome).toMatchObject({ fired: 0, degraded: true });
    const [after] = await db
      .select()
      .from(schema.scheduledTransitionTable)
      .where(eq(schema.scheduledTransitionTable.id, row.id));
    expect(after?.state).toBe("pending");
  });
});

describe("SLA-17 escalation walk", () => {
  beforeEach(async () => resetTestDatabase());

  it("stops a due walk when the assignee changed since it started (NO-22)", async () => {
    const f = await fixture();
    const [walk] = await db
      .insert(slaEscalationTable)
      .values({
        workspaceId: f.owner.workspace.id,
        projectId: f.project.id,
        workItemId: f.item.id,
        metric: "resolution",
        triggerEventId: `evt_${randomUUID()}`,
        stateIdAtStart: f.waiting.id,
        assigneeIdAtStart: null,
        lastOrder: 1,
        nextDueAt: new Date(Date.now() - 60_000),
      })
      .returning();
    await db.insert(schema.workItemSlaCacheTable).values({
      workItemId: f.item.id,
      metric: "resolution",
      state: "breached",
      computedAt: new Date(),
    });
    const person = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, f.owner.user.id)),
      "person",
    );
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: person.id })
      .where(eq(schema.workItemTable.id, f.item.id));
    const outcome = await advanceDueEscalations();
    expect(outcome.stopped).toBe(1);
    const [after] = await db
      .select()
      .from(slaEscalationTable)
      .where(eq(slaEscalationTable.id, walk?.id ?? ""));
    expect(after).toMatchObject({
      state: "stopped",
      stopReason: "assignment_changed",
    });
  });
});
