import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// GET /api/workspace -- the native replacement for
// authClient.organization.list() (retrofit plan, S2 row, issue #6). Read
// only: the caller's own workspaces, and never another user's.

beforeEach(async () => {
  await resetTestDatabase();
});

describe("GET /api/workspace", () => {
  it("returns only the caller's own workspaces, never another user's (A1-P3)", async () => {
    const a = await createWorkspaceMember({
      workspaceName: "Workspace A",
      role: "owner",
    });
    const b = await createWorkspaceMember({
      workspaceName: "Workspace B",
      role: "owner",
    });

    mockAuthenticatedSession(b.user);
    const { app } = createApp();

    const response = await app.request("/api/workspace");
    expect(response.status).toBe(200);
    const workspaces = (await response.json()) as Array<{
      id: string;
      role: string;
    }>;
    const ids = workspaces.map((w) => w.id);

    expect(ids).toContain(b.workspace.id);
    expect(ids).not.toContain(a.workspace.id);
    expect(workspaces).toHaveLength(1);
  });

  it("reports the caller's own role in each workspace", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request("/api/workspace");
    const workspaces = (await response.json()) as Array<{
      id: string;
      role: string;
    }>;
    const mine = workspaces.find((w) => w.id === workspace.id);

    expect(mine?.role).toBe("admin");
  });

  it("returns an empty list for a user who belongs to no workspace", async () => {
    const userId = `user-${randomUUID()}`;
    const [user] = await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: "No Workspace User",
      })
      .returning();

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request("/api/workspace");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("401s an unauthenticated caller", async () => {
    mockAnonymousSession();
    const { app } = createApp();
    const response = await app.request("/api/workspace");
    expect(response.status).toBe(401);
  });
});
