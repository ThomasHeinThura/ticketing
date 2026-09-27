/**
 * Issue #25's bounded slice: `docs/03-features/projects-and-engagements.md`'s milestone
 * routes ("Milestones -- name, date, reached. The current milestone is derived as the
 * first not yet reached").
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function listMilestones(projectId: string) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/milestones`);
}

async function createMilestone(projectId: string, body: unknown) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/milestones`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function updateMilestone(
  projectId: string,
  milestoneId: string,
  body: unknown,
) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/milestones/${milestoneId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function deleteMilestone(projectId: string, milestoneId: string) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/milestones/${milestoneId}`, {
    method: "DELETE",
  });
}

describe("API integration: project milestones", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated requests", async () => {
    mockAnonymousSession();
    const response = await listMilestones("project-missing");
    expect(response.status).toBe(401);
  });

  it("rejects creation from a role without project:update", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await createMilestone(project.id, {
      name: "Kick-off",
      date: "2026-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe(403);
  });

  it("creates, lists, marks reached, and deletes a milestone", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const createResponse = await createMilestone(project.id, {
      name: "Kick-off",
      date: "2026-01-01T00:00:00.000Z",
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as {
      id: string;
      name: string;
      reachedAt: string | null;
    };
    expect(created.name).toBe("Kick-off");
    expect(created.reachedAt).toBeNull();

    const listResponse = await listMilestones(project.id);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as Array<{ id: string }>;
    expect(listed.map((m) => m.id)).toEqual([created.id]);

    const markReachedResponse = await updateMilestone(project.id, created.id, {
      reached: true,
    });
    expect(markReachedResponse.status).toBe(200);
    const markedReached = (await markReachedResponse.json()) as {
      reachedAt: string | null;
    };
    expect(markedReached.reachedAt).not.toBeNull();

    const clearReachedResponse = await updateMilestone(project.id, created.id, {
      reached: false,
    });
    expect(clearReachedResponse.status).toBe(200);
    const clearedReached = (await clearReachedResponse.json()) as {
      reachedAt: string | null;
    };
    expect(clearedReached.reachedAt).toBeNull();

    const deleteResponse = await deleteMilestone(project.id, created.id);
    expect(deleteResponse.status).toBe(200);

    const secondDelete = await deleteMilestone(project.id, created.id);
    expect(secondDelete.status).toBe(404);
  });

  it("rejects a malformed body (missing date)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await createMilestone(project.id, { name: "No date" });
    expect(response.status).toBe(400);
  });

  it("404s for a project belonging to another workspace", async () => {
    const memberA = await createWorkspaceMember({ role: "admin" });
    const memberB = await createWorkspaceMember({ role: "admin" });
    const { project: projectB } = await createProjectFixture({
      workspaceId: memberB.workspace.id,
    });
    mockAuthenticatedSession(memberA.user);

    const response = await createMilestone(projectB.id, {
      name: "Cross-tenant",
      date: "2026-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a NUL byte in name (S1, Opus review of PR #438)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await createMilestone(project.id, {
      name: "Bad\u0000name",
      date: "2026-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a name exceeding the length limit (S3, Opus review of PR #438)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await createMilestone(project.id, {
      name: "a".repeat(201),
      date: "2026-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe(400);
  });
});
