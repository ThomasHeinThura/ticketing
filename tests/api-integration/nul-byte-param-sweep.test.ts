import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function seedTask(projectId: string, columnId: string, userId?: string) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: "Seeded task",
        description: "Existing",
        priority: "medium",
        status: "to-do",
        columnId,
        number: 1,
        position: 1,
        ...(userId ? { userId } : {}),
      })
      .returning(),
    "seedTask",
  );
}

// Issue #281 (follow-up to #277's Opus review): raw `c.req.param()`/`c.req.query()`
// reads outside `workspace-access-middleware.ts` (and `require-work-item-reach.ts`,
// which already carries this same check) still reached Postgres unvalidated -- a NUL
// (`\u0000`) byte made `pg` throw, surfacing as an unhandled 500 instead of a clean
// 400. `apps/api/src/utils/reject-nul-byte.ts` is the shared fix; these are the real
// routes the review's "not audited by #277" list named as unaudited, each proven here
// through the actual route, not the helper in isolation.
describe("API integration: #281 NUL-byte sweep on raw param/query reads", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("DELETE /api/task-relation/{id}: a NUL byte in the id is a clean 400, not a 500 (scopeToRelation reads the raw param with no preceding workspaceAccess.* guard)", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/task-relation/${encodeURIComponent("\u0000x")}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(400);
  });

  it("GET /api/invitation/public/{id}: a NUL byte in the id is a clean 400, not a 500 (this route is public -- no session required)", async () => {
    const { app } = createApp();

    const response = await app.request(
      `/api/invitation/public/${encodeURIComponent("\u0000x")}`,
    );

    expect(response.status).toBe(400);
  });

  it("GET /api/asset/{id}: a NUL byte in the id is a clean 400, not a 500", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/asset/${encodeURIComponent("\u0000x")}`,
    );

    expect(response.status).toBe(400);
  });

  it("GET /api/ws/{projectId}: a NUL byte in the optional projectId is a clean 400, not a 500", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/ws/${encodeURIComponent("\u0000x")}`,
      { headers: { Upgrade: "websocket", Connection: "Upgrade" } },
    );

    expect(response.status).toBe(400);
  });
});

// Issue #285's S4 finding, and this sweep's own follow-up: a NUL byte in a JSON BODY
// id field that reaches a DB lookup directly -- not through a `workspaceAccess.*`
// source, and not through `scopeToRelation`'s already-guarded path param -- also
// 500'd. Each case below names the exact unguarded field and where the guard landed.
describe("issue #290 (S4): NUL-byte sweep on body id fields that reach a DB lookup", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("POST /api/task-relation: a NUL byte in sourceTaskId is a clean 400, not a 500 (scopeToSourceTask)", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/task-relation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceTaskId: "\u0000x",
        targetTaskId: task.id,
        relationType: "blocks",
      }),
    });

    expect(response.status).toBe(400);
  });

  it("POST /api/task-relation: a NUL byte in targetTaskId is a clean 400, not a 500 (create-task-relation.ts)", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/task-relation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceTaskId: task.id,
        targetTaskId: "\u0000x",
        relationType: "blocks",
      }),
    });

    expect(response.status).toBe(400);
  });

  it("PUT /api/label/{id}/task: a NUL byte in the taskId body field is a clean 400, not a 500 (assign-label-to-task.ts)", async () => {
    const member = await createWorkspaceMember();
    const { workspace } = member;
    const label = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: workspace.id,
          name: "Bug",
          color: "#ef4444",
        })
        .returning(),
      "label",
    );
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/label/${label.id}/task`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "\u0000x" }),
    });

    expect(response.status).toBe(400);
  });

  it("POST /api/label: a NUL byte in the optional taskId body field is a clean 400, not a 500 (create-label.ts)", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/label", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Bug",
        color: "#ef4444",
        workspaceId: member.workspace.id,
        taskId: "\u0000x",
      }),
    });

    expect(response.status).toBe(400);
  });

  it("PUT /api/workflow-rule/{projectId}: a NUL byte in the columnId body field is a clean 400, not a 500 (upsert-workflow-rule.ts)", async () => {
    // "member" lacks project:update; the route's own permission gate would 403
    // before this test could reach the NUL check.
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/workflow-rule/${project.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        integrationType: "github",
        eventType: "issue.closed",
        columnId: "\u0000x",
      }),
    });

    expect(response.status).toBe(400);
  });

  it("PUT /api/task/move/{id}: a NUL byte in the destinationProjectId body field is a clean 400, not a 500 (move-task.ts)", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/move/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationProjectId: "\u0000x" }),
    });

    expect(response.status).toBe(400);
  });

  it("PUT /api/task/assignee/{id}: a NUL byte in the userId body field is a clean 400, not a 500 (update-task-assignee.ts)", async () => {
    // "member" lacks task:assign; the route's own permission gate would 403 before
    // this test could reach the NUL check.
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/assignee/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "\u0000x" }),
    });

    expect(response.status).toBe(400);
  });

  it("PUT /api/task/assignee/{id}: null userId (unassign) still works -- the NUL guard only runs on a real string", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/assignee/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: null }),
    });

    expect(response.status).toBe(200);
  });
});
