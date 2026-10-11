/**
 * Customer portal approvals (F1): a customer who is the named approver can decide through
 * `POST /api/portal/approvals/{id}/decide`, authorised by the `addressed_approval` predicate
 * plus the organisation-scope `customer` role. Real HTTP on the portal host, real database.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  addCustomer,
  approvalRows,
  buildTenant,
  portalRequest,
  request,
} from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";

async function customerApproval() {
  const t = await buildTenant("portal");
  const approver = await addCustomer(t);
  const other = await addCustomer(t);
  const created = await request(t, t.requester, {
    kind: "customer",
    approverId: approver.person.id,
  });
  expect(created.status, await created.clone().text()).toBe(200);
  const { id } = (await created.json()) as { id: string };
  return { t, approver, other, id };
}

describe("approvals: customer portal decisions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("the customer who is the named approver can decide", async () => {
    const { t, approver, id } = await customerApproval();
    const response = await portalRequest(
      t,
      approver,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("approved");
  });

  it("another customer of the same organisation is refused", async () => {
    const { t, other, id } = await customerApproval();
    const response = await portalRequest(
      t,
      other,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect(response.status, await response.clone().text()).toBe(403);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("pending");
  });

  it("a staff session on the portal is refused, even the staff approver of a CAB approval", async () => {
    const { t, id } = await customerApproval();
    const staff = await portalRequest(
      t,
      t.approver,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect([401, 403]).toContain(staff.status);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("pending");
  });

  it("a customer cannot decide a CAB approval through the portal", async () => {
    const t = await buildTenant("portal-cab");
    const customer = await addCustomer(t);
    const created = await request(t, t.requester);
    const { id } = (await created.json()) as { id: string };
    const response = await portalRequest(
      t,
      customer,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect(response.status).toBe(403);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("pending");
  });

  it("a customer of another organisation named as approver by a forged row cannot decide", async () => {
    const t = await buildTenant("portal-xorg");
    const insider = await addCustomer(t);
    const created = await request(t, t.requester, {
      kind: "customer",
      approverId: insider.person.id,
    });
    const { id } = (await created.json()) as { id: string };
    // A customer of a different organisation (its own org and customer membership).
    const outsider = await addCustomer(await buildTenant("portal-xorg-b"));
    await db
      .update(schema.approvalTable)
      .set({ approverId: outsider.person.id })
      .where(eq(schema.approvalTable.id, id));
    const response = await portalRequest(
      t,
      outsider,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect([403, 404]).toContain(response.status);
    expect((await approvalRows(t.workItem.id))[0]?.state).toBe("pending");
  });

  it("a rejection through the portal needs a note and is recorded", async () => {
    const { t, approver, id } = await customerApproval();
    const noNote = await portalRequest(
      t,
      approver,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "reject" } },
    );
    expect(noNote.status).toBe(422);
    const rejected = await portalRequest(
      t,
      approver,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "reject", note: "not now" } },
    );
    expect(rejected.status, await rejected.clone().text()).toBe(200);
    const [row] = await approvalRows(t.workItem.id);
    expect(row?.state).toBe("rejected");
    expect(row?.decisionNote).toBe("not now");
  });

  it("the portal list shows only approvals addressed to the caller", async () => {
    const { t, approver, other } = await customerApproval();
    const mine = await portalRequest(t, approver, "/api/portal/approvals");
    expect(mine.status, await mine.clone().text()).toBe(200);
    expect(
      ((await mine.json()) as { approvals: unknown[] }).approvals,
    ).toHaveLength(1);
    const theirs = await portalRequest(t, other, "/api/portal/approvals");
    expect(
      ((await theirs.json()) as { approvals: unknown[] }).approvals,
    ).toEqual([]);
    // A staff session is refused the portal list.
    const staff = await portalRequest(t, t.approver, "/api/portal/approvals");
    expect([401, 403]).toContain(staff.status);
    await db
      .update(schema.approvalTable)
      .set({ state: "withdrawn" })
      .where(eq(schema.approvalTable.workItemId, t.workItem.id));
    const afterWithdraw = await portalRequest(
      t,
      approver,
      "/api/portal/approvals",
    );
    expect(
      ((await afterWithdraw.json()) as { approvals: unknown[] }).approvals,
    ).toEqual([]);
  });
});
