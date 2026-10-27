/**
 * P3 customer portal (CP-3, CP-4, CP-6, CP-7, CP-8, CP-9, CP-16).
 *
 * WRITTEN, NOT YET RUN by the implementer: it needs the integration database, which the
 * implementer may not touch. The coordinator runs it; failures here are real findings.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { findSubmissionSatisfaction } from "../../apps/api/src/intake/repository";
import { setSystemTransitionExecutor } from "../../apps/api/src/workflow/system-transition";
import { addCustomer, portalRequest } from "./helpers/approval-fixtures";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import {
  type Customer,
  type IntakeSeed,
  seedIntake,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** Link the tenant work item to the submission as an accepted request owned by `customer`. */
async function accept(
  s: IntakeSeed,
  ref: string,
  customer: Customer,
  fields: { priority?: string | null; resolvedAt?: Date | null } = {},
) {
  await db
    .update(schema.workItemTable)
    .set({
      requesterId: customer.person.id,
      priority: fields.priority === undefined ? "medium" : fields.priority,
      resolvedAt: fields.resolvedAt ?? null,
    })
    .where(eq(schema.workItemTable.id, s.t.workItem.id));
  const row = await submissionRow(ref);
  await db
    .update(schema.submissionTable)
    .set({ state: "accepted", workItemId: s.t.workItem.id })
    .where(eq(schema.submissionTable.id, row.id));
  return s.t.workItem;
}

const get = (
  s: IntakeSeed,
  as: Customer | { user: Customer["user"] },
  ref: string,
) => portalRequest(s.t, as, `/api/portal/submissions/${ref}`);
const post = (
  s: IntakeSeed,
  as: Customer | { user: Customer["user"] },
  ref: string,
  action: string,
  body?: unknown,
) =>
  portalRequest(s.t, as, `/api/portal/submissions/${ref}/${action}`, {
    method: "POST",
    ...(body === undefined ? {} : { body }),
  });

const addColleague = (s: IntakeSeed) => addCustomer(s.t);

describe("CP-3 / CP-4 portal message projection", () => {
  beforeEach(async () => resetTestDatabase());

  it("never shows an internal comment, names staff on public comments, hides the assignee", async () => {
    const s = await seedIntake("cp3-cp4");
    const ref = await submitAs(s, s.customer);
    const item = await accept(s, ref, s.customer);
    await db
      .update(schema.personTable)
      .set({ displayName: "Alex Agent" })
      .where(eq(schema.personTable.id, s.t.requesterPerson.id));
    await db
      .update(schema.personTable)
      .set({ displayName: "Assignee Person" })
      .where(eq(schema.personTable.id, s.t.approverPerson.id));
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: s.t.approverPerson.id })
      .where(eq(schema.workItemTable.id, item.id));
    await db.insert(schema.commentTable).values([
      {
        workspaceId: s.t.workspaceId,
        workItemId: item.id,
        authorId: s.t.requesterPerson.id,
        actorType: "person",
        body: doc("Public staff answer"),
        visibility: "public",
      },
      {
        workspaceId: s.t.workspaceId,
        workItemId: item.id,
        authorId: s.t.approverPerson.id,
        actorType: "person",
        body: doc("INTERNAL-SECRET note"),
        visibility: "internal",
      },
    ]);

    const response = await get(s, s.customer, ref);
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(text).not.toContain("INTERNAL-SECRET");
    expect(text).not.toContain("Assignee Person");
    expect(text).not.toContain(s.t.requesterPerson.id);
    expect(text).not.toContain(s.t.approverPerson.id);
    expect(text).not.toContain("assignee");
    const staff = body.messages.find((m) => m.body === "Public staff answer");
    expect(staff).toMatchObject({
      actorType: "triager",
      authorName: "Alex Agent",
      mine: false,
    });
    expect(Object.keys(staff ?? {}).sort()).toEqual([
      "actorType",
      "authorName",
      "body",
      "createdAt",
      "id",
      "mine",
      // `P2R1-05`: null unless the message is the system auto-decline.
      "reasonCode",
      "reasonParams",
    ]);
  });

  it("does not name a customer, even the viewer's own messages", async () => {
    const s = await seedIntake("cp4-customer");
    const ref = await submitAs(s, s.customer);
    const item = await accept(s, ref, s.customer);
    await db.insert(schema.commentTable).values({
      workspaceId: s.t.workspaceId,
      workItemId: item.id,
      authorId: s.customer.person.id,
      actorType: "person",
      body: doc("Customer follow-up"),
      visibility: "public",
    });
    const body = (await (await get(s, s.customer, ref)).json()) as {
      messages: Array<{
        body: string;
        actorType: string;
        authorName: unknown;
        mine: boolean;
      }>;
    };
    expect(
      body.messages.find((m) => m.body === "Customer follow-up"),
    ).toMatchObject({
      actorType: "customer",
      authorName: null,
      mine: true,
    });
  });
});

