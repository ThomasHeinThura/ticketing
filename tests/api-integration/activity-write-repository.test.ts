import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import createActivity, {
  recordTaskEventActivity,
} from "../../apps/api/src/activity/controllers/create-activity";
import {
  insertTaskActivityForIdentity,
  lockTaskAndAssertProjectLiveForActivity,
} from "../../apps/api/src/activity/repository";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessToWorkspaceMembers,
  grantProjectManageAccess,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { raceProjectArchive } from "./helpers/race-soft-delete";

async function createLegacyTask(
  projectId: string,
  columnId: string,
  number: number,
) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: `Legacy activity task ${number}`,
        description: "Original description",
        status: "to-do",
        columnId,
        priority: "medium",
        number,
        position: number,
      })
      .returning(),
    "legacy task",
  );
}

async function requestActivityCreate(taskId: string) {
  const { app } = createApp();
  return app.request("/api/activity/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId,
      type: "created",
      message: "Created through the public activity route",
      eventData: { source: "integration-test" },
    }),
  });
}

describe("legacy activity write repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rechecks current project reach after the caller's previously resolved grant is revoked", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantWorkItemProjectAccess(member.user.id, project.id);
    const task = await createLegacyTask(project.id, columns.todo.id, 1);
    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("expected resolved member identity");

    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id));
    if (!person) throw new Error("expected member person");
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, person.id));

    const before = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, task.id));
    await expect(
      createActivity(identity, task.id, "title_changed", member.user.id, null, {
        oldTitle: task.title,
        newTitle: "Must not persist",
      }),
    ).rejects.toMatchObject({ status: 404 });
    const after = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, task.id));
    expect(after).toEqual(before);
  });

  it("serializes public activity creation behind a project archive", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, project.id);
    await grantProjectAccessToWorkspaceMembers(member.workspace.id, project.id);
    const task = await createLegacyTask(project.id, columns.todo.id, 1);
    mockAuthenticatedSession(member.user);

    const race = await raceProjectArchive(project.id, () =>
      requestActivityCreate(task.id),
    );
    expect(race.blockedOnRowLock).toBe(true);
    expect(race.operation.status).toBe("fulfilled");
    if (race.operation.status !== "fulfilled") {
      throw new Error("activity create should return an HTTP response");
    }
    expect(race.operation.value.status).toBe(404);
    expect(
      await db
        .select()
        .from(schema.taskActivityTable)
        .where(eq(schema.taskActivityTable.taskId, task.id)),
    ).toHaveLength(0);
  });

  it("keeps a committed event's original actor and payload after archive and actor deactivation", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, project.id);
    await grantProjectAccessToWorkspaceMembers(member.workspace.id, project.id);
    const task = await createLegacyTask(project.id, columns.todo.id, 1);
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id));
    if (!person) throw new Error("expected member person");

    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, person.id));

    const eventData = {
      oldTitle: task.title,
      newTitle: "Committed before archive",
      sourceEventId: "event-activity-write-test",
    };
    await recordTaskEventActivity(
      task.id,
      "title_changed",
      member.user.id,
      null,
      eventData,
    );

    const [activity] = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, task.id));
    expect(activity).toMatchObject({
      taskId: task.id,
      type: "title_changed",
      userId: member.user.id,
      content: null,
      eventData,
    });
  });

  it("uses the caller's transaction executor for the live check and insert", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, project.id);
    await grantProjectAccessToWorkspaceMembers(member.workspace.id, project.id);
    const task = await createLegacyTask(project.id, columns.todo.id, 1);
    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("expected resolved member identity");

    await expect(
      db.transaction(async (tx) => {
        await lockTaskAndAssertProjectLiveForActivity(tx, identity, task.id);
        const inserted = await insertTaskActivityForIdentity(tx, identity, {
          taskId: task.id,
          type: "created",
          userId: member.user.id,
          content: "Rolled back with caller transaction",
          eventData: { transaction: "rollback" },
        });
        expect(inserted).toBeDefined();
        throw new Error("rollback activity transaction");
      }),
    ).rejects.toThrow("rollback activity transaction");

    expect(
      await db
        .select()
        .from(schema.taskActivityTable)
        .where(eq(schema.taskActivityTable.taskId, task.id)),
    ).toHaveLength(0);
  });
});
