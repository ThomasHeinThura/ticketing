/**
 * `GET /api/workspace/{workspaceId}/work-item-types` — the create dialog's Type picker
 * (`WI-1`; `apps/api/src/work-item/controllers/list-work-item-types.ts`).
 *
 * Covers what is NEW: the workspace-scoped read shape, cross-workspace isolation, the
 * role boundary (`workspace:read`), the uniform answer for an out-of-reach workspace
 * (#307's property for this helper family) and the NUL-byte guard.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function makeType(
  workspaceId: string,
  values: Partial<{
    key: string;
    name: string;
    icon: string | null;
    category: string;
    isEpic: boolean;
    isChange: boolean;
  }> = {},
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: values.key ?? `type-${randomUUID()}`,
        name: values.name ?? "Task",
        icon: values.icon ?? null,
        category: values.category ?? "delivery",
        isEpic: values.isEpic ?? false,
        isChange: values.isChange ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeType",
  );
}

/** Adds a second user to an EXISTING workspace with the given built-in role. Only
 * `workspace_member.role` is written -- `requireWorkspaceCapability` (the mechanism this
 * route enforces with) reads that column alone. */
async function addWorkspaceMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: "Integration Test User",
      })
      .returning(),
    "addWorkspaceMember: user",
  );

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  return user;
}

describe("API integration: work-item types list (#23 create dialog)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns the workspace's own types, narrow shape, ordered by category then name", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "member" });
    await makeType(workspace.id, {
      key: "task",
      name: "Task",
      category: "delivery",
    });
    await makeType(workspace.id, {
      key: "incident",
      name: "Incident",
      category: "service",
    });
    await makeType(workspace.id, {
      key: "change",
      name: "Change",
      category: "service",
      isChange: true,
    });
    // A type in a DIFFERENT workspace must never appear.
    const other = await createWorkspaceMember({ role: "member" });
    await makeType(other.workspace.id, { key: "foreign", name: "Foreign" });

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${workspace.id}/work-item-types`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;

    // delivery < service alphabetically; Change < Incident within service.
    expect(body.map((row) => row.name)).toEqual(["Task", "Change", "Incident"]);
    expect(body.map((row) => row.name)).not.toContain("Foreign");
    expect(body[0]).toEqual({
      id: expect.any(String),
      key: "task",
      name: "Task",
      icon: null,
      category: "delivery",
      isEpic: false,
      isChange: false,
    });
    expect(body[1]?.isChange).toBe(true);
  });

  it("workspace:read roles (viewer) may read the catalogue", async () => {
    const seed = await createWorkspaceMember({ role: "member" });
    await makeType(seed.workspace.id, { key: "task", name: "Task" });

    const viewer = await addWorkspaceMember(seed.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${seed.workspace.id}/work-item-types`,
    );
    expect(response.status).toBe(200);
  });

  it("a caller whose workspace role lacks workspace:read (customer) is refused with 403", async () => {
    const seed = await createWorkspaceMember({ role: "member" });
    await makeType(seed.workspace.id, { key: "task", name: "Task" });

    const customer = await addWorkspaceMember(seed.workspace.id, "customer");
    mockAuthenticatedSession(customer);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${seed.workspace.id}/work-item-types`,
    );
    expect(response.status).toBe(403);
  });

  it("an out-of-reach caller gets the same 403 an unknown workspace id gets (no distinguishing answer)", async () => {
    // `workspaceAccess.fromParam` + `validateWorkspaceAccess` check MEMBERSHIP only, so a
    // workspace the caller isn't in and a workspace that does not exist are answered
    // identically -- the same uniformity #307 established for the lookup family, here
    // verified for the param family this route uses.
    const seed = await createWorkspaceMember({ role: "member" });
    const stranger = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(stranger.user);
    const { app } = createApp();

    const outOfReach = await app.request(
      `/api/workspace/${seed.workspace.id}/work-item-types`,
    );
    const unknown = await app.request(
      `/api/workspace/${randomUUID()}/work-item-types`,
    );

    expect(outOfReach.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(await outOfReach.text()).toBe(await unknown.text());
  });

  it("NUL byte in workspaceId is a 400, not a 500", async () => {
    const { user } = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${encodeURIComponent("a\u0000b")}/work-item-types`,
    );
    expect(response.status).toBe(400);
  });
});
