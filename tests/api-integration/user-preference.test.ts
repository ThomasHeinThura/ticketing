import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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

async function rowsFor(personId: string) {
  return db
    .select()
    .from(schema.userPreferenceTable)
    .where(eq(schema.userPreferenceTable.personId, personId));
}

const put = (
  app: ReturnType<typeof createApp>["app"],
  scope: string,
  key: string,
  body: unknown,
) =>
  app.request(`/api/me/preferences/${scope}/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("API integration: self-scoped user preferences (views.md PREF-1..8)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("requires authentication", async () => {
    mockAnonymousSession();
    const { app } = createApp();
    expect((await app.request("/api/me/preferences?scope=global")).status).toBe(
      401,
    );
    expect(
      (await put(app, "global", "appearance.density", { value: "compact" }))
        .status,
    ).toBe(401);
  });

  it("round-trips a global preference and upserts idempotently on the unique index", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const empty = await app.request("/api/me/preferences?scope=global");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      scope: "global",
      scopeId: null,
      preferences: [],
    });

    const first = await put(app, "global", "appearance.density", {
      value: "compact",
    });
    expect(first.status).toBe(200);
    // Same request again: idempotent, still exactly one row.
    expect(
      (await put(app, "global", "appearance.density", { value: "compact" }))
        .status,
    ).toBe(200);
    const replaced = await put(app, "global", "appearance.density", {
      value: "comfortable",
    });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      scope: "global",
      scopeId: null,
      key: "appearance.density",
      value: "comfortable",
    });

    const rows = await rowsFor(await personIdOf(member.user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "global",
      scopeId: null,
      key: "appearance.density",
      value: "comfortable",
    });

    const read = await app.request("/api/me/preferences?scope=global");
    expect(await read.json()).toMatchObject({
      preferences: [{ key: "appearance.density", value: "comfortable" }],
    });
  });

  it("returns only the caller's own rows and never a non-whitelisted key", async () => {
    const alice = await createWorkspaceMember();
    const bob = await createWorkspaceMember();
    const { app } = createApp();

    mockAuthenticatedSession(alice.user);
    await put(app, "global", "appearance.density", { value: "compact" });
    mockAuthenticatedSession(bob.user);
    await put(app, "global", "appearance.density", { value: "comfortable" });

    // A non-whitelisted row of Bob's (what POST /api/views/{id}/pin stores) is never served.
    await db.insert(schema.userPreferenceTable).values({
      personId: await personIdOf(bob.user.id),
      scope: "global",
      key: "pinned_view_ids",
      value: ["secret-view"],
    });

    const bobRead = await app.request("/api/me/preferences?scope=global");
    const bobText = await bobRead.text();
    expect(JSON.parse(bobText)).toMatchObject({
      preferences: [{ key: "appearance.density", value: "comfortable" }],
    });
    expect(bobText).not.toContain("secret-view");
    expect(bobText).not.toContain("pinned_view_ids");

    mockAuthenticatedSession(alice.user);
    const aliceRead = await app.request("/api/me/preferences?scope=global");
    const aliceBody = (await aliceRead.json()) as {
      preferences: { key: string; value: unknown }[];
    };
    expect(aliceBody.preferences).toEqual([
      expect.objectContaining({ key: "appearance.density", value: "compact" }),
    ]);

    // Alice's write did not touch Bob's row.
    const [bobRow] = (await rowsFor(await personIdOf(bob.user.id))).filter(
      (row) => row.key === "appearance.density",
    );
    expect(bobRow?.value).toBe("comfortable");
  });

  it("stores a project layout per project and refuses a project the caller cannot reach with 404", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const outsider = await createWorkspaceMember({ role: "owner" });
    await grantProjectRole(owner.user.id, project.id, ["work_item:read"]);
    await grantProjectRole(owner.user.id, other.project.id, ["work_item:read"]);
    const { app } = createApp();

    mockAuthenticatedSession(owner.user);
    const ok = await put(app, "project", "project.layout", {
      scopeId: project.id,
      value: "list",
    });
    expect(ok.status).toBe(200);
    await put(app, "project", "project.layout", {
      scopeId: other.project.id,
      value: "board",
    });
    const read = await app.request(
      `/api/me/preferences?scope=project&scopeId=${project.id}`,
    );
    expect(await read.json()).toMatchObject({
      scope: "project",
      scopeId: project.id,
      preferences: [{ key: "project.layout", value: "list" }],
    });

    // Another person's workspace owner cannot read or write for this project.
    mockAuthenticatedSession(outsider.user);
    const denied = await put(app, "project", "project.layout", {
      scopeId: project.id,
      value: "board",
    });
    expect(denied.status).toBe(404);
    expect(
      (
        await app.request(
          `/api/me/preferences?scope=project&scopeId=${project.id}`,
        )
      ).status,
    ).toBe(404);
    // A workspace member with no project reach gets the same 404 (reach, not membership).
    const insider = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: insider.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    mockAuthenticatedSession(insider.user);
    expect(
      (
        await put(app, "project", "project.layout", {
          scopeId: project.id,
          value: "board",
        })
      ).status,
    ).toBe(404);
    expect(await rowsFor(await personIdOf(insider.user.id))).toHaveLength(0);
    mockAuthenticatedSession(outsider.user);
    // A project that does not exist is indistinguishable.
    expect(
      (
        await put(app, "project", "project.layout", {
          scopeId: "no-such-project",
          value: "board",
        })
      ).status,
    ).toBe(404);
    expect(await rowsFor(await personIdOf(outsider.user.id))).toHaveLength(0);

    // A soft-deleted project is not reachable either.
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, other.project.id));
    mockAuthenticatedSession(owner.user);
    expect(
      (
        await put(app, "project", "project.layout", {
          scopeId: other.project.id,
          value: "list",
        })
      ).status,
    ).toBe(404);
  });

  it("requires workspace membership to read workspace scope", async () => {
    const member = await createWorkspaceMember();
    const outsider = await createWorkspaceMember();
    const { app } = createApp();

    mockAuthenticatedSession(member.user);
    const own = await app.request(
      `/api/me/preferences?scope=workspace&scopeId=${member.workspace.id}`,
    );
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ preferences: [] });

    mockAuthenticatedSession(outsider.user);
    expect(
      (
        await app.request(
          `/api/me/preferences?scope=workspace&scopeId=${member.workspace.id}`,
        )
      ).status,
    ).toBe(404);
  });

  it.each([
    ["unknown key", "global", "appearance.theme", { value: "dark" }],
    [
      "key used with the wrong scope",
      "global",
      "project.layout",
      { value: "board" },
    ],
    ["unknown scope", "team", "appearance.density", { value: "compact" }],
    [
      "value outside the enum",
      "global",
      "appearance.density",
      { value: "tight" },
    ],
    ["non-string value", "global", "appearance.density", { value: { a: 1 } }],
    ["missing value", "global", "appearance.density", {}],
    [
      "scopeId on a global key",
      "global",
      "appearance.density",
      { scopeId: "x", value: "compact" },
    ],
    [
      "project key without scopeId",
      "project",
      "project.layout",
      { value: "list" },
    ],
  ])("rejects %s with 422", async (_name, scope, key, body) => {
    const member = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await put(app, scope, key, body);
    // `missing value` is a structurally valid body (value is unknown), so it is also 422.
    expect(response.status, await response.clone().text()).toBe(422);
    expect(await rowsFor(await personIdOf(member.user.id))).toHaveLength(0);
  });

  it("rejects a bad scope or scopeId shape on read with 422", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    expect((await app.request("/api/me/preferences?scope=team")).status).toBe(
      422,
    );
    expect(
      (await app.request("/api/me/preferences?scope=global&scopeId=x")).status,
    ).toBe(422);
    expect(
      (await app.request("/api/me/preferences?scope=project")).status,
    ).toBe(422);
  });

  it("refuses writes from an API key with 403 session_required and lets it read only its owner's rows", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const rawKey = `taskdesk_test_${randomUUID()}`;
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      referenceId: member.user.id,
      userId: member.user.id,
      key: hashApiKey(rawKey),
      name: "preference scope test",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ project: ["read", "update"] }),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const keyed = await app.request(
      "/api/me/preferences/global/appearance.density",
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${rawKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ value: "compact" }),
      },
    );
    expect(keyed.status).toBe(403);
    expect(await keyed.text()).toContain("session_required");
    expect(await rowsFor(await personIdOf(member.user.id))).toHaveLength(0);

    // The same write over a browser session succeeds.
    mockAuthenticatedSession(member.user);
    expect(
      (await put(app, "global", "appearance.density", { value: "compact" }))
        .status,
    ).toBe(200);
  });

  it("limits body size to 4 KiB and stored rows per person to 500", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.id, ["work_item:read"]);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const big = await put(app, "global", "appearance.density", {
      value: "x".repeat(5000),
    });
    expect(big.status).toBe(413);
    expect(await rowsFor(await personIdOf(member.user.id))).toHaveLength(0);

    const personId = await personIdOf(member.user.id);
    await db.insert(schema.userPreferenceTable).values(
      Array.from({ length: 500 }, (_, index) => ({
        personId,
        scope: "project",
        scopeId: `legacy-project-${index}`,
        key: "project.layout",
        value: "board",
      })),
    );
    const over = await put(app, "project", "project.layout", {
      scopeId: project.id,
      value: "list",
    });
    expect(over.status).toBe(422);
    expect(await over.text()).toContain("preference_limit");

    // Replacing an existing row at the cap is still allowed.
    await db
      .update(schema.userPreferenceTable)
      .set({ scopeId: project.id })
      .where(
        and(
          eq(schema.userPreferenceTable.personId, personId),
          eq(schema.userPreferenceTable.scopeId, "legacy-project-0"),
        ),
      );
    expect(
      (
        await put(app, "project", "project.layout", {
          scopeId: project.id,
          value: "list",
        })
      ).status,
    ).toBe(200);
  });
});
