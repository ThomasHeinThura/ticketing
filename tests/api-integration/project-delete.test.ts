/**
 * #187: deleting a project must not hard-delete the row. `work_item.project_id` carries
 * `ON DELETE CASCADE` (#185's schema slice) — a real `DELETE FROM project` would silently
 * take every work item under it with it, with no recovery window. The fix is a soft
 * delete: `deleted_at`/`purge_after` are stamped instead of the row being removed, matching
 * `docs/03-features/projects-and-engagements.md` PR-16 (30-day recovery window, independent
 * of `archived_at`).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// Generous tolerance for the time the test itself takes to run between the
// delete request and reading `purge_after` back -- this only guards against
// the wrong constant/unit, not against timing precision.
const PURGE_AFTER_TOLERANCE_MS = 5000;

async function deleteRequest(projectId: string) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}`, { method: "DELETE" });
}

async function getRequest(projectId: string) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}`);
}

async function listRequest(workspaceId: string) {
  const { app } = createApp();
  return app.request(`/api/project?workspaceId=${workspaceId}`);
}

/** Minimal work_item fixture, one level deep -- just enough to prove a row under the
 * deleted project survives. Mirrors `work-item-schema.test.ts`'s own fixture builders. */
async function makeWorkItemUnder(workspaceId: string, projectId: string) {
  const now = new Date();

  const organisation = requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `project-delete-org-${randomUUID()}`,
        name: "Project Delete Test Organisation",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeOrganisation",
  );

  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );

  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeStateTemplate",
  );

  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState",
  );

  const requester = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId: organisation.id,
        side: "customer",
        isPlaceholder: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makePerson",
  );

  return requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        projectId,
        typeId: type.id,
        stateId: state.id,
        number: 1,
        key: `wi-delete-${randomUUID()}`,
        requesterId: requester.id,
        title: "Survives the project's soft delete",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItem",
  );
}

describe("API integration: project soft delete", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("sets deleted_at/purge_after instead of removing the row", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await deleteRequest(project.id);
    expect(response.status).toBe(200);

    const row = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, project.id),
    });

    expect(row).toBeDefined();
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.purgeAfter).not.toBeNull();
  });

  it("sets purge_after to 30 days from now, within a few seconds' tolerance", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const beforeDelete = Date.now();
    const response = await deleteRequest(project.id);
    expect(response.status).toBe(200);

    const row = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, project.id),
    });

    const purgeAfter = row?.purgeAfter;
    expect(purgeAfter).toBeInstanceOf(Date);
    const expected = beforeDelete + THIRTY_DAYS_MS;
    expect(Math.abs((purgeAfter as Date).getTime() - expected)).toBeLessThan(
      PURGE_AFTER_TOLERANCE_MS,
    );
  });

  it("no longer appears in the default project list once soft-deleted", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project: kept } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Kept",
      slug: "kept",
    });
    const { project: deleted } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Deleted",
      slug: "deleted",
    });
    mockAuthenticatedSession(member.user);

    const deleteResponse = await deleteRequest(deleted.id);
    expect(deleteResponse.status).toBe(200);

    const listResponse = await listRequest(member.workspace.id);
    expect(listResponse.status).toBe(200);
    const payload = (await listResponse.json()) as Array<{ id: string }>;

    expect(payload.map((entry) => entry.id)).toEqual([kept.id]);
  });

  it("returns 404 when fetching a soft-deleted project directly by id", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const deleteResponse = await deleteRequest(project.id);
    expect(deleteResponse.status).toBe(200);

    const getResponse = await getRequest(project.id);
    expect(getResponse.status).toBe(404);
  });

  it("returns 404 for an already soft-deleted project, without re-stamping it", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const firstDelete = await deleteRequest(project.id);
    expect(firstDelete.status).toBe(200);

    const rowAfterFirstDelete = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, project.id),
    });
    const purgeAfterFirstDelete = rowAfterFirstDelete?.purgeAfter?.getTime();

    const secondDelete = await deleteRequest(project.id);
    expect(secondDelete.status).toBe(404);

    const rowAfterSecondDelete = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, project.id),
    });

    // The second call must not have pushed the purge date out again.
    expect(rowAfterSecondDelete?.purgeAfter?.getTime()).toBe(
      purgeAfterFirstDelete,
    );
  });

  it("does not cascade-delete a work_item that references the deleted project", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const workItem = await makeWorkItemUnder(member.workspace.id, project.id);
    mockAuthenticatedSession(member.user);

    const response = await deleteRequest(project.id);
    expect(response.status).toBe(200);

    // If the route had issued a real DELETE, the FK's ON DELETE CASCADE
    // (schema.ts's work_item.project_id) would have removed this row too.
    const survivingWorkItem = await db.query.workItemTable.findFirst({
      where: eq(schema.workItemTable.id, workItem.id),
    });
    expect(survivingWorkItem).toBeDefined();
    expect(survivingWorkItem?.id).toBe(workItem.id);
  });
});
