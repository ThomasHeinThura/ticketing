/**
 * #750: a key's identity carries its STORED capability scope on the project-reach routes.
 *
 * `resolveCallerIdentity` used to build a key identity with no capability subset, so
 * `can()` refused every key on a route that evaluates the project capability itself
 * (`GET /api/project/{id}`) while the owner's session got 200. The key now holds exactly
 * `owner authority ∩ stored scope`; a null, malformed or insufficient scope still holds
 * nothing, and a key never exceeds the authority of its owner in the project.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
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

async function getProject(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
) {
  return json(app, "GET", `/api/project/${projectId}`);
}

describe("API integration: API-key identity carries its stored capability scope (#750)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  async function arrange() {
    const world = await setupWorld();
    const { app } = createApp();
    return { world, app };
  }

  it("the owner's session reads the project (baseline)", async () => {
    const { world, app } = await arrange();
    mockAuthenticatedSession(world.projectMember.user);
    expect((await getProject(app, world.project.id)).status).toBe(200);
  });

  it("a key scoped to project:read succeeds where its owner's session succeeds", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    for (const permissions of [
      { project: ["read"] },
      { project: ["read"], work_item: ["read"] },
      { project: ["read", "update"], work_item: ["read", "update"] },
    ]) {
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, permissions),
      });
      const response = await getProject(app, world.project.id);
      expect(response.status, await response.text()).toBe(200);
    }
  });

  it("a null, malformed or insufficient stored scope is still refused (fail closed)", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    const refused: unknown[] = [
      null,
      { project: "read" },
      { project: [1] },
      // Valid and malformed together: nothing is granted, not even the valid part.
      { project: ["read"], work_item: [1] },
      { work_item: [1], project: ["read"] },
      { project: ["read"], work_item: "read" },
      { project: [["read"]] },
      {},
      { work_item: ["read"] },
      { workspace: ["read"] },
      { project: ["not_a_capability"] },
      { unknown_resource: ["read"] },
    ];
    for (const permissions of refused) {
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, permissions),
      });
      const response = await getProject(app, world.project.id);
      expect(
        response.status,
        `${JSON.stringify(permissions)}: ${await response.text()}`,
      ).toBe(403);
    }
  });

  it("a key never exceeds its owner: a scope the owner lacks in the project is refused like the session", async () => {
    const { world, app } = await arrange();
    const owner = await addMember(world.workspaceId, "admin");
    // The owner reaches the project but holds no project:read through its role.
    await grantProjectRole(owner.user.id, world.project.id, ["work_item:read"]);
    mockAuthenticatedSession(owner.user);
    expect((await getProject(app, world.project.id)).status).toBe(403);

    mockAnonymousSession();
    setAmbientHeaders({
      "x-api-key": await makeApiKey(owner.user.id, {
        project: ["read", "update", "delete", "manage_settings"],
        work_item: ["read"],
      }),
    });
    expect((await getProject(app, world.project.id)).status).toBe(403);
  });

  it("a fully scoped key owned by someone outside project reach is still a 404", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    setAmbientHeaders({
      "x-api-key": await makeApiKey(world.outsiderLead.user.id, {
        project: ["read"],
        work_item: ["read"],
      }),
    });
    expect((await getProject(app, world.project.id)).status).toBe(404);
  });

  it("a disabled key is refused outright, whatever its scope", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    const raw = await makeApiKey(world.projectMember.user.id, {
      project: ["read"],
    });
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.userId, world.projectMember.user.id));
    setAmbientHeaders({ "x-api-key": raw });
    const response = await getProject(app, world.project.id);
    expect(response.status, await response.text()).toBe(401);
  });

  it("a scope that implies read (project:update) holds read, exactly as for a session role", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    setAmbientHeaders({
      "x-api-key": await makeApiKey(world.projectMember.user.id, {
        project: ["update"],
      }),
    });
    expect((await getProject(app, world.project.id)).status).toBe(200);
  });

  it("a null or mixed-malformed scope is refused on a second project-reach route too (not only GET /api/project/{id})", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    for (const permissions of [null, { project: ["read"], work_item: [1] }]) {
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, permissions),
      });
      const response = await json(
        app,
        "GET",
        `/api/project/${world.project.id}/milestones`,
      );
      expect(response.status, JSON.stringify(permissions)).toBe(403);
    }
    // Control: a valid scope reads the same route.
    setAmbientHeaders({
      "x-api-key": await makeApiKey(world.projectMember.user.id, {
        project: ["read"],
      }),
    });
    const ok = await json(
      app,
      "GET",
      `/api/project/${world.project.id}/milestones`,
    );
    expect(ok.status, await ok.text()).toBe(200);
  });
});
