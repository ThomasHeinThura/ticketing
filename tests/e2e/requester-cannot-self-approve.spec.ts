import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import {
  contextFor,
  expect,
  expectStatus,
  postWithCsrf,
  test,
  withApprovalRuntime,
} from "./helpers/approval-runtime";

test.use({ trace: "off", video: "off", screenshot: "off" });

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

test("requester cannot self-approve", async () => {
  await withApprovalRuntime(async (_app, fixture) => {
    const { origin, tenant, storageStates } = fixture;
    const requester = await contextFor(storageStates.requester);
    try {
      const selfRequest = await postWithCsrf(
        requester,
        origin,
        `/api/work-items/${encodeURIComponent(tenant.key)}/approvals`,
        {
          kind: "cab",
          approverId: tenant.requester.personId,
          transitionId: tenant.transitionId,
        },
      );
      const selfRequestBody = await expectStatus(selfRequest, 422);
      expect(selfRequestBody).toContain("self_approval");

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
      const requesterDecision = await postWithCsrf(
        requester,
        origin,
        `/api/approvals/${encodeURIComponent(approval.id)}/decide`,
        { action: "approve" },
      );
      const requesterDecisionBody = await expectStatus(requesterDecision, 403);
      expect(requesterDecisionBody).toContain("not_named_approver");
      expect(requesterDecisionBody).toContain("self_approval");
    } finally {
      await requester.dispose();
    }
  });
});
