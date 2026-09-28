/**
 * Issue #26's third API slice: `POST /api/work-items/{key}/parent`, `DELETE
 * /api/work-items/{key}/parent`, `GET /api/work-items/{key}/tree`
 * (`docs/03-features/relations-and-hierarchy.md` `RH-5`..`RH-8`). Relation create/get/
 * delete (`RH-1`..`RH-4`) are a separate, already-merged slice, not covered here.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import detachWorkItemParent from "../../apps/api/src/work-item/controllers/detach-work-item-parent";
import {
  ancestorChain,
  MAX_TREE_NODES,
} from "../../apps/api/src/work-item/hierarchy";
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

/**
 * Polls `queryFn` (a `pg_locks` count query on a side connection) until it returns a
 * count >= 1, or throws after `timeoutMs`. Used by the RH-7 concurrency test below to
 * prove a specific request is genuinely BLOCKED in Postgres at a specific point --
 * rather than assuming ordering from `Promise.all` timing, which does not actually
 * force the interleaving (this is exactly D1 of the Opus delta security review of PR
 * #432: the original version of this test passed even against the pre-fix code because
 * `Promise.all` alone does not guarantee the two requests overlap where it matters).
 */
async function waitForLockCount(
  sideClient: Client,
  query: string,
  timeoutMs = 5000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await sideClient.query<{ count: string }>(query);
    const count = Number(result.rows[0]?.count ?? "0");
    if (count >= 1) return;
    if (Date.now() > deadline) {
      throw new Error(`waitForLockCount: timed out waiting on: ${query}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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
    const treeBody = (await treeResponse.json()) as {
      truncated: boolean;
      root: {
        key: string;
        isCurrent: boolean;
        children: Array<{ key: string; isCurrent: boolean }>;
      };
    };
    expect(treeBody.truncated).toBe(false);
    expect(treeBody.root.key).toBe(parent.key);
    expect(treeBody.root.isCurrent).toBe(false);
    expect(treeBody.root.children).toHaveLength(1);
    expect(treeBody.root.children[0]?.key).toBe(child.key);
    expect(treeBody.root.children[0]?.isCurrent).toBe(true);
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
    const treeBody = (await response.json()) as {
      truncated: boolean;
      root: {
        key: string;
        isCurrent: boolean;
        children: Array<{
          key: string;
          isCurrent: boolean;
          children: Array<{ key: string; isCurrent: boolean }>;
        }>;
      };
    };

    expect(treeBody.truncated).toBe(false);
    expect(treeBody.root.key).toBe(root.key);
    expect(treeBody.root.isCurrent).toBe(false);
    expect(treeBody.root.children).toHaveLength(1);
    const midNode = treeBody.root.children[0];
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

  it("#481: rejects setting a parent to a soft-deleted work item at 404, and does not mutate parent_id", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const item = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Item",
      })
    ).json()) as CreatedWorkItem;
    const deletedParent = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Soon deleted",
      })
    ).json()) as CreatedWorkItem;

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, deletedParent.key));

    const response = await setParentRequest(app, item.key, deletedParent.key);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Parent work item not found");

    const [row] = await db
      .select({ parentId: schema.workItemTable.parentId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, item.key));
    expect(row?.parentId).toBeNull();
  });

  it("#481: rejects setting a parent to an archived work item at 404, and does not mutate parent_id", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const item = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Item",
      })
    ).json()) as CreatedWorkItem;
    const archivedParent = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Soon archived",
      })
    ).json()) as CreatedWorkItem;

    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.key, archivedParent.key));

    const response = await setParentRequest(app, item.key, archivedParent.key);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Parent work item not found");

    const [row] = await db
      .select({ parentId: schema.workItemTable.parentId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, item.key));
    expect(row?.parentId).toBeNull();
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

  it("GET tree: caps total response size and reports truncated:true for a wide subtree past MAX_TREE_NODES (spec edge case: '200 children on one parent -- the list paginates')", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const [state] = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, project.id));
    if (!state) throw new Error("fixture setup failed: no default state");

    const parent = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Wide parent",
      })
    ).json()) as CreatedWorkItem;
    const [parentRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, parent.key));
    if (!parentRow) throw new Error("fixture setup failed: parent row missing");

    // Inserted directly (not through the create-route + set-parent-route round trip,
    // which would make this test far slower for no extra coverage) -- one more child than
    // the cap, so the cap is the thing that trips, not a coincidental exact match.
    const now = new Date();
    const childCount = MAX_TREE_NODES; // + the parent itself (already counted) == cap + 1 available
    const values = Array.from({ length: childCount }, (_, i) => ({
      projectId: project.id,
      workspaceId: project.workspaceId,
      typeId: type.id,
      number: i + 1000,
      key: `${project.slug}-wide-${i}`,
      title: `Wide child ${i}`,
      stateId: state.id,
      parentId: parentRow.id,
      position: String(i),
      createdAt: now,
      updatedAt: now,
    }));
    await db.insert(schema.workItemTable).values(values);

    const response = await treeRequest(app, parent.key);
    expect(response.status).toBe(200);
    const treeBody = (await response.json()) as {
      truncated: boolean;
      root: { key: string; children: unknown[] };
    };

    expect(treeBody.truncated).toBe(true);
    // The root itself counts against the cap, so only `MAX_TREE_NODES - 1` of the
    // `MAX_TREE_NODES` children fit.
    expect(treeBody.root.children).toHaveLength(MAX_TREE_NODES - 1);
  });

  it("RH-7 concurrency (Opus security review of PR #432, F1, reproduced live): two concurrent reparents that would EACH individually pass the depth check, but jointly exceed it, resolve to exactly one success and one 422 -- never both succeeding", async () => {
    // Opus's own reproduction shape: T1 moves X under P (individually valid at read
    // time); concurrently, T2 moves Y under Z, where Z is ABOUT TO BECOME (via T1's own,
    // not-yet-committed move) a descendant of P through X. Built here as:
    //
    //   Existing chain: R(1) <- A(2) <- P(3)          -- P's own depth is 3.
    //   Existing chain: X(1) <- Z(2)                  -- Z is already X's child.
    //   Standalone: Y (no parent, no children).
    //
    //   T1: set X's parent to P  -- if it runs alone: X's new depth is 4, no
    //       descendants of its own except Z (depth 1 below X) -- resulting deepest
    //       node (Z) lands at depth 5, exactly the cap. Individually valid.
    //   T2: set Y's parent to Z  -- if it runs alone (before T1 commits): Z's own
    //       chain is only [Z, X] (depth 2), so Y's new depth is 3. Individually valid.
    //
    // If BOTH commit as each individually validated them, the REAL final chain is
    // R <- A <- P <- X <- Z <- Y -- Y at depth 6, past RH-7's cap. Before this PR's F1
    // fix, `set-work-item-parent.ts`'s ancestor/depth reads were unlocked, so both
    // concurrent requests could each read their OWN pre-commit-safe snapshot and both
    // succeed, producing exactly that corruption. The per-project advisory lock
    // (`hierarchy-lock.ts`) now serializes the two: whichever commits first is correctly
    // reflected in the SECOND transaction's own re-read (taken only after it acquires the
    // lock the first one just released), and that second transaction's own depth check
    // then correctly rejects -- in EITHER commit order (verified above: T1-then-T2 makes
    // Z's real depth 5, so Y under Z would be depth 6, rejected; T2-then-T1 makes X's own
    // subtree 2 deep via Z->Y, so X under P would land Y at depth 6 the same way,
    // rejected). So exactly one of the two must succeed and the other must be refused,
    // in every possible interleaving -- never both.
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const r = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "R",
      })
    ).json()) as CreatedWorkItem;
    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as CreatedWorkItem;
    const p = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "P",
      })
    ).json()) as CreatedWorkItem;
    const x = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "X",
      })
    ).json()) as CreatedWorkItem;
    const z = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Z",
      })
    ).json()) as CreatedWorkItem;
    const y = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Y",
      })
    ).json()) as CreatedWorkItem;

    expect((await setParentRequest(app, a.key, r.key)).status).toBe(200);
    expect((await setParentRequest(app, p.key, a.key)).status).toBe(200);
    expect((await setParentRequest(app, z.key, x.key)).status).toBe(200);

    // Opus delta security review of PR #432 (D1): a bare `Promise.all` does NOT force
    // the two requests to actually overlap where it matters -- opening the second
    // connection is enough delay that both ran sequentially by accident, so the
    // previous version of this test passed 4/4 runs even against the PRE-FIX code.
    // Forced here with a side `pg` connection that holds an `ACCESS EXCLUSIVE` lock on
    // `activity` (the table `set-work-item-parent.ts`'s transaction writes to, AFTER
    // taking the advisory lock, for its activity-log insert) -- parking the first
    // request's transaction at a known point, provably past its own advisory-lock
    // acquisition, before the second request is even fired.
    const connectionString = process.env.TASKDESK_DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "TASKDESK_DATABASE_URL must be defined for integration tests",
      );
    }
    const sideClient = new Client({ connectionString });
    await sideClient.connect();

    try {
      await sideClient.query("BEGIN");
      await sideClient.query("LOCK TABLE activity IN ACCESS EXCLUSIVE MODE");

      // Fire T1 (X -> P) but do not await yet. It will acquire the advisory lock
      // (namespace 4012, keyed on this project) immediately, then block trying to
      // write its activity row -- behind the side connection's table lock above.
      const t1Promise = setParentRequest(app, x.key, p.key);

      await waitForLockCount(
        sideClient,
        `SELECT count(*)::text AS count FROM pg_locks
         WHERE locktype = 'relation' AND relation = 'activity'::regclass
           AND granted = false`,
      );

      // T1 is now provably blocked mid-transaction, past its own advisory-lock
      // acquisition. Only now fire T2 (Y -> Z) -- it must queue behind T1's still-held
      // advisory lock, not merely happen to run after it.
      const t2Promise = setParentRequest(app, y.key, z.key);

      await waitForLockCount(
        sideClient,
        `SELECT count(*)::text AS count FROM pg_locks
         WHERE locktype = 'advisory' AND classid = 4012 AND granted = false`,
      );

      // Release the table lock -- T1's transaction can now finish its activity insert
      // and commit, releasing the advisory lock so T2 can proceed with a fresh re-read.
      await sideClient.query("COMMIT");

      const [t1, t2] = await Promise.all([t1Promise, t2Promise]);

      const statuses = [t1.status, t2.status].sort();
      expect(statuses).toEqual([200, 422]);
    } finally {
      await sideClient.end();
    }

    // Whichever one won, the FINAL persisted hierarchy never exceeds RH-7's depth-5 cap
    // anywhere -- the actual invariant this fix protects, checked directly rather than
    // inferred from the status codes alone.
    const allItems = [r, a, p, x, z, y];
    for (const item of allItems) {
      const [row] = await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.key, item.key));
      if (!row) throw new Error(`missing row for ${item.key}`);
      const chain = await ancestorChain(db, row.id);
      expect(chain.length).toBeLessThanOrEqual(5);
    }
  });

  it("#488: detachWorkItemParent itself refuses a soft-deleted SUBJECT item directly, not only requireWorkItemReach (same probe shape as #486's own test for set-work-item-parent.ts)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const parent = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Parent",
      })
    ).json()) as CreatedWorkItem;
    const deletedItem = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Soon deleted (subject)",
      })
    ).json()) as CreatedWorkItem;

    await setParentRequest(app, deletedItem.key, parent.key);

    const [rowBeforeDelete] = await db
      .select({ parentId: schema.workItemTable.parentId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, deletedItem.key));
    expect(rowBeforeDelete?.parentId).not.toBeNull();

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, deletedItem.key));

    let deletedError: unknown;
    try {
      await detachWorkItemParent(
        deletedItem.key,
        creator.workspace.id,
        creator.user.id,
        "person",
      );
    } catch (error) {
      deletedError = error;
    }
    expect(deletedError).toBeInstanceOf(HTTPException);
    expect((deletedError as HTTPException).status).toBe(404);

    const [deletedRow] = await db
      .select({ parentId: schema.workItemTable.parentId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, deletedItem.key));
    expect(deletedRow?.parentId).toBe(rowBeforeDelete?.parentId);
  });

  it("#488: detachWorkItemParent itself refuses an archived SUBJECT item directly, not only requireWorkItemReach", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const parent = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Parent",
      })
    ).json()) as CreatedWorkItem;
    const archivedItem = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Soon archived (subject)",
      })
    ).json()) as CreatedWorkItem;

    await setParentRequest(app, archivedItem.key, parent.key);

    const [rowBeforeArchive] = await db
      .select({ parentId: schema.workItemTable.parentId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, archivedItem.key));
    expect(rowBeforeArchive?.parentId).not.toBeNull();

    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.key, archivedItem.key));

    let archivedError: unknown;
    try {
      await detachWorkItemParent(
        archivedItem.key,
        creator.workspace.id,
        creator.user.id,
        "person",
      );
    } catch (error) {
      archivedError = error;
    }
    expect(archivedError).toBeInstanceOf(HTTPException);
    expect((archivedError as HTTPException).status).toBe(404);

    const [archivedRow] = await db
      .select({ parentId: schema.workItemTable.parentId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, archivedItem.key));
    expect(archivedRow?.parentId).toBe(rowBeforeArchive?.parentId);
  });
});
