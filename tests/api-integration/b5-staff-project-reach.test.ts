import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, grantProjectRole } from "./helpers/fixtures";
import {
  addMember,
  createItem,
  json,
  makeApiKey,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

describe("B-5: staff project reach", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  for (const role of ["member", "lead", "viewer"] as const) {
    it(`${role} cannot read the other managed service or its item`, async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const visible = await createProjectFixture({
        workspaceId: world.workspaceId,
        name: "Visible B5 project",
      });
      const [calendar] = await db
        .insert(schema.serviceCalendarTable)
        .values({
          workspaceId: world.workspaceId,
          name: "B5 calendar",
          timezone: "UTC",
          windows: {},
          holidays: [],
        })
        .returning();
      if (!calendar) throw new Error("calendar fixture missing");
      await db
        .update(schema.workspaceTable)
        .set({ defaultServiceCalendarId: calendar.id })
        .where(eq(schema.workspaceTable.id, world.workspaceId));
      await db
        .update(schema.projectTable)
        .set({
          name: "Hidden B5 service",
          kind: "managed_service",
          supportLevel: "L1",
          serviceCalendarMode: "inherit",
        })
        .where(eq(schema.projectTable.id, world.project.id));
      const item = await createItem(app, world, "Hidden B5 work item");
      const caller = await addMember(world.workspaceId, role);
      if (role !== "lead")
        await grantProjectRole(caller.user.id, visible.project.id, [
          "project:read",
          "work_item:read",
        ]);
      mockAuthenticatedSession(caller.user);
      const list = await json(
        app,
        "GET",
        `/api/project?workspaceId=${world.workspaceId}`,
      );
      expect(list.status, await list.clone().text()).toBe(200);
      const listText = await list.text();
      expect(listText).not.toContain("Hidden B5 service");
      expect(listText.includes("Visible B5 project")).toBe(role !== "lead");
      for (const path of [
        `/api/project/${world.project.id}`,
        `/api/projects/${world.project.id}/work-items`,
        `/api/work-items/${item.key}`,
      ]) {
        const response = await json(app, "GET", path);
        expect(response.status, path).toBe(404);
      }
      const search = await json(
        app,
        "GET",
        `/api/search?q=Hidden%20B5&workspaceId=${world.workspaceId}&type=projects`,
      );
      expect(search.status).toBe(200);
      const body = (await search.json()) as { totalCount: number };
      expect(body.totalCount).toBe(0);
    });
  }

  it("reorder returns only reachable projects and never renumbers hidden rows", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    const visible = await createProjectFixture({
      workspaceId: world.workspaceId,
      name: "Visible reorder",
    });
    const second = await createProjectFixture({
      workspaceId: world.workspaceId,
      name: "Second visible reorder",
    });
    const caller = await addMember(world.workspaceId, "member");
    await grantProjectRole(caller.user.id, visible.project.id, [
      "project:read",
      "work_item:read",
    ]);
    await grantProjectRole(caller.user.id, second.project.id, [
      "project:read",
      "work_item:read",
    ]);
    await db
      .update(schema.workspaceRoleTable)
      .set({ permission: JSON.stringify({ project: ["update"] }) })
      .where(eq(schema.workspaceRoleTable.role, "member"));
    await db
      .update(schema.projectTable)
      .set({ position: 4 })
      .where(eq(schema.projectTable.id, world.project.id));
    mockAuthenticatedSession(caller.user);
    const response = await json(
      app,
      "PUT",
      `/api/project/reorder?workspaceId=${world.workspaceId}`,
      {
        projects: [
          { id: second.project.id, position: 0 },
          { id: visible.project.id, position: 1 },
        ],
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = (await response.json()) as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).toEqual([
      second.project.id,
      visible.project.id,
    ]);
    const [hidden] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, world.project.id));
    expect(hidden?.position).toBe(4);
    const rejected = await json(
      app,
      "PUT",
      `/api/project/reorder?workspaceId=${world.workspaceId}`,
      { projects: [{ id: world.project.id, position: 0 }] },
    );
    expect(rejected.status).toBe(404);
    const missing = await json(
      app,
      "PUT",
      `/api/project/reorder?workspaceId=${world.workspaceId}`,
      {
        projects: [{ id: "missing-project", position: 0 }],
      },
    );
    expect(missing.status).toBe(404);
    expect(await rejected.text()).toBe(await missing.text());
    const key = await makeApiKey(caller.user.id, {
      project: ["read", "update"],
      workspace: ["read"],
    });
    mockAnonymousSession();
    setAmbientHeaders({ "x-api-key": key });
    const keyed = await json(
      app,
      "PUT",
      `/api/project/reorder?workspaceId=${world.workspaceId}`,
      { projects: [{ id: visible.project.id, position: 0 }] },
    );
    expect(keyed.status, await keyed.clone().text()).toBe(200);
    expect(await keyed.text()).not.toContain(world.project.id);
  });
});
