/**
 * Issue #25's bounded slice: `docs/03-features/projects-and-engagements.md`'s document
 * link routes ("Links to external systems ... Customer visibility is off by default").
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function listDocumentLinks(projectId: string) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/document-links`);
}

async function addDocumentLink(projectId: string, body: unknown) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/document-links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function deleteDocumentLink(projectId: string, documentLinkId: string) {
  const { app } = createApp();
  return app.request(
    `/api/project/${projectId}/document-links/${documentLinkId}`,
    { method: "DELETE" },
  );
}

describe("API integration: project document links", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects a non-URL value", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await addDocumentLink(project.id, {
      url: "not-a-url",
      title: "SOW",
    });

    expect(response.status).toBe(400);
  });

  it("defaults customerVisible to false, adds, lists, and deletes a link", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const addResponse = await addDocumentLink(project.id, {
      url: "https://example.com/sow.pdf",
      title: "Statement of work",
    });
    expect(addResponse.status).toBe(200);
    const added = (await addResponse.json()) as {
      id: string;
      customerVisible: boolean;
    };
    expect(added.customerVisible).toBe(false);

    const listResponse = await listDocumentLinks(project.id);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as Array<{ id: string }>;
    expect(listed.map((l) => l.id)).toEqual([added.id]);

    const deleteResponse = await deleteDocumentLink(project.id, added.id);
    expect(deleteResponse.status).toBe(200);

    const secondDelete = await deleteDocumentLink(project.id, added.id);
    expect(secondDelete.status).toBe(404);

    const listAfterDelete = await listDocumentLinks(project.id);
    const listedAfterDelete = (await listAfterDelete.json()) as unknown[];
    expect(listedAfterDelete).toHaveLength(0);
  });

  it("rejects adding a link from a role without project:update", async () => {
    const member = await createWorkspaceMember({ role: "viewer" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await addDocumentLink(project.id, {
      url: "https://example.com/sow.pdf",
      title: "Statement of work",
    });

    expect(response.status).toBe(403);
  });
});
