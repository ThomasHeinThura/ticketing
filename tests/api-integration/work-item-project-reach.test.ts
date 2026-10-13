/**
 * Project reach on every item-scoped work-item route.
 *
 * Every route below is declared `reach: "required"` on the `work_item` scope
 * (`apps/api/src/work-item/policy.ts`) and the permission matrix
 * (`tests/permissions/matrix.fixture.json`) declares `404 not_found` for a caller outside
 * reach and the role's own answer inside it. These tests drive the REAL middleware chain and
 * assert the declared answers, taking the expected status for the outside-reach and customer
 * cases from the matrix fixture itself, so the fixture and the runtime cannot drift apart
 * silently (#708 tracks the general gap; this closes it for the item-scoped routes).
 *
 * For each route:
 *  - a same-workspace caller with a strong workspace role but NO project membership gets 404,
 *    nothing is written, and the response never carries the item;
 *  - a customer-role member gets the matrix's customer answer (404 without a project role,
 *    the declared inReach answer with one);
 *  - a project member holding the capability succeeds.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  prepareAuthenticatedApiFixture,
  requireRow,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];

const MATRIX = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../permissions/matrix.fixture.json", import.meta.url),
    ),
    "utf8",
  ),
) as {
  routes: Record<
    string,
    Record<string, { inReach: string; outOfReach: string }>
  >;
};

function matrixStatus(answer: string | undefined): number {
  if (!answer) throw new Error("matrix answer missing");
  if (answer === "allow") return 200;
  const status = Number.parseInt(answer, 10);
  if (Number.isNaN(status)) throw new Error(`unparseable matrix: ${answer}`);
  return status;
}

const PROJECT_CAPABILITIES = [
  "project:read",
  "work_item:read",
  "work_item:update",
  "work_item:delete",
  "work_item:assign",
  "work_item:rank",
  "work_item:transition",
  "comment:create",
  "comment:create_internal",
  "attachment:create",
] as const;

const TITLE = "Confidential reach probe";

async function seedWorkspaceRole(workspaceId: string, role: string) {
  const now = new Date();
  await db
    .insert(schema.workspaceRoleTable)
    .values({
      workspaceId,
      role,
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

async function addMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: `reach ${role}`,
      })
      .returning(),
    "addMember",
  );
  await prepareAuthenticatedApiFixture(user.id);
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  await seedWorkspaceRole(workspaceId, role);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id))
    .limit(1);
  if (!person) throw new Error("addMember: person missing");
  return { user, personId: person.id };
}

async function makeState(
  workspaceId: string,
  projectId: string,
  group: string,
  isDefault: boolean,
) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: group,
        group,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "state_template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "state",
  );
  return { stateTemplate, state };
}

async function setupWorld() {
  const admin = await createWorkspaceMember({ role: "admin" });
  const workspaceId = admin.workspace.id;
  const { project } = await createProjectFixture({ workspaceId });
  const backlog = await makeState(workspaceId, project.id, "backlog", true);
  const started = await makeState(workspaceId, project.id, "started", false);

  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({ workspaceId, key: `wf-${randomUUID()}`, name: "Workflow" })
      .returning(),
    "workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "workflow version",
  );
  await db.insert(schema.workflowTransitionTable).values({
    versionId: version.id,
    fromStateTemplateId: backlog.stateTemplate.id,
    toStateTemplateId: started.stateTemplate.id,
    roleId: null,
    guards: [],
    effects: [],
  });
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));

  const now = new Date();
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Ticket",
        category: "service",
        workflowId: workflow.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "type",
  );

  // Callers. Strong workspace roles on purpose: the defect was that workspace-level reach
  // plus a workspace role was enough; only the project membership differs between them.
  const projectMember = await addMember(workspaceId, "admin");
  await grantProjectRole(projectMember.user.id, project.id, [
    ...PROJECT_CAPABILITIES,
  ]);
  const outsiderLead = await addMember(workspaceId, "lead");
  const outsiderMember = await addMember(workspaceId, "member");
  const outsiderAdmin = await addMember(workspaceId, "admin");
  const customerNoRole = await addMember(workspaceId, "customer");
  const customerWithRole = await addMember(workspaceId, "customer");
  await grantProjectRole(customerWithRole.user.id, project.id, [
    ...PROJECT_CAPABILITIES,
  ]);

  return {
    admin,
    workspaceId,
    project,
    type,
    started,
    projectMember,
    outsiderLead,
    outsiderMember,
    outsiderAdmin,
    customerNoRole,
    customerWithRole,
  };
}

type World = Awaited<ReturnType<typeof setupWorld>>;

async function createItem(app: App, world: World, title: string) {
  mockAuthenticatedSession(world.admin.user);
  const response = await app.request(
    `/api/projects/${world.project.id}/work-items`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ typeId: world.type.id, title }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { id: string; key: string };
}

async function snapshot() {
  const items = await db
    .select()
    .from(schema.workItemTable)
    .orderBy(schema.workItemTable.key);
  const comments = await db.select().from(schema.commentTable);
  const watchers = await db.select().from(schema.watcherTable);
  const attachments = await db.select().from(schema.attachmentTable);
  const activity = await db.select().from(schema.activityTable);
  return JSON.stringify({
    items,
    comments: comments.length,
    watchers: watchers.length,
    attachments: attachments.length,
    activity: activity.length,
  });
}

type Fixture = {
  key: string;
  neighbourId: string;
  parentKey: string;
};

type RouteCase = {
  /** `METHOD /api/...` key as registered in the policy registry and the matrix fixture. */
  matrixKey: string;
  /** Put the item into the state this route's success path needs. */
  prepare?: (world: World, item: Fixture) => Promise<void>;
  call: (app: App, world: World, item: Fixture) => Promise<Response>;
};

