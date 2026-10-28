/**
 * P6 round-1 fixes (writer side): P6-R1-01 imported items carry no live SLA clock and closed items
 * are resolved; P6-R1-07 imports never trigger automations or outbound webhooks.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadItemFacts } from "../../../apps/api/src/agile/item-facts.repository";
import { enqueueAutomationRuns } from "../../../apps/api/src/automation/consumer";
import {
  type AutomationActor,
  createAutomation,
  setAutomationEnabled,
} from "../../../apps/api/src/automation/repository";
import { validateRuleDefinition } from "../../../apps/api/src/automation/validation";
import db, { schema } from "../../../apps/api/src/database";
import {
  automationRunTable,
  webhookDeliveryTable,
  webhookTable,
  workspaceFeatureFlagTable,
} from "../../../apps/api/src/database/schema";
import { parseParentEnvelope } from "../../../apps/api/src/events/outbox-consumer";
import { createApp } from "../../../apps/api/src/index";
import { encryptSecret } from "../../../apps/api/src/notification-preferences/secrets";
import { scanSla } from "../../../apps/api/src/scheduler/sla-scan";
import { enqueueWebhookDeliveries } from "../../../apps/api/src/webhook/consumer";
import createWorkItem from "../../../apps/api/src/work-item/controllers/create-work-item";
import { resetTestDatabase } from "../helpers/database";
import { requireRow } from "../helpers/fixtures";
import {
  commitChunk,
  createRun,
  record,
  type WriterFixture,
  writerFixture,
} from "./writer-fixture";

process.env.TASKDESK_ENCRYPTION_KEY ??= "e1".repeat(32);

beforeEach(async () => resetTestDatabase());

async function addState(f: WriterFixture, group: string) {
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: f.workspace.id,
        key: `p6w-${randomUUID()}`,
        name: group,
        group,
      })
      .returning(),
    "state template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({ projectId: f.project.id, stateTemplateId: template.id })
      .returning(),
    "state",
  );
}

/** A workspace default policy with one-minute goals, effective for a day: a native item pins it. */
async function installTightSlaPolicy(f: WriterFixture) {
  const calendar = requireRow(
    await db
      .insert(schema.serviceCalendarTable)
      .values({
        workspaceId: f.workspace.id,
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
      .values({ workspaceId: f.workspace.id, name: "One minute" })
      .returning(),
    "policy",
  );
  const version = requireRow(
    await db
      .insert(schema.slaPolicyVersionTable)
      .values({
        workspaceId: f.workspace.id,
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
        workspaceId: f.workspace.id,
        versionId: version.id,
        metric,
        priority,
        workItemTypeId: f.type.id,
        targetMinutes: 1,
      })),
    ),
  );
  await db
    .update(schema.slaPolicyVersionTable)
    .set({ effectiveFrom: new Date(Date.now() - 24 * 60 * 60_000) })
    .where(eq(schema.slaPolicyVersionTable.id, version.id));
  await db
    .update(schema.slaPolicyTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.slaPolicyTable.id, policy.id));
  await db
    .update(schema.workspaceTable)
    .set({ defaultSlaPolicyId: policy.id })
    .where(eq(schema.workspaceTable.id, f.workspace.id));
  return { version };
}

async function itemByKey(key: string) {
  return requireRow(
    await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key)),
    `item ${key}`,
  );
}

describe("P6-R1-01: imported items have no live SLA clock and closed ones are resolved", () => {
  it("resolves completed items from source times, never breaches or escalates them, and counts them done", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const { version } = await installTightSlaPolicy(f);
    const done = await addState(f, "completed");
    const cancelled = await addState(f, "cancelled");

    // Control: a native item in the same project pins the policy, so the policy really applies.
    const native = await createWorkItem({
      workspaceId: f.workspace.id,
      projectId: f.project.id,
      typeId: f.type.id,
      title: "Native",
      priority: "high",
      actorId: f.user.id,
      actorType: "person",
    });
    expect(native.slaPolicyVersionId).toBe(version.id);

    const run = await createRun(app, f, "sla-closed");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "CLOSED", {
        stateId: done.id,
        sourceCreatedAt: "2020-01-01T00:00:00.000Z",
        sourceUpdatedAt: "2020-02-01T00:00:00.000Z",
        sourceResolvedAt: "2020-01-15T10:00:00.000Z",
      }),
      record(f, "CLOSED-NO-RESOLVED", {
        stateId: done.id,
        sourceCreatedAt: "2020-03-01T00:00:00.000Z",
        sourceUpdatedAt: "2020-03-09T00:00:00.000Z",
      }),
      record(f, "CANCELLED", {
        stateId: cancelled.id,
        sourceCreatedAt: "2020-04-01T00:00:00.000Z",
      }),
      record(f, "OPEN", { sourceCreatedAt: "2020-05-01T00:00:00.000Z" }),
    ]);
    expect(commit.counts).toMatchObject({ created: 4, rejected: 0 });
    const byId = new Map(
      await Promise.all(
        commit.rows.map(async (row) => {
          const [item] = await db
            .select()
            .from(schema.workItemTable)
            .where(eq(schema.workItemTable.id, row.targetId as string));
          return [row.sourceId, item] as const;
        }),
      ),
    );

    const closed = byId.get("CLOSED");
    expect(closed?.resolvedAt?.toISOString()).toBe("2020-01-15T10:00:00.000Z");
    expect(closed?.firstResponseAt?.toISOString()).toBe(
      "2020-01-15T10:00:00.000Z",
    );
    expect(byId.get("CLOSED-NO-RESOLVED")?.resolvedAt?.toISOString()).toBe(
      "2020-03-09T00:00:00.000Z",
    );
    // WF-17: cancelled is closed by its state group but was never "resolved".
    expect(byId.get("CANCELLED")?.resolvedAt).toBeNull();
    expect(byId.get("OPEN")?.resolvedAt).toBeNull();
    // No SLA attachment for any imported item, open or closed.
    for (const item of byId.values()) {
      expect(item?.slaPolicyVersionId).toBeNull();
    }

    const outcome = await scanSla();
    expect(outcome.degraded).toBe(false);
    const imported = [...byId.values()].map((item) => item?.id as string);
    const cache = await db.select().from(schema.workItemSlaCacheTable);
    expect(cache.filter((row) => imported.includes(row.workItemId))).toEqual(
      [],
    );
    const slaEvents = (await db.select().from(schema.outboxTable)).filter(
      (row) =>
        row.kind.startsWith("sla.") || row.kind === "work_item.escalated",
    );
    expect(
      slaEvents.filter((row) =>
        imported.some((id) => JSON.stringify(row.payload).includes(id)),
      ),
    ).toEqual([]);

    // Agile progress and the portal/reopen readers see the group and resolved time.
    const facts = await loadItemFacts(
      db,
      eq(schema.workItemTable.projectId, f.project.id),
    );
    const factOf = (sourceId: string) =>
      facts.find((fact) => fact.id === byId.get(sourceId)?.id);
    expect(factOf("CLOSED")).toMatchObject({ group: "completed" });
    expect(factOf("CLOSED")?.resolvedAt).not.toBeNull();
    expect(factOf("CANCELLED")).toMatchObject({ group: "cancelled" });
    expect(factOf("OPEN")).toMatchObject({
      group: "backlog",
      resolvedAt: null,
    });

    // A rerun never undoes a person's later reopen: state is first-import only.
    await db
      .update(schema.workItemTable)
      .set({ resolvedAt: null })
      .where(eq(schema.workItemTable.id, closed?.id as string));
    const run2 = await createRun(app, f, "sla-closed");
    await commitChunk(app, f, run2.id, "c1", [
      record(f, "CLOSED", {
        stateId: done.id,
        sourceResolvedAt: "2020-01-15T10:00:00.000Z",
      }),
    ]);
    expect((await itemByKey(closed?.key as string)).resolvedAt).toBeNull();
  });
});

