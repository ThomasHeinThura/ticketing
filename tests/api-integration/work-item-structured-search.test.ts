import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";

describe("POST /api/work-items/search", () => {
  beforeEach(async () => resetTestDatabase());

  it("uses the explicit workspace scope and applies the bounded filter before counting", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const foreign = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.id, [
      "work_item:read",
      "project:read",
    ]);
    const now = new Date();
    const [type] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: member.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const [template] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: member.workspace.id,
        key: `state-${randomUUID()}`,
        name: "Started",
        group: "started",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!template) throw new Error("Search state template creation failed");
    const [state] = await db
      .insert(schema.stateTable)
      .values({
        projectId: project.id,
        stateTemplateId: template.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!type || !template || !state)
      throw new Error("Search fixture creation failed");
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const createdResponse = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Search target",
          priority: "high",
        }),
      },
    );
    expect(createdResponse.status).toBe(200);
    const item = (await createdResponse.json()) as { id: string };
    const secondCreated = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Second search target",
          priority: "high",
        }),
      },
    );
    expect(secondCreated.status).toBe(200);
    const lowCreated = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Low priority target",
          priority: "low",
        }),
      },
    );
    expect(lowCreated.status).toBe(200);
    const hiddenProject = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db.insert(schema.stateTable).values({
      projectId: hiddenProject.project.id,
      stateTemplateId: template.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    const hiddenProjectItem = await app.request(
      `/api/projects/${hiddenProject.project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Unreachable project target",
          priority: "high",
        }),
      },
    );
    expect(
      hiddenProjectItem.status,
      await hiddenProjectItem.clone().text(),
    ).toBe(200);

    const response = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: {
          entity: "work_item",
          filter: { field: "priority", op: "eq", value: "high" },
        },
        limit: 1,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string }[];
      page: { nextCursor: string | null; hasMore: boolean };
      meta: { total: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(item.id);
    expect(body.page.hasMore).toBe(true);
    expect(body.page.nextCursor).toEqual(expect.any(String));
    expect(body.meta.total).toBe(2);
    expect(body.data.map((row) => row.id)).not.toContain(
      ((await hiddenProjectItem.json()) as { id: string }).id,
    );
    const nextPage = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: {
          entity: "work_item",
          filter: { field: "priority", op: "eq", value: "high" },
        },
        limit: 1,
        cursor: body.page.nextCursor,
      }),
    });
    expect(nextPage.status).toBe(200);
    const nextBody = (await nextPage.json()) as {
      data: { id: string }[];
      meta: { total: number };
    };
    expect(nextBody.data[0]?.id).not.toBe(body.data[0]?.id);
    expect(nextBody.meta.total).toBe(2);
    const changedLimit = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: {
          entity: "work_item",
          filter: { field: "priority", op: "eq", value: "high" },
        },
        limit: 2,
        cursor: body.page.nextCursor,
      }),
    });
    expect(changedLimit.status).toBe(400);
    const malformedCursor = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: { entity: "work_item" },
        cursor: "not-a-cursor",
      }),
    });
    expect(malformedCursor.status).toBe(400);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: member.workspace.id,
      userId: foreign.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantProjectRole(foreign.user.id, project.id, ["work_item:read"]);
    mockAuthenticatedSession(foreign.user);
    const otherActorCursor = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: {
          entity: "work_item",
          filter: { field: "priority", op: "eq", value: "high" },
        },
        limit: 1,
        cursor: body.page.nextCursor,
      }),
    });
    expect(otherActorCursor.status).toBe(400);
    mockAuthenticatedSession(member.user);
    const mismatchedCursor = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: {
          entity: "work_item",
          filter: { field: "priority", op: "eq", value: "urgent" },
        },
        limit: 1,
        cursor: body.page.nextCursor,
      }),
    });
    expect(mismatchedCursor.status).toBe(400);
    const projectFieldResponse = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: {
          entity: "work_item",
          filter: { field: "project", op: "eq", value: project.slug },
        },
      }),
    });
    expect(projectFieldResponse.status).toBe(200);
    const projectFieldBody = (await projectFieldResponse.json()) as {
      meta: { total: number };
    };
    expect(projectFieldBody.meta.total).toBe(3);

    const nestedAst = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: {
          entity: "work_item",
          filter: {
            op: "or",
            clauses: [
              {
                op: "and",
                clauses: [
                  { field: "priority", op: "eq", value: "high" },
                  { field: "project", op: "eq", value: project.slug },
                ],
              },
              { field: "priority", op: "eq", value: "low" },
            ],
          },
        },
      }),
    });
    expect(nestedAst.status).toBe(200);
    const nestedBody = (await nestedAst.json()) as {
      data: { id: string; priority: string | null }[];
      meta: { total: number };
    };
    expect(nestedBody.meta.total).toBe(3);
    expect(nestedBody.data.map((row) => row.priority).sort()).toEqual([
      "high",
      "high",
      "low",
    ]);
  });

  it("rejects unknown and unavailable fields and report clauses rather than ignoring them", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const foreign = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const send = (query: unknown) =>
      app.request("/api/work-items/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: member.workspace.id, query }),
      });
    expect(
      (await send({ entity: "work_item", groupBy: ["state"] })).status,
    ).toBe(422);
    expect(
      (
        await send({
          entity: "work_item",
          filter: { field: "notAField", op: "eq", value: "x" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          entity: "work_item",
          filter: { field: "label", op: "eq", value: "urgent" },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await send({
          entity: "work_item",
          filter: { field: "project", op: "eq", value: "OUT-OF-SCOPE" },
        })
      ).status,
    ).toBe(422);
    const foreignScope = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: foreign.workspace.id,
        query: { entity: "work_item" },
      }),
    });
    expect(foreignScope.status).toBe(404);
    const missingScope = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: { entity: "work_item" } }),
    });
    expect(missingScope.status).toBe(400);
    const oversized = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: { entity: "work_item" },
        padding: "x".repeat(33_000),
      }),
    });
    expect(oversized.status).toBe(400);
    expect(
      (
        await send({
          entity: "work_item",
          filter: {
            op: "and",
            clauses: [
              { field: "priority", op: "eq", value: "high", extra: true },
            ],
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          entity: "work_item",
          filter: { field: "priority", op: "contains", value: "high" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          entity: "work_item",
          filter: {
            op: "or",
            clauses: [
              { field: "priority", op: "eq", value: "high' OR TRUE --" },
              { field: "priority", op: "eq", value: "low" },
            ],
          },
        })
      ).status,
    ).toBe(400);
  });

  it("keeps API-key reads below the personal-key capability ceiling", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const rawKey = `taskdesk_search_${randomUUID()}`;
    const keyHash = createHash("sha256")
      .update(rawKey)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      referenceId: member.user.id,
      userId: member.user.id,
      key: keyHash,
      name: "structured search ceiling test",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();
    const response = await app.request("/api/work-items/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": rawKey,
      },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: { entity: "work_item" },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });
});
