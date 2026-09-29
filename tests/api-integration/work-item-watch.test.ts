/**
 * `POST`/`DELETE /api/work-items/{key}/watch` (`docs/03-features/work-items.md`
 * `WI-28`/`WI-29`) -- #23's fourth slice.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { raceWorkItemArchive } from "./helpers/race-soft-delete";

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
  if (!stateTemplate) throw new Error("makeDefaultState: state_template");
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
  if (!state) throw new Error("makeDefaultState: state");
  return state;
}

async function setupProjectWithDefaultState() {
  const creator = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  const state = await makeDefaultState(creator.workspace.id, project.id);
  return { creator, project, type, state };
}

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

function watchRequest(app: ReturnType<typeof createApp>["app"], key: string) {
  return app.request(`/api/work-items/${key}/watch`, { method: "POST" });
}

function unwatchRequest(app: ReturnType<typeof createApp>["app"], key: string) {
  return app.request(`/api/work-items/${key}/watch`, { method: "DELETE" });
}

/** A `person` row backed by the given user, so watch/unwatch has somewhere to write. */
async function givePersonProfile(userId: string) {
  const organisation = await ensureInternalOrganisation();
  const now = new Date();
  const [person] = await db
    .insert(schema.personTable)
    .values({
      userId,
      organisationId: organisation.id,
      side: "staff",
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!person) throw new Error("givePersonProfile: insert returned no row");
  return person;
}

describe("API integration: work item watch/unwatch (#23 fourth slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("WI-28: POST watch creates an explicit watcher row, unmuted", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const person = await givePersonProfile(creator.user.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Watch me",
      })
    ).json()) as { key: string };

    const response = await watchRequest(app, created.key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { watching: boolean };
    expect(body.watching).toBe(true);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, created.key));
    const [watcher] = await db
      .select()
      .from(schema.watcherTable)
      .where(
        and(
          eq(schema.watcherTable.workItemId, row?.id ?? ""),
          eq(schema.watcherTable.personId, person.id),
        ),
      );
    expect(watcher?.source).toBe("explicit");
    expect(watcher?.muted).toBe(false);
  });

  it("idempotent: watching twice does not create a second row", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    await givePersonProfile(creator.user.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Twice",
      })
    ).json()) as { key: string };

    expect((await watchRequest(app, created.key)).status).toBe(200);
    expect((await watchRequest(app, created.key)).status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, created.key));
    const watchers = await db
      .select()
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.workItemId, row?.id ?? ""));
    expect(watchers).toHaveLength(1);
  });

  it("WI-29: DELETE watch on an EXPLICIT watcher deletes the row", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const person = await givePersonProfile(creator.user.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Unwatch me",
      })
    ).json()) as { key: string };
    await watchRequest(app, created.key);

    const response = await unwatchRequest(app, created.key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { watching: boolean };
    expect(body.watching).toBe(false);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, created.key));
    const watchers = await db
      .select()
      .from(schema.watcherTable)
      .where(
        and(
          eq(schema.watcherTable.workItemId, row?.id ?? ""),
          eq(schema.watcherTable.personId, person.id),
        ),
      );
    expect(watchers).toHaveLength(0);
  });

  it("WI-29: DELETE watch on an IMPLICIT watcher mutes it, never deletes the row", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const person = await givePersonProfile(creator.user.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Implicit",
      })
    ).json()) as { key: string };
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, created.key));

    // Seed an IMPLICIT watcher row directly (nothing wires implicit watching from
    // assignment/requester yet -- flagged in the PR body as a separate slice; this test
    // exercises the DELETE route's own opt-out behaviour against that row shape).
    await db.insert(schema.watcherTable).values({
      workItemId: row?.id ?? "",
      personId: person.id,
      source: "implicit",
      muted: false,
    });

    const response = await unwatchRequest(app, created.key);
    expect(response.status).toBe(200);

    const [watcher] = await db
      .select()
      .from(schema.watcherTable)
      .where(
        and(
          eq(schema.watcherTable.workItemId, row?.id ?? ""),
          eq(schema.watcherTable.personId, person.id),
        ),
      );
    expect(watcher).toBeDefined();
    expect(watcher?.source).toBe("implicit");
    expect(watcher?.muted).toBe(true);
  });

  it("POST watch un-mutes an existing implicit watcher without recreating it", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const person = await givePersonProfile(creator.user.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Re-mute",
      })
    ).json()) as { key: string };
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, created.key));

    await db.insert(schema.watcherTable).values({
      workItemId: row?.id ?? "",
      personId: person.id,
      source: "implicit",
      muted: true,
    });

    const response = await watchRequest(app, created.key);
    expect(response.status).toBe(200);

    const [watcher] = await db
      .select()
      .from(schema.watcherTable)
      .where(
        and(
          eq(schema.watcherTable.workItemId, row?.id ?? ""),
          eq(schema.watcherTable.personId, person.id),
        ),
      );
    expect(watcher?.source).toBe("implicit"); // untouched
    expect(watcher?.muted).toBe(false); // un-muted
  });

  it("idempotent: unwatching something never watched is a 200 no-op", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    await givePersonProfile(creator.user.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Never watched",
      })
    ).json()) as { key: string };

    const response = await unwatchRequest(app, created.key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { watching: boolean };
    expect(body.watching).toBe(false);
  });

  it("400s when the caller has no person profile", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    // Deliberately no `givePersonProfile` call.
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "No person",
      })
    ).json()) as { key: string };

    const response = await watchRequest(app, created.key);
    expect(response.status).toBe(400);
  });

  it("404s on a nonexistent key", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    await givePersonProfile(creator.user.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await watchRequest(app, `${project.slug}-999999`);
    expect(response.status).toBe(404);
  });

  it("issue #276: 404s on a soft-deleted work item -- watchWorkItem's own resolveCallerPersonAndItem already checked deletedAt directly (unaffected by this diff), but not archivedAt, and now the shared requireWorkItemReach guard 404s before either runs", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    await givePersonProfile(creator.user.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Watch target, then deleted",
      })
    ).json()) as { key: string };

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, created.key));

    const response = await watchRequest(app, created.key);
    expect(response.status).toBe(404);
  });

  it("#493: a concurrent ARCHIVE landing after the reach check cannot slip past this route's own transaction -- the gap this issue closes (only `deletedAt` was ever checked in-process before)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    await givePersonProfile(creator.user.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Watch target, then archived",
      })
    ).json()) as { key: string; id: string };

    const race = await raceWorkItemArchive(
      created.id,
      async () => await watchRequest(app, created.key),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    const response = race.operation.value;
    expect(response.status).toBe(404);

    const watchers = await db
      .select()
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.workItemId, created.id));
    expect(watchers).toHaveLength(0);
  });
});
