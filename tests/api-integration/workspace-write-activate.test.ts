/**
 * S8a — the native set-active route. Issue #6, retrofit plan §3 (S8a row).
 *
 * Native replacement for `authClient.organization.setActive()` at all nine call sites this
 * stage repoints. Mirrors better-auth's own `setActiveOrganization`
 * (`plugins/organization/adapter.mjs`), which writes only `session.activeOrganizationId` --
 * NOT `activeTeamId` -- and reproduces its `checkMembership` refusal
 * (`USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`, `crud-org.mjs`) via the route's own
 * `requireWorkspaceMembership` middleware.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

beforeEach(async () => {
  await resetTestDatabase();
});

async function activateWorkspaceNative(
  app: ReturnType<typeof createApp>["app"],
  cookie: string,
  workspaceId: string,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/activate`, {
    method: "POST",
    headers: { cookie },
  });
}

async function issueApiKey(userId: string): Promise<string> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const hashed = createHash("sha256")
    .update(rawKey)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashed,
    name: "S8a activate reachability probe key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

describe("S8a native set-active route", () => {
  it("switches the caller's active workspace, writing only activeOrganizationId", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const created1 = await createWorkspaceNative(app, owner.cookie, {
      name: "First Workspace",
    });
    const { id: workspaceA } = (await created1.json()) as { id: string };

    const created2 = await createWorkspaceNative(app, owner.cookie, {
      name: "Second Workspace",
    });
    const { id: workspaceB } = (await created2.json()) as { id: string };

    // Creating workspace B made it the caller's active workspace (effects 7/8 of the
    // create contract) -- confirm the starting point before switching back to A.
    const [sessionAfterCreate] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, owner.user.id));
    expect(sessionAfterCreate?.activeOrganizationId).toBe(workspaceB);
    const teamBeforeSwitch = sessionAfterCreate?.activeTeamId;

    const activated = await activateWorkspaceNative(
      app,
      owner.cookie,
      workspaceA,
    );
    expect(activated.status).toBe(200);
    expect(await activated.json()).toEqual({ workspaceId: workspaceA });

    const [sessionAfterActivate] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, sessionAfterCreate?.id ?? ""));
    expect(sessionAfterActivate?.activeOrganizationId).toBe(workspaceA);
    // Mirrors better-auth's own setActiveOrganization: activeTeamId is untouched.
    expect(sessionAfterActivate?.activeTeamId).toBe(teamBeforeSwitch);
  });

  it("refuses a caller who is not a member of the target workspace", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Owner Only",
    });
    const { id: workspaceId } = (await created.json()) as { id: string };

    const outsider = await signUpUser(app);
    const response = await activateWorkspaceNative(
      app,
      outsider.cookie,
      workspaceId,
    );

    expect(response.status).toBe(403);

    const [outsiderSession] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, outsider.user.id));
    expect(outsiderSession?.activeOrganizationId).not.toBe(workspaceId);
  });

  it("refuses an unauthenticated caller", async () => {
    const { app } = createApp();
    const response = await app.request(
      `/api/workspace/${randomUUID()}/activate`,
      { method: "POST" },
    );
    expect(response.status).toBe(401);
  });

  it("is session-only: refuses a valid API key with 403, never 200", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "API Key Reachability",
    });
    const { id: workspaceId } = (await created.json()) as { id: string };

    const rawKey = await issueApiKey(owner.user.id);
    const response = await app.request(
      `/api/workspace/${workspaceId}/activate`,
      {
        method: "POST",
        headers: { "x-api-key": rawKey },
      },
    );

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body.toLowerCase()).toContain("session_required");
  });
});
