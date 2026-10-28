/**
 * P1 wave 2: `POST /api/v2/work-items/{key}/move` (RH-12) and
 * `POST /api/v2/work-items/{key}/archive` (WI-20), driven through the real middleware chain.
 * Needs the integration database (run by the coordinator).
 */
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  WORK_ITEM_PROJECT_CAPABILITIES,
} from "./helpers/fixtures";
import {
  addMember,
  createItem,
  json,
  setupWorld,
  type World,
} from "./helpers/reach-world";

type App = ReturnType<typeof createApp>["app"];

async function makeTargetProject(
  world: World,
  options: { reachableBy?: string[]; withStarted?: boolean } = {},
) {
  const { project } = await createProjectFixture({
    workspaceId: world.workspaceId,
  });
  const now = new Date();
  await db.insert(schema.stateTable).values([
    {
      projectId: project.id,
      stateTemplateId: world.transition.fromStateTemplateId as string,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    ...(options.withStarted === false
      ? []
      : [
          {
            projectId: project.id,
            stateTemplateId: world.started.stateTemplate.id,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          },
        ]),
  ]);
  for (const userId of options.reachableBy ?? [world.projectMember.user.id])
    await grantProjectRole(userId, project.id, [
      ...WORK_ITEM_PROJECT_CAPABILITIES,
    ]);
  return project;
}

async function row(key: string) {
  const [found] = await db
    .select()
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.key, key));
  if (!found) throw new Error(`no work item ${key}`);
  return found;
}

function move(
  app: App,
  key: string,
  body: { targetProjectId: string; moveChildren: boolean },
  version = 1,
) {
  return json(app, "POST", `/api/v2/work-items/${key}/move`, body, {
    "if-match": `"${version}"`,
  });
}

