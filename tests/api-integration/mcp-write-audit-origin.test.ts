import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { timeActivityTable } from "../../apps/api/src/database/schema-p5-time";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { grantProjectRole } from "./helpers/fixtures";
import { makeCustomField } from "./helpers/p4-closeout";
import { setTimeFlags } from "./helpers/p5-time";
import { createItem, setupWorld } from "./helpers/reach-world";

beforeEach(async () => resetTestDatabase());

async function enableMcp() {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.mcp", enabled: true })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true },
    });
}

describe("MCP write audit origin (MC-7a)", () => {
  it("marks each retained write audit as MCP-originated and leaves session audit origin unset", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    const item = await createItem(app, world, "MCP audit target");
    const customField = await makeCustomField(
      world.workspaceId,
      world.type.id,
      {
        key: "mcp_region",
        name: "MCP region",
        format: "text",
      },
    );
    const [itemRow] = await db
      .select({ version: schema.workItemTable.version })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    if (!itemRow) throw new Error("Work item fixture missing");

    await enableMcp();
    await setTimeFlags(world.workspaceId);
    await grantProjectRole(world.admin.user.id, world.project.id, [
      "comment:create",
      "time_entry:create",
    ]);
    await db.insert(timeActivityTable).values({
      workspaceId: world.workspaceId,
      name: "MCP audit activity",
      position: 0,
    });
    const [activity] = await db
      .select({ id: timeActivityTable.id })
      .from(timeActivityTable)
      .where(eq(timeActivityTable.workspaceId, world.workspaceId));
    if (!activity) throw new Error("Time activity fixture missing");

    const person = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, world.admin.user.id))
      .limit(1);
    const personId = person[0]?.id;
    if (!personId) throw new Error("MCP owner person missing");

    const key = await createPersonalApiKey(
      { userId: world.admin.user.id },
      {
        name: "MC-7a audit test",
        isMcp: true,
        capabilities: [
          "work_item:update",
          "work_item:assign",
          "work_item:transition",
          "comment:create",
          "time_entry:create",
        ],
      },
    );

    const mcpRequest = (
      path: string,
      method: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) => {
      mockAnonymousSession();
      return app.request(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-api-key": key.key,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    };

    const update = await mcpRequest(
      `/api/work-items/${encodeURIComponent(item.key)}`,
      "PATCH",
      { title: "MCP-updated title" },
      { "if-match": `"${itemRow.version}"` },
    );
    expect(update.status, await update.clone().text()).toBe(200);

    const [afterTitleUpdate] = await db
      .select({ version: schema.workItemTable.version })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    if (!afterTitleUpdate) throw new Error("Updated work item missing");
    const customFieldUpdate = await mcpRequest(
      `/api/work-items/${encodeURIComponent(item.key)}`,
      "PATCH",
      { customFields: { [customField.key]: "EMEA" } },
      { "if-match": `"${afterTitleUpdate.version}"` },
    );
    expect(
      customFieldUpdate.status,
      await customFieldUpdate.clone().text(),
    ).toBe(200);

    const assign = await mcpRequest(
      `/api/work-items/${encodeURIComponent(item.key)}/assign`,
      "POST",
      { assigneeId: personId, expectedCurrentAssigneeId: null },
    );
    expect(assign.status, await assign.clone().text()).toBe(200);

    const transition = await mcpRequest(
      `/api/work-items/${encodeURIComponent(item.key)}/transition`,
      "POST",
      { toStateTemplateId: world.started.stateTemplate.id },
    );
    expect(transition.status, await transition.clone().text()).toBe(200);

    const comment = await mcpRequest(
      `/api/work-items/${encodeURIComponent(item.key)}/comments`,
      "POST",
      { body: { type: "doc", content: [] }, visibility: "public" },
    );
    expect(comment.status, await comment.clone().text()).toBe(200);
    const commentBody = (await comment.json()) as { id: string };

    const timeEntry = await mcpRequest("/api/time-entries", "POST", {
      workspaceId: world.workspaceId,
      workItemId: item.id,
      date: new Date().toISOString().slice(0, 10),
      minutes: 30,
      activityId: activity.id,
    });
    expect(timeEntry.status, await timeEntry.clone().text()).toBe(201);
    const timeEntryBody = (await timeEntry.json()) as { id: string };

    const expectedAudits = [
      {
        action: "work_item.updated",
        entityType: "work_item",
        entityId: item.id,
      },
      {
        action: "work_item.assigned",
        entityType: "work_item",
        entityId: item.id,
      },
      {
        action: "work_item.transitioned",
        entityType: "work_item",
        entityId: item.id,
      },
      {
        action: "work_item.commented",
        entityType: "comment",
        entityId: commentBody.id,
      },
      {
        action: "time_entry.created",
        entityType: "time_entry",
        entityId: timeEntryBody.id,
      },
    ];
    for (const expected of expectedAudits) {
      const audits = await db
        .select({
          actorId: schema.auditLogTable.actorId,
          actorType: schema.auditLogTable.actorType,
          action: schema.auditLogTable.action,
          entityType: schema.auditLogTable.entityType,
          after: schema.auditLogTable.after,
        })
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.entityId, expected.entityId),
            eq(schema.auditLogTable.action, expected.action),
            eq(schema.auditLogTable.entityType, expected.entityType),
          ),
        )
        .orderBy(schema.auditLogTable.seq);
      expect(audits.length, expected.action).toBeGreaterThan(0);
      for (const audit of audits) {
        expect(audit, expected.action).toMatchObject({
          actorId: world.admin.user.id,
          actorType: "api_key",
          action: expected.action,
          entityType: expected.entityType,
          after: expect.objectContaining({ origin: "mcp" }),
        });
      }
    }

    const updateAudits = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, item.id),
          eq(schema.auditLogTable.action, "work_item.updated"),
        ),
      )
      .orderBy(schema.auditLogTable.seq);
    expect(updateAudits.map(({ after }) => after)).toEqual([
      { changedFields: ["title"], origin: "mcp" },
      { changedFields: ["custom_field"], origin: "mcp" },
    ]);

    const regularApiKey = await createPersonalApiKey(
      { userId: world.admin.user.id },
      {
        name: "MC-7a regular API audit control",
        capabilities: ["work_item:update"],
      },
    );
    const [beforeRegularKeyUpdate] = await db
      .select({ version: schema.workItemTable.version })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    if (!beforeRegularKeyUpdate)
      throw new Error("Work item before regular key update missing");
    mockAnonymousSession();
    const regularKeyUpdate = await app.request(
      `/api/work-items/${encodeURIComponent(item.key)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-api-key": regularApiKey.key,
          "if-match": `"${beforeRegularKeyUpdate.version}"`,
        },
        body: JSON.stringify({ title: "Regular API-updated title" }),
      },
    );
    expect(regularKeyUpdate.status, await regularKeyUpdate.clone().text()).toBe(
      200,
    );
    const regularKeyAudits = await db
      .select({
        actorId: schema.auditLogTable.actorId,
        actorType: schema.auditLogTable.actorType,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, item.id),
          eq(schema.auditLogTable.action, "work_item.updated"),
        ),
      )
      .orderBy(schema.auditLogTable.seq);
    expect(regularKeyAudits.at(-1)).toMatchObject({
      actorId: world.admin.user.id,
      actorType: "api_key",
      after: { changedFields: ["title"] },
    });
    expect(regularKeyAudits.at(-1)?.after).not.toHaveProperty("origin");

    mockAuthenticatedSession(world.admin.user);
    const [currentItem] = await db
      .select({ version: schema.workItemTable.version })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    if (!currentItem) throw new Error("Current work item missing");
    const sessionUpdate = await app.request(
      `/api/work-items/${encodeURIComponent(item.key)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": `"${currentItem.version}"`,
        },
        body: JSON.stringify({ title: "Session-updated title" }),
      },
    );
    expect(sessionUpdate.status, await sessionUpdate.clone().text()).toBe(200);
    const sessionAudits = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, item.id),
          eq(schema.auditLogTable.action, "work_item.updated"),
        ),
      )
      .orderBy(schema.auditLogTable.seq);
    const sessionUpdateAudit = sessionAudits[sessionAudits.length - 1];
    expect(sessionUpdateAudit?.after).not.toHaveProperty("origin");
  });
});
