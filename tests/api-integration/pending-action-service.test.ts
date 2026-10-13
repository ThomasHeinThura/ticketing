import { defaultRolePayloads } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { auth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { withExplicitCredentialMutation } from "../../apps/api/src/pending-action/credential-invalidation";
import {
  type ActionRequiredAccessInput,
  evaluateActionRequiredAccess,
} from "../../apps/api/src/pending-action/required-access";
import {
  createPendingAction,
  decideOwnPendingAction,
} from "../../apps/api/src/pending-action/service";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, requireRow } from "./helpers/fixtures";

async function waitForLifecycleLockCount(
  client: Client,
  condition: "granted" | "waiting",
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid = hashtext('taskdesk:pending-action-lifecycle')::oid
          AND objid = hashtext('global')::oid
          AND objsubid = 2
          AND granted = $1
      `,
      [condition === "granted"],
    );
    if (Number(result.rows[0]?.count ?? "0") > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for pending-action lifecycle ${condition} lock`,
  );
}

const organisationId = "organisation-pending-action-test";
const workspaceId = "workspace-pending-action-test";
const requesterPersonId = "person-pending-action-test";
let projectId = "";

function requestInput(requesterPersonId = "person-pending-action-test") {
  return {
    requesterPersonId,
    credentialType: "session" as const,
    credentialId: "session-pending-action-test",
    origin: "web" as const,
    action: "delete" as const,
    routeKey: "DELETE /api/work-items/{key}",
    targetType: "work_item",
    targetIds: ["SUP-1"],
    workspaceId,
    projectId,
    organisationId,
    actorId: requesterPersonId,
    actorType: "person" as const,
  };
}

async function stateOf(id: string) {
  const [row] = await db
    .select({
      state: schema.pendingActionTable.state,
      invalidationReason: schema.pendingActionTable.invalidationReason,
    })
    .from(schema.pendingActionTable)
    .where(eq(schema.pendingActionTable.id, id));
  return row;
}

