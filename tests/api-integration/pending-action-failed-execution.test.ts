import { defaultRolePayloads } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { apiKeyExtensionTable } from "../../apps/api/src/database/schema";
import { withPendingActionFailureOutcome } from "../../apps/api/src/pending-action/execution-failure";
import { createPendingAction } from "../../apps/api/src/pending-action/service";
import { approveWorkItemDeletion } from "../../apps/api/src/pending-action/work-item-deletion-target";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, requireRow } from "./helpers/fixtures";

/**
 * PA-6 step 5 / PA-11 fault injection and PA-4 requester notification.
 * DB integration test: run only against a dedicated `_test` database.
 */
const fault = vi.hoisted(() => ({ deleteThrows: false, deleteRefuses: false }));

vi.mock(
  "../../apps/api/src/work-item/controllers/delete-work-item",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/work-item/controllers/delete-work-item")
      >();
    return {
      ...actual,
      deleteWorkItemInTransaction: vi.fn(
        async (
          ...args: Parameters<typeof actual.deleteWorkItemInTransaction>
        ) => {
          if (fault.deleteRefuses) {
            const { HTTPException } = await import("hono/http-exception");
            throw new HTTPException(409, {
              message: "pending_action_target_changed",
            });
          }
          if (fault.deleteThrows)
            throw Object.assign(new Error("injected executor fault"), {
              code: "XX000",
            });
          return actual.deleteWorkItemInTransaction(...args);
        },
      ),
    };
  },
);

const organisationId = "organisation-pa-failed-test";
const workspaceId = "workspace-pa-failed-test";
const userId = "user-pa-failed-test";
const requesterPersonId = "person-pa-failed-test";
const sessionId = "session-pa-failed-test";
let projectId = "";

function webRequest() {
  return {
    requesterPersonId,
    credentialType: "session" as const,
    credentialId: sessionId,
    origin: "web" as const,
    action: "delete" as const,
    routeKey: "DELETE /api/work-items/{key}" as const,
    targetType: "work_item",
    targetIds: ["SUP-1"],
    workspaceId,
    projectId,
    organisationId,
    actorId: requesterPersonId,
    actorType: "person" as const,
  };
}

function approval(id: string) {
  return {
    id,
    requesterPersonId,
    userId,
    sessionId,
    traceId: `trace-${id}`,
  };
}

async function insertDeleteKey(id: string, name: string | null, isMcp = false) {
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    id,
    name,
    referenceId: userId,
    key: `${id}-secret`,
    permissions: JSON.stringify({ work_item: ["delete"] }),
    createdAt: now,
    updatedAt: now,
    enabled: true,
  });
  // F13 / PA-4: the pending-action origin of a key request comes from the key's stored `is_mcp`
  // flag (the extension row), not from what the caller asks for.
  await db.insert(apiKeyExtensionTable).values({
    apikeyId: id,
    personId: requesterPersonId,
    isMcp,
  });
}

async function notificationsFor(pendingActionId: string) {
  return db
    .select({
      personId: schema.notificationTable.personId,
      kind: schema.notificationTable.kind,
      title: schema.notificationTable.title,
      body: schema.notificationTable.body,
      resourceType: schema.notificationTable.resourceType,
      resourceId: schema.notificationTable.resourceId,
    })
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.resourceId, pendingActionId));
}

