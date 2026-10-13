import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  listOwnSubmissions,
  portalCatalogue,
} from "../../apps/api/src/intake/repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function createRequestType(workspaceId: string) {
  const workItemType = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "work-item type",
  );
  return requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId,
        key: `request-${randomUUID()}`,
        name: "Help",
        group: "General",
        workItemTypeId: workItemType.id,
        formSchema: { fields: [] },
      })
      .returning(),
    "request type",
  );
}

describe("intake feature-flag reach", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps item-addressed request-type routes unavailable at the default-off setting", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const type = await createRequestType(member.workspace.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const requests: Array<[string, RequestInit?]> = [
      [`/api/request-types/${type.id}`],
      [
        `/api/request-types/${type.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: 1 }),
        },
      ],
      [`/api/request-types/${type.id}/publish`, { method: "POST" }],
      [`/api/request-types/${type.id}/unpublish`, { method: "POST" }],
    ];
    for (const [path, init] of requests) {
      const response = await app.request(path, init);
      expect(response.status, `${init?.method ?? "GET"} ${path}`).toBe(404);
    }
  });

  it("filters disabled-workspace submissions from rows, total, and page metadata", async () => {
    const enabledMember = await createWorkspaceMember({ role: "admin" });
    const disabledMember = await createWorkspaceMember({ role: "admin" });
    const enabledType = await createRequestType(enabledMember.workspace.id);
    const disabledType = await createRequestType(disabledMember.workspace.id);
    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({ key: `customer-${randomUUID()}`, name: "Customer" })
        .returning(),
      "customer organisation",
    );
    const requesterUser = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `customer-${randomUUID()}`,
          email: `customer-${randomUUID()}@example.com`,
          emailVerified: true,
          name: "Requester",
        })
        .returning(),
      "customer user",
    );
    const requester = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          userId: requesterUser.id,
          organisationId: organisation.id,
          side: "customer",
          displayName: "Requester",
        })
        .returning(),
      "customer person",
    );

    await db.insert(schema.instanceFeatureFlagTable).values({
      featureKey: "feature.intake",
      enabled: true,
      locked: false,
    });
    // Rows for an unrelated feature are inserted first, with the opposite value, so a
    // query that does not filter on the intake key reads the wrong row.
    await db.insert(schema.workspaceFeatureFlagTable).values([
      {
        workspaceId: enabledMember.workspace.id,
        featureKey: "feature.approvals",
        enabled: false,
      },
      {
        workspaceId: disabledMember.workspace.id,
        featureKey: "feature.approvals",
        enabled: true,
      },
    ]);
    await db.insert(schema.workspaceFeatureFlagTable).values([
      {
        workspaceId: enabledMember.workspace.id,
        featureKey: "feature.intake",
        enabled: true,
      },
      {
        workspaceId: disabledMember.workspace.id,
        featureKey: "feature.intake",
        enabled: false,
      },
    ]);

    const versionIds = new Map<string, string>();
    for (const [type, workspaceId] of [
      [enabledType, enabledMember.workspace.id],
      [disabledType, disabledMember.workspace.id],
    ] as const) {
      const version = requireRow(
        await db
          .insert(schema.requestTypeVersionTable)
          .values({
            workspaceId,
            requestTypeId: type.id,
            number: 1,
            formSchema: { fields: [] },
            workItemTypeId: type.workItemTypeId,
          })
          .returning(),
        "request type version",
      );
      versionIds.set(type.id, version.id);
      await db.insert(schema.submissionTable).values({
        organisationId: organisation.id,
        requesterId: requester.id,
        requestTypeId: type.id,
        requestTypeVersionId: version.id,
        formData: {},
        state: "new",
        submittedAt: new Date(),
      });
    }

    const enabledVersionId = versionIds.get(enabledType.id);
    if (!enabledVersionId) throw new Error("enabled version fixture missing");
    await db.insert(schema.submissionTable).values({
      organisationId: organisation.id,
      requesterId: requester.id,
      requestTypeId: enabledType.id,
      requestTypeVersionId: enabledVersionId,
      formData: {},
      state: "new",
      submittedAt: new Date(),
    });

    const firstPage = await listOwnSubmissions(requesterUser.id, undefined, 1);

    expect(firstPage.submissions).toHaveLength(1);
    expect(firstPage.submissions[0]?.requestType.id).toBe(enabledType.id);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).toBeTruthy();
    expect(firstPage.meta.total).toBe(2);

    const secondPage = await listOwnSubmissions(
      requesterUser.id,
      firstPage.page.nextCursor ?? undefined,
      1,
    );
    expect(secondPage.submissions).toHaveLength(1);
    expect(secondPage.submissions[0]?.requestType.id).toBe(enabledType.id);
    expect(secondPage.page).toEqual({ nextCursor: null, hasMore: false });
    expect(secondPage.meta.total).toBe(2);
  });

  it("resolves the portal catalogue from the intake flag, not other workspace flags", async () => {
    const enabledMember = await createWorkspaceMember({ role: "admin" });
    const disabledMember = await createWorkspaceMember({ role: "admin" });
    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({ key: `customer-${randomUUID()}`, name: "Customer" })
        .returning(),
      "customer organisation",
    );
    const types = [];
    for (const workspaceId of [
      enabledMember.workspace.id,
      disabledMember.workspace.id,
    ]) {
      const type = await createRequestType(workspaceId);
      await db.insert(schema.requestTypeVersionTable).values({
        workspaceId,
        requestTypeId: type.id,
        number: 1,
        formSchema: { fields: [] },
        workItemTypeId: type.workItemTypeId,
      });
      await db
        .update(schema.requestTypeTable)
        .set({ published: true, customerVisible: true })
        .where(eq(schema.requestTypeTable.id, type.id));
      await db.insert(schema.organisationRequestTypeTable).values({
        organisationId: organisation.id,
        requestTypeId: type.id,
      });
      types.push(type);
    }
    const [enabledType, disabledType] = types;
    if (!enabledType || !disabledType) throw new Error("type fixtures missing");

    await db.insert(schema.instanceFeatureFlagTable).values({
      featureKey: "feature.intake",
      enabled: true,
      locked: false,
    });
    await db.insert(schema.workspaceFeatureFlagTable).values([
      {
        workspaceId: enabledMember.workspace.id,
        featureKey: "feature.approvals",
        enabled: false,
      },
      {
        workspaceId: disabledMember.workspace.id,
        featureKey: "feature.approvals",
        enabled: true,
      },
    ]);
    await db.insert(schema.workspaceFeatureFlagTable).values([
      {
        workspaceId: enabledMember.workspace.id,
        featureKey: "feature.intake",
        enabled: true,
      },
      {
        workspaceId: disabledMember.workspace.id,
        featureKey: "feature.intake",
        enabled: false,
      },
    ]);

    const catalogue = JSON.stringify(await portalCatalogue(organisation.id));
    expect(catalogue).toContain(enabledType.id);
    expect(catalogue).not.toContain(disabledType.id);
  });
});
