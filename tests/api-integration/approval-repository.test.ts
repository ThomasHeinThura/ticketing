import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  closePendingApprovalsForTransition,
  deleteApprovalNotifications,
  expirePendingApproval,
  findPersonIdByUserId,
  findWorkspaceOrganisationId,
  markApprovalReminderSent,
  recordApprovalDecision,
  recordApprovalWithdrawal,
} from "../../apps/api/src/approval/repository";
import db, { schema } from "../../apps/api/src/database";
import { buildTenant, createApproval } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";

async function stateOf(id: string) {
  const [row] = await db
    .select()
    .from(schema.approvalTable)
    .where(eq(schema.approvalTable.id, id));
  return row;
}

/**
 * Issue #580: every approval write keeps its workspace and still-pending predicates in the
 * statement itself, so a controller that passes the wrong workspace (or a stale row) cannot
 * decide, withdraw, expire, remind or close another tenant's approval.
 */
describe("approval repository writes (#580)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("decision, withdrawal, expiry and reminder are scoped to the approval's workspace and to pending", async () => {
    const t = await buildTenant("repo-a");
    const other = await buildTenant("repo-b");
    const a = await createApproval(t);
    const b = await createApproval(t);
    const c = await createApproval(t);
    const d = await createApproval(t);
    const now = new Date();

    await db.transaction(async (tx) => {
      // wrong workspace: no row matches
      expect(
        await recordApprovalDecision(tx, {
          id: a.id,
          workspaceId: other.workspaceId,
          state: "approved",
          decidedAt: now,
          decisionNote: null,
        }),
      ).toBeUndefined();
      expect(
        await recordApprovalWithdrawal(tx, {
          id: a.id,
          workspaceId: other.workspaceId,
          decidedAt: now,
        }),
      ).toBeUndefined();
      expect(
        await expirePendingApproval(tx, {
          id: a.id,
          workspaceId: other.workspaceId,
          decidedAt: now,
        }),
      ).toBeUndefined();
      expect(
        await markApprovalReminderSent(tx, {
          id: a.id,
          workspaceId: other.workspaceId,
          reminder: "reminder_50",
          sentAt: now,
        }),
      ).toBeUndefined();
    });
    expect((await stateOf(a.id))?.state).toBe("pending");
    expect((await stateOf(a.id))?.reminder50SentAt).toBeNull();

    await db.transaction(async (tx) => {
      const decided = await recordApprovalDecision(tx, {
        id: a.id,
        workspaceId: t.workspaceId,
        state: "rejected",
        decidedAt: now,
        decisionNote: "no",
      });
      expect(decided).toMatchObject({ state: "rejected", decisionNote: "no" });
      // a decided approval is no longer pending: every later write loses
      expect(
        await recordApprovalDecision(tx, {
          id: a.id,
          workspaceId: t.workspaceId,
          state: "approved",
          decidedAt: now,
          decisionNote: null,
        }),
      ).toBeUndefined();
      expect(
        await recordApprovalWithdrawal(tx, {
          id: a.id,
          workspaceId: t.workspaceId,
          decidedAt: now,
        }),
      ).toBeUndefined();
      expect(
        await expirePendingApproval(tx, {
          id: a.id,
          workspaceId: t.workspaceId,
          decidedAt: now,
        }),
      ).toBeUndefined();
      expect(
        await markApprovalReminderSent(tx, {
          id: a.id,
          workspaceId: t.workspaceId,
          reminder: "reminder_90",
          sentAt: now,
        }),
      ).toBeUndefined();

      expect(
        await recordApprovalWithdrawal(tx, {
          id: b.id,
          workspaceId: t.workspaceId,
          decidedAt: now,
        }),
      ).toMatchObject({ state: "withdrawn" });
      expect(
        await expirePendingApproval(tx, {
          id: c.id,
          workspaceId: t.workspaceId,
          decidedAt: now,
        }),
      ).toEqual({ id: c.id });
      expect(
        await markApprovalReminderSent(tx, {
          id: d.id,
          workspaceId: t.workspaceId,
          reminder: "reminder_90",
          sentAt: now,
        }),
      ).toEqual({ id: d.id });
    });
    expect((await stateOf(a.id))?.state).toBe("rejected");
    expect((await stateOf(b.id))?.state).toBe("withdrawn");
    expect((await stateOf(c.id))?.state).toBe("expired");
    const reminded = await stateOf(d.id);
    expect(reminded?.state).toBe("pending");
    expect(reminded?.reminder90SentAt).not.toBeNull();
    expect(reminded?.reminder50SentAt).toBeNull();
  });

  it("closing for a transition only touches pending rows of that workspace, work item and transition", async () => {
    const t = await buildTenant("repo-close-a");
    const other = await buildTenant("repo-close-b");
    const pending = await createApproval(t);
    const already = await createApproval(t);
    await db
      .update(schema.approvalTable)
      .set({ state: "approved" })
      .where(eq(schema.approvalTable.id, already.id));
    const foreign = await createApproval(other);
    // A second work item in the same workspace with its own pending approval for the same
    // transition: only the work-item predicate separates it from the one being closed.
    const [sibling] = await db
      .insert(schema.workItemTable)
      .values({
        ...t.workItem,
        id: `wi-sibling-${t.workItem.id}`,
        key: `${t.workItem.key}-S`,
        number: t.workItem.number + 1000,
      })
      .returning();
    const [pendingRow] = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, pending.id));
    const [siblingApproval] = await db
      .insert(schema.approvalTable)
      .values({
        ...(pendingRow as typeof schema.approvalTable.$inferInsert),
        id: `appr-sibling-${pending.id}`,
        workItemId: sibling?.id ?? "",
      })
      .returning();

    const wrongTransition = await db.transaction((tx) =>
      closePendingApprovalsForTransition(tx, {
        workspaceId: t.workspaceId,
        workItemId: t.workItem.id,
        transitionId: t.ungated.id,
      }),
    );
    expect(wrongTransition).toEqual([]);
    const wrongWorkspace = await db.transaction((tx) =>
      closePendingApprovalsForTransition(tx, {
        workspaceId: other.workspaceId,
        workItemId: t.workItem.id,
        transitionId: t.gated.id,
      }),
    );
    expect(wrongWorkspace).toEqual([]);
    expect((await stateOf(pending.id))?.state).toBe("pending");

    const closed = await db.transaction((tx) =>
      closePendingApprovalsForTransition(tx, {
        workspaceId: t.workspaceId,
        workItemId: t.workItem.id,
        transitionId: t.gated.id,
      }),
    );
    expect(closed.map((row) => row.id)).toEqual([pending.id]);
    expect((await stateOf(pending.id))?.state).toBe("expired");
    expect((await stateOf(pending.id))?.decidedAt).not.toBeNull();
    // the already-approved row and the other tenant's pending row are untouched
    expect((await stateOf(already.id))?.state).toBe("approved");
    expect((await stateOf(foreign.id))?.state).toBe("pending");
    expect((await stateOf(siblingApproval?.id ?? ""))?.state).toBe("pending");
  });

  it("inbox deletion removes only approval rows of the named approvals; lookups resolve person and organisation", async () => {
    const t = await buildTenant("repo-inbox");
    const keep = await createApproval(t);
    const drop = await createApproval(t);
    const before = await db.select().from(schema.notificationTable);
    const forDrop = before.filter((row) => row.resourceId === drop.id);
    const forKeep = before.filter((row) => row.resourceId === keep.id);
    expect(forDrop.length).toBeGreaterThan(0);
    expect(forKeep.length).toBeGreaterThan(0);

    await db.transaction((tx) => deleteApprovalNotifications(tx, [drop.id]));
    const after = await db.select().from(schema.notificationTable);
    expect(after.some((row) => row.resourceId === drop.id)).toBe(false);
    expect(after.filter((row) => row.resourceId === keep.id)).toHaveLength(
      forKeep.length,
    );

    await db.transaction(async (tx) => {
      expect((await findPersonIdByUserId(tx, t.requester.user.id))?.id).toBe(
        t.requesterPerson.id,
      );
      expect(await findPersonIdByUserId(tx, "no-such-user")).toBeUndefined();
      expect(
        (await findWorkspaceOrganisationId(tx, t.workspaceId))?.organisationId,
      ).toBeTruthy();
      expect(await findWorkspaceOrganisationId(tx, "missing")).toBeUndefined();
    });
  });
});
