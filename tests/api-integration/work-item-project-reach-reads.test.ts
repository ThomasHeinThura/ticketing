/**
 * The READ side of the reach contract, as a behavioural table: every item-addressed GET (and
 * the mention-preflight POST) whose policy is `reach: "required"` on the `work_item` scope.
 *  - no project membership: 404, no row in the response;
 *  - customer-role member: 404 without a project role, 403 with one (matrix);
 *  - a reader with `work_item:read`: allowed;
 *  - an API key owned by someone outside reach: 404.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { READ_ROUTE_KEYS } from "./helpers/reach-route-keys";
import {
  createItem,
  json,
  MATRIX,
  makeApiKey,
  matrixStatus,
  type Seed,
  seedLegacy,
  setAmbientHeaders,
  setupWorld,
  TITLE,
} from "./helpers/reach-world";

type App = ReturnType<typeof createApp>["app"];
type Ctx = { key: string; commentId: string; legacy: Seed };
type ReadRoute = {
  matrixKey: string;
  call: (app: App, c: Ctx) => Promise<Response>;
};

const get = (app: App, url: string) => json(app, "GET", url);

const ROUTES: ReadRoute[] = [
  {
    matrixKey: "GET /api/work-items/{key}",
    call: (a, c) => get(a, `/api/work-items/${c.key}`),
  },
  {
    matrixKey: "GET /api/work-items/{key}/sla",
    call: (a, c) => get(a, `/api/work-items/${c.key}/sla`),
  },
  {
    matrixKey: "GET /api/work-items/{key}/activity",
    call: (a, c) => get(a, `/api/work-items/${c.key}/activity`),
  },
  {
    matrixKey: "GET /api/work-items/{key}/tree",
    call: (a, c) => get(a, `/api/work-items/${c.key}/tree`),
  },
  {
    matrixKey: "GET /api/work-items/{key}/transitions",
    call: (a, c) => get(a, `/api/work-items/${c.key}/transitions`),
  },
  {
    matrixKey: "GET /api/work-items/{key}/attachments",
    call: (a, c) => get(a, `/api/work-items/${c.key}/attachments`),
  },
  {
    matrixKey: "GET /api/work-items/{key}/comments/mention-candidates",
    call: (a, c) =>
      get(
        a,
        `/api/work-items/${c.key}/comments/mention-candidates?visibility=public`,
      ),
  },
  {
    matrixKey: "POST /api/work-items/{key}/comments/mention-preflight",
    call: (a, c) =>
      json(a, "POST", `/api/work-items/${c.key}/comments/mention-preflight`, {
        personIds: [],
        visibility: "public",
      }),
  },
  {
    matrixKey: "GET /api/work-items/{key}/comments/{id}/versions",
    call: (a, c) =>
      get(a, `/api/work-items/${c.key}/comments/${c.commentId}/versions`),
  },
  {
    matrixKey: "GET /api/task/{id}",
    call: (a, c) => get(a, `/api/task/${c.legacy.taskId}`),
  },
  {
    matrixKey: "GET /api/comment/{taskId}",
    call: (a, c) => get(a, `/api/comment/${c.legacy.taskId}`),
  },
  {
    matrixKey: "GET /api/activity/{taskId}",
    call: (a, c) => get(a, `/api/activity/${c.legacy.taskId}`),
  },
  {
    matrixKey: "GET /api/task-relation/{taskId}",
    call: (a, c) => get(a, `/api/task-relation/${c.legacy.taskId}`),
  },
  {
    matrixKey: "GET /api/external-link/task/{taskId}",
    call: (a, c) => get(a, `/api/external-link/task/${c.legacy.taskId}`),
  },
];

describe("API integration: project reach on item-addressed read routes", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("the table plus the download route covers exactly the read routes the guard requires", () => {
    expect(
      [...ROUTES.map((r) => r.matrixKey), "GET /api/attachments/{id}"].sort(),
    ).toEqual([...READ_ROUTE_KEYS].sort());
  });

  async function arrange() {
    const world = await setupWorld();
    const { app } = createApp();
    const item = await createItem(app, world, TITLE);
    mockAuthenticatedSession(world.projectMember.user);
    const comment = await json(
      app,
      "POST",
      `/api/work-items/${item.key}/comments`,
      {
        body: { type: "doc", content: [] },
        visibility: "public",
      },
    );
    const commentId = ((await comment.json()) as { id: string }).id;
    const legacy = await seedLegacy(world, world.projectMember.user.id);
    return { world, app, ctx: { key: item.key, commentId, legacy } as Ctx };
  }

  for (const route of ROUTES) {
    describe(route.matrixKey, () => {
      it("outsiders get 404 and see no row; customers get the matrix's answer", async () => {
        const { world, app, ctx } = await arrange();
        for (const outsider of [
          world.outsiderLead,
          world.outsiderMember,
          world.outsiderAdmin,
        ]) {
          mockAuthenticatedSession(outsider.user);
          const r = await route.call(app, ctx);
          const text = await r.text();
          expect(r.status, text).toBe(404);
          expect(text).not.toContain(TITLE);
          expect(text).not.toContain("Confidential legacy task");
        }
        mockAuthenticatedSession(world.customerNoRole.user);
        const out = await route.call(app, ctx);
        expect(out.status, await out.text()).toBe(
          matrixStatus(MATRIX.routes[route.matrixKey]?.customer?.outOfReach),
        );
        mockAuthenticatedSession(world.customerWithRole.user);
        const inside = await route.call(app, ctx);
        expect(inside.status, await inside.text()).toBe(
          matrixStatus(MATRIX.routes[route.matrixKey]?.customer?.inReach),
        );
      });

      it("a reader with work_item:read is allowed; an outsider-owned API key gets 404", async () => {
        const { world, app, ctx } = await arrange();
        mockAuthenticatedSession(world.readerLead.user);
        const ok = await route.call(app, ctx);
        const okText = await ok.text();
        expect([403, 404], okText).not.toContain(ok.status);
        mockAnonymousSession();
        setAmbientHeaders({
          "x-api-key": await makeApiKey(world.outsiderLead.user.id, {
            project: ["read"],
            task: ["read"],
            work_item: ["read"],
          }),
        });
        const key = await route.call(app, ctx);
        expect(key.status, await key.text()).toBe(404);
      });
    });
  }

  describe("GET /api/attachments/{id}", () => {
    it("outsiders get 404 and customers the matrix's answer", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const item = await createItem(app, world, TITLE);
      mockAuthenticatedSession(world.projectMember.user);
      const presign = await json(
        app,
        "POST",
        `/api/work-items/${item.key}/attachments/presign`,
        {
          filename: "probe.png",
          contentType: "image/png",
          size: 1024,
        },
      );
      const id = ((await presign.json()) as { attachmentId: string })
        .attachmentId;
      for (const outsider of [
        world.outsiderLead,
        world.outsiderMember,
        world.outsiderAdmin,
      ]) {
        mockAuthenticatedSession(outsider.user);
        const r = await get(app, `/api/attachments/${id}`);
        expect(r.status, await r.text()).toBe(404);
      }
      mockAuthenticatedSession(world.customerWithRole.user);
      const c = await get(app, `/api/attachments/${id}`);
      expect(c.status, await c.text()).toBe(
        matrixStatus(
          MATRIX.routes["GET /api/attachments/{id}"]?.customer?.inReach,
        ),
      );
    });
  });
});
