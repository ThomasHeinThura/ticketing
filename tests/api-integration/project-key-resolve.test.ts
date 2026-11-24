import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { json, setupWorld } from "./helpers/reach-world";

beforeEach(async () => resetTestDatabase());

const resolve = (
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  key: string,
) =>
  json(
    app,
    "GET",
    `/api/project/by-key?workspaceId=${workspaceId}&key=${encodeURIComponent(key)}`,
  );

async function renamedWorld() {
  const world = await setupWorld();
  const { app } = createApp();
  const [before] = await db
    .select({ slug: schema.projectTable.slug })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, world.project.id));
  if (!before) throw new Error("project missing");
  // The project fixture inserts the row directly; `POST /api/project` would have claimed the key.
  await db
    .insert(schema.projectSlugClaimTable)
    .values({ slug: before.slug, projectId: world.project.id });
  mockAuthenticatedSession(world.admin.user);
  const renamed = await json(app, "PUT", `/api/project/${world.project.id}`, {
    slug: "RENAMED",
  });
  expect(renamed.status, await renamed.clone().text()).toBe(200);
  return { world, app, oldKey: before.slug, newKey: "RENAMED" };
}

describe("resolve a project key after a rename (#1200)", () => {
  it("answers the current key for the old key and for the current key, to a caller who reaches the project", async () => {
    const { world, app, oldKey, newKey } = await renamedWorld();
    for (const user of [world.projectMember.user, world.readerLead.user]) {
      mockAuthenticatedSession(user);
      for (const key of [oldKey, newKey]) {
        const response = await resolve(app, world.workspaceId, key);
        expect(response.status, await response.clone().text()).toBe(200);
        expect(await response.json()).toEqual({ slug: newKey });
      }
    }
  });

  it("answers one identical 404 for an unknown key, a key out of reach, another workspace's key and a deleted project", async () => {
    const { world, app, oldKey } = await renamedWorld();
    const other = await setupWorld();

    mockAuthenticatedSession(world.projectMember.user);
    const unknown = await resolve(app, world.workspaceId, "NOSUCHKEY");
    expect(unknown.status).toBe(404);
    const expected = await unknown.text();

    // a member with no reach to the project
    mockAuthenticatedSession(world.outsiderLead.user);
    const outOfReach = await resolve(app, world.workspaceId, oldKey);
    expect(outOfReach.status).toBe(404);
    expect(await outOfReach.text()).toBe(expected);

    // another workspace's caller asking for this project's old key in their own workspace
    mockAuthenticatedSession(other.admin.user);
    const foreign = await resolve(app, other.workspaceId, oldKey);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe(expected);

    // a workspace the caller is not in answers the same whatever the key
    const notMember = await resolve(app, world.workspaceId, oldKey);
    const notMemberUnknown = await resolve(app, world.workspaceId, "NOSUCHKEY");
    expect(notMember.status).toBe(notMemberUnknown.status);
    expect(await notMember.text()).toBe(await notMemberUnknown.text());

    // a deleted project, for a caller who did reach it
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, world.project.id));
    mockAuthenticatedSession(world.projectMember.user);
    const deleted = await resolve(app, world.workspaceId, oldKey);
    expect(deleted.status).toBe(404);
    expect(await deleted.text()).toBe(expected);
  });
});
