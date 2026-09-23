import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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

type CreateTaskBody = {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  status: string;
};

async function seedTask(
  projectId: string,
  columnId: string | null,
  userId?: string,
  status = "to-do",
) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: "Seeded task",
        description: "Existing",
        priority: "medium",
        status,
        columnId,
        number: 1,
        position: 1,
        ...(userId ? { userId } : {}),
      })
      .returning(),
    "seedTask",
  );
}

async function createWorkspaceRoleRow(
  workspaceId: string,
  role: string,
  permission: Record<string, string[]> | string,
) {
  // Delete-then-insert rather than a blind insert: `createWorkspaceMember`
  // now auto-seeds a `workspace_role` row for default role names (issue
  // #66), so a test that overrides one of those roles' permissions (e.g.
  // "viewer") would otherwise leave TWO rows for the same
  // (workspaceId, role) pair -- there is no unique constraint on that pair
  // at the DB level -- and which one `hasWorkspacePermission`'s
  // unordered `.limit(1)` picks would be undefined.
  await db
    .delete(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role,
    permission:
      typeof permission === "string" ? permission : JSON.stringify(permission),
  });
}

async function postCreateTask(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Partial<CreateTaskBody> = {},
) {
  return app.request(`/api/task/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "RBAC probe",
      description: "",
      priority: "low",
      status: "to-do",
      ...body,
    }),
  });
}

describe("API integration: workspace RBAC enforcement", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("built-in roles", () => {
    it("allows a member to create a task (member role grants task:create)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(200);
    });

    it("blocks a viewer from creating a task (viewer role lacks task:create)", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe("Insufficient permissions");

      const persisted = await db.query.taskTable.findFirst({
        where: and(
          eq(schema.taskTable.projectId, project.id),
          eq(schema.taskTable.title, "RBAC probe"),
        ),
      });
      expect(persisted).toBeUndefined();
    });

    it("blocks a member from deleting a task (member role lacks task:delete)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);

      const stillThere = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(stillThere).toBeDefined();
    });

    it("allows an admin to delete a task (admin role grants task:delete)", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);

      const gone = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(gone).toBeUndefined();
    });

    it.each([
      ["To Do", "to-do", "todo"],
      ["In Progress", "in-progress", "inProgress"],
      ["In Review", "in-review", "inReview"],
      ["Done", "done", "done"],
    ] as const)(
      "allows an owner to delete a task from %s",
      async (_label, status, columnKey) => {
        const member = await createWorkspaceMember({ role: "owner" });
        const { project, columns } = await createProjectFixture({
          workspaceId: member.workspace.id,
        });
        const task = await seedTask(
          project.id,
          columns[columnKey].id,
          undefined,
          status,
        );

        mockAuthenticatedSession(member.user);
        const { app } = createApp();

        const response = await app.request(`/api/task/${task.id}`, {
          method: "DELETE",
        });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          id: task.id,
          status,
        });

        const deletedTask = await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.id, task.id),
        });
        expect(deletedTask).toBeUndefined();
      },
    );

    it("issue #290: returns the same 400 an unknown project gets when the user has no row in workspace_member for the workspace, not a distinguishing 403", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      const outsiderId = `user-${randomUUID()}`;
      const outsider = requireRow(
        await db
          .insert(schema.userTable)
          .values({
            id: outsiderId,
            email: `${outsiderId}@example.com`,
            emailVerified: true,
            name: "Outsider",
          })
          .returning(),
        "outsider",
      );

      mockAuthenticatedSession(outsider);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      // Before #290, `workspaceAccess.fromProject` answered 403 here ("reachable
      // resource, wrong tenant") but 400 for an outright unknown project id -- letting
      // a caller tell the two apart. It now answers this exactly like the unknown-id
      // case (#202's own precedent for this helper: a project lookup failure is a 400,
      // not a 404), never a 403.
      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toBe(
        "Workspace ID could not be determined",
      );
    });

    it("issue #290: does not distinguish a project reached through a conflicting workspaceId query from an unknown one", async () => {
      const attacker = await createWorkspaceMember({ role: "admin" });
      const victim = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/task/${project.id}?workspaceId=${attacker.workspace.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Cross-workspace probe",
            description: "",
            priority: "low",
            status: "to-do",
          }),
        },
      );

      // `?workspaceId=` was never consulted for a `lookup` source (that's #256); #290
      // additionally means the resolved-but-out-of-reach project doesn't leak a 403.
      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toBe(
        "Workspace ID could not be determined",
      );
    });
  });

  describe("bulk task mutations", () => {
    it("blocks a viewer from changing task priority in bulk", async () => {
      const viewer = await createWorkspaceMember({ role: "viewer" });
      const { project, columns } = await createProjectFixture({
        workspaceId: viewer.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(viewer.user);
      const { app } = createApp();

      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: [task.id],
          operation: "updatePriority",
          value: "high",
        }),
      });
      expect(response.status).toBe(403);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.priority).toBe("medium");
    });

    it("allows a member to change task priority in bulk", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: [task.id],
          operation: "updatePriority",
          value: "high",
        }),
      });
      expect(response.status).toBe(200);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.priority).toBe("high");
    });

    it("preserves the not-found response for unknown tasks", async () => {
      const member = await createWorkspaceMember({ role: "member" });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: [randomUUID()],
          operation: "updatePriority",
          value: "high",
        }),
      });
      expect(response.status).toBe(404);
    });

    it("rejects bulk mutations that genuinely span two workspaces the caller can reach", async () => {
      // A caller who is a real member of BOTH workspaces (the multi-workspace
      // analogue of an instance admin or a scoped service key) still gets this
      // 400 -- #290's fix only drops a workspace the caller CANNOT reach from
      // consideration; it does not collapse every multi-workspace request down to
      // "pick the first one".
      const member = await createWorkspaceMember({ role: "member" });
      const other = await createWorkspaceMember({ role: "admin" });
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: other.workspace.id,
        userId: member.user.id,
        role: "member",
        joinedAt: new Date(),
      });

      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { project: otherProject, columns: otherColumns } =
        await createProjectFixture({ workspaceId: other.workspace.id });
      const task = await seedTask(project.id, columns.todo.id);
      const otherTask = await seedTask(otherProject.id, otherColumns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: [task.id, otherTask.id],
          operation: "updatePriority",
          value: "high",
        }),
      });
      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toBe(
        "All tasks must belong to the same workspace",
      );

      const persistedTasks = await db
        .select({ priority: schema.taskTable.priority })
        .from(schema.taskTable)
        .where(inArray(schema.taskTable.id, [task.id, otherTask.id]));
      expect(persistedTasks).toHaveLength(2);
      expect(persistedTasks.every((task) => task.priority === "medium")).toBe(
        true,
      );
    });

    describe("issue #290 (mixed-id oracle): a task in an unreachable workspace is indistinguishable from a nonexistent one", () => {
      // `workspace-access-middleware.ts`'s `fromTasks()` used to resolve every id
      // that existed ANYWHERE, group by workspace, and only THEN check reach --
      // repeated independently in `bulk-update-tasks.ts` itself. `[mine, foreign]`
      // 400'd "must belong to the same workspace" (the foreign task's real
      // workspace was in the group), while `[mine, nonexistent]` silently 200'd
      // with only the real task acted on. That let a caller learn a foreign id
      // exists. Every case below compares the two requests' status AND body
      // directly, not just each in isolation, so a regression that makes them
      // merely "both look plausible" still fails.

      async function requestBulkPriorityUpdate(
        app: ReturnType<typeof createApp>["app"],
        taskIds: string[],
      ) {
        return app.request("/api/task/bulk", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taskIds,
            operation: "updatePriority",
            value: "high",
          }),
        });
      }

      it("[mine, foreign] answers exactly like [mine, nonexistent], and the foreign task is never touched", async () => {
        const member = await createWorkspaceMember({ role: "member" });
        const foreign = await createWorkspaceMember({ role: "admin" });
        const { project, columns } = await createProjectFixture({
          workspaceId: member.workspace.id,
        });
        const { project: foreignProject, columns: foreignColumns } =
          await createProjectFixture({ workspaceId: foreign.workspace.id });
        const task = await seedTask(project.id, columns.todo.id);
        const foreignTask = await seedTask(
          foreignProject.id,
          foreignColumns.todo.id,
        );
        const nonexistentId = randomUUID();

        mockAuthenticatedSession(member.user);
        const { app } = createApp();

        const withForeign = await requestBulkPriorityUpdate(app, [
          task.id,
          foreignTask.id,
        ]);
        const foreignBody = await withForeign.json();

        // Reset the mutated field so the second request starts from the same
        // state as the first, then compare against the "nonexistent" shape.
        await db
          .update(schema.taskTable)
          .set({ priority: "medium" })
          .where(eq(schema.taskTable.id, task.id));

        const withNonexistent = await requestBulkPriorityUpdate(app, [
          task.id,
          nonexistentId,
        ]);
        const nonexistentBody = await withNonexistent.json();

        expect(withForeign.status).toBe(withNonexistent.status);
        expect(withForeign.status).toBe(200);
        expect(foreignBody).toEqual(nonexistentBody);
        expect(foreignBody).toMatchObject({ success: true, updatedCount: 1 });

        const [updatedTask, untouchedForeignTask] = await Promise.all([
          db.query.taskTable.findFirst({
            where: eq(schema.taskTable.id, task.id),
          }),
          db.query.taskTable.findFirst({
            where: eq(schema.taskTable.id, foreignTask.id),
          }),
        ]);
        expect(updatedTask).toMatchObject({ priority: "high" });
        // The foreign task is never updated -- asserted against the database,
        // not just the response body.
        expect(untouchedForeignTask).toMatchObject({ priority: "medium" });
      });

      it("all ids foreign answers exactly like all ids nonexistent", async () => {
        const member = await createWorkspaceMember({ role: "member" });
        const foreign = await createWorkspaceMember({ role: "admin" });
        const { project: foreignProject, columns: foreignColumns } =
          await createProjectFixture({ workspaceId: foreign.workspace.id });
        const foreignTask = await seedTask(
          foreignProject.id,
          foreignColumns.todo.id,
        );
        const nonexistentId = randomUUID();

        mockAuthenticatedSession(member.user);
        const { app } = createApp();

        const withForeign = await requestBulkPriorityUpdate(app, [
          foreignTask.id,
        ]);
        const withNonexistent = await requestBulkPriorityUpdate(app, [
          nonexistentId,
        ]);

        const [foreignBody, nonexistentBody] = await Promise.all([
          withForeign.text(),
          withNonexistent.text(),
        ]);

        expect(withForeign.status).toBe(withNonexistent.status);
        expect(withForeign.status).toBe(404);
        expect(foreignBody).toBe(nonexistentBody);
        expect(foreignBody).toBe("No tasks found");

        const persistedForeignTask = await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.id, foreignTask.id),
        });
        expect(persistedForeignTask).toMatchObject({ priority: "medium" });
      });
    });

    it("blocks a member from deleting a task in bulk", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskIds: [task.id], operation: "delete" }),
      });
      expect(response.status).toBe(403);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted).toBeDefined();
    });

    it("blocks a member from assigning a task in bulk", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: [task.id],
          operation: "updateAssignee",
          value: member.user.id,
        }),
      });
      expect(response.status).toBe(403);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.userId).toBeNull();
    });

    it("allows an admin to assign a task in bulk", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: admin.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: [task.id],
          operation: "updateAssignee",
          value: admin.user.id,
        }),
      });
      expect(response.status).toBe(200);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.userId).toBe(admin.user.id);
    });

    it("does not copy a label from another workspace in bulk", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const foreign = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);
      const foreignLabel = requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            name: "private",
            color: "#000000",
            workspaceId: foreign.workspace.id,
          })
          .returning(),
        "foreignLabel",
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: [task.id],
          operation: "addLabel",
          value: foreignLabel.id,
        }),
      });
      expect(response.status).toBe(400);

      const copiedLabel = await db.query.labelTable.findFirst({
        where: and(
          eq(schema.labelTable.taskId, task.id),
          eq(schema.labelTable.name, foreignLabel.name),
        ),
      });
      expect(copiedLabel).toBeUndefined();
    });
  });

  describe("custom workspace roles", () => {
    it("blocks a custom role that only grants task:read from creating a task", async () => {
      const member = await createWorkspaceMember({ role: "readonly" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await createWorkspaceRoleRow(member.workspace.id, "readonly", {
        task: ["read"],
        project: ["read"],
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
    });

    it("allows a custom role that grants task:create to create a task", async () => {
      const member = await createWorkspaceMember({ role: "creator" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await createWorkspaceRoleRow(member.workspace.id, "creator", {
        task: ["create", "read"],
        project: ["read"],
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(200);
    });

    it("lets a workspace_role row override the built-in viewer permissions", async () => {
      // viewer's compiled-in statements have no task:create. A workspace_role
      // row for "viewer" with task:create should override and grant access.
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await createWorkspaceRoleRow(member.workspace.id, "viewer", {
        task: ["create", "read", "update"],
        project: ["read"],
        workspace: ["read"],
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(200);
    });

    it("returns 403 when the workspace_role permission JSON is malformed", async () => {
      const member = await createWorkspaceMember({ role: "broken" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      // Malformed permission payload. The middleware should refuse rather than
      // crash; with no built-in fallback for "broken", access is denied.
      await createWorkspaceRoleRow(member.workspace.id, "broken", "not-json");

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
    });

    it("drops malformed permission entries instead of throwing", async () => {
      const member = await createWorkspaceMember({ role: "partial" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      // Some entries are valid string arrays, others are objects/strings/etc.
      // Middleware keeps the valid ones and ignores the rest.
      await createWorkspaceRoleRow(
        member.workspace.id,
        "partial",
        JSON.stringify({
          task: ["create"],
          project: "not-an-array",
          weird: { nested: true },
        }),
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(200);
    });

    it("issue #66: denies (does not fall back to the compiled built-in role) when no workspace_role row exists for a non-owner name", async () => {
      // No workspace_role row for "admin", and "admin" is not "owner" -- so
      // this must DENY, not silently grant the compiled-in admin's full
      // privileges. Before #66 closed, this fell back to the compiled
      // definition and returned 200; every real creation path now
      // guarantees this row exists, so its absence here is deliberately
      // constructed (seedDefaultRoleRow: false), not a realistic steady
      // state -- but the evaluator must still refuse it.
      const member = await createWorkspaceMember({
        role: "admin",
        seedDefaultRoleRow: false,
      });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
    });
  });

  describe("resource coverage: task:update", () => {
    it("allows a member to update a task", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated by member",
          description: "edit",
          priority: "high",
          status: "to-do",
          projectId: project.id,
          position: 1,
        }),
      });
      expect(response.status).toBe(200);
    });

    it("allows a member to update an assigned task without changing its assignee", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id, member.user.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated by member",
          description: "edit",
          priority: "high",
          status: "to-do",
          projectId: project.id,
          position: 1,
          userId: member.user.id,
        }),
      });
      expect(response.status).toBe(200);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.title).toBe("Updated by member");
      expect(persisted?.userId).toBe(member.user.id);
    });

    it("blocks a member from assigning an unassigned task through full update", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Member attempt",
          description: "nope",
          priority: "low",
          status: "to-do",
          projectId: project.id,
          position: 1,
          userId: member.user.id,
        }),
      });
      expect(response.status).toBe(403);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.userId).toBeNull();
    });

    it("blocks a member from unassigning a task through full update", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id, member.user.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Member attempt",
          description: "nope",
          priority: "low",
          status: "to-do",
          projectId: project.id,
          position: 1,
          userId: "",
        }),
      });
      expect(response.status).toBe(403);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.userId).toBe(member.user.id);
    });

    it("allows an admin to assign a task through full update", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: admin.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Assigned by admin",
          description: "",
          priority: "medium",
          status: "to-do",
          projectId: project.id,
          position: 1,
          userId: admin.user.id,
        }),
      });
      expect(response.status).toBe(200);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.userId).toBe(admin.user.id);
    });

    it("blocks a viewer from updating a task", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Viewer attempt",
          description: "nope",
          priority: "low",
          status: "to-do",
          projectId: project.id,
          position: 1,
        }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe("resource coverage: task:assign", () => {
    it("blocks a member from assigning a task (assign is admin-tier)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/assignee/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: member.user.id }),
      });
      expect(response.status).toBe(403);
    });

    it("allows an admin to assign a task", async () => {
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
        body: JSON.stringify({ userId: member.user.id }),
      });
      expect(response.status).toBe(200);
    });
  });

  describe("resource coverage: project:create / update / delete", () => {
    it("allows a member to create a project", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Member-made",
          workspaceId: member.workspace.id,
          slug: "MEM",
          icon: "Folder",
        }),
      });
      expect(response.status).toBe(200);
    });

    it("blocks a viewer from creating a project", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Viewer attempt",
          workspaceId: member.workspace.id,
          slug: "VWR",
          icon: "Folder",
        }),
      });
      expect(response.status).toBe(403);
    });

    it("blocks a member from updating a project (project:update is admin-tier)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/project/${project.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Member-rename",
          icon: "Folder",
          slug: project.slug,
          description: "",
          isPublic: false,
        }),
      });
      expect(response.status).toBe(403);
    });

    it("allows an admin to update a project", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/project/${project.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Admin-rename",
          icon: "Folder",
          slug: project.slug,
          description: "",
          isPublic: false,
        }),
      });
      expect(response.status).toBe(200);
    });

    it("blocks a member from deleting a project (project:delete is admin-tier)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/project/${project.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);
    });

    it("allows an admin to delete a project", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/project/${project.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
    });
  });

  describe("resource coverage: label:create / delete", () => {
    it("allows a member to create a label", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "bug",
          color: "#ff0000",
          workspaceId: member.workspace.id,
        }),
      });
      expect(response.status).toBe(200);
    });

    it("blocks a viewer from creating a label", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "nope",
          color: "#000000",
          workspaceId: member.workspace.id,
        }),
      });
      expect(response.status).toBe(403);
    });

    it("allows a member to delete a label", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);
      // deleteLabel requires the label to be attached to a task; without a
      // taskId the controller rejects with 400 before checking permissions.
      const label = requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            name: "scratch",
            color: "#abcdef",
            workspaceId: member.workspace.id,
            taskId: task.id,
          })
          .returning(),
        "label",
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/label/${label.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
    });

    it("blocks a viewer from deleting a label", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);
      const label = requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            name: "scratch",
            color: "#abcdef",
            workspaceId: member.workspace.id,
            taskId: task.id,
          })
          .returning(),
        "label",
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/label/${label.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);
    });
  });

  describe("instance admin bypass", () => {
    it("bypasses the workspace permission check when user.role === 'admin'", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      // Promote the user to instance admin
      await db
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, member.user.id));

      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      // Reload the user so the mocked session reflects the admin role.
      const refreshedUser = await db.query.userTable.findFirst({
        where: eq(schema.userTable.id, member.user.id),
      });
      if (!refreshedUser) throw new Error("user vanished after update");

      mockAuthenticatedSession(refreshedUser);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(200);
    });

    it("does not bypass for users with no role set", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      // Explicitly null role on the user table; should NOT bypass.
      await db
        .update(schema.userTable)
        .set({ role: null })
        .where(eq(schema.userTable.id, member.user.id));

      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      mockAuthenticatedSession({ ...member.user, role: null });
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
    });
  });

  // Negative guard for issue #6, replacing the three cases that used Slack as
  // the canonical `workspace:manage_settings` surface.
  //
  // All six inherited integration routers (GitHub, Gitea, Slack, Discord,
  // Telegram, generic webhook) are deleted, so there is no longer a route to
  // assert RBAC against — and that is worth asserting directly: these paths
  // must be ABSENT, not merely permission-checked.
  //
  // NOTE for #7/#8: `workspace:manage_settings` is now required by NO route in
  // the application. The integration routers were its only consumers. The
  // capability still exists in packages/permissions; re-attaching it to the
  // God Mode / instance settings surface is that work's job, and the route
  // coverage test should notice a capability nothing enforces.
  describe("the removed integration routers", () => {
    const removedRoutes = [
      "/api/github-integration",
      "/api/gitea-integration",
      "/api/slack-integration",
      "/api/discord-integration",
      "/api/telegram-integration",
      "/api/generic-webhook-integration",
    ];

    it("no longer mounts any inherited integration router", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      mockAuthenticatedSession(owner.user);
      const { app } = createApp();

      for (const route of removedRoutes) {
        const response = await app.request(`${route}/project/${project.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });

        // 404 — the router is gone. An owner is used deliberately: a 403 would
        // only prove the caller lacked permission, which would still mean the
        // route existed.
        expect(response.status).toBe(404);
      }
    });
  });
});