describe("CP-7 escalate priority (escalate-only)", () => {
  beforeEach(async () => resetTestDatabase());

  it("raises priority with an activity row, audit row and work_item.escalated event; refuses a decrease with 403", async () => {
    const s = await seedIntake("cp7");
    const ref = await submitAs(s, s.customer);
    const item = await accept(s, ref, s.customer, { priority: "medium" });

    const up = await post(s, s.customer, ref, "escalate-priority", {
      priority: "urgent",
    });
    expect(up.status, await up.clone().text()).toBe(200);
    const projected = (await up.json()) as {
      workItem: { priority: string };
      canEscalate: boolean;
    };
    expect(projected.workItem.priority).toBe("urgent");
    expect(projected.canEscalate).toBe(false);

    const [activity] = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, item.id),
          eq(schema.activityTable.field, "priority"),
        ),
      );
    expect(activity).toMatchObject({
      verb: "updated",
      oldValue: "medium",
      newValue: "urgent",
      visibility: "public",
    });
    const events = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "work_item.escalated"));
    expect(events).toHaveLength(1);
    // T3: the canonical priority-change event is emitted too, with the standard payload.
    const updated = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "work_item.updated"));
    expect(updated).toHaveLength(1);
    expect(JSON.stringify(updated[0]?.payload)).toContain('"field":"priority"');
    expect(JSON.stringify(updated[0]?.payload)).toContain('"to":"urgent"');
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "work_item.escalated"));
    expect(audits).toHaveLength(1);

    const down = await post(s, s.customer, ref, "escalate-priority", {
      priority: "low",
    });
    expect(down.status).toBe(403);
    expect(await down.text()).toMatch(/^cannot_deescalate:/);
    const same = await post(s, s.customer, ref, "escalate-priority", {
      priority: "urgent",
    });
    expect(same.status).toBe(409);
    expect(await same.text()).toMatch(/^no_change:/);
    const [row] = await db
      .select({ priority: schema.workItemTable.priority })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    expect(row?.priority).toBe("urgent");
  });

  it("treats no priority as below low, and refuses a resolved or unaccepted request", async () => {
    const s = await seedIntake("cp7-edge");
    const unaccepted = await submitAs(s, s.customer);
    const early = await post(s, s.customer, unaccepted, "escalate-priority", {
      priority: "high",
    });
    expect(early.status).toBe(409);
    expect(await early.text()).toMatch(/^not_escalatable:/);
    await accept(s, unaccepted, s.customer, { priority: null });
    const first = await post(s, s.customer, unaccepted, "escalate-priority", {
      priority: "low",
    });
    expect(first.status, await first.clone().text()).toBe(200);
    await db
      .update(schema.workItemTable)
      .set({ resolvedAt: new Date() })
      .where(eq(schema.workItemTable.id, s.t.workItem.id));
    const resolved = await post(
      s,
      s.customer,
      unaccepted,
      "escalate-priority",
      { priority: "urgent" },
    );
    expect(resolved.status).toBe(409);
    expect(await resolved.text()).toMatch(/^not_escalatable:/);
  });
});

