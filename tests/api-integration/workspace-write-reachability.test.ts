/**
 * S4 — who can reach the native workspace write routes at all.
 * Issue #6, retrofit plan §3 (S4 row, the DISABLE_WORKSPACE_CREATION gate)
 * and risk R10 (new routes are API-key reachable; plugin routes were not).
 *
 * R10, and why this file exists. `enableSessionForAPIKeys: false`
 * (`apps/api/src/auth.ts`) means an API key never became a better-auth
 * session, so `/organization/*` was effectively session-only. Every route
 * mounted under `apps/api/src/index.ts`'s global guard authenticates API keys
 * too — so a native create/update/delete would become API-key reachable for
 * the FIRST time, silently, as a side effect of moving the route.
 *
 * These routes therefore require a session, via `requireSessionOnly()`
 * (`apps/api/src/utils/require-session-only.ts`, #65) — the SAME control the
 * S2 native reads use, not a second implementation of it. Both a policy
 * declaration (`sessionOnly: true`, `apps/api/src/workspace/policy.ts`) and
 * this runtime enforcement exist; the declaration alone would be inert
 * metadata (nothing wires `policyRegistry` into `apps/api/src/index.ts` yet
 * — issue #8's), so the assertions below are against the runtime, not the
 * registry. Effects 7 and 8 also need a session row to mutate, so a
 * sessionless create could not satisfy the NINE-effect contract in any case.
 *
 * An earlier version of this file asserted `401` for an API-key call, back
 * when these routes ran a bespoke `requireSession` that only checked for
 * `session?.id` and could not distinguish "no credential" from "the wrong
 * kind of credential". Consolidating onto `requireSessionOnly()` means these
 * routes now give the same `403 session_required` the S2 reads give for the
 * same case — asserted below, not the stale `401`.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

beforeEach(async () => {
  await resetTestDatabase();
});

// `vi.stubEnv` rather than assigning to `process.env`: the shared setup file
// only restores mocks, so an unstubbed write would leak the flag into every
// later file in this single-worker run.
afterEach(() => {
  vi.unstubAllEnvs();
});

// Minted by direct insert, the same way tests/api-integration/api-key-bearer.test.ts
// does it: the api-key plugin's own hashing is not the subject here, and going
// through its route would couple this probe to that route's own gating.
function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function issueApiKey(userId: string): Promise<string> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "A2 reachability probe key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

describe("S4 native writes are session-only (A2-P22)", () => {
  it("A2-P22 refuses an API key on create, update and delete, and writes nothing", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Session Only",
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };

    const apiKey = await issueApiKey(owner.user.id);
    const keyHeaders = {
      "content-type": "application/json",
      "x-api-key": apiKey,
    };

    const create = await app.request("/api/workspace", {
      method: "POST",
      headers: keyHeaders,
      body: JSON.stringify({ name: "By Key" }),
    });
    expect(create.status).toBe(403);
    expect(await create.text()).toContain("session_required");

    const update = await app.request(`/api/workspace/${id}`, {
      method: "PATCH",
      headers: keyHeaders,
      body: JSON.stringify({ name: "By Key" }),
    });
    expect(update.status).toBe(403);
    expect(await update.text()).toContain("session_required");

    const remove = await app.request(`/api/workspace/${id}`, {
      method: "DELETE",
      headers: { "x-api-key": apiKey },
    });
    expect(remove.status).toBe(403);
    expect(await remove.text()).toContain("session_required");

    const rows = await db.select().from(schema.workspaceTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Session Only");
  });
});

describe("S4 create honours DISABLE_WORKSPACE_CREATION (A2-P23)", () => {
  it("A2-P23 refuses a non-admin and admits an instance admin, reading the role fresh from the database", async () => {
    const { app } = createApp();
    // The first user is promoted to instance admin by the sign-up hook, so
    // the second is an ordinary user.
    const instanceAdmin = await signUpUser(app);
    const ordinary = await signUpUser(app);

    const [adminRow] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    expect(adminRow?.role).toBe("admin");

    vi.stubEnv("DISABLE_WORKSPACE_CREATION", "true");

    const refused = await createWorkspaceNative(app, ordinary.cookie, {
      name: "Not Allowed",
    });
    expect(refused.status).toBe(403);
    expect(await db.select().from(schema.workspaceTable)).toHaveLength(0);

    const allowed = await createWorkspaceNative(app, instanceAdmin.cookie, {
      name: "Allowed",
    });
    expect(allowed.status).toBe(200);
    expect(await db.select().from(schema.workspaceTable)).toHaveLength(1);
  });
});
