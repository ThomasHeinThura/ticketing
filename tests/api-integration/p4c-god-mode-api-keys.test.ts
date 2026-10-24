/**
 * AK-7 God Mode key list: instance administrators see every personal and service key with its
 * owner or workspace, including a service key whose creator has left; nobody else does; and
 * neither a key nor its hash is ever returned.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createPersonalApiKey,
  createServiceApiKey,
} from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function world() {
  const admin = await createWorkspaceMember({ role: "owner" });
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, admin.user.id));
  const other = await createWorkspaceMember({ role: "owner" });
  const personal = await createPersonalApiKey(
    { userId: other.user.id },
    { name: "someone personal" },
  );
  const service = await createServiceApiKey(
    { userId: other.user.id },
    other.workspace.id,
    { name: "other ci", capabilities: ["workspace:read"] },
  );
  return { admin, other, personal, service };
}

function get(path: string) {
  const { app } = createApp();
  return app.request(path);
}

describe("GET /api/instance/api-keys", () => {
  beforeEach(async () => resetTestDatabase());

  it("lists every key with owner and workspace for an instance administrator", async () => {
    const w = await world();
    mockAuthenticatedSession({ ...w.admin.user, role: "admin" });
    const res = await get("/api/instance/api-keys");
    expect(res.status, await res.clone().text()).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      apiKeys: {
        id: string;
        kind: string;
        ownerName: string | null;
        workspaceName: string | null;
      }[];
      hasMore: boolean;
    };
    expect(body.hasMore).toBe(false);
    const ids = body.apiKeys.map((key) => key.id);
    expect(ids).toEqual(expect.arrayContaining([w.personal.id, w.service.id]));
    const personal = body.apiKeys.find((key) => key.id === w.personal.id);
    expect(personal?.kind).toBe("personal");
    expect(personal?.ownerName).toBe(w.other.user.name);
    const service = body.apiKeys.find((key) => key.id === w.service.id);
    expect(service?.kind).toBe("service");
    expect(service?.workspaceName).toBe(w.other.workspace.name);
    // Never the secret and never its stored hash.
    expect(text).not.toContain(w.personal.key);
    expect(text).not.toContain(w.service.key);
    expect(text).not.toContain("$argon2id$");
  });

  it("marks a service key whose creator is no longer active", async () => {
    const w = await world();
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, w.other.user.id));
    mockAuthenticatedSession({ ...w.admin.user, role: "admin" });
    const res = await get("/api/instance/api-keys");
    const body = (await res.json()) as {
      apiKeys: { id: string; createdByFormerMember: boolean }[];
    };
    expect(
      body.apiKeys.find((key) => key.id === w.service.id)
        ?.createdByFormerMember,
    ).toBe(true);
  });

  it("refuses anyone who is not an instance administrator", async () => {
    const w = await world();
    mockAuthenticatedSession({ ...w.other.user, role: null });
    expect((await get("/api/instance/api-keys")).status).toBe(403);
  });

  it("honours the limit and reports more", async () => {
    const w = await world();
    mockAuthenticatedSession({ ...w.admin.user, role: "admin" });
    const res = await get("/api/instance/api-keys?limit=1");
    const body = (await res.json()) as { apiKeys: unknown[]; hasMore: boolean };
    expect(body.apiKeys).toHaveLength(1);
    expect(body.hasMore).toBe(true);
  });
});
