/**
 * `POST /api/work-items/{key}/rank` (`docs/03-features/work-items.md` `WI-11`-`WI-13`)
 * -- #23's fourth slice. See `rank-work-item.ts`'s own doc comment for the body-shape
 * judgment call (`beforeId`/`afterId`) and the `WI-13` (customer-organisation scoping)
 * deferral.
 */
import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  rebalancePositionPartition,
  recoverDensePositionPartitions,
} from "../../apps/api/src/scheduler/position-rebalance";
import * as realtime from "../../apps/api/src/ws";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessForWorkspaceRole,
  grantWorkItemProjectAccess,
  prepareAuthenticatedApiFixture,
  requireRow,
} from "./helpers/fixtures";
import {
  raceProjectSoftDelete,
  waitForLockBlocker,
} from "./helpers/race-soft-delete";
import { ensureCreationWorkflow } from "./helpers/workflow";

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

async function makeDefaultState(
  workspaceId: string,
  projectId: string,
  isDefault = true,
) {
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
      isDefault,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: state");
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
  if (!user) throw new Error("addWorkspaceMember: user");
  await prepareAuthenticatedApiFixture(user.id);

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  if (role !== "owner") {
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role,
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  await grantProjectAccessForWorkspaceRole(user.id, workspaceId, role);
  return user;
}

async function setupProjectWithDefaultState(
  role: "member" | "admin" | "viewer" = "admin",
) {
  const creator = await createWorkspaceMember({ role });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  await grantWorkItemProjectAccess(creator.user.id, project.id);
  const type = await makeWorkItemType(creator.workspace.id);
  const state = await makeDefaultState(creator.workspace.id, project.id);
  await ensureCreationWorkflow({
    workspaceId: creator.workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
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

function rankWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/work-items/${key}/rank`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API integration: work item rank (#23 fourth slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("WI-11: ranking between two neighbours lands strictly in between and bumps version", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { id: string; key: string; version: number };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { id: string; key: string };
    const c = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "C",
      })
    ).json()) as { id: string; key: string };

    // `create-work-item.ts` does not assign an increasing `position` (every item
    // defaults to `0`) -- pre-existing, out of this slice's own scope. Seeding distinct
    // positions directly is what makes "strictly between two neighbours" a real,
    // observable midpoint rather than three ties at `0`.
    await db
      .update(schema.workItemTable)
      .set({ position: "1" })
      .where(eq(schema.workItemTable.id, a.id));
    await db
      .update(schema.workItemTable)
      .set({ position: "3" })
      .where(eq(schema.workItemTable.id, c.id));

    const response = await rankWorkItemRequest(app, b.key, {
      beforeId: a.id,
      afterId: c.id,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      key: string;
      position: string;
      version: number;
    };
    expect(body.version).toBe(2);

    const rows = await db
      .select({
        key: schema.workItemTable.key,
        position: schema.workItemTable.position,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    const byKey = new Map(rows.map((r) => [r.key, Number(r.position)]));
    expect(byKey.get(b.key)).toBeGreaterThan(byKey.get(a.key) ?? Number.NaN);
    expect(byKey.get(b.key)).toBeLessThan(byKey.get(c.key) ?? Number.NaN);
  });

  it("ranking with only beforeId places it after that neighbour", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { id: string; key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { id: string; key: string };

    const response = await rankWorkItemRequest(app, b.key, { beforeId: a.id });
    expect(response.status).toBe(200);

    const rows = await db
      .select({
        key: schema.workItemTable.key,
        position: schema.workItemTable.position,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    const byKey = new Map(rows.map((r) => [r.key, Number(r.position)]));
    expect(byKey.get(b.key)).toBeGreaterThan(byKey.get(a.key) ?? Number.NaN);
  });

  it("VW-5: a successful rank publishes the staff-only work_item.updated hint; a refused rank publishes none", async () => {
    const hint = vi
      .spyOn(realtime, "broadcastNativeWorkItemHint")
      .mockResolvedValue(undefined);
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { id: string; key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { key: string };
    hint.mockClear();

    expect((await rankWorkItemRequest(app, b.key, {})).status).toBe(400);
    expect(hint).not.toHaveBeenCalled();

    expect(
      (await rankWorkItemRequest(app, b.key, { beforeId: a.id })).status,
    ).toBe(200);
    expect(hint).toHaveBeenCalledTimes(1);
    expect(hint.mock.calls[0]?.[0]).toMatchObject({
      projectId: project.id,
      topics: [`project:${project.id}`, `work_item:${b.key}`],
      eventType: "work_item.updated",
      key: b.key,
      customerVisible: false,
    });
  });

  it("an empty body (neither beforeId nor afterId) is a 400", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Solo",
      })
    ).json()) as { key: string };

    const response = await rankWorkItemRequest(app, created.key, {});
    expect(response.status).toBe(400);
  });

  it("a neighbour id from a different project is refused 400", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const item = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Mine",
      })
    ).json()) as { id: string; key: string };

    const { project: otherProject } = await createProjectFixture({
      workspaceId: creator.workspace.id,
    });
    await grantWorkItemProjectAccess(creator.user.id, otherProject.id);
    const otherType = await makeWorkItemType(creator.workspace.id);
    await makeDefaultState(creator.workspace.id, otherProject.id);
    await ensureCreationWorkflow({
      workspaceId: creator.workspace.id,
      projectId: otherProject.id,
      typeId: otherType.id,
    });
    const foreign = (await (
      await createWorkItemRequest(app, otherProject.id, {
        typeId: otherType.id,
        title: "Foreign",
      })
    ).json()) as { id: string; key: string };

    const response = await rankWorkItemRequest(app, item.key, {
      beforeId: foreign.id,
    });
    expect(response.status).toBe(400);
  });

  it("re-ranking an already-ranked item again (idempotent-ish repeat) succeeds and keeps bumping version", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { id: string; key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { id: string; key: string };

    const first = await rankWorkItemRequest(app, b.key, { afterId: a.id });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { version: number };
    expect(firstBody.version).toBe(2);

    const second = await rankWorkItemRequest(app, b.key, { afterId: a.id });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { version: number };
    expect(secondBody.version).toBe(3);
  });

  it("404s on a nonexistent key", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await rankWorkItemRequest(app, `${project.slug}-999999`, {
      afterId: `${project.slug}-1`,
    });
    expect(response.status).toBe(404);
  });

  it("permissions: a caller without work_item:rank is refused 403", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { id: string; key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { id: string; key: string };

    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const response = await rankWorkItemRequest(app, b.key, { afterId: a.id });
    expect(response.status).toBe(403);
  });

  it("#499: project deletion waits for ranking and a deletion that wins makes rank return 404", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const first = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "First",
      })
    ).json()) as { id: string; key: string };
    const target = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Target",
      })
    ).json()) as { id: string; key: string };
    const [before] = await db
      .select({
        position: schema.workItemTable.position,
        version: schema.workItemTable.version,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, target.id));

    const race = await raceProjectSoftDelete(
      project.id,
      async () =>
        await rankWorkItemRequest(app, target.key, { afterId: first.id }),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const [after] = await db
      .select({
        position: schema.workItemTable.position,
        version: schema.workItemTable.version,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, target.id));
    expect(after).toEqual(before);
  });
  async function denseFixture(positions = ["1", "1.0000001", "5"]) {
    const fixture = await setupProjectWithDefaultState();
    mockAuthenticatedSession(fixture.creator.user);
    const { app } = createApp();
    const items = [];
    for (const [index, position] of positions.entries()) {
      const response = await createWorkItemRequest(app, fixture.project.id, {
        typeId: fixture.type.id,
        title: `Rank ${index}`,
      });
      expect(response.status).toBe(200);
      const item = (await response.json()) as {
        id: string;
        key: string;
        version: number;
      };
      await db
        .update(schema.workItemTable)
        .set({ position })
        .where(eq(schema.workItemTable.id, item.id));
      items.push(item);
    }
    return {
      ...fixture,
      app,
      items,
      partition: {
        workspaceId: fixture.creator.workspace.id,
        projectId: fixture.project.id,
        stateId: fixture.state.id,
      },
    };
  }

  it("WI-12: a rank leaving an exact numeric small gap repairs the state and returns its current version", async () => {
    const { app, items, project } = await denseFixture(["1", "1.0000015", "5"]);
    const response = await rankWorkItemRequest(
      app,
      requireRow([items[2]], "rank fixture row").key,
      {
        beforeId: requireRow([items[0]], "rank fixture row").id,
        afterId: requireRow([items[1]], "rank fixture row").id,
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      position: string;
      version: number;
    };
    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id))
      .orderBy(asc(schema.workItemTable.position));
    expect(rows.map((row) => row.id)).toEqual([
      requireRow([items[0]], "rank fixture row").id,
      requireRow([items[2]], "rank fixture row").id,
      requireRow([items[1]], "rank fixture row").id,
    ]);
    expect(rows.map((row) => row.position)).toEqual([
      "1.0000000000",
      "2.0000000000",
      "3.0000000000",
    ]);
    expect(body).toMatchObject({
      position: requireRow([rows[1]], "rank fixture row").position,
      version: requireRow([rows[1]], "rank fixture row").version,
    });
    expect(body.version).toBe(3);
    expect(requireRow([rows[0]], "rank fixture row").version).toBe(1);
  });

  it("does not rebalance a gap exactly equal to the threshold", async () => {
    const { partition } = await denseFixture(["1", "1.000001"]);
    expect(await rebalancePositionPartition(partition)).toEqual({
      status: "healthy",
      changed: 0,
    });
  });

  it("keeps exact large numeric midpoint precision", async () => {
    const { app, items } = await denseFixture([
      "1234567890.1234567890",
      "1234567890.1234767890",
      "5",
    ]);
    const response = await rankWorkItemRequest(
      app,
      requireRow([items[2]], "rank fixture row").key,
      {
        beforeId: requireRow([items[0]], "rank fixture row").id,
        afterId: requireRow([items[1]], "rank fixture row").id,
      },
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { position: string }).position).toBe(
      "1234567890.1234667890",
    );
  });

  it("recovers persisted dense partitions after another replica's lease is released", async () => {
    const { partition } = await denseFixture();
    await db.execute(
      sql`INSERT INTO job_lease (name, owner, expires_at) VALUES ('position-rebalance', 'another-holder', clock_timestamp() AT TIME ZONE 'UTC' + interval '5 minutes')`,
    );
    expect(await rebalancePositionPartition(partition)).toEqual({
      status: "leased",
      changed: 0,
    });
    await db.execute(
      sql`DELETE FROM job_lease WHERE name = 'position-rebalance'`,
    );
    const recovered = await recoverDensePositionPartitions();
    expect(recovered).toHaveLength(1);
    expect(requireRow([recovered[0]], "rank fixture row").outcome.status).toBe(
      "rebalanced",
    );
    expect(await recoverDensePositionPartitions()).toEqual([]);
  });

  it("preserves deterministic tie order, other states, archived and deleted rows", async () => {
    const { partition, project, creator, items } = await denseFixture([
      "0",
      "0",
      "0",
      "0",
      "0",
    ]);
    const state = await makeDefaultState(
      creator.workspace.id,
      project.id,
      false,
    );
    await db
      .update(schema.workItemTable)
      .set({ stateId: state.id })
      .where(
        eq(
          schema.workItemTable.id,
          requireRow([items[2]], "rank fixture row").id,
        ),
      );
    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(
        eq(
          schema.workItemTable.id,
          requireRow([items[3]], "rank fixture row").id,
        ),
      );
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(
        eq(
          schema.workItemTable.id,
          requireRow([items[4]], "rank fixture row").id,
        ),
      );
    const outcome = await rebalancePositionPartition(partition);
    expect(outcome).toEqual({ status: "rebalanced", changed: 2 });
    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    const active = rows
      .filter((row) => items.slice(0, 2).some((item) => item.id === row.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(active.map((row) => row.position)).toEqual([
      "1.0000000000",
      "2.0000000000",
    ]);
    for (const item of items.slice(2))
      expect(rows.find((row) => row.id === item.id)).toMatchObject({
        position: "0.0000000000",
        version: 1,
      });
  });

  it("rolls back busy partition locks while a genuine hierarchy mutation waits, then recovers", async () => {
    const { app, items, partition } = await denseFixture();
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await client.connect();
    let mutation: Response | Promise<Response> | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM work_item WHERE id=$1 FOR UPDATE", [
        requireRow([items[0]], "rank fixture row").id,
      ]);
      const pid = requireRow(
        (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows,
        "lock owner pid",
      ).pid;
      mutation = app.request(
        `/api/v2/work-items/${requireRow([items[1]], "rank fixture row").key}/parent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "if-match": '"1"' },
          body: JSON.stringify({
            parentKey: requireRow([items[0]], "rank fixture row").key,
          }),
        },
      );
      expect(await waitForLockBlocker(client, pid)).toBe(true);
      expect(await rebalancePositionPartition(partition)).toEqual({
        status: "busy",
        changed: 0,
      });
      await client.query("COMMIT");
      expect((await mutation).status).toBe(200);
      expect(
        requireRow(await recoverDensePositionPartitions(), "recovery partition")
          .outcome.status,
      ).toBe("rebalanced");
    } finally {
      await client.query("ROLLBACK");
      if (mutation) await mutation;
      await client.end();
    }
  });
  it("refuses an exhausted midpoint without moving the target when another replica holds the worker lease", async () => {
    const { app, items } = await denseFixture(["1", "1.0000000001", "5"]);
    await db.execute(
      sql`INSERT INTO job_lease (name, owner, expires_at) VALUES ('position-rebalance', 'another-holder', clock_timestamp() AT TIME ZONE 'UTC' + interval '5 minutes')`,
    );
    const response = await rankWorkItemRequest(
      app,
      requireRow([items[2]], "rank fixture row").key,
      {
        beforeId: requireRow([items[0]], "rank fixture row").id,
        afterId: requireRow([items[1]], "rank fixture row").id,
      },
    );
    expect(response.status).toBe(409);
    const [target] = await db
      .select()
      .from(schema.workItemTable)
      .where(
        eq(
          schema.workItemTable.id,
          requireRow([items[2]], "rank fixture row").id,
        ),
      );
    expect(target).toMatchObject({ position: "5.0000000000", version: 1 });
    await db.execute(
      sql`DELETE FROM job_lease WHERE name = 'position-rebalance'`,
    );
    expect(
      requireRow(await recoverDensePositionPartitions(), "recovery partition")
        .outcome.status,
    ).toBe("rebalanced");
    expect(
      (
        await rankWorkItemRequest(
          app,
          requireRow([items[2]], "rank fixture row").key,
          {
            beforeId: requireRow([items[0]], "rank fixture row").id,
            afterId: requireRow([items[1]], "rank fixture row").id,
          },
        )
      ).status,
    ).toBe(200);
  });
  it("does not wait on a live rank partition holder and preserves a concurrent rank after release", async () => {
    const { app, items, partition } = await denseFixture(["1", "3", "5"]);
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await client.connect();
    let ranking: Response | Promise<Response> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [
          JSON.stringify([
            "work-item-position",
            partition.workspaceId,
            partition.projectId,
            partition.stateId,
          ]),
        ],
      );
      const pid = requireRow(
        (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows,
        "lock owner pid",
      ).pid;
      ranking = rankWorkItemRequest(
        app,
        requireRow([items[2]], "rank fixture row").key,
        {
          beforeId: requireRow([items[0]], "rank fixture row").id,
          afterId: requireRow([items[1]], "rank fixture row").id,
        },
      );
      expect(await waitForLockBlocker(client, pid)).toBe(true);
      expect(await rebalancePositionPartition(partition)).toEqual({
        status: "busy",
        changed: 0,
      });
      await client.query("COMMIT");
      const response = await ranking;
      expect(response.status).toBe(200);
      expect(((await response.json()) as { position: string }).position).toBe(
        "2.0000000000",
      );
    } finally {
      await client.query("ROLLBACK");
      if (ranking) await ranking;
      await client.end();
    }
  });

  it("never repairs a frozen project or discovers it as live recovery work", async () => {
    const { partition, project, items } = await denseFixture();
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    expect(await rebalancePositionPartition(partition)).toEqual({
      status: "unavailable",
      changed: 0,
    });
    expect(await recoverDensePositionPartitions()).toEqual([]);
    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(
      rows.find(
        (row) => row.id === requireRow([items[1]], "rank fixture row").id,
      ),
    ).toMatchObject({
      position: "1.0000001000",
      version: 1,
    });
  });
  it("does not deadlock a genuine transition holding the parent while waiting for its child", async () => {
    const { app, items, partition, creator, project, type, state } =
      await denseFixture();
    const destination = await makeDefaultState(
      creator.workspace.id,
      project.id,
      false,
    );
    await db
      .update(schema.stateTemplateTable)
      .set({ group: "completed" })
      .where(eq(schema.stateTemplateTable.id, destination.stateTemplateId));
    const [workflow] = await db
      .insert(schema.workflowTable)
      .values({
        workspaceId: creator.workspace.id,
        key: `rank-workflow-${randomUUID()}`,
        name: "Ranking concurrency",
      })
      .returning();
    if (!workflow) throw new Error("Workflow fixture missing");
    const [version] = await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning();
    if (!version) throw new Error("Workflow version fixture missing");
    await db
      .update(schema.workflowTable)
      .set({ activeVersionId: version.id })
      .where(eq(schema.workflowTable.id, workflow.id));
    await db.insert(schema.workflowTransitionTable).values({
      versionId: version.id,
      fromStateTemplateId: state.stateTemplateId,
      toStateTemplateId: destination.stateTemplateId,
      guards: [{ type: "children_closed" }],
      effects: [],
    });
    await db
      .update(schema.workItemTypeTable)
      .set({ workflowId: workflow.id })
      .where(eq(schema.workItemTypeTable.id, type.id));
    await db
      .update(schema.workItemTable)
      .set({ parentId: requireRow([items[0]], "rank fixture row").id })
      .where(
        eq(
          schema.workItemTable.id,
          requireRow([items[1]], "rank fixture row").id,
        ),
      );
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await client.connect();
    let transition: Response | Promise<Response> | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM work_item WHERE id=$1 FOR UPDATE", [
        requireRow([items[1]], "rank fixture row").id,
      ]);
      const pid = requireRow(
        (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows,
        "lock owner pid",
      ).pid;
      transition = app.request(
        `/api/work-items/${requireRow([items[0]], "rank fixture row").key}/transition`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toStateTemplateId: destination.stateTemplateId,
          }),
        },
      );
      expect(await waitForLockBlocker(client, pid)).toBe(true);
      expect(await rebalancePositionPartition(partition)).toEqual({
        status: "busy",
        changed: 0,
      });
      await client.query("COMMIT");
      const response = await transition;
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        blockedBy: [{ kind: "guard", reasonCode: "guard.children_closed" }],
      });
      expect(
        requireRow(await recoverDensePositionPartitions(), "recovery partition")
          .outcome.status,
      ).toBe("rebalanced");
    } finally {
      await client.query("ROLLBACK");
      if (transition) await transition;
      await client.end();
    }
  });
  it("never renumbers another workspace/project's equally dense partition", async () => {
    const source = await denseFixture(["0", "0"]);
    const other = await denseFixture(["0", "0"]);
    expect((await rebalancePositionPartition(source.partition)).status).toBe(
      "rebalanced",
    );
    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, other.project.id));
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row) => row.position === "0.0000000000" && row.version === 1),
    ).toBe(true);
  });
  it("returns a retry conflict rather than overflowing numeric rank capacity", async () => {
    const { app, items } = await denseFixture(["9999999999.9999999999", "5"]);
    expect(
      (
        await rankWorkItemRequest(
          app,
          requireRow([items[1]], "rank fixture row").key,
          { beforeId: requireRow([items[0]], "rank fixture row").id },
        )
      ).status,
    ).toBe(409);
    const [target] = await db
      .select()
      .from(schema.workItemTable)
      .where(
        eq(
          schema.workItemTable.id,
          requireRow([items[1]], "rank fixture row").id,
        ),
      );
    expect(target).toMatchObject({ position: "5.0000000000", version: 1 });
  });
  it("bounds startup discovery and refuses oversized partitions without partial writes", async () => {
    const { partition, project } = await denseFixture(["0", "0", "0"]);
    expect(
      await recoverDensePositionPartitions(10, {
        scanRows: 1,
        maxPartitionRows: 1,
      }),
    ).toEqual([]);
    const bounded = await recoverDensePositionPartitions(10, {
      scanRows: 10,
      maxPartitionRows: 1,
    });
    expect(requireRow(bounded, "bounded recovery").outcome).toEqual({
      status: "bounded",
      changed: 0,
    });
    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(
      rows.every((row) => row.position === "0.0000000000" && row.version === 1),
    ).toBe(true);
    expect((await rebalancePositionPartition(partition)).status).toBe(
      "rebalanced",
    );
  });
});
