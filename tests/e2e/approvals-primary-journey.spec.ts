import {
  contextFor,
  expect,
  expectStatus,
  postWithCsrf,
  test,
  withApprovalRuntime,
} from "./helpers/approval-runtime";

test("approval request blocks transition until an independent approver decides", async () => {
  await withApprovalRuntime(async (_app, fixture) => {
    const { origin, tenant, storageStates } = fixture;
    const requester = await contextFor(storageStates.requester);
    const approver = await contextFor(storageStates.approver);
    try {
      const approvalPath = `/api/work-items/${encodeURIComponent(tenant.key)}/approvals`;
      const requested = await postWithCsrf(requester, origin, approvalPath, {
        kind: "cab",
        approverId: tenant.approver.personId,
        transitionId: tenant.transitionId,
      });
      const requestedBody = await expectStatus(requested, 200);
      const approval = JSON.parse(requestedBody) as {
        id: string;
        state: string;
      };
      expect(approval.state).toBe("pending");

      const blocked = await postWithCsrf(
        requester,
        origin,
        `/api/work-items/${encodeURIComponent(tenant.key)}/transition`,
        { toStateTemplateId: tenant.doneStateId },
      );
      await expectStatus(blocked, 422);

      const decision = await postWithCsrf(
        approver,
        origin,
        `/api/approvals/${encodeURIComponent(approval.id)}/decide`,
        { action: "approve" },
      );
      const decisionBody = await expectStatus(decision, 200);
      expect((JSON.parse(decisionBody) as { state: string }).state).toBe(
        "approved",
      );

      const transitioned = await postWithCsrf(
        requester,
        origin,
        `/api/work-items/${encodeURIComponent(tenant.key)}/transition`,
        { toStateTemplateId: tenant.doneStateId },
      );
      await expectStatus(transitioned, 200);

      const returned = await postWithCsrf(
        requester,
        origin,
        `/api/work-items/${encodeURIComponent(tenant.key)}/transition`,
        { toStateTemplateId: tenant.backlogStateId },
      );
      await expectStatus(returned, 200);

      const spentReplay = await postWithCsrf(
        requester,
        origin,
        `/api/work-items/${encodeURIComponent(tenant.key)}/transition`,
        { toStateTemplateId: tenant.doneStateId },
      );
      await expectStatus(spentReplay, 422);
    } finally {
      await Promise.all([requester.dispose(), approver.dispose()]);
    }
  });
});