describe("P6-R1-07: imports do not trigger automations or outbound webhooks", () => {
  it("skips import-sourced events in both consumers and keeps the outbox records", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const done = await addState(f, "completed");

    await db.insert(workspaceFeatureFlagTable).values({
      workspaceId: f.workspace.id,
      featureKey: "feature.automations",
      enabled: true,
    });
    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: f.workspace.id,
          key: `automation-agent-${randomUUID()}`,
          name: "Automation agent",
          rank: 50,
          capabilities: ["work_item:read", "work_item:assign"],
        })
        .returning(),
      "role",
    );
    const actor: AutomationActor = {
      userId: f.user.id,
      personId: f.person.id,
      actorType: "person",
      apiKeyId: null,
    };
    const validated = validateRuleDefinition({
      trigger: "work_item.created",
      conditions: [],
      actions: [{ type: "assign", assigneeId: f.person.id }],
      projectFilter: null,
    });
    if (!validated.ok) throw new Error(JSON.stringify(validated.problems));
    const rule = await createAutomation({
      workspaceId: f.workspace.id,
      projectId: null,
      name: "On created",
      effectiveRoleId: role.id,
      stopProcessing: false,
      definition: validated.value,
      actor,
    });
    await setAutomationEnabled(rule.id, true, actor);
    await db.insert(webhookTable).values({
      workspaceId: f.workspace.id,
      name: "Ops hook",
      url: "https://hooks.example.com/in",
      secret: encryptSecret("whsec_integration_secret_0000000") as string,
      events: ["work_item.created", "work_item.assigned", "work_item.updated"],
      createdBy: f.person.id,
    });

    const run = await createRun(app, f, "events-import");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "EV-1", {
        stateId: done.id,
        item: {
          typeId: f.type.id,
          title: "Imported with assignee",
          assigneeId: f.person.id,
          startDate: "2020-01-01T00:00:00.000Z",
        },
      }),
    ]);
    expect(commit.counts).toMatchObject({ created: 1 });

    const outbox = (await db.select().from(schema.outboxTable)).filter((row) =>
      row.kind.startsWith("work_item."),
    );
    const kinds = new Set(outbox.map((row) => row.kind));
    expect(kinds).toContain("work_item.created");
    expect(kinds).toContain("work_item.assigned");
    expect(kinds).toContain("work_item.updated");
    for (const row of outbox) {
      const envelope = parseParentEnvelope(row);
      expect({
        kind: row.kind,
        source: (envelope.payload as { source?: string }).source,
      }).toEqual({ kind: row.kind, source: "import" });
      expect(
        await db.transaction((tx) => enqueueWebhookDeliveries(tx, envelope)),
      ).toBe(0);
      expect(
        await db.transaction((tx) => enqueueAutomationRuns(tx, envelope)),
      ).toBe(0);
    }
    expect(await db.select().from(webhookDeliveryTable)).toEqual([]);
    expect(await db.select().from(automationRunTable)).toEqual([]);

    // Control: the same envelope from a native writer still reaches both consumers.
    const created = outbox.find((row) => row.kind === "work_item.created");
    const base = parseParentEnvelope(requireRow(created ? [created] : [], "c"));
    const native = {
      ...base,
      payload: {
        ...(base.payload as Record<string, unknown>),
        source: "agent",
      },
    };
    expect(
      await db.transaction((tx) => enqueueWebhookDeliveries(tx, native)),
    ).toBe(1);
    expect(
      await db.transaction((tx) => enqueueAutomationRuns(tx, native)),
    ).toBe(1);
  });
});
