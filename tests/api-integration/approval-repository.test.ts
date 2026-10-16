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
import {
  addCustomer,
  buildTenant,
  createApproval,
} from "./helpers/approval-fixtures";
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
      .set({
        customerVisibility: "private",
        requesterId: tenant.requesterPerson.id,
      })
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

    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, tenant.approverPerson.id));
    const currentApprover = await resolveApprovalIdentity(
      tenant.approver.user.id,
    );

    await expect(
      loadApprovalTargetByKey(currentApprover, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
    const ownTarget = await loadApprovalTargetByApprovalId(
      approval.id,
      currentApprover,
    );
    expect(ownTarget?.workItemId).toBe(tenant.workItem.id);
    expect(
      ownTarget && (await hasWorkItemReach(currentApprover, ownTarget)),
    ).toBe(false);
    const ownRows = await listApprovalRows(
      currentApprover,
      tenant.workItem.id,
      tenant.workspaceId,
    );
    expect(ownRows.map(({ id }) => id)).toEqual([approval.id]);
  });

  it("keeps private items with no requester closed except to exact participants, including own-approval metadata", async () => {
    const tenant = await buildTenant("repo-private-null-requester");
    const approval = await createApproval(tenant);
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "private", requesterId: null })
      .where(eq(schema.workItemTable.id, tenant.workItem.id));
    const requester = await resolveApprovalIdentity(tenant.requester.user.id);
    const approver = await resolveApprovalIdentity(tenant.approver.user.id);

    await expect(
      loadApprovalTargetByKey(requester, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      loadApprovalTargetByKey(approver, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
    const ownWithoutParticipation = await loadApprovalTargetByApprovalId(
      approval.id,
      approver,
    );
    expect(ownWithoutParticipation?.workItemId).toBe(tenant.workItem.id);
    expect(
      ownWithoutParticipation &&
        (await hasWorkItemReach(approver, ownWithoutParticipation)),
    ).toBe(false);

    await db.insert(schema.requestParticipantTable).values({
      workItemId: tenant.workItem.id,
      personId: tenant.approverPerson.id,
      addedBy: tenant.requesterPerson.id,
    });
    expect(
      (await loadApprovalTargetByKey(approver, tenant.key)).workItemId,
    ).toBe(tenant.workItem.id);
    const ownWithParticipation = await loadApprovalTargetByApprovalId(
      approval.id,
      approver,
    );
    expect(
      ownWithParticipation &&
        (await hasWorkItemReach(approver, ownWithParticipation)),
    ).toBe(true);

    await db
      .delete(schema.requestParticipantTable)
      .where(eq(schema.requestParticipantTable.workItemId, tenant.workItem.id));
    const currentApprover = await resolveApprovalIdentity(
      tenant.approver.user.id,
    );
    await expect(
      loadApprovalTargetByKey(currentApprover, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
    const ownAfterParticipationLoss = await loadApprovalTargetByApprovalId(
      approval.id,
      currentApprover,
    );
    expect(ownAfterParticipationLoss?.workItemId).toBe(tenant.workItem.id);
    expect(
      ownAfterParticipationLoss &&
        (await hasWorkItemReach(currentApprover, ownAfterParticipationLoss)),
    ).toBe(false);
  });

  it("uses the project's customer organisation, not the workspace anchor, for customer reach", async () => {
    const tenant = await buildTenant("repo-project-organisation");
    const customer = await addCustomer(tenant);
    const customerIdentity = await resolveApprovalIdentity(customer.user.id);

    expect(
      (await loadApprovalTargetByKey(customerIdentity, tenant.key))
        .organisationId,
    ).toBe(customer.orgId);
    await db
      .update(schema.projectTable)
      .set({ organisationId: null })
      .where(eq(schema.projectTable.id, tenant.project.id));
    await expect(
      loadApprovalTargetByKey(customerIdentity, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
  });
});
