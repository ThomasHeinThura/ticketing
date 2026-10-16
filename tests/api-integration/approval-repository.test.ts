import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  hasWorkItemReach,
  listApprovalRows,
  loadApprovalTargetByApprovalId,
  loadApprovalTargetByKey,
  resolveApprovalIdentity,
} from "../../apps/api/src/approval/repository";
import db, { schema } from "../../apps/api/src/database";
import { buildTenant, createApproval } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";

describe("approval repository current request scope", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("requires current project reach and exact private requester/participant reach in the target statement", async () => {
    const tenant = await buildTenant("repo-current-scope");
    const requester = await resolveApprovalIdentity(tenant.requester.user.id);
    const approver = await resolveApprovalIdentity(tenant.approver.user.id);

    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "private" })
      .where(eq(schema.workItemTable.id, tenant.workItem.id));

    await expect(
      loadApprovalTargetByKey(approver, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
    const [participant] = await db
      .insert(schema.requestParticipantTable)
      .values({
        workItemId: tenant.workItem.id,
        personId: tenant.approverPerson.id,
        addedBy: tenant.requesterPerson.id,
      })
      .returning();
    expect(participant).toBeDefined();
    expect(
      (await loadApprovalTargetByKey(approver, tenant.key)).workItemId,
    ).toBe(tenant.workItem.id);
    expect(
      (await loadApprovalTargetByKey(requester, tenant.key)).workItemId,
    ).toBe(tenant.workItem.id);
  });

  it("keeps only the caller's own approval metadata after reach loss and refuses generic target access", async () => {
    const tenant = await buildTenant("repo-lost-reach");
    const approval = await createApproval(tenant);
    const approver = await resolveApprovalIdentity(tenant.approver.user.id);

    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, tenant.approverPerson.id));

    await expect(
      loadApprovalTargetByKey(approver, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
    const ownTarget = await loadApprovalTargetByApprovalId(
      approval.id,
      approver,
    );
    expect(ownTarget?.workItemId).toBe(tenant.workItem.id);
    expect(ownTarget && (await hasWorkItemReach(approver, ownTarget))).toBe(
      false,
    );
    const ownRows = await listApprovalRows(
      approver,
      tenant.workItem.id,
      tenant.workspaceId,
    );
    expect(ownRows.map(({ id }) => id)).toEqual([approval.id]);
  });
});
