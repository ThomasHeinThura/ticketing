import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { assertCallerHasCapability } from "../../apps/api/src/utils/require-workspace-capability";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";
import { portalAs, seedIntake, staffAs } from "./helpers/intake-http";

const addGroupType = async (
  workspaceId: string,
  workItemTypeId: string,
  group: string,
  position: number,
) =>
  requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId,
        key: `group-${group.toLowerCase()}`,
        name: `${group} request`,
        group,
        workItemTypeId,
        formSchema: { fields: [] },
        position,
      })
      .returning(),
    `request type for ${group}`,
  );

const groupOrderUrl = (workspaceId: string) =>
  `/api/request-type-groups/order?workspaceId=${encodeURIComponent(workspaceId)}`;

describe("request type group order", () => {
  beforeEach(async () => resetTestDatabase());

  it("returns current groups and persists only a complete versioned permutation", async () => {
    const seeded = await seedIntake("group-order-valid");
    await addGroupType(seeded.t.workspaceId, seeded.t.type.id, "Support", 1);
    await addGroupType(seeded.t.workspaceId, seeded.t.type.id, "Hardware", 2);

    const initialResponse = await staffAs(
      seeded.t,
      seeded.t.requester.user,
      groupOrderUrl(seeded.t.workspaceId),
    );
    expect(initialResponse.status, await initialResponse.clone().text()).toBe(
      200,
    );
    const initial = (await initialResponse.json()) as {
      groupOrder: { groups: string[]; version: number };
    };
    expect(initial.groupOrder.groups).toEqual([
      "General",
      "Support",
      "Hardware",
    ]);
    expect(initial.groupOrder.version).toBe(1);

    const savedResponse = await staffAs(
      seeded.t,
      seeded.t.requester.user,
      groupOrderUrl(seeded.t.workspaceId),
      {
        method: "PUT",
        body: {
          groups: ["Hardware", "General", "Support"],
          version: initial.groupOrder.version,
        },
      },
    );
    expect(savedResponse.status, await savedResponse.clone().text()).toBe(200);
    expect(await savedResponse.json()).toEqual({
      groupOrder: { groups: ["Hardware", "General", "Support"], version: 2 },
    });
    const [stored] = await db
      .select()
      .from(schema.requestTypeGroupOrderTable)
      .where(
        eq(schema.requestTypeGroupOrderTable.workspaceId, seeded.t.workspaceId),
      );
    expect(stored?.orderedGroups).toEqual(["Hardware", "General", "Support"]);
    expect(stored?.version).toBe(2);

    const stale = await staffAs(
      seeded.t,
      seeded.t.requester.user,
      groupOrderUrl(seeded.t.workspaceId),
      {
        method: "PUT",
        body: { groups: ["Support", "Hardware", "General"], version: 1 },
      },
    );
    expect(stale.status).toBe(409);

    const invalid = await staffAs(
      seeded.t,
      seeded.t.requester.user,
      groupOrderUrl(seeded.t.workspaceId),
      { method: "PUT", body: { groups: ["Hardware", "General"], version: 2 } },
    );
    expect(invalid.status).toBe(422);

    const noOp = await staffAs(
      seeded.t,
      seeded.t.requester.user,
      groupOrderUrl(seeded.t.workspaceId),
      {
        method: "PUT",
        body: { groups: ["Hardware", "General", "Support"], version: 2 },
      },
    );
    expect(noOp.status, await noOp.clone().text()).toBe(200);
    expect(await noOp.json()).toEqual({
      groupOrder: { groups: ["Hardware", "General", "Support"], version: 2 },
    });

    const audit = await db
      .select({
        action: schema.auditLogTable.action,
        before: schema.auditLogTable.before,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(
        eq(schema.auditLogTable.action, "request_type.group_order_updated"),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      before: { version: 1, groupCount: 3 },
      after: { version: 2, groupCount: 3, changedFields: ["groupOrder"] },
    });
    expect(JSON.stringify(audit[0])).not.toContain("Hardware");
    expect(JSON.stringify(audit[0])).not.toContain("General");
    expect(JSON.stringify(audit[0])).not.toContain("Support");
  });

  it("serializes concurrent group replacements through the workspace lock and CAS version", async () => {
    const seeded = await seedIntake("group-order-race");
    await addGroupType(seeded.t.workspaceId, seeded.t.type.id, "Support", 1);
    await addGroupType(seeded.t.workspaceId, seeded.t.type.id, "Hardware", 2);
    const initialResponse = await staffAs(
      seeded.t,
      seeded.t.requester.user,
      groupOrderUrl(seeded.t.workspaceId),
    );
    const { groupOrder } = (await initialResponse.json()) as {
      groupOrder: { groups: string[]; version: number };
    };
    const [first, second] = await Promise.all([
      staffAs(
        seeded.t,
        seeded.t.requester.user,
        groupOrderUrl(seeded.t.workspaceId),
        {
          method: "PUT",
          body: {
            groups: ["Support", "Hardware", "General"],
            version: groupOrder.version,
          },
        },
      ),
      staffAs(
        seeded.t,
        seeded.t.requester.user,
        groupOrderUrl(seeded.t.workspaceId),
        {
          method: "PUT",
          body: {
            groups: ["Hardware", "General", "Support"],
            version: groupOrder.version,
          },
        },
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const [stored] = await db
      .select({ version: schema.requestTypeGroupOrderTable.version })
      .from(schema.requestTypeGroupOrderTable)
      .where(
        eq(schema.requestTypeGroupOrderTable.workspaceId, seeded.t.workspaceId),
      );
    expect(stored?.version).toBe(groupOrder.version + 1);
    const [audits] = await db
      .select({ count: count() })
      .from(schema.auditLogTable)
      .where(
        eq(schema.auditLogTable.action, "request_type.group_order_updated"),
      );
    expect(Number(audits?.count)).toBe(1);
  });

  it("denies a member and a portal session without changing the stored order", async () => {
    const seeded = await seedIntake("group-order-deny");
    const order = await staffAs(
      seeded.t,
      seeded.t.requester.user,
      groupOrderUrl(seeded.t.workspaceId),
    );
    const { groupOrder } = (await order.json()) as {
      groupOrder: { groups: string[]; version: number };
    };
    const member = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: seeded.t.workspaceId,
      userId: member.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const memberRoles = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, seeded.t.workspaceId));
    expect(memberRoles.map((row) => row.role)).toContain("member");
    await expect(
      assertCallerHasCapability(
        seeded.t.workspaceId,
        member.user.id,
        "request_type:manage",
        { kind: "session" },
      ),
    ).rejects.toMatchObject({ status: 403 });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const memberWrite = await app.request(groupOrderUrl(seeded.t.workspaceId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        groups: groupOrder.groups,
        version: groupOrder.version,
      }),
    });
    expect(memberWrite.status).toBe(403);

    const portalRead = await portalAs(
      seeded.t,
      seeded.customer.user,
      groupOrderUrl(seeded.t.workspaceId),
    );
    expect([403, 404]).toContain(portalRead.status);

    const [stored] = await db
      .select()
      .from(schema.requestTypeGroupOrderTable)
      .where(
        eq(schema.requestTypeGroupOrderTable.workspaceId, seeded.t.workspaceId),
      );
    expect(stored?.version ?? 1).toBe(groupOrder.version);
  });
});
