/**
 * Project reach on every project-scoped route (#720, follow-up to #712).
 *
 * Every route below is declared `reach: "required"` on the `project` scope and the permission
 * matrix (`tests/permissions/matrix.fixture.json`) declares `404 not_found` for a caller
 * outside reach. Until #720 the write routes only checked workspace membership plus a legacy
 * workspace permission, so any workspace member with a strong role could change a project they
 * had no membership of. These tests drive the REAL middleware chain and assert, per route:
 *  - sessions: a same-workspace caller with no membership of the project (strong workspace
 *    roles, and a caller fully capable on ANOTHER project) gets the matrix's 404, writes
 *    nothing, sees no row, and gets byte-identical output to a request for a project that
 *    does not exist;
 *  - a caller who reaches the project but lacks the registered capability gets 403;
 *  - a project member holding the capability succeeds;
 *  - API keys: a key owned by someone outside reach gets the same 404, a read-scoped key owned
 *    by a capable member is refused (scope intersection is retained), a fully scoped key owned
 *    by a capable member succeeds.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  PROJECT_READ_ROUTE_KEYS,
  PROJECT_WRITE_ROUTE_KEYS,
} from "./helpers/project-reach-route-keys";
import {
  type Ids,
  missingIds,
  PROJECT_KEY_SCOPE,
  type ProjectWorld,
  projectSnapshot,
  READ_ONLY_KEY_SCOPE,
  seedProjectRows,
  setupProjectWorld,
} from "./helpers/project-reach-world";
import {
  type App,
  json,
  MATRIX,
  makeApiKey,
  matrixStatus,
  setAmbientHeaders,
} from "./helpers/reach-world";

type Case = {
  matrixKey: string;
  /** Put the data into the state this route's success path needs. */
  prepare?: (world: ProjectWorld, ids: Ids) => Promise<void>;
  successStatus?: number;
  call: (app: App, world: ProjectWorld, ids: Ids) => Promise<Response>;
};

const SECRET_MARKERS = [
  "Confidential milestone",
  "Confidential prerequisite",
  "Confidential link",
  "Confidential legacy task",
  "Integration Project",
];

