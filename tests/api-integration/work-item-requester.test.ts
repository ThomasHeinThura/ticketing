/**
 * A-03 (Thomas, 3 November 2026): staff set a work item's requester to a customer.
 *
 * - Only a caller with `work_item:update` on the item; the requester must be an active customer
 *   person of the project's organisation (422 otherwise); clearing is allowed.
 * - Every change is audited (`work_item.updated`, `changedFields: ["requester"]`) and written as
 *   an internal activity row; `If-Match` protects it like every other field edit (409).
 * - The portal then lists the item as that customer's own request, and the customer opens it
 *   and replies (`CP-16`, U-12).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import {
  addCustomer,
  buildTenant,
  portalRequest,
  type Tenant,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  grantProjectRole,
  grantWorkItemProjectAccess,
  prepareAuthenticatedApiFixture,
  requireRow,
} from "./helpers/fixtures";

const json = { "content-type": "application/json" };

async function enable(workspaceId: string) {
  for (const featureKey of ["feature.intake", "feature.sla"]) {
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey, enabled: true, locked: false })
      .onConflictDoNothing();
    await db
      .insert(schema.workspaceFeatureFlagTable)
      .values({ workspaceId, featureKey, enabled: true })
      .onConflictDoNothing();
  }
  invalidateFeatureFlagCache();
}

/** A staff member of the tenant's workspace with the given project capabilities only. */
async function addStaff(
  tenant: Tenant,
  workspaceRole: "viewer" | "member",
  capabilities: string[],
) {
  const id = `staff-${randomUUID()}`;
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id,
        email: `${id}@example.test`,
        emailVerified: true,
        name: id,
      })
      .returning(),
    "staff user",
  );
  await prepareAuthenticatedApiFixture(user.id);
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: tenant.workspaceId,
    userId: user.id,
    role: workspaceRole,
    joinedAt: new Date(),
  });
  await grantProjectRole(user.id, tenant.project.id, capabilities);
  return { user };
}

async function createItem(tenant: Tenant, body: Record<string, unknown> = {}) {
  mockAuthenticatedSession(tenant.requester.user);
  return tenant.app.request(`/api/projects/${tenant.project.id}/work-items`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ typeId: tenant.type.id, title: "Raised", ...body }),
  });
}

async function itemRow(id: string) {
  return requireRow(
    await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, id))
      .limit(1),
    "work item",
  );
}