describe("API integration: move work item across projects (RH-12)", () => {
  let world: World;
  let app: App;

  beforeEach(async () => {
    await resetTestDatabase();
    world = await setupWorld();
    app = createApp().app;
  });

  it("re-keys the item, remaps its state, records the alias, bumps the version and audits", async () => {
    const item = await createItem(app, world, "Mover");
    const target = await makeTargetProject(world);
    const before = await row(item.key);
    mockAuthenticatedSession(world.projectMember.user);

    const response = await move(app, item.key, {
      targetProjectId: target.id,
      moveChildren: false,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      item: { key: string; projectId: string; version: number };
      moved: Array<{ fromKey: string; toKey: string }>;
    };
    expect(body.item.projectId).toBe(target.id);
    expect(body.item.key).toBe(`${target.slug}-1`);
    expect(body.item.version).toBe(before.version + 1);
    expect(body.moved).toEqual([
      { id: item.id, fromKey: item.key, toKey: `${target.slug}-1` },
    ]);

    const moved = await row(`${target.slug}-1`);
    const [targetDefault] = await db
      .select()
      .from(schema.stateTable)
      .where(
        and(
          eq(schema.stateTable.projectId, target.id),
          eq(schema.stateTable.isDefault, true),
        ),
      );
    expect(moved.stateId).toBe(targetDefault?.id);
    expect(moved.number).toBe(1);
    const aliases = await db
      .select()
      .from(schema.workItemKeyAliasTable)
      .where(eq(schema.workItemKeyAliasTable.workItemId, item.id));
    expect(aliases.map((alias) => alias.oldKey)).toEqual([item.key]);
    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, item.id),
          eq(schema.activityTable.field, "project"),
        ),
      );
    expect(activity).toHaveLength(1);
    expect(activity[0]?.visibility).toBe("internal");
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, item.id));
    expect(audit.some((entry) => entry.action === "work_item.updated")).toBe(
      true,
    );
  });

  it("an old key redirects reads to the new key only for a caller who can reach the moved item", async () => {
    const item = await createItem(app, world, "Old link");
    const target = await makeTargetProject(world);
    mockAuthenticatedSession(world.projectMember.user);
    await move(app, item.key, {
      targetProjectId: target.id,
      moveChildren: false,
    });

    const redirect = await app.request(`/api/work-items/${item.key}`, {
      redirect: "manual",
    });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe(
      `/api/work-items/${target.slug}-1`,
    );

    mockAuthenticatedSession(world.outsiderLead.user);
    const hidden = await app.request(`/api/work-items/${item.key}`, {
      redirect: "manual",
    });
    expect(hidden.status).toBe(404);
    // Writes never follow an alias.
    mockAuthenticatedSession(world.projectMember.user);
    const write = await json(
      app,
      "PATCH",
      `/api/work-items/${item.key}`,
      { title: "x" },
      { "if-match": '"2"' },
    );
    expect(write.status).toBe(404);
  });

  it("moves the whole subtree when asked, keeping the tree intact in the target", async () => {
    const parent = await createItem(app, world, "Parent");
    const child = await createItem(app, world, "Child");
    const grandchild = await createItem(app, world, "Grandchild");
    await db
      .update(schema.workItemTable)
      .set({ parentId: parent.id })
      .where(eq(schema.workItemTable.id, child.id));
    await db
      .update(schema.workItemTable)
      .set({ parentId: child.id })
      .where(eq(schema.workItemTable.id, grandchild.id));
    const target = await makeTargetProject(world);
    mockAuthenticatedSession(world.projectMember.user);

    const response = await move(app, parent.key, {
      targetProjectId: target.id,
      moveChildren: true,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(
        inArray(schema.workItemTable.id, [parent.id, child.id, grandchild.id]),
      );
    expect(new Set(rows.map((r) => r.projectId))).toEqual(new Set([target.id]));
    expect(rows.find((r) => r.id === child.id)?.parentId).toBe(parent.id);
    expect(rows.find((r) => r.id === grandchild.id)?.parentId).toBe(child.id);
    expect(new Set(rows.map((r) => r.number)).size).toBe(3);
  });

  it("detaches direct children when asked not to move them, and always drops the item's own parent", async () => {
    const top = await createItem(app, world, "Top");
    const middle = await createItem(app, world, "Middle");
    const leaf = await createItem(app, world, "Leaf");
    await db
      .update(schema.workItemTable)
      .set({ parentId: top.id })
      .where(eq(schema.workItemTable.id, middle.id));
    await db
      .update(schema.workItemTable)
      .set({ parentId: middle.id })
      .where(eq(schema.workItemTable.id, leaf.id));
    const target = await makeTargetProject(world);
    mockAuthenticatedSession(world.projectMember.user);

    const middleVersion = (await row(middle.key)).version;
    const response = await move(
      app,
      middle.key,
      { targetProjectId: target.id, moveChildren: false },
      middleVersion,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { detachedChildKeys: string[] };
    expect(body.detachedChildKeys).toEqual([leaf.key]);
    const [movedMiddle] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, middle.id));
    const [stayedLeaf] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, leaf.id));
    expect(movedMiddle?.parentId).toBeNull();
    expect(movedMiddle?.projectId).toBe(target.id);
    expect(stayedLeaf?.parentId).toBeNull();
    expect(stayedLeaf?.projectId).toBe(world.project.id);
  });

  it("discards pending workflow timers instead of failing on their composite foreign keys", async () => {
    const item = await createItem(app, world, "Timed");
    const target = await makeTargetProject(world);
    const [source] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    await db.insert(schema.scheduledTransitionTable).values({
      workspaceId: world.workspaceId,
      projectId: world.project.id,
      workItemId: item.id,
      transitionId: world.transition.id,
      fromStateId: source?.stateId as string,
      toStateId: source?.stateId as string,
      dueAt: new Date(Date.now() + 3_600_000),
    } as never);
    mockAuthenticatedSession(world.projectMember.user);
    const response = await move(app, item.key, {
      targetProjectId: target.id,
      moveChildren: false,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await db
        .select()
        .from(schema.scheduledTransitionTable)
        .where(eq(schema.scheduledTransitionTable.workItemId, item.id)),
    ).toEqual([]);
  });

  it("refuses without writing: same project, stale version, missing state template, unreachable or foreign target", async () => {
    const item = await createItem(app, world, "Guarded");
    mockAuthenticatedSession(world.projectMember.user);

    const same = await move(app, item.key, {
      targetProjectId: world.project.id,
      moveChildren: false,
    });
    expect(same.status).toBe(422);

    const target = await makeTargetProject(world);
    const stale = await move(
      app,
      item.key,
      { targetProjectId: target.id, moveChildren: false },
      99,
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      assertedVersion: 99,
      currentVersion: 1,
    });

    const noState = await makeTargetProject(world, { withStarted: true });
    await db
      .update(schema.stateTable)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(schema.stateTable.projectId, noState.id),
          eq(schema.stateTable.isDefault, false),
        ),
      );
    const defaultState = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, noState.id));
    expect(defaultState.length).toBe(2);
    // The item sits in the default (backlog) template, which the target still has: mapped fine.
    // Move it to started first so the archived target state is unmappable.
    await db
      .update(schema.workItemTable)
      .set({ stateId: world.started.state.id })
      .where(eq(schema.workItemTable.id, item.id));
    const unmappable = await move(
      app,
      item.key,
      { targetProjectId: noState.id, moveChildren: false },
      (await row(item.key)).version,
    );
    expect(unmappable.status).toBe(422);

    const other = await createWorkspaceMember({ role: "admin" });
    const { project: foreign } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const foreignResponse = await move(app, item.key, {
      targetProjectId: foreign.id,
      moveChildren: false,
    });
    expect(foreignResponse.status).toBe(404);

    const unreachable = await makeTargetProject(world, { reachableBy: [] });
    const hidden = await move(app, item.key, {
      targetProjectId: unreachable.id,
      moveChildren: false,
    });
    expect(hidden.status).toBe(404);
    expect(await row(item.key)).toMatchObject({
      projectId: world.project.id,
      version: expect.any(Number),
    });
  });

  it("requires create and update on the target: reach without capability is 403", async () => {
    const item = await createItem(app, world, "Capability");
    const readerOnTarget = await addMember(world.workspaceId, "lead");
    await grantProjectRole(readerOnTarget.user.id, world.project.id, [
      ...WORK_ITEM_PROJECT_CAPABILITIES,
    ]);
    const target = await makeTargetProject(world, { reachableBy: [] });
    await grantProjectRole(readerOnTarget.user.id, target.id, [
      "project:read",
      "work_item:read",
    ]);
    mockAuthenticatedSession(readerOnTarget.user);
    const response = await move(app, item.key, {
      targetProjectId: target.id,
      moveChildren: false,
    });
    expect(response.status).toBe(403);
    expect((await row(item.key)).projectId).toBe(world.project.id);
  });
});

