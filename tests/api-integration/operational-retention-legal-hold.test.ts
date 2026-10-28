/**
 * P4R1-M5: the 30-day purges of `webhook_delivery` and `automation_run` obey legal holds like the
 * other retention jobs (`background-jobs.md`: retention obeys person, source, recipient and
 * resource-owner legal holds). Every case is two-sided: the same row is purged once the hold lifts,
 * so a passing "retained" assertion cannot mean "nothing matched".
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { purgeExpiredAutomationRuns } from "../../apps/api/src/automation/executor";
import db, { schema } from "../../apps/api/src/database";
import {
  automationRunTable,
  automationTable,
  webhookDeliveryTable,
  webhookTable,
} from "../../apps/api/src/database/schema";
import { purgeExpiredWebhookDeliveries } from "../../apps/api/src/webhook/delivery";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

const OLD = new Date(Date.now() - 40 * 86_400_000);

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
  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  const orgId = `hold-org-${randomUUID()}`;
  await db.insert(schema.organisationTable).values({
    id: orgId,
    key: orgId,
    name: "Project org",
    isInternal: false,
    portalAccess: true,
  });
  await db
    .update(schema.projectTable)
    .set({ organisationId: orgId })
    .where(eq(schema.projectTable.id, project.id));
  const webhook = requireRow(
    await db
      .insert(webhookTable)
      .values({
        workspaceId: workspace.id,
        name: "Ops hook",
        url: "https://hooks.example.com/in",
        secret: "plain-test-secret",
        events: ["work_item.created"],
        createdBy: person.id,
      })
      .returning(),
    "webhook",
  );
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "workspace",
        workspaceId: workspace.id,
        key: `retention-${randomUUID()}`,
        name: "Retention",
        rank: 10,
        capabilities: [],
      })
      .returning(),
    "role",
  );
  const automation = requireRow(
    await db
      .insert(automationTable)
      .values({
        workspaceId: workspace.id,
        name: "Rule",
        trigger: "work_item.created",
        effectiveRoleId: role.id,
        createdBy: person.id,
      })
      .returning(),
    "automation",
  );
  const [workspaceRow] = await db
    .select()
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspace.id));
  return {
    workspaceId: workspace.id,
    projectId: project.id,
    workspaceOrg: workspaceRow?.organisationId as string,
    projectOrg: orgId,
    webhook,
    automation,
  };
}
type World = Awaited<ReturnType<typeof world>>;

async function oldDelivery(w: World) {
  return requireRow(
    await db
      .insert(webhookDeliveryTable)
      .values({
        webhookId: w.webhook.id,
        workspaceId: w.workspaceId,
        eventId: `evt_${randomUUID()}`,
        eventKind: "work_item.created",
        projectId: w.projectId,
        state: "delivered",
        createdAt: OLD,
        requestBody: { title: "customer data" },
      })
      .returning(),
    "delivery",
  );
}

async function oldRun(w: World) {
  return requireRow(
    await db
      .insert(automationRunTable)
      .values({
        automationId: w.automation.id,
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        eventId: `evt_${randomUUID()}`,
        state: "done",
        triggeredAt: OLD,
      })
      .returning(),
    "run",
  );
}

async function place(scope: "organisation" | "person", scopeId: string) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({ scope, scopeId, placedBy: "test", reason: "retention test" })
      .returning(),
    "hold",
  );
}
async function lift(id: string) {
  await db
    .update(schema.legalHoldTable)
    .set({ liftedAt: new Date(), liftedBy: "test" })
    .where(eq(schema.legalHoldTable.id, id));
}
async function exists(table: typeof webhookDeliveryTable, id: string) {
  return (await db.select().from(table).where(eq(table.id, id))).length === 1;
}
async function runExists(id: string) {
  return (
    (
      await db
        .select()
        .from(automationRunTable)
        .where(eq(automationRunTable.id, id))
    ).length === 1
  );
}

describe("operational retention obeys legal holds", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("purges unheld rows past 30 days", async () => {
    const w = await world();
    const d = await oldDelivery(w);
    const r = await oldRun(w);
    expect(await purgeExpiredWebhookDeliveries(new Date())).toBe(1);
    expect(await purgeExpiredAutomationRuns(new Date())).toBe(1);
    expect(await exists(webhookDeliveryTable, d.id)).toBe(false);
    expect(await runExists(r.id)).toBe(false);
  });

  it.each([
    ["workspace organisation", "workspaceOrg"],
    ["project organisation", "projectOrg"],
  ] as const)(
    "keeps webhook deliveries and automation runs under a %s hold until it lifts",
    async (_label, orgKey) => {
      const w = await world();
      const d = await oldDelivery(w);
      const r = await oldRun(w);
      const hold = await place("organisation", w[orgKey]);

      expect(await purgeExpiredWebhookDeliveries(new Date())).toBe(0);
      expect(await purgeExpiredAutomationRuns(new Date())).toBe(0);
      expect(await exists(webhookDeliveryTable, d.id)).toBe(true);
      expect(await runExists(r.id)).toBe(true);

      await lift(hold.id);
      expect(await purgeExpiredWebhookDeliveries(new Date())).toBe(1);
      expect(await purgeExpiredAutomationRuns(new Date())).toBe(1);
    },
  );
});
