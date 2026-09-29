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
    summary: { key: "SUP-1", title: "Test request" },
    workspaceId: "workspace-pending-action-test",
    projectId: `project-${randomUUID()}`,
    organisationId: null,
    confirmationRequired: "click" as const,
    actorId: requesterPersonId,
    actorType: "person" as const,
  };
}

describe("pending-action service persistence", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db.insert(schema.organisationTable).values({
      id: "organisation-pending-action-test",
      key: "organisation-pending-action-test",
      name: "Pending Action Test Organisation",
    });
    await db.insert(schema.userTable).values({
      id: "user-pending-action-test",
      name: "Pending Action Requester",
      email: "pending-action-requester@example.test",
    });
    await db.insert(schema.personTable).values({
      id: "person-pending-action-test",
      userId: "user-pending-action-test",
      organisationId: "organisation-pending-action-test",
      side: "staff",
    });
    await db.insert(schema.workspaceTable).values({
      id: "workspace-pending-action-test",
      organisationId: "organisation-pending-action-test",
      name: "Pending Action Test Workspace",
      slug: "pending-action-test",
      createdAt: new Date(),
    });
  });

  it("PA-2: persists the bound request and audit row before returning its approval details", async () => {
    const input = requestInput();
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
      summary: input.summary,
      confirmation: "click",
      approveUrl: `/agent/settings/profile/pending-actions/${response.pendingActionId}`,
    });
    expect(row).toMatchObject({
      state: "pending",
      requestedByPersonId: input.requesterPersonId,
      routeKey: input.routeKey,
      targetIds: ["SUP-1"],
      workspaceId: input.workspaceId,
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
      organisationId: "organisation-pending-action-test",
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
          organisationId: "organisation-pending-action-test",
        },
        payload: {
          key: response.pendingActionId,
          url: response.approveUrl,
          targetCount: 1,
        },
      },
    });
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
      await expect(
        decideOwnPendingAction({
          id: created.pendingActionId,
          requesterPersonId: input.requesterPersonId,
          outcome,
        }),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
});
