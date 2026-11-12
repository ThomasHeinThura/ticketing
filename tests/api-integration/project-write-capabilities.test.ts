import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { grantProjectRole } from "./helpers/fixtures";
import {
  addMember,
  json,
  makeApiKey,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

describe("project write capabilities", () => {
  beforeEach(async () => resetTestDatabase());
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("requires workspace project authority and all API key scopes for project writes", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    const editor = await addMember(world.workspaceId, "member");
    await grantProjectRole(editor.user.id, world.project.id, [
      "project:read",
      "project:update",
    ]);
    const reader = await addMember(world.workspaceId, "lead");
    await grantProjectRole(reader.user.id, world.project.id, ["project:read"]);
    mockAuthenticatedSession(editor.user);
    const update = await json(app, "PUT", `/api/project/${world.project.id}`, {
      name: "Edited project",
      icon: "Folder",
      slug: world.project.slug,
      description: "edited",
    });
    expect(update.status, await update.clone().text()).toBe(403);
    const milestone = await json(
      app,
      "POST",
      `/api/project/${world.project.id}/milestones`,
      { name: "milestone", date: "2031-01-01T00:00:00.000Z" },
    );
    expect(milestone.status, await milestone.clone().text()).toBe(403);
    const archive = await json(
      app,
      "PUT",
      `/api/project/${world.project.id}/archive`,
    );
    expect(archive.status).toBe(403);
    mockAuthenticatedSession(reader.user);
    expect(
      (
        await json(app, "POST", `/api/project/${world.project.id}/milestones`, {
          name: "denied",
          date: "2031-01-01T00:00:00.000Z",
        })
      ).status,
    ).toBe(403);
    const admin = await addMember(world.workspaceId, "admin");
    await grantProjectRole(admin.user.id, world.project.id, [
      "project:read",
      "project:update",
    ]);
    mockAuthenticatedSession(admin.user);
    const adminUpdate = await json(
      app,
      "PUT",
      `/api/project/${world.project.id}`,
      {
        name: "Edited project",
        icon: "Folder",
        slug: world.project.slug,
        description: "edited",
      },
    );
    expect(adminUpdate.status, await adminUpdate.clone().text()).toBe(200);
    const adminMilestone = await json(
      app,
      "POST",
      `/api/project/${world.project.id}/milestones`,
      { name: "admin milestone", date: "2031-01-01T00:00:00.000Z" },
    );
    expect(adminMilestone.status, await adminMilestone.clone().text()).toBe(
      200,
    );
    const key = await makeApiKey(admin.user.id, {
      project: ["read", "update"],
    });
    mockAnonymousSession();
    setAmbientHeaders({ "x-api-key": key });
    const keyed = await json(
      app,
      "POST",
      `/api/project/${world.project.id}/milestones`,
      { name: "keyed", date: "2031-01-01T00:00:00.000Z" },
    );
    expect(keyed.status, await keyed.clone().text()).toBe(200);
    const narrow = await makeApiKey(admin.user.id, { project: ["read"] });
    setAmbientHeaders({ "x-api-key": narrow });
    expect(
      (
        await json(app, "POST", `/api/project/${world.project.id}/milestones`, {
          name: "denied",
          date: "2031-01-01T00:00:00.000Z",
        })
      ).status,
    ).toBe(403);
  });
});
