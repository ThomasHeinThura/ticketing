import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];

function hashApiKey(rawKey: string): string {
  return createHash("sha256")
    .update(rawKey)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function personIdOf(userId: string) {
  const person = await db.query.personTable.findFirst({
    where: eq(schema.personTable.userId, userId),
  });
  if (!person) throw new Error("person was not provisioned");
  return person.id;
}

async function rowsFor(userId: string) {
  return db
    .select()
    .from(schema.userPreferenceTable)
    .where(eq(schema.userPreferenceTable.personId, await personIdOf(userId)));
}

const patch = (app: App, body: unknown) =>
  app.request("/api/me/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const get = async (app: App) => {
  const response = await app.request("/api/me/settings");
  expect(response.status).toBe(200);
  return (await response.json()) as { settings: Record<string, unknown> };
};

describe("API integration: GET/PATCH /api/me/settings (settings-hierarchy.md ST-12..ST-16)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("requires authentication", async () => {
    mockAnonymousSession();
    const { app } = createApp();
    expect((await app.request("/api/me/settings")).status).toBe(401);
    expect((await patch(app, { density: "compact" })).status).toBe(401);
  });

  it("round-trips density, maps it to a global row and upserts idempotently", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    expect(await get(app)).toEqual({ settings: {} });

    expect((await patch(app, { density: "compact" })).status).toBe(200);
    expect((await patch(app, { density: "compact" })).status).toBe(200);
    const replaced = await patch(app, { density: "comfortable" });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual({
      settings: { density: "comfortable" },
    });

    const rows = await rowsFor(member.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "global",
      scopeId: null,
      key: "density",
      value: "comfortable",
    });
    expect(await get(app)).toEqual({ settings: { density: "comfortable" } });

    // null clears the key.
    expect(await (await patch(app, { density: null })).json()).toEqual({
      settings: {},
    });
    expect(await rowsFor(member.user.id)).toHaveLength(0);
  });

  it("returns only the caller's own rows and never a non-whitelisted row", async () => {
    const alice = await createWorkspaceMember();
    const bob = await createWorkspaceMember();
    const { app } = createApp();

    mockAuthenticatedSession(alice.user);
    await patch(app, { density: "compact" });
    mockAuthenticatedSession(bob.user);
    await patch(app, { density: "comfortable" });
    // What POST /api/views/{id}/pin stores is never served here.
    await db.insert(schema.userPreferenceTable).values({
      personId: await personIdOf(bob.user.id),
      scope: "global",
      key: "pinned_view_ids",
      value: ["secret-view"],
    });

    const bobText = await (await app.request("/api/me/settings")).text();
    expect(JSON.parse(bobText)).toEqual({
      settings: { density: "comfortable" },
    });
    expect(bobText).not.toContain("secret-view");

    mockAuthenticatedSession(alice.user);
    expect(await get(app)).toEqual({ settings: { density: "compact" } });
  });

  it("stores layout.<projectId> as a project row and 404s for a project the caller cannot reach", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, ["work_item:read"]);
    await grantProjectRole(owner.user.id, other.project.id, ["work_item:read"]);
    const outsider = await createWorkspaceMember({ role: "owner" });
    const insider = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: insider.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const { app } = createApp();

    mockAuthenticatedSession(owner.user);
    const ok = await patch(app, {
      [`layout.${project.id}`]: "list",
      [`layout.${other.project.id}`]: "board",
      density: "compact",
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      settings: {
        density: "compact",
        [`layout.${project.id}`]: "list",
        [`layout.${other.project.id}`]: "board",
      },
    });
    const layoutRow = (await rowsFor(owner.user.id)).find(
      (row) => row.scopeId === project.id,
    );
    expect(layoutRow).toMatchObject({
      scope: "project",
      scopeId: project.id,
      key: "layout",
      value: "list",
    });

    // Outsider and a workspace member without project reach: 404, nothing written.
    for (const user of [outsider.user, insider.user]) {
      mockAuthenticatedSession(user);
      const denied = await patch(app, {
        density: "compact",
        [`layout.${project.id}`]: "board",
      });
      expect(denied.status).toBe(404);
      expect(await rowsFor(user.id)).toHaveLength(0);
      expect(await get(app)).toEqual({ settings: {} });
    }
    mockAuthenticatedSession(outsider.user);
    expect(
      (await patch(app, { "layout.no-such-project": "board" })).status,
    ).toBe(404);

    // A soft-deleted project is unreachable on write and omitted on read.
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, other.project.id));
    mockAuthenticatedSession(owner.user);
    expect(
      (await patch(app, { [`layout.${other.project.id}`]: "list" })).status,
    ).toBe(404);
    expect(await get(app)).toEqual({
      settings: { density: "compact", [`layout.${project.id}`]: "list" },
    });
  });

  it.each([
    ["unknown key", { accent: "red" }],
    ["theme (no specified value domain)", { theme: "dark" }],
    ["sidebar (no specified value domain)", { sidebar: "open" }],
    ["empty layout project id", { "layout.": "board" }],
    ["value outside the enum", { density: "tight" }],
    ["non-string value", { density: { a: 1 } }],
    ["layout outside the enum", { "layout.p1": "table" }],
    ["empty object", {}],
  ])("rejects %s with 422 and writes nothing", async (_name, body) => {
    const member = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await patch(app, body);
    expect(response.status, await response.clone().text()).toBe(422);
    expect(await rowsFor(member.user.id)).toHaveLength(0);
  });

  it("validates every key before writing any", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    expect(
      (await patch(app, { density: "compact", theme: "dark" })).status,
    ).toBe(422);
    expect(await rowsFor(member.user.id)).toHaveLength(0);
  });

  it("refuses PATCH from an API key with 403 session_required but lets it read", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const rawKey = `taskdesk_test_${randomUUID()}`;
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      referenceId: member.user.id,
      userId: member.user.id,
      key: hashApiKey(rawKey),
      name: "settings scope test",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ project: ["read", "update"] }),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const keyed = await app.request("/api/me/settings", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ density: "compact" }),
    });
    expect(keyed.status).toBe(403);
    expect(await keyed.text()).toContain("session_required");
    expect(await rowsFor(member.user.id)).toHaveLength(0);

    const keyedRead = await app.request("/api/me/settings", {
      headers: { authorization: `Bearer ${rawKey}` },
    });
    expect(keyedRead.status).toBe(200);

    mockAuthenticatedSession(member.user);
    expect((await patch(app, { density: "compact" })).status).toBe(200);
  });

  it("limits the body to 4 KiB, keys per request to 20 and stored rows per person to 500", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.id, ["work_item:read"]);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    expect((await patch(app, { density: "x".repeat(5000) })).status).toBe(413);
    const manyKeys = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`layout.p${index}`, "board"]),
    );
    expect((await patch(app, manyKeys)).status).toBe(422);
    expect(await rowsFor(member.user.id)).toHaveLength(0);

    const personId = await personIdOf(member.user.id);
    await db.insert(schema.userPreferenceTable).values(
      Array.from({ length: 500 }, (_, index) => ({
        personId,
        scope: "project",
        scopeId: `legacy-project-${index}`,
        key: "layout",
        value: "board",
      })),
    );
    const over = await patch(app, { [`layout.${project.id}`]: "list" });
    expect(over.status).toBe(422);
    expect(await over.text()).toContain("settings_limit");

    // Replacing an existing row at the cap is still allowed.
    await db
      .update(schema.userPreferenceTable)
      .set({ scopeId: project.id })
      .where(eq(schema.userPreferenceTable.scopeId, "legacy-project-0"));
    expect(
      (await patch(app, { [`layout.${project.id}`]: "list" })).status,
    ).toBe(200);
  });
});
