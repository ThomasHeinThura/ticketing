import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { raceProjectSoftDelete } from "./helpers/race-soft-delete";
import { RELATION_REACH_ROUTE_KEYS } from "./helpers/reach-route-keys";
import { makeApiKey } from "./helpers/reach-world";

async function fixture() {
  const actor = await createWorkspaceMember({ role: "member" });
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: actor.workspace.id,
        key: randomUUID(),
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: actor.workspace.id,
        key: randomUUID(),
        name: "Open",
        group: "unstarted",
      })
      .returning(),
    "state template",
  );
  async function project(grant = true) {
    const { project } = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    if (grant) await grantWorkItemProjectAccess(actor.user.id, project.id);
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: template.id,
          isDefault: true,
        })
        .returning(),
      "state",
    );
    let number = 0;
    return {
      project,
      async item(title = "Related work") {
        return requireRow(
          await db
            .insert(schema.workItemTable)
            .values({
              workspaceId: actor.workspace.id,
              projectId: project.id,
              typeId: type.id,
              stateId: state.id,
              title,
              number: ++number,
              key: `${project.slug}-${number}`,
            })
            .returning(),
          "item",
        );
      },
    };
  }
  const sourceProject = await project();
  const source = await sourceProject.item("Source item");
  mockAuthenticatedSession(actor.user);
  const { app } = createApp();
  return { actor, project, source, sourceProject, app };
}
function create(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  targetKey: string,
  type = "relates",
) {
  return app.request(`/api/work-items/${key}/relations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetKey, type }),
  });
}

beforeEach(resetTestDatabase);
describe("canonical persisted peer relations", () => {
  it("persists once from either end, labels inverses, and keeps concurrent duplicate requests idempotent", async () => {
    const f = await fixture();
    const peer = await f.sourceProject.item("Peer");
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        create(f.app, f.source.key, peer.key, "blocks"),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const ids = await Promise.all(
      results.map(async (r) => ((await r.json()) as { id: string }).id),
    );
    expect(new Set(ids).size).toBe(1);
    const list = (await (
      await f.app.request(`/api/work-items/${peer.key}/relations`)
    ).json()) as { data: { label: string; item: { key: string } }[] };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      label: "blocked_by",
      item: { key: f.source.key },
    });
    const activities = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.field, "relation"));
    expect(activities).toHaveLength(2);
  });
  it("makes relates symmetric but permits reverse directed blocks and warns on the cycle", async () => {
    const f = await fixture();
    const peer = await f.sourceProject.item();
    const one = (await (
      await create(f.app, f.source.key, peer.key)
    ).json()) as { id: string };
    const reverse = (await (
      await create(f.app, peer.key, f.source.key)
    ).json()) as { id: string };
    expect(reverse.id).toBe(one.id);
    expect((await create(f.app, f.source.key, peer.key, "blocks")).status).toBe(
      200,
    );
    expect((await create(f.app, peer.key, f.source.key, "blocks")).status).toBe(
      200,
    );
    const list = (await (
      await f.app.request(`/api/work-items/${f.source.key}/relations`)
    ).json()) as { data: { type: string; blockingCycle: boolean }[] };
    expect(
      list.data
        .filter((r) => r.type === "blocks")
        .every((r) => r.blockingCycle),
    ).toBe(true);
  });
  it("allows same-workspace cross-project peers, masks unreadable details in relations, activity and serialized events", async () => {
    const f = await fixture();
    const other = await f.project(false);
    const peer = await other.item("SECRET_PEER_TITLE");
    await db
      .insert(schema.workItemRelationTable)
      .values({ sourceId: f.source.id, targetId: peer.id, type: "requires" });
    const response = await f.app.request(
      `/api/work-items/${f.source.key}/relations`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [], hiddenCount: 1 });
    expect((await create(f.app, f.source.key, peer.key)).status).toBe(404);
    const role = await grantWorkItemProjectAccess(
      f.actor.user.id,
      other.project.id,
    );
    expect(
      (await create(f.app, f.source.key, peer.key, "precedes")).status,
    ).toBe(200);
    await db
      .update(schema.roleTable)
      .set({ capabilities: [] })
      .where(eq(schema.roleTable.id, role.id));
    const activity = await f.app.request(
      `/api/work-items/${f.source.key}/activity`,
    );
    expect(activity.status).toBe(200);
    const serialized = await activity.text();
    expect(serialized).not.toContain(peer.key);
    expect(serialized).not.toContain(peer.id);
    expect(serialized).not.toContain("SECRET_PEER_TITLE");
    const events = await db.select().from(schema.outboxTable);
    const eventText = JSON.stringify(
      events.filter((row) => JSON.stringify(row).includes(f.source.id)),
    );
    expect(eventText).not.toContain(peer.id);
    expect(eventText).not.toContain(peer.key);
    expect(eventText).not.toContain("SECRET_PEER_TITLE");
  });
  it("requires update on both ends and rejects self relations", async () => {
    const f = await fixture();
    const other = await f.project(false);
    const peer = await other.item();
    await grantProjectRole(f.actor.user.id, other.project.id, [
      "project:read",
      "work_item:read",
    ]);
    expect((await create(f.app, f.source.key, peer.key)).status).toBe(403);
    expect((await create(f.app, f.source.key, f.source.key)).status).toBe(422);
    expect(await db.select().from(schema.workItemRelationTable)).toHaveLength(
      0,
    );
  });
  it("keeps soft-deleted links stored and restores them without recreating the edge", async () => {
    const f = await fixture();
    const peer = await f.sourceProject.item();
    await create(f.app, f.source.key, peer.key);
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, peer.id));
    expect(
      await (
        await f.app.request(`/api/work-items/${f.source.key}/relations`)
      ).json(),
    ).toEqual({ data: [], hiddenCount: 0 });
    expect(await db.select().from(schema.workItemRelationTable)).toHaveLength(
      1,
    );
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: null })
      .where(eq(schema.workItemTable.id, peer.id));
    const restored = (await (
      await f.app.request(`/api/work-items/${f.source.key}/relations`)
    ).json()) as { data: unknown[] };
    expect(restored.data).toHaveLength(1);
  });
  it("database and API reject cross-workspace links", async () => {
    const f = await fixture();
    const g = await fixture();
    mockAuthenticatedSession(f.actor.user);
    expect((await create(f.app, f.source.key, g.source.key)).status).toBe(404);
    await expect(
      db.insert(schema.workItemRelationTable).values({
        sourceId: f.source.id,
        targetId: g.source.id,
        type: "relates",
      }),
    ).rejects.toThrow();
  });
  it("searches the real scoped candidate set, escapes wildcards, and paginates without exposing hidden or read-only peers", async () => {
    const f = await fixture();
    const a = await f.sourceProject.item("Literal 100%_match");
    await f.sourceProject.item("Literal 100XXmatch");
    await f.sourceProject.item("Last peer");
    const hidden = await f.project(false);
    const secret = await hidden.item("Hidden candidate");
    const readonly = await f.project(false);
    const denied = await readonly.item("Read only candidate");
    await grantProjectRole(f.actor.user.id, readonly.project.id, [
      "project:read",
      "work_item:read",
    ]);
    const wildcard = await f.app.request(
      `/api/work-items/${f.source.key}/relation-candidates?q=${encodeURIComponent("%_")}`,
    );
    expect(wildcard.status).toBe(200);
    const matching = (await wildcard.json()) as { data: { id: string }[] };
    expect(matching.data.map((r) => r.id)).toEqual([a.id]);
    const first = (await (
      await f.app.request(
        `/api/work-items/${f.source.key}/relation-candidates?limit=1`,
      )
    ).json()) as {
      data: { id: string }[];
      page: { hasMore: boolean; nextCursor: string };
    };
    expect(first.page.hasMore).toBe(true);
    const second = (await (
      await f.app.request(
        `/api/work-items/${f.source.key}/relation-candidates?limit=1&cursor=${first.page.nextCursor}`,
      )
    ).json()) as { data: { id: string }[] };
    expect(second.data[0]?.id).not.toBe(first.data[0]?.id);
    const all = (await (
      await f.app.request(`/api/work-items/${f.source.key}/relation-candidates`)
    ).json()) as { data: { id: string }[] };
    expect(all.data).toHaveLength(3);
    expect(JSON.stringify(all)).not.toContain(secret.key);
    expect(all.data.map((r) => r.id)).not.toContain(denied.id);
    expect(all.data.map((r) => r.id)).not.toContain(f.source.id);
  });
});

it("does not advertise removal to read-only keys or widen them for create", async () => {
  const f = await fixture();
  const peer = await f.sourceProject.item();
  await create(f.app, f.source.key, peer.key);
  const key = await makeApiKey(f.actor.user.id, { work_item: ["read"] });
  mockAnonymousSession();
  const response = await f.app.request(
    `/api/work-items/${f.source.key}/relations`,
    { headers: { "x-api-key": key } },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { canRemove: boolean }[] };
  expect(body.data[0]?.canRemove).toBe(false);
  const denied = await f.app.request(
    `/api/work-items/${f.source.key}/relations`,
    {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ targetKey: peer.key, type: "blocks" }),
    },
  );
  expect(denied.status).toBe(403);
});
it("rechecks a frozen target project after its lock is released before inserting", async () => {
  const f = await fixture();
  const peerProject = await f.project();
  const peer = await peerProject.item();
  const raced = await raceProjectSoftDelete(peerProject.project.id, async () =>
    create(f.app, f.source.key, peer.key),
  );
  expect(raced.blockedOnRowLock).toBe(true);
  if (raced.operation.status !== "fulfilled") throw raced.operation.reason;
  expect(raced.operation.value.status).toBe(404);
  expect(await db.select().from(schema.workItemRelationTable)).toHaveLength(0);
});
it("rejects stale query cursors and malformed candidate bounds", async () => {
  const f = await fixture();
  await f.sourceProject.item();
  await f.sourceProject.item();
  const first = (await (
    await f.app.request(
      `/api/work-items/${f.source.key}/relation-candidates?limit=1`,
    )
  ).json()) as { page: { nextCursor: string } };
  expect(
    (
      await f.app.request(
        `/api/work-items/${f.source.key}/relation-candidates?q=changed&cursor=${first.page.nextCursor}`,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.app.request(
        `/api/work-items/${f.source.key}/relation-candidates?limit=51`,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.app.request(
        `/api/work-items/${f.source.key}/relation-candidates?cursor=invalid`,
      )
    ).status,
  ).toBe(400);
});

const relationReachCases = [
  {
    routeKey: "GET /api/work-items/{key}/relations",
    method: "GET",
    suffix: "/relations",
    readable: true,
  },
  {
    routeKey: "GET /api/work-items/{key}/relation-candidates",
    method: "GET",
    suffix: "/relation-candidates",
    readable: false,
  },
  {
    routeKey: "POST /api/work-items/{key}/relations",
    method: "POST",
    suffix: "/relations",
    readable: false,
  },
  {
    routeKey: "DELETE /api/work-items/{key}/relations/{id}",
    method: "DELETE",
    suffix: "/relations/missing-relation",
    readable: false,
  },
] as const;
function requestRelationCase(
  f: Awaited<ReturnType<typeof fixture>>,
  row: (typeof relationReachCases)[number],
  key: string,
) {
  return f.app.request(`/api/work-items/${key}${row.suffix}`, {
    method: row.method,
    ...(row.method === "POST"
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetKey: f.source.key, type: "relates" }),
        }
      : {}),
  });
}
describe("canonical relation route subject reach table", () => {
  it("classifies exactly the routes whose real denial behavior is exercised", () => {
    expect(relationReachCases.map((row) => row.routeKey).sort()).toEqual(
      [...RELATION_REACH_ROUTE_KEYS].sort(),
    );
  });
  for (const row of relationReachCases) {
    it(`${row.routeKey}: unreachable and missing source are indistinguishable404`, async () => {
      const f = await fixture();
      const hiddenProject = await f.project(false);
      const hidden = await hiddenProject.item("HIDDEN_SOURCE_SENTINEL");
      const unreachable = await requestRelationCase(f, row, hidden.key);
      const missing = await requestRelationCase(f, row, "NO-SUCH-SOURCE-1");
      expect(unreachable.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await unreachable.text()).toBe(await missing.text());
      expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    });
    it(`${row.routeKey}: reachable read-only project follows declared capability without writing`, async () => {
      const f = await fixture();
      const membership = requireRow(
        await db
          .select({ roleId: schema.membershipTable.roleId })
          .from(schema.membershipTable)
          .innerJoin(
            schema.personTable,
            eq(schema.personTable.id, schema.membershipTable.personId),
          )
          .where(
            and(
              eq(schema.personTable.userId, f.actor.user.id),
              eq(schema.membershipTable.scope, "project"),
              eq(schema.membershipTable.scopeId, f.source.projectId),
            ),
          ),
        "source membership",
      );
      await db
        .update(schema.roleTable)
        .set({ capabilities: ["project:read", "work_item:read"] })
        .where(eq(schema.roleTable.id, membership.roleId));
      expect((await requestRelationCase(f, row, f.source.key)).status).toBe(
        row.readable ? 200 : 403,
      );
      expect(await db.select().from(schema.workItemRelationTable)).toHaveLength(
        0,
      );
      expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    });
  }
});