async function decisionRows(id: string) {
  const events = await db
    .select({ payload: schema.outboxTable.payload })
    .from(schema.outboxTable)
    .where(
      and(
        eq(schema.outboxTable.kind, "pending_action.decided"),
        sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${id}`,
      ),
    );
  const audits = await db
    .select({ after: schema.auditLogTable.after })
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.action, "pending_action.decided"),
        eq(schema.auditLogTable.entityId, id),
      ),
    );
  return { events, audits };
}

describe("pending-action service persistence", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
    await db.insert(schema.organisationTable).values({
      id: organisationId,
      key: organisationId,
      name: "Pending Action Test Organisation",
    });
    await db.insert(schema.userTable).values({
      id: "user-pending-action-test",
      name: "Pending Action Requester",
      email: "pending-action-requester@example.test",
    });
    await db.insert(schema.personTable).values({
      id: requesterPersonId,
      userId: "user-pending-action-test",
      organisationId,
      side: "staff",
    });
    await db.insert(schema.workspaceTable).values({
      id: "workspace-pending-action-test",
      organisationId,
      name: "Pending Action Test Workspace",
      slug: "pending-action-test",
      createdAt: new Date(),
    });
    await db.insert(schema.workspaceUserTable).values({
      id: "workspace-member-pending-action-test",
      workspaceId,
      userId: "user-pending-action-test",
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
      slug: "pending-action-test-project",
    });
    projectId = project.project.id;
    await db.insert(schema.roleTable).values({
      id: "role-pending-action-test-project-delete",
      scope: "project",
      workspaceId,
      key: "pending-action-test-project-delete",
      name: "Pending-action test delete role",
      rank: 100,
      capabilities: ["work_item:delete"],
      isSystem: false,
      isEditable: true,
    });
    await db.insert(schema.membershipTable).values({
      id: "membership-pending-action-test-project-delete",
      personId: requesterPersonId,
      scope: "project",
      scopeId: projectId,
      roleId: "role-pending-action-test-project-delete",
    });
    await db.insert(schema.sessionTable).values({
      id: "session-pending-action-test",
      token: "pending-action-test-session-token",
      userId: "user-pending-action-test",
      portal: "agent",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const now = new Date();
    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId,
          key: "pending-action-test-type",
          name: "Work item",
          category: "delivery",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "pending-action test work item type",
    );
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId,
          key: "pending-action-test-state",
          name: "Backlog",
          group: "backlog",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "pending-action test state template",
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
      "pending-action test state",
    );
    await db.insert(schema.workItemTable).values({
      projectId,
      workspaceId,
      typeId: type.id,
      stateId: state.id,
      number: 1,
      key: "SUP-1",
      title: "Test request",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("PA-2: persists the bound request and audit row before returning its approval details", async () => {
    const input = {
      ...requestInput(),
      confirmationRequired: "typed_name_step_up",
    };
    const response = await createPendingAction(input);
    const [row] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, response.pendingActionId));
    const auditRows = await db
      .select({
        action: schema.auditLogTable.action,
        entityId: schema.auditLogTable.entityId,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "pending_action.requested"),
          eq(schema.auditLogTable.entityId, response.pendingActionId),
        ),
      );
    const outboxRows = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "pending_action.requested"));

    expect(response).toMatchObject({
      action: "delete",
      summary: {
        key: "SUP-1",
        title: "Test request",
        projectName: "Integration Project",
        requesterName: "Pending Action Requester",
      },
      confirmation: "click",
      approveUrl: `/agent/settings/profile/pending-actions/${response.pendingActionId}`,
    });
    expect(row).toMatchObject({
      state: "pending",
      confirmationRequired: "click",
      requestedByPersonId: input.requesterPersonId,
      routeKey: input.routeKey,
      targetIds: ["SUP-1"],
      payloadSummary: response.summary,
      workspaceId: input.workspaceId,
      projectId,
      organisationId,
    });
    expect(row?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(auditRows).toEqual([
      {
        action: "pending_action.requested",
        entityId: response.pendingActionId,
      },
    ]);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      kind: "pending_action.requested",
      state: "pending",
      workspaceId: input.workspaceId,
      organisationId,
      payload: {
        id: expect.stringMatching(/^evt_/),
        kind: "pending_action.requested",
        actor: {
          type: "person",
          id: input.requesterPersonId,
          name: "Pending Action Requester",
        },
        scope: {
          workspaceId: input.workspaceId,
          organisationId,
        },
        payload: {
          key: response.pendingActionId,
          url: response.approveUrl,
          targetCount: 1,
        },
      },
    });
  });

  it("PA-3/PA-7: derives approval summary from the locked target, not caller input", async () => {
    const response = await createPendingAction({
      ...requestInput(),
      summary: {
        key: "SUP-999",
        title: "Delete a different request",
        projectName: "another project",
      },
    } as Parameters<typeof createPendingAction>[0]);

    expect(response.summary).toEqual({
      key: "SUP-1",
      title: "Test request",
      projectName: "Integration Project",
      requesterName: "Pending Action Requester",
    });
    const [row] = await db
      .select({ summary: schema.pendingActionTable.payloadSummary })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, response.pendingActionId));
    expect(row?.summary).toEqual(response.summary);
  });

  it("PA-6: refuses caller-supplied target versions until an encoding is specified", async () => {
    const input = {
      ...requestInput(),
      targetVersions: { "SUP-1": "forged-current-version" },
    } as Parameters<typeof createPendingAction>[0];

    await expect(createPendingAction(input)).rejects.toThrow(
      /Caller-supplied pending-action target versions are not supported/,
    );
    const rows = await db.select().from(schema.pendingActionTable);
    expect(rows).toHaveLength(0);
  });

  it("rejects an unregistered route key before writing a pending action", async () => {
    const input = requestInput();
    const invalidInput = {
      ...input,
      routeKey: "DELETE /api/not-registered/{id}" as typeof input.routeKey,
    };

    await expect(createPendingAction(invalidInput)).rejects.toThrow(
      /Unknown pending-action route key/,
    );
    const rows = await db.select().from(schema.pendingActionTable);
    expect(rows).toHaveLength(0);
  });

  it("PA-6/PA-7: refuses legacy ID-addressed delete route for key-addressed targets", async () => {
    const input = {
      ...requestInput(),
      routeKey: "DELETE /api/task/{id}",
    } as Parameters<typeof createPendingAction>[0];

    await expect(createPendingAction(input)).rejects.toThrow(
      /Pending-action route must be DELETE \/api\/work-items\/\{key\}/,
    );
    const rows = await db.select().from(schema.pendingActionTable);
    expect(rows).toHaveLength(0);
  });

  it("derives request scope from the target and denies mismatched caller scope", async () => {
    const input = requestInput();
    const response = await createPendingAction({
      ...input,
      workspaceId: undefined,
      projectId: undefined,
      organisationId: undefined,
    });
    const [row] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, response.pendingActionId));
    expect(row).toMatchObject({
      workspaceId,
      projectId,
      organisationId,
    });

    await expect(
      createPendingAction({
        ...requestInput(),
        workspaceId: "another-workspace",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createPendingAction({
        ...requestInput(),
        organisationId: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createPendingAction({
        ...requestInput(),
        projectId: "does-not-exist",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createPendingAction({
        ...requestInput(),
        targetIds: ["missing-work-item"],
      }),
    ).rejects.toMatchObject({ status: 404 });

    const rows = await db.select().from(schema.pendingActionTable);
    expect(rows).toHaveLength(1);
  });

  it("refuses a requester without current workspace reach", async () => {
    await db.insert(schema.userTable).values({
      id: "user-pending-action-outsider",
      name: "Out of reach requester",
      email: "pending-action-outsider@example.test",
    });
    await db.insert(schema.personTable).values({
      id: "person-pending-action-outsider",
      userId: "user-pending-action-outsider",
      organisationId,
      side: "staff",
    });

    await expect(
      createPendingAction(requestInput("person-pending-action-outsider")),
    ).rejects.toMatchObject({ status: 403 });
    const rows = await db.select().from(schema.pendingActionTable);
    expect(rows).toHaveLength(0);
  });

  it.each([
    ["live", null, null, true],
    ["archived", new Date(), null, false],
    ["soft-deleted", null, new Date(), false],
  ] as const)(
    "PA-1: accepts a work-item deletion request only when its project is %s",
    async (_state, archivedAt, deletedAt, isLive) => {
      await db
        .update(schema.projectTable)
        .set({ archivedAt, deletedAt })
        .where(eq(schema.projectTable.id, projectId));

      if (isLive) {
        const response = await createPendingAction(requestInput());
        expect(response.pendingActionId).toBeTruthy();
        expect(await db.select().from(schema.pendingActionTable)).toHaveLength(
          1,
        );
      } else {
        await expect(createPendingAction(requestInput())).rejects.toMatchObject(
          { status: 404 },
        );
        expect(await db.select().from(schema.pendingActionTable)).toHaveLength(
          0,
        );
      }
    },
  );

  it("PA-4/PA-9: rejects an API-key credential without an ID before writing anything", async () => {
    const input = {
      ...requestInput(),
      credentialType: "api_key" as const,
      credentialId: null,
      origin: "api" as const,
      actorId: "user-pending-action-test",
      actorType: "api_key" as const,
    };

    await expect(createPendingAction(input)).rejects.toMatchObject({
      status: 403,
    });
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.requested")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "pending_action.requested")),
    ).toHaveLength(0);
  });

  it("PA-4/PA-9: binds an API-key credential to the requesting person's user", async () => {
    const now = new Date();
    await db.insert(schema.userTable).values({
      id: "user-pending-action-other-key-owner",
      name: "Other key owner",
      email: "other-key-owner@example.test",
    });
    await db.insert(schema.apikeyTable).values({
      id: "pending-action-other-owner-key",
      referenceId: "user-pending-action-other-key-owner",
      key: "test-key-secret",
      createdAt: now,
      updatedAt: now,
      enabled: true,
    });

    await expect(
      createPendingAction({
        ...requestInput(),
        credentialType: "api_key",
        credentialId: "pending-action-other-owner-key",
        origin: "api",
        actorId: "user-pending-action-test",
        actorType: "api_key",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.requested")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "pending_action.requested")),
    ).toHaveLength(0);
  });

  it.each([null, JSON.stringify({ work_item: ["read"] })])(
    "PA-9: refuses a personal key without the stored delete scope and writes no side effects (%s)",
    async (permissions) => {
      const now = new Date();
      await db.insert(schema.apikeyTable).values({
        id: "pending-action-under-scoped-key",
        referenceId: "user-pending-action-test",
        key: "test-key-secret",
        permissions,
        createdAt: now,
        updatedAt: now,
        enabled: true,
      });

      await expect(
        createPendingAction({
          ...requestInput(),
          credentialType: "api_key",
          credentialId: "pending-action-under-scoped-key",
          origin: "api",
          actorId: "user-pending-action-test",
          actorType: "api_key",
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.outboxTable)
          .where(eq(schema.outboxTable.kind, "pending_action.requested")),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.auditLogTable)
          .where(eq(schema.auditLogTable.action, "pending_action.requested")),
      ).toHaveLength(0);
    },
  );

  it("PA-9: accepts a live personal key only when its stored scope includes delete", async () => {
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      id: "pending-action-delete-scoped-key",
      referenceId: "user-pending-action-test",
      key: "test-key-secret",
      permissions: JSON.stringify({ work_item: ["delete"] }),
      createdAt: now,
      updatedAt: now,
      enabled: true,
    });

    const response = await createPendingAction({
      ...requestInput(),
      credentialType: "api_key",
      credentialId: "pending-action-delete-scoped-key",
      origin: "api",
      actorId: "user-pending-action-test",
      actorType: "api_key",
    });

    expect(response.pendingActionId).toBeTruthy();
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.requested")),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "pending_action.requested")),
    ).toHaveLength(1);
  });

  it("PA-9: canonical work-item policy refuses workspace-only reach", async () => {
    await db
      .delete(schema.membershipTable)
      .where(
        eq(
          schema.membershipTable.id,
          "membership-pending-action-test-project-delete",
        ),
      );

    await expect(createPendingAction(requestInput())).rejects.toMatchObject({
      status: 404,
    });
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.requested")),
    ).toHaveLength(0);
  });

  it("PA-9: current project override is evaluated ahead of workspace capability", async () => {
    await db
      .update(schema.roleTable)
      .set({ capabilities: [] })
      .where(
        eq(schema.roleTable.id, "role-pending-action-test-project-delete"),
      );

    await expect(createPendingAction(requestInput())).rejects.toMatchObject({
      status: 403,
    });
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.requested")),
    ).toHaveLength(0);
  });

  it("PA-9: natural session expiry does not revoke an existing pending action", async () => {
    const created = await createPendingAction(requestInput());
    const [pending] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, created.pendingActionId));
    if (!pending) throw new Error("Pending action fixture was not persisted");

    await db
      .update(schema.sessionTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.sessionTable.id, "session-pending-action-test"));
    await db
      .delete(schema.sessionTable)
      .where(eq(schema.sessionTable.id, "session-pending-action-test"));

    const input = {
      requestedByPersonId: pending.requestedByPersonId,
      credentialType: "session",
      credentialId: pending.credentialId,
      action: pending.action,
      targetType: pending.targetType,
      targetIds: pending.targetIds,
      routeKey: pending.routeKey,
      workspaceId: pending.workspaceId,
      projectId: pending.projectId,
      organisationId: pending.organisationId,
      confirmationRequired: pending.confirmationRequired,
      payload: pending.payload,
      payloadHash: pending.payloadHash,
    } satisfies ActionRequiredAccessInput;
    const creationCredentialCheck = await db.transaction((tx) =>
      evaluateActionRequiredAccess(tx, input),
    );
    const existingActionAccessCheck = await db.transaction((tx) =>
      evaluateActionRequiredAccess(tx, input, { existingPendingAction: true }),
    );

    expect(creationCredentialCheck).toMatchObject({
      allowed: false,
      failure: "credential",
    });
    expect(existingActionAccessCheck).toEqual({ allowed: true });
    expect(await stateOf(created.pendingActionId)).toEqual({
      state: "pending",
      invalidationReason: null,
    });
  });

  it("PA-9: actual Better Auth permissions narrowing terminally invalidates only newly denied work", async () => {
    const keyId = "pending-action-permissions-update-key";
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      referenceId: "user-pending-action-test",
      userId: "user-pending-action-test",
      key: "pending-action-permissions-update-secret",
      permissions: JSON.stringify({ work_item: ["delete"] }),
      createdAt: now,
      updatedAt: now,
      enabled: true,
    });
    const created = await createPendingAction({
      ...requestInput(),
      credentialType: "api_key",
      credentialId: keyId,
      origin: "api",
      actorId: "user-pending-action-test",
      actorType: "api_key",
    });

    const updatePermissions = (permissions: Record<string, string[]>) =>
      withExplicitCredentialMutation(
        { kind: "api_key", route: "/api-key/update" },
        () =>
          auth.api.updateApiKey({
            body: {
              keyId,
              userId: "user-pending-action-test",
              permissions,
            },
          }),
      );

    const narrowed = await updatePermissions({ work_item: ["read"] });
    expect(narrowed.state.deleteFailure).toBeNull();
    expect(await stateOf(created.pendingActionId)).toEqual({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    expect(await decisionRows(created.pendingActionId)).toMatchObject({
      events: [
        {
          payload: expect.objectContaining({
            payload: expect.objectContaining({
              invalidationReason: "capability_removed",
              outcome: "invalidated",
            }),
          }),
        },
      ],
      audits: [
        {
          after: {
            state: "invalidated",
            invalidationReason: "capability_removed",
          },
        },
      ],
    });

    const restored = await updatePermissions({ work_item: ["delete"] });
    expect(restored.state.deleteFailure).toBeNull();
    expect(await stateOf(created.pendingActionId)).toEqual({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    const decisions = await decisionRows(created.pendingActionId);
    expect(decisions.events).toHaveLength(1);
    expect(decisions.audits).toHaveLength(1);
  });

  it("PA-9: unmarked installed Better Auth permission updates invalidate lost action access", async () => {
    const keyId = "pending-action-unmarked-permissions-update-key";
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      referenceId: "user-pending-action-test",
      userId: "user-pending-action-test",
      key: "pending-action-unmarked-permissions-update-secret",
      permissions: JSON.stringify({ work_item: ["delete"] }),
      createdAt: now,
      updatedAt: now,
      enabled: true,
    });
    const created = await createPendingAction({
      ...requestInput(),
      credentialType: "api_key",
      credentialId: keyId,
      origin: "api",
      actorId: "user-pending-action-test",
      actorType: "api_key",
    });

    await auth.api.updateApiKey({
      body: {
        keyId,
        userId: "user-pending-action-test",
        permissions: {
          work_item: ["delete"],
          workspace: ["read"],
        },
      },
    });
    expect(await stateOf(created.pendingActionId)).toEqual({
      state: "pending",
      invalidationReason: null,
    });

    await auth.api.updateApiKey({
      body: {
        keyId,
        userId: "user-pending-action-test",
        permissions: { work_item: ["read"] },
      },
    });

    expect(await stateOf(created.pendingActionId)).toEqual({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    expect(await decisionRows(created.pendingActionId)).toMatchObject({
      events: [
        {
          payload: expect.objectContaining({
            payload: expect.objectContaining({
              invalidationReason: "capability_removed",
              outcome: "invalidated",
            }),
          }),
        },
      ],
      audits: [
        {
          after: {
            state: "invalidated",
            invalidationReason: "capability_removed",
          },
        },
      ],
    });

    await auth.api.updateApiKey({
      body: {
        keyId,
        userId: "user-pending-action-test",
        permissions: { work_item: ["delete"] },
      },
    });
    expect(await stateOf(created.pendingActionId)).toEqual({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    expect(await decisionRows(created.pendingActionId)).toMatchObject({
      events: [{}],
      audits: [{}],
    });

    const disableKeyId = "pending-action-unmarked-disable-success-key";
    const disableNow = new Date();
    await db.insert(schema.apikeyTable).values({
      id: disableKeyId,
      referenceId: "user-pending-action-test",
      userId: "user-pending-action-test",
      key: "pending-action-unmarked-disable-success-secret",
      permissions: JSON.stringify({ work_item: ["delete"] }),
      createdAt: disableNow,
      updatedAt: disableNow,
      enabled: true,
    });
    const disableAction = await createPendingAction({
      ...requestInput(),
      credentialType: "api_key",
      credentialId: disableKeyId,
      origin: "api",
      actorId: "user-pending-action-test",
      actorType: "api_key",
    });
    await auth.api.updateApiKey({
      body: {
        keyId: disableKeyId,
        userId: "user-pending-action-test",
        enabled: false,
      },
    });
    expect(await stateOf(disableAction.pendingActionId)).toEqual({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
  });

  it("PA-9: unmarked installed Better Auth permission and disable writes roll back with their invalidation event", async () => {
    const keyId = "pending-action-unmarked-disable-rollback-key";
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      referenceId: "user-pending-action-test",
      userId: "user-pending-action-test",
      key: "pending-action-unmarked-disable-rollback-secret",
      permissions: JSON.stringify({ work_item: ["delete"] }),
      createdAt: now,
      updatedAt: now,
      enabled: true,
    });
    const created = await createPendingAction({
      ...requestInput(),
      credentialType: "api_key",
      credentialId: keyId,
      origin: "api",
      actorId: "user-pending-action-test",
      actorType: "api_key",
    });
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_unmarked_key_disable_outbox()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.kind = 'pending_action.decided' THEN
            RAISE EXCEPTION 'test unmarked key-disable event failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_unmarked_key_disable_outbox
        BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION fail_unmarked_key_disable_outbox()
      `),
    );

    try {
      await expect(
        auth.api.updateApiKey({
          body: {
            keyId,
            userId: "user-pending-action-test",
            permissions: { work_item: ["read"] },
          },
        }),
      ).rejects.toBeTruthy();
      expect(await stateOf(created.pendingActionId)).toEqual({
        state: "pending",
        invalidationReason: null,
      });
      const [permissionsBeforeRetry] = await db
        .select({ permissions: schema.apikeyTable.permissions })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, keyId));
      expect(permissionsBeforeRetry?.permissions).toBe(
        JSON.stringify({ work_item: ["delete"] }),
      );

      await expect(
        auth.api.updateApiKey({
          body: {
            keyId,
            userId: "user-pending-action-test",
            enabled: false,
          },
        }),
      ).rejects.toBeTruthy();
      expect(await stateOf(created.pendingActionId)).toEqual({
        state: "pending",
        invalidationReason: null,
      });
      const [key] = await db
        .select({ enabled: schema.apikeyTable.enabled })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, keyId));
      expect(key?.enabled).toBe(true);
      expect(await decisionRows(created.pendingActionId)).toEqual({
        events: [],
        audits: [],
      });
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_unmarked_key_disable_outbox ON outbox",
        ),
      );
      await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS fail_unmarked_key_disable_outbox()"),
      );
    }
  });

  it("PA-9: a decided-event failure rolls back both the key update and invalidation", async () => {
    const keyId = "pending-action-permissions-rollback-key";
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      referenceId: "user-pending-action-test",
      userId: "user-pending-action-test",
      key: "pending-action-permissions-rollback-secret",
      permissions: JSON.stringify({ work_item: ["delete"] }),
      createdAt: now,
      updatedAt: now,
      enabled: true,
    });
    const created = await createPendingAction({
      ...requestInput(),
      credentialType: "api_key",
      credentialId: keyId,
      origin: "api",
      actorId: "user-pending-action-test",
      actorType: "api_key",
    });
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_pending_action_permissions_outbox()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.kind = 'pending_action.decided' THEN
            RAISE EXCEPTION 'test decided event failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_pending_action_permissions_outbox
        BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION fail_pending_action_permissions_outbox()
      `),
    );

    try {
      const result = await withExplicitCredentialMutation(
        { kind: "api_key", route: "/api-key/update" },
        async () => {
          try {
            return await auth.api.updateApiKey({
              body: {
                keyId,
                userId: "user-pending-action-test",
                permissions: { work_item: ["read"] },
              },
            });
          } catch (error) {
            return error;
          }
        },
      );

      expect(result.state.deleteFailure).toBeTruthy();
      expect(await stateOf(created.pendingActionId)).toEqual({
        state: "pending",
        invalidationReason: null,
      });
      const [key] = await db
        .select({ permissions: schema.apikeyTable.permissions })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, keyId));
      expect(key?.permissions).toBe(JSON.stringify({ work_item: ["delete"] }));
      expect(await decisionRows(created.pendingActionId)).toEqual({
        events: [],
        audits: [],
      });
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_pending_action_permissions_outbox ON outbox",
        ),
      );
      await db.execute(
        sql.raw(
          "DROP FUNCTION IF EXISTS fail_pending_action_permissions_outbox()",
        ),
      );
    }
  });

  it("AU-14: permission-loss invalidation commits its event and reports a failed audit", async () => {
    const keyId = "pending-action-permissions-audit-failure-key";
    const now = new Date();
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, "user-pending-action-test"));
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      referenceId: "user-pending-action-test",
      userId: "user-pending-action-test",
      key: "pending-action-permissions-audit-failure-secret",
      permissions: JSON.stringify({ work_item: ["delete"] }),
      createdAt: now,
      updatedAt: now,
      enabled: true,
    });
    const created = await createPendingAction({
      ...requestInput(),
      credentialType: "api_key",
      credentialId: keyId,
      origin: "api",
      actorId: "user-pending-action-test",
      actorType: "api_key",
    });
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_pending_action_decision_audit()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'pending_action.decided' THEN
            RAISE EXCEPTION 'test pending-action audit failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_pending_action_decision_audit
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION fail_pending_action_decision_audit()
      `),
    );

    try {
      await auth.api.updateApiKey({
        body: {
          keyId,
          userId: "user-pending-action-test",
          permissions: { work_item: ["read"] },
        },
      });
      expect(await stateOf(created.pendingActionId)).toEqual({
        state: "invalidated",
        invalidationReason: "capability_removed",
      });
      const decisions = await decisionRows(created.pendingActionId);
      expect(decisions.events).toHaveLength(1);
      expect(decisions.audits).toHaveLength(0);
      const notifications = await db
        .select({ eventData: schema.notificationTable.eventData })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "audit_write_failed"));
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.eventData).toMatchObject({
        operation: "pending_action_decision",
      });
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_pending_action_decision_audit ON audit_log",
        ),
      );
      await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS fail_pending_action_decision_audit()"),
      );
    }
  });

  it("PA-9: key narrowing and action creation serialize in both lock orders", async () => {
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await observer.connect();
    const createKey = async (id: string) => {
      const now = new Date();
      await db.insert(schema.apikeyTable).values({
        id,
        referenceId: "user-pending-action-test",
        userId: "user-pending-action-test",
        key: `${id}-secret`,
        permissions: JSON.stringify({ work_item: ["delete"] }),
        createdAt: now,
        updatedAt: now,
        enabled: true,
      });
    };
    const updatePermissions = (keyId: string) =>
      withExplicitCredentialMutation(
        { kind: "api_key", route: "/api-key/update" },
        () =>
          auth.api.updateApiKey({
            body: {
              keyId,
              userId: "user-pending-action-test",
              permissions: { work_item: ["read"] },
            },
          }),
      );
    const gate = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((ready) => {
        resolve = ready;
      });
      return { promise, resolve };
    };

    try {
      const firstKey = "pending-action-race-create-first-key";
      await createKey(firstKey);
      const releaseTarget = gate();
      const targetLocked = gate();
      const targetBlocker = db.transaction(async (tx) => {
        await tx
          .select({ id: schema.workItemTable.id })
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.key, "SUP-1"))
          .for("update");
        targetLocked.resolve();
        await releaseTarget.promise;
      });
      await targetLocked.promise;
      const firstCreate = createPendingAction({
        ...requestInput(),
        credentialType: "api_key",
        credentialId: firstKey,
        origin: "api",
        actorId: "user-pending-action-test",
        actorType: "api_key",
      });
      await waitForLifecycleLockCount(observer, "granted");
      const firstNarrow = updatePermissions(firstKey);
      await waitForLifecycleLockCount(observer, "waiting");
      releaseTarget.resolve();
      await targetBlocker;
      const firstAction = await firstCreate;
      await firstNarrow;
      expect(await stateOf(firstAction.pendingActionId)).toEqual({
        state: "invalidated",
        invalidationReason: "capability_removed",
      });

      const secondKey = "pending-action-race-narrow-first-key";
      await createKey(secondKey);
      const releaseCredential = gate();
      const credentialLocked = gate();
      const credentialBlocker = db.transaction(async (tx) => {
        await tx
          .select({ id: schema.apikeyTable.id })
          .from(schema.apikeyTable)
          .where(eq(schema.apikeyTable.id, secondKey))
          .for("update");
        credentialLocked.resolve();
        await releaseCredential.promise;
      });
      await credentialLocked.promise;
      const secondNarrow = updatePermissions(secondKey);
      await waitForLifecycleLockCount(observer, "granted");
      const secondCreate = createPendingAction({
        ...requestInput(),
        credentialType: "api_key",
        credentialId: secondKey,
        origin: "api",
        actorId: "user-pending-action-test",
        actorType: "api_key",
      });
      await waitForLifecycleLockCount(observer, "waiting");
      releaseCredential.resolve();
      await credentialBlocker;
      await secondNarrow;
      await expect(secondCreate).rejects.toMatchObject({ status: 403 });
      expect(
        await db
          .select({ state: schema.pendingActionTable.state })
          .from(schema.pendingActionTable),
      ).toEqual([{ state: "invalidated" }]);
    } finally {
      await observer.end();
    }
  });

  it("PA-9: unrelated key permission edits and retained required scope leave work pending", async () => {
    const keyId = "pending-action-unrelated-permissions-key";
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      referenceId: "user-pending-action-test",
      userId: "user-pending-action-test",
      key: "pending-action-unrelated-permissions-secret",
      permissions: JSON.stringify({ work_item: ["delete"] }),
      createdAt: now,
      updatedAt: now,
      enabled: true,
    });
    const created = await createPendingAction({
      ...requestInput(),
      credentialType: "api_key",
      credentialId: keyId,
      origin: "api",
      actorId: "user-pending-action-test",
      actorType: "api_key",
    });

    const result = await withExplicitCredentialMutation(
      { kind: "api_key", route: "/api-key/update" },
      () =>
        auth.api.updateApiKey({
          body: {
            keyId,
            userId: "user-pending-action-test",
            permissions: {
              work_item: ["delete", "read"],
              user: ["read"],
            },
          },
        }),
    );

    expect(result.state.deleteFailure).toBeNull();
    expect(await stateOf(created.pendingActionId)).toEqual({
      state: "pending",
      invalidationReason: null,
    });
    expect(await decisionRows(created.pendingActionId)).toEqual({
      events: [],
      audits: [],
    });
  });

  it.each([
    ["disabled", false, null],
    ["expired", true, new Date(Date.now() - 60_000)],
  ])(
    "PA-9: refuses a %s API key before pending-action side effects",
    async (state, enabled, expiresAt) => {
      const now = new Date();
      const credentialId = `pending-action-inactive-${state}`;
      await db.insert(schema.apikeyTable).values({
        id: credentialId,
        referenceId: "user-pending-action-test",
        key: "test-key-secret",
        permissions: JSON.stringify({ work_item: ["delete"] }),
        enabled,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      await expect(
        createPendingAction({
          ...requestInput(),
          credentialType: "api_key",
          credentialId,
          origin: "api",
          actorId: "user-pending-action-test",
          actorType: "api_key",
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.outboxTable)
          .where(eq(schema.outboxTable.kind, "pending_action.requested")),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.auditLogTable)
          .where(eq(schema.auditLogTable.action, "pending_action.requested")),
      ).toHaveLength(0);
    },
  );

  it("AU-14: commits the request and outbox when its audit insert fails", async () => {
    const input = requestInput();
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, "user-pending-action-test"));
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_pending_action_audit_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'pending_action.requested' THEN
            RAISE EXCEPTION 'test audit failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_pending_action_audit_insert
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION fail_pending_action_audit_insert()
      `),
    );

    try {
      const response = await createPendingAction(input);
      const pendingRows = await db
        .select({ id: schema.pendingActionTable.id })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, response.pendingActionId));
      const outboxRows = await db
        .select({ eventId: schema.outboxTable.eventId })
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.requested"));
      const auditRows = await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "pending_action.requested"));

      expect(pendingRows).toEqual([{ id: response.pendingActionId }]);
      expect(outboxRows).toHaveLength(1);
      expect(auditRows).toHaveLength(0);
      const alerts = await db
        .select({ eventData: schema.notificationTable.eventData })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "audit_write_failed"));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.eventData).toMatchObject({ operation: "mutation" });
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_pending_action_audit_insert ON audit_log",
        ),
      );
      await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS fail_pending_action_audit_insert()"),
      );
    }
  });

  it("rolls the request back if its transactional outbox insert fails", async () => {
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_pending_action_outbox_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.kind = 'pending_action.requested' THEN
            RAISE EXCEPTION 'test outbox failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_pending_action_outbox_insert
        BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION fail_pending_action_outbox_insert()
      `),
    );

    try {
      await expect(createPendingAction(requestInput())).rejects.toThrow(
        /insert into "outbox"/,
      );
      expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
      expect(await db.select().from(schema.outboxTable)).toHaveLength(0);
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_pending_action_outbox_insert ON outbox",
        ),
      );
      await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS fail_pending_action_outbox_insert()"),
      );
    }
  });

  it("PA-4: rejects a second pending request for the same requester, action and targets", async () => {
    const input = requestInput();
    const first = await createPendingAction(input);

    let error: unknown;
    try {
      await createPendingAction(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(409);
    expect((error as HTTPException).message).toContain(first.pendingActionId);
    const rows = await db
      .select({ id: schema.pendingActionTable.id })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.state, "pending"));
    expect(rows).toEqual([{ id: first.pendingActionId }]);
  });

  it("PA-4: allows exactly one of two concurrent identical requests", async () => {
    const input = requestInput();
    const results = await Promise.allSettled([
      createPendingAction(input),
      createPendingAction(input),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const rows = await db
      .select({ id: schema.pendingActionTable.id })
      .from(schema.pendingActionTable)
      .where(
        and(
          eq(
            schema.pendingActionTable.requestedByPersonId,
            input.requesterPersonId,
          ),
          eq(schema.pendingActionTable.state, "pending"),
        ),
      );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toBeDefined();
    expect(rejected?.reason).toBeInstanceOf(HTTPException);
    if (!rejected) throw new Error("Expected one concurrent request to fail");
    expect((rejected.reason as HTTPException).status).toBe(409);
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["denied", "denied"],
    ["cancelled", "cancelled"],
  ] as const)(
    "PA-9: records requester %s as a terminal decision",
    async (outcome, state) => {
      const input = requestInput();
      const created = await createPendingAction(input);
      const targetBefore = requireRow(
        await db
          .select({
            id: schema.workItemTable.id,
            deletedAt: schema.workItemTable.deletedAt,
            archivedAt: schema.workItemTable.archivedAt,
          })
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.key, "SUP-1"))
          .limit(1),
        "pending-action target before decision",
      );
      const decided = await decideOwnPendingAction({
        id: created.pendingActionId,
        requesterPersonId: input.requesterPersonId,
        outcome,
        sessionId: input.credentialId,
      });

      expect(decided.state).toBe(state);
      const targetAfter = requireRow(
        await db
          .select({
            id: schema.workItemTable.id,
            deletedAt: schema.workItemTable.deletedAt,
            archivedAt: schema.workItemTable.archivedAt,
          })
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.key, "SUP-1"))
          .limit(1),
        "pending-action target after decision",
      );
      expect(targetAfter).toEqual(targetBefore);
      const decisionEvents = await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.decided"));
      expect(decisionEvents).toHaveLength(1);
      expect(decisionEvents[0]).toMatchObject({
        state: "pending",
        workspaceId,
        organisationId,
        payload: {
          kind: "pending_action.decided",
          actor: {
            type: "person",
            id: input.requesterPersonId,
            name: "Pending Action Requester",
          },
          scope: { workspaceId, projectId, organisationId },
          payload: {
            key: created.pendingActionId,
            url: `/agent/settings/profile/pending-actions/${created.pendingActionId}`,
            pendingActionId: created.pendingActionId,
            outcome: state,
          },
        },
      });
      await expect(
        decideOwnPendingAction({
          id: created.pendingActionId,
          requesterPersonId: input.requesterPersonId,
          outcome,
        }),
      ).rejects.toMatchObject({ status: 409 });
    },
  );

  it.each(["denied", "cancelled"] as const)(
    "AU-14: commits %s and its outbox event when the decision audit insert fails",
    async (outcome) => {
      await db
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, "user-pending-action-test"));
      const input = requestInput();
      const created = await createPendingAction(input);
      const targetBefore = requireRow(
        await db
          .select({
            id: schema.workItemTable.id,
            deletedAt: schema.workItemTable.deletedAt,
            archivedAt: schema.workItemTable.archivedAt,
          })
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.key, "SUP-1"))
          .limit(1),
        "pending-action target before injected audit failure",
      );
      await db.execute(
        sql.raw(`
        CREATE OR REPLACE FUNCTION fail_pending_action_decision_audit_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'pending_action.decided' THEN
            RAISE EXCEPTION 'test decision audit failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
      );
      await db.execute(
        sql.raw(`
        CREATE TRIGGER fail_pending_action_decision_audit_insert
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION fail_pending_action_decision_audit_insert()
      `),
      );

      try {
        const decided = await decideOwnPendingAction({
          id: created.pendingActionId,
          requesterPersonId: input.requesterPersonId,
          outcome,
        });
        const [row] = await db
          .select({ state: schema.pendingActionTable.state })
          .from(schema.pendingActionTable)
          .where(eq(schema.pendingActionTable.id, created.pendingActionId));
        const events = await db
          .select({
            eventId: schema.outboxTable.eventId,
            payload: schema.outboxTable.payload,
          })
          .from(schema.outboxTable)
          .where(eq(schema.outboxTable.kind, "pending_action.decided"));
        const auditRows = await db
          .select({ id: schema.auditLogTable.id })
          .from(schema.auditLogTable)
          .where(eq(schema.auditLogTable.action, "pending_action.decided"));
        const [targetAfter] = await db
          .select({
            id: schema.workItemTable.id,
            deletedAt: schema.workItemTable.deletedAt,
            archivedAt: schema.workItemTable.archivedAt,
          })
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.key, "SUP-1"));

        expect(decided.state).toBe(outcome);
        expect(row?.state).toBe(outcome);
        expect(events).toHaveLength(1);
        expect(events[0]?.payload).toMatchObject({ payload: { outcome } });
        expect(auditRows).toHaveLength(0);
        expect(targetAfter).toEqual(targetBefore);
        const alerts = await db
          .select({ eventData: schema.notificationTable.eventData })
          .from(schema.notificationTable)
          .where(eq(schema.notificationTable.type, "audit_write_failed"));
        expect(alerts).toHaveLength(1);
        expect(alerts[0]?.eventData).toMatchObject({
          operation: "pending_action_decision",
        });
      } finally {
        await db.execute(
          sql.raw(
            "DROP TRIGGER IF EXISTS fail_pending_action_decision_audit_insert ON audit_log",
          ),
        );
        await db.execute(
          sql.raw(
            "DROP FUNCTION IF EXISTS fail_pending_action_decision_audit_insert()",
          ),
        );
      }
    },
  );

  it("rolls a decision back if its transactional outbox insert fails", async () => {
    const input = requestInput();
    const created = await createPendingAction(input);
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION fail_pending_action_decision_outbox_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.kind = 'pending_action.decided' THEN
            RAISE EXCEPTION 'test decision outbox failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER fail_pending_action_decision_outbox_insert
        BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION fail_pending_action_decision_outbox_insert()
      `),
    );

    try {
      await expect(
        decideOwnPendingAction({
          id: created.pendingActionId,
          requesterPersonId: input.requesterPersonId,
          outcome: "denied",
        }),
      ).rejects.toThrow(/insert into "outbox"/);
      const [row] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, created.pendingActionId));
      const events = await db
        .select({ eventId: schema.outboxTable.eventId })
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.decided"));

      expect(row?.state).toBe("pending");
      expect(events).toHaveLength(0);
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_pending_action_decision_outbox_insert ON outbox",
        ),
      );
      await db.execute(
        sql.raw(
          "DROP FUNCTION IF EXISTS fail_pending_action_decision_outbox_insert()",
        ),
      );
    }
  });
});