const WRITES: Case[] = [
  {
    matrixKey: "PUT /api/project/{id}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/project/${i.projectId}`, {
        name: "Renamed",
        icon: "Folder",
        slug: `renamed-${Date.now()}`,
        description: "changed",
      }),
  },
  {
    matrixKey: "PATCH /api/project/{id}/health",
    call: (app, _w, i) =>
      json(app, "PATCH", `/api/project/${i.projectId}/health`, {
        health: "red",
      }),
  },
  {
    matrixKey: "DELETE /api/project/{id}",
    call: (app, _w, i) => json(app, "DELETE", `/api/project/${i.projectId}`),
  },
  {
    matrixKey: "PUT /api/project/{id}/archive",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/project/${i.projectId}/archive`),
  },
  {
    matrixKey: "PUT /api/project/{id}/unarchive",
    prepare: async (_w, i) => {
      await db
        .update(schema.projectTable)
        .set({ archivedAt: new Date() })
        .where(eq(schema.projectTable.id, i.projectId));
    },
    call: (app, _w, i) =>
      json(app, "PUT", `/api/project/${i.projectId}/unarchive`),
  },
  {
    matrixKey: "POST /api/project/{id}/milestones",
    call: (app, _w, i) =>
      json(app, "POST", `/api/project/${i.projectId}/milestones`, {
        name: "Injected milestone",
        date: "2031-01-01T00:00:00.000Z",
      }),
  },
  {
    matrixKey: "PATCH /api/project/{id}/milestones/{milestoneId}",
    call: (app, _w, i) =>
      json(
        app,
        "PATCH",
        `/api/project/${i.projectId}/milestones/${i.milestoneId}`,
        { name: "Overwritten milestone" },
      ),
  },
  {
    matrixKey: "DELETE /api/project/{id}/milestones/{milestoneId}",
    call: (app, _w, i) =>
      json(
        app,
        "DELETE",
        `/api/project/${i.projectId}/milestones/${i.milestoneId}`,
      ),
  },
  {
    matrixKey: "POST /api/project/{id}/prerequisites",
    call: (app, _w, i) =>
      json(app, "POST", `/api/project/${i.projectId}/prerequisites`, {
        title: "Injected prerequisite",
        ownerSide: "us",
      }),
  },
  {
    matrixKey: "PATCH /api/project/{id}/prerequisites/{prerequisiteId}",
    call: (app, _w, i) =>
      json(
        app,
        "PATCH",
        `/api/project/${i.projectId}/prerequisites/${i.prerequisiteId}`,
        { title: "Overwritten prerequisite" },
      ),
  },
  {
    matrixKey: "DELETE /api/project/{id}/prerequisites/{prerequisiteId}",
    call: (app, _w, i) =>
      json(
        app,
        "DELETE",
        `/api/project/${i.projectId}/prerequisites/${i.prerequisiteId}`,
      ),
  },
  {
    matrixKey: "POST /api/project/{id}/stakeholders",
    call: (app, w, i) =>
      json(app, "POST", `/api/project/${i.projectId}/stakeholders`, {
        personId: w.readerLead.personId,
        role: "observer",
        escalationOrder: 2,
      }),
  },
  {
    matrixKey: "PATCH /api/project/{id}/stakeholders/{stakeholderId}",
    call: (app, _w, i) =>
      json(
        app,
        "PATCH",
        `/api/project/${i.projectId}/stakeholders/${i.stakeholderId}`,
        { role: "overwritten" },
      ),
  },
  {
    matrixKey: "POST /api/project/{id}/stakeholders/{stakeholderId}/stand-down",
    call: (app, _w, i) =>
      json(
        app,
        "POST",
        `/api/project/${i.projectId}/stakeholders/${i.stakeholderId}/stand-down`,
      ),
  },
  {
    matrixKey: "POST /api/project/{id}/document-links",
    call: (app, _w, i) =>
      json(app, "POST", `/api/project/${i.projectId}/document-links`, {
        url: "https://example.com/injected",
        title: "Injected link",
      }),
  },
  {
    matrixKey: "DELETE /api/project/{id}/document-links/{documentLinkId}",
    call: (app, _w, i) =>
      json(
        app,
        "DELETE",
        `/api/project/${i.projectId}/document-links/${i.documentLinkId}`,
      ),
  },
  {
    matrixKey: "POST /api/projects/{projectId}/work-items",
    call: (app, w, i) =>
      json(app, "POST", `/api/projects/${i.projectId}/work-items`, {
        typeId: w.type.id,
        title: "Injected work item",
      }),
  },
  {
    matrixKey: "POST /api/task/{projectId}",
    call: (app, _w, i) =>
      json(app, "POST", `/api/task/${i.projectId}`, {
        title: "Injected legacy task",
        description: "d",
        priority: "medium",
        status: "to-do",
      }),
  },
  {
    matrixKey: "POST /api/task/import/{projectId}",
    call: (app, _w, i) =>
      json(app, "POST", `/api/task/import/${i.projectId}`, {
        tasks: [{ title: "Injected imported task", status: "to-do" }],
      }),
  },
  {
    matrixKey: "POST /api/column/{projectId}",
    call: (app, _w, i) =>
      json(app, "POST", `/api/column/${i.projectId}`, {
        name: "Injected column",
      }),
  },
  {
    matrixKey: "PUT /api/column/reorder/{projectId}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/column/reorder/${i.projectId}`, {
        columns: [{ id: i.columnId, position: 9 }],
      }),
  },
  {
    matrixKey: "PUT /api/column/{id}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/column/${i.columnId}`, {
        name: "Overwritten column",
      }),
  },
  {
    matrixKey: "DELETE /api/column/{id}",
    prepare: async (_w, i) => {
      // A column holding no task, so the delete's own preconditions pass.
      await db.delete(schema.workflowRuleTable);
      await db
        .delete(schema.taskTable)
        .where(eq(schema.taskTable.columnId, i.columnId));
    },
    call: (app, _w, i) => json(app, "DELETE", `/api/column/${i.columnId}`),
  },
  {
    matrixKey: "PUT /api/workflow-rule/{projectId}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/workflow-rule/${i.projectId}`, {
        integrationType: "github",
        eventType: "pull_request_merged",
        columnId: i.columnId,
      }),
  },
  {
    matrixKey: "DELETE /api/workflow-rule/{id}",
    call: (app, _w, i) => json(app, "DELETE", `/api/workflow-rule/${i.ruleId}`),
  },
];