describe("CP-8 customer reopen", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    setSystemTransitionExecutor(null);
  });

  it("reopens a resolved request inside the window through the system executor", async () => {
    const s = await seedIntake("cp8");
    const ref = await submitAs(s, s.customer);
    await accept(s, ref, s.customer, {
      resolvedAt: new Date(Date.now() - 86_400_000),
    });
    const calls: unknown[] = [];
    setSystemTransitionExecutor((async (request: unknown) => {
      calls.push(request);
      return { kind: "applied" };
    }) as never);
    const response = await post(s, s.customer, ref, "reopen");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(calls).toEqual([{ kind: "reopen", workItemId: s.t.workItem.id }]);
    const reopenAudits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "submission.reopen_requested"));
    expect(reopenAudits).toHaveLength(1);
    expect(reopenAudits[0]?.actorId).toBe(s.customer.person.id);
  });

  it("refuses outside the window or while open, without raising the staff warning flag", async () => {
    const s = await seedIntake("cp8-window");
    const ref = await submitAs(s, s.customer);
    await accept(s, ref, s.customer, {
      resolvedAt: new Date(Date.now() - 400 * 86_400_000),
    });
    setSystemTransitionExecutor((async () => ({ kind: "applied" })) as never);
    const late = await post(s, s.customer, ref, "reopen");
    expect(late.status).toBe(409);
    expect(await late.text()).toMatch(/^not_reopenable:/);
    await db
      .update(schema.workItemTable)
      .set({ resolvedAt: null })
      .where(eq(schema.workItemTable.id, s.t.workItem.id));
    const open = await post(s, s.customer, ref, "reopen");
    expect(open.status).toBe(409);
    expect(await open.text()).toMatch(/^not_reopenable:/);
    const flags = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.verb, "reopen_requested"));
    expect(flags).toHaveLength(0);
  });

  it("tells the customer when the workflow could not reopen it (staff flag raised)", async () => {
    const s = await seedIntake("cp8-flag");
    const ref = await submitAs(s, s.customer);
    await accept(s, ref, s.customer, {
      resolvedAt: new Date(Date.now() - 86_400_000),
    });
    setSystemTransitionExecutor((async () => ({ kind: "none" })) as never);
    const response = await post(s, s.customer, ref, "reopen");
    expect(response.status).toBe(409);
    expect(await response.text()).toMatch(/^reopen_pending_review:/);
    // T4: a repeat press is idempotent (one flag, one audit row naming the customer).
    const again = await post(s, s.customer, ref, "reopen");
    expect(again.status).toBe(409);
    expect(await again.text()).toMatch(/^reopen_pending_review:/);
    const flags = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.verb, "reopen_requested"));
    expect(flags).toHaveLength(1);
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "submission.reopen_requested"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: s.customer.person.id,
      actorType: "person",
    });
  });

  it("T2: projects one customer status, resolved for a resolved request, never a workflow state name", async () => {
    const s = await seedIntake("cp5-status");
    const ref = await submitAs(s, s.customer);
    await accept(s, ref, s.customer, {
      resolvedAt: new Date(Date.now() - 86_400_000),
    });
    const detail = (await (await get(s, s.customer, ref)).json()) as {
      customerStatus: string;
      workItem: Record<string, unknown>;
    };
    expect(detail.customerStatus).toBe("resolved");
    expect(detail.workItem).not.toHaveProperty("state");
    const list = (await (
      await portalRequest(s.t, s.customer, "/api/portal/submissions")
    ).json()) as {
      submissions: Array<{ ref: string; customerStatus: string }>;
    };
    expect(
      list.submissions.find((row) => row.ref === ref)?.customerStatus,
    ).toBe("resolved");
  });

  it("reopens an auto-declined submission to new, but not a staff-declined one", async () => {
    const s = await seedIntake("cp8-auto");
    const auto = await submitAs(s, s.customer);
    const manual = await submitAs(s, s.customer, "Declined by staff");
    const autoRow = await submissionRow(auto);
    const manualRow = await submissionRow(manual);
    await db
      .update(schema.submissionTable)
      .set({ state: "declined", autoDeclinedAt: new Date() })
      .where(eq(schema.submissionTable.id, autoRow.id));
    await db
      .update(schema.submissionTable)
      .set({ state: "declined" })
      .where(eq(schema.submissionTable.id, manualRow.id));

    const reopened = await post(s, s.customer, auto, "reopen");
    expect(reopened.status, await reopened.clone().text()).toBe(200);
    const after = await submissionRow(auto);
    expect(after).toMatchObject({ state: "new", autoDeclinedAt: null });
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "submission.reopened"));
    expect(audit).toHaveLength(1);

    const refused = await post(s, s.customer, manual, "reopen");
    expect(refused.status).toBe(409);
    expect(await refused.text()).toMatch(/^not_reopenable:/);
    expect((await submissionRow(manual)).state).toBe("declined");
  });
});

