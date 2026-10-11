/**
 * Approval notifications (S3 on S4): recipients are validated at fan-out, and the inbox read
 * paths (list, read, read-all, clear-all) apply current reach to `approval` rows. Real HTTP
 * and a real database.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  approvalRows,
  buildTenant,
  createApproval,
  withdrawAs,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

async function approvalInbox(userId: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.userId, userId),
        eq(schema.notificationTable.resourceType, "approval"),
      ),
    );
}

async function listIds(
  t: Awaited<ReturnType<typeof buildTenant>>,
  user: Parameters<typeof mockAuthenticatedSession>[0],
) {
  mockAuthenticatedSession(user);
  const response = await t.app.request("/api/notification");
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { id: string }[]).map((n) => n.id);
}

describe("approvals: notification fan-out and the inbox read predicate", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("writes an inbox row only for the validated approver, scoped to the approval's workspace", async () => {
    const t = await buildTenant("notify");
    await createApproval(t);
    const rows = await approvalInbox(t.approver.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.personId).toBe(t.approverPerson.id);
    expect(rows[0]?.kind).toBe("approval.requested");
    expect(await approvalInbox(t.requester.user.id)).toHaveLength(0);
  });

  it("no inbox row is written for an approver who stopped being a valid CAB member", async () => {
    const t = await buildTenant("notify-invalid");
    const { id } = await createApproval(t);
    await db
      .delete(schema.teamMemberTable)
      .where(eq(schema.teamMemberTable.teamId, t.cabTeam.id));
    const response = await withdrawAs(t, t.requester, id);
    expect(response.status).toBe(200);
    const kinds = (await approvalInbox(t.approver.user.id)).map((r) => r.kind);
    expect(kinds).toEqual(["approval.requested"]);
  });

  it("the approver sees the row while reach holds, and it disappears from every read path when the work item is deleted", async () => {
    const t = await buildTenant("notify-read");
    await createApproval(t);
    const [row] = await approvalInbox(t.approver.user.id);
    expect(await listIds(t, t.approver.user)).toContain(row?.id);

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, t.workItem.id));
    expect(await listIds(t, t.approver.user)).not.toContain(row?.id);

    mockAuthenticatedSession(t.approver.user);
    const read = await t.app.request(`/api/notification/${row?.id}/read`, {
      method: "PATCH",
    });
    expect(read.status).toBe(404);
    const readAll = await t.app.request("/api/notification/read-all", {
      method: "PATCH",
    });
    expect(readAll.status).toBe(200);
    const clearAll = await t.app.request("/api/notification/clear-all", {
      method: "DELETE",
    });
    expect(clearAll.status).toBe(200);
    const [after] = await approvalInbox(t.approver.user.id);
    expect(after?.id).toBe(row?.id);
    expect(after?.isRead).toBe(false);
  });

  it("a row the approver can still reach is readable, marked by read-all and cleared by clear-all", async () => {
    const t = await buildTenant("notify-ok");
    await createApproval(t);
    const [row] = await approvalInbox(t.approver.user.id);
    mockAuthenticatedSession(t.approver.user);
    const read = await t.app.request(`/api/notification/${row?.id}/read`, {
      method: "PATCH",
    });
    expect(read.status, await read.clone().text()).toBe(200);
    const clear = await t.app.request("/api/notification/clear-all", {
      method: "DELETE",
    });
    expect(clear.status).toBe(200);
    expect(await approvalInbox(t.approver.user.id)).toHaveLength(0);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("pending");
  });

  it("an approval row whose recipient is no longer the approver is hidden", async () => {
    const t = await buildTenant("notify-recipient");
    await createApproval(t);
    const [row] = await approvalInbox(t.approver.user.id);
    // The inbox row belongs to the approver; re-address the approval to someone else.
    await db
      .update(schema.approvalTable)
      .set({ approverId: t.requesterPerson.id })
      .where(eq(schema.approvalTable.workItemId, t.workItem.id));
    expect(await listIds(t, t.approver.user)).not.toContain(row?.id);
  });
});
