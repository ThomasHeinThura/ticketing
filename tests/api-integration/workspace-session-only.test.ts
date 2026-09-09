import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

/**
 * Session-only enforcement on the four S2 native read routes
 * (`apps/api/src/utils/require-session-only.ts`).
 *
 * The still-mounted better-auth `organization()` plugin these routes replace is configured
 * `enableSessionForAPIKeys: false` (`apps/api/src/auth.ts`) -- an API key never became a
 * session there, so `/organization/*` was, in effect, session-only. Every route mounted below
 * the app-wide auth guard in `index.ts` is reachable by API key too (retrofit plan risk R10),
 * so these four routes preserve the inherited restriction explicitly rather than silently
 * widening it.
 *
 * Each case is asserted with a REAL `apikey` row and a REAL Bearer/`x-api-key` header --
 * driven through `authenticateApiRequest`, not a mock -- so this exercises the same code path
 * a genuine API-key caller would.
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

async function insertApiKeyFor(userId: string): Promise<string> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const hashed = hashApiKeyForTest(rawKey);
  const now = new Date();

  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashed,
    name: "session-only test key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  return rawKey;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("session-only enforcement on the S2 native read routes", () => {
  const cases: Array<{
    name: string;
    path: (workspaceId: string) => string;
  }> = [
    { name: "GET /api/workspace", path: () => "/api/workspace" },
    {
      name: "GET /api/workspace/{workspaceId}",
      path: (workspaceId) => `/api/workspace/${workspaceId}`,
    },
    {
      name: "GET /api/workspace/{workspaceId}/invitations",
      path: (workspaceId) => `/api/workspace/${workspaceId}/invitations`,
    },
    {
      name: "GET /api/capabilities",
      path: (workspaceId) => `/api/capabilities?workspaceId=${workspaceId}`,
    },
  ];

  for (const { name, path } of cases) {
    it(`${name}: refuses a valid API key with 403, never 200`, async () => {
      const { user, workspace } = await createWorkspaceMember({
        role: "owner",
      });
      const rawKey = await insertApiKeyFor(user.id);
      const { app } = createApp();

      const response = await app.request(path(workspace.id), {
        headers: { "x-api-key": rawKey },
      });

      expect(response.status).toBe(403);
      const body = await response.text();
      expect(body.toLowerCase()).toContain("session_required");
    });

    it(`${name}: refuses the same valid API key presented as a Bearer token`, async () => {
      const { user, workspace } = await createWorkspaceMember({
        role: "owner",
      });
      const rawKey = await insertApiKeyFor(user.id);
      const { app } = createApp();

      const response = await app.request(path(workspace.id), {
        headers: { Authorization: `Bearer ${rawKey}` },
      });

      expect(response.status).toBe(403);
    });

    it(`${name}: accepts a genuine browser session`, async () => {
      const { user, workspace } = await createWorkspaceMember({
        role: "owner",
      });
      mockAuthenticatedSession(user);
      const { app } = createApp();

      const response = await app.request(path(workspace.id));

      expect(response.status).toBe(200);
    });
  }
});