describe("CP-9 satisfaction", () => {
  beforeEach(async () => resetTestDatabase());

  it("rates once per request, changes it inside the window, locks it after, and shows staff", async () => {
    const s = await seedIntake("cp9");
    const ref = await submitAs(s, s.customer);
    const item = await accept(s, ref, s.customer, {
      resolvedAt: new Date(Date.now() - 86_400_000),
    });

    const bad = await post(s, s.customer, ref, "satisfaction", { rating: 6 });
    expect(bad.status).toBe(400);
    const first = await post(s, s.customer, ref, "satisfaction", {
      rating: 4,
      comment: "Good",
    });
    expect(first.status, await first.clone().text()).toBe(200);
    expect(
      ((await first.json()) as { satisfaction: unknown }).satisfaction,
    ).toMatchObject({
      rating: 4,
      comment: "Good",
    });
    const changed = await post(s, s.customer, ref, "satisfaction", {
      rating: 2,
    });
    expect(changed.status).toBe(200);
    const rows = await db
      .select()
      .from(schema.satisfactionRatingTable)
      .where(eq(schema.satisfactionRatingTable.workItemId, item.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score: 2, comment: null });
    expect(await findSubmissionSatisfaction(item.id)).toMatchObject({
      rating: 2,
      comment: null,
    });

    await db
      .update(schema.workItemTable)
      .set({ resolvedAt: new Date(Date.now() - 400 * 86_400_000) })
      .where(eq(schema.workItemTable.id, item.id));
    const locked = await post(s, s.customer, ref, "satisfaction", {
      rating: 5,
    });
    expect(locked.status).toBe(409);
    expect(await locked.text()).toMatch(/^rating_locked:/);
  });

  it("refuses an unresolved request, and the database refuses an out-of-range score", async () => {
    const s = await seedIntake("cp9-open");
    const ref = await submitAs(s, s.customer);
    const item = await accept(s, ref, s.customer);
    const response = await post(s, s.customer, ref, "satisfaction", {
      rating: 5,
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toMatch(/^not_rateable:/);
    await expect(
      db.insert(schema.satisfactionRatingTable).values({
        workItemId: item.id,
        personId: s.customer.person.id,
        score: 0,
      }),
    ).rejects.toThrow();
  });
});

describe("CP-16 organisation-visible requests", () => {
  beforeEach(async () => resetTestDatabase());

  async function submitWithVisibility(
    s: IntakeSeed,
    visibility: "private" | "organisation",
  ) {
    const response = await portalRequest(
      s.t,
      s.customer,
      "/api/portal/submissions",
      {
        method: "POST",
        body: {
          key: s.requestType.key,
          formData: { summary: `Visibility ${visibility} ${randomUUID()}` },
          customerVisibility: visibility,
        },
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return ((await response.json()) as { ref: string }).ref;
  }

  it("an organisation colleague lists and views an organisation-visible request, read-only; private stays hidden", async () => {
    const s = await seedIntake("cp16");
    const colleague = await addColleague(s);
    const open = await submitWithVisibility(s, "organisation");
    const hidden = await submitWithVisibility(s, "private");

    const list = (await (
      await portalRequest(s.t, colleague, "/api/portal/submissions")
    ).json()) as {
      submissions: Array<{ ref: string; isRequester: boolean }>;
      meta: { total: number };
    };
    expect(list.submissions.map((row) => row.ref)).toEqual([open]);
    expect(list.submissions[0]?.isRequester).toBe(false);
    expect(list.meta.total).toBe(1);

    const view = await get(s, colleague, open);
    expect(view.status).toBe(200);
    expect(await view.json()).toMatchObject({
      isRequester: false,
      canWithdraw: false,
      canEscalate: false,
      canReopen: false,
      canRate: false,
    });
    const privateView = await get(s, colleague, hidden);
    expect(privateView.status).toBe(404);
    const unknown = await get(s, colleague, "SUB-999999");
    expect(unknown.status).toBe(404);
    expect(await privateView.text()).toBe(await unknown.text());
  });

  it("a colleague cannot act on the requester's request (withdraw, escalate, reopen, rate, reply)", async () => {
    const s = await seedIntake("cp16-writes");
    const colleague = await addColleague(s);
    const ref = await submitWithVisibility(s, "organisation");
    for (const action of ["withdraw", "reopen"] as const)
      expect((await post(s, colleague, ref, action)).status, action).toBe(404);
    expect(
      (
        await post(s, colleague, ref, "escalate-priority", {
          priority: "urgent",
        })
      ).status,
    ).toBe(404);
    expect(
      (await post(s, colleague, ref, "satisfaction", { rating: 5 })).status,
    ).toBe(404);
    expect(
      (await post(s, colleague, ref, "messages", { body: "hi" })).status,
    ).toBe(404);
    expect((await submissionRow(ref)).state).not.toBe("withdrawn");
  });

  it("a named participant sees a private request; another organisation never sees any", async () => {
    const s = await seedIntake("cp16-participant");
    const participant = await addColleague(s);
    const stranger = await createCustomerPrincipal();
    const open = await submitWithVisibility(s, "organisation");
    const hidden = await submitWithVisibility(s, "private");
    const hiddenRow = await submissionRow(hidden);
    await db.insert(schema.requestParticipantTable).values({
      submissionId: hiddenRow.id,
      personId: participant.person.id,
      addedBy: s.customer.person.id,
    });
    expect((await get(s, participant, hidden)).status).toBe(200);

    for (const ref of [open, hidden])
      expect((await get(s, stranger, ref)).status, ref).toBe(404);
    const strangerList = (await (
      await portalRequest(s.t, stranger, "/api/portal/submissions")
    ).json()) as { submissions: unknown[] };
    expect(strangerList.submissions).toEqual([]);
  });

  it("a participant row from another organisation does not widen reach", async () => {
    const s = await seedIntake("cp16-cross");
    const stranger = await createCustomerPrincipal();
    const hidden = await submitWithVisibility(s, "private");
    const hiddenRow = await submissionRow(hidden);
    await db.insert(schema.requestParticipantTable).values({
      submissionId: hiddenRow.id,
      personId: stranger.person.id,
      addedBy: s.customer.person.id,
    });
    expect((await get(s, stranger, hidden)).status).toBe(404);
  });
});

describe("CP-6 customer-facing SLA on portal list rows", () => {
  beforeEach(async () => resetTestDatabase());

  it("list rows carry the same customer-safe {state, dueAt} as the detail, null without an SLA", async () => {
    const s = await seedIntake("cp6");
    const withSla = await submitAs(s, s.customer, "With SLA");
    const without = await submitAs(s, s.customer, "No SLA");
    const calendar = requireRow(
      await db
        .insert(schema.serviceCalendarTable)
        .values({
          workspaceId: s.t.workspaceId,
          name: "INTERNAL-CALENDAR-NAME",
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
        .values({ workspaceId: s.t.workspaceId, name: "INTERNAL-POLICY-NAME" })
        .returning(),
      "policy",
    );
    const version = requireRow(
      await db
        .insert(schema.slaPolicyVersionTable)
        .values({
          workspaceId: s.t.workspaceId,
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
          workspaceId: s.t.workspaceId,
          versionId: version.id,
          metric,
          priority,
          workItemTypeId: s.t.type.id,
          targetMinutes: 100,
        })),
      ),
    );
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    await db
      .update(schema.slaPolicyVersionTable)
      .set({ effectiveFrom: ago(24 * 60) })
      .where(eq(schema.slaPolicyVersionTable.id, version.id));
    await accept(s, withSla, s.customer, { priority: "high" });
    await db
      .update(schema.workItemTable)
      .set({ slaPolicyVersionId: version.id, slaStartedAt: ago(85) })
      .where(eq(schema.workItemTable.id, s.t.workItem.id));

    const response = await portalRequest(
      s.t,
      s.customer,
      "/api/portal/submissions",
    );
    const text = await response.text();
    const body = JSON.parse(text) as {
      submissions: Array<{
        ref: string;
        customerStatus: string;
        sla: { state: string; dueAt: string | null; metric: string } | null;
      }>;
    };
    const rowWith = body.submissions.find((row) => row.ref === withSla);
    const rowWithout = body.submissions.find((row) => row.ref === without);
    expect(rowWithout?.sla).toBeNull();
    expect(Object.keys(rowWith?.sla ?? {}).sort()).toEqual([
      "dueAt",
      "metric",
      "state",
    ]);
    // T2: one server-side customer status; an open accepted request is in progress.
    expect(rowWith?.customerStatus).toBe("in_progress");
    expect(rowWith?.sla?.state).toBe("at_risk");
    for (const internal of [
      "INTERNAL-CALENDAR-NAME",
      "INTERNAL-POLICY-NAME",
      "targetMinutes",
      "consumedPct",
    ])
      expect(text, internal).not.toContain(internal);
    const detail = (await (await get(s, s.customer, withSla)).json()) as {
      workItem: { sla: unknown };
    };
    expect(rowWith?.sla).toEqual(detail.workItem.sla);
  });
});
