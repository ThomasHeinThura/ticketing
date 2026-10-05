/**
 * Issue #25's bounded slice: `docs/03-features/projects-and-engagements.md`'s
 * prerequisite routes ("title, owner (us / customer / both), due date, blocking flag,
 * completed").
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";

async function listPrerequisites(projectId: string) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/prerequisites`);
}

async function createPrerequisite(projectId: string, body: unknown) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/prerequisites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function updatePrerequisite(
  projectId: string,
  prerequisiteId: string,
  body: unknown,
) {
  const { app } = createApp();
  return app.request(
    `/api/project/${projectId}/prerequisites/${prerequisiteId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function deletePrerequisite(projectId: string, prerequisiteId: string) {
  const { app } = createApp();
  return app.request(
    `/api/project/${projectId}/prerequisites/${prerequisiteId}`,
    { method: "DELETE" },
  );
}

describe("API integration: project prerequisites", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects an invalid ownerSide", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await createPrerequisite(project.id, {
      title: "Customer signs the SOW",
      ownerSide: "nobody",
    });

    expect(response.status).toBe(400);
  });

  it("rejects creation from a role without project:update", async () => {
    const member = await createWorkspaceMember({ role: "viewer" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await createPrerequisite(project.id, {
      title: "Customer signs the SOW",
      ownerSide: "customer",
    });

    expect(response.status).toBe(403);
  });

  it("creates, lists, ticks off, and deletes a prerequisite", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(member.user);

    const createResponse = await createPrerequisite(project.id, {
      title: "Customer signs the SOW",
      ownerSide: "customer",
      isBlocking: true,
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as {
      id: string;
      ownerSide: string;
      isBlocking: boolean;
      completedAt: string | null;
    };
    expect(created.ownerSide).toBe("customer");
    expect(created.isBlocking).toBe(true);
    expect(created.completedAt).toBeNull();

    const listResponse = await listPrerequisites(project.id);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as Array<{ id: string }>;
    expect(listed.map((p) => p.id)).toEqual([created.id]);

    const completeResponse = await updatePrerequisite(project.id, created.id, {
      completed: true,
    });
    expect(completeResponse.status).toBe(200);
    const completed = (await completeResponse.json()) as {
      completedAt: string | null;
    };
    expect(completed.completedAt).not.toBeNull();

    const deleteResponse = await deletePrerequisite(project.id, created.id);
    expect(deleteResponse.status).toBe(200);

    const secondDelete = await deletePrerequisite(project.id, created.id);
    expect(secondDelete.status).toBe(404);
  });

  it("404s updating a prerequisite that belongs to a different project", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project: projectA } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "project-a",
    });
    const { project: projectB } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "project-b",
    });
    mockAuthenticatedSession(member.user);

    const createResponse = await createPrerequisite(projectA.id, {
      title: "Belongs to A",
      ownerSide: "us",
    });
    const created = (await createResponse.json()) as { id: string };

    const response = await updatePrerequisite(projectB.id, created.id, {
      completed: true,
    });

    expect(response.status).toBe(404);
  });

  it("rejects a NUL byte in title (S1, Opus review of PR #438)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await createPrerequisite(project.id, {
      title: "Bad\u0000title",
      ownerSide: "us",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a title exceeding the length limit (S3, Opus review of PR #438)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await createPrerequisite(project.id, {
      title: "a".repeat(201),
      ownerSide: "us",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a NUL byte in the prerequisiteId path param (F1, delta Opus review of PR #438)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await updatePrerequisite(
      project.id,
      encodeURIComponent("\u0000x"),
      { completed: true },
    );

    expect(response.status).toBe(400);
  });
});
