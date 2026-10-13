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

test("approval responses do not leak the approver email", async () => {
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
      await expectStatus(requested, 200);
      const listed = await requester.get(
        new URL(
          `/api/work-items/${encodeURIComponent(tenant.key)}/approvals`,
          origin,
        ).toString(),
        { headers: { Origin: origin } },
      );
      await expectStatus(listed, 200);
      const body = await listed.text();
      expect(body).not.toContain(tenant.approver.email);
      expect(body).toContain(tenant.approver.name);
    } finally {
      await requester.dispose();
    }
  });
});
