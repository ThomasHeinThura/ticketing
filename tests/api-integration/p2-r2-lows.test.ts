/**
 * P2 round-2 review lows: the request-type deletion approval notifies administrators when its
 * audit append fails (P2R2-01), a customer reply reaches the triager who last handled the
 * submission (P2R2-02), intake audit-failure notices only follow work that committed (P2R2-03),
 * a customer approver only receives the approval kinds the portal inbox shows (P2R2-04), and
 * bulk transitions record the request facts on their audit rows (P2R1-16). Real HTTP, real
 * database.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { notificationPreferenceTable } from "../../apps/api/src/database/schema";
import * as auditFailureNotifier from "../../apps/api/src/instance/observability/audit-failure-notifier";
import { autoDeclineStaleClarifications } from "../../apps/api/src/intake/auto-decline";
import { immediateNotificationRuntime } from "../../apps/api/src/notification/immediate-runtime";
import { processNextNotificationDelivery } from "../../apps/api/src/notification/outbox-drain";
import { resolveApprovalEventRecipients } from "../../apps/api/src/notification/recipient-resolvers";
import { updateEmailProvider } from "../../apps/api/src/notification-provider/service";
import {
  addCustomer,
  buildTenant,
  json,
  personOf,
  portalRequest,
  request as requestApproval,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  type IntakeSeed,
  seedIntake,
  staffRequest,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";

async function dropTestTriggers() {
  await db.execute(
    sql`DROP TRIGGER IF EXISTS p2r2_fail_audit ON audit_log; DROP TRIGGER IF EXISTS p2r2_fail_outbox ON outbox; DROP FUNCTION IF EXISTS p2r2_fail_audit(); DROP FUNCTION IF EXISTS p2r2_fail_outbox();`,
  );
}

/** Every `audit_log` insert of `action` fails (the savepoint absorbs it). */
async function failAudit(action: string) {
  await db.execute(
    sql.raw(`
      CREATE FUNCTION p2r2_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = '${action}' THEN
          RAISE EXCEPTION 'simulated audit failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER p2r2_fail_audit BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION p2r2_fail_audit();
    `),
  );
}

/** Every outbox insert of `kind` fails, so the surrounding transaction rolls back. */
async function failOutbox(kind: string) {
  await db.execute(
    sql.raw(`
      CREATE FUNCTION p2r2_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.kind = '${kind}' THEN
          RAISE EXCEPTION 'simulated outbox failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER p2r2_fail_outbox BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION p2r2_fail_outbox();
    `),
  );
}

function spyOnAuditFailureNotice() {
  return vi
    .spyOn(auditFailureNotifier, "notifyCurrentInstanceAdminsOfAuditFailure")
    .mockResolvedValue(undefined);
}

async function enableEmail(s: IntakeSeed) {
  const actor = await personOf(s.t.requester.user.id);
  await updateEmailProvider(
    {
      version: 0,
      enabled: true,
      config: {
        host: "smtp.synthetic.example",
        port: 587,
        secure: false,
        requireTLS: false,
        username: null,
        fromAddress: "sender@example.test",
        replyTo: null,
      },
    },
    { userId: s.t.requester.user.id, personId: actor.id },
  );
}

async function preferEmail(personId: string, eventKind: string) {
  await db.insert(notificationPreferenceTable).values({
    personId,
    scope: "global",
    scopeId: null,
    channel: "notify.email",
    eventKind,
    enabled: true,
    digest: "off",
  });
}

async function submissionInbox(personId: string) {
  return db
    .select({ kind: schema.notificationTable.kind })
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.personId, personId),
        eq(schema.notificationTable.resourceType, "submission"),
      ),
    );
}

beforeEach(async () => {
  await dropTestTriggers();
  await resetTestDatabase();
});
afterEach(async () => {
  await dropTestTriggers();
  vi.restoreAllMocks();
});

