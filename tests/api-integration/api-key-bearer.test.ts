import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

/**
 * API keys presented as `Authorization: Bearer <key>`.
 *
 * These two assertions were rescued from device-authorization.test.ts, which
 * issue #6 deleted along with the `deviceAuthorization()` plugin. They do NOT
 * belong to the device flow: they cover TaskDesk's own credential resolution in
 * apps/api/src/utils/authenticate-api-request.ts, which accepts an API key on
 * either the Authorization header or x-api-key.
 *
 * That matters because #6 also removed better-auth's `bearer()` plugin. bearer()
 * published the raw SESSION token in a CORS-exposed response header; it has
 * nothing to do with API keys. Deleting the surrounding file without keeping
 * these would have quietly dropped coverage of a retained control while
 * removing an unrelated one — so they live here instead.
 */
function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("API integration: API key bearer authentication", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("authenticates a valid API key presented as a Bearer token", async () => {
    const member = await createWorkspaceMember();

    const rawKey = `taskdesk_test_${randomUUID()}`;
    const hashed = hashApiKeyForTest(rawKey);
    const now = new Date();

    await db.insert(schema.apikeyTable).values({
      referenceId: member.user.id,
      userId: member.user.id,
      key: hashed,
      name: "api key bearer test",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      createdAt: now,
      updatedAt: now,
    });

    const { app } = createApp();
    const res = await app.request(
      `/api/project?workspaceId=${encodeURIComponent(member.workspace.id)}`,
      { headers: { Authorization: `Bearer ${rawKey}` } },
    );

    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.key, hashed));
    expect(rows.length).toBe(1);
  });

  it("rejects an unknown Bearer token rather than falling back to anything else", async () => {
    const member = await createWorkspaceMember();
    const { app } = createApp();

    const res = await app.request(
      `/api/project?workspaceId=${encodeURIComponent(member.workspace.id)}`,
      { headers: { Authorization: "Bearer taskdesk_not_a_real_key" } },
    );

    expect(res.status).toBe(401);
  });

  it("rejects a malformed Authorization header", async () => {
    const member = await createWorkspaceMember();
    const { app } = createApp();

    const res = await app.request(
      `/api/project?workspaceId=${encodeURIComponent(member.workspace.id)}`,
      { headers: { Authorization: "Bearer" } },
    );

    expect(res.status).toBe(401);
  });
});
