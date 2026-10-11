/**
 * Strict policy enforcement over the real approval routes (F2). The approval policy source
 * is switched to strict mode before the app is built, then every approval route is called.
 * Without the evidence middleware (`approval/evidence.ts`) these routes answer 500, because
 * nothing supplies the row evidence the strict evaluator requires.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const prior = vi.hoisted(() => {
  const previous = process.env.TASKDESK_POLICY_ENFORCE;
  process.env.TASKDESK_POLICY_ENFORCE = "apps/api/src/approval/policy.ts";
  return previous;
});

import { enforcedPolicySources } from "../../apps/api/src/permissions/enforcement-config";
import {
  addCustomer,
  approvalRows,
  buildTenant,
  createApproval,
  decide,
  portalRequest,
  request,
  withdrawAs,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

afterAll(() => {
  if (prior === undefined) delete process.env.TASKDESK_POLICY_ENFORCE;
  else process.env.TASKDESK_POLICY_ENFORCE = prior;
});

describe("approval routes under strict policy enforcement", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("the approval policy source is really enforced in this file", () => {
    expect(enforcedPolicySources.has("apps/api/src/approval/policy.ts")).toBe(
      true,
    );
  });

  it("list, create, decide, withdraw and the inbox work for the right callers", async () => {
    const t = await buildTenant("strict");
    mockAuthenticatedSession(t.requester.user);
    const list = await t.app.request(t.url);
    expect(list.status, await list.clone().text()).toBe(200);

    const created = await request(t, t.requester);
    expect(created.status, await created.clone().text()).toBe(200);
    const { id } = (await created.json()) as { id: string };

    mockAuthenticatedSession(t.approver.user);
    const inbox = await t.app.request("/api/me/approvals");
    expect(inbox.status, await inbox.clone().text()).toBe(200);

    const decided = await decide(t, t.approver, id);
    expect(decided.status, await decided.clone().text()).toBe(200);

    const second = await createApproval(t);
    const withdrawn = await withdrawAs(t, t.requester, second.id);
    expect(withdrawn.status, await withdrawn.clone().text()).toBe(200);
  });

  it("the instance-admin withdrawal route works", async () => {
    const t = await buildTenant("strict-admin");
    const { id } = await createApproval(t);
    const admin = await createWorkspaceMember({ role: "owner" });
    const { eq } = await import("drizzle-orm");
    const { default: db, schema } = await import("../../apps/api/src/database");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    mockAuthenticatedSession({ ...admin.user, role: "admin" });
    const response = await t.app.request(
      `/api/admin/approvals/${id}/withdraw`,
      {
        method: "POST",
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
  });

  it("a workspace outsider still gets 404 on every approval route, never a 500", async () => {
    const t = await buildTenant("strict-a");
    const other = await buildTenant("strict-b");
    const { id } = await createApproval(t);
    expect((await decide(t, other.approver, id)).status).toBe(404);
    expect((await withdrawAs(t, other.requester, id)).status).toBe(404);
    mockAuthenticatedSession(other.requester.user);
    expect((await t.app.request(t.url)).status).toBe(404);
    const create = await request(t, other.requester);
    expect(create.status).toBe(404);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("pending");
  });

  it("portal routes work for the addressed customer and refuse others", async () => {
    const t = await buildTenant("strict-portal");
    const customer = await addCustomer(t);
    const other = await addCustomer(t);
    const created = await request(t, t.requester, {
      kind: "customer",
      approverId: customer.person.id,
    });
    const { id } = (await created.json()) as { id: string };

    const list = await portalRequest(t, customer, "/api/portal/approvals");
    expect(list.status, await list.clone().text()).toBe(200);
    const refused = await portalRequest(
      t,
      other,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    // Strict mode masks a not-addressed approval as 404 (the legacy handler answers 403).
    expect(refused.status, await refused.clone().text()).toBe(404);
    const decided = await portalRequest(
      t,
      customer,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect(decided.status, await decided.clone().text()).toBe(200);
  });
});