function patch(
  tenant: Tenant,
  as: { user: Tenant["requester"]["user"] },
  key: string,
  version: number,
  body: Record<string, unknown>,
) {
  mockAuthenticatedSession(as.user);
  return tenant.app.request(`/api/work-items/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { ...json, "if-match": `"${version}"` },
    body: JSON.stringify(body),
  });
}

async function seed() {
  const contoso = await buildTenant("req-contoso");
  const fabrikam = await buildTenant("req-fabrikam");
  const alice = await addCustomer(contoso);
  const frank = await addCustomer(fabrikam);
  for (const tenant of [contoso, fabrikam]) {
    await enable(tenant.workspaceId);
    await grantWorkItemProjectAccess(
      tenant.requester.user.id,
      tenant.project.id,
    );
  }
  const response = await createItem(contoso);
  expect(response.status, await response.clone().text()).toBe(200);
  const created = (await response.json()) as { id: string };
  const item = await itemRow(created.id);
  return { contoso, fabrikam, alice, frank, item };
}

describe("work item requester (A-03)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("names a customer as requester, who then opens and answers it in the portal", async () => {
    const s = await seed();
    expect(s.item.requesterId).toBeNull();

    // A workspace cannot obtain requester candidates from another workspace's project.
    mockAuthenticatedSession(s.contoso.requester.user);
    const foreignCandidates = await s.contoso.app.request(
      `/api/projects/${s.fabrikam.project.id}/requester-candidates`,
    );
    expect([403, 404]).toContain(foreignCandidates.status);
    expect(await foreignCandidates.text()).not.toContain(s.frank.user.email);

    // The picker lists only the organisation's customers.
    mockAuthenticatedSession(s.contoso.requester.user);
    const candidates = await s.contoso.app.request(
      `/api/projects/${s.contoso.project.id}/requester-candidates`,
    );
    expect(candidates.status, await candidates.clone().text()).toBe(200);
    const people = (await candidates.json()) as Array<{ personId: string }>;
    expect(people.map((person) => person.personId)).toEqual([
      s.alice.person.id,
    ]);

    const set = await patch(
      s.contoso,
      s.contoso.requester,
      s.item.key,
      s.item.version,
      { requesterId: s.alice.person.id },
    );
    expect(set.status, await set.clone().text()).toBe(200);
    const updated = await itemRow(s.item.id);
    expect(updated.requesterId).toBe(s.alice.person.id);

    // The staff detail names the requester.
    mockAuthenticatedSession(s.contoso.requester.user);
    const detail = await s.contoso.app.request(
      `/api/work-items/${encodeURIComponent(s.item.key)}`,
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      requesterId: s.alice.person.id,
      requesterName: s.alice.user.name,
    });

    // Audited, and recorded as an internal activity row.
    const audit = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, s.item.id),
          eq(schema.auditLogTable.action, "work_item.updated"),
        ),
      );
    expect(audit).toEqual([{ after: { changedFields: ["requester"] } }]);
    const activity = await db
      .select({
        field: schema.activityTable.field,
        oldValue: schema.activityTable.oldValue,
        newValue: schema.activityTable.newValue,
        visibility: schema.activityTable.visibility,
      })
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, s.item.id),
          eq(schema.activityTable.field, "requester"),
        ),
      );
    expect(activity).toEqual([
      {
        field: "requester",
        oldValue: null,
        newValue: s.alice.person.id,
        visibility: "internal",
      },
    ]);

    // The customer's case list shows it as her own; she opens it and replies.
    const list = await portalRequest(
      s.contoso,
      s.alice,
      "/api/portal/requests",
    );
    expect(list.status, await list.clone().text()).toBe(200);
    const rows = (await list.json()) as {
      cases: Array<{ ref: string; source: string }>;
    };
    expect(rows.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: s.item.key, source: "direct" }),
      ]),
    );
    const page = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/requests/${s.item.key}`,
    );
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({ canReply: true });
    const reply = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/requests/${s.item.key}/comments`,
      { method: "POST", body: { body: "Thanks, I will test it." } },
    );
    expect(reply.status, await reply.clone().text()).toBe(200);

    // Clearing is allowed and takes the request out of her portal.
    const cleared = await patch(
      s.contoso,
      s.contoso.requester,
      s.item.key,
      updated.version,
      { requesterId: null },
    );
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    expect((await itemRow(s.item.id)).requesterId).toBeNull();
    const gone = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/requests/${s.item.key}`,
    );
    expect(gone.status).toBe(404);
  });

  it("refuses a requester who is not a customer of the project's organisation (422)", async () => {
    const s = await seed();
    for (const requesterId of [
      s.frank.person.id,
      s.contoso.requesterPerson.id,
      "no-such-person",
    ]) {
      const response = await patch(
        s.contoso,
        s.contoso.requester,
        s.item.key,
        s.item.version,
        { requesterId },
      );
      expect(response.status, requesterId).toBe(422);
    }
    // An inactive customer is refused too.
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, s.alice.person.id));
    const inactive = await patch(
      s.contoso,
      s.contoso.requester,
      s.item.key,
      s.item.version,
      { requesterId: s.alice.person.id },
    );
    expect(inactive.status).toBe(422);
    const row = await itemRow(s.item.id);
    expect(row).toMatchObject({ requesterId: null, version: s.item.version });

    // The same rule applies when the item is created for a customer.
    const foreign = await createItem(s.contoso, {
      requesterId: s.frank.person.id,
    });
    expect(foreign.status).toBe(422);
  });

  it("denies callers without work_item:update and protects concurrent edits", async () => {
    const s = await seed();
    const viewer = await addStaff(s.contoso, "viewer", [
      "project:read",
      "work_item:read",
    ]);
    const member = await addStaff(s.contoso, "member", [
      "project:read",
      "work_item:read",
      "work_item:create",
    ]);
    for (const who of [viewer, member]) {
      const response = await patch(s.contoso, who, s.item.key, s.item.version, {
        requesterId: s.alice.person.id,
      });
      expect(response.status).toBe(403);
      mockAuthenticatedSession(who.user);
      const candidates = await s.contoso.app.request(
        `/api/projects/${s.contoso.project.id}/requester-candidates`,
      );
      expect(candidates.status).toBe(403);
    }
    // A member who may create but not update cannot name a requester at creation either.
    mockAuthenticatedSession(member.user);
    const created = await s.contoso.app.request(
      `/api/projects/${s.contoso.project.id}/work-items`,
      {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          typeId: s.contoso.type.id,
          title: "For Alice",
          requesterId: s.alice.person.id,
        }),
      },
    );
    expect(created.status).toBe(403);
    expect((await itemRow(s.item.id)).requesterId).toBeNull();

    // A stale version is a 409 and changes nothing.
    const first = await patch(
      s.contoso,
      s.contoso.requester,
      s.item.key,
      s.item.version,
      { title: "Renamed" },
    );
    expect(first.status).toBe(200);
    const stale = await patch(
      s.contoso,
      s.contoso.requester,
      s.item.key,
      s.item.version,
      { requesterId: s.alice.person.id },
    );
    expect(stale.status).toBe(409);
    expect((await itemRow(s.item.id)).requesterId).toBeNull();
  });

  it("creates an item for a customer with an audited requester", async () => {
    const s = await seed();
    const response = await createItem(s.contoso, {
      requesterId: s.alice.person.id,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect((await itemRow(id)).requesterId).toBe(s.alice.person.id);
    const audit = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, id),
          eq(schema.auditLogTable.action, "work_item.updated"),
        ),
      );
    expect(audit).toEqual([{ after: { changedFields: ["requester"] } }]);
  });
});
