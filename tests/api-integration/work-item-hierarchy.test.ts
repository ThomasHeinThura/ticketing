/**
 * Issue #26's third API slice: `POST /api/work-items/{key}/parent`, `DELETE
 * /api/work-items/{key}/parent`, `GET /api/work-items/{key}/tree`
 * (`docs/03-features/relations-and-hierarchy.md` `RH-5`..`RH-8`). Relation create/get/
 * delete (`RH-1`..`RH-4`) are a separate, already-merged slice, not covered here.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [stateTemplate] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!stateTemplate) {
    throw new Error("makeDefaultState: state_template insert returned no row");
  }

  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: state insert returned no row");
  return state;
}

async function addWorkspaceMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: "Integration Test User",
    })
    .returning();
  if (!user) throw new Error("addWorkspaceMember: user insert returned no row");

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  // Issue #318 (security): a role name needs a genuine, `is_system` seeded
  // `workspace_role` row to actually carry its `BUILT_IN_ROLES` capabilities -- same
  // helper shape as `work-item-update.test.ts`'s own `addWorkspaceMember`.
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role,
    permission: JSON.stringify({}),
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return user;
}

async function setupProjectWithDefaultState() {
  const creator = await createWorkspaceMember({ role: "member" });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  await makeDefaultState(creator.workspace.id, project.id);
  return { creator, project, type };
}

type CreatedWorkItem = { key: string; version: number };

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setParentRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  parentKey: string,
) {
  return app.request(`/api/work-items/${key}/parent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentKey }),
  });
}

function detachParentRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
) {
  return app.request(`/api/work-items/${key}/parent`, { method: "DELETE" });
}

function treeRequest(app: ReturnType<typeof createApp>["app"], key: string) {
  return app.request(`/api/work-items/${key}/tree`);
}

describe("API integration: work item hierarchy (#26 third slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("RH-5: sets a parent, bumps version, and the tree shows the highlighted item under its parent", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const parent = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Epic parent",
      })
    ).json()) as CreatedWorkItem;
    const child = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Child task",
      })
    ).json()) as CreatedWorkItem;

    const response = await setParentRequest(app, child.key, parent.key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      parentId: string | null;
      version: number;
    };
    expect(body.version).toBe(2);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, child.key));
    expect(row?.version).toBe(2);

    const treeResponse = await treeRequest(app, child.key);
    expect(treeResponse.status).toBe(200);
    const tree = (await treeResponse.json()) as {
      key: string;
      isCurrent: boolean;
      children: Array<{ key: string; isCurrent: boolean }>;
    };
    expect(tree.key).toBe(parent.key);
    expect(tree.isCurrent).toBe(false);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.key).toBe(child.key);
    expect(tree.children[0]?.isCurrent).toBe(true);
  });

  it("RH-11/RH-12: detaches a parent, and detaching an already-parentless item is idempotent", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const parent = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Parent",
      })
    ).json()) as CreatedWorkItem;
    const child = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Child",
      })
    ).json()) as CreatedWorkItem;

    await setParentRequest(app, child.key, parent.key);

    const detach = await detachParentRequest(app, child.key);
    expect(detach.status).toBe(200);
    const detachBody = (await detach.json()) as {
      parentId: string | null;
      version: number;
    };
    expect(detachBody.parentId).toBeNull();
    expect(detachBody.version).toBe(3);

    // Idempotent: detaching again is a no-op, no error, no version bump.
    const detachAgain = await detachParentRequest(app, child.key);
    expect(detachAgain.status).toBe(200);
    const detachAgainBody = (await detachAgain.json()) as {
      parentId: string | null;
      version: number;
    };
    expect(detachAgainBody.parentId).toBeNull();
    expect(detachAgainBody.version).toBe(3);
  });

  it("RH-8: rejects a direct self-parent at 422", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const item = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Solo",
      })
    ).json()) as CreatedWorkItem;

    const response = await setParentRequest(app, item.key, item.key);
    expect(response.status).toBe(422);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, item.key));
    expect(row?.parentId).toBeNull();
    expect(row?.version).toBe(1);
  });

  it("RH-8: rejects setting a parent to one of its own descendants (a genuine cycle) at 422", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as CreatedWorkItem;
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as CreatedWorkItem;
    const c = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "C",
      })
    ).json()) as CreatedWorkItem;

    // A <- B <- C (C's parent is B, B's parent is A).
    expect((await setParentRequest(app, b.key, a.key)).status).toBe(200);
    expect((await setParentRequest(app, c.key, b.key)).status).toBe(200);

    // Attempting to set A's parent to C (its own descendant) is a cycle.
    const response = await setParentRequest(app, a.key, c.key);
    expect(response.status).toBe(422);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, a.key));
    expect(row?.parentId).toBeNull();
  });

  it("RH-7: rejects a reparent that would exceed the maximum hierarchy depth of 5", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    // A chain of 5 items, root to leaf: n0 <- n1 <- n2 <- n3 <- n4 (n4's own depth is 5).
    const items: CreatedWorkItem[] = [];
    for (let i = 0; i < 5; i++) {
      const created = (await (
        await createWorkItemRequest(app, project.id, {
          typeId: type.id,
          title: `Level ${i}`,
        })
      ).json()) as CreatedWorkItem;
      items.push(created);
    }
    for (let i = 1; i < items.length; i++) {
      const child = items[i];
      const parent = items[i - 1];
      if (!child || !parent) throw new Error("fixture setup failed");
      const response = await setParentRequest(app, child.key, parent.key);
      expect(response.status).toBe(200);
    }

    // A 6th item would land at depth 6 under the existing depth-5 leaf -- rejected.
    const extra = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Too deep",
      })
    ).json()) as CreatedWorkItem;
    const leaf = items[4];
    if (!leaf) throw new Error("fixture setup failed");

    const response = await setParentRequest(app, extra.key, leaf.key);
    expect(response.status).toBe(422);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, extra.key));
    expect(row?.parentId).toBeNull();
  });

  it("GET tree: builds the correct nested structure for a multi-level hierarchy", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const root = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Root",
      })
    ).json()) as CreatedWorkItem;
    const mid = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Mid",
      })
    ).json()) as CreatedWorkItem;
    const leafA = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Leaf A",
      })
    ).json()) as CreatedWorkItem;
    const leafB = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Leaf B",
      })
    ).json()) as CreatedWorkItem;

    expect((await setParentRequest(app, mid.key, root.key)).status).toBe(200);
    expect((await setParentRequest(app, leafA.key, mid.key)).status).toBe(200);
    expect((await setParentRequest(app, leafB.key, mid.key)).status).toBe(200);

    // Requested from a leaf: the tree still resolves to the true root and shows the
    // whole subtree, not merely the leaf's own direct ancestry.
    const response = await treeRequest(app, leafA.key);
    expect(response.status).toBe(200);
    const tree = (await response.json()) as {
      key: string;
      isCurrent: boolean;
      children: Array<{
        key: string;
        isCurrent: boolean;
        children: Array<{ key: string; isCurrent: boolean }>;
      }>;
    };

    expect(tree.key).toBe(root.key);
    expect(tree.isCurrent).toBe(false);
    expect(tree.children).toHaveLength(1);
    const midNode = tree.children[0];
    expect(midNode?.key).toBe(mid.key);
    expect(midNode?.isCurrent).toBe(false);
    expect(midNode?.children).toHaveLength(2);
    const leafKeys = midNode?.children.map((n) => n.key).sort();
    expect(leafKeys).toEqual([leafA.key, leafB.key].sort());
    const currentNode = midNode?.children.find((n) => n.key === leafA.key);
    expect(currentNode?.isCurrent).toBe(true);
    const otherNode = midNode?.children.find((n) => n.key === leafB.key);
    expect(otherNode?.isCurrent).toBe(false);
  });

  it("RH-6: rejects a parent from a different project at 400", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const { project: otherProject } = await createProjectFixture({
      workspaceId: creator.workspace.id,
    });
    await makeDefaultState(creator.workspace.id, otherProject.id);

    const item = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Item",
      })
    ).json()) as CreatedWorkItem;
    const otherProjectItem = (await (
      await createWorkItemRequest(app, otherProject.id, {
        typeId: type.id,
        title: "Different project",
      })
    ).json()) as CreatedWorkItem;

    const response = await setParentRequest(
      app,
      item.key,
      otherProjectItem.key,
    );
    expect(response.status).toBe(400);
  });

  it("cross-workspace: setting a parent to a key from another workspace 404s (never a cross-tenant leak)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const item = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Mine",
      })
    ).json()) as CreatedWorkItem;

    const stranger = await createWorkspaceMember({ role: "member" });
    const { project: strangerProject } = await createProjectFixture({
      workspaceId: stranger.workspace.id,
    });
    const strangerType = await makeWorkItemType(stranger.workspace.id);
    await makeDefaultState(stranger.workspace.id, strangerProject.id);
    mockAuthenticatedSession(stranger.user);
    const strangerItem = (await (
      await createWorkItemRequest(app, strangerProject.id, {
        typeId: strangerType.id,
        title: "Not yours",
      })
    ).json()) as CreatedWorkItem;

    // Back to the original caller.
    mockAuthenticatedSession(creator.user);
    const response = await setParentRequest(app, item.key, strangerItem.key);
    expect(response.status).toBe(404);
  });

  it("cross-workspace: GET tree 404s for a key belonging to a workspace the caller isn't a member of", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const item = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Mine",
      })
    ).json()) as CreatedWorkItem;

    const stranger = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(stranger.user);

    const response = await treeRequest(app, item.key);
    expect(response.status).toBe(404);
  });

  it("permissions: a viewer may read the tree but not set a parent (403, no write)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const parent = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Parent",
      })
    ).json()) as CreatedWorkItem;
    const child = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Child",
      })
    ).json()) as CreatedWorkItem;

    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const readTree = await treeRequest(app, child.key);
    expect(readTree.status).toBe(200);

    const setParent = await setParentRequest(app, child.key, parent.key);
    expect(setParent.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, child.key));
    expect(row?.parentId).toBeNull();
  });
});
