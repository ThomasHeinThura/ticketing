import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

describe("API integration: task creation", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated task creation requests", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Unauthorized task",
        description: "Should not be created",
        priority: "low",
        status: "to-do",
      }),
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Unauthorized");
  });

  it("creates a task with the matching column, assignee, and next number", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Delivery",
      slug: "delivery",
    });

    await db.insert(schema.taskTable).values({
      projectId: project.id,
      userId: member.user.id,
      title: "Existing task",
      description: "Already there",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    });
    await db
      .update(schema.projectTable)
      .set({ lastTaskNumber: 1 })
      .where(eq(schema.projectTable.id, project.id));

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Ship integration flow",
        description: "Cover the first create-task path",
        priority: "high",
        status: "to-do",
        userId: member.user.id,
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      projectId: string;
      title: string;
      description: string;
      priority: string;
      status: string;
      userId: string | null;
      number: number | null;
      position: number | null;
      assigneeName?: string;
    };

    expect(payload).toMatchObject({
      projectId: project.id,
      title: "Ship integration flow",
      description: "Cover the first create-task path",
      priority: "high",
      status: "to-do",
      userId: member.user.id,
      number: 2,
      position: 2,
      assigneeName: member.user.name,
    });

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, payload.id),
    });

    expect(persistedTask).toMatchObject({
      id: payload.id,
      projectId: project.id,
      columnId: columns.todo.id,
      userId: member.user.id,
      title: "Ship integration flow",
      priority: "high",
      status: "to-do",
      number: 2,
      position: 2,
    });
  });

  it("issue #290: rejects task creation for users outside the project workspace with the same 400 an unknown project id gets, not a 403 that leaks the project's existence", async () => {
    const member = await createWorkspaceMember();
    const outsiderId = `user-${randomUUID()}`;
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const outsider = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: outsiderId,
          email: `${outsiderId}@example.com`,
          emailVerified: true,
          name: "Task Outsider",
        })
        .returning(),
      "outsider",
    );

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Forbidden task",
        description: "Should not be created",
        priority: "low",
        status: "to-do",
      }),
    });

    // Before #290, an existing-but-out-of-reach project answered 403 here, while an
    // outright unknown project id answered 400 -- a caller could tell the two apart.
    // `workspaceAccess.fromProject` now gives this the identical 400 body a nonexistent
    // project id gets (#202's own precedent for this helper), never the 403.
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Workspace ID could not be determined",
    );

    const persistedTask = await db.query.taskTable.findFirst({
      where: and(
        eq(schema.taskTable.projectId, project.id),
        eq(schema.taskTable.title, "Forbidden task"),
      ),
    });

    expect(persistedTask).toBeUndefined();
  });

  it("creates an unassigned task with parsed dates when optional fields are provided", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Plan release cut",
        description: "Track optional fields too",
        priority: "medium",
        status: "in-progress",
        startDate: "2026-04-01T09:00:00.000Z",
        dueDate: "2026-04-05T17:00:00.000Z",
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      userId: string | null;
      columnId: string | null;
      startDate: string | null;
      dueDate: string | null;
      assigneeName?: string;
    };

    expect(payload).toMatchObject({
      userId: null,
      columnId: columns.inProgress.id,
      startDate: "2026-04-01T09:00:00.000Z",
      dueDate: "2026-04-05T17:00:00.000Z",
    });
    expect(payload.assigneeName).toBeUndefined();

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, payload.id),
    });

    expect(persistedTask).toMatchObject({
      id: payload.id,
      userId: null,
      columnId: columns.inProgress.id,
      status: "in-progress",
    });
    expect(persistedTask?.startDate?.toISOString()).toBe(
      "2026-04-01T09:00:00.000Z",
    );
    expect(persistedTask?.dueDate?.toISOString()).toBe(
      "2026-04-05T17:00:00.000Z",
    );
  });

  it("creates tasks without a column when the status has no matching project column", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Future status task",
        description: "Status does not map to a seeded column",
        priority: "low",
        status: "planned",
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      status: string;
      columnId: string | null;
      position: number | null;
    };

    expect(payload).toMatchObject({
      status: "planned",
      columnId: null,
      position: 1,
    });

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, payload.id),
    });

    expect(persistedTask).toMatchObject({
      id: payload.id,
      status: "planned",
      columnId: null,
      position: 1,
    });
  });

  it("rejects task creation for an assignee that cannot be assigned, without revealing whether the user exists", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const missingAssigneeId = `user-${randomUUID()}`;

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Ghost assignee task",
        description: "Should fail because the assignee does not exist",
        priority: "low",
        status: "to-do",
        userId: missingAssigneeId,
      }),
    });

    // A missing user and a non-member both answer 403 with the same message, so
    // the endpoint cannot be used to probe which user ids exist.
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain(
      "Assignee is not a member of this workspace",
    );

    const persistedTask = await db.query.taskTable.findFirst({
      where: and(
        eq(schema.taskTable.projectId, project.id),
        eq(schema.taskTable.title, "Ghost assignee task"),
      ),
    });

    expect(persistedTask).toBeUndefined();
  });

  it("creates a task when the assignee userId is surrounded by whitespace", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const paddedAssigneeId = `  ${member.user.id}  `;

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Padded assignee task",
        description: "Whitespace around userId should be trimmed",
        priority: "medium",
        status: "to-do",
        userId: paddedAssigneeId,
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      userId: string;
      assigneeName?: string;
    };

    expect(payload.userId).toBe(member.user.id);
    expect(payload.assigneeName).toBe(member.user.name);

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, payload.id),
    });

    expect(persistedTask).toMatchObject({
      id: payload.id,
      projectId: project.id,
      columnId: columns.todo.id,
      userId: member.user.id,
      title: "Padded assignee task",
    });
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
  ])(
    "creates an unassigned task when the assignee userId is %s",
    async (label, userId) => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const title = `Blank assignee task (${label})`;
      const response = await app.request(`/api/task/${project.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title,
          description: "Blank userId means unassigned",
          priority: "low",
          status: "to-do",
          userId,
        }),
      });

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        userId: string | null;
        assigneeName?: string;
      };

      expect(payload.userId).toBeNull();
      expect(payload.assigneeName).toBeUndefined();

      const persistedTask = await db.query.taskTable.findFirst({
        where: and(
          eq(schema.taskTable.projectId, project.id),
          eq(schema.taskTable.title, title),
        ),
      });

      expect(persistedTask?.userId).toBeNull();
    },
  );

  it("returns 404 for task creation against a soft-deleted project (#187)", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Should not be created",
        description: "The target project is soft-deleted",
        priority: "low",
        status: "to-do",
      }),
    });

    expect(response.status).toBe(404);

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.projectId, project.id),
    });
    expect(persistedTask).toBeUndefined();
  });

  it("T4 follow-up (ordinary review of #277, the #271 delta-round PR): a NUL byte in GET /api/task/{id} is a 400, not a fall-through to ?workspaceId= and a later 500", async () => {
    // `GET /api/task/{id}` is one of the 8 real routes gated by a `[{ type: "lookup" },
    // { type: "query", key: "workspaceId" }]`-shaped `workspaceAccess` helper
    // (`workspaceAccess.fromTask()`, `task/index.ts`'s `getTaskRoute`). Before this fix, a
    // NUL-bearing `id` was treated as ABSENT, which let the loop fall through to the
    // caller's own `?workspaceId=` and pass the middleware against a real workspace the
    // caller genuinely belongs to -- issue #256's fallback class -- only to 500 once the
    // handler tried to look the NUL id up itself. This proves the real route, not just the
    // middleware in isolation, refuses it up front.
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/task/${encodeURIComponent("\u0000x")}?workspaceId=${member.workspace.id}`,
    );

    expect(response.status).toBe(400);
  });

  it("issue #256: GET /api/task/{id} for a nonexistent task with ?workspaceId=<the caller's own workspace> is 404, not a fall-through 200", async () => {
    // Before #256, a well-formed but nonexistent task id fell through to the
    // caller-supplied `?workspaceId=` (naming the caller's OWN real workspace, the
    // strongest case for the fallback) and PASSED `workspaceAccess.fromTask()` against
    // it, reaching `getTaskRoute`'s handler. Now the middleware itself 404s, before any
    // handler runs. This closes the query-fallback gap #256 reports; it does NOT by
    // itself close the existence oracle -- until #290, an *other-tenant* task still
    // answered 403 here, distinguishable from this 404. #290's fix in
    // `workspace-access-middleware.ts` makes those two cases byte-identical; see
    // `tests/api/utils/workspace-access-middleware.test.ts` for the helper-level proof.
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/task/task-does-not-exist?workspaceId=${member.workspace.id}`,
    );

    expect(response.status).toBe(404);
  });
});
