import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  listPortalBacklog,
  rankPortalBacklog,
} from "../../apps/api/src/intake/portal-backlog";
import * as realtime from "../../apps/api/src/ws";
import {
  addCustomer,
  buildTenant,
  PORTAL_HOST,
  portalRequest,
  type Tenant,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

async function createLinkedSubmission(
  tenant: Tenant,
  input: {
    organisationId: string;
    requesterId: string;
    workItemId: string;
    state?: string;
    customerVisibility?: "private" | "organisation";
  },
) {
  const [requestType] = await db
    .insert(schema.requestTypeTable)
    .values({
      workspaceId: tenant.workspaceId,
      key: `portal-rank-${randomUUID()}`,
      name: "Backlog request",
      group: "General",
      workItemTypeId: tenant.type.id,
      formSchema: { fields: [] },
      published: true,
      customerVisible: true,
    })
    .returning();
  if (!requestType) throw new Error("request type missing");
  const [version] = await db
    .insert(schema.requestTypeVersionTable)
    .values({
      workspaceId: tenant.workspaceId,
      requestTypeId: requestType.id,
      number: 1,
      formSchema: { fields: [] },
      workItemTypeId: tenant.type.id,
    })
    .returning();
  if (!version) throw new Error("request type version missing");
  return requireRow(
    await db
      .insert(schema.submissionTable)
      .values({
        organisationId: input.organisationId,
        requesterId: input.requesterId,
        requestTypeId: requestType.id,
        requestTypeVersionId: version.id,
        formData: {},
        state: input.state ?? "accepted",
        submittedAt: new Date(),
        customerVisibility: input.customerVisibility ?? "organisation",
        workItemId: input.workItemId,
      })
      .returning(),
    "linked submission",
  );
}

async function createWorkItem(tenant: Tenant, title: string) {
  mockAuthenticatedSession(tenant.requester.user);
  const response = await tenant.app.request(
    `/api/projects/${tenant.project.id}/work-items`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ typeId: tenant.type.id, title }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const result = (await response.json()) as { id: string; key: string };
  await db
    .update(schema.workItemTable)
    .set({ customerVisibility: "organisation" })
    .where(eq(schema.workItemTable.id, result.id));
  return requireRow(
    await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, result.id))
      .limit(1),
    "created work item",
  );
}

async function concreteStateId(tenant: Tenant, stateTemplateId: string) {
  return requireRow(
    await db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .where(
        and(
          eq(schema.stateTable.projectId, tenant.project.id),
          eq(schema.stateTable.stateTemplateId, stateTemplateId),
        ),
      )
      .limit(1),
    "concrete project state",
  ).id;
}

async function enableIntake(tenant: Tenant) {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.intake", enabled: true, locked: false })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true, locked: false },
    });
  await db
    .insert(schema.workspaceFeatureFlagTable)
    .values({
      workspaceId: tenant.workspaceId,
      featureKey: "feature.intake",
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [
        schema.workspaceFeatureFlagTable.workspaceId,
        schema.workspaceFeatureFlagTable.featureKey,
      ],
      set: { enabled: true },
    });
}

