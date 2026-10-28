import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { seedWorkspaceBuiltInRoles } from "../../apps/api/src/workspace/built-in-roles.repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  grantProjectRole,
} from "./helpers/fixtures";

describe("API integration: soft-deleted project recovery", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists deleted projects only in explicit recovery mode and restores without clearing archive state", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, project.id);
    const deletedAt = new Date();
    const archivedAt = new Date(deletedAt.getTime() - 60_000);
    const purgeAfter = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.projectTable)
      .set({ deletedAt, archivedAt, purgeAfter })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const ordinary = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );
    expect(ordinary.status).toBe(200);
    expect(await ordinary.json()).toEqual([]);

    const recovery = await app.request(
      `/api/project?workspaceId=${member.workspace.id}&includeArchived=true&includeDeleted=true`,
    );
    expect(recovery.status).toBe(200);
    expect(await recovery.json()).toMatchObject([
      { id: project.id, deletedAt: deletedAt.toISOString() },
    ]);

    const response = await app.request(`/api/project/${project.id}/restore`, {
      method: "PUT",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: project.id,
      deletedAt: null,
      purgeAfter: null,
      archivedAt: archivedAt.toISOString(),
    });
    const saved = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, project.id),
    });
    expect(saved).toMatchObject({ deletedAt: null, purgeAfter: null });
    expect(saved?.archivedAt?.toISOString()).toBe(archivedAt.toISOString());
    const audit = await db.query.auditLogTable.findFirst({
      where: eq(schema.auditLogTable.action, "project.restored"),
    });
    expect(audit).toMatchObject({
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
      after: { deletedAt: null, remainsArchived: true },
    });
  });

  it("rejects expired recovery windows and restores children only after their parent", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const parent = (
      await createProjectFixture({
        workspaceId: member.workspace.id,
      })
    ).project;
    const child = (
      await createProjectFixture({
        workspaceId: member.workspace.id,
      })
    ).project;
    await db
      .update(schema.projectTable)
      .set({ parentId: parent.id })
      .where(eq(schema.projectTable.id, child.id));
    await Promise.all([
      grantProjectManageAccess(member.user.id, parent.id),
      grantProjectManageAccess(member.user.id, child.id),
    ]);
    const now = new Date();
    await db
      .update(schema.projectTable)
      .set({ deletedAt: now, purgeAfter: new Date(now.getTime() - 1000) })
      .where(eq(schema.projectTable.id, parent.id));
    await db
      .update(schema.projectTable)
      .set({ deletedAt: now, purgeAfter: new Date(now.getTime() + 86_400_000) })
      .where(eq(schema.projectTable.id, child.id));
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const childBeforeParent = await app.request(
      `/api/project/${child.id}/restore`,
      { method: "PUT" },
    );
    expect(childBeforeParent.status).toBe(409);
    const expiredParent = await app.request(
      `/api/project/${parent.id}/restore`,
      { method: "PUT" },
    );
    expect(expiredParent.status).toBe(409);
    const [savedParent, savedChild] = await Promise.all([
      db.query.projectTable.findFirst({
        where: eq(schema.projectTable.id, parent.id),
      }),
      db.query.projectTable.findFirst({
        where: eq(schema.projectTable.id, child.id),
      }),
    ]);
    expect(savedParent?.deletedAt).not.toBeNull();
    expect(savedChild?.deletedAt).not.toBeNull();
  });

  it("does not expose deleted projects from another workspace", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const other = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(),
        purgeAfter: new Date(Date.now() + 86_400_000),
      })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}&includeDeleted=true`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("masks out-of-reach restore targets and denies an in-reach viewer without project:update", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectManageAccess(owner.user.id, project.id);
    const deletedAt = new Date();
    await db
      .update(schema.projectTable)
      .set({
        deletedAt,
        purgeAfter: new Date(deletedAt.getTime() + 86_400_000),
      })
      .where(eq(schema.projectTable.id, project.id));

    const viewer = await createWorkspaceMember({ role: "viewer" });
    await seedWorkspaceBuiltInRoles(db, owner.workspace.id);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: viewer.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    mockAuthenticatedSession(viewer.user);
    const { app } = createApp();

    const outOfReach = await app.request(`/api/project/${project.id}/restore`, {
      method: "PUT",
    });
    expect(outOfReach.status).toBe(404);

    await grantProjectRole(viewer.user.id, project.id, ["project:read"]);
    const inReachWithoutUpdate = await app.request(
      `/api/project/${project.id}/restore`,
      { method: "PUT" },
    );
    expect(inReachWithoutUpdate.status).toBe(403);
    const saved = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, project.id),
    });
    expect(saved?.deletedAt).not.toBeNull();
  });
});
