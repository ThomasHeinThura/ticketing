import {
  contextFor,
  expect,
  expectStatus,
  test,
  withApprovalRuntime,
} from "./helpers/approval-runtime";

test("customer cannot request CAB approval", async () => {
  await withApprovalRuntime(async (_app, fixture) => {
    const { portalOrigin, tenant, storageStates } = fixture;
    const customer = await contextFor(storageStates.customer);
    try {
      const sessionResponse = await customer.get(
        new URL("/api/auth/get-session", portalOrigin).toString(),
      );
      const session = JSON.parse(await expectStatus(sessionResponse, 200)) as {
        session?: { portal?: string };
        user?: { id?: string };
      };
      expect(session.user?.id).toBe(tenant.customer.id);
      expect(session.session?.portal).toBe("customer");

      const denied = await customer.post(
        new URL(
          `/api/work-items/${encodeURIComponent(tenant.key)}/approvals`,
          portalOrigin,
        ).toString(),
        {
          data: {
            kind: "cab",
            approverId: tenant.approver.personId,
            transitionId: tenant.transitionId,
          },
          headers: { Origin: portalOrigin },
        },
      );
      // The portal host only exposes its explicit customer API routes. CAB
      // request routes are staff-only and stay undiscoverable on that host.
      await expectStatus(denied, 404);
      const requester = await contextFor(storageStates.requester);
      try {
        const approvals = await requester.get(
          new URL(
            `/api/work-items/${encodeURIComponent(tenant.key)}/approvals`,
            fixture.origin,
          ).toString(),
        );
        const body = await expectStatus(approvals, 200);
        const listed = JSON.parse(body) as { approvals?: unknown[] };
        expect(listed.approvals?.length).toBe(0);
      } finally {
        await requester.dispose();
      }
    } finally {
      await customer.dispose();
    }
  });
});
