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
  runTransition,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

describe("approval repository current request scope", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("requires current project reach and exact private requester/participant reach in the target statement", async () => {
    const tenant = await buildTenant("repo-current-scope");
    const requesterPerson = await addCustomer(tenant);
    const participantPerson = await addCustomer(tenant);
    const colleague = await addCustomer(tenant);
    const requester = await resolveApprovalIdentity(requesterPerson.user.id);
    const participantIdentity = await resolveApprovalIdentity(
      participantPerson.user.id,
    );
    const colleagueIdentity = await resolveApprovalIdentity(colleague.user.id);

    await db
      .update(schema.workItemTable)
      .set({
        customerVisibility: "private",
        requesterId: requesterPerson.person.id,
      })
      .where(eq(schema.workItemTable.id, tenant.workItem.id));

    await expect(
      loadApprovalTargetByKey(colleagueIdentity, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
    const [participant] = await db
      .insert(schema.requestParticipantTable)
      .values({
        workItemId: tenant.workItem.id,
        personId: participantPerson.person.id,
        addedBy: requesterPerson.person.id,
      })
      .returning();
    expect(participant).toBeDefined();
    expect(
      (await loadApprovalTargetByKey(participantIdentity, tenant.key))
        .workItemId,
    ).toBe(tenant.workItem.id);
    expect(
      (await loadApprovalTargetByKey(requester, tenant.key)).workItemId,
    ).toBe(tenant.workItem.id);
  });

  it("lets reachable staff read and request approval on a private customer request without staff participation", async () => {
    const tenant = await buildTenant("repo-private-staff-approval", {
      executable: true,
    });
    const customerRequester = await addCustomer(tenant);
    const customerApprover = await addCustomer(tenant);
    await db
      .update(schema.workItemTable)
      .set({
        customerVisibility: "private",
        requesterId: customerRequester.person.id,
      })
      .where(eq(schema.workItemTable.id, tenant.workItem.id));
    await db.insert(schema.requestParticipantTable).values({
      workItemId: tenant.workItem.id,
      personId: customerApprover.person.id,
      addedBy: customerRequester.person.id,
    });
    await db.insert(schema.projectFeatureFlagTable).values({
      projectId: tenant.project.id,
      featureKey: "feature.approvals",
      enabled: true,
    });

    mockAuthenticatedSession(tenant.requester.user);
    const listed = await tenant.app.request(tenant.url);
    expect(listed.status, await listed.clone().text()).toBe(200);
    const blockedBeforeRequest = await runTransition(tenant, tenant.done.id);
    expect(blockedBeforeRequest.status).toBe(422);
    expect(
      (
        (await blockedBeforeRequest.json()) as {
          blockedBy: { kind: string }[];
        }
      ).blockedBy.map(({ kind }) => kind),
    ).toContain("approval");
    const created = await tenant.app.request(tenant.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transitionId: tenant.gated.id,
        kind: "customer",
        approverId: customerApprover.person.id,
      }),
    });
    expect(created.status, await created.clone().text()).toBe(200);
    expect(await created.json()).toEqual(
      expect.objectContaining({ state: "pending" }),
    );
    const stillBlocked = await runTransition(tenant, tenant.done.id);
    expect(stillBlocked.status).toBe(422);
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

  it("keeps staff approval metadata after project-reach loss and customer private items closed without a requester", async () => {
    const tenant = await buildTenant("repo-private-null-requester");
    const approval = await createApproval(tenant);
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "private", requesterId: null })
      .where(eq(schema.workItemTable.id, tenant.workItem.id));
    const approver = await resolveApprovalIdentity(tenant.approver.user.id);
    const participantPerson = await addCustomer(tenant);
    const colleague = await addCustomer(tenant);
    const participantIdentity = await resolveApprovalIdentity(
      participantPerson.user.id,
    );
    const colleagueIdentity = await resolveApprovalIdentity(colleague.user.id);

    expect(
      (await loadApprovalTargetByKey(approver, tenant.key)).workItemId,
    ).toBe(tenant.workItem.id);
    await expect(
      loadApprovalTargetByKey(colleagueIdentity, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
    const ownWithoutParticipation = await loadApprovalTargetByApprovalId(
      approval.id,
      approver,
    );
    expect(ownWithoutParticipation?.workItemId).toBe(tenant.workItem.id);
    expect(
      ownWithoutParticipation &&
        (await hasWorkItemReach(approver, ownWithoutParticipation)),
    ).toBe(true);

    await db.insert(schema.requestParticipantTable).values({
      workItemId: tenant.workItem.id,
      personId: participantPerson.person.id,
      addedBy: tenant.requesterPerson.id,
    });
    expect(
      (await loadApprovalTargetByKey(participantIdentity, tenant.key))
        .workItemId,
    ).toBe(tenant.workItem.id);
    await db
      .delete(schema.requestParticipantTable)
      .where(eq(schema.requestParticipantTable.workItemId, tenant.workItem.id));
    await expect(
      loadApprovalTargetByKey(colleagueIdentity, tenant.key),
    ).rejects.toMatchObject({ status: 404 });
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, tenant.approverPerson.id));
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