describe("API integration: archive work item (WI-20)", () => {
  let world: World;
  let app: App;

  beforeEach(async () => {
    await resetTestDatabase();
    world = await setupWorld();
    app = createApp().app;
  });

  it("archives with the version check, hides it from the default list and refuses a second archive", async () => {
    const item = await createItem(app, world, "Archive me");
    mockAuthenticatedSession(world.projectMember.user);

    const stale = await json(
      app,
      "POST",
      `/api/v2/work-items/${item.key}/archive`,
      undefined,
      { "if-match": '"7"' },
    );
    expect(stale.status).toBe(409);

    const archived = await json(
      app,
      "POST",
      `/api/v2/work-items/${item.key}/archive`,
      undefined,
      { "if-match": '"1"' },
    );
    expect(archived.status, await archived.clone().text()).toBe(200);
    const stored = await row(item.key);
    expect(stored.archivedAt).not.toBeNull();
    expect(stored.deletedAt).toBeNull();
    expect(stored.version).toBe(2);

    const list = await app.request(
      `/api/projects/${world.project.id}/work-items`,
    );
    const listed = (await list.json()) as { items?: Array<{ key: string }> };
    expect((listed.items ?? []).map((entry) => entry.key)).not.toContain(
      item.key,
    );

    const again = await json(
      app,
      "POST",
      `/api/v2/work-items/${item.key}/archive`,
      undefined,
      { "if-match": '"2"' },
    );
    expect(again.status).toBe(404);
  });
});
