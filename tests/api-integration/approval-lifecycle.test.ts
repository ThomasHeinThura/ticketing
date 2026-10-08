import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanApprovalReminders } from "../../apps/api/src/approval/reminder-scan";
import { auth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { isCurrentInstanceAdmin } from "../../apps/api/src/instance/observability/audit-failure-notifier";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createApprovalApiKey(
  userId: string,
  permissions: Record<string, string[]> | null,
): Promise<string> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "approval scope test key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions: permissions === null ? null : JSON.stringify(permissions),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

async function approvalEffectCounts(
  kind: "approval.decided" | "approval.withdrawn",
) {
  const [events, auditRows] = await Promise.all([
    db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, kind)),
    db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, kind)),
  ]);
  return { events: events.length, audit: auditRows.length };
}

describe("API integration: approval lifecycle", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db
      .delete(schema.instanceFeatureFlagTable)
      .where(
        eq(schema.instanceFeatureFlagTable.featureKey, "feature.approvals"),
      );
  });

  afterEach(async () => {
    await db
      .delete(schema.instanceFeatureFlagTable)
      .where(
        eq(schema.instanceFeatureFlagTable.featureKey, "feature.approvals"),
      );
  });

  it("commits the request with its event, inbox, and audit rows; keeps the workflow gate while disabled; and flags then denies a no-longer-reachable approver", async () => {
    const requester = await createWorkspaceMember({ role: "owner" });
    const requesterPerson = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, requester.user.id))
        .limit(1),
      "approval lifecycle requester person",
    );
    const { project } = await createProjectFixture({
      workspaceId: requester.workspace.id,
    });
    await grantProjectRole(requester.user.id, project.id, [
      "project:read",
      "work_item:read",
      "work_item:create",
      "work_item:transition",
      "approval:request_cab",
    ]);

    const now = new Date();
    const backlogTemplate = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: requester.workspace.id,
          key: `backlog-${randomUUID()}`,
          name: "Backlog",
          group: "backlog",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "approval lifecycle backlog template",
    );
    const doneTemplate = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: requester.workspace.id,
          key: `done-${randomUUID()}`,
          name: "Done",
          group: "completed",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "approval lifecycle done template",
    );
    const backlogState = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: backlogTemplate.id,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "approval lifecycle backlog state",
    );
    const doneState = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: doneTemplate.id,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "approval lifecycle done state",
    );

    const workflow = requireRow(
      await db
        .insert(schema.workflowTable)
        .values({
          workspaceId: requester.workspace.id,
          key: `approval-${randomUUID()}`,
          name: "Approval gated workflow",
        })
        .returning(),
      "approval lifecycle workflow",
    );
    const version = requireRow(
      await db
        .insert(schema.workflowVersionTable)
        .values({ workflowId: workflow.id, number: 1, publishedAt: now })
        .returning(),
      "approval lifecycle workflow version",
    );
    const transition = requireRow(
      await db
        .insert(schema.workflowTransitionTable)
        .values({
          versionId: version.id,
          fromStateTemplateId: backlogTemplate.id,
          toStateTemplateId: doneTemplate.id,
          requiresApproval: true,
          approvalPolicy: "any",
          notePolicy: "none",
          noteVisibility: "internal",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "approval lifecycle transition",
    );
    await db
      .update(schema.workflowTable)
      .set({ activeVersionId: version.id })
      .where(eq(schema.workflowTable.id, workflow.id));

    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: requester.workspace.id,
          key: `approval-type-${randomUUID()}`,
          name: "Approval ticket",
          category: "service",
          workflowId: workflow.id,
          isChange: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "approval lifecycle work item type",
    );

    const approver = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: requester.workspace.id,
      userId: approver.user.id,
      role: "owner",
      joinedAt: now,
    });
    await grantProjectRole(approver.user.id, project.id, [
      "project:read",
      "work_item:read",
      "approval:decide_cab",
    ]);
    const approverPerson = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, approver.user.id))
        .limit(1),
      "approval lifecycle approver person",
    );
    const cabTeam = requireRow(
      await db
        .insert(schema.teamTable)
        .values({
          id: `approval-cab-${randomUUID()}`,
          name: "Approval CAB",
          workspaceId: requester.workspace.id,
          isCab: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "approval lifecycle CAB team",
    );
    const cabMember = requireRow(
      await db
        .insert(schema.teamMemberTable)
        .values({
          id: `approval-cab-member-${randomUUID()}`,
          teamId: cabTeam.id,
          userId: approver.user.id,
          createdAt: now,
        })
        .returning(),
      "approval lifecycle CAB membership",
    );

    const { app } = createApp();
    mockAuthenticatedSession(requester.user);
    const createdWorkItem = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typeId: type.id, title: "Needs approval" }),
      },
    );
    expect(createdWorkItem.status).toBe(200);
    const workItem = (await createdWorkItem.json()) as { key: string };
    const [workItemRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, workItem.key));
    expect(workItemRow?.stateId).toBe(backlogState.id);
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "private" })
      .where(eq(schema.workItemTable.key, workItem.key));

    // Private visibility limits customer colleagues to the requester and explicitly
    // added participants; it does not override staff project reach (CP-16 / RBAC § Reach).
    const staffViewer = await createWorkspaceMember({ role: "member" });
    await grantProjectRole(staffViewer.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    mockAuthenticatedSession(staffViewer.user);
    const staffPrivateItemApprovals = await app.request(
      `/api/work-items/${workItem.key}/approvals`,
    );
    expect(
      staffPrivateItemApprovals.status,
      await staffPrivateItemApprovals.clone().text(),
    ).toBe(200);

    await db.insert(schema.requestParticipantTable).values([
      {
        workItemId: workItemRow?.id ?? "",
        personId: approverPerson.id,
        addedBy: requesterPerson.id,
        createdAt: now,
      },
      {
        workItemId: workItemRow?.id ?? "",
        personId: requesterPerson.id,
        addedBy: requesterPerson.id,
        createdAt: now,
      },
    ]);
    const requestUrl = `/api/work-items/${workItem.key}/approvals`;
    const requestBody = {
      transitionId: transition.id,
      kind: "cab",
      approverId: approverPerson.id,
    };
    const disabledRequest = await app.request(requestUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    expect(disabledRequest.status, await disabledRequest.clone().text()).toBe(
      404,
    );
    expect(
      await db
        .select()
        .from(schema.approvalTable)
        .where(eq(schema.approvalTable.workItemId, workItemRow?.id ?? "")),
    ).toHaveLength(0);

    await db.insert(schema.projectFeatureFlagTable).values({
      projectId: project.id,
      featureKey: "feature.approvals",
      enabled: true,
    });
    const createdApproval = await app.request(requestUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    expect(createdApproval.status, await createdApproval.clone().text()).toBe(
      200,
    );
    const approval = (await createdApproval.json()) as {
      id: string;
      createdAt: string;
      state: string;
    };
    expect(approval.state).toBe("pending");
    expect(Number.isNaN(Date.parse(approval.createdAt))).toBe(false);

    const requestEvents = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "approval.requested"));
    expect(requestEvents).toHaveLength(1);
    const requestInbox = await db
      .select()
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.personId, approverPerson.id),
          eq(schema.notificationTable.kind, "approval.requested"),
        ),
      );
    expect(requestInbox).toHaveLength(1);
    const requestAudit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "approval.requested"));
    expect(requestAudit).toHaveLength(1);

    mockAuthenticatedSession(approver.user);
    const approverView = await app.request(requestUrl);
    expect(approverView.status, await approverView.clone().text()).toBe(200);
    const approverViewBody = (await approverView.json()) as {
      approvals: { id: string; canWithdraw: boolean }[];
    };
    expect(approverViewBody.approvals).toEqual([
      expect.objectContaining({ id: approval.id, canWithdraw: false }),
    ]);
    const nonRequesterWithdrawal = await app.request(
      `/api/approvals/${approval.id}/withdraw`,
      { method: "POST" },
    );
    expect(nonRequesterWithdrawal.status).toBe(403);
    const [pendingAfterNonRequesterDenial] = await db
      .select({ state: schema.approvalTable.state })
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, approval.id));
    expect(pendingAfterNonRequesterDenial?.state).toBe("pending");

    await db
      .delete(schema.teamMemberTable)
      .where(eq(schema.teamMemberTable.id, cabMember.id));
    const nonCabDecision = await app.request(
      `/api/approvals/${approval.id}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    expect(nonCabDecision.status).toBe(403);
    await db.insert(schema.teamMemberTable).values(cabMember);

    await db
      .update(schema.projectFeatureFlagTable)
      .set({ enabled: false })
      .where(
        and(
          eq(schema.projectFeatureFlagTable.projectId, project.id),
          eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      );
    const blockedTransition = await app.request(
      `/api/work-items/${workItem.key}/transition`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toStateTemplateId: doneTemplate.id }),
      },
    );
    expect(blockedTransition.status).toBe(422);
    const blockedBody = (await blockedTransition.json()) as {
      blockedBy: { kind: string }[];
    };
    expect(blockedBody.blockedBy.map(({ kind }) => kind)).toContain("approval");

    mockAuthenticatedSession(requester.user);
    const visibleWhileDisabled = await app.request(requestUrl);
    expect(
      visibleWhileDisabled.status,
      await visibleWhileDisabled.clone().text(),
    ).toBe(200);
    const visibleBody = (await visibleWhileDisabled.json()) as {
      approvals: { id: string; canWithdraw: boolean }[];
    };
    expect(visibleBody.approvals).toEqual([
      expect.objectContaining({ id: approval.id, canWithdraw: true }),
    ]);

    await db
      .delete(schema.requestParticipantTable)
      .where(
        and(
          eq(schema.requestParticipantTable.workItemId, workItemRow?.id ?? ""),
          eq(schema.requestParticipantTable.personId, approverPerson.id),
        ),
      );
    mockAuthenticatedSession(approver.user);
    const myApprovals = await app.request("/api/me/approvals");
    expect(myApprovals.status, await myApprovals.clone().text()).toBe(200);
    const listBody = (await myApprovals.json()) as {
      approvals: {
        id: string;
        approverReachLost: boolean;
        canWithdraw: boolean;
      }[];
    };
    expect(listBody.approvals).toEqual([
      expect.objectContaining({
        id: approval.id,
        approverReachLost: true,
        canWithdraw: false,
      }),
    ]);
    const lostReachDecision = await app.request(
      `/api/approvals/${approval.id}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    expect(lostReachDecision.status).toBe(403);

    await db.insert(schema.requestParticipantTable).values({
      workItemId: workItemRow?.id ?? "",
      personId: approverPerson.id,
      addedBy: requesterPerson.id,
      createdAt: now,
    });
    const decided = await app.request(`/api/approvals/${approval.id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(decided.status, await decided.clone().text()).toBe(200);
    expect((await decided.json()).state).toBe("approved");
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "approval.decided")),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "approval.decided")),
    ).toHaveLength(1);
    const decisionActivity = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, workItemRow?.id ?? ""),
          eq(schema.activityTable.verb, "approval.decided"),
        ),
      );
    expect(decisionActivity).toHaveLength(1);
    expect(decisionActivity[0]?.visibility).toBe("internal");
    expect(JSON.stringify(decisionActivity[0]?.payload)).not.toContain(
      "decisionNote",
    );

    const createAdditionalApprovalAsRequester = async () => {
      mockAuthenticatedSession(requester.user);
      await db
        .update(schema.projectFeatureFlagTable)
        .set({ enabled: true })
        .where(
          and(
            eq(schema.projectFeatureFlagTable.projectId, project.id),
            eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
          ),
        );
      const response = await app.request(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      await db
        .update(schema.projectFeatureFlagTable)
        .set({ enabled: false })
        .where(
          and(
            eq(schema.projectFeatureFlagTable.projectId, project.id),
            eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
          ),
        );
      return (await response.json()) as { id: string };
    };

    const scopedDecisionApproval = await createAdditionalApprovalAsRequester();
    const wrongDecisionScopeKey = await createApprovalApiKey(approver.user.id, {
      approval: ["request"],
    });
    const decisionEffectsBeforeDenial =
      await approvalEffectCounts("approval.decided");
    const wrongScopeDecision = await app.request(
      `/api/approvals/${scopedDecisionApproval.id}/decide`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": wrongDecisionScopeKey,
        },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    expect(wrongScopeDecision.status).toBe(403);
    const [stillPendingAfterWrongScope] = await db
      .select({ state: schema.approvalTable.state })
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, scopedDecisionApproval.id));
    expect(stillPendingAfterWrongScope?.state).toBe("pending");
    expect(await approvalEffectCounts("approval.decided")).toEqual(
      decisionEffectsBeforeDenial,
    );

    const correctDecisionScopeKey = await createApprovalApiKey(
      approver.user.id,
      { approval: ["decide", "decide_cab"] },
    );
    const scopedDecision = await app.request(
      `/api/approvals/${scopedDecisionApproval.id}/decide`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": correctDecisionScopeKey,
        },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    expect(scopedDecision.status, await scopedDecision.clone().text()).toBe(
      200,
    );
    expect((await scopedDecision.json()).state).toBe("approved");

    const scopedWithdrawalApproval =
      await createAdditionalApprovalAsRequester();
    const wrongWithdrawalScopeKey = await createApprovalApiKey(
      requester.user.id,
      { approval: ["decide"] },
    );
    const withdrawalEffectsBeforeDenial =
      await approvalEffectCounts("approval.withdrawn");
    const wrongScopeWithdrawal = await app.request(
      `/api/approvals/${scopedWithdrawalApproval.id}/withdraw`,
      { method: "POST", headers: { "x-api-key": wrongWithdrawalScopeKey } },
    );
    expect(wrongScopeWithdrawal.status).toBe(403);
    const [stillPendingAfterWrongWithdrawalScope] = await db
      .select({ state: schema.approvalTable.state })
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, scopedWithdrawalApproval.id));
    expect(stillPendingAfterWrongWithdrawalScope?.state).toBe("pending");
    expect(await approvalEffectCounts("approval.withdrawn")).toEqual(
      withdrawalEffectsBeforeDenial,
    );

    const correctWithdrawalScopeKey = await createApprovalApiKey(
      requester.user.id,
      { approval: ["request"] },
    );
    const scopedWithdrawal = await app.request(
      `/api/approvals/${scopedWithdrawalApproval.id}/withdraw`,
      { method: "POST", headers: { "x-api-key": correctWithdrawalScopeKey } },
    );
    expect(scopedWithdrawal.status, await scopedWithdrawal.clone().text()).toBe(
      200,
    );
    expect((await scopedWithdrawal.json()).state).toBe("withdrawn");

    const instanceAdmin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    const adminWithdrawalApproval = await createAdditionalApprovalAsRequester();
    const adminKeyWithoutRequestScope = await createApprovalApiKey(
      instanceAdmin.user.id,
      { work_item: ["read"] },
    );
    const adminKeyEffectsBeforeDenial =
      await approvalEffectCounts("approval.withdrawn");
    const adminKeyWithdrawal = await app.request(
      `/api/approvals/${adminWithdrawalApproval.id}/withdraw`,
      {
        method: "POST",
        headers: { "x-api-key": adminKeyWithoutRequestScope },
      },
    );
    expect(adminKeyWithdrawal.status).toBe(403);
    const [stillPendingAfterAdminKey] = await db
      .select({ state: schema.approvalTable.state })
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, adminWithdrawalApproval.id));
    expect(stillPendingAfterAdminKey?.state).toBe("pending");
    expect(await approvalEffectCounts("approval.withdrawn")).toEqual(
      adminKeyEffectsBeforeDenial,
    );

    const scopedAdminWithdrawalApproval =
      await createAdditionalApprovalAsRequester();
    const adminKeyWithRequestScope = await createApprovalApiKey(
      instanceAdmin.user.id,
      { approval: ["request"] },
    );
    const adminKeyOnRequesterRoute = await app.request(
      `/api/approvals/${scopedAdminWithdrawalApproval.id}/withdraw`,
      {
        method: "POST",
        headers: { "x-api-key": adminKeyWithRequestScope },
      },
    );
    expect(adminKeyOnRequesterRoute.status).toBe(403);
    const scopedAdminEffectsBeforeDenial =
      await approvalEffectCounts("approval.withdrawn");
    const scopedAdminKeyWithdrawal = await app.request(
      `/api/admin/approvals/${scopedAdminWithdrawalApproval.id}/withdraw`,
      {
        method: "POST",
        headers: { "x-api-key": adminKeyWithRequestScope },
      },
    );
    expect(scopedAdminKeyWithdrawal.status).toBe(403);
    const [stillPendingAfterScopedAdminKey] = await db
      .select({ state: schema.approvalTable.state })
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, scopedAdminWithdrawalApproval.id));
    expect(stillPendingAfterScopedAdminKey?.state).toBe("pending");
    expect(await approvalEffectCounts("approval.withdrawn")).toEqual(
      scopedAdminEffectsBeforeDenial,
    );

    const sessionAdminWithdrawalApproval =
      await createAdditionalApprovalAsRequester();
    mockAuthenticatedSession({ ...instanceAdmin.user, role: "admin" });
    const targetWorkspaceAdminMembership = await db
      .select({ userId: schema.workspaceUserTable.userId })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.userId, instanceAdmin.user.id),
          eq(schema.workspaceUserTable.workspaceId, requester.workspace.id),
        ),
      );
    expect(targetWorkspaceAdminMembership).toHaveLength(0);
    const adminOnRequesterRoute = await app.request(
      `/api/approvals/${sessionAdminWithdrawalApproval.id}/withdraw`,
      { method: "POST" },
    );
    expect(adminOnRequesterRoute.status).toBe(403);
    const adminSessionWithdrawal = await app.request(
      `/api/admin/approvals/${sessionAdminWithdrawalApproval.id}/withdraw`,
      { method: "POST" },
    );
    expect(
      adminSessionWithdrawal.status,
      await adminSessionWithdrawal.clone().text(),
    ).toBe(200);
    expect((await adminSessionWithdrawal.json()).state).toBe("withdrawn");

    const inactiveAdminApproval = await createAdditionalApprovalAsRequester();
    const inactiveAdmin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, inactiveAdmin.user.id));
    const adminPerson = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(
          and(
            eq(schema.personTable.userId, inactiveAdmin.user.id),
            eq(schema.personTable.side, "staff"),
          ),
        )
        .limit(1),
      "approval lifecycle inactive admin person",
    );
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, adminPerson.id));
    expect(await isCurrentInstanceAdmin(inactiveAdmin.user.id)).toBe(false);
    expect(await isCurrentInstanceAdmin(instanceAdmin.user.id)).toBe(true);
    const effectsBeforeInactiveAdminDenial =
      await approvalEffectCounts("approval.withdrawn");
    mockAuthenticatedSession({ ...inactiveAdmin.user, role: "admin" });
    const inactiveAdminWithdrawal = await app.request(
      `/api/admin/approvals/${inactiveAdminApproval.id}/withdraw`,
      { method: "POST" },
    );
    expect(inactiveAdminWithdrawal.status).toBe(403);
    const [stillPendingForInactiveAdmin] = await db
      .select({ state: schema.approvalTable.state })
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, inactiveAdminApproval.id));
    expect(stillPendingForInactiveAdmin?.state).toBe("pending");
    expect(await approvalEffectCounts("approval.withdrawn")).toEqual(
      effectsBeforeInactiveAdminDenial,
    );
    mockAuthenticatedSession({ ...instanceAdmin.user, role: "admin" });
    expect(await isCurrentInstanceAdmin(instanceAdmin.user.id)).toBe(true);

    const disabledFeatureAdminApproval =
      await createAdditionalApprovalAsRequester();
    mockAuthenticatedSession({ ...instanceAdmin.user, role: "admin" });
    const restoredSession = await auth.api.getSession({
      headers: new Headers(),
    });
    expect(restoredSession?.user.id).toBe(instanceAdmin.user.id);
    expect(await isCurrentInstanceAdmin(instanceAdmin.user.id)).toBe(true);
    await db
      .update(schema.projectFeatureFlagTable)
      .set({ enabled: false })
      .where(
        and(
          eq(schema.projectFeatureFlagTable.projectId, project.id),
          eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      );
    const adminWithdrawalWhileFeatureDisabled = await app.request(
      `/api/admin/approvals/${disabledFeatureAdminApproval.id}/withdraw`,
      { method: "POST" },
    );
    expect(
      adminWithdrawalWhileFeatureDisabled.status,
      await adminWithdrawalWhileFeatureDisabled.clone().text(),
    ).toBe(200);
    expect((await adminWithdrawalWhileFeatureDisabled.json()).state).toBe(
      "withdrawn",
    );
    await db
      .update(schema.projectFeatureFlagTable)
      .set({ enabled: true })
      .where(
        and(
          eq(schema.projectFeatureFlagTable.projectId, project.id),
          eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      );

    const rejectedApproval = await createAdditionalApprovalAsRequester();
    mockAuthenticatedSession(approver.user);
    const rejected = await app.request(
      `/api/approvals/${rejectedApproval.id}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject", note: "Declined" }),
      },
    );
    expect(rejected.status, await rejected.clone().text()).toBe(200);
    const [rejectedRow] = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, rejectedApproval.id));
    expect(rejectedRow?.state).toBe("rejected");
    expect(rejectedRow?.decisionNote).toBe("Declined");
    const rejectedEvent = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "approval.decided"));
    expect(JSON.stringify(rejectedEvent)).not.toContain("Declined");

    const withdrawnApproval = await createAdditionalApprovalAsRequester();
    mockAuthenticatedSession(requester.user);
    const withdrawn = await app.request(
      `/api/approvals/${withdrawnApproval.id}/withdraw`,
      { method: "POST" },
    );
    expect(withdrawn.status, await withdrawn.clone().text()).toBe(200);
    const [withdrawnRow] = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, withdrawnApproval.id));
    expect(withdrawnRow?.state).toBe("withdrawn");

    const racedWithdrawalApproval = await createAdditionalApprovalAsRequester();
    mockAuthenticatedSession({ ...instanceAdmin.user, role: "admin" });
    const withdrawalEffectsBeforeRace =
      await approvalEffectCounts("approval.withdrawn");
    const concurrentAdminWithdrawals = await Promise.all([
      app.request(
        `/api/admin/approvals/${racedWithdrawalApproval.id}/withdraw`,
        { method: "POST" },
      ),
      app.request(
        `/api/admin/approvals/${racedWithdrawalApproval.id}/withdraw`,
        { method: "POST" },
      ),
    ]);
    expect(
      concurrentAdminWithdrawals.map((response) => response.status).sort(),
    ).toEqual([200, 409]);
    const [racedWithdrawalRow] = await db
      .select({ state: schema.approvalTable.state })
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, racedWithdrawalApproval.id));
    expect(racedWithdrawalRow?.state).toBe("withdrawn");
    const withdrawalEffectsAfterRace =
      await approvalEffectCounts("approval.withdrawn");
    expect(withdrawalEffectsAfterRace).toEqual({
      events: withdrawalEffectsBeforeRace.events + 1,
      audit: withdrawalEffectsBeforeRace.audit + 1,
    });

    const expiredApproval = await createAdditionalApprovalAsRequester();
    await db
      .update(schema.approvalTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.approvalTable.id, expiredApproval.id));
    const expiryOutcome = await scanApprovalReminders();
    expect(expiryOutcome.expired).toBe(1);
    const [expiredRow] = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, expiredApproval.id));
    expect(expiredRow?.state).toBe("expired");
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "approval.expired")),
    ).toHaveLength(1);

    const terminalApprovals = [
      { id: approval.id, state: "approved" },
      { id: rejectedApproval.id, state: "rejected" },
      { id: expiredApproval.id, state: "expired" },
      { id: withdrawnApproval.id, state: "withdrawn" },
    ];
    const terminalWithdrawalEffects =
      await approvalEffectCounts("approval.withdrawn");
    const narrowRequesterKey = await createApprovalApiKey(requester.user.id, {
      approval: ["decide"],
    });
    const scopedAdminKey = await createApprovalApiKey(instanceAdmin.user.id, {
      approval: ["request"],
    });
    for (const terminal of terminalApprovals) {
      mockAuthenticatedSession(requester.user);
      const terminalView = await app.request(requestUrl);
      expect(terminalView.status, await terminalView.clone().text()).toBe(200);
      const terminalViewBody = (await terminalView.json()) as {
        approvals: { id: string; state: string; canWithdraw: boolean }[];
      };
      expect(terminalViewBody.approvals).toContainEqual(
        expect.objectContaining({
          id: terminal.id,
          state: terminal.state,
          canWithdraw: false,
        }),
      );

      const requesterRetry = await app.request(
        `/api/approvals/${terminal.id}/withdraw`,
        { method: "POST" },
      );
      expect(requesterRetry.status).toBe(409);

      mockAuthenticatedSession({ ...instanceAdmin.user, role: "admin" });
      const sessionAdminRetry = await app.request(
        `/api/admin/approvals/${terminal.id}/withdraw`,
        { method: "POST" },
      );
      expect(sessionAdminRetry.status).toBe(409);

      const adminKeyRetry = await app.request(
        `/api/admin/approvals/${terminal.id}/withdraw`,
        { method: "POST", headers: { "x-api-key": scopedAdminKey } },
      );
      expect(adminKeyRetry.status).toBe(403);

      mockAuthenticatedSession(approver.user);
      const unauthorizedRetry = await app.request(
        `/api/approvals/${terminal.id}/withdraw`,
        { method: "POST" },
      );
      expect(unauthorizedRetry.status).toBe(403);
      const unauthorizedBody = await unauthorizedRetry.text();
      expect(unauthorizedBody).not.toContain(terminal.state);

      const narrowKeyRetry = await app.request(
        `/api/approvals/${terminal.id}/withdraw`,
        { method: "POST", headers: { "x-api-key": narrowRequesterKey } },
      );
      expect(narrowKeyRetry.status).toBe(403);
      expect(await narrowKeyRetry.text()).not.toContain(terminal.state);
      const [unchangedTerminal] = await db
        .select({ state: schema.approvalTable.state })
        .from(schema.approvalTable)
        .where(eq(schema.approvalTable.id, terminal.id));
      expect(unchangedTerminal?.state).toBe(terminal.state);
    }
    expect(await approvalEffectCounts("approval.withdrawn")).toEqual(
      terminalWithdrawalEffects,
    );

    const reminderApproval = await createAdditionalApprovalAsRequester();
    const reminderNow = Date.now();
    await db
      .update(schema.approvalTable)
      .set({
        createdAt: new Date(reminderNow - 3 * 24 * 60 * 60 * 1_000),
        expiresAt: new Date(reminderNow + 3 * 24 * 60 * 60 * 1_000),
      })
      .where(eq(schema.approvalTable.id, reminderApproval.id));
    const reminderOutcome = await scanApprovalReminders();
    expect(reminderOutcome.reminded).toBe(1);
    const [reminderRow] = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, reminderApproval.id));
    expect(reminderRow?.reminder50SentAt).toBeInstanceOf(Date);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "approval.expiring")),
    ).toHaveLength(1);

    mockAuthenticatedSession(requester.user);
    const completedTransition = await app.request(
      `/api/work-items/${workItem.key}/transition`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toStateTemplateId: doneTemplate.id }),
      },
    );
    expect(completedTransition.status).toBe(200);
    const [finalWorkItem] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, workItem.key));
    expect(finalWorkItem?.stateId).toBe(doneState.id);

    await db
      .update(schema.projectFeatureFlagTable)
      .set({ enabled: true })
      .where(
        and(
          eq(schema.projectFeatureFlagTable.projectId, project.id),
          eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      );
    const approvalCountBeforeKeyRequest = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.workItemId, workItemRow?.id ?? ""));
    const wrongRequestScopeKey = await createApprovalApiKey(requester.user.id, {
      approval: ["decide"],
    });
    const wrongScopeRequest = await app.request(requestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": wrongRequestScopeKey,
      },
      body: JSON.stringify(requestBody),
    });
    expect(wrongScopeRequest.status).toBe(403);
    expect(
      await db
        .select()
        .from(schema.approvalTable)
        .where(eq(schema.approvalTable.workItemId, workItemRow?.id ?? "")),
    ).toHaveLength(approvalCountBeforeKeyRequest.length);

    const correctRequestScopeKey = await createApprovalApiKey(
      requester.user.id,
      { approval: ["request_cab"] },
    );
    const scopedRequest = await app.request(requestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": correctRequestScopeKey,
      },
      body: JSON.stringify(requestBody),
    });
    expect(scopedRequest.status, await scopedRequest.clone().text()).toBe(200);
    expect((await scopedRequest.json()).state).toBe("pending");
  });
});
