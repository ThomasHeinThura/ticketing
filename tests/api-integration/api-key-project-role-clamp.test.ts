/**
 * #724 (owner decision 2026-10-15): an API key's effective authority is its stored scope ∩ the
 * owner's CURRENT authority in the project (workspace role overridden by the project role), so
 * a key never exceeds what the owner's own session can do there.
 *
 * The scenario that used to differ: a workspace `lead` whose project role is read-only. Their
 * session is refused every write (403); a full-scope key they own used to pass the key-aware
 * gates, which only looked at the workspace role. Now the key is refused exactly like the
 * session; owners and project members are unaffected; outsiders still get the same 404.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { grantProjectRole } from "./helpers/fixtures";
import {
  addMember,
  createItem,
  json,
  makeApiKey,
  ROUTES,
  seedLegacy,
  setAmbientHeaders,
  setupWorld,
  snapshot,
  TITLE,
} from "./helpers/reach-world";

const FULL_SCOPE = {
  project: ["read", "update", "delete", "manage_settings"],
  work_item: [
    "read",
    "update",
    "delete",
    "assign",
    "rank",
    "transition",
    "set_priority",
  ],
  comment: ["create", "create_internal", "update_own", "delete_own"],
  attachment: ["create", "delete_own"],
  approval: ["request"],
  workspace: ["read"],
};

describe("API integration: API key authority is clamped by the owner's project role (#724)", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-key-clamp-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });
  afterEach(async () => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
    if (originalRoot === undefined)
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    await rm(root, { recursive: true, force: true });
  });

  for (const route of ROUTES.filter((r) => r.capability !== "handler")) {
    describe(route.matrixKey, () => {
      async function arrange() {
        const world = await setupWorld();
        const { app } = createApp();
        const target = await createItem(app, world, TITLE);
        const neighbour = await createItem(app, world, "Neighbour");
        const parent = await createItem(app, world, "Parent");
        const item = {
          key: target.key,
          neighbourId: neighbour.id,
          parentKey: parent.key,
        };
        await route.prepare?.(world, item, app);
        return { world, app, item };
      }

      it("a full-scope key owned by a read-only project member is refused exactly like its owner's session", async () => {
        const { world, app, item } = await arrange();
        const before = await snapshot();
        mockAuthenticatedSession(world.readerLead.user);
        const session = await route.call(app, world, item);
        const sessionStatus = session.status;
        expect(sessionStatus, await session.clone().text()).toBe(
          route.readOnlyStatus ?? 403,
        );

        mockAnonymousSession();
        setAmbientHeaders({
          "x-api-key": await makeApiKey(world.readerLead.user.id, FULL_SCOPE),
        });
        const withKey = await route.call(app, world, item);
        setAmbientHeaders({});
        expect(withKey.status, await withKey.text()).toBe(sessionStatus);
        if (sessionStatus === 403) expect(await snapshot()).toBe(before);
      });

      it("a full-scope key owned by a capable project member keeps working (same answer as the session)", async () => {
        const { world, app, item } = await arrange();
        mockAnonymousSession();
        setAmbientHeaders({
          "x-api-key": await makeApiKey(
            world.projectMember.user.id,
            FULL_SCOPE,
          ),
        });
        const withKey = await route.call(app, world, item);
        setAmbientHeaders({});
        expect(withKey.status, await withKey.text()).toBe(
          route.successStatus ?? 200,
        );
      });
    });
  }

  describe("the named cases of #724", () => {
    async function arrange() {
      const world = await setupWorld();
      const { app } = createApp();
      const item = await createItem(app, world, TITLE);
      const neighbour = await createItem(app, world, "Neighbour");
      return { world, app, item, neighbour };
    }

    it("PATCH, rank and delete with a full-scope key of a read-only project lead are 403 and write nothing", async () => {
      const { world, app, item, neighbour } = await arrange();
      const before = await snapshot();
      mockAnonymousSession();
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.readerLead.user.id, FULL_SCOPE),
      });
      for (const [method, url, body, headers] of [
        [
          "PATCH",
          `/api/work-items/${item.key}`,
          { title: "x" },
          { "if-match": '"1"' },
        ],
        [
          "POST",
          `/api/work-items/${item.key}/rank`,
          { beforeId: neighbour.id },
          {},
        ],
        ["DELETE", `/api/work-items/${item.key}`, undefined, {}],
      ] as const) {
        const response = await json(app, method, url, body, { ...headers });
        expect(
          response.status,
          `${method} ${url}: ${await response.text()}`,
        ).toBe(403);
      }
      setAmbientHeaders({});
      expect(await snapshot()).toBe(before);
    });

    it("bulk delete and bulk assign with that key refuse every item like the session and delete nothing", async () => {
      const { world, app, item } = await arrange();
      const before = await snapshot();
      const bodies = [
        { operation: "delete" },
        { operation: "assign", assigneeId: world.projectMember.personId },
      ];
      const results: unknown[] = [];
      for (const credential of ["session", "key"] as const) {
        if (credential === "session") {
          mockAuthenticatedSession(world.readerLead.user);
        } else {
          mockAnonymousSession();
          setAmbientHeaders({
            "x-api-key": await makeApiKey(world.readerLead.user.id, FULL_SCOPE),
          });
        }
        for (const body of bodies) {
          const response = await json(app, "POST", "/api/work-items/bulk", {
            workspaceId: world.workspaceId,
            workItemKeys: [item.key],
            ...body,
          });
          const text = await response.text();
          results.push({ credential, status: response.status, text });
        }
        setAmbientHeaders({});
      }
      const [sessionDelete, sessionAssign, keyDelete, keyAssign] =
        results as Array<{
          status: number;
          text: string;
        }>;
      expect(keyDelete?.status).toBe(sessionDelete?.status);
      expect(keyDelete?.text).toBe(sessionDelete?.text);
      expect(keyAssign?.status).toBe(sessionAssign?.status);
      expect(keyAssign?.text).toBe(sessionAssign?.text);
      expect(keyDelete?.text).not.toContain('"ok"');
      expect(await snapshot()).toBe(before);
    });

    it("bulk delete with a key owned by a capable project member still works", async () => {
      const { world, app, item } = await arrange();
      mockAnonymousSession();
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, FULL_SCOPE),
      });
      const response = await json(app, "POST", "/api/work-items/bulk", {
        workspaceId: world.workspaceId,
        workItemKeys: [item.key],
        operation: "delete",
      });
      setAmbientHeaders({});
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.text()).not.toContain("forbidden");
    });

    it("an owner or admin with no project role override is unaffected", async () => {
      const { world, app, item } = await arrange();
      for (const role of ["owner", "admin"] as const) {
        const member = await addMember(world.workspaceId, role);
        mockAuthenticatedSession(member.user);
        const probe = await json(app, "GET", `/api/work-items/${item.key}`);
        const sessionStatus = probe.status;
        mockAnonymousSession();
        setAmbientHeaders({
          "x-api-key": await makeApiKey(member.user.id, FULL_SCOPE),
        });
        const withKey = await json(app, "GET", `/api/work-items/${item.key}`);
        setAmbientHeaders({});
        expect(withKey.status, `${role}: ${await withKey.text()}`).toBe(
          sessionStatus,
        );
      }
    });

    it("a project role that GRANTS more than the workspace role is honoured for the key too (the key never exceeds, but is not clamped below, its owner)", async () => {
      const { world, app, item } = await arrange();
      const member = await addMember(world.workspaceId, "member");
      await grantProjectRole(member.user.id, world.project.id, [
        "project:read",
        "work_item:read",
        "work_item:update",
        "work_item:set_priority",
      ]);
      mockAuthenticatedSession(member.user);
      const session = await json(
        app,
        "PATCH",
        `/api/work-items/${item.key}`,
        { title: "By session" },
        { "if-match": '"1"' },
      );
      mockAnonymousSession();
      setAmbientHeaders({
        "x-api-key": await makeApiKey(member.user.id, FULL_SCOPE),
      });
      const key = await json(
        app,
        "PATCH",
        `/api/work-items/${item.key}`,
        { title: "By key" },
        { "if-match": session.status === 200 ? '"2"' : '"1"' },
      );
      setAmbientHeaders({});
      expect(key.status, await key.text()).toBe(session.status);
    });

    it("an outsider's full-scope key is still a 404 on a write", async () => {
      const { world, app, item } = await arrange();
      mockAnonymousSession();
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.outsiderLead.user.id, FULL_SCOPE),
      });
      const response = await json(
        app,
        "PATCH",
        `/api/work-items/${item.key}`,
        { title: "x" },
        { "if-match": '"1"' },
      );
      setAmbientHeaders({});
      expect(response.status).toBe(404);
    });

    it("a narrower key scope still narrows the owner (read-only key of a capable member)", async () => {
      const { world, app, item } = await arrange();
      mockAnonymousSession();
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, {
          project: ["read"],
          work_item: ["read"],
        }),
      });
      const response = await json(app, "DELETE", `/api/work-items/${item.key}`);
      setAmbientHeaders({});
      expect(response.status).toBe(403);
    });
  });

  describe("project-level writes (the key capability is left to a downstream gate)", () => {
    const PROJECT_WRITES: Array<{
      name: string;
      call: (
        app: ReturnType<typeof createApp>["app"],
        projectId: string,
      ) => Promise<Response>;
    }> = [
      {
        name: "PUT /api/project/{id}",
        call: (app, id) =>
          json(app, "PUT", `/api/project/${id}`, {
            name: "Renamed",
            icon: "Folder",
            slug: `renamed-${Date.now()}`,
            description: "changed",
          }),
      },
      {
        name: "PATCH /api/project/{id}/health",
        call: (app, id) =>
          json(app, "PATCH", `/api/project/${id}/health`, { health: "red" }),
      },
      {
        name: "POST /api/project/{id}/milestones",
        call: (app, id) =>
          json(app, "POST", `/api/project/${id}/milestones`, {
            name: "Injected milestone",
            date: "2031-01-01T00:00:00.000Z",
          }),
      },
      {
        name: "PUT /api/project/{id}/archive",
        call: (app, id) => json(app, "PUT", `/api/project/${id}/archive`),
      },
      {
        name: "DELETE /api/project/{id}",
        call: (app, id) => json(app, "DELETE", `/api/project/${id}`),
      },
    ];

    for (const write of PROJECT_WRITES) {
      for (const role of ["lead", "admin"] as const) {
        it(`${write.name}: a workspace ${role} with a read-only project role gets 403 with a full-scope key, like the session`, async () => {
          const world = await setupWorld();
          const { app } = createApp();
          const reader = await addMember(world.workspaceId, role);
          await grantProjectRole(reader.user.id, world.project.id, [
            "project:read",
            "work_item:read",
          ]);
          mockAuthenticatedSession(reader.user);
          const session = await write.call(app, world.project.id);
          expect(session.status, await session.clone().text()).toBe(403);

          mockAnonymousSession();
          setAmbientHeaders({
            "x-api-key": await makeApiKey(reader.user.id, FULL_SCOPE),
          });
          const withKey = await write.call(app, world.project.id);
          setAmbientHeaders({});
          expect(withKey.status, await withKey.text()).toBe(403);
        });
      }

      it(`${write.name}: an outsider's key is a 404 and a capable member's key answers like that member's session`, async () => {
        const world = await setupWorld();
        const { app } = createApp();
        mockAnonymousSession();
        setAmbientHeaders({
          "x-api-key": await makeApiKey(world.outsiderLead.user.id, FULL_SCOPE),
        });
        expect((await write.call(app, world.project.id)).status).toBe(404);
        setAmbientHeaders({});

        // The member's key and session are compared on separate fresh worlds so a
        // destructive write by one cannot colour the other.
        const sessionWorld = await setupWorld();
        mockAuthenticatedSession(sessionWorld.projectMember.user);
        const sessionStatus = (await write.call(app, sessionWorld.project.id))
          .status;

        const keyWorld = await setupWorld();
        mockAnonymousSession();
        setAmbientHeaders({
          "x-api-key": await makeApiKey(
            keyWorld.projectMember.user.id,
            FULL_SCOPE,
          ),
        });
        const keyStatus = (await write.call(app, keyWorld.project.id)).status;
        setAmbientHeaders({});
        expect(keyStatus).toBe(sessionStatus);
      });
    }
  });

  describe("rows the key's owner authored themselves (ownership cannot mask the project-role clamp)", () => {
    const OWN_ROW_ROUTES = ROUTES.filter((route) =>
      [
        "DELETE /api/attachments/{id}",
        "POST /api/attachments/{id}/complete",
        "PATCH /api/comments/{id}",
        "DELETE /api/comments/{id}",
      ].includes(route.matrixKey),
    );

    for (const route of OWN_ROW_ROUTES) {
      it(`${route.matrixKey}: a workspace admin with a read-only project role, refused as a session, is refused with a full-scope key too`, async () => {
        const world = await setupWorld();
        const { app } = createApp();
        const target = await createItem(app, world, TITLE);
        const item = { key: target.key, neighbourId: "", parentKey: "" };
        await route.prepare?.(world, item, app);
        // A workspace admin passes every legacy workspace statement; only the project role
        // (read-only) can refuse them. They authored the row, so ownership cannot refuse either.
        const reader = await addMember(world.workspaceId, "admin");
        await grantProjectRole(reader.user.id, world.project.id, [
          "project:read",
          "work_item:read",
        ]);
        if (item.attachmentId)
          await db
            .update(schema.attachmentTable)
            .set({ uploadedBy: reader.personId })
            .where(eq(schema.attachmentTable.id, item.attachmentId));
        if (item.commentId)
          await db
            .update(schema.commentTable)
            .set({ authorId: reader.user.id })
            .where(eq(schema.commentTable.id, item.commentId));
        const before = await snapshot();

        mockAuthenticatedSession(reader.user);
        const session = await route.call(app, world, item);
        expect(session.status, await session.clone().text()).toBe(403);

        mockAnonymousSession();
        setAmbientHeaders({
          "x-api-key": await makeApiKey(reader.user.id, FULL_SCOPE),
        });
        const withKey = await route.call(app, world, item);
        setAmbientHeaders({});
        expect(withKey.status, await withKey.text()).toBe(403);
        expect(await snapshot()).toBe(before);
      });
    }
  });

  describe("legacy task relations (assertWorkItemProjectReach with a deferred key scope)", () => {
    it("POST and DELETE /api/task-relation: a workspace admin with a read-only project role is refused as a session and with a full-scope key", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const reader = await addMember(world.workspaceId, "admin");
      await grantProjectRole(reader.user.id, world.project.id, [
        "project:read",
        "work_item:read",
      ]);
      const seed = await seedLegacy(world, reader.user.id);
      const create = () =>
        json(app, "POST", "/api/task-relation", {
          sourceTaskId: seed.otherTaskId,
          targetTaskId: seed.taskId,
          relationType: "blocks",
        });
      const remove = () =>
        json(app, "DELETE", `/api/task-relation/${seed.relationId}`);
      const relationRows = async () =>
        JSON.stringify(await db.select().from(schema.taskRelationTable));
      const before = await relationRows();

      mockAuthenticatedSession(reader.user);
      for (const call of [create, remove]) {
        const response = await call();
        expect(response.status, await response.text()).toBe(403);
      }

      mockAnonymousSession();
      setAmbientHeaders({
        "x-api-key": await makeApiKey(reader.user.id, FULL_SCOPE),
      });
      for (const call of [create, remove]) {
        const response = await call();
        expect(response.status, await response.text()).toBe(403);
      }
      setAmbientHeaders({});
      expect(await relationRows()).toBe(before);
    });

    it("a capable project member's key still creates and deletes relations", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const seed = await seedLegacy(world, world.projectMember.user.id);
      mockAnonymousSession();
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, FULL_SCOPE),
      });
      const removed = await json(
        app,
        "DELETE",
        `/api/task-relation/${seed.relationId}`,
      );
      expect(removed.status, await removed.text()).toBe(200);
      setAmbientHeaders({});
    });
  });

  describe("owner authority is not narrowed by a key's CANONICAL subset on a deferred-scope route", () => {
    it("DELETE /api/attachments/{id}: the route's policy capability (attachment:delete_own) is not in the key scope, but the legacy statement the route checks (work_item:update) is, and the owner holds both: allowed", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const target = await createItem(app, world, TITLE);
      mockAuthenticatedSession(world.projectMember.user);
      const presign = await json(
        app,
        "POST",
        `/api/work-items/${target.key}/attachments/presign`,
        { filename: "probe.png", contentType: "image/png", size: 1024 },
      );
      expect(presign.status, await presign.clone().text()).toBe(200);
      const { attachmentId } = (await presign.json()) as {
        attachmentId: string;
      };
      mockAnonymousSession();
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, {
          project: ["read"],
          work_item: ["read", "update"],
        }),
      });
      const response = await json(
        app,
        "DELETE",
        `/api/attachments/${attachmentId}`,
      );
      setAmbientHeaders({});
      expect(response.status, await response.text()).toBe(200);
    });
  });

  describe("a key scope narrower than its owner's authority (deferred-scope routes)", () => {
    it("the owner's project authority alone does not widen a key: a read-only key of a capable member cannot write, a matching key can", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const item = await createItem(app, world, TITLE);
      const before = await snapshot();
      mockAnonymousSession();

      // Narrower than the owner: read-only scope, owner could write.
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, {
          project: ["read"],
          work_item: ["read"],
        }),
      });
      const narrow = await json(
        app,
        "PATCH",
        `/api/work-items/${item.key}`,
        { title: "x" },
        { "if-match": '"1"' },
      );
      expect(narrow.status, await narrow.text()).toBe(403);
      expect(await snapshot()).toBe(before);

      // Exactly the capability the route needs: allowed, because the owner holds it too.
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, {
          project: ["read"],
          work_item: ["read", "update"],
        }),
      });
      const matching = await json(
        app,
        "PATCH",
        `/api/work-items/${item.key}`,
        { title: "Renamed by a narrow key" },
        { "if-match": '"1"' },
      );
      setAmbientHeaders({});
      expect(matching.status, await matching.text()).toBe(200);
    });

    it("a key whose scope is wide but whose owner's project role is narrow stays refused even where the legacy workspace statement would allow it", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const item = await createItem(app, world, TITLE);
      const owner = await addMember(world.workspaceId, "admin");
      await grantProjectRole(owner.user.id, world.project.id, [
        "project:read",
        "work_item:read",
        "work_item:update",
      ]);
      mockAnonymousSession();
      setAmbientHeaders({
        "x-api-key": await makeApiKey(owner.user.id, FULL_SCOPE),
      });
      const allowed = await json(
        app,
        "PATCH",
        `/api/work-items/${item.key}`,
        { title: "Renamed within the role" },
        { "if-match": '"1"' },
      );
      expect(allowed.status, await allowed.text()).toBe(200);
      const refused = await json(app, "DELETE", `/api/work-items/${item.key}`);
      setAmbientHeaders({});
      expect(refused.status, await refused.text()).toBe(403);
    });
  });
});
