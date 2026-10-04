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
  grantProjectRole,
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
    await grantProjectRole(member.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(member.user);

    const response = await addDocumentLink(project.id, {
      url: "not-a-url",
      title: "SOW",
    });

    expect(response.status).toBe(400);
  });

  it.each([
    "javascript:alert(document.cookie)",
    "data:text/html,<script>1</script>",
  ])(
    "rejects a %s URL (B2, Opus review of PR #438: stored-XSS via a non-http(s) scheme)",
    async (url) => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectRole(member.user.id, project.id, ["project:read"]);
      mockAuthenticatedSession(member.user);

      const response = await addDocumentLink(project.id, {
        url,
        title: "Malicious",
        customerVisible: true,
      });

      expect(response.status).toBe(400);

      const listResponse = await listDocumentLinks(project.id);
      const listed = (await listResponse.json()) as unknown[];
      expect(listed).toHaveLength(0);
    },
  );

  it("rejects a NUL byte in title", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(member.user);

    const response = await addDocumentLink(project.id, {
      url: "https://example.com/sow.pdf",
      title: "Bad\u0000title",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a title/url exceeding the length limit", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(member.user);

    const response = await addDocumentLink(project.id, {
      url: `https://example.com/${"a".repeat(2048)}`,
      title: "SOW",
    });

    expect(response.status).toBe(400);
  });

  it("defaults customerVisible to false, adds, lists, and deletes a link", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.id, ["project:read"]);
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

  it("404s deleting a document link that belongs to a different project", async () => {
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

    const addResponse = await addDocumentLink(projectA.id, {
      url: "https://example.com/sow.pdf",
      title: "Belongs to A",
    });
    const added = (await addResponse.json()) as { id: string };

    const response = await deleteDocumentLink(projectB.id, added.id);

    expect(response.status).toBe(404);
  });

  it("400s adding a link to a project belonging to another workspace", async () => {
    const memberA = await createWorkspaceMember({ role: "admin" });
    const memberB = await createWorkspaceMember({ role: "admin" });
    const { project: projectB } = await createProjectFixture({
      workspaceId: memberB.workspace.id,
    });
    mockAuthenticatedSession(memberA.user);

    const response = await addDocumentLink(projectB.id, {
      url: "https://example.com/sow.pdf",
      title: "Cross-tenant",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a NUL byte in the documentLinkId path param (F1, delta Opus review of PR #438)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(member.user);

    const response = await deleteDocumentLink(
      project.id,
      encodeURIComponent("\u0000x"),
    );

    expect(response.status).toBe(400);
  });

  it("rejects adding a link from a role without project:update", async () => {
    const member = await createWorkspaceMember({ role: "viewer" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(member.user);

    const response = await addDocumentLink(project.id, {
      url: "https://example.com/sow.pdf",
      title: "Statement of work",
    });

    expect(response.status).toBe(403);
  });
});
