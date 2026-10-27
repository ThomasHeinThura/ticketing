/**
 * P2 round-1 review fixes, intake lane: IQ-16a claim as a withdrawal lock (P2R1-08), coded
 * triage refusals and the accept-race winner (P2R1-12), merge targets in deleted projects
 * (P2R1-P1), AU-14 audit savepoints (P2R1-03), the IQ-15 auto-decline message and batch
 * (P2R1-05 / P2R1-P2), request-type deletion (P2R1-18) and customer approval notifications
 * (P2R1-04). Real HTTP through the router, real database.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanApprovalReminders } from "../../apps/api/src/approval/reminder-scan";
import db, { schema } from "../../apps/api/src/database";
import { notificationPreferenceTable } from "../../apps/api/src/database/schema";
import { autoDeclineStaleClarifications } from "../../apps/api/src/intake/auto-decline";
import { immediateNotificationRuntime } from "../../apps/api/src/notification/immediate-runtime";
import { processNextNotificationDelivery } from "../../apps/api/src/notification/outbox-drain";
import { updateEmailProvider } from "../../apps/api/src/notification-provider/service";
import {
  addCustomer,
  personOf,
  portalRequest,
  request as requestApproval,
} from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import {
  type IntakeSeed,
  mockSessionsByHeader,
  seedIntake,
  staffAs,
  staffRequest,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";

const acceptBody = (s: IntakeSeed) => ({
  method: "POST",
  body: { projectId: s.t.project.id, workItemTypeId: s.t.type.id },
});

async function dropTestTriggers() {
  await db.execute(
    sql`DROP TRIGGER IF EXISTS p2b_fail_audit ON audit_log; DROP TRIGGER IF EXISTS p2b_fail_message ON submission_message; DROP FUNCTION IF EXISTS p2b_fail_audit(); DROP FUNCTION IF EXISTS p2b_fail_message();`,
  );
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

beforeEach(async () => {
  await dropTestTriggers();
  await resetTestDatabase();
});
afterEach(async () => {
  await dropTestTriggers();
  vi.restoreAllMocks();
});

describe("P2R1-08: the claim is a withdrawal lock, not an assignment (IQ-16a)", () => {
  it("lets another triager accept a submission claimed by someone else", async () => {
    const s = await seedIntake("claim-lock");
    const ref = await submitAs(s, s.customer);
    const claim = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/claim`,
      { method: "POST" },
    );
    expect(claim.status, await claim.clone().text()).toBe(200);
    const accept = await staffRequest(
      s.t,
      s.t.approver,
      `/api/submissions/${ref}/accept`,
      acceptBody(s),
    );
    expect(accept.status, await accept.clone().text()).toBe(200);
    const row = await submissionRow(ref);
    expect(row.state).toBe("accepted");
    // The first triager's claim is kept as the withdrawal lock.
    expect(row.claimedBy).toBe((await personOf(s.t.requester.user.id)).id);
    // Withdrawal stays refused once claimed.
    const withdraw = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}/withdraw`,
      { method: "POST" },
    );
    expect(withdraw.status).toBe(409);
  });
});

describe("P2R1-12: coded triage refusals", () => {
  it("tells the loser of an accept race which work item the winner created", async () => {
    const s = await seedIntake("accept-race-winner");
    const ref = await submitAs(s, s.customer);
    mockSessionsByHeader([
      { user: s.t.requester.user },
      { user: s.t.approver.user },
    ]);
    const [first, second] = await Promise.all([
      staffAs(
        s.t,
        s.t.requester.user,
        `/api/submissions/${ref}/accept`,
        acceptBody(s),
      ),
      staffAs(
        s.t,
        s.t.approver.user,
        `/api/submissions/${ref}/accept`,
        acceptBody(s),
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    const loser = first.status === 200 ? second : first;
    const won = (await winner.json()) as {
      workItem: { id: string; key: string };
    };
    expect(await loser.json()).toMatchObject({
      error: "submission_already_converted",
      workItem: { id: won.workItem.id, key: won.workItem.key },
    });
  });

  it("codes a missing destination and a closed submission", async () => {
    const s = await seedIntake("coded-refusals");
    const ref = await submitAs(s, s.customer);
    const missing = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/accept`,
      { method: "POST", body: { workItemTypeId: s.t.type.id } },
    );
    expect([400, 422]).toContain(missing.status);
    const decline = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/decline`,
      { method: "POST", body: { reason: "Out of scope" } },
    );
    expect(decline.status, await decline.clone().text()).toBe(200);
    const again = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/decline`,
      { method: "POST", body: { reason: "Again" } },
    );
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "submission_not_open" });
  });
});

describe("P2R1-P1: merge target in a deleted project", () => {
  it("refuses a work item whose project is soft-deleted", async () => {
    const s = await seedIntake("merge-deleted-project");
    const ref = await submitAs(s, s.customer);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, s.t.project.id));
    const response = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/duplicate`,
      { method: "POST", body: { workItemId: s.t.workItem.id } },
    );
    expect(response.status).toBe(404);
    expect((await submissionRow(ref)).state).toBe("new");
  });
});

describe("AU-14 for intake: an audit failure never fails the action", () => {
  it("commits a decline when its audit append fails, and records request metadata otherwise", async () => {
    const s = await seedIntake("audit-savepoint");
    const ref = await submitAs(s, s.customer);
    await db.execute(sql`
      CREATE FUNCTION p2b_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'submission.declined' THEN
          RAISE EXCEPTION 'simulated audit failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER p2b_fail_audit BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION p2b_fail_audit();
    `);
    const claim = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/claim`,
      { method: "POST" },
    );
    expect(claim.status).toBe(200);
    const decline = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/decline`,
      { method: "POST", body: { reason: "Not supported" } },
    );
    expect(decline.status, await decline.clone().text()).toBe(200);
    const row = await submissionRow(ref);
    expect(row.state).toBe("declined");
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, row.id));
    expect(audits.map((audit) => audit.action)).not.toContain(
      "submission.declined",
    );
    // The claim's audit row landed with the request's trace id (AU-14 metadata).
    const claimed = audits.find(
      (audit) => audit.action === "submission.claimed",
    );
    expect(claimed?.traceId).toBeTruthy();
  });
});

describe("P2R1-05 / P2R1-P2: clarification-window auto-decline", () => {
  async function clarifying(s: IntakeSeed, daysAgo: number) {
    const ref = await submitAs(s, s.customer, `Stale ${daysAgo}`);
    const message = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/messages`,
      { method: "POST", body: { body: "Which version?" } },
    );
    expect(message.status, await message.clone().text()).toBe(200);
    await db
      .update(schema.submissionTable)
      .set({ clarifyingSince: new Date(Date.now() - daysAgo * 86_400_000) })
      .where(eq(schema.submissionTable.id, (await submissionRow(ref)).id));
    return ref;
  }

  it("writes a coded system message the portal and the staff detail both show, and emails the customer", async () => {
    const s = await seedIntake("auto-decline-message");
    await enableEmail(s);
    await preferEmail(s.customer.person.id, "submission.declined");
    const ref = await clarifying(s, 20);
    // The clarification's own delivery is not under test.
    await db.execute(sql`DELETE FROM notification_delivery`);
    expect(await autoDeclineStaleClarifications()).toMatchObject({
      declined: 1,
      degraded: false,
    });
    const portal = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}`,
    );
    expect(portal.status, await portal.clone().text()).toBe(200);
    const portalBody = (await portal.json()) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(portalBody.messages.at(-1)).toMatchObject({
      actorType: "system",
      authorName: null,
      mine: false,
      reasonCode: "clarification_window_expired",
      reasonParams: { days: 14 },
    });
    expect(String(portalBody.messages.at(-1)?.body)).toContain("14 days");
    const staff = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}`,
    );
    expect(staff.status).toBe(200);
    const staffBody = (await staff.json()) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(staffBody.messages.at(-1)).toMatchObject({
      authorId: null,
      actorType: "system",
      reasonCode: "clarification_window_expired",
    });
    const send = vi.fn(async (_to, _subject, _data, options) => {
      expect(await options.authorize?.()).toBe(true);
      return { success: true as const };
    });
    await expect(
      processNextNotificationDelivery(immediateNotificationRuntime(send)),
    ).resolves.toEqual({ kind: "delivered" });
    const [to, , data] = send.mock.calls[0] ?? [];
    expect(to).toBe(s.customer.user.email);
    expect(String(data.actionUrl)).toMatch(
      new RegExp(`/submissions/${ref}$`, "u"),
    );
  });

  it("does not stall behind rows that keep failing", async () => {
    const s = await seedIntake("auto-decline-batch");
    const failA = await clarifying(s, 40);
    const failB = await clarifying(s, 30);
    const ok = await clarifying(s, 20);
    const ids = [
      (await submissionRow(failA)).id,
      (await submissionRow(failB)).id,
    ];
    await db.execute(sql`
      CREATE FUNCTION p2b_fail_message() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.actor_type = 'system' AND NEW.submission_id IN (${sql.raw(
          ids.map((id) => `'${id}'`).join(","),
        )}) THEN
          RAISE EXCEPTION 'simulated row failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER p2b_fail_message BEFORE INSERT ON submission_message
        FOR EACH ROW EXECUTE FUNCTION p2b_fail_message();
    `);
    const outcome = await autoDeclineStaleClarifications({ batchSize: 2 });
    expect(outcome).toMatchObject({ declined: 1, degraded: true, scanned: 3 });
    expect((await submissionRow(ok)).state).toBe("declined");
    expect((await submissionRow(failA)).state).toBe("clarifying");
    expect((await submissionRow(failB)).state).toBe("clarifying");
  });
});

describe("P2R1-18: DELETE /api/request-types/{id}", () => {
  it("refuses a published type and a type with submissions", async () => {
    const s = await seedIntake("rt-delete-refusals");
    const published = await staffRequest(
      s.t,
      s.t.requester,
      `/api/request-types/${s.requestType.id}`,
      { method: "DELETE" },
    );
    expect(published.status).toBe(409);
    expect(await published.json()).toMatchObject({
      error: "request_type_published",
    });
    await submitAs(s, s.customer);
    await db
      .update(schema.requestTypeTable)
      .set({ published: false })
      .where(eq(schema.requestTypeTable.id, s.requestType.id));
    const used = await staffRequest(
      s.t,
      s.t.requester,
      `/api/request-types/${s.requestType.id}`,
      { method: "DELETE" },
    );
    expect(used.status).toBe(409);
    expect(await used.json()).toMatchObject({
      error: "request_type_has_submissions",
    });
    expect(
      await db
        .select()
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.targetType, "request_type")),
    ).toHaveLength(0);
  });

  it("deletes an unpublished, unused type only after the pending action is approved", async () => {
    const s = await seedIntake("rt-delete-ok");
    // The pending-action approval needs the requester's live agent session row.
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
    const { pendingActionId, confirmation } = (await requested.json()) as {
      pendingActionId: string;
      confirmation: string;
    };
    expect(confirmation).toBe("click");
    // Nothing is deleted at request time (PA-1).
    expect(
      await db
        .select()
        .from(schema.requestTypeTable)
        .where(eq(schema.requestTypeTable.id, s.requestType.id)),
    ).toHaveLength(1);
    const approved = await staffRequest(
      s.t,
      s.t.requester,
      `/api/me/pending-actions/${pendingActionId}/approve`,
      { method: "POST", body: {} },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(
      await db
        .select()
        .from(schema.requestTypeTable)
        .where(eq(schema.requestTypeTable.id, s.requestType.id)),
    ).toHaveLength(0);
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, s.requestType.id));
    expect(audits.map((audit) => audit.action)).toContain(
      "request_type.deleted",
    );
  });
});

describe("P2R1-04: customer approvers are notified (AP-21, AP-13)", () => {
  it("writes an inbox row the customer reads through the portal, emails per preference, and sends reminders", async () => {
    const s = await seedIntake("approval-customer-notify");
    const approver = await addCustomer(s.t);
    await enableEmail(s);
    await preferEmail(approver.person.id, "approval.requested");
    const created = await requestApproval(s.t, s.t.requester, {
      kind: "customer",
      approverId: approver.person.id,
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const { id } = (await created.json()) as { id: string };

    const inbox = await portalRequest(
      s.t,
      approver,
      "/api/portal/notification/inbox",
    );
    expect(inbox.status, await inbox.clone().text()).toBe(200);
    const page = (await inbox.json()) as {
      data: Array<{ kind: string; requestRef: string | null }>;
    };
    expect(page.data).toEqual([
      expect.objectContaining({ kind: "approval.requested", requestRef: null }),
    ]);
    // Another customer of the same organisation sees nothing.
    const other = await addCustomer(s.t);
    const otherInbox = await portalRequest(
      s.t,
      other,
      "/api/portal/notification/inbox",
    );
    expect(((await otherInbox.json()) as { data: unknown[] }).data).toEqual([]);

    const send = vi.fn(async (_to, _subject, _data, options) => {
      expect(await options.authorize?.()).toBe(true);
      return { success: true as const };
    });
    await expect(
      processNextNotificationDelivery(immediateNotificationRuntime(send)),
    ).resolves.toEqual({ kind: "delivered" });
    const [to, , data] = send.mock.calls[0] ?? [];
    expect(to).toBe(approver.user.email);
    expect(String(data.actionUrl)).toMatch(/\/approvals$/u);
    expect(JSON.stringify(data)).not.toContain(s.t.key);

    // AP-13: past half the window the approver gets the reminder in the portal inbox.
    await db
      .update(schema.approvalTable)
      .set({
        createdAt: new Date(Date.now() - 6 * 86_400_000),
        expiresAt: new Date(Date.now() + 4 * 86_400_000),
      })
      .where(eq(schema.approvalTable.id, id));
    await scanApprovalReminders();
    const after = await portalRequest(
      s.t,
      approver,
      "/api/portal/notification/inbox",
    );
    const kinds = ((await after.json()) as { data: Array<{ kind: string }> })
      .data;
    expect(kinds.map((row) => row.kind)).toContain("approval.expiring");
  });
});
