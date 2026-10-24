/**
 * Reach, capability and staff-only behaviour on every project Pages route (PG-2). Per route:
 *  - an outsider (workspace member without the project), another tenant's owner and a customer
 *    session get the 404 of a missing row, and write nothing;
 *  - a reader (project:read) is refused 403 on every write and served on reads;
 *  - the editor succeeds;
 *  - an unauthenticated caller gets 401.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  projectPageTable,
  projectPageVersionTable,
} from "../../apps/api/src/database/schema-p5-pages";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  doc,
  JSON_HEADERS,
  type PageBody,
  type PagesWorld,
  pagesWorld,
} from "./helpers/p5-pages";
import { ensureAgentSession } from "./helpers/pending-deletion";
import { PROJECT_PAGES_ROUTE_KEYS } from "./helpers/project-reach-route-keys";

type Ids = { projectId: string; pageId: string };
type Case = {
  key: string;
  kind: "read" | "write";
  success: number;
  method: string;
  path: (i: Ids) => string;
  body?: (i: Ids) => unknown;
  /** Puts the seeded page into the state the route acts on (undelete needs a deleted page). */
  prepare?: (i: Ids) => Promise<void>;
};

const CASES: Case[] = [
  {
    key: "GET /api/projects/{projectId}/pages",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectId}/pages`,
  },
  {
    key: "POST /api/projects/{projectId}/pages",
    kind: "write",
    success: 201,
    method: "POST",
    path: (i) => `/api/projects/${i.projectId}/pages`,
    body: () => ({ title: "Brand new", body: doc("hello") }),
  },
  {
    key: "GET /api/projects/{projectId}/pages/{id}",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectId}/pages/${i.pageId}`,
  },
  {
    key: "PATCH /api/projects/{projectId}/pages/{id}",
    kind: "write",
    success: 200,
    method: "PATCH",
    path: (i) => `/api/projects/${i.projectId}/pages/${i.pageId}`,
    body: () => ({ expectedVersion: 1, title: "Renamed" }),
  },
  {
    key: "GET /api/projects/{projectId}/pages/{id}/versions",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectId}/pages/${i.pageId}/versions`,
  },
  {
    key: "GET /api/projects/{projectId}/pages/{id}/versions/{number}",
    kind: "read",
    success: 200,
    method: "GET",
    path: (i) => `/api/projects/${i.projectId}/pages/${i.pageId}/versions/1`,
  },
  {
    key: "POST /api/projects/{projectId}/pages/{id}/restore",
    kind: "write",
    success: 200,
    method: "POST",
    path: (i) => `/api/projects/${i.projectId}/pages/${i.pageId}/restore`,
    body: () => ({ number: 1, expectedVersion: 1 }),
  },
  {
    key: "POST /api/projects/{projectId}/pages/{id}/undelete",
    kind: "write",
    success: 200,
    method: "POST",
    path: (i) => `/api/projects/${i.projectId}/pages/${i.pageId}/undelete`,
    prepare: async (i) => {
      await db
        .update(projectPageTable)
        .set({
          deletedAt: new Date(),
          purgeAfter: new Date(Date.now() + 30 * 86_400_000),
        })
        .where(eq(projectPageTable.id, i.pageId));
    },
  },
  {
    key: "DELETE /api/projects/{projectId}/pages/{id}",
    kind: "write",
    success: 202,
    method: "DELETE",
    path: (i) => `/api/projects/${i.projectId}/pages/${i.pageId}`,
  },
];

let w: PagesWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await pagesWorld();
  await ensureAgentSession(w.editor.user.id);
});

async function seed(c?: Case): Promise<Ids> {
  const created = await w.json<PageBody>(
    await w.call(w.editor.user, w.base(), {
      method: "POST",
      body: { title: "Seed page", body: doc("seed body") },
    }),
    201,
  );
  const ids = { projectId: w.project.id, pageId: created.id };
  await c?.prepare?.(ids);
  return ids;
}

function missing(): Ids {
  const m = () => `missing-${Math.random().toString(36).slice(2)}`;
  return { projectId: m(), pageId: m() };
}

function request(c: Case, ids: Ids) {
  const body = c.body?.(ids);
  return w.app.request(c.path(ids), {
    method: c.method,
    headers: JSON_HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function snapshot() {
  return JSON.stringify([
    await db.select().from(projectPageTable).orderBy(projectPageTable.id),
    await db
      .select()
      .from(projectPageVersionTable)
      .orderBy(projectPageVersionTable.id),
    await db.select().from(schema.pendingActionTable),
  ]);
}

describe("the table matches the route list exactly", () => {
  it("covers every project pages route key", () => {
    expect(CASES.map((c) => c.key).sort()).toEqual(
      [...PROJECT_PAGES_ROUTE_KEYS].sort(),
    );
  });
});

describe.each(CASES)("$key", (c) => {
  it("answers an outsider and another tenant with the 404 of a missing project, and writes nothing", async () => {
    const ids = await seed(c);
    const before = await snapshot();
    mockAuthenticatedSession(w.editor.user);
    const absentResponse = await request(c, missing());
    const absent = {
      status: absentResponse.status,
      text: await absentResponse.text(),
    };
    expect(absent.status).toBe(404);
    for (const user of [w.outsider.user, w.foreign.user]) {
      mockAuthenticatedSession(user);
      const response = await request(c, ids);
      expect(response.status, await response.clone().text()).toBe(404);
      expect(await response.text()).toBe(absent.text);
    }
    expect(await snapshot()).toBe(before);
  });

  it("gives a customer identity the same constant 404, never a page, and writes nothing", async () => {
    const ids = await seed(c);
    const before = await snapshot();
    mockAuthenticatedSession(w.editor.user);
    const absentResponse = await request(c, missing());
    const absentText = await absentResponse.text();
    // The customer identity reaching the route over an agent-portal session (the identity check
    // itself, independent of the session/host gate in front of it).
    mockAuthenticatedSession(w.customer.user);
    const asIdentity = await request(c, ids);
    expect(asIdentity.status, "customer identity").toBe(404);
    expect(await asIdentity.text()).toBe(absentText);
    // A real customer-portal session: unusable on the agent origin, and 404 on the portal host.
    mockAuthenticatedSession(w.customer.user, { portal: "customer" });
    const agentHost = await request(c, ids);
    expect([401, 403, 404], "agent host").toContain(agentHost.status);
    const body = c.body?.(ids);
    const onPortal = await w.app.request(
      `http://portal.localhost:5174${c.path(ids)}`,
      {
        method: c.method,
        headers: { host: "portal.localhost:5174", ...JSON_HEADERS },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    expect(onPortal.status, "portal host").toBe(404);
    expect(await snapshot()).toBe(before);
  });

  it("refuses an unauthenticated caller", async () => {
    const ids = await seed(c);
    mockAnonymousSession();
    expect((await request(c, ids)).status).toBe(401);
  });

  it(
    c.kind === "read"
      ? "serves a reader"
      : "refuses a reader who reaches the project but lacks project:update",
    async () => {
      const ids = await seed(c);
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

  it("lets the editor through", async () => {
    const ids = await seed(c);
    mockAuthenticatedSession(w.editor.user);
    const response = await request(c, ids);
    expect(response.status, await response.clone().text()).toBe(c.success);
  });
});

describe("a page cannot be reached through another project", () => {
  it("answers 404 for the right page id under the wrong project, even for an editor of both", async () => {
    const ids = await seed();
    for (const [path, method, body] of [
      [`${w.base(w.otherProject.id)}/${ids.pageId}`, "GET", undefined],
      [
        `${w.base(w.otherProject.id)}/${ids.pageId}`,
        "PATCH",
        { expectedVersion: 1, title: "x" },
      ],
      [`${w.base(w.otherProject.id)}/${ids.pageId}/versions`, "GET", undefined],
      [`${w.base(w.otherProject.id)}/${ids.pageId}`, "DELETE", undefined],
    ] as const) {
      const response = await w.call(w.editor.user, path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const [row] = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.id, ids.pageId));
    expect(row?.title).toBe("Seed page");
  });

  it("accepts the project key as well as its id", async () => {
    const ids = await seed();
    const response = await w.call(
      w.editor.user,
      `/api/projects/${w.project.slug}/pages/${ids.pageId}`,
    );
    expect(response.status).toBe(200);
  });
});
