/**
 * Gate and request semantics for approvals (S3): the owner decisions of 2026-10-10 (approvals
 * are single use; withdrawn approvals are ignored), `requires_cab`, request-time validation,
 * soft-deleted items, the blocked-transition explanation (AP-17) and the response shape.
 * Every case drives the real HTTP app and the real database.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { scanApprovalReminders } from "../../apps/api/src/approval/reminder-scan";
import db, { schema } from "../../apps/api/src/database";
import {
  addCustomer,
  approvalRows,
  buildTenant,
  createApproval,
  decide,
  request,
  runTransition,
  setApproval,
  withdrawAs,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

describe("approvals: gate semantics (owner decisions 2026-10-10)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("an approved approval is consumed by the transition it unlocked; repeating the transition needs a new approval", async () => {
    const t = await buildTenant("single-use", { executable: true });
    const first = await createApproval(t);
    await setApproval(t, first.id);

    const run1 = await runTransition(t, t.done.id);
    expect(run1.status, await run1.clone().text()).toBe(200);
    // Return to the original state through an ungated edge.
    const back = await runTransition(t, t.backlog.id);
    expect(back.status, await back.clone().text()).toBe(200);

    // The old approval is spent: the same gated edge is blocked again.
    const run2 = await runTransition(t, t.done.id);
    expect(run2.status).toBe(422);
    expect(
      ((await run2.json()) as { blockedBy: { kind: string }[] }).blockedBy.map(
        (b) => b.kind,
      ),
    ).toContain("approval");

    // A new approval unlocks it once more.
    const second = await createApproval(t);
    await setApproval(t, second.id);
    const run3 = await runTransition(t, t.done.id);
    expect(run3.status, await run3.clone().text()).toBe(200);
  });

  it("a withdrawn approval is ignored: it cannot block an `all` gate and cannot satisfy a gate", async () => {
    const t = await buildTenant("withdrawn", { executable: true });
    await db
      .update(schema.workflowTransitionTable)
      .set({ approvalPolicy: "all" })
      .where(eq(schema.workflowTransitionTable.id, t.gated.id));

    const withdrawnOne = await createApproval(t);
    const w = await withdrawAs(t, t.requester, withdrawnOne.id);
    expect(w.status).toBe(200);
    // Only a withdrawn approval exists: the gate is not satisfied.
    const blocked = await runTransition(t, t.done.id);
    expect(blocked.status).toBe(422);

    // A second approval is approved: the withdrawn one must not keep the `all` gate shut.
    const second = await createApproval(t);
    await setApproval(t, second.id);
    const run = await runTransition(t, t.done.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });

  it("an expired approval is ignored as well", async () => {
    const t = await buildTenant("expired", { executable: true });
    await db
      .update(schema.workflowTransitionTable)
      .set({ approvalPolicy: "all" })
      .where(eq(schema.workflowTransitionTable.id, t.gated.id));
    const stale = await createApproval(t);
    await db
      .update(schema.approvalTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.approvalTable.id, stale.id));
    await scanApprovalReminders();
    const fresh = await createApproval(t);
    await setApproval(t, fresh.id);
    const run = await runTransition(t, t.done.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });

  it("a pending approval still blocks, and the block explains who is being waited on (AP-17)", async () => {
    const t = await buildTenant("explain", { executable: true });
    await db
      .update(schema.personTable)
      .set({ displayName: "Ada Approver" })
      .where(eq(schema.personTable.id, t.approverPerson.id));
    await createApproval(t);
    const blocked = await runTransition(t, t.done.id);
    expect(blocked.status).toBe(422);
    const body = (await blocked.json()) as {
      blockedBy: {
        kind: string;
        pendingApprovals?: {
          approverName: string | null;
          requestedAt: string;
          expiresAt: string;
        }[];
      }[];
    };
    const gate = body.blockedBy.find((b) => b.kind === "approval");
    expect(gate?.pendingApprovals).toHaveLength(1);
    expect(gate?.pendingApprovals?.[0]?.approverName).toBe("Ada Approver");
    expect(
      Number.isNaN(Date.parse(gate?.pendingApprovals?.[0]?.expiresAt ?? "")),
    ).toBe(false);
    expect(
      Number.isNaN(Date.parse(gate?.pendingApprovals?.[0]?.requestedAt ?? "")),
    ).toBe(false);
  });

  it("a requires_cab-only transition is requestable, stays blocked until a CAB approval, then runs", async () => {
    const t = await buildTenant("cab-only", { executable: true });
    const blocked = await runTransition(t, t.review.id);
    expect(blocked.status).toBe(422);
    expect(
      ((await blocked.json()) as { blockedBy: { kind: string }[] }).blockedBy
        .map((b) => b.kind)
        .includes("cab"),
    ).toBe(true);

    const approval = await request(t, t.requester, {
      transitionId: t.cabOnly.id,
    });
    expect(approval.status, await approval.clone().text()).toBe(200);
    const { id } = (await approval.json()) as { id: string };
    const stillBlocked = await runTransition(t, t.review.id);
    expect(stillBlocked.status).toBe(422);

    await setApproval(t, id);
    const run = await runTransition(t, t.review.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });

  it("a transition of a sibling workflow in the same workspace is refused", async () => {
    const t = await buildTenant("sibling");
    const response = await request(t, t.requester, {
      transitionId: t.siblingGated.id,
    });
    expect(response.status, await response.clone().text()).toBe(422);
    expect(await approvalRows(t.workItem.id)).toHaveLength(0);
  });
});

describe("approvals: request-time and read-time validation", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("the approver's reach on the work item is checked when the request is made", async () => {
    const t = await buildTenant("reach");
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "private" })
      .where(eq(schema.workItemTable.id, t.workItem.id));
    await db.insert(schema.requestParticipantTable).values({
      workItemId: t.workItem.id,
      personId: t.requesterPerson.id,
      addedBy: t.requesterPerson.id,
      createdAt: new Date(),
    });
    // The approver is a CAB member with every capability but cannot see this private item.
    const response = await request(t, t.requester);
    expect(response.status, await response.clone().text()).toBe(422);
    expect(await approvalRows(t.workItem.id)).toHaveLength(0);
  });

  it("the approver must have the right side and an account", async () => {
    const t = await buildTenant("side");
    // A customer approval addressed to a staff person.
    const staffForCustomer = await request(t, t.requester, {
      kind: "customer",
    });
    expect(staffForCustomer.status, await staffForCustomer.clone().text()).toBe(
      422,
    );
    // A CAB approval addressed to a customer person.
    const customer = await addCustomer(t);
    const customerForCab = await request(t, t.requester, {
      kind: "cab",
      approverId: customer.person.id,
    });
    expect(customerForCab.status, await customerForCab.clone().text()).toBe(
      422,
    );
    // A staff person without an account.
    const approverRow = requireRow(
      await db
        .select({ organisationId: schema.personTable.organisationId })
        .from(schema.personTable)
        .where(eq(schema.personTable.id, t.approverPerson.id))
        .limit(1),
      "approver person",
    );
    const [accountless] = await db
      .insert(schema.personTable)
      .values({
        userId: null,
        organisationId: approverRow.organisationId,
        side: "staff",
        active: true,
        isPlaceholder: false,
      })
      .returning({ id: schema.personTable.id });
    const noAccount = await request(t, t.requester, {
      approverId: accountless?.id ?? "",
    });
    expect(noAccount.status, await noAccount.clone().text()).toBe(422);
    expect(await approvalRows(t.workItem.id)).toHaveLength(0);
  });

  it("a customer session cannot request a CAB approval", async () => {
    const t = await buildTenant("customer-cab");
    const customer = await addCustomer(t);
    const response = await request(t, customer, { kind: "cab" });
    expect(response.status, await response.clone().text()).toBe(403);
    expect(await approvalRows(t.workItem.id)).toHaveLength(0);
  });

  it("a second CAB member who holds approval:decide but is not the named approver cannot decide", async () => {
    const t = await buildTenant("not-named");
    const approval = await createApproval(t);
    const other = await createWorkspaceMember({ role: "owner" });
    const now = new Date();
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: t.workspaceId,
      userId: other.user.id,
      role: "owner",
      joinedAt: now,
    });
    await grantProjectRole(other.user.id, t.project.id, [
      "project:read",
      "work_item:read",
      "approval:decide",
      "approval:decide_cab",
    ]);
    await db.insert(schema.teamMemberTable).values({
      id: `cabm-${randomUUID()}`,
      teamId: t.cabTeam.id,
      userId: other.user.id,
      createdAt: now,
    });
    const response = await decide(t, other, approval.id);
    expect(response.status, await response.clone().text()).toBe(403);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("pending");
  });

  it("project-level flag: enabling one project does not enable a sibling project", async () => {
    const t = await buildTenant("project-flag");
    await db
      .delete(schema.workspaceFeatureFlagTable)
      .where(eq(schema.workspaceFeatureFlagTable.workspaceId, t.workspaceId));
    const { project: other } = await createProjectFixture({
      workspaceId: t.workspaceId,
    });
    await grantProjectRole(t.requester.user.id, other.id, [
      "project:read",
      "work_item:read",
      "work_item:create",
      "approval:request",
      "approval:request_cab",
    ]);
    const [state] = await db
      .insert(schema.stateTable)
      .values({
        projectId: other.id,
        stateTemplateId: t.backlog.id,
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    expect(state).toBeDefined();
    mockAuthenticatedSession(t.requester.user);
    const created = await t.app.request(
      `/api/projects/${other.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: t.type.id,
          title: "Other project item",
        }),
      },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const otherKey = ((await created.json()) as { key: string }).key;
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "organisation" })
      .where(eq(schema.workItemTable.key, otherKey));
    await grantProjectRole(t.approver.user.id, other.id, [
      "project:read",
      "work_item:read",
      "approval:decide_cab",
    ]);

    await db.insert(schema.projectFeatureFlagTable).values({
      projectId: t.project.id,
      featureKey: "feature.approvals",
      enabled: true,
    });
    const enabled = await request(t, t.requester);
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    mockAuthenticatedSession(t.requester.user);
    const sibling = await t.app.request(
      `/api/work-items/${otherKey}/approvals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transitionId: t.gated.id,
          kind: "cab",
          approverId: t.approverPerson.id,
        }),
      },
    );
    expect(sibling.status, await sibling.clone().text()).toBe(404);
  });

  it("a soft-deleted work item hides its approvals from decide, withdraw, list and the inbox", async () => {
    const t = await buildTenant("deleted");
    const approval = await createApproval(t);
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, t.workItem.id));

    expect((await decide(t, t.approver, approval.id)).status).toBe(404);
    expect((await withdrawAs(t, t.requester, approval.id)).status).toBe(404);
    mockAuthenticatedSession(t.requester.user);
    expect((await t.app.request(t.url)).status).toBe(404);
    mockAuthenticatedSession(t.approver.user);
    const inbox = await t.app.request("/api/me/approvals");
    expect(
      ((await inbox.json()) as { approvals: unknown[] }).approvals,
    ).toEqual([]);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("pending");
  });

  it("approval responses never contain an email address", async () => {
    const t = await buildTenant("no-email");
    const approval = await createApproval(t);
    const bodies: string[] = [];
    mockAuthenticatedSession(t.requester.user);
    bodies.push(await (await t.app.request(t.url)).text());
    mockAuthenticatedSession(t.approver.user);
    bodies.push(await (await t.app.request("/api/me/approvals")).text());
    const decided = await decide(t, t.approver, approval.id);
    bodies.push(await decided.text());
    const emails = [t.requester.user.email, t.approver.user.email];
    for (const body of bodies) {
      for (const email of emails) expect(body).not.toContain(email);
      expect(body).not.toMatch(/"email"/);
      expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });

  it("an instance-admin withdrawal is marked as such in the audit trail", async () => {
    const t = await buildTenant("admin-audit");
    const requesterWithdrawn = await createApproval(t);
    expect(
      (await withdrawAs(t, t.requester, requesterWithdrawn.id)).status,
    ).toBe(200);
    const adminWithdrawn = await createApproval(t);
    const admin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    mockAuthenticatedSession({ ...admin.user, role: "admin" });
    const response = await t.app.request(
      `/api/admin/approvals/${adminWithdrawn.id}/withdraw`,
      { method: "POST" },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "approval.withdrawn"));
    const after = (id: string) =>
      audit.find((row) => row.entityId === id)?.after as
        | { via?: string; onBehalfOfPersonId?: string }
        | undefined;
    expect(after(adminWithdrawn.id)?.via).toBe("admin_route");
    expect(after(adminWithdrawn.id)?.onBehalfOfPersonId).toBe(
      t.requesterPerson.id,
    );
    expect(after(requesterWithdrawn.id)?.via).toBeUndefined();
    expect(
      requireRow(
        await db
          .select()
          .from(schema.approvalTable)
          .where(
            and(
              eq(schema.approvalTable.id, adminWithdrawn.id),
              eq(schema.approvalTable.workspaceId, t.workspaceId),
            ),
          ),
        "withdrawn approval",
      ).state,
    ).toBe("withdrawn");
  });
});

describe("approvals: reminder scan locking", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("expires an approval even while another transaction row-locks its workspace (FOR UPDATE ... OF approval)", async () => {
    const t = await buildTenant("scan-lock");
    const { id } = await createApproval(t);
    await db
      .update(schema.approvalTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.approvalTable.id, id));

    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const locker = db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from workspace where id = ${t.workspaceId} for no key update`,
      );
      locked();
      await hold;
    });
    await isLocked;
    try {
      await scanApprovalReminders();
    } finally {
      release();
      await locker;
    }
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("expired");
  });
});
