/**
 * P1-1 / PR-2 / PR-3: what a PARENT-only project member may DO inside a child project
 * (WRITTEN, NOT RUN by its author -- the coordinator runs DB integration tests).
 *
 * Reach is inherited from the parent; authority must follow the same inheritance rather than
 * fall back to the (wider) workspace role. Driven through the real HTTP route chain
 * (workspace middleware, work-item reach, strict policy enforcement).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { setProjectParent } from "../../apps/api/src/project/hierarchy.repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  WORK_ITEM_PROJECT_CAPABILITIES,
} from "./helpers/fixtures";
import { projectKey } from "./helpers/project-key";
import { addMember, json, setupWorld } from "./helpers/reach-world";

async function arrange() {
  const world = await setupWorld();
  const { app } = createApp();
  const child = (
    await createProjectFixture({
      workspaceId: world.workspaceId,
      slug: projectKey(),
    })
  ).project;
  await setProjectParent(db, child.id, world.project.id);
  // The child uses the same state templates (and so the same workflow transition) as the parent.
  const now = new Date();
  const templates: [string | null, boolean][] = [
    [world.transition.fromStateTemplateId, true],
    [world.transition.toStateTemplateId, false],
  ];
  for (const [stateTemplateId, isDefault] of templates) {
    if (!stateTemplateId) throw new Error("transition template missing");
    await db.insert(schema.stateTable).values({
      projectId: child.id,
      stateTemplateId,
      isDefault,
      createdAt: now,
      updatedAt: now,
    });
  }
  // The world's admin holds the full item capability set on the PARENT only: it creates the
  // child's fixture item purely through inherited authority.
  mockAuthenticatedSession(world.admin.user);
  const created = await json(
    app,
    "POST",
    `/api/projects/${child.id}/work-items`,
    { typeId: world.type.id, title: `Child item ${randomUUID()}` },
  );
  expect(created.status, await created.clone().text()).toBe(200);
  const item = (await created.json()) as { id: string; key: string };
  return { world, app, child, item };
}

async function storedItem(id: string) {
  const [row] = await db
    .select({
      title: schema.workItemTable.title,
      stateId: schema.workItemTable.stateId,
    })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, id));
  return row;
}

describe("API integration: inherited project authority (P1-1)", () => {
  beforeEach(async () => resetTestDatabase());

  it("a parent-lead acts with the parent's authority in the child (inherited, not workspace role)", async () => {
    const { world, app, child, item } = await arrange();
    const lead = await addMember(world.workspaceId, "member");
    await grantProjectRole(lead.user.id, world.project.id, [
      ...WORK_ITEM_PROJECT_CAPABILITIES,
    ]);
    mockAuthenticatedSession(lead.user);
    const update = await json(
      app,
      "PATCH",
      `/api/work-items/${item.key}`,
      { title: "Renamed by parent lead" },
      { "if-match": '"1"' },
    );
    expect(update.status, await update.clone().text()).toBe(200);
    const create = await json(
      app,
      "POST",
      `/api/projects/${child.id}/work-items`,
      { typeId: world.type.id, title: "Created by parent lead" },
    );
    expect(create.status, await create.clone().text()).toBe(200);
  });

  it("a parent-only VIEWER with a strong workspace role reads the child but cannot create, update or transition there", async () => {
    const { world, app, child, item } = await arrange();
    const viewer = await addMember(world.workspaceId, "admin");
    await grantProjectRole(viewer.user.id, world.project.id, [
      "project:read",
      "work_item:read",
    ]);
    const before = await storedItem(item.id);
    mockAuthenticatedSession(viewer.user);

    const read = await json(app, "GET", `/api/work-items/${item.key}`);
    expect(read.status, await read.clone().text()).toBe(200);

    const create = await json(
      app,
      "POST",
      `/api/projects/${child.id}/work-items`,
      { typeId: world.type.id, title: "Should not exist" },
    );
    expect(create.status).toBe(403);

    const update = await json(
      app,
      "PATCH",
      `/api/work-items/${item.key}`,
      { title: "Overwritten by a viewer" },
      { "if-match": '"1"' },
    );
    expect(update.status).toBe(403);

    const transition = await json(
      app,
      "POST",
      `/api/work-items/${item.key}/transition`,
      { toStateTemplateId: world.transition.toStateTemplateId },
    );
    expect(transition.status).toBe(403);

    expect(await storedItem(item.id)).toEqual(before);
    const leaked = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.title, "Should not exist"));
    expect(leaked).toHaveLength(0);
  });

  it("an explicit narrower child grant overrides a wider parent grant (PR-3)", async () => {
    const { world, app, child, item } = await arrange();
    const person = await addMember(world.workspaceId, "admin");
    await grantProjectRole(person.user.id, world.project.id, [
      ...WORK_ITEM_PROJECT_CAPABILITIES,
    ]);
    await grantProjectRole(person.user.id, child.id, [
      "project:read",
      "work_item:read",
    ]);
    mockAuthenticatedSession(person.user);
    const update = await json(
      app,
      "PATCH",
      `/api/work-items/${item.key}`,
      { title: "Overwritten despite child viewer grant" },
      { "if-match": '"1"' },
    );
    expect(update.status).toBe(403);
  });

  it("a workspace member with no project grant on the parent or the child is still refused as before (404)", async () => {
    const { world, app, item } = await arrange();
    const outsider = await addMember(world.workspaceId, "admin");
    mockAuthenticatedSession(outsider.user);
    const read = await json(app, "GET", `/api/work-items/${item.key}`);
    expect(read.status).toBe(404);
  });
});