const READS: Case[] = [
  {
    matrixKey: "GET /api/project/{id}",
    call: (a, _w, i) => json(a, "GET", `/api/project/${i.projectId}`),
  },
  {
    matrixKey: "GET /api/project/{id}/health",
    call: (a, _w, i) => json(a, "GET", `/api/project/${i.projectId}/health`),
  },
  {
    matrixKey: "GET /api/project/{id}/milestones",
    call: (a, _w, i) =>
      json(a, "GET", `/api/project/${i.projectId}/milestones`),
  },
  {
    matrixKey: "GET /api/project/{id}/prerequisites",
    call: (a, _w, i) =>
      json(a, "GET", `/api/project/${i.projectId}/prerequisites`),
  },
  {
    matrixKey: "GET /api/project/{id}/stakeholders",
    call: (a, _w, i) =>
      json(a, "GET", `/api/project/${i.projectId}/stakeholders`),
  },
  {
    matrixKey: "GET /api/project/{id}/document-links",
    call: (a, _w, i) =>
      json(a, "GET", `/api/project/${i.projectId}/document-links`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/assignable",
    call: (a, _w, i) =>
      json(a, "GET", `/api/projects/${i.projectId}/assignable`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/states",
    call: (a, _w, i) => json(a, "GET", `/api/projects/${i.projectId}/states`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/work-items",
    call: (a, _w, i) =>
      json(a, "GET", `/api/projects/${i.projectId}/work-items`),
  },
  {
    matrixKey: "GET /api/task/tasks/{projectId}",
    call: (a, _w, i) => json(a, "GET", `/api/task/tasks/${i.projectId}`),
  },
  {
    matrixKey: "GET /api/task/export/{projectId}",
    call: (a, _w, i) => json(a, "GET", `/api/task/export/${i.projectId}`),
  },
  {
    matrixKey: "GET /api/column/{projectId}",
    call: (a, _w, i) => json(a, "GET", `/api/column/${i.projectId}`),
  },
  {
    matrixKey: "GET /api/workflow-rule/{projectId}",
    call: (a, _w, i) => json(a, "GET", `/api/workflow-rule/${i.projectId}`),
  },
];

describe("API integration: project reach on project-scoped routes (#720)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("the tables cover exactly the routes the guard requires", () => {
    expect(WRITES.map((route) => route.matrixKey).sort()).toEqual(
      [...PROJECT_WRITE_ROUTE_KEYS].sort(),
    );
    expect(READS.map((route) => route.matrixKey).sort()).toEqual(
      [...PROJECT_READ_ROUTE_KEYS].sort(),
    );
  });

  async function arrange(route: Case) {
    const world = await setupProjectWorld();
    const { app } = createApp();
    const ids = await seedProjectRows(app, world);
    await route.prepare?.(world, ids);
    return { world, app, ids };
  }

  function outsiders(world: ProjectWorld) {
    return [
      world.outsiderLead,
      world.outsiderMember,
      world.outsiderAdmin,
      // Fully capable on ANOTHER project of the same workspace: not reach to this one.
      world.otherProjectAdmin,
    ];
  }

  for (const route of [...WRITES, ...READS]) {
    const isRead = route.matrixKey.startsWith("GET ");
    describe(route.matrixKey, () => {
      it("a same-workspace caller outside project reach gets the matrix's 404 byte-identical to a missing project, and writes nothing", async () => {
        const { world, app, ids } = await arrange(route);
        const declared = matrixStatus(
          MATRIX.routes[route.matrixKey]?.member?.outOfReach,
        );
        expect(declared).toBe(404);
        const before = await projectSnapshot();

        mockAuthenticatedSession(world.projectAdmin.user);
        const missing = await route.call(app, world, missingIds());
        const missingText = await missing.text();
        expect(missing.status, missingText).toBe(404);

        for (const outsider of outsiders(world)) {
          mockAuthenticatedSession(outsider.user);
          const response = await route.call(app, world, ids);
          const text = await response.text();
          expect(response.status, text).toBe(declared);
          expect(text).toBe(missingText);
          for (const marker of SECRET_MARKERS) {
            expect(text).not.toContain(marker);
          }
        }
        expect(await projectSnapshot()).toBe(before);
      });

      if (!isRead) {
        it("a caller who reaches the project without the capability gets 403 and nothing is written", async () => {
          const { world, app, ids } = await arrange(route);
          expect(
            matrixStatus(MATRIX.routes[route.matrixKey]?.viewer?.inReach),
          ).toBe(403);
          const before = await projectSnapshot();
          mockAuthenticatedSession(world.readerLead.user);
          const response = await route.call(app, world, ids);
          const text = await response.text();
          expect(response.status, text).toBe(403);
          expect(await projectSnapshot()).toBe(before);
        });
      }

      it("a project member holding the capability succeeds", async () => {
        const { world, app, ids } = await arrange(route);
        mockAuthenticatedSession(world.projectAdmin.user);
        const response = await route.call(app, world, ids);
        expect(response.status, await response.clone().text()).toBe(
          route.successStatus ?? 200,
        );
      });

      it("API keys: an outsider's key gets the same 404; on writes a read-scoped key is refused and a scoped key of a capable member succeeds", async () => {
        const { world, app, ids } = await arrange(route);
        mockAnonymousSession();
        const outsiderKey = await makeApiKey(
          world.outsiderAdmin.user.id,
          PROJECT_KEY_SCOPE,
        );
        const memberKey = await makeApiKey(
          world.projectAdmin.user.id,
          PROJECT_KEY_SCOPE,
        );
        const readKey = await makeApiKey(
          world.projectAdmin.user.id,
          READ_ONLY_KEY_SCOPE,
        );
        const before = await projectSnapshot();

        setAmbientHeaders({ "x-api-key": outsiderKey });
        const outside = await route.call(app, world, ids);
        const outsideText = await outside.text();
        expect(outside.status, outsideText).toBe(404);
        for (const marker of SECRET_MARKERS) {
          expect(outsideText).not.toContain(marker);
        }
        expect(await projectSnapshot()).toBe(before);

        if (!isRead) {
          setAmbientHeaders({ "x-api-key": readKey });
          const scoped = await route.call(app, world, ids);
          const scopedText = await scoped.text();
          expect(scoped.status, scopedText).toBe(403);
          expect(await projectSnapshot()).toBe(before);
        }

        if (!isRead) {
          // Reads gate API keys on a canonical capability subset that keys do not carry
          // yet (`resolveIdentity`), a pre-existing behaviour this change does not touch;
          // writes defer that to the key-aware legacy gate, so a scoped key succeeds.
          setAmbientHeaders({ "x-api-key": memberKey });
          const allowed = await route.call(app, world, ids);
          setAmbientHeaders({});
          expect(allowed.status, await allowed.clone().text()).toBe(
            route.successStatus ?? 200,
          );
        }
      });
    });
  }

  describe("PUT /api/project/{id}: reach is decided before the settings-capability check", () => {
    const body = (project: { slug: string }) => ({
      name: "Renamed",
      icon: "Folder",
      slug: project.slug,
      description: "changed",
      defaultCommentVisibility: "internal",
    });

    it("an outsider sending defaultCommentVisibility gets 404, never the 403 that would confirm the project exists", async () => {
      const world = await setupProjectWorld();
      const { app } = createApp();
      const before = await projectSnapshot();
      mockAuthenticatedSession(world.outsiderAdmin.user);
      const response = await json(
        app,
        "PUT",
        `/api/project/${world.project.id}`,
        body(world.project),
      );
      const text = await response.text();
      expect(response.status, text).toBe(404);
      expect(await projectSnapshot()).toBe(before);
    });
  });
});
