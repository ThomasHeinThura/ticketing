import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  createPendingAction,
  decideOwnPendingAction,
} from "../../apps/api/src/pending-action/service";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, requireRow } from "./helpers/fixtures";

const organisationId = "organisation-pending-action-test";
const workspaceId = "workspace-pending-action-test";
const requesterPersonId = "person-pending-action-test";
let projectId = "";

function requestInput(requesterPersonId = "person-pending-action-test") {
  return {
    requesterPersonId,
    credentialType: "session" as const,
    credentialId: `session-${randomUUID()}`,
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

describe("pending-action service persistence", () => {
  beforeEach(async () => {
    await resetTestDatabase();
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
      role: "owner",
      joinedAt: new Date(),
    });
    const project = await createProjectFixture({
      workspaceId,
      slug: "pending-action-test-project",
    });
    projectId = project.project.id;
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

  it("AU-14: commits the request and outbox when its audit insert fails", async () => {
    const input = requestInput();
    const auditFailure = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
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
      expect(auditFailure).toHaveBeenCalledWith(
        expect.stringContaining("AU-14:"),
        expect.anything(),
      );
    } finally {
      auditFailure.mockRestore();
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
      const decided = await decideOwnPendingAction({
        id: created.pendingActionId,
        requesterPersonId: input.requesterPersonId,
        outcome,
        sessionId: input.credentialId,
      });

      expect(decided.state).toBe(state);
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

  it("AU-14: commits a decision and outbox event when its audit insert fails", async () => {
    const input = requestInput();
    const created = await createPendingAction(input);
    const auditFailure = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
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
        outcome: "denied",
      });
      expect(decided.state).toBe("denied");
      const [row] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, created.pendingActionId));
      const events = await db
        .select({ eventId: schema.outboxTable.eventId })
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.decided"));
      const auditRows = await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "pending_action.decided"));

      expect(row?.state).toBe("denied");
      expect(events).toHaveLength(1);
      expect(auditRows).toHaveLength(0);
      expect(auditFailure).toHaveBeenCalledWith(
        expect.stringContaining("AU-14:"),
        expect.anything(),
      );
    } finally {
      auditFailure.mockRestore();
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
  });

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
