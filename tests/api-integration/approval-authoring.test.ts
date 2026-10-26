import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const prior = vi.hoisted(() => {
  const value = process.env.TASKDESK_POLICY_ENFORCE;
  process.env.TASKDESK_POLICY_ENFORCE = "apps/api/src/approval/policy.ts";
  return value;
});

import db, { schema } from "../../apps/api/src/database";
import {
  addCustomer,
  approvalRows,
  buildTenant,
  request,
  revokeProjectMembership,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

afterAll(() => {
  if (prior === undefined) delete process.env.TASKDESK_POLICY_ENFORCE;
  else process.env.TASKDESK_POLICY_ENFORCE = prior;
});
async function scopedKey(
  userId: string,
  permissions: Record<string, string[]>,
) {
  const key = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: createHash("sha256").update(key).digest("base64url"),
    name: "Approval authoring test",
    prefix: "taskdesk",
    start: key.slice(0, 12),
    permissions: JSON.stringify(permissions),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return key;
}

describe("persisted approval authoring under strict policy", () => {
  beforeEach(resetTestDatabase);
  it("lists reachable approvals and masks the work item after staff project reach is revoked", async () => {
    const t = await buildTenant("approval-list-reach");
    mockAuthenticatedSession(t.approver.user);
    expect(
      (await t.app.request(`/api/work-items/${t.key}/approvals`)).status,
    ).toBe(200);
    await revokeProjectMembership(t.approverPerson.id, t.project.id);
    expect(
      (await t.app.request(`/api/work-items/${t.key}/approvals`)).status,
    ).toBe(404);
    expect(
      (await t.app.request("/api/work-items/UNKNOWN-99999/approvals")).status,
    ).toBe(404);
  });
  it("offers only real active workflow gates and persists a request from an eligible CAB candidate", async () => {
    const t = await buildTenant("authoring");
    mockAuthenticatedSession(t.requester.user);
    const context = await t.app.request(
      `/api/work-items/${t.key}/approval-request-context`,
    );
    expect(context.status, await context.clone().text()).toBe(200);
    const options = (await context.json()) as {
      enabled: boolean;
      canRequestCustomer: boolean;
      canRequestCab: boolean;
      defaultExpiryDays: number;
      transitions: { id: string; toStateName: string }[];
    };
    expect(options).toMatchObject({
      enabled: true,
      canRequestCustomer: true,
      canRequestCab: true,
      defaultExpiryDays: 7,
    });
    expect(options.transitions.map((edge) => edge.id).sort()).toEqual(
      [t.gated.id, t.cabOnly.id].sort(),
    );
    expect(
      options.transitions.some((edge) => edge.toStateName === "Done"),
    ).toBe(true);
    const response = await t.app.request(
      `/api/work-items/${t.key}/approval-candidates?kind=cab`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const candidates = (await response.json()) as {
      data: { id: string; displayName: string | null }[];
    };
    expect(candidates.data.map((person) => person.id)).toContain(
      t.approverPerson.id,
    );
    expect(candidates.data.map((person) => person.id)).not.toContain(
      t.requesterPerson.id,
    );
    expect(JSON.stringify(candidates)).not.toContain(t.approver.user.email);
    expect(JSON.stringify(candidates)).not.toContain(t.approver.user.id);
    const created = await request(t, t.requester, {
      transitionId: t.cabOnly.id,
      approverId: t.approverPerson.id,
      kind: "cab",
    });
    expect(created.status, await created.clone().text()).toBe(200);
    expect(await approvalRows(t.workItem.id)).toHaveLength(1);
  });
  it("returns eligible customers only and reflects feature/type changes without weakening existing requests", async () => {
    const t = await buildTenant("authoring-customer");
    const customer = await addCustomer(t);
    mockAuthenticatedSession(t.requester.user);
    const response = await t.app.request(
      `/api/work-items/${t.key}/approval-candidates?kind=customer`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      data: expect.arrayContaining([
        { id: customer.person.id, displayName: customer.person.displayName },
      ]),
    });
    await db
      .update(schema.workItemTypeTable)
      .set({ isChange: false })
      .where(eq(schema.workItemTypeTable.id, t.type.id));
    expect(
      (
        await t.app.request(
          `/api/work-items/${t.key}/approval-candidates?kind=cab`,
        )
      ).status,
    ).toBe(403);
    await db
      .update(schema.workspaceFeatureFlagTable)
      .set({ enabled: false })
      .where(eq(schema.workspaceFeatureFlagTable.workspaceId, t.workspaceId));
    expect(
      await (
        await t.app.request(`/api/work-items/${t.key}/approval-request-context`)
      ).json(),
    ).toMatchObject({
      enabled: false,
      canRequestCustomer: false,
      canRequestCab: false,
      transitions: [],
    });
    expect(
      (
        await t.app.request(
          `/api/work-items/${t.key}/approval-candidates?kind=customer`,
        )
      ).status,
    ).toBe(404);
  });
  it("masks unreachable sources identically to missing keys for sessions and scoped keys", async () => {
    const t = await buildTenant("authoring-a");
    const other = await buildTenant("authoring-b");
    const key = await scopedKey(other.requester.user.id, {
      work_item: ["read"],
      approval: ["request", "request_cab"],
    });
    for (const headers of [undefined, { "x-api-key": key }]) {
      mockAuthenticatedSession(other.requester.user);
      for (const suffix of [
        "approval-request-context",
        "approval-candidates?kind=cab",
      ]) {
        const real = await t.app.request(`/api/work-items/${t.key}/${suffix}`, {
          headers,
        });
        const missing = await t.app.request(
          `/api/work-items/MISSING-99999/${suffix}`,
          { headers },
        );
        expect(real.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(await real.text()).toBe(await missing.text());
      }
    }
  });
  it("honours frozen API-key scope on both authoring reads", async () => {
    const t = await buildTenant("authoring-key");
    const full = await scopedKey(t.requester.user.id, {
      work_item: ["read"],
      approval: ["request", "request_cab"],
    });
    const narrow = await scopedKey(t.requester.user.id, {
      work_item: ["read"],
    });
    mockAuthenticatedSession(t.requester.user);
    expect(
      (
        await t.app.request(
          `/api/work-items/${t.key}/approval-request-context`,
          { headers: { "x-api-key": full } },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await t.app.request(
          `/api/work-items/${t.key}/approval-candidates?kind=cab`,
          { headers: { "x-api-key": full } },
        )
      ).status,
    ).toBe(200);
    expect(
      await (
        await t.app.request(
          `/api/work-items/${t.key}/approval-request-context`,
          { headers: { "x-api-key": narrow } },
        )
      ).json(),
    ).toMatchObject({ canRequestCustomer: false, canRequestCab: false });
    expect(
      (
        await t.app.request(
          `/api/work-items/${t.key}/approval-candidates?kind=cab`,
          { headers: { "x-api-key": narrow } },
        )
      ).status,
    ).toBe(403);
  });
  it("pages real eligible people with encrypted source-bound cursors and treats wildcard search literally", async () => {
    const t = await buildTenant("authoring-pages");
    const first = await addCustomer(t);
    const second = await addCustomer(t);
    const other = await buildTenant("authoring-hidden");
    const foreign = await addCustomer(other);
    await db
      .update(schema.personTable)
      .set({ displayName: "Person%one" })
      .where(eq(schema.personTable.id, first.person.id));
    await db
      .update(schema.personTable)
      .set({ displayName: "Person_two" })
      .where(eq(schema.personTable.id, second.person.id));
    mockAuthenticatedSession(t.requester.user);
    const read = (query: string) =>
      t.app.request(
        `/api/work-items/${t.key}/approval-candidates?kind=customer&${query}`,
      );
    const one = (await (await read("q=%25")).json()) as {
      data: { id: string }[];
    };
    expect(one.data.map((person) => person.id)).toEqual([first.person.id]);
    const two = (await (await read("q=_")).json()) as {
      data: { id: string }[];
    };
    expect(two.data.map((person) => person.id)).toEqual([second.person.id]);
    const page = (await (await read("limit=1")).json()) as {
      data: { id: string }[];
      page: { hasMore: boolean; nextCursor: string };
    };
    expect(page.data).toHaveLength(1);
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).toMatch(/^enc:v2:/u);
    const next = (await (
      await read(`limit=1&cursor=${encodeURIComponent(page.page.nextCursor)}`)
    ).json()) as { data: { id: string }[] };
    expect(
      new Set([...page.data, ...next.data].map((person) => person.id)),
    ).toEqual(new Set([first.person.id, second.person.id]));
    const serialized = JSON.stringify({ page, next });
    for (const value of [
      foreign.person.id,
      foreign.user.id,
      foreign.user.email,
      first.user.id,
      first.user.email,
      second.user.id,
      second.user.email,
    ])
      expect(serialized).not.toContain(value);
    expect(
      (
        await read(
          `q=changed&cursor=${encodeURIComponent(page.page.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (await read(`cursor=${encodeURIComponent(`${page.page.nextCursor}x`)}`))
        .status,
    ).toBe(400);
    expect((await read("q=%00")).status).toBe(400);
  });
  it("does not offer inactive or private-unrelated approvers and refuses customer authoring", async () => {
    const t = await buildTenant("authoring-private");
    const addressed = await addCustomer(t);
    const unrelated = await addCustomer(t);
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "private", requesterId: addressed.person.id })
      .where(eq(schema.workItemTable.id, t.workItem.id));
    mockAuthenticatedSession(t.requester.user);
    const response = await t.app.request(
      `/api/work-items/${t.key}/approval-candidates?kind=customer`,
    );
    const data = (await response.json()) as { data: { id: string }[] };
    expect(data.data.map((person) => person.id)).toContain(addressed.person.id);
    expect(data.data.map((person) => person.id)).not.toContain(
      unrelated.person.id,
    );
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, addressed.person.id));
    const inactive = await t.app.request(
      `/api/work-items/${t.key}/approval-candidates?kind=customer`,
    );
    expect(await inactive.json()).toMatchObject({ data: [] });
    await db
      .update(schema.personTable)
      .set({ active: true })
      .where(eq(schema.personTable.id, addressed.person.id));
    mockAuthenticatedSession(addressed.user);
    for (const suffix of [
      "approval-request-context",
      "approval-candidates?kind=customer",
    ])
      expect(
        (await t.app.request(`/api/work-items/${t.key}/${suffix}`)).status,
      ).toBe(403);
  });
});
