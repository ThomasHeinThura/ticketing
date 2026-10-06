import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanApprovalReminders } from "../../apps/api/src/approval/reminder-scan";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

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
      approvals: { id: string; approverReachLost: boolean }[];
    };
    expect(listBody.approvals).toEqual([
      expect.objectContaining({ id: approval.id, approverReachLost: true }),
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

    const createAdditionalApproval = async () => {
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

    const rejectedApproval = await createAdditionalApproval();
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

    const withdrawnApproval = await createAdditionalApproval();
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

    const expiredApproval = await createAdditionalApproval();
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

    const reminderApproval = await createAdditionalApproval();
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
  });
});
