/** TM-9: team notification actions use persisted runs, current team reach, and transactional fan-out. */
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
  notificationDeliveryTable,
  teamMemberTable,
  workspaceFeatureFlagTable,
} from "../../apps/api/src/database/schema";
import { enqueueOutboxEvent } from "../../apps/api/src/events/outbox";
import {
  getCanonicalPreferences,
  saveCanonicalPreference,
} from "../../apps/api/src/notification/canonical-preferences";
import { evaluateCurrentNotificationReachAndPreference } from "../../apps/api/src/notification/current-eligibility";
import { mockAuthenticatedSession } from "./helpers/auth";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { makeTeam, workItemWorld } from "./helpers/p4-closeout";
import { addMember } from "./helpers/reach-world";

async function setup() {
  const creator = await createWorkspaceMember({ role: "owner" });
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, creator.user.id))
      .limit(1),
    "automation creator person",
  );
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        id: `role-${randomUUID()}`,
        scope: "workspace",
        workspaceId: creator.workspace.id,
        key: `notify-${randomUUID()}`,
        name: "Notifier",
        rank: 50,
        capabilities: ["work_item:read"],
      })
      .returning(),
    "automation role",
  );
  await db.insert(workspaceFeatureFlagTable).values({
    workspaceId: creator.workspace.id,
    featureKey: "feature.automations",
    enabled: true,
  });
  await db.insert(schema.instancePluginConfigTable).values({
    id: `plugin-${randomUUID()}`,
    pluginId: "notify.email",
    instanceKey: "default",
    displayName: "Email",
    enabled: true,
    config: {},
    secrets: null,
    scope: "instance",
    workspaceId: null,
    portalScope: null,
    configVersion: 1,
  });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const item = await workItemWorld(creator.workspace.id, project.id).then(
    (world) => world.makeItem("Review team notification"),
  );
  const member = await addMember(creator.workspace.id, "member");
  const noReach = await addMember(creator.workspace.id, "member");
  await grantProjectRole(member.user.id, project.id, ["work_item:read"]);
  const team = await makeTeam(creator.workspace.id, [
    member.user.id,
    noReach.user.id,
  ]);
  await saveCanonicalPreference(member.user.id, {
    eventKind: "automation.notification_sent",
    channel: "notify.email",
    scope: "global",
    scopeId: null,
    enabled: true,
    digest: "hourly",
  });
  const actor: AutomationActor = {
    userId: creator.user.id,
    personId: person.id,
    actorType: "person",
    apiKeyId: null,
  };
  const definition = validateRuleDefinition({
    trigger: "work_item.created",
    conditions: [],
    actions: [
      {
        type: "notify",
        teamId: team.id,
        title: "{{work_item.key}} needs attention",
        body: "Review {{work_item.title}}",
      },
    ],
  });
  if (!definition.ok) throw new Error(JSON.stringify(definition.problems));
  const rule = await createAutomation({
    workspaceId: creator.workspace.id,
    projectId: null,
    name: "Notify team",
    effectiveRoleId: role.id,
    stopProcessing: false,
    definition: definition.value,
    actor,
  });
  await setAutomationEnabled(rule.id, true, actor);
  return { creator, project, item, member, team, rule };
}

describe("TM-9 automation team notification", () => {
  beforeEach(async () => resetTestDatabase());

  it("writes one automation event and notifies only active reachable team members", async () => {
    const state = await setup();
    const sourceEventId = `evt_${randomUUID()}`;
    await db.transaction(async (tx) => {
      const source = {
        id: sourceEventId,
        kind: "work_item.created" as const,
        occurredAt: new Date().toISOString(),
        actor: {
          type: "person" as const,
          id: state.creator.user.id,
          name: "Automation creator",
        },
        scope: {
          workspaceId: state.creator.workspace.id,
          projectId: state.project.id,
        },
        payload: { key: state.item.key, workItemId: state.item.id },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      };
      await enqueueOutboxEvent(tx, source);
      await enqueueAutomationRuns(tx, source);
    });

    expect(await processNextAutomationEvent()).toMatchObject({ kind: "ran" });

    const [sent] = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "automation.notification_sent"));
    const eventRow = requireRow(
      sent ? [sent] : [],
      "automation notification event",
    );
    expect(eventRow).toMatchObject({
      workspaceId: state.creator.workspace.id,
    });
    const envelope = eventRow.payload as Record<string, unknown>;
    expect(envelope).toMatchObject({
      scope: {
        workspaceId: state.creator.workspace.id,
        projectId: state.project.id,
      },
      originAutomationId: state.rule.id,
      depth: 1,
    });
    expect(envelope.payload).toMatchObject({
      key: state.item.key,
      workItemId: state.item.id,
      teamId: state.team.id,
      title: `${state.item.key} needs attention`,
      body: `Review ${state.item.title}`,
    });
    const inbox = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.eventId, eventRow.eventId));
    expect(inbox).toHaveLength(1);
    const inboxRow = requireRow(inbox, "team notification inbox row");
    expect(inboxRow).toMatchObject({
      userId: state.member.user.id,
      kind: "automation.notification_sent",
      title: `${state.item.key} needs attention`,
      body: `Review ${state.item.title}`,
      resourceType: "work_item",
      resourceId: state.item.id,
    });
    const [delivery] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.eventId, eventRow.eventId));
    const deliveryRow = requireRow(
      delivery ? [delivery] : [],
      "team notification delivery",
    );
    expect(deliveryRow.digestId).toEqual(expect.any(String));
    expect(deliveryRow.channel).toBe("notify.email");

    // Delivery-time eligibility also checks the current roster, not only the event-time snapshot.
    await db
      .delete(teamMemberTable)
      .where(
        and(
          eq(teamMemberTable.teamId, state.team.id),
          eq(teamMemberTable.userId, state.member.user.id),
        ),
      );
    const current = await db.transaction((tx) =>
      evaluateCurrentNotificationReachAndPreference(tx, {
        id: deliveryRow.id,
        eventId: eventRow.eventId,
        recipientPersonId: state.member.personId,
        channel: deliveryRow.channel,
        workspaceId: deliveryRow.workspaceId,
        organisationId: deliveryRow.organisationId,
        dedupeKey: deliveryRow.dedupeKey,
        attempts: deliveryRow.attempts,
        eventKind: "automation.notification_sent",
        payload: envelope as never,
        title: inboxRow.title,
        body: inboxRow.body,
        resourceType: "work_item",
        resourceId: state.item.id,
      }),
    );
    expect(current).toMatchObject({
      kind: "suppress",
      reason: "team_membership_lost",
    });
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "automation.notification_sent"),
            eq(schema.auditLogTable.entityId, state.item.id),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.activityTable)
        .where(
          and(
            eq(schema.activityTable.workItemId, state.item.id),
            eq(schema.activityTable.field, "notification"),
          ),
        ),
    ).toHaveLength(1);
  });

  it("keeps staff team notification preferences unavailable to customer identities", async () => {
    const customer = await createCustomerPrincipal();
    mockAuthenticatedSession(customer.user);
    await expect(
      getCanonicalPreferences(customer.user.id),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      saveCanonicalPreference(customer.user.id, {
        eventKind: "automation.notification_sent",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        enabled: true,
        digest: "daily",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