function portalRankRequest(
  tenant: Tenant,
  customer: Awaited<ReturnType<typeof addCustomer>>,
  body: Record<string, unknown>,
) {
  mockAuthenticatedSession(customer.user, { portal: "customer" });
  return tenant.app.request(`http://${PORTAL_HOST}/api/portal/requests/rank`, {
    method: "POST",
    headers: {
      host: PORTAL_HOST,
      origin: `http://${PORTAL_HOST}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("portal organisation backlog", () => {
  beforeEach(async () => resetTestDatabase());
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists deduplicated accepted work items by concrete backlog state and hides private/pending rows", async () => {
    const tenant = await buildTenant("portal-backlog-list");
    const customer = await addCustomer(tenant);
    await enableIntake(tenant);
    const [visible] = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, tenant.key));
    if (!visible) throw new Error("fixture work item missing");
    const visibleSubmission = await createLinkedSubmission(tenant, {
      organisationId: customer.orgId,
      requesterId: customer.person.id,
      workItemId: visible.id,
    });
    const duplicateSubmission = await createLinkedSubmission(tenant, {
      organisationId: customer.orgId,
      requesterId: customer.person.id,
      workItemId: visible.id,
      state: "duplicate",
    });
    const otherItem = await createWorkItem(tenant, "Private backlog item");
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "private" })
      .where(eq(schema.workItemTable.id, otherItem.id));
    await createLinkedSubmission(tenant, {
      organisationId: customer.orgId,
      requesterId: tenant.requesterPerson.id,
      workItemId: otherItem.id,
    });
    const nonBacklogItem = await createWorkItem(tenant, "Started item");
    const reviewStateId = await concreteStateId(tenant, tenant.review.id);
    await db
      .update(schema.workItemTable)
      .set({ stateId: reviewStateId })
      .where(eq(schema.workItemTable.id, nonBacklogItem.id));
    await createLinkedSubmission(tenant, {
      organisationId: customer.orgId,
      requesterId: customer.person.id,
      workItemId: nonBacklogItem.id,
    });
    const pendingItem = await createWorkItem(tenant, "Pending submission item");
    await createLinkedSubmission(tenant, {
      organisationId: customer.orgId,
      requesterId: customer.person.id,
      workItemId: pendingItem.id,
      state: "new",
    });

    const response = await portalRequest(
      tenant,
      customer,
      "/api/portal/requests/backlog",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const page = (await response.json()) as Awaited<
      ReturnType<typeof listPortalBacklog>
    >;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: visible.id,
      key: tenant.key,
      stateId: tenant.workItem.stateId,
      sourceRef: `SUB-${Math.min(visibleSubmission.number, duplicateSubmission.number)}`,
    });
    expect(JSON.stringify(page)).not.toContain("Private backlog item");

    const filtered = await portalRequest(
      tenant,
      customer,
      `/api/portal/requests/backlog?project=${tenant.project.slug}`,
    );
    expect(filtered.status).toBe(200);
    expect(
      ((await filtered.json()) as typeof page).items.map((item) => item.id),
    ).toEqual([visible.id]);
    const unknown = await portalRequest(
      tenant,
      customer,
      "/api/portal/requests/backlog?project=UNKNOWN",
    );
    expect(unknown.status).toBe(200);
    expect(((await unknown.json()) as typeof page).items).toEqual([]);
    const invalid = await portalRequest(
      tenant,
      customer,
      "/api/portal/requests/backlog?project=bad%20key",
    );
    expect(invalid.status).toBe(400);
  });

  it("isolates two projects and rejects a real cursor when switching projects", async () => {
    const first = await buildTenant("backlog-project-a");
    const customer = await addCustomer(first);
    const second = await buildTenant("backlog-project-b");
    await db
      .update(schema.workspaceTable)
      .set({ organisationId: customer.orgId })
      .where(eq(schema.workspaceTable.id, second.workspaceId));
    await db
      .update(schema.projectTable)
      .set({ organisationId: customer.orgId })
      .where(eq(schema.projectTable.id, second.project.id));
    const foreign = await buildTenant("backlog-project-foreign");
    const foreignCustomer = await addCustomer(foreign);
    await enableIntake(first);
    await enableIntake(second);
    await enableIntake(foreign);
    const firstItems = [first.workItem];
    for (let index = 0; index < 50; index++)
      firstItems.push(await createWorkItem(first, `Project A ${index}`));
    for (const item of firstItems)
      await createLinkedSubmission(first, {
        organisationId: customer.orgId,
        requesterId: customer.person.id,
        workItemId: item.id,
      });
    await createLinkedSubmission(second, {
      organisationId: customer.orgId,
      requesterId: customer.person.id,
      workItemId: second.workItem.id,
    });
    await createLinkedSubmission(foreign, {
      organisationId: foreignCustomer.orgId,
      requesterId: foreignCustomer.person.id,
      workItemId: foreign.workItem.id,
    });
    const foreignOwnResponse = await portalRequest(
      foreign,
      foreignCustomer,
      `/api/portal/requests/backlog?project=${foreign.project.slug}`,
    );
    expect(foreignOwnResponse.status).toBe(200);
    const foreignOwnPage = (await foreignOwnResponse.json()) as Awaited<
      ReturnType<typeof listPortalBacklog>
    >;
    expect(foreignOwnPage.items.map((item) => item.id)).toEqual([
      foreign.workItem.id,
    ]);
    const read = (project: string, cursor?: string) =>
      portalRequest(
        first,
        customer,
        `/api/portal/requests/backlog?${new URLSearchParams({ project, ...(cursor ? { cursor } : {}) })}`,
      );
    const responseA = await read(first.project.slug);
    expect(responseA.status).toBe(200);
    const pageA = (await responseA.json()) as Awaited<
      ReturnType<typeof listPortalBacklog>
    >;
    expect(pageA.items).toHaveLength(50);
    expect(
      pageA.items.every((item) => item.projectId === first.project.id),
    ).toBe(true);
    const cursor = pageA.page.nextCursor;
    expect(cursor).toBeTruthy();
    if (!cursor) throw new Error("Expected a backlog cursor");
    const secondPage = await read(first.project.slug, cursor);
    expect(secondPage.status).toBe(200);
    const pageA2 = (await secondPage.json()) as typeof pageA;
    expect(pageA2.items).toHaveLength(1);
    expect(pageA2.items[0]?.projectId).toBe(first.project.id);
    const responseB = await read(second.project.slug);
    expect(responseB.status).toBe(200);
    const pageB = (await responseB.json()) as typeof pageA;
    expect(pageB.items.map((item) => item.id)).toEqual([second.workItem.id]);
    expect(
      pageB.items.every((item) => item.projectId === second.project.id),
    ).toBe(true);
    const foreignResponse = await read(foreign.project.slug);
    expect(foreignResponse.status).toBe(200);
    expect(((await foreignResponse.json()) as typeof pageA).items).toEqual([]);
    const switched = await read(second.project.slug, cursor);
    expect(switched.status).toBe(400);
  });

  it("ranks only visible neighbors in the same concrete backlog state", async () => {
    const tenant = await buildTenant("portal-backlog-rank");
    const customer = await addCustomer(tenant);
    await enableIntake(tenant);
    const target = requireRow(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.key, tenant.key)),
      "target item",
    );
    const neighbor = await createWorkItem(tenant, "Neighbor");
    await db
      .update(schema.workItemTable)
      .set({ position: "2" })
      .where(eq(schema.workItemTable.id, neighbor.id));
    await createLinkedSubmission(tenant, {
      organisationId: customer.orgId,
      requesterId: customer.person.id,
      workItemId: target.id,
    });
    await createLinkedSubmission(tenant, {
      organisationId: customer.orgId,
      requesterId: customer.person.id,
      workItemId: neighbor.id,
    });

    const hint = vi
      .spyOn(realtime, "broadcastNativeWorkItemHint")
      .mockResolvedValue(undefined);
    const rankResponse = await portalRankRequest(tenant, customer, {
      key: target.key,
      beforeId: neighbor.id,
    });
    expect(rankResponse.status, await rankResponse.clone().text()).toBe(200);
    // VW-5: staff viewers of the project see the customer re-rank live (never customer-visible).
    expect(hint).toHaveBeenCalledTimes(1);
    expect(hint.mock.calls[0]?.[0]).toMatchObject({
      projectId: tenant.project.id,
      eventType: "work_item.updated",
      key: target.key,
      customerVisible: false,
    });
    const moved = (await rankResponse.json()) as {
      key: string;
      position: string;
      version: number;
    };
    expect(Number(moved.position)).toBeGreaterThan(2);
    expect(moved.version).toBe(target.version + 1);

    const hidden = await createWorkItem(tenant, "Hidden private neighbor");
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "private" })
      .where(eq(schema.workItemTable.id, hidden.id));
    await createLinkedSubmission(tenant, {
      organisationId: customer.orgId,
      requesterId: tenant.requesterPerson.id,
      workItemId: hidden.id,
    });
    await expect(
      rankPortalBacklog(customer.person.id, {
        key: target.key,
        beforeId: hidden.id,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const started = await createWorkItem(tenant, "Other state neighbor");
    const reviewStateId = await concreteStateId(tenant, tenant.review.id);
    await db
      .update(schema.workItemTable)
      .set({ stateId: reviewStateId })
      .where(eq(schema.workItemTable.id, started.id));
    await createLinkedSubmission(tenant, {
      organisationId: customer.orgId,
      requesterId: customer.person.id,
      workItemId: started.id,
    });
    await expect(
      rankPortalBacklog(customer.person.id, {
        key: target.key,
        beforeId: started.id,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const [persisted] = await db
      .select({ position: schema.workItemTable.position })
      .from(schema.workItemTable)
      .where(
        and(
          eq(schema.workItemTable.id, target.id),
          eq(schema.workItemTable.projectId, tenant.project.id),
        ),
      );
    expect(Number(persisted?.position)).toBeGreaterThan(2);

    await db
      .update(schema.workspaceFeatureFlagTable)
      .set({ enabled: false })
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, tenant.workspaceId),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      );
    expect(
      (
        await listPortalBacklog(
          customer.person.id,
          undefined,
          tenant.project.slug,
        )
      ).items,
    ).toHaveLength(0);
    await expect(
      rankPortalBacklog(customer.person.id, {
        key: target.key,
        beforeId: neighbor.id,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const foreignOrgId = `foreign-org-${randomUUID()}`;
    await db.insert(schema.organisationTable).values({
      id: foreignOrgId,
      key: foreignOrgId,
      name: "Different customer organisation",
      isInternal: false,
      portalAccess: true,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: foreignOrgId })
      .where(eq(schema.projectTable.id, tenant.project.id));
    await db
      .update(schema.workspaceFeatureFlagTable)
      .set({ enabled: true })
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, tenant.workspaceId),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      );
    expect(
      (
        await listPortalBacklog(
          customer.person.id,
          undefined,
          tenant.project.slug,
        )
      ).items,
    ).toHaveLength(0);
    await expect(
      rankPortalBacklog(customer.person.id, {
        key: target.key,
        beforeId: neighbor.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
