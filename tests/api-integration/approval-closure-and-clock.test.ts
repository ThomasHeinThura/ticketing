/**
 * Final S3 round: "close them on transition" (owner decision 2026-10-10), database-clock
 * ordering of single use, the transition offers list after consumption, unrelated transitions,
 * list/inbox scoping, inactive sessions, portal capability, and customer notification rows.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanApprovalReminders } from "../../apps/api/src/approval/reminder-scan";
import {
  hasPortalApprovalDecideCapability,
  loadApprovalTargetByKey,
  resolveApprovalIdentityIfActive,
} from "../../apps/api/src/approval/repository";
import db, { schema } from "../../apps/api/src/database";
import { dbClockUtc } from "../../apps/api/src/utils/db-time";
import {
  addCustomer,
  approvalRows,
  buildTenant,
  createApproval,
  decide,
  portalRequest,
  request,
  runTransition,
  setApproval,
  withdrawAs,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

describe("approvals: closing pending approvals when a transition runs", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("closes the other pending approvals of that transition: expired, audited, out of inboxes and reminders, decide refused", async () => {
    const t = await buildTenant("close", { executable: true });
    const winner = await createApproval(t);
    const loser = await createApproval(t);
    const loserInboxBefore = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.resourceId, loser.id));
    expect(loserInboxBefore.length).toBeGreaterThan(0);
    await setApproval(t, winner.id);

    const run = await runTransition(t, t.done.id);
    expect(run.status, await run.clone().text()).toBe(200);

    const rows = await approvalRows(t.workItem.id);
    const closed = rows.find((r) => r.id === loser.id);
    expect(closed?.state).toBe("expired");
    expect(closed?.decidedAt).not.toBeNull();
    expect(rows.find((r) => r.id === winner.id)?.state).toBe("approved");

    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "approval.closed"));
    expect(audit.map((a) => a.entityId)).toEqual([loser.id]);
    // Same actor convention as the other approval.* rows, and the organisation is set.
    expect(audit[0]?.actorId).toBe(t.requesterPerson.id);
    expect(audit[0]?.actorType).toBe("person");
    const [workspaceRow] = await db
      .select({ organisationId: schema.workspaceTable.organisationId })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, t.workspaceId));
    expect(workspaceRow?.organisationId).toBeTruthy();
    expect(audit[0]?.organisationId).toBe(workspaceRow?.organisationId);
    expect(audit[0]?.workspaceId).toBe(t.workspaceId);
    expect(audit[0]?.after).toMatchObject({
      state: "expired",
      reason: "transition_ran",
      transitionId: t.gated.id,
    });

    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.resourceId, loser.id)),
    ).toEqual([]);

    // Reminders skip it: even past its expiry the scan produces no event for it.
    await db
      .update(schema.approvalTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.approvalTable.id, loser.id));
    await scanApprovalReminders();
    const events = (await db.select().from(schema.outboxTable)).filter(
      (e) =>
        (e.payload as { payload?: { approvalId?: string } }).payload
          ?.approvalId === loser.id &&
        (e.kind === "approval.expired" || e.kind === "approval.expiring"),
    );
    expect(events).toEqual([]);

    const late = await decide(t, t.approver, loser.id);
    expect(late.status, await late.clone().text()).toBe(409);
    expect(
      (await approvalRows(t.workItem.id)).find((r) => r.id === loser.id)?.state,
    ).toBe("expired");
  });

  it("a run on one work item leaves another work item's pending approval of the same transition alone", async () => {
    const t = await buildTenant("two-items", { executable: true });
    mockAuthenticatedSession(t.requester.user);
    const second = await t.app.request(
      `/api/projects/${t.project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typeId: t.type.id, title: "Second item" }),
      },
    );
    expect(second.status, await second.clone().text()).toBe(200);
    const { key: key2 } = (await second.json()) as { key: string };
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "organisation" })
      .where(eq(schema.workItemTable.key, key2));
    const [item2] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key2));

    const approval1 = await createApproval(t);
    mockAuthenticatedSession(t.requester.user);
    const other = await t.app.request(`/api/work-items/${key2}/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transitionId: t.gated.id,
        kind: "cab",
        approverId: t.approverPerson.id,
      }),
    });
    expect(other.status, await other.clone().text()).toBe(200);
    const { id: approval2 } = (await other.json()) as { id: string };

    await setApproval(t, approval1.id);
    expect((await runTransition(t, t.done.id)).status).toBe(200);
    const [row2] = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, approval2));
    expect(row2?.workItemId).toBe(item2?.id);
    expect(row2?.state).toBe("pending");
    expect(row2?.decidedAt).toBeNull();
    // ...and it is still decidable.
    const decided = await decide(t, t.approver, approval2);
    expect(decided.status, await decided.clone().text()).toBe(200);
  });

  it("a new run needs new approvals", async () => {
    const t = await buildTenant("close-new", { executable: true });
    await setApproval(t, (await createApproval(t)).id);
    expect((await runTransition(t, t.done.id)).status).toBe(200);
    expect((await runTransition(t, t.backlog.id)).status).toBe(200);
    expect((await runTransition(t, t.done.id)).status).toBe(422);
    await setApproval(t, (await createApproval(t)).id);
    expect((await runTransition(t, t.done.id)).status).toBe(200);
  });

  it("an unrelated transition neither spends an approval nor closes approvals of another transition", async () => {
    const t = await buildTenant("unrelated", { executable: true });
    const gatedApproval = await createApproval(t);
    await setApproval(t, gatedApproval.id);
    const cab = await request(t, t.requester, { transitionId: t.cabOnly.id });
    const { id: cabApprovalId } = (await cab.json()) as { id: string };

    // An ungated edge out and back must not spend the approved approval...
    expect((await runTransition(t, t.wip.id)).status).toBe(200);
    expect((await runTransition(t, t.backlog.id)).status).toBe(200);
    // ...nor close the pending approval of a different (CAB) transition.
    expect(
      (await approvalRows(t.workItem.id)).find((r) => r.id === cabApprovalId)
        ?.state,
    ).toBe("pending");
    const run = await runTransition(t, t.done.id);
    expect(run.status, await run.clone().text()).toBe(200);
    // Running the gated edge closes nothing of the CAB transition either.
    expect(
      (await approvalRows(t.workItem.id)).find((r) => r.id === cabApprovalId)
        ?.state,
    ).toBe("pending");
  });

  it("the offers list shows the gated edge blocked again after consumption", async () => {
    const t = await buildTenant("offers", { executable: true });
    const offer = async () => {
      mockAuthenticatedSession(t.requester.user);
      const response = await t.app.request(
        `/api/work-items/${t.key}/transitions`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const offers = (await response.json()) as {
        transitionId: string;
        available: boolean;
        blockedBy: { kind: string }[];
      }[];
      return offers.find((o) => o.transitionId === t.gated.id);
    };
    expect((await offer())?.available).toBe(false);
    await setApproval(t, (await createApproval(t)).id);
    expect((await offer())?.available).toBe(true);
    expect((await runTransition(t, t.done.id)).status).toBe(200);
    expect((await runTransition(t, t.backlog.id)).status).toBe(200);
    const after = await offer();
    expect(after?.available).toBe(false);
    expect(after?.blockedBy.map((b) => b.kind)).toContain("approval");
  });
});

describe("approvals: single use is ordered by the database clock", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an approval request that waits behind a lock holder is not born spent (lock-wait race)", async () => {
    const t = await buildTenant("race", { executable: true });
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from work_item where id = ${t.workItem.id} for update`,
      );
      locked();
      await hold;
      // A run of the gated transition commits while the request is still waiting.
      await tx.insert(schema.activityTable).values({
        workspaceId: t.workspaceId,
        workItemId: t.workItem.id,
        actorType: "system",
        verb: "transitioned",
        payload: { transitionId: t.gated.id },
        visibility: "public",
        createdAt: dbClockUtc(),
      });
    });
    await isLocked;
    const pending = request(t, t.requester);
    await new Promise((resolve) => setTimeout(resolve, 600));
    release();
    await holder;
    const created = await pending;
    expect(created.status, await created.clone().text()).toBe(200);
    const { id } = (await created.json()) as { id: string };
    await setApproval(t, id);
    const run = await runTransition(t, t.done.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });

  it("an API host whose clock runs ahead cannot make approvals reusable", async () => {
    const t = await buildTenant("skew-ahead", { executable: true });
    // The request is served by a host whose application clock is 5 minutes ahead.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 5 * 60_000 });
    const approval = await createApproval(t);
    vi.useRealTimers();
    await setApproval(t, approval.id);
    expect((await runTransition(t, t.done.id)).status).toBe(200);
    expect((await runTransition(t, t.backlog.id)).status).toBe(200);
    // The approval was spent by the run: it cannot be reused despite the skew.
    expect((await runTransition(t, t.done.id)).status).toBe(422);
  });

  it("an API host whose clock runs ahead cannot pre-spend approvals raised afterwards", async () => {
    const t = await buildTenant("skew-run", { executable: true });
    await setApproval(t, (await createApproval(t)).id);
    // The transition is served by a host whose clock is 5 minutes ahead.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 5 * 60_000 });
    expect((await runTransition(t, t.done.id)).status).toBe(200);
    expect((await runTransition(t, t.backlog.id)).status).toBe(200);
    vi.useRealTimers();
    // An approval raised and approved afterwards must still count.
    await setApproval(t, (await createApproval(t)).id);
    const run = await runTransition(t, t.done.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });
});

describe("approvals: scoping, sessions and notification rows", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("/me/approvals excludes approvals the caller only requested, and /portal/approvals lists only addressed customer approvals", async () => {
    const t = await buildTenant("lists");
    const customer = await addCustomer(t);
    await createApproval(t); // staff approver
    const forCustomer = await request(t, t.requester, {
      kind: "customer",
      approverId: customer.person.id,
    });
    expect(forCustomer.status).toBe(200);

    mockAuthenticatedSession(t.requester.user);
    const mine = await t.app.request("/api/me/approvals");
    expect(((await mine.json()) as { approvals: unknown[] }).approvals).toEqual(
      [],
    );
    mockAuthenticatedSession(t.approver.user);
    const approver = await t.app.request("/api/me/approvals");
    expect(
      ((await approver.json()) as { approvals: unknown[] }).approvals,
    ).toHaveLength(1);
    const portal = await portalRequest(t, customer, "/api/portal/approvals");
    expect(
      ((await portal.json()) as { approvals: unknown[] }).approvals,
    ).toHaveLength(1);
  });

  it("a customer reading a work item's approvals sees only the ones addressed to them", async () => {
    const t = await buildTenant("own-rows");
    const customer = await addCustomer(t);
    const other = await addCustomer(t);
    await createApproval(t); // addressed to the staff approver
    await request(t, t.requester, {
      kind: "customer",
      approverId: customer.person.id,
    });
    await request(t, t.requester, {
      kind: "customer",
      approverId: other.person.id,
    });
    mockAuthenticatedSession(customer.user);
    const response = await t.app.request(t.url);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      approvals: { approver: { id: string } }[];
    };
    expect(body.approvals.map((a) => a.approver.id)).toEqual([
      customer.person.id,
    ]);
  });

  it("a portal customer without approval:decide authority is refused", async () => {
    const t = await buildTenant("portal-nocap");
    const customer = await addCustomer(t);
    const identity = await resolveApprovalIdentityIfActive(customer.user.id);
    if (!identity) throw new Error("customer identity missing");
    const target = await loadApprovalTargetByKey(t.key);
    expect(hasPortalApprovalDecideCapability(identity, target)).toBe(true);
    const stripped = {
      ...identity,
      authority: identity.authority.map((grant) => ({
        ...grant,
        capabilities: grant.capabilities.filter((c) => c !== "approval:decide"),
      })),
    };
    expect(hasPortalApprovalDecideCapability(stripped, target)).toBe(false);
  });

  it("an inactive identity is refused with 403 on every /approvals/{id}/* route", async () => {
    const t = await buildTenant("inactive");
    const { id } = await createApproval(t);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, t.approverPerson.id));
    expect((await decide(t, t.approver, id)).status).toBe(403);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, t.requesterPerson.id));
    expect((await withdrawAs(t, t.requester, id)).status).toBe(403);
    mockAuthenticatedSession(t.requester.user);
    expect((await t.app.request(t.url)).status).toBe(403);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("pending");
  });

  it("no inbox row is written for a customer approver or requester", async () => {
    const t = await buildTenant("customer-rows");
    const customer = await addCustomer(t);
    const created = await request(t, t.requester, {
      kind: "customer",
      approverId: customer.person.id,
    });
    expect(created.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(
          and(
            eq(schema.notificationTable.userId, customer.user.id),
            eq(schema.notificationTable.resourceType, "approval"),
          ),
        ),
    ).toEqual([]);
    // A decision by the customer notifies the staff requester, never the customer.
    const decided = await portalRequest(
      t,
      customer,
      `/api/portal/approvals/${((await created.json()) as { id: string }).id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect(decided.status, await decided.clone().text()).toBe(200);
    const rows = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.resourceType, "approval"));
    expect(rows.every((r) => r.userId !== customer.user.id)).toBe(true);
    expect(rows.some((r) => r.userId === t.requester.user.id)).toBe(true);
  });
});
