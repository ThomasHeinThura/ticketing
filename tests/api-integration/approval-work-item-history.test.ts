import { beforeEach, expect, it } from "vitest";
import {
  buildTenant,
  createApproval,
  decide,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

beforeEach(async () => {
  await resetTestDatabase();
});

it("returns only the reachable work item's approval history", async () => {
  const tenant = await buildTenant("approval-history");
  const approval = await createApproval(tenant);
  const decision = await decide(tenant, tenant.approver, approval.id);
  expect(decision.status).toBe(200);

  const other = await buildTenant("other-approval-history");
  const otherApproval = await createApproval(other);
  mockAuthenticatedSession(tenant.requester.user);
  const response = await tenant.app.request(
    `/api/audit/entity/work_item/${tenant.key}`,
  );
  expect(response.status).toBe(200);
  const { rows } = (await response.json()) as {
    rows: {
      action: string;
      entityId: string;
      actorId: string;
      after: unknown;
    }[];
  };
  expect(rows.filter((row) => row.entityId === approval.id)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: "approval.requested",
        after: { state: "pending" },
      }),
      expect.objectContaining({
        action: "approval.decided",
        actorId: tenant.approverPerson.id,
        after: { state: "approved" },
      }),
    ]),
  );
  expect(rows.some((row) => row.entityId === otherApproval.id)).toBe(false);
  const denied = await tenant.app.request(
    `/api/audit/entity/work_item/${other.key}`,
  );
  expect([403, 404]).toContain(denied.status);
});