describe("P2R2-01: request-type deletion approval and AU-14", () => {
  it("notifies administrators after commit when the request_type.deleted audit row is lost", async () => {
    const s = await seedIntake("p2r2-rt-delete-audit");
    await db.insert(schema.sessionTable).values({
      id: `session-${s.t.requester.user.id}`,
      token: `token-${s.t.requester.user.id}`,
      userId: s.t.requester.user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await db
      .update(schema.requestTypeTable)
      .set({ published: false })
      .where(eq(schema.requestTypeTable.id, s.requestType.id));
    const requested = await staffRequest(
      s.t,
      s.t.requester,
      `/api/request-types/${s.requestType.id}`,
      { method: "DELETE" },
    );
    expect(requested.status, await requested.clone().text()).toBe(202);
    const { pendingActionId } = (await requested.json()) as {
      pendingActionId: string;
    };
    await failAudit("request_type.deleted");
    const notice = spyOnAuditFailureNotice();
    const approved = await staffRequest(
      s.t,
      s.t.requester,
      `/api/me/pending-actions/${pendingActionId}/approve`,
      { method: "POST", body: {} },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    // The deletion committed without its audit row, and administrators were told once.
    expect(
      await db
        .select()
        .from(schema.requestTypeTable)
        .where(eq(schema.requestTypeTable.id, s.requestType.id)),
    ).toHaveLength(0);
    const audits = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, s.requestType.id));
    expect(audits.map((audit) => audit.action)).not.toContain(
      "request_type.deleted",
    );
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("mutation");
  });

  it("records the approval's trace id on the request_type.deleted row and sends no notice", async () => {
    const s = await seedIntake("p2r2-rt-delete-ok");
    await db.insert(schema.sessionTable).values({
      id: `session-${s.t.requester.user.id}`,
      token: `token-${s.t.requester.user.id}`,
      userId: s.t.requester.user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await db
      .update(schema.requestTypeTable)
      .set({ published: false })
      .where(eq(schema.requestTypeTable.id, s.requestType.id));
    const requested = await staffRequest(
      s.t,
      s.t.requester,
      `/api/request-types/${s.requestType.id}`,
      { method: "DELETE" },
    );
    const { pendingActionId } = (await requested.json()) as {
      pendingActionId: string;
    };
    const notice = spyOnAuditFailureNotice();
    const approved = await staffRequest(
      s.t,
      s.t.requester,
      `/api/me/pending-actions/${pendingActionId}/approve`,
      { method: "POST", body: {} },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    const [deleted] = await db
      .select({ traceId: schema.auditLogTable.traceId })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, s.requestType.id),
          eq(schema.auditLogTable.action, "request_type.deleted"),
        ),
      );
    expect(deleted?.traceId).toBeTruthy();
    expect(notice).not.toHaveBeenCalled();
  });
});

describe("P2R2-03: intake audit-failure notices follow only committed work", () => {
  it("notifies once for a committed decline that lost its audit row", async () => {
    const s = await seedIntake("p2r2-notify-commit");
    const ref = await submitAs(s, s.customer);
    await failAudit("submission.declined");
    const notice = spyOnAuditFailureNotice();
    const decline = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/decline`,
      { method: "POST", body: { reason: "Not supported" } },
    );
    expect(decline.status, await decline.clone().text()).toBe(200);
    expect((await submissionRow(ref)).state).toBe("declined");
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it("sends no notice when the request failed and rolled the decline back", async () => {
    const s = await seedIntake("p2r2-notify-rollback");
    const ref = await submitAs(s, s.customer);
    await failAudit("submission.declined");
    await failOutbox("submission.declined");
    const notice = spyOnAuditFailureNotice();
    const decline = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/decline`,
      { method: "POST", body: { reason: "Not supported" } },
    );
    expect(decline.status).toBeGreaterThanOrEqual(500);
    expect((await submissionRow(ref)).state).toBe("new");
    expect(notice).not.toHaveBeenCalled();
  });

  it("sends no notice for an auto-decline row that rolled back", async () => {
    const s = await seedIntake("p2r2-notify-job");
    const ref = await submitAs(s, s.customer, "Stale");
    const message = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/messages`,
      { method: "POST", body: { body: "Which version?" } },
    );
    expect(message.status, await message.clone().text()).toBe(200);
    await db
      .update(schema.submissionTable)
      .set({ clarifyingSince: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(schema.submissionTable.id, (await submissionRow(ref)).id));
    await failAudit("submission.declined");
    await failOutbox("submission.declined");
    const notice = spyOnAuditFailureNotice();
    expect(await autoDeclineStaleClarifications()).toMatchObject({
      declined: 0,
      degraded: true,
    });
    expect((await submissionRow(ref)).state).toBe("clarifying");
    expect(notice).not.toHaveBeenCalled();

    // The same row committing without its audit row is reported once.
    await db.execute(
      sql`DROP TRIGGER IF EXISTS p2r2_fail_outbox ON outbox; DROP FUNCTION IF EXISTS p2r2_fail_outbox();`,
    );
    expect(await autoDeclineStaleClarifications()).toMatchObject({
      declined: 1,
      degraded: false,
    });
    expect(notice).toHaveBeenCalledTimes(1);
  });
});

describe("P2R2-02: a customer reply notifies whoever last handled the submission", () => {
  it("routes the reply to the triager who asked, not the first claimer", async () => {
    const s = await seedIntake("p2r2-last-handler");
    await enableEmail(s);
    const claimer = await personOf(s.t.requester.user.id);
    const asker = await personOf(s.t.approver.user.id);
    await preferEmail(asker.id, "submission.replied");
    await preferEmail(claimer.id, "submission.replied");
    const ref = await submitAs(s, s.customer);
    const claim = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/claim`,
      { method: "POST" },
    );
    expect(claim.status, await claim.clone().text()).toBe(200);
    const clarify = await staffRequest(
      s.t,
      s.t.approver,
      `/api/submissions/${ref}/messages`,
      { method: "POST", body: { body: "Which browser?" } },
    );
    expect(clarify.status, await clarify.clone().text()).toBe(200);
    // The claim stays with the first triager (P2R1-08).
    expect((await submissionRow(ref)).claimedBy).toBe(claimer.id);
    // Only the reply's delivery is under test.
    await db.execute(sql`DELETE FROM notification_delivery`);

    const reply = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}/messages`,
      { method: "POST", body: { body: "Firefox" } },
    );
    expect(reply.status, await reply.clone().text()).toBe(200);

    expect((await submissionInbox(asker.id)).map((row) => row.kind)).toContain(
      "submission.replied",
    );
    expect(await submissionInbox(claimer.id)).toEqual([]);
    // The asker reads it through the staff inbox route.
    const inbox = await staffRequest(s.t, s.t.approver, "/api/notification");
    expect(inbox.status, await inbox.clone().text()).toBe(200);
    const listed = (await inbox.json()) as Array<{
      resourceType?: string | null;
      kind?: string | null;
    }>;
    expect(
      listed.some(
        (row) =>
          row.resourceType === "submission" &&
          row.kind === "submission.replied",
      ),
    ).toBe(true);

    const send = vi.fn(async (_to, _subject, _data, options) => {
      expect(await options.authorize?.()).toBe(true);
      return { success: true as const };
    });
    await expect(
      processNextNotificationDelivery(immediateNotificationRuntime(send)),
    ).resolves.toEqual({ kind: "delivered" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe(s.t.approver.user.email);
  });

  it("falls back to the claimer when no triager has written yet", async () => {
    const s = await seedIntake("p2r2-claimer-fallback");
    const claimer = await personOf(s.t.requester.user.id);
    const ref = await submitAs(s, s.customer);
    const claim = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/claim`,
      { method: "POST" },
    );
    expect(claim.status).toBe(200);
    // A clarifying state without a triager message (legacy rows): the claim is the handler.
    await db
      .update(schema.submissionTable)
      .set({ state: "clarifying", clarifyingSince: new Date() })
      .where(eq(schema.submissionTable.id, (await submissionRow(ref)).id));
    const reply = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}/messages`,
      { method: "POST", body: { body: "More detail" } },
    );
    expect(reply.status, await reply.clone().text()).toBe(200);
    expect(
      (await submissionInbox(claimer.id)).map((row) => row.kind),
    ).toContain("submission.replied");
  });
});

describe("P2R2-04: customer approvers only get the portal inbox's approval kinds", () => {
  it("writes no approval.decided row for a customer approver who also watches the item", async () => {
    const t = await buildTenant("p2r2-customer-decided");
    const approver = await addCustomer(t);
    const created = await requestApproval(t, t.requester, {
      kind: "customer",
      approverId: approver.person.id,
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const { id } = (await created.json()) as { id: string };
    await db.insert(schema.watcherTable).values({
      workItemId: t.workItem.id,
      personId: approver.person.id,
      source: "explicit",
    });
    const decided = await portalRequest(
      t,
      approver,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect(decided.status, await decided.clone().text()).toBe(200);
    const kinds = (
      await db
        .select({ kind: schema.notificationTable.kind })
        .from(schema.notificationTable)
        .where(
          and(
            eq(schema.notificationTable.personId, approver.person.id),
            eq(schema.notificationTable.resourceType, "approval"),
          ),
        )
    ).map((row) => row.kind);
    expect(kinds).toContain("approval.requested");
    expect(kinds).not.toContain("approval.decided");
    // The decision did fan out: the staff requester got it.
    const requesterKinds = (
      await db
        .select({ kind: schema.notificationTable.kind })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.personId, t.requesterPerson.id))
    ).map((row) => row.kind);
    expect(requesterKinds).toContain("approval.decided");
    // No delivery (email) was planned for the decision either: the only candidate the
    // customer ever had is the request itself.
    const deliveries = await db.execute(
      sql`SELECT id FROM notification_delivery WHERE recipient_person_id = ${approver.person.id}`,
    );
    expect(deliveries.rows.length).toBeLessThanOrEqual(1);

    // Over HTTP the decider is the event actor and is skipped by the fan-out anyway, so call
    // the resolver itself with a decision by someone else (a system actor): the guard must
    // still keep the customer approver-watcher out.
    const envelope = (kind: string) => ({
      id: `evt_p2r2_${kind}`,
      kind,
      occurredAt: new Date().toISOString(),
      actor: { type: "system" as const, id: null, name: "TaskDesk system" },
      scope: {
        workspaceId: t.workspaceId,
        organisationId: approver.orgId,
        projectId: t.project.id,
      },
      payload: { approvalId: id },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    const decidedFor = await db.transaction((tx) =>
      resolveApprovalEventRecipients(
        tx as never,
        envelope("approval.decided") as never,
      ),
    );
    expect(decidedFor.map((c) => c.personId)).toContain(t.requesterPerson.id);
    expect(decidedFor.map((c) => c.personId)).not.toContain(approver.person.id);
  });
});

describe("P2R1-16: bulk transitions record the request facts", () => {
  it("writes ip, user agent and trace id on each item's transition row and the summary row", async () => {
    const t = await buildTenant("p2r2-bulk-audit");
    mockAuthenticatedSession(t.requester.user);
    const response = await t.app.request("/api/work-items/bulk", {
      method: "POST",
      headers: {
        ...json,
        "user-agent": "p2r2-bulk-agent/1.0",
      },
      body: JSON.stringify({
        workspaceId: t.workspaceId,
        workItemKeys: [t.key],
        operation: "transition",
        toStateTemplateId: t.wip.id,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      succeeded: [t.key],
      failed: [],
    });
    const rows = await db
      .select({
        action: schema.auditLogTable.action,
        entityId: schema.auditLogTable.entityId,
        userAgent: schema.auditLogTable.userAgent,
        traceId: schema.auditLogTable.traceId,
        apiKeyId: schema.auditLogTable.apiKeyId,
      })
      .from(schema.auditLogTable)
      .where(
        inArray(schema.auditLogTable.entityId, [t.workItem.id, t.workspaceId]),
      );
    const item = rows.filter(
      (row) =>
        row.entityId === t.workItem.id && row.action !== "bulk.performed",
    );
    const summary = rows.find((row) => row.action === "bulk.performed");
    expect(item.length).toBeGreaterThan(0);
    for (const row of [...item, summary]) {
      expect(row?.userAgent).toBe("p2r2-bulk-agent/1.0");
      expect(row?.traceId).toBeTruthy();
      expect(row?.apiKeyId).toBeNull();
    }
    // One request, one trace id across the item rows and the summary.
    expect(new Set([...item, summary].map((row) => row?.traceId)).size).toBe(1);
  });
});
