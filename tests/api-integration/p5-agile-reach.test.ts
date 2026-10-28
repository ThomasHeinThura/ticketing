/**
 * Project reach and capability on every cycles / modules / estimates / WIP / dependency route
 * (the behavioural table the project and work-item reach guards require). Per route:
 *  - a same-workspace member with no membership of the project, and another tenant's owner, get
 *    404, byte-identical to a request for a row that does not exist, and write nothing;
 *  - a reader (project:read, work_item:read) is refused 403 on every write and served on reads;
 *  - the manager succeeds;
 *  - API keys: a key owned by an outsider gets the same 404, a read-scoped key owned by the
 *    manager is refused on writes (scope intersection) and served on reads, an unauthenticated
 *    caller gets 401.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  cycleTable,
  moduleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { type AgileWorld, agileWorld, JSON_HEADERS } from "./helpers/p5-agile";
import { ensureAgentSession } from "./helpers/pending-deletion";
import {
  PROJECT_AGILE_ITEM_ROUTE_KEYS,
  PROJECT_AGILE_ROUTE_KEYS,
} from "./helpers/project-reach-route-keys";
import { makeApiKey } from "./helpers/reach-world";

type Ids = {
  projectKey: string;
  cycleId: string;
  moduleId: string;
  stateId: string;
  itemKey: string;
  pointId: string;
};
type Kind = "read" | "manage" | "items";
type Case = {
  key: string;
  kind: Kind;
  success: number;
  method: string;
  path: (i: Ids) => string;
  body?: (i: Ids) => unknown;
};

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const CASES: Case[] = [
  {
    key: "GET /api/projects/{key}/cycles",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectKey}/cycles`,
  },
  {
    key: "POST /api/projects/{key}/cycles",
    kind: "manage",
    success: 201,
    method: "POST",
    path: (i) => `/api/projects/${i.projectKey}/cycles`,
    body: () => ({ name: "New", startDate: day(60), endDate: day(70) }),
  },
  {
    key: "GET /api/cycles/{id}",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/cycles/${i.cycleId}`,
  },
  {
    key: "PATCH /api/cycles/{id}",
    kind: "manage",
    success: 200,
    method: "PATCH",
    path: (i) => `/api/cycles/${i.cycleId}`,
    body: () => ({ name: "Renamed", version: 1 }),
  },
  {
    key: "DELETE /api/cycles/{id}",
    kind: "manage",
    success: 202,
    method: "DELETE",
    path: (i) => `/api/cycles/${i.cycleId}`,
  },
  {
    key: "POST /api/cycles/{id}/complete",
    kind: "manage",
    success: 200,
    method: "POST",
    path: (i) => `/api/cycles/${i.cycleId}/complete`,
    body: () => ({ incompletePolicy: "backlog" }),
  },
  {
    key: "POST /api/cycles/{id}/work-items",
    kind: "items",
    success: 200,
    method: "POST",
    path: (i) => `/api/cycles/${i.cycleId}/work-items`,
    body: (i) => ({ workItemKeys: [i.itemKey] }),
  },
  {
    key: "DELETE /api/cycles/{id}/work-items/{workItemKey}",
    kind: "items",
    success: 200,
    method: "DELETE",
    path: (i) => `/api/cycles/${i.cycleId}/work-items/${i.itemKey}`,
  },
  {
    key: "GET /api/cycles/{id}/burndown",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/cycles/${i.cycleId}/burndown`,
  },
  {
    key: "GET /api/projects/{key}/modules",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectKey}/modules`,
  },
  {
    key: "POST /api/projects/{key}/modules",
    kind: "manage",
    success: 201,
    method: "POST",
    path: (i) => `/api/projects/${i.projectKey}/modules`,
    body: () => ({ name: "New module" }),
  },
  {
    key: "GET /api/modules/{id}",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/modules/${i.moduleId}`,
  },
  {
    key: "PATCH /api/modules/{id}",
    kind: "manage",
    success: 200,
    method: "PATCH",
    path: (i) => `/api/modules/${i.moduleId}`,
    body: () => ({ name: "Renamed", version: 1 }),
  },
  {
    key: "DELETE /api/modules/{id}",
    kind: "manage",
    success: 202,
    method: "DELETE",
    path: (i) => `/api/modules/${i.moduleId}`,
  },
  {
    key: "POST /api/modules/{id}/work-items",
    kind: "items",
    success: 200,
    method: "POST",
    path: (i) => `/api/modules/${i.moduleId}/work-items`,
    body: (i) => ({ workItemKeys: [i.itemKey] }),
  },
  {
    key: "DELETE /api/modules/{id}/work-items/{workItemKey}",
    kind: "items",
    success: 200,
    method: "DELETE",
    path: (i) => `/api/modules/${i.moduleId}/work-items/${i.itemKey}`,
  },
  {
    key: "GET /api/projects/{key}/estimates",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectKey}/estimates`,
  },
  {
    key: "PATCH /api/projects/{key}/estimates",
    kind: "manage",
    success: 200,
    method: "PATCH",
    path: (i) => `/api/projects/${i.projectKey}/estimates`,
    body: () => ({ system: "points", dryRun: true }),
  },
  {
    key: "GET /api/projects/{key}/agile-settings",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectKey}/agile-settings`,
  },
  {
    key: "PATCH /api/projects/{key}/agile-settings",
    kind: "manage",
    success: 200,
    method: "PATCH",
    path: (i) => `/api/projects/${i.projectKey}/agile-settings`,
    body: () => ({ incompletePolicy: "leave" }),
  },
  {
    key: "GET /api/projects/{key}/wip-limits",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectKey}/wip-limits`,
  },
  {
    key: "PUT /api/projects/{key}/wip-limits/{stateId}",
    kind: "manage",
    success: 200,
    method: "PUT",
    path: (i) => `/api/projects/${i.projectKey}/wip-limits/${i.stateId}`,
    body: () => ({ limit: 4 }),
  },
  {
    key: "GET /api/projects/{key}/dependencies",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectKey}/dependencies`,
  },
  // item-scoped
  {
    key: "GET /api/work-items/{key}/estimate",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/work-items/${i.itemKey}/estimate`,
  },
  {
    key: "PUT /api/work-items/{key}/estimate",
    kind: "items",
    success: 200,
    method: "PUT",
    path: (i) => `/api/work-items/${i.itemKey}/estimate`,
    body: (i) => ({ estimatePointId: i.pointId }),
  },
  {
    key: "PUT /api/work-items/{key}/cycle",
    kind: "items",
    success: 200,
    method: "PUT",
    path: (i) => `/api/work-items/${i.itemKey}/cycle`,
    body: (i) => ({ cycleId: i.cycleId }),
  },
  {
    key: "PUT /api/work-items/{key}/module",
    kind: "items",
    success: 200,
    method: "PUT",
    path: (i) => `/api/work-items/${i.itemKey}/module`,
    body: (i) => ({ moduleId: i.moduleId }),
  },
];

let w: AgileWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await agileWorld();
  // Deletions open a pending action, which needs the requester's agent session row.
  await ensureAgentSession(w.manager.user.id);
});

async function seed(): Promise<Ids> {
  const [cycle] = await db
    .insert(cycleTable)
    .values({
      workspaceId: w.workspaceId,
      projectId: w.project.id,
      name: `Cycle ${Math.random()}`,
      startDate: day(-3),
      endDate: day(4),
    })
    .returning();
  const [mod] = await db
    .insert(moduleTable)
    .values({
      workspaceId: w.workspaceId,
      projectId: w.project.id,
      name: `Module ${Math.random()}`,
    })
    .returning();
  const state = (
    await db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, w.project.id))
      .limit(1)
  )[0];
  const item = await w.items.makeItem("Item");
  // The item starts inside the cycle and the module so the removal routes have something to remove.
  await db
    .update(schema.workItemTable)
    .set({ cycleId: cycle?.id, moduleId: mod?.id })
    .where(eq(schema.workItemTable.id, item.id));
  const config = await w.json<{
    estimate: { points: Array<{ id: string }> };
  }>(
    await w.call(w.manager.user, `/api/projects/${w.project.slug}/estimates`, {
      method: "PATCH",
      body: { system: "points", confirmClear: true },
    }),
  );
  return {
    projectKey: w.project.slug,
    cycleId: cycle?.id as string,
    moduleId: mod?.id as string,
    stateId: state?.id as string,
    itemKey: item.key,
    pointId: config.estimate.points[0]?.id as string,
  };
}

function missing(): Ids {
  const m = () => `missing-${Math.random().toString(36).slice(2)}`;
  return {
    projectKey: m(),
    cycleId: m(),
    moduleId: m(),
    stateId: m(),
    itemKey: m(),
    pointId: m(),
  };
}

function request(c: Case, ids: Ids, headers: Record<string, string> = {}) {
  const body = c.body?.(ids);
  return w.app.request(c.path(ids), {
    method: c.method,
    headers: { ...JSON_HEADERS, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function snapshot() {
  return JSON.stringify([
    await db.select().from(cycleTable).orderBy(cycleTable.id),
    await db.select().from(moduleTable).orderBy(moduleTable.id),
    await db
      .select({
        id: schema.workItemTable.id,
        cycleId: schema.workItemTable.cycleId,
        moduleId: schema.workItemTable.moduleId,
        estimatePointId: schema.workItemTable.estimatePointId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.workspaceId, w.workspaceId))
      .orderBy(schema.workItemTable.id),
    await db.select().from(schema.pendingActionTable),
  ]);
}

describe("the table matches the route lists exactly", () => {
  it("covers every project-scoped and item-scoped agile route key", () => {
    const projectKeys = CASES.filter(
      (c) => !c.key.includes("/work-items/{key}/"),
    ).map((c) => c.key);
    const itemKeys = CASES.filter((c) =>
      c.key.includes("/work-items/{key}/"),
    ).map((c) => c.key);
    expect([...projectKeys].sort()).toEqual(
      [...PROJECT_AGILE_ROUTE_KEYS].sort(),
    );
    expect([...itemKeys].sort()).toEqual(
      [...PROJECT_AGILE_ITEM_ROUTE_KEYS].sort(),
    );
  });
});

describe.each(CASES)("$key", (c) => {
  it("answers an outsider and another tenant with the 404 of a missing row, and writes nothing", async () => {
    const ids = await seed();
    const before = await snapshot();
    const absent = await (async () => {
      mockAuthenticatedSession(w.manager.user);
      const response = await request(c, missing());
      return { status: response.status, text: await response.text() };
    })();
    expect(absent.status).toBe(404);
    for (const user of [w.outsider.user, w.foreign.user]) {
      mockAuthenticatedSession(user);
      const response = await request(c, ids);
      expect(response.status, await response.clone().text()).toBe(404);
      // Item-scoped keys answer a missing item with the same body; row-addressed and key-addressed
      // routes answer with a body naming only the resource kind, never anything about the row.
      if (!c.key.includes("/work-items/{key}/"))
        expect(await response.text()).toBe(absent.text);
    }
    expect(await snapshot()).toBe(before);
  });

  it("refuses an unauthenticated caller", async () => {
    const ids = await seed();
    mockAnonymousSession();
    expect((await request(c, ids)).status).toBe(401);
  });

  it(
    c.kind === "read"
      ? "serves a reader"
      : "refuses a reader who reaches the project but lacks the capability",
    async () => {
      const ids = await seed();
      const before = await snapshot();
      mockAuthenticatedSession(w.reader.user);
      const response = await request(c, ids);
      if (c.kind === "read") {
        expect(response.status, await response.clone().text()).toBe(c.success);
      } else {
        expect(response.status, await response.clone().text()).toBe(403);
        expect(await snapshot()).toBe(before);
      }
    },
  );

  it("lets the manager through", async () => {
    const ids = await seed();
    mockAuthenticatedSession(w.manager.user);
    const response = await request(c, ids);
    expect(response.status, await response.clone().text()).toBe(c.success);
  });

  it("applies the same reach to API keys, and keeps scope intersection", async () => {
    const ids = await seed();
    const before = await snapshot();
    mockAnonymousSession();
    const wide = {
      project: ["read", "manage_settings"],
      work_item: ["read", "update"],
      workspace: ["read"],
    };
    const readOnly = {
      project: ["read"],
      work_item: ["read"],
      workspace: ["read"],
    };
    const outsiderKey = await makeApiKey(w.outsider.user.id, wide);
    const outsiderResponse = await request(c, ids, {
      "x-api-key": outsiderKey,
    });
    expect(outsiderResponse.status, await outsiderResponse.clone().text()).toBe(
      404,
    );
    expect(await snapshot()).toBe(before);
    const readKey = await makeApiKey(w.manager.user.id, readOnly);
    const readResponse = await request(c, ids, { "x-api-key": readKey });
    if (c.kind === "read")
      expect(readResponse.status, await readResponse.clone().text()).toBe(
        c.success,
      );
    else {
      expect(readResponse.status, await readResponse.clone().text()).toBe(403);
      expect(await snapshot()).toBe(before);
    }
    const wideKey = await makeApiKey(w.manager.user.id, wide);
    const wideResponse = await request(c, ids, { "x-api-key": wideKey });
    expect(wideResponse.status, await wideResponse.clone().text()).toBe(
      c.success,
    );
  });
});
