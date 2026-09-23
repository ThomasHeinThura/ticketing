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

let taskNumber = 0;

async function seedTask(projectId: string, columnId: string) {
  taskNumber += 1;
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
        number: taskNumber,
        position: taskNumber,
      })
      .returning(),
    "seedTask",
  );
}

// Issue #290 follow-up: `task-relation/index.ts`'s own bespoke middleware
// (`scopeToSourceTask` for POST /api/task-relation, `scopeToRelation` for DELETE
// /api/task-relation/{id}) is NOT one of the `workspaceAccess.from*` helpers #290's
// main fix covers -- it resolves a task's workspace itself and calls
// `validateWorkspaceAccess` directly. It had the identical existence-oracle bug: a
// nonexistent source task/relation answered 404, but one that exists in a workspace
// the caller can't reach answered a bare 403 -- distinguishable from the outside.
// Deferred out of the original #290 pull request's diff and closed here with the
// same "catch the 403, re-throw as the resource's own 404" mechanism.
describe("issue #290 follow-up: task-relation's bespoke middleware closes the same oracle", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("POST /api/task-relation (scopeToSourceTask)", () => {
    async function postCreateRelation(
      app: ReturnType<typeof createApp>["app"],
      sourceTaskId: string,
      targetTaskId: string,
    ) {
      return app.request("/api/task-relation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceTaskId,
          targetTaskId,
          relationType: "blocks",
        }),
      });
    }

    it("an other-tenant sourceTaskId answers exactly like a nonexistent one", async () => {
      const member = await createWorkspaceMember();
      const foreign = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { project: foreignProject, columns: foreignColumns } =
        await createProjectFixture({ workspaceId: foreign.workspace.id });
      const myTask = await seedTask(project.id, columns.todo.id);
      const foreignSourceTask = await seedTask(
        foreignProject.id,
        foreignColumns.todo.id,
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const withForeign = await postCreateRelation(
        app,
        foreignSourceTask.id,
        myTask.id,
      );
      const withNonexistent = await postCreateRelation(
        app,
        "nonexistent-task-id",
        myTask.id,
      );

      const [foreignBody, nonexistentBody] = await Promise.all([
        withForeign.text(),
        withNonexistent.text(),
      ]);

      expect(withForeign.status).toBe(withNonexistent.status);
      expect(withForeign.status).toBe(404);
      expect(foreignBody).toBe(nonexistentBody);
      expect(foreignBody).toBe("Source task not found");

      const relations = await db.query.taskRelationTable.findMany();
      expect(relations).toHaveLength(0);
    });
  });

  describe("DELETE /api/task-relation/{id} (scopeToRelation)", () => {
    async function deleteRelation(
      app: ReturnType<typeof createApp>["app"],
      id: string,
    ) {
      return app.request(`/api/task-relation/${id}`, { method: "DELETE" });
    }

    it("a relation whose source task is in another tenant answers exactly like a nonexistent relation id", async () => {
      const member = await createWorkspaceMember();
      const foreign = await createWorkspaceMember({ role: "admin" });
      const { project: foreignProject, columns: foreignColumns } =
        await createProjectFixture({ workspaceId: foreign.workspace.id });
      const foreignSource = await seedTask(
        foreignProject.id,
        foreignColumns.todo.id,
      );
      const foreignTarget = await seedTask(
        foreignProject.id,
        foreignColumns.todo.id,
      );
      const foreignRelation = requireRow(
        await db
          .insert(schema.taskRelationTable)
          .values({
            sourceTaskId: foreignSource.id,
            targetTaskId: foreignTarget.id,
            relationType: "blocks",
          })
          .returning(),
        "foreignRelation",
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const withForeign = await deleteRelation(app, foreignRelation.id);
      const withNonexistent = await deleteRelation(
        app,
        "nonexistent-relation-id",
      );

      const [foreignBody, nonexistentBody] = await Promise.all([
        withForeign.text(),
        withNonexistent.text(),
      ]);

      expect(withForeign.status).toBe(withNonexistent.status);
      expect(withForeign.status).toBe(404);
      expect(foreignBody).toBe(nonexistentBody);
      expect(foreignBody).toBe("Task relation not found");

      // Never deleted -- the middleware rejected the request before the handler
      // (and its own permission check) ever ran.
      const stillThere = await db.query.taskRelationTable.findFirst({
        where: (relation, { eq }) => eq(relation.id, foreignRelation.id),
      });
      expect(stillThere).toBeDefined();
    });
  });
});