describe("pending-action failed execution and requester notification", () => {
  beforeEach(async () => {
    fault.deleteThrows = false;
    fault.deleteRefuses = false;
    await resetTestDatabase();
    await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
    await db.insert(schema.organisationTable).values({
      id: organisationId,
      key: organisationId,
      name: "PA failed organisation",
    });
    await db.insert(schema.userTable).values({
      id: userId,
      name: "PA Failed Requester",
      email: "pa-failed-requester@example.test",
    });
    await db.insert(schema.personTable).values({
      id: requesterPersonId,
      userId,
      organisationId,
      side: "staff",
    });
    await db.insert(schema.workspaceTable).values({
      id: workspaceId,
      organisationId,
      name: "PA failed workspace",
      slug: "pa-failed-test",
      createdAt: new Date(),
    });
    await db.insert(schema.workspaceUserTable).values({
      id: "workspace-member-pa-failed-test",
      workspaceId,
      userId,
      role: "admin",
      joinedAt: new Date(),
    });
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role: "admin",
      permission: JSON.stringify(defaultRolePayloads.admin),
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const project = await createProjectFixture({
      workspaceId,
      slug: "pa-failed-test-project",
    });
    projectId = project.project.id;
    await db.insert(schema.roleTable).values({
      id: "role-pa-failed-test-delete",
      scope: "project",
      workspaceId,
      key: "pa-failed-test-delete",
      name: "PA failed delete role",
      rank: 100,
      capabilities: ["work_item:delete"],
      isSystem: false,
      isEditable: true,
    });
    await db.insert(schema.membershipTable).values({
      id: "membership-pa-failed-test-delete",
      personId: requesterPersonId,
      scope: "project",
      scopeId: projectId,
      roleId: "role-pa-failed-test-delete",
    });
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: "pa-failed-test-session-token",
      userId,
      portal: "agent",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const now = new Date();
    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId,
          key: "pa-failed-test-type",
          name: "Work item",
          category: "delivery",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "work item type",
    );
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId,
          key: "pa-failed-test-state",
          name: "Backlog",
          group: "backlog",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "state template",
    );
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId,
          stateTemplateId: template.id,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "state",
    );
    await db.insert(schema.workItemTable).values({
      projectId,
      workspaceId,
      typeId: type.id,
      stateId: state.id,
      number: 1,
      key: "SUP-1",
      title: "Failed execution target",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("PA-6 step 5 fault injection: a throwing executor leaves a terminal failed action with events, audits and a requester notification", async () => {
    const { pendingActionId } = await createPendingAction(webRequest());
    fault.deleteThrows = true;

    const error = await withPendingActionFailureOutcome(
      approval(pendingActionId),
      () => approveWorkItemDeletion(approval(pendingActionId)),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      status: 500,
      message: "pending_action_failed",
    });

    const [row] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingActionId));
    expect(row).toMatchObject({
      state: "failed",
      error: "execution_failed:XX000",
      decidedByPersonId: requesterPersonId,
      decisionSessionId: sessionId,
      executedAt: null,
    });
    expect(row?.error).not.toContain("injected");

    // The approval transaction rolled back: nothing was deleted.
    const [item] = await db
      .select({ deletedAt: schema.workItemTable.deletedAt })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, "SUP-1"));
    expect(item?.deletedAt).toBeNull();

    const events = await db
      .select({
        kind: schema.outboxTable.kind,
        payload: schema.outboxTable.payload,
      })
      .from(schema.outboxTable)
      .where(
        sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${pendingActionId}`,
      );
    expect(events.map((event) => event.kind).sort()).toEqual([
      "pending_action.decided",
      "pending_action.executed",
      "pending_action.requested",
    ]);
    expect(
      events.find((event) => event.kind === "pending_action.executed")?.payload,
    ).toMatchObject({
      actor: { type: "system" },
      payload: {
        pendingActionId,
        action: "delete",
        targetIds: ["SUP-1"],
        outcome: "failed",
        error: "execution_failed:XX000",
      },
    });
    expect(
      events.find((event) => event.kind === "pending_action.decided")?.payload,
    ).toMatchObject({ payload: { pendingActionId, outcome: "approved" } });

    const audits = await db
      .select({
        action: schema.auditLogTable.action,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, pendingActionId));
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "pending_action.decided",
          after: { outcome: "approved" },
        }),
        expect.objectContaining({
          action: "pending_action.executed",
          after: expect.objectContaining({
            outcome: "failed",
            state: "failed",
            error: "execution_failed:XX000",
          }),
        }),
      ]),
    );

    expect(await notificationsFor(pendingActionId)).toEqual([
      {
        personId: requesterPersonId,
        kind: "pending_action.executed",
        title: "Approved deletion failed",
        body: "The deletion of SUP-1 you approved could not be completed. Nothing was deleted.",
        resourceType: "pending_action",
        resourceId: pendingActionId,
      },
    ]);

    // Terminal: a later approval cannot revive it.
    fault.deleteThrows = false;
    await expect(
      approveWorkItemDeletion(approval(pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("an expected refusal inside the executor does not mark the action failed", async () => {
    const { pendingActionId } = await createPendingAction(webRequest());
    // The executor itself refuses with an HTTPException: an expected refusal, not a failure.
    fault.deleteRefuses = true;
    await expect(
      withPendingActionFailureOutcome(approval(pendingActionId), () =>
        approveWorkItemDeletion(approval(pendingActionId)),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "pending_action_target_changed",
    });
    const [row] = await db
      .select({
        state: schema.pendingActionTable.state,
        error: schema.pendingActionTable.error,
      })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingActionId));
    // The approval transaction rolled back; the action is still pending, not failed.
    expect(row).toEqual({ state: "pending", error: null });
  });

  it.each(["api", "mcp"] as const)(
    "PA-4: notifies the requester of a %s-origin request naming the key and target",
    async (origin) => {
      if (origin === "mcp") {
        await db.insert(schema.instanceFeatureFlagTable).values({
          featureKey: "feature.mcp",
          enabled: true,
        });
      }
      await insertDeleteKey(
        `pa-failed-key-${origin}`,
        "ci-bot",
        origin === "mcp",
      );
      const { pendingActionId } = await createPendingAction({
        ...webRequest(),
        credentialType: "api_key",
        credentialId: `pa-failed-key-${origin}`,
        origin,
        actorId: userId,
        actorType: "api_key",
      });

      expect(await notificationsFor(pendingActionId)).toEqual([
        {
          personId: requesterPersonId,
          kind: "pending_action.requested",
          title: "Deletion awaiting your approval",
          body: "An agent using your key ci-bot asked to delete SUP-1.",
          resourceType: "pending_action",
          resourceId: pendingActionId,
        },
      ]);
      const [event] = await db
        .select({ payload: schema.outboxTable.payload })
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.requested"));
      expect(event?.payload).toMatchObject({
        actor: {
          type: "api_key",
          id: `pa-failed-key-${origin}`,
          name: "ci-bot",
        },
        payload: { pendingActionId, origin },
      });
    },
  );

  it("PA-4: a web-origin request writes no notification", async () => {
    const { pendingActionId } = await createPendingAction(webRequest());
    expect(await notificationsFor(pendingActionId)).toEqual([]);
  });

  it("PA-4: an inactive requester is not substituted by anyone", async () => {
    await insertDeleteKey("pa-failed-key-inactive", "ci-bot");
    const { pendingActionId } = await createPendingAction({
      ...webRequest(),
      credentialType: "api_key",
      credentialId: "pa-failed-key-inactive",
      origin: "api",
      actorId: userId,
      actorType: "api_key",
    });
    // Replay the requested event's fan-out after the requester lost its login.
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, requesterPersonId));
    await db
      .delete(schema.notificationTable)
      .where(eq(schema.notificationTable.resourceId, pendingActionId));
    const { materializeNotificationFanout } = await import(
      "../../apps/api/src/notification/fanout"
    );
    const { resolvePendingActionEventRecipients } = await import(
      "../../apps/api/src/notification/recipient-resolvers"
    );
    const [event] = await db
      .select({ payload: schema.outboxTable.payload })
      .from(schema.outboxTable)
      .where(
        and(
          eq(schema.outboxTable.kind, "pending_action.requested"),
          sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${pendingActionId}`,
        ),
      );
    await db.transaction((tx) =>
      materializeNotificationFanout(
        tx,
        event?.payload as Parameters<typeof materializeNotificationFanout>[1],
        { resolveRecipients: resolvePendingActionEventRecipients },
      ),
    );
    expect(await notificationsFor(pendingActionId)).toEqual([]);
  });
});