async function json(
  app: App,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ROUTES: RouteCase[] = [
  {
    matrixKey: "PATCH /api/work-items/{key}",
    call: (app, _w, i) =>
      json(
        app,
        "PATCH",
        `/api/work-items/${i.key}`,
        { title: "Overwritten title" },
        { "if-match": '"1"' },
      ),
  },
  {
    matrixKey: "POST /api/work-items/{key}/assign",
    call: (app, w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/assign`, {
        assigneeId: w.projectMember.personId,
      }),
  },
  {
    matrixKey: "DELETE /api/work-items/{key}/assign",
    prepare: async (w, i) => {
      await db
        .update(schema.workItemTable)
        .set({ assigneeId: w.projectMember.personId })
        .where(eq(schema.workItemTable.key, i.key));
    },
    call: (app, _w, i) =>
      json(app, "DELETE", `/api/work-items/${i.key}/assign`),
  },
  {
    matrixKey: "DELETE /api/work-items/{key}",
    call: (app, _w, i) => json(app, "DELETE", `/api/work-items/${i.key}`),
  },
  {
    matrixKey: "POST /api/work-items/{key}/rank",
    call: (app, _w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/rank`, {
        beforeId: i.neighbourId,
      }),
  },
  {
    matrixKey: "POST /api/work-items/{key}/parent",
    call: (app, _w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/parent`, {
        parentKey: i.parentKey,
      }),
  },
  {
    matrixKey: "DELETE /api/work-items/{key}/parent",
    prepare: async (_w, i) => {
      const [parent] = await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.key, i.parentKey));
      await db
        .update(schema.workItemTable)
        .set({ parentId: parent?.id ?? null })
        .where(eq(schema.workItemTable.key, i.key));
    },
    call: (app, _w, i) =>
      json(app, "DELETE", `/api/work-items/${i.key}/parent`),
  },
  {
    matrixKey: "POST /api/work-items/{key}/watch",
    call: (app, _w, i) => json(app, "POST", `/api/work-items/${i.key}/watch`),
  },
  {
    matrixKey: "DELETE /api/work-items/{key}/watch",
    call: (app, _w, i) => json(app, "DELETE", `/api/work-items/${i.key}/watch`),
  },
  {
    matrixKey: "POST /api/work-items/{key}/transition",
    call: (app, w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/transition`, {
        toStateTemplateId: w.started.stateTemplate.id,
      }),
  },
  {
    matrixKey: "POST /api/work-items/{key}/comments",
    call: (app, _w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/comments`, {
        body: { type: "doc", content: [] },
        visibility: "public",
      }),
  },
  {
    matrixKey: "POST /api/work-items/{key}/attachments/presign",
    call: (app, _w, i) =>
      json(app, "POST", `/api/work-items/${i.key}/attachments/presign`, {
        filename: "probe.png",
        contentType: "image/png",
        size: 1024,
      }),
  },
];

describe("API integration: project reach on item-scoped work-item routes", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-reach-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalRoot === undefined) {
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    } else {
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    }
    await rm(root, { recursive: true, force: true });
  });

  for (const route of ROUTES) {
    describe(route.matrixKey, () => {
      async function arrange() {
        const world = await setupWorld();
        const { app } = createApp();
        const target = await createItem(app, world, TITLE);
        const neighbour = await createItem(app, world, "Neighbour");
        const parent = await createItem(app, world, "Parent");
        const item: Fixture = {
          key: target.key,
          neighbourId: neighbour.id,
          parentKey: parent.key,
        };
        await route.prepare?.(world, item);
        return { world, app, item };
      }

      it("a same-workspace caller with no project membership gets 404, writes nothing and sees no row", async () => {
        const { world, app, item } = await arrange();
        const declared = matrixStatus(
          MATRIX.routes[route.matrixKey]?.member?.outOfReach,
        );
        expect(declared).toBe(404);
        const before = await snapshot();

        for (const outsider of [
          world.outsiderLead,
          world.outsiderMember,
          world.outsiderAdmin,
        ]) {
          mockAuthenticatedSession(outsider.user);
          const response = await route.call(app, world, item);
          const text = await response.text();
          expect(response.status, text).toBe(declared);
          expect(text).not.toContain(TITLE);
          expect(await snapshot()).toBe(before);
        }
      });

      it("a customer-role member gets the matrix's customer answer, and nothing is written", async () => {
        const { world, app, item } = await arrange();
        const before = await snapshot();

        mockAuthenticatedSession(world.customerNoRole.user);
        const out = await route.call(app, world, item);
        const outText = await out.text();
        expect(out.status, outText).toBe(
          matrixStatus(MATRIX.routes[route.matrixKey]?.customer?.outOfReach),
        );
        expect(outText).not.toContain(TITLE);

        mockAuthenticatedSession(world.customerWithRole.user);
        const inside = await route.call(app, world, item);
        const insideText = await inside.text();
        expect(inside.status, insideText).toBe(
          matrixStatus(MATRIX.routes[route.matrixKey]?.customer?.inReach),
        );
        expect(await snapshot()).toBe(before);
      });

      it("a project member holding the capability succeeds", async () => {
        const { world, app, item } = await arrange();
        mockAuthenticatedSession(world.projectMember.user);
        const response = await route.call(app, world, item);
        expect(response.status, await response.clone().text()).toBe(200);
      });
    });
  }

  describe("POST /api/work-items/bulk", () => {
    it("reports an item outside the caller's project reach exactly like a missing key, and changes nothing", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const hidden = await createItem(app, world, TITLE);
      const before = await snapshot();

      mockAuthenticatedSession(world.outsiderLead.user);
      const response = await json(app, "POST", "/api/work-items/bulk", {
        workspaceId: world.workspaceId,
        workItemKeys: [hidden.key, "NOPE-9999"],
        operation: "assign",
        assigneeId: world.projectMember.personId,
      });
      const body = (await response.json()) as {
        succeeded: string[];
        failed: { id: string; reason: string }[];
      };
      expect(response.status).toBe(200);
      expect(body.succeeded).toEqual([]);
      expect(body.failed.map((f) => f.reason)).toEqual([
        "Work item not found",
        "Work item not found",
      ]);
      expect(await snapshot()).toBe(before);
    });
  });
});
