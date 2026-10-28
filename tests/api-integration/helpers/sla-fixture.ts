/** Shared SLA fixture (calendar, 100-minute policy, one pinned item) for SLA integration tests. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import { resolveRequestIdentity } from "../../../apps/api/src/permissions/resolve-request-identity";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./fixtures";

export const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
export async function slaFixture(elapsed = 85) {
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
