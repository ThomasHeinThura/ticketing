/**
 * #23's mandatory Opus security review of PR #261, finding F1 (decision log 2026-09-22,
 * "#261's mandatory Opus review F1: `project.slug` becomes globally unique").
 *
 * Reproduces the reviewer's live exploit exactly, through the real HTTP routes: an
 * ordinary `member` of one workspace could slug their own project identically to a
 * project in an entirely unrelated workspace, and the victim's project would then
 * permanently 500 on its first work-item create (the claimed counter rolls back with the
 * failed transaction, so every retry recomputes the same colliding key). Before this
 * fix, step 2 below ("victim creates a project with the same slug") succeeded with 200;
 * now it is rejected with a clean 409 at project-creation time, so the colliding project
 * -- and therefore the permanent-500 state -- can never come into existence.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

function createProjectRequest(
  app: ReturnType<typeof createApp>["app"],
  body: Record<string, unknown>,
) {
  return app.request("/api/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function updateProjectRequest(
  app: ReturnType<typeof createApp>["app"],
  id: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/project/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API integration: project.slug uniqueness (#261 F1)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("cleanly rejects (409) a second workspace's project reusing a slug already taken by an unrelated workspace's project", async () => {
    // Step 1: the "attacker" workspace claims a slug for their own project.
    const attacker = await createWorkspaceMember();
    mockAuthenticatedSession(attacker.user);
    const { app: attackerApp } = createApp();

    const attackerCreate = await createProjectRequest(attackerApp, {
      workspaceId: attacker.workspace.id,
      name: "Attacker's project",
      icon: "Folder",
      slug: "ACME",
    });
    expect(attackerCreate.status).toBe(200);

    // Step 2: an entirely unrelated "victim" workspace tries to slug their OWN project
    // identically. Before the fix, this 200'd -- the collision was only discovered later,
    // permanently, on the victim's first work-item create.
    const victim = await createWorkspaceMember();
    mockAuthenticatedSession(victim.user);
    const { app: victimApp } = createApp();

    const victimCreate = await createProjectRequest(victimApp, {
      workspaceId: victim.workspace.id,
      name: "Victim's project",
      icon: "Folder",
      slug: "ACME",
    });

    expect(victimCreate.status).toBe(409);
    const body = await victimCreate.text();
    expect(body).not.toMatch(/constraint|violat|internal server error/i);

    // No half-created project or column rows leaked from the rejected attempt.
    const victimProjects = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, victim.workspace.id));
    expect(victimProjects).toHaveLength(0);
  });

  it("lets the same workspace's later create pick a different, real slug and succeed", async () => {
    const attacker = await createWorkspaceMember();
    mockAuthenticatedSession(attacker.user);
    const { app: attackerApp } = createApp();
    await createProjectRequest(attackerApp, {
      workspaceId: attacker.workspace.id,
      name: "Attacker's project",
      icon: "Folder",
      slug: "ACME",
    });

    const victim = await createWorkspaceMember();
    mockAuthenticatedSession(victim.user);
    const { app: victimApp } = createApp();

    const victimCreate = await createProjectRequest(victimApp, {
      workspaceId: victim.workspace.id,
      name: "Victim's project",
      icon: "Folder",
      slug: "ACME-VICTIM",
    });
    expect(victimCreate.status).toBe(200);

    // And the happy path keeps working end to end: a work item can be created and its
    // key uses the victim's own, non-colliding slug.
    const created = (await victimCreate.json()) as { id: string; slug: string };
    expect(created.slug).toBe("ACME-VICTIM");
  });

  it("rejects (409) updating a project's slug to one already taken by a project in a different workspace", async () => {
    const first = await createWorkspaceMember();
    mockAuthenticatedSession(first.user);
    const { app: firstApp } = createApp();
    await createProjectRequest(firstApp, {
      workspaceId: first.workspace.id,
      name: "First project",
      icon: "Folder",
      slug: "taken-slug",
    });

    // `admin`, not the default `member` -- the legacy `project` statement set
    // (`packages/permissions/src/legacy-better-auth-access-control.ts`) only grants
    // `member` `["create", "read"]`; `update` needs `admin` (or `owner`).
    const second = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(second.user);
    const { app: secondApp } = createApp();
    const secondCreate = await createProjectRequest(secondApp, {
      workspaceId: second.workspace.id,
      name: "Second project",
      icon: "Folder",
      slug: "its-own-slug",
    });
    expect(secondCreate.status).toBe(200);
    const secondProject = (await secondCreate.json()) as { id: string };

    const update = await updateProjectRequest(secondApp, secondProject.id, {
      name: "Second project",
      icon: "Folder",
      slug: "taken-slug",
      description: "",
    });

    expect(update.status).toBe(409);

    const stillOwnSlug = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, secondProject.id),
    });
    expect(stillOwnSlug?.slug).toBe("its-own-slug");
  });
});
