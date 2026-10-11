import {
  contextFor,
  expectStatus,
  postWithCsrf,
  test,
  withApprovalRuntime,
} from "./helpers/approval-runtime";

test("requester cannot self-approve", async () => {
  await withApprovalRuntime(async (_app, fixture) => {
    const { origin, tenant, storageStates } = fixture;
    const requester = await contextFor(storageStates.requester);
    try {
      const requested = await postWithCsrf(
        requester,
        origin,
        `/api/work-items/${encodeURIComponent(tenant.key)}/approvals`,
        {
          kind: "cab",
          approverId: tenant.approver.personId,
          transitionId: tenant.transitionId,
        },
      );
      const requestedBody = await expectStatus(requested, 200);
      const approval = JSON.parse(requestedBody) as { id: string };
      const selfDecision = await postWithCsrf(
        requester,
        origin,
        `/api/approvals/${encodeURIComponent(approval.id)}/decide`,
        { action: "approve" },
      );
      await expectStatus(selfDecision, 403);
    } finally {
      await requester.dispose();
    }
  });
});
